import { describe, expect, it } from 'vitest';
import {
  ALARM_CYCLE,
  ALARM_PATTERNS,
  ALARM_SECONDS,
  AlarmBoard,
  FIRE_FADE,
  FIRE_LIFE,
  FireBoard,
  HOSE_SECONDS,
  MAX_ALARMS,
  MAX_FIRES,
  TOW_GAP,
  alarmLit,
  alarmPattern,
  onBody,
  towPose,
  towPriority,
  wallFireAt,
  winch,
  type Pose,
} from '../src/systems/emergency';

function burn(b: FireBoard, seconds: number, dt = 0.1): number {
  let out = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    b.step(dt);
    for (const f of b.fires) if (f.ended) out++;
  }
  return out;
}

describe('FireBoard', () => {
  it('flares up to full, burns, dies down over the last seconds and goes out once', () => {
    const b = new FireBoard();
    const f = b.start(10, 20, false);
    expect(b.fresh).toBe(true);
    expect(f.strength).toBeLessThan(1);
    burn(b, 5);
    expect(f.strength).toBe(1);
    burn(b, FIRE_LIFE - 5 - FIRE_FADE / 2);
    expect(f.alive).toBe(true);
    expect(f.strength).toBeGreaterThan(0.3);
    expect(f.strength).toBeLessThan(0.7);
    expect(burn(b, FIRE_FADE)).toBe(1);
    expect(f.alive).toBe(false);
    expect(b.burning).toBe(0);
  });

  it('a blast next to a burning fire feeds it instead of lighting another', () => {
    const b = new FireBoard();
    const f = b.start(0, 0, false);
    burn(b, 60);
    const g = b.start(2, 2, true);
    expect(g).toBe(f);
    expect(b.fresh).toBe(false);
    expect(f.building).toBe(true);
    expect(f.life - f.age).toBeCloseTo(FIRE_LIFE, 5);
    expect(b.burning).toBe(1);
  });

  it('never burns more than the cap: past it the oldest gives its slot up', () => {
    const b = new FireBoard();
    for (let i = 0; i < MAX_FIRES; i++) {
      b.start(i * 20, 0, false);
      burn(b, 1);
    }
    const oldest = b.fires[0];
    const id = oldest.id;
    const f = b.start(500, 500, false);
    expect(b.burning).toBe(MAX_FIRES);
    expect(f).toBe(oldest);
    expect(f.id).not.toBe(id);
    expect(f.x).toBe(500);
  });

  it('a hose puts a full fire out in HOSE_SECONDS, two in half that, for good', () => {
    const b = new FireBoard();
    const f = b.start(0, 0, false);
    burn(b, 5);
    let t = 0;
    while (!b.hose(f, 0.1)) t += 0.1;
    expect(t).toBeGreaterThan(HOSE_SECONDS - 0.5);
    expect(t).toBeLessThan(HOSE_SECONDS + 0.2);
    expect(f.alive).toBe(false);
    expect(b.hose(f, 0.1)).toBe(false);

    const g = b.start(50, 0, false);
    burn(b, 5);
    t = 0;
    while (!b.hose(g, 0.1, 2)) t += 0.1;
    expect(t).toBeLessThan(HOSE_SECONDS / 2 + 0.2);
  });

  it('a fire hosed half down does not flare back up', () => {
    const b = new FireBoard();
    const f = b.start(0, 0, false);
    burn(b, 5);
    for (let i = 0; i < 30; i++) b.hose(f, 0.1);
    const s = f.strength;
    burn(b, 10);
    expect(f.strength).toBeLessThanOrEqual(s);
  });

  it('sends a truck to the nearest unclaimed fire that has burned a while and has a while left', () => {
    const b = new FireBoard();
    const far = b.start(100, 0, false);
    const near = b.start(30, 0, false);
    expect(b.toCall(0, 0, 160, 3, 15)).toBe(null);
    burn(b, 4);
    expect(b.toCall(0, 0, 160, 3, 15)).toBe(near);
    near.claimed = true;
    expect(b.toCall(0, 0, 160, 3, 15)).toBe(far);
    expect(b.toCall(0, 0, 50, 3, 15)).toBe(null);
    far.claimed = true;
    expect(b.toCall(0, 0, 160, 3, 15)).toBe(null);
    const late = b.start(-40, 0, false);
    burn(b, FIRE_LIFE - 10);
    expect(late.alive).toBe(true);
    // Nearly burnt out on its own: not worth a truck.
    expect(b.toCall(0, 0, 160, 3, 15)).toBe(null);
  });

  it('knows what is burning where, and drops and clears fires', () => {
    const b = new FireBoard();
    const f = b.start(10, 10, false);
    expect(b.burningNear(12, 10, 5)).toBe(true);
    expect(b.burningNear(20, 10, 5)).toBe(false);
    b.drop(f);
    expect(b.burningNear(12, 10, 5)).toBe(false);
    b.start(0, 0, true);
    b.clear();
    expect(b.burning).toBe(0);
  });
});

