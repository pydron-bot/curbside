/**
 * The kerbs as the placing modules (streetProps.ts, roadworks.ts,
 * streetStops.ts, frontages.ts) see them: a block's side and the lane
 * beside it, the lines things stand on, and how a module puts a prop down.
 * Pure data.
 */
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, type Block } from './city';
import type { Dir } from './roads';
import type { StreetPropKind } from './streetProps';

/** Kerb line (lamps, hydrants, bins): this far from the road centreline, m. */
export const KERB_LINE = ROAD_WIDTH / 2 + 0.5;
/** Benches stand back against the building side of the pavement, m from the centreline. */
export const BENCH_LINE = ROAD_WIDTH / 2 + SIDEWALK - 0.45;
/** The line people walk down the middle of the pavement (systems/crowd.ts), m from the centreline. */
export const WALK_LINE = ROAD_WIDTH / 2 + SIDEWALK / 2;

/**
 * How the placing modules (roadworks.ts, streetStops.ts, frontages.ts) put
 * things down: a check that a spot is clear of markers, bays and everything
 * placed so far, and the put itself (which claims the spot).
 */
export interface Placer {
  clear(x: number, z: number, r: number): boolean;
  /** Clear for something in the road: also of the `reserve` points. */
  clearRoad(x: number, z: number, r: number): boolean;
  put(kind: StreetPropKind, x: number, z: number, heading: number, scale?: number, phase?: number, tint?: string): number;
  /** Claim more room for something long (a shelter's ends). */
  claim(x: number, z: number, r: number): void;
}

/**
 * One side of a block (0 north, 1 east, 2 south, 3 west: the road it faces)
 * and the lane beside it: points by `t` along it from the block's corner
 * (west or north end) and `inset` from the road's centreline.
 */
export interface BlockSide {
  block: Block;
  side: number;
  /** Heading that faces the road (vehicle convention). */
  toRoad: number;
  /** The kerbside lane: travelling `dir` from junction (fromX, fromZ) toward (ix, iz). */
  dir: Dir;
  ix: number;
  iz: number;
  fromX: number;
  fromZ: number;
  at(t: number, inset: number): { x: number; z: number };
  /** `t` for a distance along the lane from the junction it starts at. */
  tFor(along: number): number;
}

export function blockSide(block: Block, side: number): BlockSide {
  const x0 = -HALF_EXTENT + block.bx * BLOCK_SIZE;
  const z0 = -HALF_EXTENT + block.bz * BLOCK_SIZE;
  const ox = side === 1 ? 1 : side === 3 ? -1 : 0;
  const oz = side === 0 ? -1 : side === 2 ? 1 : 0;
  const alongX = oz !== 0;
  const nx = block.bx - BLOCKS_PER_SIDE / 2;
  const nz = block.bz - BLOCKS_PER_SIDE / 2;
  // Traffic drives on the right, so the lane by this kerb runs E along a north side, S along an east one...
  const dir = ([1, 2, 3, 0] as const)[side];
  const from = [[nx, nz], [nx + 1, nz], [nx + 1, nz + 1], [nx, nz + 1]][side];
  const to = [[nx + 1, nz], [nx + 1, nz + 1], [nx, nz + 1], [nx, nz]][side];
  return {
    block,
    side,
    toRoad: Math.atan2(ox, oz),
    dir,
    fromX: from[0],
    fromZ: from[1],
    ix: to[0],
    iz: to[1],
    at: (t, inset) => ({
      x: alongX ? x0 + t : ox < 0 ? x0 + inset : x0 + BLOCK_SIZE - inset,
      z: alongX ? (oz < 0 ? z0 + inset : z0 + BLOCK_SIZE - inset) : z0 + t,
    }),
    tFor: (along) => (side < 2 ? along : BLOCK_SIZE - along),
  };
}

/** Is this block side on the outer ring road (no kerb across it, the city wall beyond)? */
export function onRing(s: BlockSide): boolean {
  const b = s.block;
  return (s.side === 0 && b.bz === 0) || (s.side === 2 && b.bz === BLOCKS_PER_SIDE - 1) || (s.side === 3 && b.bx === 0) || (s.side === 1 && b.bx === BLOCKS_PER_SIDE - 1);
}

