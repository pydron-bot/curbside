/**
 * Places for the TEST menu (game/testTools.ts): where a teleport lands (the
 * nearest road or pavement point to a spot picked on the map; with a car, a
 * lane, facing along it, clear of the junction), where a spawned car goes
 * (beside the player, on the road when one is close) and the quick-teleport
 * landmarks. Pure: the caller says what's blocked (`Free`).
 */
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, inCoreBlock, type City } from '../world/city';
import type { District } from '../world/districts';
import { LANE_OFFSET } from '../world/roads';

export interface Spot {
  x: number;
  z: number;
  /** Vehicle heading (nose along (sin h, cos h)); on foot, the way to face. */
  heading: number;
}

/** Is a circle of radius `r` at (x, z) clear of walls, props and cars? */
export type Free = (x: number, z: number, r: number) => boolean;

/** A person's clearance, m. */
export const FOOT_R = 0.6;
/** A car's clearance (a sedan's body circles and a little), m. */
export const CAR_R = 2.6;
/** Road plus pavement either side of a centreline, m. */
const WALK_BAND = ROAD_WIDTH / 2 + SIDEWALK;
/** The outer ring road's far kerb: nothing beyond it is the city. */
const EDGE = HALF_EXTENT + ROAD_WIDTH / 2 - 1;
/** A car teleported or spawned this far from a crossing's middle at least (clear of the junction box), m. */
const CLEAR_OF_JUNCTION = ROAD_WIDTH / 2 + 4;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The nearest road centreline to coordinate `v` (x for the north–south roads, z for east–west). */
export function nearestLine(v: number): number {
  return clamp(Math.round(v / BLOCK_SIZE) * BLOCK_SIZE, -HALF_EXTENT, HALF_EXTENT);
}

/** Is (x, z) on a road or a pavement (anywhere a person can stand in the street)? */
export function walkable(x: number, z: number): boolean {
  if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) return false;
  return Math.abs(x - nearestLine(x)) <= WALK_BAND || Math.abs(z - nearestLine(z)) <= WALK_BAND;
}

/** Is (x, z) on the carriageway (between the kerbs)? */
export function onRoad(x: number, z: number): boolean {
  if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) return false;
  return Math.abs(x - nearestLine(x)) <= ROAD_WIDTH / 2 || Math.abs(z - nearestLine(z)) <= ROAD_WIDTH / 2;
}

/** Rings searched round a blocked spot: radii (m) and points per ring. */
const FOOT_RINGS = [1.2, 2.4, 3.6, 5, 7, 9, 12];
const RING_POINTS = 12;

/**
 * On foot: the nearest road or pavement point to (x, z), clear for a person.
 * Inside a block (a building, a park) it steps out to the middle of the
 * nearest pavement. Null if nothing near is clear.
 */
export function snapOnFoot(x: number, z: number, free: Free, out: Spot = { x: 0, z: 0, heading: 0 }): Spot | null {
  let px = clamp(x, -EDGE, EDGE);
  let pz = clamp(z, -EDGE, EDGE);
  if (!walkable(px, pz)) {
    // In a block's interior: out to the pavement of the nearer side.
    const dx = px - nearestLine(px);
    const dz = pz - nearestLine(pz);
    const mid = ROAD_WIDTH / 2 + SIDEWALK / 2;
    if (Math.abs(dx) <= Math.abs(dz)) px = nearestLine(px) + Math.sign(dx || 1) * mid;
    else pz = nearestLine(pz) + Math.sign(dz || 1) * mid;
  }
  out.heading = Math.PI;
  if (free(px, pz, FOOT_R)) {
    out.x = px;
    out.z = pz;
    return out;
  }
  for (const r of FOOT_RINGS) {
    for (let i = 0; i < RING_POINTS; i++) {
      const a = (i / RING_POINTS) * Math.PI * 2;
      const tx = px + Math.sin(a) * r;
      const tz = pz + Math.cos(a) * r;
      if (!walkable(tx, tz) || !free(tx, tz, FOOT_R)) continue;
      out.x = tx;
      out.z = tz;
      return out;
    }
  }
  return null;
}

/** Along a lane: tried in this order from the wanted spot, m. */
const LANE_STEPS = [0, 6, -6, 12, -12, 18, -18, 24, -24, 32, -32, 40, -40];

/**
 * The lane point on road `line` (x = line for a north–south road, z = line
 * for east–west), `along` the road, on `side` (+1 / −1) of the centreline.
 * Traffic keeps right: a car east of a north–south road's centreline heads
 * north. Writes `out`; false if it's off the map or in a junction box.
 */
