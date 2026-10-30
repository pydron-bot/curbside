import { describe, expect, it } from 'vitest';
import { CameraRig, LEAD_CAR, LEAD_FOOT } from '../src/render/cameraRig';
import { CarBody, applyBody } from '../src/render/fxCarBody';
import { GrassMap, SkidTrail, driftTint, skidAmount, type SkidInput } from '../src/render/fxDriving';
import { HitStop, Spring, Trauma, smoothNoise, softClamp } from '../src/render/fxMotion';
import { FLAG, FRAME, InstanceBuffer, ParticlePool, RAMP, fireColour, rampAlpha } from '../src/render/fxParticles';
import { WeatherCycle } from '../src/render/fxWeather';
import { BLOCK_SIZE, HALF_EXTENT, generateCity } from '../src/world/city';
import { mulberry32 } from '../src/world/random';

const DT = 1 / 60;

describe('particle pool', () => {
  it('reuses dead slots from the free list and never grows past capacity', () => {
    const pool = new ParticlePool(4);
    const ids = [0, 1, 2, 3].map(() => pool.spawn(0, 0, 0, 0, 0, 0, 1, 1, 1, RAMP.flat, FRAME.dot));
    expect(ids).toEqual([0, 1, 2, 3]);
    expect(pool.spawn(0, 0, 0, 0, 0, 0, 1, 1, 1, RAMP.flat, FRAME.dot)).toBe(-1);
    // Kill slot 1 only.
    pool.life[1] = 0.01;
    pool.step(0.02);
    expect(pool.count).toBe(3);
    expect(pool.spawn(0, 0, 0, 0, 0, 0, 1, 1, 1, RAMP.flat, FRAME.dot)).toBe(1);
    expect(pool.count).toBe(4);
  });

  it('empties completely and starts from slot 0 again', () => {
    const pool = new ParticlePool(8);
    for (let i = 0; i < 8; i++) pool.spawn(0, 0, 0, 0, 0, 0, 0.1, 1, 1, RAMP.flat, FRAME.dot);
    pool.step(0.2);
    expect(pool.count).toBe(0);
    expect(pool.spawn(0, 0, 0, 0, 0, 0, 1, 1, 1, RAMP.flat, FRAME.dot)).toBe(0);
  });

  it('moves with velocity, gravity and drag, and bounces off the ground', () => {
    const pool = new ParticlePool(2);
    const i = pool.spawn(0, 1, 0, 4, 0, 0, 5, 1, 1, RAMP.spark, FRAME.spark);
    pool.gravity[i] = 20;
    pool.flags[i] = FLAG.bounce;
    for (let k = 0; k < 60; k++) pool.step(DT);
    expect(pool.x[i]).toBeGreaterThan(1); // bounces bleed off speed
    expect(pool.y[i]).toBeGreaterThanOrEqual(0.05);
    expect(pool.y[i]).toBeLessThan(1);
    const j = pool.spawn(0, 1, 0, 10, 0, 0, 5, 1, 1, RAMP.flat, FRAME.dot);
    pool.drag[j] = 5;
    pool.step(0.5);
    expect(pool.vx[j]).toBeLessThan(10 / 3);
  });

  it('keeps still particles in place (their velocity only orients them)', () => {
    const pool = new ParticlePool(1);
    const i = pool.spawn(3, 1, 4, 1, 0, 0, 1, 1, 1, RAMP.flat, FRAME.spark);
    pool.flags[i] = FLAG.stretch | FLAG.still;
    pool.stretch[i] = 6;
    pool.step(0.3);
    expect([pool.x[i], pool.z[i]]).toEqual([3, 4]);
    const out = new InstanceBuffer(4);
    pool.write(out);
    // Axis = velocity × stretch: 6 m along +x.
    expect(out.axis[0]).toBeCloseTo(6);
  });

  it('fades smoke by opacity (not size) and hands burnt-out fire to onDeath', () => {
    const pool = new ParticlePool(4);
    pool.spawn(0, 0, 0, 0, 0, 0, 1, 2, 2, RAMP.smoke, FRAME.puffA);
    pool.step(0.95);
    const out = new InstanceBuffer(4);
    pool.write(out);
    expect(out.pos[3]).toBeCloseTo(2); // size unchanged
    expect(out.colour[3]).toBeLessThan(0.05); // nearly transparent
    expect(out.colour[3]).toBeGreaterThan(0);
    let handed = 0;
    pool.onDeath = () => handed++;
    const f = pool.spawn(0, 0, 0, 0, 0, 0, 0.1, 1, 1, RAMP.fire, FRAME.flame);
    pool.flags[f] = FLAG.handoff;
    pool.step(0.2);
    expect(handed).toBe(1);
  });

  it('writes only live particles and stops at the sink capacity', () => {
    const pool = new ParticlePool(10);
    for (let i = 0; i < 10; i++) pool.spawn(i, 0, 0, 0, 0, 0, 1, 1, 1, RAMP.flash, FRAME.star);
    pool.step(0.1);
    const out = new InstanceBuffer(6);
    expect(pool.write(out)).toBe(6);
    expect(out.count).toBe(6);
  });

  it('cools fire from white-yellow through orange to dark red', () => {
    const c = [0, 0, 0];
    fireColour(0, c);
    expect(c[1]).toBeGreaterThan(0.85);
    fireColour(0.55, c);
    expect(c[0]).toBeGreaterThan(c[1] * 2);
    fireColour(1, c);
    expect(c[0]).toBeLessThan(0.3);
    // Opacity: fire is gone by the end, sparks fade linearly.
    expect(rampAlpha(RAMP.fire, 1, 1, 0)).toBe(0);
    expect(rampAlpha(RAMP.spark, 0.5, 0.5, 0)).toBeCloseTo(0.5);
  });
});

