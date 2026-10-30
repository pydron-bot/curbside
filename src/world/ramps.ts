/**
 * Stunt ramps: kicker wedges on the centreline of a road just past a
 * junction, facing along the road, so there's a long straight run-up behind
 * them and the rest of the block to land in. Traffic keeps to its lanes
 * (4 m either side of the centreline) and never touches them; the player
 * lines up on the dashed line and hits the lip flat out.
 *
 * Riding: a car whose centre comes on from the low front edge climbs the
 * slope (its height follows the surface); over the lip it flies, kicked up
 * in proportion to its speed (a real launch above LAUNCH_SPEED, a mere drop
 * off the end at a crawl). Coming at it from the sides or the back, the
 * wedge is solid (rampSolids, for the ordinary wall collision) unless the
 * car is lined up on its front (enteringRamp). Pure data and maths, no
 * three.js.
 */
import { launch, type VehicleState } from '../entities/vehicle';
import { BLOCK_SIZE, ROAD_WIDTH, type Rect } from './city';
import { DIR_VEC, MAX_NODE, dirHeading, type Dir } from './roads';
import { mulberry32 } from './random';

export interface Ramp {
  /** Centre of the footprint. */
  x: number;
  z: number;
  /** Direction of travel up the slope. */
  dir: Dir;
  /** Vehicle heading of travel up the slope. */
  heading: number;
}

/** Footprint along the road (m), across it (m), and the lip's height (m). */
export const RAMP_LENGTH = 7;
export const RAMP_WIDTH = 3.6;
export const RAMP_HEIGHT = 1.5;
/** Over the lip faster than this (m/s along the ramp) it's a full launch. */
export const LAUNCH_SPEED = 14;
/** Vertical speed of a launch per m/s over the lip. */
export const KICK = 0.36;
/** The first stretch of the slope is low enough to drive onto from the front, m. */
const ENTRY = 2;
/** How far past the junction's edge the ramp starts, m. */
const SETBACK = 4;
/** Ramps at least this far apart, m. */
const SPACING = 170;
export const RAMP_COUNT = 10;

/** Where the ramp starts (the low edge's centre). */
function start(r: Ramp, out: { x: number; z: number }): { x: number; z: number } {
  const v = DIR_VEC[r.dir];
  out.x = r.x - v.x * (RAMP_LENGTH / 2);
  out.z = r.z - v.z * (RAMP_LENGTH / 2);
  return out;
}

/** A ramp on the road leaving junction (ix, iz) heading `d`. */
export function rampAt(ix: number, iz: number, d: Dir): Ramp {
  const v = DIR_VEC[d];
  const along = ROAD_WIDTH / 2 + SETBACK + RAMP_LENGTH / 2;
  return { x: ix * BLOCK_SIZE + v.x * along, z: iz * BLOCK_SIZE + v.z * along, dir: d, heading: dirHeading(d) };
}

/**
 * The city's ramps, the same every game: one a block east of the spawn
 * corner, the rest spread over the inner roads (never the outer ring),
 * well apart.
 */
export function placeRamps(seed: number, count = RAMP_COUNT): Ramp[] {
  const rand = mulberry32(seed ^ 0x7a3b);
  const ramps: Ramp[] = [rampAt(0, 0, 1)];
  const inner = MAX_NODE - 1;
  for (let tries = 0; ramps.length < count && tries < 4000; tries++) {
    const ix = Math.floor(rand() * (inner * 2 + 1)) - inner;
    const iz = Math.floor(rand() * (inner * 2 + 1)) - inner;
    const d = Math.floor(rand() * 4) as Dir;
    const v = DIR_VEC[d];
    // Room to land: the next junction along must be inside the city too.
    if (Math.abs(ix + v.x) > inner || Math.abs(iz + v.z) > inner) continue;
    const r = rampAt(ix, iz, d);
    if (ramps.some((q) => Math.hypot(q.x - r.x, q.z - r.z) < SPACING)) continue;
    ramps.push(r);
  }
  return ramps;
}

/**
 * The parts of each ramp a car can't drive through (all but the low entry
 * at the front), as rects for a StaticGrid. Ramps are axis-aligned.
 */