function lanePoint(northSouth: boolean, line: number, along: number, side: number, out: Spot): boolean {
  if (Math.abs(along) > HALF_EXTENT) return false;
  // Clear of the crossing roads' boxes.
  const cross = nearestLine(along);
  if (Math.abs(along - cross) < CLEAR_OF_JUNCTION) return false;
  if (northSouth) {
    out.x = line + side * LANE_OFFSET;
    out.z = along;
    out.heading = side > 0 ? Math.PI : 0;
  } else {
    out.x = along;
    out.z = line + side * LANE_OFFSET;
    out.heading = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  return true;
}

/** Shift a spot along a road out of the junction box it's in (toward `toward`'s side). */
function outOfJunction(along: number, toward: number): number {
  const cross = nearestLine(along);
  if (Math.abs(along - cross) >= CLEAR_OF_JUNCTION) return along;
  const dir = Math.sign(toward - cross) || Math.sign(along - cross) || 1;
  const moved = cross + dir * CLEAR_OF_JUNCTION;
  return Math.abs(moved) > HALF_EXTENT ? cross - dir * CLEAR_OF_JUNCTION : moved;
}

/**
 * With a car: the nearest lane to (x, z), facing the way that lane's traffic
 * goes, out of the junction boxes, clear for a car. Blocked, it tries along
 * the lane, then the other lane. Null if the road there is jammed.
 */
export function snapToLane(x: number, z: number, free: Free, out: Spot = { x: 0, z: 0, heading: 0 }): Spot | null {
  const lx = nearestLine(x);
  const lz = nearestLine(z);
  // The nearer road: a north–south one (x = lx) or an east–west one (z = lz).
  const northSouth = Math.abs(x - lx) <= Math.abs(z - lz);
  const line = northSouth ? lx : lz;
  const across = northSouth ? x - lx : z - lz;
  const along = outOfJunction(clamp(northSouth ? z : x, -HALF_EXTENT, HALF_EXTENT), northSouth ? z : x);
  const near = across >= 0 ? 1 : -1;
  for (const side of [near, -near]) {
    for (const step of LANE_STEPS) {
      if (!lanePoint(northSouth, line, along + step, side, out)) continue;
      if (free(out.x, out.z, CAR_R)) return out;
    }
  }
  return null;
}

/**
 * A car spawned beside the player at (x, z): on a lane of the nearest road
 * when there's a clear spot within `max` m (and no closer than `min`, so
 * it's not on top of them), else on the pavement round them facing
 * `heading`. The nearest such spot wins. Null if nowhere is clear.
 */
export function spawnBeside(x: number, z: number, heading: number, free: Free, min = 4.5, max = 16, out: Spot = { x: 0, z: 0, heading: 0 }): Spot | null {
  const lx = nearestLine(x);
  const lz = nearestLine(z);
  const p: Spot = { x: 0, z: 0, heading: 0 };
  let best = Infinity;
  const consider = (tx: number, tz: number, h: number) => {
    const d = Math.hypot(tx - x, tz - z);
    if (d < min || d > max || d >= best || !free(tx, tz, CAR_R)) return;
    best = d;
    out.x = tx;
    out.z = tz;
    out.heading = h;
  };
  for (const northSouth of [true, false]) {
    const line = northSouth ? lx : lz;
    const along = northSouth ? z : x;
    for (const side of [1, -1]) {
      for (let step = -max; step <= max; step += 3) {
        if (lanePoint(northSouth, line, along + step, side, p)) consider(p.x, p.z, p.heading);
      }
    }
  }
  if (best < Infinity) return out;
  // No lane close by (a park, a plaza): anywhere on the street round them.
  for (let r = min; r <= max; r += 2) {
    for (let i = 0; i < RING_POINTS; i++) {
      const a = heading + Math.PI / 2 + (i / RING_POINTS) * Math.PI * 2;
      const tx = x + Math.sin(a) * r;
      const tz = z + Math.cos(a) * r;
      if (walkable(tx, tz)) consider(tx, tz, heading);
    }
    if (best < Infinity) return out;
  }
  return null;
}

/**
 * The middle of a district's blocks in the core city, where its story spots
 * are (a landmark for the quick teleports; snap it before use).
 */
export function districtCentre(city: City, district: District): { x: number; z: number } {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const b of city.blocks) {
    if (b.district !== district || !inCoreBlock(b.bx, b.bz)) continue;
    x += (b.interior.minX + b.interior.maxX) / 2;
    z += (b.interior.minZ + b.interior.maxZ) / 2;
    n++;
  }
  return n ? { x: x / n, z: z / n } : { x: 0, z: 0 };
}
