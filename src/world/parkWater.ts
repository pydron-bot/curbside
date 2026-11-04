/**
 * Water in the parks (pure; tests/parkWater.test.ts): the fountain in the
 * middle of every open plaza (world/ground.ts draws its basin), and lawn
 * sprinklers on the grass of some parks, most in the residential streets
 * and the old town. render/waterLook.ts makes them spray.
 */
import { BLOCK_SIZE, HALF_EXTENT, isCarPark, lotBytes, mergedAway, type City, type Rect } from './city';
import type { District } from './districts';
import { keyedStream } from './random';

export interface Fountain {
  x: number;
  z: number;
}

export interface Sprinkler {
  x: number;
  z: number;
  /** The middle of its sweep, radians (0 = +X): out from the park's middle. */
  facing: number;
  /** Where it is in its on/off cycle at time 0, s. */
  phase: number;
}

/** Share of parks with sprinklers, by district. */
const SPRINKLER_ODDS: Record<District, number> = {
  residential: 0.85,
  oldtown: 0.65,
  downtown: 0.4,
  arts: 0.35,
  industrial: 0.3,
};
/** How far out from the park's middle a sprinkler stands, m: on the grass between the diagonal paths, clear of the courts. */
const OUT = 14;
/** Sprinklers stay this far from a tree trunk, m. */
const TREE_CLEAR = 2;
/** And this far from anything built (a landmark's walls: world/dressing.ts solids), m. */
const SOLID_CLEAR = 4;
/** One sprinkler cycle (on, then off), s. */
export const SPRINKLER_CYCLE = 75;
/** Of which it runs this long, s. */
export const SPRINKLER_ON = 45;

/** `solids`: what's built on top of the city (landmarks), for the sprinklers to keep clear of. */
export function planParkWater(city: City, solids: readonly Rect[] = []): { fountains: Fountain[]; sprinklers: Sprinkler[] } {
  const bytes = lotBytes(city);
  const fountains: Fountain[] = [];
  const sprinklers: Sprinkler[] = [];
  city.blocks.forEach((b, i) => {
    // A merged block (round 3): one fountain or set of sprinklers, in the middle of the whole merge.
    if (mergedAway(b)) return;
    const cx = b.merge ? (b.interior.minX + b.interior.maxX) / 2 : -HALF_EXTENT + (b.bx + 0.5) * BLOCK_SIZE;
    const cz = b.merge ? (b.interior.minZ + b.interior.maxZ) / 2 : -HALF_EXTENT + (b.bz + 0.5) * BLOCK_SIZE;
    if (b.kind === 'plaza' && !isCarPark(city, bytes, i)) fountains.push({ x: cx, z: cz });
    if (b.kind !== 'park') return;
    const rand = keyedStream(city.seed, 0x5a71, b.bx, b.bz);
    if (rand() >= SPRINKLER_ODDS[b.district]) return;
    // One or both of the sides along X (the courts lie along Z).
    const both = rand() < 0.5;
    const first = rand() < 0.5 ? 1 : -1;
    for (const side of both ? [1, -1] : [first]) {
      // Both draws first, so a sprinkler left out doesn't move the next one.
      const x = cx + side * OUT;
      const z = cz + (rand() - 0.5) * 6;
      const phase = rand() * SPRINKLER_CYCLE;
      if (city.trees.some((t) => Math.hypot(t.x - x, t.z - z) < TREE_CLEAR)) continue;
      if (solids.some((r) => x > r.minX - SOLID_CLEAR && x < r.maxX + SOLID_CLEAR && z > r.minZ - SOLID_CLEAR && z < r.maxZ + SOLID_CLEAR)) continue;
      sprinklers.push({ x, z, facing: side > 0 ? 0 : Math.PI, phase });
    }
  });
  return { fountains, sprinklers };
}

/** Is a sprinkler with this phase running at time t (s)? */
export function sprinklerOn(phase: number, t: number): boolean {
  return (((t + phase) % SPRINKLER_CYCLE) + SPRINKLER_CYCLE) % SPRINKLER_CYCLE < SPRINKLER_ON;
}

/** A sprinkler's jet direction at time t: an oscillating fan, ±65° about its facing over 7 s. */
export function sprinklerAngle(s: Sprinkler, t: number): number {
  return s.facing + Math.sin(((t + s.phase) / 7) * Math.PI * 2) * 1.13;
}
