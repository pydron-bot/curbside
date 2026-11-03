import { describe, expect, it } from 'vitest';
import { planBuildings } from '../src/world/buildingPlans';
import { generateCity } from '../src/world/city';
import { planSearchlights, searchlightHeading } from '../src/world/searchlights';

describe('downtown searchlights', () => {
  const city = generateCity(1337);
  const plans = planBuildings(city);
  const lights = planSearchlights(city.buildings, plans);

  it('stand on a few tall downtown roofs, well apart', () => {
    expect(lights.length).toBeGreaterThanOrEqual(2);
    expect(lights.length).toBeLessThanOrEqual(6);
    for (const s of lights) {
      const b = city.buildings.find((b) => s.x > b.minX && s.x < b.maxX && s.z > b.minZ && s.z < b.maxZ)!;
      expect(b.district).toBe('downtown');
      expect(s.y).toBeGreaterThan(b.height);
      for (const o of lights) if (o !== s) expect(Math.hypot(o.x - s.x, o.z - s.z)).toBeGreaterThanOrEqual(110);
    }
  });

  it('sweep back and forth about their heading', () => {
    const s = lights[0];
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 30; t += 0.1) {
      const h = searchlightHeading(s, t) - s.heading;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(hi).toBeGreaterThan(0.9);
    expect(lo).toBeLessThan(-0.9);
    expect(hi).toBeLessThanOrEqual(1.1 + 1e-9);
  });
});
