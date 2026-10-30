import { describe, expect, it } from 'vitest';
import {
  HELI_FROM,
  SPAWN_RANGE,
  SPOT_RADIUS,
  lineOfSight,
  policeSpawnPoint,
  roadblockSpot,
  sees,
  stepHelicopter,
  type Helicopter,
} from '../src/systems/police';
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, generateCity, type Rect } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const city = generateCity(1337);
const grid = new StaticGrid(city.obstacles);
const DT = 1 / 60;

function viewAround(x: number, z: number, hw = 30, hh = 14): Rect {
  return { minX: x - hw, maxX: x + hw, minZ: z - hh, maxZ: z + hh };
}

describe('line of sight', () => {
  const b = city.buildings.find((r) => r.maxX - r.minX > 12 && r.maxZ - r.minZ > 12)!;
  const midZ = (b.minZ + b.maxZ) / 2;

  it('a building blocks the view through it', () => {
    expect(lineOfSight(grid, b.minX - 5, midZ, b.maxX + 5, midZ)).toBe(false);
  });

  it('down an open road there is nothing in the way', () => {
    // The x = 0 road runs the length of the city.
    expect(lineOfSight(grid, 0, -200, 0, 200)).toBe(true);
  });

  it('sees always up close, never beyond range, and needs a clear line in between', () => {
    expect(sees(grid, b.minX - 5, midZ, b.maxX + 5, midZ, 1000, 2000)).toBe(true);
    expect(sees(grid, 0, -100, 0, 100, 10, 300)).toBe(true);
    expect(sees(grid, 0, -100, 0, 100, 10, 100)).toBe(false);
    expect(sees(grid, b.minX - 5, midZ, b.maxX + 5, midZ, 5, 1000)).toBe(false);
  });
});

describe('police spawns', () => {
  it('places units on a lane, out of view, in the spawn ring, heading the player’s way', () => {
    const rand = random(4);
    const view = viewAround(20, 30);
    let placed = 0;
    for (let i = 0; i < 60; i++) {
      const s = policeSpawnPoint(20, 30, 15, 0, view, rand, () => false);
      if (!s) continue;
      placed++;
      const d = Math.hypot(s.x - 20, s.z - 30);
      expect(d).toBeGreaterThan(SPAWN_RANGE[0] * 0.85);
      expect(d).toBeLessThan(SPAWN_RANGE[1] * 1.15);
      expect(s.x > view.minX - 8 && s.x < view.maxX + 8 && s.z > view.minZ - 8 && s.z < view.maxZ + 8).toBe(false);
      // On a road band.
      const offX = Math.abs(s.x - Math.round(s.x / BLOCK_SIZE) * BLOCK_SIZE);
      const offZ = Math.abs(s.z - Math.round(s.z / BLOCK_SIZE) * BLOCK_SIZE);
      expect(Math.min(offX, offZ)).toBeLessThan(ROAD_WIDTH / 2);
      // Facing (roughly) toward the player: moving along the heading closes the gap.
      const closing = (Math.sin(s.heading) * (20 - s.x) + Math.cos(s.heading) * (30 - s.z)) / d;
      expect(closing).toBeGreaterThan(-0.3);
    }
    expect(placed).toBeGreaterThan(50);
  });

  it('respects a crowded check', () => {
    expect(policeSpawnPoint(0, 0, 0, 0, viewAround(0, 0), random(1), () => true)).toBeNull();
  });
});

describe('roadblocks', () => {
  it('blocks the road ahead of a car speeding along it, out of view, mid-block', () => {
    const spot = roadblockSpot(0, 100, 0, -30, viewAround(0, 100))!;
    expect(spot).not.toBeNull();
    expect(spot.dirZ).toBe(-1);
    for (const c of spot.cars) {
      expect(Math.abs(c.x)).toBeLessThan(ROAD_WIDTH / 2);
      expect(c.z).toBeLessThan(100 - 90);
      // Across the road: the car points along x (± a slight angle).
      expect(Math.abs(Math.sin(c.heading))).toBeGreaterThan(0.9);
    }
    // Mid-block, not in a junction.
    const z = spot.cars[0].z;
    const fromJunction = Math.abs(z - Math.round(z / BLOCK_SIZE) * BLOCK_SIZE);
    expect(fromJunction).toBeGreaterThan(20);
  });

  it('not when slow, driving diagonally, off the road or about to leave the city', () => {
    expect(roadblockSpot(0, 100, 0, -6, viewAround(0, 100))).toBeNull();
    expect(roadblockSpot(0, 100, 20, -20, viewAround(0, 100))).toBeNull();
    expect(roadblockSpot(30, 100, 0, -30, viewAround(30, 100))).toBeNull();
    expect(roadblockSpot(0, -HALF_EXTENT + 60, 0, -30, viewAround(0, -HALF_EXTENT + 60))).toBeNull();
  });
});

describe('helicopter', () => {
  function heli(x: number, z: number): Helicopter {
    return { active: true, leaving: false, x, z, vx: 0, vz: 0, heading: 0, spotX: x, spotZ: z, sweep: 0, sees: false };
  }

  it('flies to a still target and puts the light on them', () => {
    const h = heli(150, 0);
    let seenAt = -1;
    for (let t = 0; t < 20; t += DT) {
      stepHelicopter(h, 0, 0, 0, 0, 0, 0, DT);
      if (h.sees && seenAt < 0) seenAt = t;
    }
    expect(seenAt).toBeGreaterThan(0);
    expect(seenAt).toBeLessThan(10);
    expect(Math.hypot(h.spotX, h.spotZ)).toBeLessThan(SPOT_RADIUS);
  });

  it('can be outrun by a fast car', () => {
    const h = heli(0, 0);
    let px = 0;
    for (let t = 0; t < 30; t += DT) {
      px += 34 * DT;
      stepHelicopter(h, px, 0, 34, 0, px, 0, DT);
    }
    expect(px - h.x).toBeGreaterThan(60);
    expect(h.sees).toBe(false);
  });

  it('turns up at five stars', () => {
    expect(HELI_FROM).toBe(5);
  });
});
