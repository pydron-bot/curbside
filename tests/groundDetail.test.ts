import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE, HALF_EXTENT } from '../src/world/city';
import { QUALITY_TIERS } from '../src/render/quality';
import { busStopByte } from '../src/world/ground';

describe('road and pavement detail (V3 L6)', () => {
  it('is off on the low tier only (that keeps the plain ground)', () => {
    expect(QUALITY_TIERS.high.groundDetail).toBe(true);
    expect(QUALITY_TIERS.medium.groundDetail).toBe(true);
    expect(QUALITY_TIERS.low.groundDetail).toBe(false);
  });

  it('marks a bus stop in its block by side and 2 m step along it', () => {
    const x0 = -HALF_EXTENT + 5 * BLOCK_SIZE;
    const z0 = -HALF_EXTENT + 7 * BLOCK_SIZE;
    // A shelter on the north side (10.5 m in from the road centreline), 30 m along.
    const n = busStopByte(x0 + 30, z0 + 10.5)!;
    expect([n.bx, n.bz]).toEqual([5, 7]);
    expect(n.byte & 0x80).toBe(0x80);
    expect((n.byte >> 5) & 3).toBe(0);
    expect((n.byte & 31) * 2).toBe(30);
    // East side, 26 m along (z), and the west and south sides.
    expect((busStopByte(x0 + BLOCK_SIZE - 10.5, z0 + 26)!.byte >> 5) & 3).toBe(1);
    expect(busStopByte(x0 + BLOCK_SIZE - 10.5, z0 + 26)!.byte & 31).toBe(13);
    expect((busStopByte(x0 + 33, z0 + BLOCK_SIZE - 10.5)!.byte >> 5) & 3).toBe(2);
    expect((busStopByte(x0 + 10.5, z0 + 40)!.byte >> 5) & 3).toBe(3);
    expect(busStopByte(-HALF_EXTENT - 5, 0)).toBeNull();
  });
});
