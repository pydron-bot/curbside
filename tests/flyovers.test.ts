import { describe, expect, it } from 'vitest';
import { flyoverAt, flyoverHours, flyoverPath } from '../src/render/flyovers';

describe('flyovers', () => {
  it('pass straight over the point they were sent over, halfway through', () => {
    for (const kind of ['plane', 'blimp'] as const) {
      for (const heading of [0, 1, 2.5, 4]) {
        const p = flyoverPath(kind, 30, -40, heading);
        const mid = flyoverAt(p, p.duration / 2, { x: 0, z: 0 });
        expect(mid.x).toBeCloseTo(30, 6);
        expect(mid.z).toBeCloseTo(-40, 6);
        // Start and end well outside the view.
        expect(Math.hypot(p.x0 - 30, p.z0 + 40)).toBeGreaterThan(100);
      }
    }
  });

  it('a plane is quick, a blimp takes its time', () => {
    expect(flyoverPath('plane', 0, 0, 0).duration).toBeLessThan(15);
    expect(flyoverPath('blimp', 0, 0, 0).duration).toBeGreaterThan(25);
  });

  it('only by day', () => {
    expect(flyoverHours(12)).toBe(true);
    expect(flyoverHours(6)).toBe(false);
    expect(flyoverHours(20)).toBe(false);
    expect(flyoverHours(18.4)).toBe(true);
  });
});
