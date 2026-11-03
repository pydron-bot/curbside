import { describe, expect, it } from 'vitest';
import { SOURCE_STRIDE, glintOf, neonSources, onRoad, type Glint } from '../src/render/neonReflect';
import { planBuildings } from '../src/world/buildingPlans';
import { BLOCK_SIZE, HALF_EXTENT, generateCity } from '../src/world/city';

describe('neon reflections', () => {
  const city = generateCity(1337);
  const plans = planBuildings(city);
  const sources = neonSources(city.buildings, plans);

  it('lists the shopfront neon, the rooftop tubes in pieces and the roof signs', () => {
    const shop = plans.reduce((n, p) => n + p.shopfronts.filter((s) => s.neon).length, 0);
    const signs = plans.filter((p) => p.roofNeon?.sign).length;
    const n = sources.length / SOURCE_STRIDE;
    expect(n).toBeGreaterThan(shop + signs);
    for (let o = 0; o < sources.length; o += SOURCE_STRIDE) {
      expect(sources[o + 2]).toBeGreaterThan(1);
      expect(sources[o + 3]).toBeGreaterThan(0);
      expect(sources[o + 3]).toBeLessThan(12);
      for (let k = 4; k < 7; k++) expect(sources[o + k]).toBeGreaterThanOrEqual(0);
    }
  });

  it('mirrors a light toward the eye and runs its streak at the viewer', () => {
    const g: Glint = { x: 0, z: 0, heading: 0, length: 0 };
    // Eye 30 m up over the origin; a light 10 m north (−Z) at 6 m.
    glintOf(0, -10, 6, 0, 30, 0, g);
    expect(g.x).toBeCloseTo(0, 6);
    expect(g.z).toBeCloseTo(-10 * (30 / 36), 6);
    // Toward the viewer: +Z.
    expect(g.heading).toBeCloseTo(0, 6);
    // Taller lights smear further, up to a cap.
    const low = glintOf(0, -10, 2.4, 0, 30, 0, { ...g }).length;
    const high = glintOf(0, -10, 12, 0, 30, 0, { ...g }).length;
    expect(high).toBeGreaterThan(low);
    expect(glintOf(0, -10, 100, 0, 30, 0, { ...g }).length).toBe(8);
    // East of the eye: the streak runs west.
    expect(glintOf(10, 0, 6, 0, 30, 0, g).heading).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('knows a road from a block', () => {
    const line = 8 * BLOCK_SIZE - HALF_EXTENT;
    expect(onRoad(line + 3, line + 30)).toBe(true);
    expect(onRoad(line + 30, line - 7)).toBe(true);
    expect(onRoad(line + 30, line + 30)).toBe(false);
    expect(onRoad(line + 9, line + 30)).toBe(false);
  });
});
