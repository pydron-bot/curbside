import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK } from '../src/world/city';
import { districtAt } from '../src/world/districts';
import { generateStreetLamps } from '../src/world/streetLamps';
import { planStringLights, spanHeight } from '../src/world/stringLights';

describe('string lights over the arts quarter', () => {
  const spans = planStringLights(1337);

  it('hangs a good few strings, all over arts streets', () => {
    expect(spans.length).toBeGreaterThan(20);
    for (const s of spans) {
      const mx = (s.x0 + s.x1) / 2;
      const mz = (s.z0 + s.z1) / 2;
      // Either side of the road is arts.
      expect(districtAt(s.x0 + Math.sign(s.x1 - s.x0) * 1, s.z0 + Math.sign(s.z1 - s.z0) * 1)).toBe('arts');
      expect(districtAt(s.x1 - Math.sign(s.x1 - s.x0) * 1, s.z1 - Math.sign(s.z1 - s.z0) * 1)).toBe('arts');
      // The middle is over a road centreline.
      const along = Math.abs(s.x1 - s.x0) > 1 ? mx : mz;
      const fromLine = (((along + HALF_EXTENT) % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE;
      expect(Math.min(fromLine, BLOCK_SIZE - fromLine)).toBeLessThan(1e-6);
    }
  });

  it('spans building line to building line, over the buses and under the lamps, sagging in the middle', () => {
    for (const s of spans) {
      expect(Math.hypot(s.x1 - s.x0, s.z1 - s.z0)).toBeCloseTo(ROAD_WIDTH + 2 * SIDEWALK, 6);
      expect(spanHeight(s, 0)).toBeLessThan(5.87);
      expect(spanHeight(s, 0.5)).toBeGreaterThan(3.5);
      expect(spanHeight(s, 0.5)).toBeLessThan(spanHeight(s, 0));
    }
  });

  it('keeps clear of the street lamps', () => {
    const lamps = generateStreetLamps();
    for (const s of spans) {
      const across = Math.abs(s.x1 - s.x0) > 1;
      const along = across ? s.z0 : s.x0;
      const near = lamps.filter((l) => (across ? Math.abs(l.x - (s.x0 + s.x1) / 2) < 12 : Math.abs(l.z - (s.z0 + s.z1) / 2) < 12));
      for (const l of near) expect(Math.abs((across ? l.z : l.x) - along)).toBeGreaterThan(5);
    }
  });

  it('is the same every time for the same city', () => {
    expect(planStringLights(1337)).toEqual(spans);
  });
});
