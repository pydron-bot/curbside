/**
 * The emergency scenes on screen (game/scenes/fireCrews.ts, tows.ts,
 * alarms.ts), as CityLifeLook parts: fires (flame, smoke and ember
 * particles over a flickering pool of faked light, brighter at night),
 * firefighters' hoses (arcing water drops, steam where they land), a tow
 * truck's amber beacon while it works, and a car alarm's flashing
 * indicators.
 *
 * Particles go through Effects' pools and light through the shared glow
 * batch: no mesh, program or draw call of its own, no real light, and
 * nothing allocated per frame.
 */
import type { CityLife } from '../game/cityLife';
import { FireCrews } from '../game/scenes/fireCrews';
import { CarAlarms } from '../game/scenes/alarms';
import { Tows } from '../game/scenes/tows';
import { alarmLit } from '../systems/emergency';
import type { Rect } from '../world/city';
import { near, type CityLookPart } from './cityLifeLook';
import type { Effects } from './effects';
import { FLAG, FRAME, RAMP } from './fxParticles';
import { GLOW, type GlowSprites } from './glowSprites';
import { worldUniforms } from './shaderLib';

/** Fires further than this outside the view emit nothing, m. */
const MARGIN = 14;
/** Flame and smoke particles a second at full strength (times the effects tier's scale). */
const FLAMES = 30;
const SMOKE = 3;
/** A fire's smoke starts this far downwind of it, m. */
const SMOKE_DOWNWIND = 3;
/** Water drops a second from each hose, and how fast they leave the nozzle, m/s. */
const WATER = 48;
const JET_SPEED = 13;
const NOZZLE_Y = 1.15;
const GRAVITY = 9;
/** Hoses tracked for their particle debt (trucks × crew). */
const MAX_HOSES = 8;

/** The fires, and the crews' hoses on them. */
export function fireLook(life: CityLife): CityLookPart {
  const scene = FireCrews.of(life);
  if (!scene) return {};
  const fires = scene.board.fires;
  const flameDebt = new Float32Array(fires.length);
  const hoseDebt = new Float32Array(MAX_HOSES);
  let time = 0;
  return {
    update(dt: number, view: Rect, fx: Effects): void {
      time += dt;
      const scale = fx.scale;
      for (let i = 0; i < fires.length; i++) {
        const f = fires[i];
        if (!f.alive || !near(view, f.x, f.z, MARGIN)) {
          flameDebt[i] = 0;
          continue;
        }
        const k = f.strength;
        const spread = f.building ? 1.6 : 1.1;
        flameDebt[i] += dt * FLAMES * k * scale;
        while (flameDebt[i] >= 1) {
          flameDebt[i] -= 1;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * spread;
          flame(fx, f.x + Math.cos(a) * r, f.z + Math.sin(a) * r, f.building ? 0.3 + Math.random() * 2.4 : 0.6 + Math.random() * 0.5, 0.6 + 0.4 * k);
        }
        // Smoke from above the flames and downwind (it's drawn over them, so it mustn't sit on top), paler once a hose is on it.
        if (Math.random() < dt * SMOKE * (0.3 + k) * scale) {
          const w = SMOKE_DOWNWIND / (Math.sqrt(fx.windX * fx.windX + fx.windZ * fx.windZ) || 1);
          fx.emitSmoke(f.x + fx.windX * w, f.z + fx.windZ * w, 3 + k * 1.4, f.claimed ? 0.15 : 0.4);
        }
        if (Math.random() < dt * 3 * k * scale) fx.embers(f.x, f.z, 1, 0.3, 1.4);
      }
      let h = 0;
      for (const c of scene.crews) {
        for (let m = 0; m < c.men.length; m++, h++) {
          if (h >= MAX_HOSES) return;
          const man = c.men[m];
          if (!man || !c.hosing[m] || !near(view, c.fire.x, c.fire.z, MARGIN)) {
            hoseDebt[h] = 0;
            continue;
          }
          hoseDebt[h] = jet(fx, man.agent.s.x, man.agent.s.z, c.fire.x, c.fire.z, c.fire.building ? 1.4 : 0.9, hoseDebt[h] + dt * WATER * scale, dt);
        }
      }
    },
    draw(glows: GlowSprites, view: Rect): void {
      // A flickering pool of orange round each fire, brighter at night.
      const glow = 0.55 + 0.85 * worldUniforms.uNight.value;
      for (const f of fires) {
        if (!f.alive || !near(view, f.x, f.z, 10)) continue;
        const flicker = 0.75 + 0.15 * Math.sin(time * 19 + f.x) + 0.1 * Math.sin(time * 31 + f.z);
        const k = glow * flicker * f.strength;
        const size = 4 + f.strength * 5;
        glows.addFlat(f.x, 0.07, f.z, 0, size, size, 1.1 * k, 0.42 * k, 0.08 * k, GLOW.disc);
        glows.addFlat(f.x, 1.2, f.z, time * 0.7, 2.6, 2.6, 0.9 * k, 0.4 * k, 0.08 * k, GLOW.disc);
      }
    },
  };
}

