import { describe, expect, it } from 'vitest';
import { morningMist } from '../src/render/timeOfDay';

describe('morning mist', () => {
  it('is only there around dawn, thickest just after sunrise', () => {
    for (const h of [0, 3, 4.9, 8.25, 9, 12, 18, 22]) expect(morningMist(h)).toBe(0);
    expect(morningMist(6)).toBe(1);
    expect(morningMist(6.5)).toBe(1);
    expect(morningMist(5.4)).toBeGreaterThan(0);
    expect(morningMist(5.4)).toBeLessThan(1);
  });

  it('burns off steadily as the sun climbs', () => {
    let last = 1;
    for (let h = 6.85; h <= 8.25; h += 0.05) {
      const m = morningMist(h);
      expect(m).toBeLessThanOrEqual(last + 1e-9);
      last = m;
    }
    expect(morningMist(8.2)).toBeLessThan(0.01);
  });

  it('wraps the hour', () => {
    expect(morningMist(30)).toBe(morningMist(6));
  });
});
