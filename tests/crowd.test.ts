import { describe, expect, it } from 'vitest';
import { createVehicleState } from '../src/entities/vehicle';
import { blockAt, cornerPoint, scare, spawnPed, stepCrowdPed } from '../src/systems/crowd';
import { collidePedStatic } from '../src/systems/physics';
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, generateCity } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const DT = 1 / 60;

describe('crowd', () => {
  it('corner points sit on the sidewalk, not the road or the lot', () => {
    const p = cornerPoint(8, 8, 0); // block whose NW corner is the origin intersection
    expect(p.x).toBeCloseTo(ROAD_WIDTH / 2 + 1.5);
    expect(p.z).toBeCloseTo(ROAD_WIDTH / 2 + 1.5);
    expect(blockAt(p.x, p.z)).toEqual({ bx: 8, bz: 8 });
  });

  it('walks between corners and crosses streets over time', () => {
    const rand = random(5);
    const grid = new StaticGrid(generateCity().obstacles);
    const p = spawnPed(8, 8, 0, 0.5, rand);
    const blocks = new Set<string>();
    let stuckFrames = 0;
    for (let i = 0; i < 60 * 600; i++) {
      const before = { x: p.s.x, z: p.s.z };
      stepCrowdPed(p, [], rand, DT);
      collidePedStatic(p.s, grid);
      if (Math.hypot(p.s.x - before.x, p.s.z - before.z) < 1e-4) stuckFrames++;
      blocks.add(`${p.bx},${p.bz}`);
    }
    expect(blocks.size).toBeGreaterThan(2);
    expect(stuckFrames).toBeLessThan(60 * 12);
  });

  it('dodges a speeding car and gets knocked down if hit', () => {
    const rand = random(1);
    const p = spawnPed(8, 8, 0, 0.5, rand);
    const car = createVehicleState(p.s.x, p.s.z + 12); // facing -Z, straight at the ped
    car.vz = -15;
    stepCrowdPed(p, [car], rand, DT);
    expect(p.mode).toBe('flee');

    const q = spawnPed(8, 8, 0, 0.5, rand);
    const hitter = createVehicleState(q.s.x, q.s.z + 2);
    hitter.vz = -12;
    stepCrowdPed(q, [hitter], rand, DT);
    expect(q.mode).toBe('down');
    for (let i = 0; i < 60 * 3.2; i++) stepCrowdPed(q, [], rand, DT);
    expect(q.mode).toBe('flee'); // got up and ran
  });

  it('reports which car knocked them down, not just any car nearby', () => {
    const rand = random(3);
    const q = spawnPed(8, 8, 0, 0.5, rand);
    // A parked car right beside them (the player's, say) and another that runs them over.
    const parked = createVehicleState(q.s.x + 3.4, q.s.z);
    const hitter = createVehicleState(q.s.x, q.s.z + 2);
    hitter.vz = -18;
    const e = stepCrowdPed(q, [parked, hitter], rand, DT);
    expect(q.mode).toBe('down');
    expect(e).toEqual({ kind: 'struck', car: hitter });
    // Lying there afterwards isn't a fresh hit.
    expect(stepCrowdPed(q, [parked], rand, DT)).toBeNull();
  });

  it('scare sends a ped running away from the source', () => {
    const rand = random(2);
    const p = spawnPed(8, 8, 0, 0.5, rand);
    const x0 = p.s.x;
    scare(p, x0 - 1, p.s.z);
    for (let i = 0; i < 60; i++) stepCrowdPed(p, [], rand, DT);
    expect(p.s.x).toBeGreaterThan(x0 + 2);
  });
});

describe('fighting back', () => {
  const DT2 = 1 / 60;
  const on = (x: number, z: number) => ({ x, z, inCar: false, alive: true });

  it('a provoked fighter closes in and throws punches', async () => {
    const { provoke } = await import('../src/systems/crowd');
    const rand = random(9);
    const p = spawnPed(8, 8, 0, 0.5, rand);
    p.temper = 'fighter';
    const target = on(p.s.x + 8, p.s.z);
    provoke(p, target.x, target.z);
    let punches = 0;
    for (let i = 0; i < 60 * 5; i++) if (stepCrowdPed(p, [], rand, DT2, target)?.kind === 'punch') punches++;
    expect(Math.hypot(p.s.x - target.x, p.s.z - target.z)).toBeLessThan(1.5);
    expect(punches).toBeGreaterThanOrEqual(2);
  });

  it('an armed ped keeps distance and shoots toward the target', async () => {
    const { provoke } = await import('../src/systems/crowd');
    const rand = random(10);
    const p = spawnPed(8, 8, 0, 0.5, rand);
    p.temper = 'armed';
    const target = on(p.s.x + 3, p.s.z);
    provoke(p, target.x, target.z);
    const shots = [];
    for (let i = 0; i < 60 * 4; i++) {
      const e = stepCrowdPed(p, [], rand, DT2, target);
      if (e?.kind === 'shoot') shots.push(e);
    }
    expect(shots.length).toBeGreaterThanOrEqual(2);
    expect(shots[0].dirX).toBeGreaterThan(0.9); // aimed at the target (+X)
    expect(Math.hypot(p.s.x - target.x, p.s.z - target.z)).toBeGreaterThan(5); // backed off
  });

  it('calm peds just run, and hostiles give up when you are far away', async () => {
    const { provoke } = await import('../src/systems/crowd');
    const rand = random(11);
    const calm = spawnPed(8, 8, 0, 0.5, rand);
    calm.temper = 'calm';
    provoke(calm, calm.s.x - 1, calm.s.z);
    expect(calm.mode).toBe('flee');

    const angry = spawnPed(8, 8, 0, 0.5, rand);
    angry.temper = 'fighter';
    provoke(angry, angry.s.x, angry.s.z);
    stepCrowdPed(angry, [], rand, DT2, on(angry.s.x + 100, angry.s.z));
    expect(angry.mode).toBe('walk');
  });

  it('someone knocked down while provoked turns hostile on getting up', async () => {
    const { provoke, knockDown } = await import('../src/systems/crowd');
    const rand = random(12);
    const p = spawnPed(8, 8, 0, 0.5, rand);
    p.temper = 'fighter';
    knockDown(p, p.s.x - 1, p.s.z);
    provoke(p, p.s.x - 1, p.s.z);
    const target = on(p.s.x - 2, p.s.z);
    for (let i = 0; i < 60 * 3; i++) stepCrowdPed(p, [], rand, DT2, target);
    expect(p.mode).toBe('fight');
  });
});

describe('sidewalk corners', () => {
  it('cornerPoint walks a block clockwise from (left, top) and writes into a reused point', () => {
    const inset = ROAD_WIDTH / 2 + SIDEWALK / 2;
    const x0 = -HALF_EXTENT + 3 * BLOCK_SIZE;
    const z0 = -HALF_EXTENT + 5 * BLOCK_SIZE;
    const lo = (v: number) => v + inset;
    const hi = (v: number) => v + BLOCK_SIZE - inset;
    const out = { x: 0, z: 0 };
    const want = [
      [lo(x0), lo(z0)],
      [hi(x0), lo(z0)],
      [hi(x0), hi(z0)],
      [lo(x0), hi(z0)],
    ];
    for (let c = 0; c < 8; c++) {
      expect(cornerPoint(3, 5, c, out)).toBe(out);
      expect([out.x, out.z]).toEqual(want[c & 3]);
    }
  });
});