describe('wallFireAt', () => {
  const rects = [
    { minX: 10, minZ: 10, maxX: 30, maxZ: 30 },
    { minX: -30, minZ: -30, maxX: -10, maxZ: -10 },
  ];
  const at = { x: 0, z: 0 };

  it('puts the fire against the nearest wall, stepped out toward the blast', () => {
    expect(wallFireAt(rects, 8, 20, 4.5, 0.8, at)).toBe(true);
    expect(at.x).toBeCloseTo(9.2);
    expect(at.z).toBeCloseTo(20);
    expect(wallFireAt(rects, -5, -20, 4.5, 0.8, at)).toBe(false);
  });

  it('a blast inside a building comes out through its nearest face', () => {
    expect(wallFireAt(rects, 29, 15, 4.5, 0.8, at)).toBe(true);
    expect(at.x).toBeCloseTo(30.8);
    expect(at.z).toBeCloseTo(15);
  });
});

describe('towPose', () => {
  const truck: Pose = { x: 0, z: 0, heading: 0 };

  it('hangs the car nose-on behind the truck, a gap clear of it', () => {
    const car: Pose = { x: 0, z: -12, heading: 0 };
    const out = towPose(truck, 3.2, 2.3, car, { x: 0, z: 0, heading: 0 });
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(-(3.2 + TOW_GAP + 2.3));
    // Facing the truck (its nose on the hook).
    expect(out.heading).toBeCloseTo(0);
  });

  it('hooked by the back, the car trails facing away', () => {
    const car: Pose = { x: 0.5, z: -12, heading: 0 };
    const out = towPose(truck, 3.2, 2.3, car, { x: 0, z: 0, heading: 0 }, true);
    expect(Math.abs(Math.cos(out.heading) + 1)).toBeLessThan(0.01);
    expect(out.z).toBeCloseTo(-(3.2 + TOW_GAP + 2.3), 1);
  });

  it('trails through a turn instead of swinging wide', () => {
    const turned: Pose = { x: 0, z: 0, heading: Math.PI / 2 };
    const car: Pose = { x: 0, z: -6.1, heading: 0 };
    const out = towPose(turned, 3.2, 2.3, car, car);
    // The hook moved to the truck's new tail (-x); the car swings toward it from where it was.
    const hx = -(3.2 + TOW_GAP);
    expect(out.x).toBeGreaterThan(hx);
    expect(out.x).toBeLessThan(0);
    expect(out.z).toBeLessThan(0);
    expect(Math.hypot(out.x - hx, out.z)).toBeCloseTo(2.3);
  });

  it('winches smoothly from 0 to 1 and holds there', () => {
    expect(winch(-1)).toBe(0);
    expect(winch(0)).toBe(0);
    expect(winch(0.5)).toBeCloseTo(0.5);
    expect(winch(0.25)).toBeLessThan(0.25);
    expect(winch(1)).toBe(1);
    expect(winch(3)).toBe(1);
  });
});

