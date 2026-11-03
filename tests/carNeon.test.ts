import { describe, expect, it } from 'vitest';
import { UNDERGLOW_COLOURS, pickUnderglow, trailLength } from '../src/render/carNeon';

describe('car neon', () => {
  it('every sports car has an underglow, in a palette colour', () => {
    for (let i = 0; i < 50; i++) {
      const c = pickUnderglow('sports', i / 50, ((i * 7) % 50) / 50);
      expect(UNDERGLOW_COLOURS).toContain(c);
    }
  });

  it('police, emergency and work vehicles never do', () => {
    for (const a of ['police', 'police_suv', 'swat', 'ambulance', 'firetruck', 'garbage_truck', 'bus', 'tow_truck', 'taxi', 'van'] as const) {
      expect(pickUnderglow(a, 0, 0.5)).toBe(-1);
    }
  });

  it('some other civilian cars do, by their odds', () => {
    let lit = 0;
    for (let i = 0; i < 1000; i++) if (pickUnderglow('muscle', (i + 0.5) / 1000, 0.3) >= 0) lit++;
    expect(lit).toBe(300);
    expect(pickUnderglow('sedan', 0.9, 0.5)).toBe(-1);
    // A colour roll at the very top still lands in the palette.
    expect(UNDERGLOW_COLOURS).toContain(pickUnderglow('sports', 0, 0.9999999));
  });

  it('light trails grow with speed from 9 m/s and stop at 7 m', () => {
    expect(trailLength(5)).toBe(0);
    expect(trailLength(-20)).toBeCloseTo(trailLength(20), 9);
    expect(trailLength(12)).toBeGreaterThan(trailLength(10));
    expect(trailLength(80)).toBe(7);
  });
});
