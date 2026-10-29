import { describe, expect, it } from 'vitest';
import { createVehicleState } from '../src/entities/vehicle';
import { blockAt, cornerPoint, scare, spawnPed, stepCrowdPed } from '../src/systems/crowd';
import { collidePedStatic } from '../src/systems/physics';
import { ROAD_WIDTH, generateCity } from '../src/world/city';
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
    for (let i = 0; i < 60 * 240; i++) {
      const before = { x: p.s.x, z: p.s.z };
      stepCrowdPed(p, [], rand, DT);
      collidePedStatic(p.s, grid);
      if (Math.hypot(p.s.x - before.x, p.s.z - before.z) < 1e-4) stuckFrames++;
      blocks.add(`${p.bx},${p.bz}`);
    }
    expect(blocks.size).toBeGreaterThan(2);
    expect(stuckFrames).toBeLessThan(60 * 5);
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

  it('scare sends a ped running away from the source', () => {
    const rand = random(2);
    const p = spawnPed(8, 8, 0, 0.5, rand);
    const x0 = p.s.x;
    scare(p, x0 - 1, p.s.z);
    for (let i = 0; i < 60; i++) stepCrowdPed(p, [], rand, DT);
    expect(p.s.x).toBeGreaterThan(x0 + 2);
  });
});
