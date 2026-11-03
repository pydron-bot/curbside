import { describe, expect, it } from 'vitest';
import { HALF_EXTENT } from '../src/world/city';
import { districtOf } from '../src/world/districts';
import { BLOCKS_PER_SIDE, BLOCK_SIZE } from '../src/world/city';
import { SHORE, gullPose, planGulls, type GullPose } from '../src/systems/gulls';

describe('seagulls over the docks', () => {
  const gulls = planGulls(1337);
  const pose: GullPose = { x: 0, y: 0, z: 0, heading: 0, bank: 0, gliding: true, flap: 0 };

  it('wheel over the industrial quarter\'s water edge, above the roofs', () => {
    expect(gulls.length).toBeGreaterThanOrEqual(15);
    for (const g of gulls) {
      for (let t = 0; t < 120; t += 7) {
        gullPose(g, t, pose);
        expect(pose.y).toBeGreaterThan(9);
        // Near the coast: within reach of the shore line on the south or east side.
        const fromShore = Math.min(Math.abs(pose.x - SHORE), Math.abs(pose.z - SHORE));
        expect(fromShore).toBeLessThan(40);
        expect(pose.x).toBeGreaterThan(-10);
        expect(pose.z).toBeGreaterThan(-10);
      }
      // The coast they circle belongs to the industrial quarter.
      const bx = Math.min(BLOCKS_PER_SIDE - 1, Math.floor((Math.min(g.cx, HALF_EXTENT - 1) + HALF_EXTENT) / BLOCK_SIZE));
      const bz = Math.min(BLOCKS_PER_SIDE - 1, Math.floor((Math.min(g.cz, HALF_EXTENT - 1) + HALF_EXTENT) / BLOCK_SIZE));
      expect(districtOf(bx, bz)).toBe('industrial');
    }
  });

  it('fly along their circle, facing where they go', () => {
    const g = gulls[0];
    const a = { ...gullPose(g, 10, pose) };
    const b = { ...gullPose(g, 10.05, pose) };
    const dir = Math.atan2(b.x - a.x, b.z - a.z);
    const diff = Math.atan2(Math.sin(dir - a.heading), Math.cos(dir - a.heading));
    expect(Math.abs(diff)).toBeLessThan(0.1);
  });

  it('mostly glide, with bouts of wing beats', () => {
    let beating = 0;
    for (let t = 0; t < 80; t += 0.1) if (!gullPose(gulls[0], t, pose).gliding) beating++;
    expect(beating / 800).toBeGreaterThan(0.05);
    expect(beating / 800).toBeLessThan(0.3);
  });

  it('is the same every time for the same seed', () => {
    expect(planGulls(1337)).toEqual(gulls);
  });
});
