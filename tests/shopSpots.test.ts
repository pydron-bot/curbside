import { describe, expect, it } from 'vitest';
import { generateCity } from '../src/world/city';
import { AWNING_DEPTH, planBuildings } from '../src/world/buildingPlans';
import { SpotGrid, inFrontOf, shopSpots } from '../src/world/shopSpots';

describe('shop spots', () => {
  const city = generateCity(1337);
  const plans = planBuildings(city);
  const spots = shopSpots(city, plans);

  it('one under every awning, on the pavement in front of its shop', () => {
    const awnings = plans.reduce((n, p) => n + p.shopfronts.filter((s) => s.awning).length, 0);
    expect(spots.length).toBe(awnings);
    expect(spots.length).toBeGreaterThan(100);
    // The same plans as the look's: working them out again gives the same spots.
    expect(shopSpots(city)).toEqual(spots);
    for (const s of spots) {
      expect(city.obstacles.some((o) => s.x > o.minX && s.x < o.maxX && s.z > o.minZ && s.z < o.maxZ)).toBe(false);
      // A step out from the wall it faces away from, under the awning.
      const wall = { x: s.x - s.outX * AWNING_DEPTH, z: s.z - s.outZ * AWNING_DEPTH };
      expect(city.buildings.some((b) => wall.x >= b.minX - 0.01 && wall.x <= b.maxX + 0.01 && wall.z >= b.minZ - 0.01 && wall.z <= b.maxZ + 0.01)).toBe(true);
      expect(s.half).toBeGreaterThan(0.5);
    }
  });

  it('neon spots are mostly in the nightlife districts', () => {
    const neon = spots.filter((s) => s.neon);
    expect(neon.length).toBeGreaterThan(10);
    const arts = neon.filter((s) => s.district === 'arts').length;
    expect(arts / neon.length).toBeGreaterThan(0.4);
    expect(neon.some((s) => s.district === 'industrial')).toBe(false);
  });

  it('the grid finds the nearest spot that suits, same as a scan', () => {
    const grid = new SpotGrid(spots);
    for (const [x, z] of [
      [0, 0],
      [200, -150],
      [-300, 260],
      [480, 480],
    ]) {
      const ok = (i: number) => spots[i].neon || i % 2 === 0;
      const got = grid.nearest(x, z, 60, ok);
      let want = -1;
      let best = 60 * 60;
      spots.forEach((s, i) => {
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < best && ok(i)) {
          best = d;
          want = i;
        }
      });
      expect(got).toBe(want);
    }
    expect(grid.nearest(5000, 5000, 30, () => true)).toBe(-1);
  });

  it('in front of: along its pavement, not round the corner or inside', () => {
    const s = spots[0];
    expect(inFrontOf(s, s.x + s.outX * 2 + s.alongX * 8, s.z + s.outZ * 2 + s.alongZ * 8, 12)).toBe(true);
    expect(inFrontOf(s, s.x + s.alongX * 14, s.z + s.alongZ * 14, 12)).toBe(false);
    expect(inFrontOf(s, s.x - s.outX * 3, s.z - s.outZ * 3, 12)).toBe(false);
    expect(inFrontOf(s, s.x + s.outX * 9, s.z + s.outZ * 9, 12)).toBe(false);
  });
});
