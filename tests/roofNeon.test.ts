import { describe, expect, it } from 'vitest';
import { SIGN_REACH, planBuildings } from '../src/world/buildingPlans';
import { blockInterior, BLOCK_SIZE, HALF_EXTENT, generateCity } from '../src/world/city';

describe('rooftop neon (BuildingPlan.roofNeon)', () => {
  const city = generateCity(1337);
  const plans = planBuildings(city);
  const lit = (district: string) => {
    const idx = city.buildings.map((b, i) => [b, i] as const).filter(([b]) => b.district === district);
    return idx.filter(([, i]) => plans[i].roofNeon).length / Math.max(1, idx.length);
  };

  it('lights the nightlife quarters most and the quiet ones least', () => {
    expect(lit('arts')).toBeGreaterThan(0.25);
    expect(lit('downtown')).toBeGreaterThan(0.12);
    expect(lit('arts')).toBeGreaterThan(lit('residential') * 3);
    expect(lit('industrial')).toBeLessThan(0.1);
  });

  it('puts tubes only on faces that front a street', () => {
    city.buildings.forEach((b, i) => {
      const n = plans[i].roofNeon;
      if (!n) return;
      expect(n.edges).toBeGreaterThan(0);
      const bx = Math.floor(((b.minX + b.maxX) / 2 + HALF_EXTENT) / BLOCK_SIZE);
      const bz = Math.floor(((b.minZ + b.maxZ) / 2 + HALF_EXTENT) / BLOCK_SIZE);
      const inner = blockInterior(bx, bz);
      const street = [b.minZ - inner.minZ < 2, inner.maxX - b.maxX < 2, inner.maxZ - b.maxZ < 2, b.minX - inner.minX < 2];
      for (let s = 0; s < 4; s++) if (n.edges & (1 << s)) expect(street[s]).toBe(true);
    });
  });

  it('keeps signs on the roof edge, clear of the rooftop kit', () => {
    let signs = 0;
    city.buildings.forEach((b, i) => {
      const sign = plans[i].roofNeon?.sign;
      if (!sign) return;
      signs++;
      const alongX = sign.side === 0 || sign.side === 2;
      expect(sign.from).toBeGreaterThanOrEqual((alongX ? b.minX : b.minZ) + 1 - 1e-9);
      expect(sign.to).toBeLessThanOrEqual((alongX ? b.maxX : b.maxZ) - 1 + 1e-9);
      expect(sign.to - sign.from).toBeGreaterThanOrEqual(2.5);
      const foot = alongX
        ? { minX: sign.from, maxX: sign.to, minZ: sign.side === 0 ? b.minZ : b.maxZ - SIGN_REACH, maxZ: sign.side === 0 ? b.minZ + SIGN_REACH : b.maxZ }
        : { minZ: sign.from, maxZ: sign.to, minX: sign.side === 3 ? b.minX : b.maxX - SIGN_REACH, maxX: sign.side === 3 ? b.minX + SIGN_REACH : b.maxX };
      for (const p of plans[i].props) {
        const clear = p.maxX <= foot.minX || foot.maxX <= p.minX || p.maxZ <= foot.minZ || foot.maxZ <= p.minZ;
        expect(clear).toBe(true);
      }
    });
    expect(signs).toBeGreaterThan(10);
  });

  it('is the same every time for the same city', () => {
    expect(planBuildings(city).map((p) => p.roofNeon)).toEqual(plans.map((p) => p.roofNeon));
  });
});