describe('motion helpers', () => {
  it('trauma shakes by its square and drains', () => {
    const t = new Trauma(1);
    t.add(0.5);
    expect(t.shake).toBeCloseTo(0.25);
    t.add(2);
    expect(t.level).toBe(1);
    t.step(0.4);
    expect(t.level).toBeCloseTo(0.6);
    t.step(5);
    expect(t.level).toBe(0);
  });

  it('smooth noise is continuous and bounded', () => {
    let prev = smoothNoise(0, 1);
    for (let t = 0.001; t < 3; t += 0.001) {
      const n = smoothNoise(t, 1);
      expect(Math.abs(n)).toBeLessThanOrEqual(1);
      expect(Math.abs(n - prev)).toBeLessThan(0.06);
      prev = n;
    }
    expect(smoothNoise(1.234, 1)).not.toBeCloseTo(smoothNoise(1.234, 2));
  });

  it('soft clamp passes small values and saturates large ones', () => {
    expect(softClamp(0.1, 10)).toBeCloseTo(0.1, 2);
    expect(softClamp(1000, 10)).toBeCloseTo(10);
    expect(softClamp(-1000, 10)).toBeCloseTo(-10);
  });

  it('a kicked spring overshoots a little and settles back', () => {
    const s = new Spring(120, 14);
    s.kick(5);
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      s.step(DT);
      peak = Math.max(peak, s.value);
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(Math.abs(s.value)).toBeLessThan(0.01);
    // A huge frame doesn't blow up.
    s.kick(5);
    s.step(0.5);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(1);
  });

  it('hit-stop holds, recovers, and does not stack into slow motion', () => {
    const h = new HitStop();
    expect(h.step(DT)).toBe(1);
    h.hit(0.07, 0.05);
    expect(h.step(DT)).toBe(0.05);
    // Real time keeps going: 0.07 s hold + 0.08 s recovery.
    let t = DT;
    while (h.active && t < 1) {
      h.step(DT);
      t += DT;
    }
    expect(t).toBeLessThan(0.2);
    expect(h.step(DT)).toBe(1);
    // Small stops during the cooldown are ignored; a big one still lands.
    h.hit(0.04);
    expect(h.step(DT)).toBe(1);
    h.hit(0.075);
    expect(h.step(DT)).toBeLessThan(0.2);
    // Overlapping hits keep the longest remaining hold, not the sum.
    const slowFor = (hits: number) => {
      const k = new HitStop();
      for (let i = 0; i < hits; i++) k.hit(0.06);
      let held = 0;
      while (k.step(0.01) < 0.5) held += 0.01;
      return held;
    };
    expect(slowFor(3)).toBeCloseTo(slowFor(1), 5);
  });
});

