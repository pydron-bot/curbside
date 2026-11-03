import { describe, expect, it } from 'vitest';
import { fireworksLevel } from '../src/render/fireworks';

describe('midnight fireworks', () => {
  it('run from 23:30 to 00:45, at full tilt round midnight', () => {
    expect(fireworksLevel(22)).toBe(0);
    expect(fireworksLevel(23.4)).toBe(0);
    expect(fireworksLevel(23.6)).toBeGreaterThan(0);
    expect(fireworksLevel(0)).toBe(1);
    expect(fireworksLevel(0.4)).toBe(1);
    expect(fireworksLevel(0.6)).toBeGreaterThan(0);
    expect(fireworksLevel(0.6)).toBeLessThan(1);
    expect(fireworksLevel(0.8)).toBe(0);
    expect(fireworksLevel(12)).toBe(0);
    expect(fireworksLevel(24)).toBe(1);
  });
  it('fade in and out smoothly', () => {
    for (let h = 23; h < 25; h += 1 / 60) expect(Math.abs(fireworksLevel(h + 1 / 60) - fireworksLevel(h))).toBeLessThan(0.08);
  });
});
