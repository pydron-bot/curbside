import { describe, expect, it } from 'vitest';
import { roadRoute } from '../src/ui/radarRoute';
import { BLOCK_SIZE } from '../src/world/city';

const pts = (out: number[], n: number) => Array.from({ length: n }, (_, i) => [out[2 * i], out[2 * i + 1]]);

describe('radar route', () => {
  it('follows the roads: onto the nearest road, along it, across, then in', () => {
    const out: number[] = [];
    // Standing beside the x = 0 road; target three blocks south, two east.
    const n = roadRoute(2, 10, 2 * BLOCK_SIZE + 5, 3 * BLOCK_SIZE + 10, out);
    const p = pts(out, n);
    expect(p[0]).toEqual([2, 10]);
    expect(p[1]).toEqual([0, 10]);
    expect(p[2]).toEqual([0, 3 * BLOCK_SIZE]);
    expect(p[3]).toEqual([2 * BLOCK_SIZE + 5, 3 * BLOCK_SIZE]);
    expect(p[n - 1]).toEqual([2 * BLOCK_SIZE + 5, 3 * BLOCK_SIZE + 10]);
    // Every leg runs along an axis.
    for (let i = 1; i < n; i++) expect(p[i][0] === p[i - 1][0] || p[i][1] === p[i - 1][1]).toBe(true);
  });

  it('takes the east-west road when that one is nearer', () => {
    const out: number[] = [];
    const n = roadRoute(30, 1, -100, 40, out);
    expect(pts(out, n)[1]).toEqual([30, 0]);
  });

  it('drops repeated points and reuses its buffer', () => {
    const out: number[] = [];
    const n = roadRoute(0, 0, 0, 2 * BLOCK_SIZE, out); // straight down a road
    expect(n).toBe(2);
    const again = roadRoute(0, 0, 5, 5, out);
    expect(again).toBeGreaterThanOrEqual(2);
  });
});