describe('car body', () => {
  const sim = (heading = 0) => ({ x: 0, z: 0, heading, vx: 0, vz: 0 });

  it('leans out of a right turn and dips the nose under braking', () => {
    const b = new CarBody();
    const s = sim(0);
    s.vz = 20; // heading 0: nose along +z
    b.step(s, DT);
    // Accelerate to the right (the car's left axis is +x at heading 0, so right is -x).
    for (let i = 0; i < 30; i++) {
      s.vx -= 15 * DT;
      b.step(s, DT);
    }
    expect(b.roll.value).toBeLessThan(-0.01); // left side drops: leaning outward
    const c = new CarBody();
    const t = sim(0);
    t.vz = 25;
    c.step(t, DT);
    for (let i = 0; i < 20; i++) {
      t.vz -= 25 * DT;
      c.step(t, DT);
    }
    expect(c.pitch.value).toBeGreaterThan(0.01); // nose down
  });

  it('settles flat at a steady speed', () => {
    const b = new CarBody();
    const s = sim(1);
    s.vx = 10;
    for (let i = 0; i < 300; i++) b.step(s, DT);
    expect(Math.abs(b.roll.value)).toBeLessThan(1e-3);
    expect(Math.abs(b.pitch.value)).toBeLessThan(1e-3);
    expect(b.lift()).toBeLessThan(1e-3);
  });

  it('hops and tumbles from a blast, then lands', () => {
    const b = new CarBody();
    const s = sim(0);
    b.step(s, DT);
    b.blast(s, 0, 0, 1);
    let peak = 0;
    let tilt = 0;
    for (let i = 0; i < 180; i++) {
      b.step(s, DT);
      peak = Math.max(peak, b.hop);
      tilt = Math.max(tilt, Math.abs(b.roll.value) + Math.abs(b.pitch.value));
    }
    expect(peak).toBeGreaterThan(0.4);
    expect(tilt).toBeGreaterThan(0.1);
    expect(b.hop).toBe(0);
  });

  it('writes pitch/roll/lift/squash onto a root in YXZ order, and resets on a teleport', () => {
    const b = new CarBody();
    const s = sim(0);
    b.step(s, DT);
    b.impact(s, 1, 0, 20);
    b.step(s, DT);
    const root = {
      position: { y: 0 },
      rotation: { x: 0, z: 0, order: 'XYZ' },
      scaled: [1, 1, 1],
      scale: { set(x: number, y: number, z: number) { root.scaled = [x, y, z]; } },
    };
    applyBody(root, b);
    expect(root.rotation.order).toBe('YXZ');
    expect(root.rotation.z).not.toBe(0);
    expect(root.scaled[1]).toBeLessThan(1);
    s.x = 500;
    b.step(s, DT);
    expect(b.roll.value).toBe(0);
  });
});

describe('driving effects logic', () => {
  const base: SkidInput = { slip: 0, speed: 20, forward: 20, accel: 0, handbrake: false, throttle: 0 };

  it('skids on a slide, the handbrake, hard braking and wheelspin, not when cruising', () => {
    expect(skidAmount(base)).toBe(0);
    expect(skidAmount({ ...base, slip: 8 })).toBeGreaterThan(0.5);
    expect(skidAmount({ ...base, handbrake: true })).toBeGreaterThan(0.5);
    expect(skidAmount({ ...base, handbrake: true, speed: 2 })).toBe(0);
    expect(skidAmount({ ...base, accel: -26 })).toBeGreaterThan(0.5);
    expect(skidAmount({ ...base, accel: -10 })).toBe(0);
    expect(skidAmount({ ...base, speed: 2, forward: 2, accel: 14, throttle: 1 })).toBe(0.5);
    expect(skidAmount({ ...base, slip: 100 })).toBe(1);
  });

  it('drift smoke warms from grey to gold to pink with points', () => {
    const c = { r: 0, g: 0, b: 0 };
    driftTint(0, c);
    expect(c.r).toBe(c.b);
    driftTint(450, c);
    expect(c.r).toBeGreaterThan(c.b + 0.3);
    driftTint(1200, c);
    expect(c.b).toBeGreaterThan(c.g);
  });

  it('knows park lawns from roads and sidewalks', () => {
    const city = generateCity(1337);
    const grass = new GrassMap(city);
    const park = city.blocks.find((b) => b.kind === 'park')!;
    const cx = -HALF_EXTENT + (park.bx + 0.5) * BLOCK_SIZE;
    const cz = -HALF_EXTENT + (park.bz + 0.5) * BLOCK_SIZE;
    expect(grass.isGrass(cx, cz)).toBe(true);
    // The road along the block's edge.
    expect(grass.isGrass(-HALF_EXTENT + park.bx * BLOCK_SIZE + 1, cz)).toBe(false);
    const built = city.blocks.find((b) => b.kind === 'buildings')!;
    expect(grass.isGrass(-HALF_EXTENT + (built.bx + 0.5) * BLOCK_SIZE, -HALF_EXTENT + (built.bz + 0.5) * BLOCK_SIZE)).toBe(false);
    expect(grass.isGrass(1e5, 0)).toBe(false);
  });

  it('lays a continuous ribbon: each segment starts where the last ended', () => {
    const segs: number[][] = [];
    const decals = { segment: (...a: Array<number | undefined>) => void segs.push(a as number[]) };
    const trail = new SkidTrail();
    for (let i = 0; i <= 10; i++) trail.step(0, i * 0.5, 0.8, decals);
    expect(segs.length).toBeGreaterThan(5);
    for (let k = 1; k < segs.length; k++) {
      // Previous end edges (d, c) are this start's (a, b).
      const [, , , , cx, cz, dx, dz] = segs[k - 1];
      const [ax, az, bx, bz] = segs[k];
      expect([ax, az, bx, bz]).toEqual([dx, dz, cx, cz]);
    }
    // Stopping the skid ends the ribbon; a jump restarts rather than bridging.
    const n = segs.length;
    trail.step(0, 6, 0, decals);
    trail.step(0, 20, 0.8, decals);
    trail.step(0, 20.6, 0.8, decals);
    expect(segs.length).toBe(n + 1);
    expect(segs[n][1]).toBeGreaterThan(19);
  });
});

