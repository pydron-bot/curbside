/**
 * The rules behind the city's traffic scenes (game/scenes/: ambient police
 * chases, street races, accidents and double-parked trucks): what a chase
 * looks for to end, a race's route and how often one runs by the time of
 * day, which two cars can rear-end each other, where a truck may stop in
 * the lane, and when a driver queued behind it may pull out round it. Pure
 * logic, no three.js, tested in tests/trafficScenes.test.ts.
 */
import type { VehicleState } from '../entities/vehicle';
import { BLOCK_SIZE } from '../world/city';
import { DIR_VEC, LANE_OFFSET, canLeave, reverse, turnLeft, turnRight, type Dir } from '../world/roads';
import { len2 } from '../core/len';

/** The bits of a vehicle these rules read. */
export type Pose = Pick<VehicleState, 'x' | 'z' | 'vx' | 'vz' | 'heading'>;

// --- Chases -------------------------------------------------------------------

/** Who's running: a car, a motorbike (the scooter), someone on foot. */
export type ChaseKind = 'car' | 'bike' | 'foot';
/** How it ended: cuffed, taken out (crashed or shot: the injured go to the ambulance), or got away. */
export type ChaseEnd = 'arrested' | 'down' | 'escaped';

/** Half the chases are cars, a quarter bikes, a quarter on foot. */
export function pickChaseKind(r: number): ChaseKind {
  return r < 0.5 ? 'car' : r < 0.75 ? 'bike' : 'foot';
}

/** A getaway stopped this long with a police car this close is boxed in (s, m). */
export const BOXED_SECONDS = 1.6;
export const BOXED_GAP = 12;

/** Stopped long enough with the police right there: the suspect's caught in the car (or bolts). */
export function boxedIn(stillFor: number, copGap: number): boolean {
  return stillFor >= BOXED_SECONDS && copGap < BOXED_GAP;
}

/** A crash this bad (health share left) puts the suspect on the ground rather than on their feet. */
export const TAKEN_OUT_HEALTH = 0.3;

/** An officer this close to a suspect who isn't getting away, for this long, makes the arrest (m, s). */
export const CUFF_RANGE = 1.5;
export const CUFF_SECONDS = 0.9;
/** Slower than this a suspect on foot isn't getting away, m/s. */
const CUFF_SPEED = 2.8;

/** An officer's grip: builds while they're close and the suspect is stopped or down, else lets go. */
export function stepGrip(grip: number, gap: number, suspectSpeed: number, down: boolean, dt: number): number {
  return gap < CUFF_RANGE && (down || suspectSpeed < CUFF_SPEED) ? grip + dt : 0;
}

/** A tackle: an officer this close to a running suspect brings them down (m). */
export const TACKLE_RANGE = 1.1;

/**
 * Which way a suspect on foot runs: along the street (the road axis that
 * takes them furthest from the nearest cop), so they keep to the pavement
 * rather than into a wall. Writes a unit vector into `out`.
 */
export function fleeAxis(x: number, z: number, fromX: number, fromZ: number, out: { x: number; z: number }): { x: number; z: number } {
  const dx = x - fromX;
  const dz = z - fromZ;
  // Which road is this nearer: a north-south one (x on the grid) or an east-west one?
  const offX = Math.abs(x - Math.round(x / BLOCK_SIZE) * BLOCK_SIZE);
  const offZ = Math.abs(z - Math.round(z / BLOCK_SIZE) * BLOCK_SIZE);
  const alongZ = offX < offZ;
  out.x = alongZ ? 0 : dx >= 0 ? 1 : -1;
  out.z = alongZ ? (dz >= 0 ? 1 : -1) : 0;
  return out;
}

/** A chase not over by now is called off (the suspect got away), s. */
export const CHASE_TIMEOUT = 110;

/** Got away: on too long, or the chase is far off out of sight. */
export function escaped(age: number, distance: number, inView: boolean, drop: number): boolean {
  return age > CHASE_TIMEOUT || (distance > drop && !inView);
}

// --- Street races -------------------------------------------------------------

export interface RouteNode {
  ix: number;
  iz: number;
  /** Heading arriving at this node. */
  dir: Dir;
}

/**
 * A street race's route: `legs` junctions on from (ix, iz) arriving
 * heading `dir`, mostly straight on (long fast blocks), turning now and
 * then, never back on itself or through a junction twice, never off the
 * map. Shorter than asked if it boxes itself in.
 */
export function raceRoute(ix: number, iz: number, dir: Dir, legs: number, rand: () => number): RouteNode[] {
  const out: RouteNode[] = [];
  const seen = new Set<number>([key(ix, iz)]);
  let x = ix;
  let z = iz;
  let d = dir;
  for (let i = 0; i < legs; i++) {
    const r = rand();
    const options: Dir[] = r < 0.65 ? [d, turnLeft(d), turnRight(d)] : r < 0.82 ? [turnLeft(d), turnRight(d), d] : [turnRight(d), turnLeft(d), d];
    let picked: Dir | null = null;
    for (const o of options) {
      if (o === reverse(d) || !canLeave(x, z, o)) continue;
      const v = DIR_VEC[o];
      if (seen.has(key(x + v.x, z + v.z))) continue;
      picked = o;
      break;
    }
    if (picked === null) break;
    const v = DIR_VEC[picked];
    x += v.x;
    z += v.z;
    d = picked;
    seen.add(key(x, z));
    out.push({ ix: x, iz: z, dir: d });
  }
  return out;
}