/** A tongue of flame at (x, y, z), bigger and longer-lived than a burning car's (it has to show through the smoke), `size` 0..1. */
function flame(fx: Effects, x: number, z: number, y: number, size: number): void {
  const pool = fx.hot;
  const i = pool.spawn(x, y, z, fx.windX * 0.3 + (Math.random() - 0.5) * 0.4, 2 + Math.random() * 1.6, fx.windZ * 0.3 + (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.4, (1.3 + Math.random() * 0.7) * size, 0.45, RAMP.fire, FRAME.flame);
  if (i < 0) return;
  const k = 1.6 + Math.random() * 0.6;
  pool.r[i] = k;
  pool.g[i] = k;
  pool.b[i] = k;
  pool.add[i] = 0.6;
  pool.alpha[i] = 0.95;
  pool.spin[i] = (Math.random() - 0.5) * 3;
}

/**
 * `debt` water drops' worth from a firefighter at (x, z) in a lob onto
 * (tx, ty, tz), with steam where it lands; returns the debt left over.
 * Each drop starts somewhere in the last `dt` of its flight, so a slow
 * frame still draws a stream, not a clump at the nozzle.
 */
function jet(fx: Effects, x: number, z: number, tx: number, tz: number, ty: number, debt: number, dt: number): number {
  const pool = fx.soft;
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  // From the nozzle half a step ahead of them; flight time from the distance, lift to land at ty.
  const ox = x + (dx / d) * 0.5;
  const oz = z + (dz / d) * 0.5;
  const t = Math.max(0.15, (d - 0.5) / JET_SPEED);
  const vy = (ty - NOZZLE_Y) / t + (GRAVITY * t) / 2;
  const vx = ((dx / d) * (d - 0.5)) / t;
  const vz = ((dz / d) * (d - 0.5)) / t;
  while (debt >= 1) {
    debt -= 1;
    const j = (Math.random() - 0.5) * 0.08;
    const a = Math.random() * Math.min(dt, t * 0.8);
    const dvy = vy + (Math.random() - 0.5) * 0.6;
    const i = pool.spawn(ox + vx * a, NOZZLE_Y + (dvy - (GRAVITY * a) / 2) * a, oz + vz * a, vx - vz * j, dvy - GRAVITY * a, vz + vx * j, t * (0.92 + Math.random() * 0.16) - a, 0.45, 0.9, RAMP.flat, FRAME.dot);
    if (i < 0) return 0;
    pool.r[i] = 0.86;
    pool.g[i] = 0.94;
    pool.b[i] = 1;
    pool.alpha[i] = 0.9;
    pool.gravity[i] = GRAVITY;
    pool.drag[i] = 0;
    // Streaks along the flight, so it reads as a jet.
    pool.flags[i] = FLAG.stretch;
    pool.stretch[i] = 0.07;
  }
  if (Math.random() < dt * 8) fx.puff(tx + (Math.random() - 0.5) * 1.6, ty, tz + (Math.random() - 0.5) * 1.6, 0.92, 0.8, 3, 0.4, 0, 1.4, 0, 1.6);
  return debt;
}

/** A tow truck's amber beacon, turning while it's on a job (on its way, hooking, towing). */
export function towLook(life: CityLife): CityLookPart {
  const scene = Tows.of(life);
  if (!scene) return {};
  let time = 0;
  return {
    update(dt: number): void {
      time += dt;
    },
    draw(glows: GlowSprites, view: Rect): void {
      const night = worldUniforms.uNight.value;
      for (const t of scene.tows) {
        const p = t.truck.mesh.root.position;
        if (!near(view, p.x, p.z, 4)) continue;
        const h = t.truck.sim.heading;
        const fx = Math.sin(h);
        const fz = Math.cos(h);
        // A beacon bar on the cab: two lamps turning, one bright at a time.
        const turn = (time * 3) % 1;
        const cab = 1.6;
        for (let side = -1; side <= 1; side += 2) {
          const on = (side < 0) === turn < 0.5;
          const k = on ? 1.8 : 0.25;
          const bx = p.x + fx * cab + fz * side * 0.45;
          const bz = p.z + fz * cab - fx * side * 0.45;
          glows.addFlat(bx, 2.75, bz, h, 1.5, 1.5, 1.6 * k, 0.75 * k, 0.05 * k, GLOW.disc);
        }
        const wash = (0.12 + 0.2 * night) * (0.6 + 0.4 * Math.sin(time * 19));
        glows.addFlat(p.x, 0.08, p.z, h, 10, 10, 1.4 * wash, 0.7 * wash, 0.05 * wash, GLOW.disc);
      }
    },
  };
}

/** Car alarms: the four indicators flashing amber (and a blink of wash on the road). */
export function alarmLook(life: CityLife): CityLookPart {
  const scene = CarAlarms.of(life);
  if (!scene) return {};
  return {
    draw(glows: GlowSprites, view: Rect): void {
      const night = worldUniforms.uNight.value;
      for (const a of scene.board.alarms) {
        const v = a.car;
        if (!a.alive || !v || !alarmLit(a.age)) continue;
        const p = v.mesh.root.position;
        if (!near(view, p.x, p.z, 3)) continue;
        const s = v.sim;
        const fx = Math.sin(s.heading);
        const fz = Math.cos(s.heading);
        const reach = (s.body?.reach ?? 2.4) - 0.15;
        const half = (s.body?.halfWidth ?? 1) * 0.85;
        for (let end = -1; end <= 1; end += 2) {
          for (let side = -1; side <= 1; side += 2) {
            const x = p.x + fx * end * reach + fz * side * half;
            const z = p.z + fz * end * reach - fx * side * half;
            glows.addFlat(x, 0.85, z, s.heading, 1.4, 1.4, 2.6, 1.25, 0.12, GLOW.disc);
          }
        }
        const wash = 0.18 + 0.25 * night;
        glows.addFlat(p.x, 0.08, p.z, s.heading, 7, 9, 1.4 * wash, 0.7 * wash, 0.05 * wash, GLOW.disc);
      }
    },
  };
}
