import { describe, expect, it } from 'vitest';
import { CHUNK_OVERHEAD, chunkSize, chunksOf } from '../src/render/propChunks';

/** The street family's model sizes (props.glb plus the box stand-ins), vertices. */
const STREET = [600, 372, 324, 252, 252, 240, 300, 384, 252, 96, 204, 90, 90, 180, 90, 90, 240, 90, 90, 240, 210, 210, 270, 120, 150, 90, 30, 60, 90, 210, 60];

describe('chunk size', () => {
  it('runs a one-model family whole, in one chunk', () => {
    expect(chunkSize([288])).toBe(288);
    expect(chunksOf(288, chunkSize([288]))).toBe(1);
  });

  it('is whole triangles, and beats any other size on vertices plus chunks', () => {
    const size = chunkSize(STREET);
    expect(size % 3).toBe(0);
    const cost = (c: number) => STREET.reduce((a, n) => a + chunksOf(n, c) * (c + CHUNK_OVERHEAD), 0);
    for (let c = 24; c <= 600; c += 3) expect(cost(size)).toBeLessThanOrEqual(cost(c));
    // Each model runs well under the family's 5,976 (the old cost per instance).
    const total = STREET.reduce((a, n) => a + n, 0);
    expect(total).toBe(5976);
    for (const n of STREET) expect(chunksOf(n, size) * size).toBeLessThan(n + size);
  });

  it('ignores kinds with no model', () => {
    expect(chunkSize([0, 90, 0])).toBe(90);
    expect(chunkSize([])).toBe(3);
  });
});
