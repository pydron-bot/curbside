import { describe, expect, it } from 'vitest';
import { lateness } from '../src/render/sceneLighting';

describe('lateness (living windows)', () => {
  it('rises through the night and is gone by day', () => {
    expect(lateness(13)).toBe(0);
    expect(lateness(19.9)).toBe(0);
    expect(lateness(20)).toBe(0);
    expect(lateness(22)).toBeCloseTo(0.25, 9);
    expect(lateness(0)).toBeCloseTo(0.5, 9);
    expect(lateness(4)).toBeCloseTo(1, 9);
    expect(lateness(5)).toBeCloseTo(0.5, 9);
    expect(lateness(6)).toBe(0);
    expect(lateness(26)).toBeCloseTo(lateness(2), 9);
  });
  it('never jumps between one game minute and the next', () => {
    for (let h = 0; h < 24; h += 1 / 60) expect(Math.abs(lateness(h + 1 / 60) - lateness(h))).toBeLessThan(0.01);
  });
});
