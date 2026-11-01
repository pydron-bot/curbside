import { describe, expect, it } from 'vitest';
import { CHASE_LEASH, CHASE_TIME, DogPack, FLEE_TIME, type Dog, type DogCar, type DogRunner, type DogWorld } from '../src/systems/dogs';
import { cornerPoint } from '../src/systems/crowd';
import { generateCity } from '../src/world/city';
import { random } from './helpers';

const DT = 1 / 60;

function setup(seed = 5) {
  const barks: Dog[] = [];
  const yelps: Dog[] = [];
  const pack = new DogPack(random(seed), { bark: (d) => barks.push(d), yelp: (d) => yelps.push(d) });
  return { pack, barks, yelps };
}

function world(runners: DogRunner[] = [], cars: DogCar[] = [], blocked: DogWorld['blocked'] = () => false): DogWorld {
  return { runners, cars, blocked };
}

/** A dog on block (8, 8)'s pavement, a third of the way along its north edge. */
function dogOn(pack: DogPack): Dog {
  const a = cornerPoint(8, 8, 0);
  const b = cornerPoint(8, 8, 1);
  return pack.add(a.x + (b.x - a.x) / 3, a.z, 8, 8, 1, 2);
}

describe('stray dogs', () => {
  it('trot round the pavement, stopping now and then to sniff', () => {
    const { pack } = setup();
    const d = dogOn(pack);
    const modes = new Set<string>();
    const x0 = d.x;
    let moved = 0;
    for (let i = 0; i < 60 * 60; i++) {
      const px = d.x;
      const pz = d.z;
      pack.step(DT, world());
      moved += Math.hypot(d.x - px, d.z - pz);
      modes.add(d.mode);
    }
    expect(modes.has('trot')).toBe(true);
    expect(modes.has('sniff')).toBe(true);
    expect(moved).toBeGreaterThan(30);
    expect(d.x).not.toBe(x0);
    // Still on or near a pavement line (within a lane's offset of some block's walk line).
    expect(d.stride).toBeGreaterThanOrEqual(0);
    expect(d.stride).toBeLessThan(1);
  });

  it('chase a runner going past, barking, for a short way, then give it up', () => {
    const { pack, barks } = setup();
    const d = dogOn(pack);
    d.calm = 0;
    const who = {};
    const r: DogRunner = { x: d.x + 4, z: d.z + 1, vx: 5.2, vz: 0, ref: who };
    pack.step(DT, world([r]));
    expect(d.mode).toBe('chase');
    expect(d.target).toBe(who);
    const fromX = d.x;
    let maxGap = 0;
    let steps = 0;
    while (d.mode === 'chase' && steps < 60 * 10) {
      r.x += r.vx * DT;
      pack.step(DT, world([r]));
      maxGap = Math.max(maxGap, Math.hypot(d.x - fromX, d.z - r.z));
      steps++;
    }
    expect(barks.length).toBeGreaterThan(3);
    expect(barks.every((b) => b === d)).toBe(true);
    // Not for long, and not far.
    expect(steps * DT).toBeLessThanOrEqual(CHASE_TIME + 0.1);
    expect(Math.abs(d.x - fromX)).toBeLessThan(CHASE_LEASH + 2);
    expect(d.mode).not.toBe('chase');
    // Closed on them: faster than a running passer-by.
    expect(r.x - d.x).toBeLessThan(4);
    // And not straight after them again.
    pack.step(DT, world([{ ...r, x: d.x + 2 }]));
    expect(d.mode).not.toBe('chase');
  });

  it('leave walkers alone', () => {
    const { pack, barks } = setup();
    const d = dogOn(pack);
    d.calm = 0;
    for (let i = 0; i < 120; i++) pack.step(DT, world([{ x: d.x + 2, z: d.z, vx: 1.4, vz: 0, ref: {} }]));
    expect(d.mode === 'chase').toBe(false);
    expect(barks.length).toBe(0);
  });

  it('a chase ends once the runner is gone', () => {
    const { pack } = setup();
    const d = dogOn(pack);
    d.calm = 0;
    const r: DogRunner = { x: d.x + 3, z: d.z, vx: 6, vz: 0, ref: {} };
    pack.step(DT, world([r]));
    expect(d.mode).toBe('chase');
    pack.step(DT, world([]));
    expect(d.mode).toBe('trot');
  });

  it('bolt from gunfire within earshot, yelping, and settle after', () => {
    const { pack, yelps } = setup();
    const d = dogOn(pack);
    const far = pack.add(d.x + 200, d.z, 11, 8, 1, 0);
    pack.startle(d.x - 6, d.z);
    expect(d.mode).toBe('flee');
    expect(far.mode).not.toBe('flee');
    expect(yelps).toEqual([d]);
    const x0 = d.x;
    for (let i = 0; i < 30; i++) pack.step(DT, world());
    expect(d.x).toBeGreaterThan(x0 + 2);
    for (let i = 0; i < 60 * FLEE_TIME; i++) pack.step(DT, world());
    expect(d.mode === 'trot' || d.mode === 'sniff').toBe(true);
  });

  it('a car going through knocks a dog over; it gets up and runs', () => {
    const { pack, yelps } = setup();
    const d = dogOn(pack);
    const parked: DogCar = { x: d.x + 1, z: d.z, vx: 0, vz: 0, reach: 2.3, half: 1 };
    const beside: DogCar = { x: d.x + 0.5, z: d.z + 2.5, vx: 12, vz: 0, reach: 2.3, half: 1 };
    pack.step(DT, world([], [parked, beside]));
    expect(d.mode).not.toBe('down');
    const car: DogCar = { x: d.x - 1.5, z: d.z, vx: 12, vz: 0, reach: 2.3, half: 1 };
    pack.step(DT, world([], [car]));
    expect(d.mode).toBe('down');
    expect(yelps).toContain(d);
    expect(d.awayX).toBeGreaterThan(0.9);
    let t = 0;
    while (d.mode === 'down' && t < 10) {
      pack.step(DT, world());
      t += DT;
    }
    expect(t).toBeGreaterThan(2);
    expect(d.mode).toBe('flee');
  });

  it('a blast or a punch knocks over the dogs it reaches', () => {
    const { pack } = setup();
    const d = dogOn(pack);
    expect(pack.knock(d.x + 0.5, d.z, 1)).toBe(1);
    expect(d.mode).toBe('down');
    expect(pack.knock(d.x, d.z, 1)).toBe(0);
  });

  it('do not run through walls', () => {
    const city = generateCity(1337);
    const blocked = (x: number, z: number, r: number) => city.obstacles.some((o) => x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r);
    const { pack } = setup(9);
    const dogs: Dog[] = [];
    for (let k = 0; k < 6; k++) {
      const a = cornerPoint(3 + k, 5, 0);
      const d = pack.add(a.x + 6, a.z, 3 + k, 5, 1, k);
      if (!blocked(d.x, d.z, 0.35)) dogs.push(d);
    }
    // Scared toward the block's middle (into its buildings), over and over.
    for (let i = 0; i < 60 * 20; i++) {
      if (i % 120 === 0) for (const d of dogs) pack.startle(d.x, d.z - 3, 10);
      pack.step(DT, world([], [], blocked));
      for (const d of dogs) expect(blocked(d.x, d.z, 0.1), `${d.x},${d.z}`).toBe(false);
    }
  });

  it('remove and clear hand the dogs back for reuse', () => {
    const { pack } = setup();
    const d = dogOn(pack);
    pack.remove(d);
    expect(pack.dogs.length).toBe(0);
    const e = dogOn(pack);
    expect(e).toBe(d);
    pack.clear();
    expect(pack.dogs.length).toBe(0);
  });
});
