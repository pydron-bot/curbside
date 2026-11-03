import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH } from '../src/world/city';
import { planSteamVents } from '../src/world/steamVents';

describe('steam vents', () => {
  const vents = planSteamVents(1337);
  const local = (v: number) => (((v + HALF_EXTENT) % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE;
  const fromLine = (v: number) => Math.min(local(v), BLOCK_SIZE - local(v));

  it('sit in the lanes, clear of the junctions', () => {
    expect(vents.length).toBeGreaterThan(60);
    for (const v of vents) {
      const ax = fromLine(v.x);
      const az = fromLine(v.z);
      // On one road (within its half width), and well away from the crossing one.
      expect(Math.min(ax, az)).toBeLessThan(ROAD_WIDTH / 2);
      expect(Math.min(ax, az)).toBeGreaterThan(1.5);
      expect(Math.max(ax, az)).toBeGreaterThan(ROAD_WIDTH / 2 + 3.9);
    }
  });

  it('is the same every time for the same city', () => {
    expect(planSteamVents(1337)).toEqual(vents);
  });
});