describe('weather cycle', () => {
  it('starts dry, rains for a spell, wets the streets behind it and dries slowly after', () => {
    const w = new WeatherCycle(mulberry32(7));
    for (let t = 0; t < 100; t += 0.5) w.step(0.5);
    expect(w.rain).toBe(0);
    let maxRain = 0;
    let maxWet = 0;
    let t = 0;
    while (!w.isRaining && t < 400) {
      w.step(0.5);
      t += 0.5;
    }
    expect(w.isRaining).toBe(true);
    for (let k = 0; k < 60; k++) {
      w.step(0.5);
      maxRain = Math.max(maxRain, w.rain);
      maxWet = Math.max(maxWet, w.wetness);
    }
    expect(maxRain).toBeGreaterThan(0.5);
    expect(maxWet).toBeGreaterThan(0.5);
    w.set(false);
    for (let k = 0; k < 40; k++) w.step(0.5);
    expect(w.rain).toBe(0);
    // Still wet a while after the rain stops.
    expect(w.wetness).toBeGreaterThan(0.2);
    for (let k = 0; k < 400; k++) w.step(0.5);
    expect(w.wetness).toBe(0);
  });
});

describe('camera feel', () => {
  it('leads further across a landscape screen than up it, and keeps the target on screen', () => {
    const rig = new CameraRig(852 / 393);
    rig.setLead(LEAD_CAR);
    rig.snapTo(0, 0);
    // Drive right at 30 m/s for 3 s, then up the screen.
    let x = 0;
    for (let i = 0; i < 180; i++) {
      x += 30 * DT;
      rig.update(DT, x, 0, 30, 0);
    }
    const leadX = rig.focusX - x;
    const rig2 = new CameraRig(852 / 393);
    rig2.setLead(LEAD_CAR);
    rig2.snapTo(0, 0);
    let z = 0;
    for (let i = 0; i < 180; i++) {
      z -= 30 * DT;
      rig2.update(DT, 0, z, 0, -30);
    }
    const leadZ = z - rig2.focusZ;
    expect(leadX).toBeGreaterThan(leadZ);
    expect(leadZ).toBeGreaterThan(8);
    // The car stays inside the visible ground with margin.
    const r = rig2.visibleGround({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 });
    expect(z).toBeLessThan(r.maxZ - 3);
    // About 1.2 s or more of road ahead up the screen.
    expect(z - r.minZ).toBeGreaterThan(30 * 1.2);
  });

  it('on foot the lead is gentle', () => {
    const rig = new CameraRig(852 / 393);
    rig.setHeights(20, 24);
    rig.setLead(LEAD_FOOT);
    rig.snapTo(0, 0);
    let x = 0;
    for (let i = 0; i < 120; i++) {
      x += 6 * DT;
      rig.update(DT, x, 0, 6, 0);
    }
    expect(Math.abs(rig.focusX - x)).toBeLessThan(4);
  });

  it('shakes from trauma without moving the focus, and the shake dies away', () => {
    const rig = new CameraRig(16 / 9);
    rig.snapTo(10, 10);
    rig.update(DT, 10, 10, 0, 0);
    rig.addTrauma(1);
    rig.kick(1, 0, 1);
    rig.punchFov(4);
    let moved = 0;
    let narrowest = 45;
    for (let i = 0; i < 20; i++) {
      rig.update(DT, 10, 10, 0, 0);
      moved = Math.max(moved, Math.hypot(rig.camera.position.x - 10, rig.camera.position.z - 10 - rig.currentHeight * 0.12));
      narrowest = Math.min(narrowest, rig.camera.fov);
    }
    expect(moved).toBeGreaterThan(0.3);
    expect(rig.focusX).toBeCloseTo(10);
    expect(narrowest).toBeLessThan(42);
    for (let i = 0; i < 240; i++) rig.update(DT, 10, 10, 0, 0);
    expect(rig.traumaLevel).toBe(0);
    expect(rig.camera.position.x).toBeCloseTo(10, 2);
    expect(rig.camera.fov).toBeCloseTo(45, 2);
  });

  it('reduced motion keeps the shake small and skips FOV punches', () => {
    const rig = new CameraRig(16 / 9);
    rig.reducedMotion = true;
    rig.snapTo(0, 0);
    rig.addTrauma(1);
    rig.punchFov(5);
    let moved = 0;
    for (let i = 0; i < 30; i++) {
      rig.update(DT, 0, 0, 0, 0);
      moved = Math.max(moved, Math.abs(rig.camera.position.x));
    }
    expect(rig.camera.fov).toBe(45);
    expect(moved).toBeLessThan(0.4);
  });

  it('eases a lift in for an on-foot fight', () => {
    const rig = new CameraRig(16 / 9);
    rig.setHeights(20, 24);
    rig.snapTo(0, 0);
    for (let i = 0; i < 600; i++) rig.update(DT, 0, 0, 0, 0);
    const h0 = rig.currentHeight;
    rig.lift = 5;
    for (let i = 0; i < 240; i++) rig.update(DT, 0, 0, 0, 0);
    expect(rig.currentHeight).toBeGreaterThan(h0 + 4.5);
  });
});