describe('towPriority', () => {
  const base = { wrecked: false, burning: false, parked: false, distance: 50 };

  it('wrecks before abandoned cars before parked ones, nearer first', () => {
    const wreck = towPriority({ ...base, wrecked: true }, 110, true);
    const left = towPriority(base, 110, true);
    const parked = towPriority({ ...base, parked: true }, 110, true);
    expect(wreck).toBeGreaterThan(left);
    expect(left).toBeGreaterThan(parked);
    expect(parked).toBeGreaterThan(0);
    expect(towPriority({ ...base, distance: 20 }, 110, true)).toBeGreaterThan(left);
    // A far abandoned car still beats the nearest parked one.
    expect(towPriority({ ...base, distance: 109 }, 110, true)).toBeGreaterThan(towPriority({ ...base, parked: true, distance: 0 }, 110, true));
  });

  it('leaves burning cars, cars out of range, and parked cars unless the roll allows', () => {
    expect(towPriority({ ...base, wrecked: true, burning: true }, 110, true)).toBeLessThan(0);
    expect(towPriority({ ...base, distance: 111 }, 110, true)).toBeLessThan(0);
    expect(towPriority({ ...base, parked: true }, 110, false)).toBeLessThan(0);
    expect(towPriority(base, 110, false)).toBeGreaterThan(0);
  });
});

describe('AlarmBoard', () => {
  it('sounds in cycles for ALARM_SECONDS, then stops', () => {
    const b = new AlarmBoard<string>();
    const a = b.trigger('car', 1);
    let cycles = 0;
    let t = 0;
    while (a.alive && t < 60) {
      b.step(0.05);
      t += 0.05;
      if (a.cycled) cycles++;
    }
    expect(t).toBeCloseTo(ALARM_SECONDS, 1);
    expect(cycles).toBe(Math.ceil(ALARM_SECONDS / ALARM_CYCLE));
    expect(b.sounding('car')).toBe(false);
  });

  it('starts over when set off again, and stops when the car is driven off', () => {
    const b = new AlarmBoard<string>();
    const a = b.trigger('car', 0);
    for (let i = 0; i < 100; i++) b.step(0.1);
    expect(b.trigger('car', 2)).toBe(a);
    expect(a.left).toBe(ALARM_SECONDS);
    expect(a.pattern).toBe(0);
    expect(b.count).toBe(1);
    b.stop('car');
    expect(b.sounding('car')).toBe(false);
    expect(b.count).toBe(0);
  });

  it('never sounds more than the cap: the one closest to stopping makes way', () => {
    const b = new AlarmBoard<number>();
    for (let i = 0; i < MAX_ALARMS; i++) {
      b.trigger(i, i);
      b.step(1);
    }
    b.trigger(99, 0);
    expect(b.count).toBe(MAX_ALARMS);
    expect(b.sounding(0)).toBe(false);
    expect(b.sounding(99)).toBe(true);
    b.clear();
    expect(b.count).toBe(0);
  });

  it('flashes on and off, and picks a stable sound per spot', () => {
    expect(alarmLit(0)).toBe(true);
    expect(alarmLit(0.3)).toBe(false);
    expect(alarmLit(0.55)).toBe(true);
    const p = alarmPattern(12.3, -40.1);
    expect(alarmPattern(12.3, -40.1)).toBe(p);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(ALARM_PATTERNS);
    const seen = new Set<number>();
    for (let x = -50; x < 50; x += 3.1) seen.add(alarmPattern(x, x * 0.5));
    expect(seen.size).toBe(ALARM_PATTERNS);
  });
});

describe('onBody', () => {
  it('takes points on a car turned any way, plus a margin', () => {
    // Facing +x: 2.4 m long each way along x, 1 m across along z.
    const h = Math.PI / 2;
    expect(onBody(0, 0, h, 2.4, 1, 2.3, 0.5, 0)).toBe(true);
    expect(onBody(0, 0, h, 2.4, 1, 0.5, 2.3, 0)).toBe(false);
    expect(onBody(0, 0, h, 2.4, 1, 2.9, 0, 0.6)).toBe(true);
    expect(onBody(0, 0, h, 2.4, 1, 3.1, 0, 0.6)).toBe(false);
  });
});
