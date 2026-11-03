import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE, HALF_EXTENT, generateCity, isCarPark, lotBytes } from '../src/world/city';
import { SPRINKLER_CYCLE, SPRINKLER_ON, planParkWater, sprinklerAngle, sprinklerOn } from '../src/world/parkWater';

describe('park water', () => {
  const city = generateCity(1337);
  const { fountains, sprinklers } = planParkWater(city);
  const blockAt = (x: number, z: number) =>
    city.blocks.find((b) => b.bx === Math.floor((x + HALF_EXTENT) / BLOCK_SIZE) && b.bz === Math.floor((z + HALF_EXTENT) / BLOCK_SIZE))!;

  it('puts a fountain in the middle of every open plaza and none in car parks', () => {
    const bytes = lotBytes(city);
    const open = city.blocks.filter((b, i) => b.kind === 'plaza' && !isCarPark(city, bytes, i));
    expect(fountains.length).toBe(open.length);
    for (const f of fountains) {
      const b = blockAt(f.x, f.z);
      expect(b.kind).toBe('plaza');
      expect(f.x).toBeCloseTo(-HALF_EXTENT + (b.bx + 0.5) * BLOCK_SIZE);
      expect(f.z).toBeCloseTo(-HALF_EXTENT + (b.bz + 0.5) * BLOCK_SIZE);
    }
  });

  it('puts sprinklers on park grass, clear of trees, most in the residential streets', () => {
    expect(sprinklers.length).toBeGreaterThan(8);
    for (const s of sprinklers) {
      expect(blockAt(s.x, s.z).kind).toBe('park');
      for (const t of city.trees) expect(Math.hypot(t.x - s.x, t.z - s.z)).toBeGreaterThanOrEqual(2);
    }
    const parks = city.blocks.filter((b) => b.kind === 'park');
    const share = (d: string) => {
      const ps = parks.filter((b) => b.district === d);
      return ps.filter((b) => sprinklers.some((s) => blockAt(s.x, s.z) === b)).length / Math.max(1, ps.length);
    };
    expect(share('residential')).toBeGreaterThan(share('industrial'));
  });

  it('runs sprinklers part of each cycle and sweeps them about their facing', () => {
    const s = sprinklers[0];
    let on = 0;
    for (let t = 0; t < SPRINKLER_CYCLE; t += 0.5) if (sprinklerOn(s.phase, t)) on += 0.5;
    expect(on).toBeCloseTo(SPRINKLER_ON, 0);
    for (let t = 0; t < 20; t += 0.3) expect(Math.abs(sprinklerAngle(s, t) - s.facing)).toBeLessThanOrEqual(1.14);
  });

  it('keeps sprinklers clear of anything built in the parks', () => {
    const s = sprinklers[0];
    const blocked = planParkWater(city, [{ minX: s.x - 1, minZ: s.z - 1, maxX: s.x + 1, maxZ: s.z + 1 }]).sprinklers;
    // The rest stay exactly where they were.
    expect(blocked).toEqual(sprinklers.slice(1));
  });

  it('is the same every time for the same city', () => {
    expect(planParkWater(generateCity(1337))).toEqual({ fountains, sprinklers });
  });
});