describe('effects budget', () => {
  it('a chain of explosions shares one particle budget and every pool stays within capacity', async () => {
    const { Scene } = await import('three');
    const { Effects } = await import('../src/render/effects');
    const fx = new Effects(new Scene());
    fx.explode(0, 0);
    const one = fx.hot.count + fx.soft.count;
    expect(one).toBeGreaterThan(60);
    fx.clear();
    for (let i = 0; i < 5; i++) fx.explode(i * 3, 0);
    const five = fx.hot.count + fx.soft.count;
    // Five at once cost well under five times one.
    expect(five).toBeLessThan(one * 3);
    for (let i = 0; i < 30; i++) fx.explode(i, i);
    expect(fx.hot.count).toBeLessThanOrEqual(fx.hot.capacity);
    expect(fx.soft.count).toBeLessThanOrEqual(fx.soft.capacity);
    expect(fx.debris.count).toBeLessThanOrEqual(fx.debris.capacity);
    // Everything burns out: fire hands off to smoke, smoke fades, debris settles and goes.
    for (let i = 0; i < 12 * 30; i++) fx.update(1 / 30);
    expect(fx.hot.count + fx.soft.count + fx.debris.count).toBe(0);
  });

  it('draws the ground-marks layer only while a mark is alive', async () => {
    const { GroundDecals, DECAL } = await import('../src/render/fxDecals');
    const decals = new GroundDecals();
    decals.update(1 / 60);
    expect(decals.mesh.visible).toBe(false);
    decals.stamp(0, 0, 0.2, 0, 0.8, 2, DECAL.pock);
    decals.update(1 / 60);
    expect(decals.mesh.visible).toBe(true);
    for (let i = 0; i < 150; i++) decals.update(1 / 60);
    expect(decals.mesh.visible).toBe(false);
    // Clearing still gets its upload drawn once, then the layer is idle again.
    decals.clear();
    decals.update(1 / 60);
    expect(decals.mesh.visible).toBe(true);
    decals.update(1 / 60);
    expect(decals.mesh.visible).toBe(false);
  });

  it('tracers, muzzle flashes and impacts draw and expire', async () => {
    const { Scene } = await import('three');
    const { Effects } = await import('../src/render/effects');
    const scene = new Scene();
    const fx = new Effects(scene);
    fx.muzzleFlash(0, 0, 1, 0, 1);
    fx.tracer(0, 0, 30, 0, 'smg');
    fx.impact(30, 0, 'wall', 0, 0);
    fx.update(1 / 60);
    const hot = scene.getObjectByName('fxHot')!;
    expect(hot.visible).toBe(true);
    for (let i = 0; i < 120; i++) fx.update(1 / 60);
    expect(fx.hot.count).toBe(0);
    fx.update(1 / 60);
    expect(hot.visible).toBe(false);
  });
});