const key = (ix: number, iz: number) => ix * 1000 + iz;

/** Which way to leave node `k` of a route (the next node's arriving heading), or null at the finish. */
export function routeTurn(route: readonly RouteNode[], k: number): Dir | null {
  return k + 1 < route.length ? route[k + 1].dir : null;
}

/** The index of node (ix, iz) on the route, or -1. */
export function routeIndex(route: readonly RouteNode[], ix: number, iz: number): number {
  for (let k = 0; k < route.length; k++) if (route[k].ix === ix && route[k].iz === iz) return k;
  return -1;
}

/**
 * The share of due races that go ahead at `hour` (0..24): every one in the
 * dead of night, most in the evening and before dawn, a quarter by day.
 * `nightlife` scales it (1: an ordinary night).
 */
export function raceOdds(hour: number, nightlife = 1): number {
  const h = ((hour % 24) + 24) % 24;
  const base = h >= 22 || h < 4 ? 1 : h >= 19 || h < 6 ? 0.6 : 0.25;
  return Math.min(1, base * nightlife);
}

/** Share of street races the police turn up for (one of the racers is chased). */
export const RACE_CHASED = 0.3;

/** A racer lights its nitro on a straight this fast, for this long, with this chance each second (m/s, s). */
export const NITRO_FROM = 16;
export const NITRO_SECONDS = 1.6;
export const NITRO_CHANCE = 0.18;

// --- Accidents ----------------------------------------------------------------

/**
 * Is `b` ahead of `a` in the same lane, going the same way? The gap from
 * a's nose to b's tail (m, cars ~4.6 m long), or -1 if not, or over `max`.
 */
export function laneGapAhead(a: Pose, b: Pose, max: number, lane = 1.2): number {
  const fx = Math.sin(a.heading);
  const fz = Math.cos(a.heading);
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const along = rx * fx + rz * fz;
  const lateral = Math.abs(rx * fz - rz * fx);
  if (along <= 0 || lateral > lane || Math.cos(b.heading - a.heading) < 0.97) return -1;
  const gap = along - 4.6;
  return gap > max ? -1 : gap;
}

/** Share of arguments after a crash that turn into a fist fight. */
export const FIGHT_SHARE = 0.35;

/** Health a crashed car is left with, as a share of its max: below SMOKE_AT (0.6), above FIRE_AT (0.2). */
export function crumple(r: number): number {
  return 0.32 + r * 0.2;
}

// --- Double parking -----------------------------------------------------------

/** A double-parked truck stands this far right of the centreline: in the lane, against the parked cars, m. */
export const DOUBLE_PARK_OFFSET = LANE_OFFSET + 0.8;
/** ...this far before the junction ahead (mid-block: clear of the crossings and the junctions' mouths), m. */
export const DOUBLE_PARK_ALONG = [26, 44] as const;

/** Somewhere to keep clear of, with a radius, m. */
export interface Keep {
  x: number;
  z: number;
  r: number;
}

/** Is (x, z) clear of all of `keep`? */
export function clearOf(x: number, z: number, keep: readonly Keep[]): boolean {
  for (const k of keep) if (len2(k.x - x, k.z - z) < k.r) return false;
  return true;
}

/** How far ahead (along the lane, nose to tail) a passing driver wants the oncoming lane empty, m. */
export const PASS_CLEAR = 60;
/** A driver queued this close behind (nose to tail) may go round, m. */
export const PASS_FROM = 14;
/** Share of drivers who go round rather than wait. */
export const PASS_SHARE = 0.6;

/**
 * Is the oncoming lane beside `car` empty for `range` m ahead (and a few
 * metres back)? Anything there, moving or not, counts.
 */
export function oncomingClear(car: Pose, others: readonly Pose[], range: number): boolean {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  for (const o of others) {
    if (o === car) continue;
    const rx = o.x - car.x;
    const rz = o.z - car.z;
    const along = rx * fx + rz * fz;
    if (along < -6 || along > range) continue;
    // Signed offset to our right: the oncoming lane is 2 lanes' offset to the left.
    const right = rz * fx - rx * fz;
    if (right < -2 * LANE_OFFSET - 3 || right > -1.6) continue;
    return false;
  }
  return true;
}

/**
 * Should `car`, queued behind the stopped `blocker`, pull out round it
 * now? Right behind it in its lane, all but stopped, the oncoming lane
 * clear for PASS_CLEAR.
 */
export function canPassAround(car: Pose, blocker: Pose, others: readonly Pose[], blockerLength: number, lane = 1.2): boolean {
  const gap = laneGapAhead(car, blocker, PASS_FROM + blockerLength / 2, lane);
  if (gap < 0 || len2(car.vx, car.vz) > 3) return false;
  return oncomingClear(car, others, PASS_CLEAR);
}

/** Is `car`'s middle at least `margin` m past `blocker`'s nose (along the blocker's heading)? */
export function pastBlocker(car: Pose, blocker: Pose, reach: number, margin: number): boolean {
  const fx = Math.sin(blocker.heading);
  const fz = Math.cos(blocker.heading);
  return (car.x - blocker.x) * fx + (car.z - blocker.z) * fz > reach + margin;
}
