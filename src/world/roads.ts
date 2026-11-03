/**
 * Road network derived from the city grid: every multiple of BLOCK_SIZE (within
 * the city) is a two-way road, so intersections are integer node coordinates
 * (ix, iz) at world (ix·BLOCK_SIZE, iz·BLOCK_SIZE). Traffic drives on the right.
 */
import { BLOCKS_PER_SIDE, BLOCK_SIZE, CORE_BLOCKS, ROAD_WIDTH } from './city';
import { roadRules } from './roadRules';
import { len2 } from '../core/len';

export type Dir = 0 | 1 | 2 | 3; // N (-Z), E (+X), S (+Z), W (-X)
export const DIRS: readonly Dir[] = [0, 1, 2, 3];
export const DIR_VEC: Record<Dir, { x: number; z: number }> = {
  0: { x: 0, z: -1 },
  1: { x: 1, z: 0 },
  2: { x: 0, z: 1 },
  3: { x: -1, z: 0 },
};

/** Furthest node index from the centre (outer ring road). */
export const MAX_NODE = BLOCKS_PER_SIDE / 2;
/** The core city's outer ring road (W3-A): MAX_NODE in the shipped city, an inner road in a bigger one. */
export const CORE_MAX_NODE = CORE_BLOCKS / 2;
/** Junctions in the city, for numbering them. */
const NODE_COUNT = (2 * MAX_NODE + 1) ** 2;
/** Lane centre distance from the road centreline. */
export const LANE_OFFSET = ROAD_WIDTH / 4;
/** Where cars aim to be before / after crossing an intersection. */
const STOP_BACK = ROAD_WIDTH / 2 + 2;

export const turnLeft = (d: Dir): Dir => ((d + 3) % 4) as Dir;
export const turnRight = (d: Dir): Dir => ((d + 1) % 4) as Dir;
export const reverse = (d: Dir): Dir => ((d + 2) % 4) as Dir;

/** Heading (vehicle convention: nose along (sin h, cos h)) for a direction. */
export function dirHeading(d: Dir): number {
  const v = DIR_VEC[d];
  return Math.atan2(v.x, v.z);
}

/** Unit vector to the right of travel. */
export function rightOf(d: Dir): { x: number; z: number } {
  const v = DIR_VEC[d];
  return { x: -v.z, z: v.x };
}

/** A number for the lane travelling `d` toward node (ix, iz), for allocation-free lookups. */
export function laneKey(ix: number, iz: number, d: Dir): number {
  return ((ix + MAX_NODE) * (2 * MAX_NODE + 1) + iz + MAX_NODE) * 4 + d;
}

/** A number for the road between two neighbouring nodes, either way round. */
export function segmentKey(ax: number, az: number, bx: number, bz: number): number {
  const a = (ax + MAX_NODE) * (2 * MAX_NODE + 1) + az + MAX_NODE;
  const b = (bx + MAX_NODE) * (2 * MAX_NODE + 1) + bz + MAX_NODE;
  return Math.min(a, b) * NODE_COUNT + Math.max(a, b);
}

export function nodeValid(ix: number, iz: number): boolean {
  return Math.abs(ix) <= MAX_NODE && Math.abs(iz) <= MAX_NODE;
}

/** Is there a road leaving node (ix, iz) heading d (the map's edge only, whatever the road rules say)? */
export function roadExists(ix: number, iz: number, d: Dir): boolean {
  const v = DIR_VEC[d];
  return nodeValid(ix + v.x, iz + v.z);
}

/**
 * Can a car leave node (ix, iz) heading d? Not off the map, not into a
 * closed road, not the wrong way down a one-way (the map edits' rules,
 * world/roadRules.ts): every router asks this, so traffic keeps the rules.
 */
export function canLeave(ix: number, iz: number, d: Dir): boolean {
  const v = DIR_VEC[d];
  return nodeValid(ix + v.x, iz + v.z) && roadRules().allows(ix, iz, d);
}

type Point = { x: number; z: number };

/**
 * Point on the right-hand lane for travel in `d`, `along` metres past node
 * (ix, iz). Pass `out` to reuse storage (AI calls this every step).
 */
export function lanePoint(ix: number, iz: number, d: Dir, along: number, out: Point = { x: 0, z: 0 }): Point {
  const v = DIR_VEC[d];
  // Right of travel is (-v.z, v.x).
  out.x = ix * BLOCK_SIZE + v.x * along - v.z * LANE_OFFSET;
  out.z = iz * BLOCK_SIZE + v.z * along + v.x * LANE_OFFSET;
  return out;
}

/** Lane point just before arriving at node (ix, iz) travelling in d. */
export function entryPoint(ix: number, iz: number, d: Dir, out?: Point): Point {
  return lanePoint(ix, iz, d, -STOP_BACK, out);
}

/** Lane point just after leaving node (ix, iz) in d. */
export function exitPoint(ix: number, iz: number, d: Dir, out?: Point): Point {
  return lanePoint(ix, iz, d, STOP_BACK, out);
}

/** Pick where to go at node (ix, iz) when arriving in `d`: mostly straight, never off the map. */
export function chooseTurn(ix: number, iz: number, d: Dir, rand: () => number): Dir {
  const options: Array<[Dir, number]> = [
    [d, 0.6],
    [turnLeft(d), 0.2],
    [turnRight(d), 0.2],
  ];
  const valid = options.filter(([o]) => canLeave(ix, iz, o));
  if (valid.length === 0) return reverse(d);
  const total = valid.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [o, w] of valid) {
    if ((r -= w) <= 0) return o;
  }
  return valid[valid.length - 1][0];
}

/**
 * At node (ix, iz), arriving heading `dir`: which way to go toward (tx, tz)
 * (world m). Straight, left or right, whichever leaves the fewest blocks to
 * go, nudged toward the direction the goal actually lies (so a goal behind
 * us turns us off rather than carrying on away). U-turns only at a dead end.
 * `leave` is the rule (canLeave; the map checks pass their own rules).
 */
export function turnToward(ix: number, iz: number, dir: Dir, tx: number, tz: number, leave: (ix: number, iz: number, d: Dir) => boolean = canLeave): Dir {
  const gx = tx / BLOCK_SIZE;
  const gz = tz / BLOCK_SIZE;
  const ux = gx - ix;
  const uz = gz - iz;
  const len = len2(ux, uz) || 1;
  let best: Dir = reverse(dir);
  let bestScore = Infinity;
  for (let k = 0; k < 3; k++) {
    const d = k === 0 ? dir : k === 1 ? turnLeft(dir) : turnRight(dir);
    if (!leave(ix, iz, d)) continue;
    const v = DIR_VEC[d];
    const score = Math.abs(gx - (ix + v.x)) + Math.abs(gz - (iz + v.z)) - 0.6 * ((v.x * ux + v.z * uz) / len) - (d === dir ? 0.01 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}
