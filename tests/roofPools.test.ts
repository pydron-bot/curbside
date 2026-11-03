import { describe, expect, it } from 'vitest';
import { planBuildings } from '../src/world/buildingPlans';
import { generateCity } from '../src/world/city';

describe('rooftop pools', () => {
  const city = generateCity(1337);
  const plans = planBuildings(city);
  const pools = plans.map((p, i) => [p.roofPool, i] as const).filter(([p]) => p);

  it('a good few, on flat roofs, none in the docks', () => {
    expect(pools.length).toBeGreaterThan(15);
    for (const [, i] of pools) {
      expect(['terracotta', 'helipad', 'garden']).not.toContain(plans[i].roof);
      expect(city.buildings[i].district).not.toBe('industrial');
    }
  });

  it('sit inside the roof, clear of the edge, the rooftop kit and the roof sign', () => {
    for (const [p, i] of pools) {
      const b = city.buildings[i];
      expect(p!.minX).toBeGreaterThanOrEqual(b.minX + 1.4 - 1e-9);
      expect(p!.maxX).toBeLessThanOrEqual(b.maxX - 1.4 + 1e-9);
      expect(p!.minZ).toBeGreaterThanOrEqual(b.minZ + 1.4 - 1e-9);
      expect(p!.maxZ).toBeLessThanOrEqual(b.maxZ - 1.4 + 1e-9);
      for (const k of plans[i].props) {
        const clear = k.maxX + 1 <= p!.minX || p!.maxX + 1 <= k.minX || k.maxZ + 1 <= p!.minZ || p!.maxZ + 1 <= k.minZ;
        expect(clear).toBe(true);
      }
    }
  });
});
