/**
 * String lights over the arts quarter's streets (pure; tests/stringLights.test.ts):
 * strings of bulbs slung across the road from one sidewalk's building line
 * to the other, sagging in the middle, on about half the road segments
 * between two arts blocks. They read from the camera above as glowing lines
 * over the traffic. cityMesh draws the bulbs, wire and night halos.
 */
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK } from './city';
import { districtOf } from './districts';
import { keyedStream } from './random';

/** One string across a road: from (x0, z0) to (x1, z1) at `top` m, sagging `sag` m in the middle. */
export interface StringSpan {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  top: number;
  sag: number;
  /** Which palette (STRING_PALETTES) its bulbs cycle through. */
  palette: number;
}

/** Bulb colours (sRGB hex), cycled along a string: warm white with the neon colours mixed in. */
export const STRING_PALETTES: readonly (readonly string[])[] = [
  ['#ffd9a0', '#ffd9a0', '#ff2d95', '#ffd9a0', '#22e4ff'],
  ['#ffd9a0', '#ffbe5c', '#ffd9a0', '#ffbe5c'],
  ['#ff2d95', '#22e4ff', '#ffd21f', '#b14bff'],
];

/** Where along a block side the strings may hang, m from the block's corner: clear of the lamps at 16, 32 and 48. */
const SLOTS = [10, 24, 40, 54];
/** Share of eligible road segments that get strings, and how many each gets. */
const SEGMENT_ODDS = 0.5;
const PER_SEGMENT = 2;
/** Anchor height and sag, m: over the buses (3.1 m), under the lamp heads' glare. */
const TOP = 5.4;
const SAG = 0.8;

/** Every string over the city's arts streets, the same for the same seed. */
export function planStringLights(citySeed: number): StringSpan[] {
  const out: StringSpan[] = [];
  const reach = ROAD_WIDTH / 2 + SIDEWALK;
  const arts = (bx: number, bz: number) => bx >= 0 && bz >= 0 && bx < BLOCKS_PER_SIDE && bz < BLOCKS_PER_SIDE && districtOf(bx, bz) === 'arts';
  for (let line = 1; line < BLOCKS_PER_SIDE; line++) {
    const c = line * BLOCK_SIZE - HALF_EXTENT;
    for (let b = 0; b < BLOCKS_PER_SIDE; b++) {
      const o = b * BLOCK_SIZE - HALF_EXTENT;
      // A north-south road between columns line-1 and line, along row b: strings run across x.
      if (arts(line - 1, b) && arts(line, b)) addSegment(out, keyedStream(citySeed, 0x5711, line, b), (along) => [c - reach, o + along, c + reach, o + along]);
      // An east-west road between rows line-1 and line, along column b: strings run across z.
      if (arts(b, line - 1) && arts(b, line)) addSegment(out, keyedStream(citySeed, 0x5712, b, line), (along) => [o + along, c - reach, o + along, c + reach]);
    }
  }
  return out;
}

function addSegment(out: StringSpan[], rand: () => number, at: (along: number) => [number, number, number, number]): void {
  if (rand() >= SEGMENT_ODDS) return;
  const first = Math.floor(rand() * SLOTS.length);
  const palette = Math.floor(rand() * STRING_PALETTES.length);
  for (let k = 0; k < PER_SEGMENT; k++) {
    const [x0, z0, x1, z1] = at(SLOTS[(first + k * 2) % SLOTS.length]);
    out.push({ x0, z0, x1, z1, top: TOP, sag: SAG, palette });
  }
}

/** A point along a string, t in [0, 1]: its sagging height there. */
export function spanHeight(s: StringSpan, t: number): number {
  return s.top - s.sag * 4 * t * (1 - t);
}
