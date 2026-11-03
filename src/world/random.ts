/** Small seeded PRNG so generated content is stable between reloads. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stream of its own for one thing (a block, a building) from integer keys:
 * the city seed, what's being placed, where. Placing the city's dressing
 * block by block from these, rather than one stream through the whole city,
 * means what one block draws can't move anything in another (W3-D: a map
 * edit changes its own block only).
 */
export function keyedStream(seed: number, salt: number, a: number, b: number): () => number {
  let h = Math.imul(seed ^ 0x2545f491, 0x9e3779b1) ^ salt;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) ^ (a | 0);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) ^ (b | 0);
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2f);
  return mulberry32((h ^ (h >>> 15)) >>> 0);
}
