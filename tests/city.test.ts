import { describe, expect, it } from 'vitest';
import { PLAYER_ON_FOOT, createPedState, stepPedestrian } from '../src/entities/pedestrian';
import { SEDAN, createVehicleState, speed, stepVehicle } from '../src/entities/vehicle';
import { collidePedStatic, collideVehicleStatic, collideVehicles } from '../src/systems/physics';
import {
  BLOCK_SIZE,
  HALF_EXTENT,
  ROAD_WIDTH,
  SIDEWALK,
  WORLD_LIMIT,
  generateCity,
  type Rect,
} from '../src/world/city';
import { StaticGrid, circleVsRect } from '../src/world/collision';

const DT = 1 / 60;
const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

describe('city generator', () => {
  const city = generateCity(1337);

  it('is deterministic per seed', () => {
    expect(generateCity(1337)).toEqual(city);
    expect(generateCity(42).buildings).not.toEqual(city.buildings);
  });

  it('fills most blocks with buildings and has some parks', () => {
    expect(city.blocks).toHaveLength(256);
    expect(city.buildings.length).toBeGreaterThan(400);
    expect(city.trees.length).toBeGreaterThan(20);
  });

  it('keeps every building off the roads and sidewalks', () => {
    const clearance = ROAD_WIDTH / 2 + SIDEWALK;
    for (const b of city.buildings) {
      expect(b.maxX).toBeGreaterThan(b.minX);
      expect(b.maxZ).toBeGreaterThan(b.minZ);
      // Distance from any road centreline (multiples of BLOCK_SIZE) must clear road + sidewalk.
      for (const v of [b.minX, b.maxX]) {
        const toLine = Math.abs(((v % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE);
        expect(Math.min(toLine, BLOCK_SIZE - toLine)).toBeGreaterThanOrEqual(clearance - 1e-9);
      }
      for (const v of [b.minZ, b.maxZ]) {
        const toLine = Math.abs(((v % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE);
        expect(Math.min(toLine, BLOCK_SIZE - toLine)).toBeGreaterThanOrEqual(clearance - 1e-9);
      }
      expect(Math.abs(b.minX)).toBeLessThanOrEqual(HALF_EXTENT);
    }
  });

  it('never overlaps buildings', () => {
    // One expect for the whole list: 500k expect() calls took ~4 s and timed out under load.
    const bs = city.buildings;
    const clashes: Array<[number, number]> = [];
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) if (overlaps(bs[i], bs[j])) clashes.push([i, j]);
    }
    expect(clashes).toEqual([]);
  });

  it('keeps building heights under the on-foot camera', () => {
    for (const b of city.buildings) expect(b.height).toBeLessThanOrEqual(12);
  });
});

describe('collision', () => {
  it('circleVsRect pushes out of the nearest side, including from inside', () => {
    const box = { minX: 0, minZ: 0, maxX: 10, maxZ: 10 };
    expect(circleVsRect(-0.5, 5, 1, box)).toMatchObject({ nx: -1, nz: 0 });
    expect(circleVsRect(-2, 5, 1, box)).toBeNull();
    const inside = circleVsRect(9, 5, 1, box)!;
    expect(inside).toMatchObject({ nx: 1, nz: 0 });
    expect(inside.depth).toBeCloseTo(2);
  });

  it('a car driven into a wall stops at it instead of passing through', () => {
    const wall = { minX: -50, minZ: -40, maxX: 50, maxZ: -30 };
    const grid = new StaticGrid([wall]);
    const s = createVehicleState(0, 0); // facing -Z, toward the wall
    for (let i = 0; i < 60 * 6; i++) {
      stepVehicle(s, { throttle: 1, steer: 0, handbrake: false }, SEDAN, DT);
      collideVehicleStatic(s, grid);
    }
    expect(s.z).toBeGreaterThan(-30); // never inside
    expect(s.z - -30).toBeLessThan(3.5); // pressed up against it
  });

  it('a ped walking into a wall stops', () => {
    const grid = new StaticGrid([{ minX: 2, minZ: -5, maxX: 4, maxZ: 5 }]);
    const p = createPedState();
    for (let i = 0; i < 120; i++) {
      stepPedestrian(p, { x: 1, y: 0, sprint: true }, PLAYER_ON_FOOT, DT);
      collidePedStatic(p, grid);
    }
    expect(p.x).toBeLessThanOrEqual(2 - 0.35 + 1e-6);
  });

  it('the world is walled in', () => {
    const grid = new StaticGrid(generateCity().obstacles);
    const s = createVehicleState(0, -WORLD_LIMIT + 30);
    for (let i = 0; i < 60 * 5; i++) {
      stepVehicle(s, { throttle: 1, steer: 0, handbrake: false }, SEDAN, DT);
      collideVehicleStatic(s, grid);
    }
    expect(s.z).toBeGreaterThan(-WORLD_LIMIT);
  });

  it('ramming a parked car shoves it and slows the rammer', () => {
    const a = createVehicleState(0, 10); // facing -Z
    const b = createVehicleState(0, -10);
    for (let i = 0; i < 60 * 3; i++) {
      stepVehicle(a, { throttle: 1, steer: 0, handbrake: false }, SEDAN, DT);
      stepVehicle(b, { throttle: 0, steer: 0, handbrake: false }, SEDAN, DT);
      collideVehicles(a, b);
    }
    expect(speed(b)).toBeGreaterThan(0.5); // got pushed
    expect(b.z).toBeLessThan(-10);
    expect(a.z).toBeGreaterThan(b.z + 3.5); // never interpenetrated
  });
});