export function rampSolids(ramps: readonly Ramp[]): Rect[] {
  const s = { x: 0, z: 0 };
  return ramps.map((r) => {
    start(r, s);
    const v = DIR_VEC[r.dir];
    const ax = s.x + v.x * ENTRY;
    const az = s.z + v.z * ENTRY;
    const bx = s.x + v.x * RAMP_LENGTH;
    const bz = s.z + v.z * RAMP_LENGTH;
    const hw = RAMP_WIDTH / 2;
    return {
      minX: Math.min(ax, bx) - (v.x === 0 ? hw : 0),
      maxX: Math.max(ax, bx) + (v.x === 0 ? hw : 0),
      minZ: Math.min(az, bz) - (v.z === 0 ? hw : 0),
      maxZ: Math.max(az, bz) + (v.z === 0 ? hw : 0),
    };
  });
}

/**
 * Is this car lined up to drive onto a ramp from the front (moving up the
 * slope, square to it, between its edges, about to reach or on the low end)?
 * Such a car skips the ramp's solid parts: its nose is over the slope well
 * before its centre (where it starts to ride) is.
 */
export function enteringRamp(s: VehicleState, ramps: readonly Ramp[]): boolean {
  for (const r of ramps) {
    if (Math.abs(s.x - r.x) > RAMP_LENGTH + 6 || Math.abs(s.z - r.z) > RAMP_LENGTH + 6) continue;
    const v = DIR_VEC[r.dir];
    start(r, scratch);
    const along = (s.x - scratch.x) * v.x + (s.z - scratch.z) * v.z;
    const across = Math.abs((s.x - r.x) * -v.z + (s.z - r.z) * v.x);
    const forward = s.vx * v.x + s.vz * v.z;
    const square = Math.sin(s.heading) * v.x + Math.cos(s.heading) * v.z;
    if (along > -5 && along < ENTRY + 1 && across < RAMP_WIDTH / 2 + 0.4 && forward > 0.5 && square > 0.7) return true;
  }
  return false;
}

/** Height of the slope `along` m up the ramp. */
export function rampHeight(along: number): number {
  return RAMP_HEIGHT * Math.min(1, Math.max(0, along / RAMP_LENGTH));
}

/** What happened to a car on the ramps this step. */
export type RampEvent = 'none' | 'riding' | 'launch' | 'drop';

const scratch = { x: 0, z: 0 };

/**
 * Ramps for one grounded car, after it moved this step: climbing sets its
 * height; over the lip (or off a side) it takes off. Returns what happened.
 * A car is "on" a ramp while it's grounded with a height above 0.
 */
export function rideRamps(s: VehicleState, ramps: readonly Ramp[]): RampEvent {
  if (s.airborne) return 'none';
  const riding = s.y > 0;
  for (const r of ramps) {
    if (Math.abs(s.x - r.x) > RAMP_LENGTH + 2 || Math.abs(s.z - r.z) > RAMP_LENGTH + 2) continue;
    const v = DIR_VEC[r.dir];
    start(r, scratch);
    const along = (s.x - scratch.x) * v.x + (s.z - scratch.z) * v.z;
    const across = Math.abs((s.x - r.x) * -v.z + (s.z - r.z) * v.x);
    // Once on, a little slack at the edges (a wheel over the side doesn't drop it).
    const onSlope = across <= RAMP_WIDTH / 2 + (riding ? 0.5 : 0) && along >= 0 && along <= RAMP_LENGTH;
    if (onSlope) {
      // Only from the front: the low edge, moving up the slope (or already on it).
      const forward = s.vx * v.x + s.vz * v.z;
      if (!riding && !(along < ENTRY + 1 && forward > 0)) continue;
      s.y = rampHeight(along);
      return 'riding';
    }
    if (!riding) continue;
    // Was on this ramp's slope and isn't now.
    if (across > RAMP_WIDTH / 2 + 0.5 || along < -0.5) {
      if (along < 0) {
        s.y = 0; // rolled back off the front
        return 'none';
      }
      launch(s, 0); // off the side: a drop
      return 'drop';
    }
    if (along > RAMP_LENGTH) {
      const speedUp = s.vx * v.x + s.vz * v.z;
      const k = Math.min(1, Math.max(0, (speedUp - LAUNCH_SPEED * 0.55) / (LAUNCH_SPEED * 0.45)));
      s.y = RAMP_HEIGHT;
      launch(s, KICK * Math.max(0, speedUp) * k);
      return k > 0.5 ? 'launch' : 'drop';
    }
    if (along < 0) {
      s.y = 0;
      return 'none';
    }
  }
  // Somehow on no ramp at all (shoved off sideways by a collision): drop.
  if (riding) {
    if (s.y < 0.15) s.y = 0;
    else {
      launch(s, 0);
      return 'drop';
    }
  }
  return 'none';
}
