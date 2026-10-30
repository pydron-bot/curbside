import { describe, expect, it } from 'vitest';
import { HALF_EXTENT, generateCity } from '../src/world/city';
import { inShop, placeSprayShops, placeStation, shopRect } from '../src/world/landmarks';

const city = generateCity(1337);

describe('landmarks', () => {
  const shops = placeSprayShops(city);

  it('puts four Pay ’n’ Spray bays in different blocks, one per quarter of the city', () => {
    expect(shops).toHaveLength(4);
    const quarters = new Set(shops.map((s) => `${Math.sign(s.x)},${Math.sign(s.z)}`));
    expect(quarters.size).toBe(4);
    for (const s of shops) {
      expect(Math.abs(s.x)).toBeLessThan(HALF_EXTENT);
      expect(Math.abs(s.z)).toBeLessThan(HALF_EXTENT);
    }
  });

  it('bays are clear of buildings and trees, and open onto the road', () => {
    for (const s of shops) {
      const r = shopRect(s);
      expect(city.obstacles.some((o) => o.minX < r.maxX && o.maxX > r.minX && o.minZ < r.maxZ && o.maxZ > r.minZ)).toBe(false);
      // Back out the way you came in: 12 m behind the bay's mouth is road (no obstacle on the way).
      const bx = s.x - Math.sin(s.heading) * (s.halfLength + 8);
      const bz = s.z - Math.cos(s.heading) * (s.halfLength + 8);
      expect(city.obstacles.some((o) => bx > o.minX && bx < o.maxX && bz > o.minZ && bz < o.maxZ)).toBe(false);
    }
  });

  it('knows what is inside a bay', () => {
    const s = shops[0];
    expect(inShop(s, s.x, s.z)).toBe(true);
    expect(inShop(s, s.x + Math.sin(s.heading) * (s.halfLength - 0.5), s.z + Math.cos(s.heading) * (s.halfLength - 0.5))).toBe(true);
    expect(inShop(s, s.x + 20, s.z + 20)).toBe(false);
  });

  it('puts the police station on open pavement', () => {
    const st = placeStation(city);
    expect(city.obstacles.some((o) => st.x > o.minX - 0.5 && st.x < o.maxX + 0.5 && st.z > o.minZ - 0.5 && st.z < o.maxZ + 0.5)).toBe(false);
    expect(Math.hypot(st.x, st.z)).toBeLessThan(300);
  });
});
