/**
 * RACE CRASHER (V2-12): pull onto a street race's line and you're in it.
 * Pure rules, tested in tests/crashers.test.ts; game/scenes/streetRaces.ts
 * runs them.
 *
 * - **Joining**: driving the race's way along a leg of its route (on the
 *   road between two of its junctions, heading within JOIN_ANGLE of it), at
 *   JOIN_SPEED or more, with a racer still in it within JOIN_GAP, while at
 *   least JOIN_LEGS_LEFT junctions are still to come and nobody's won.
 * - **Racing**: you pass each junction in turn (within PASS_RADIUS of its
 *   middle) from the one you joined toward; through the last one first and
 *   you've won. No rubber-banding: the racers drive exactly as they do
 *   without you (no slowing for you, no catching up).
 * - **The prize**: the racer furthest ahead of the rest when you cross the
 *   line (the race's leader, as it were) pulls up and its driver hands it
 *   over: gets out and walks off, the car left for you (no carjacking) and
 *   kept from the city's scenes for PRIZE_KEEP s or until you take it.
 */
import { DIR_VEC, dirHeading, type Dir } from '../world/roads';
import { BLOCK_SIZE, ROAD_WIDTH } from '../world/city';
import { len2 } from '../core/len';

/** At least this fast to join, m/s. */
export const JOIN_SPEED = 10;
/** A racer still in it within this, m. */
export const JOIN_GAP = 30;
/** Heading within this of the leg's way, rad. */
export const JOIN_ANGLE = (35 * Math.PI) / 180;
/** At least this many junctions still to come (no joining on the run-in). */
export const JOIN_LEGS_LEFT = 2;
/** A junction is passed within this of its middle, m. */
export const PASS_RADIUS = ROAD_WIDTH / 2 + 4;
/** Off the road's middle by up to this and still on the leg, m. */
const LEG_HALF_WIDTH = ROAD_WIDTH / 2 + 1;
/** The prize waits for the player this long, kept from the city, s. */
export const PRIZE_KEEP = 90;
/** Its driver gets out once it's stood this long, s. */
export const PRIZE_OUT = 0.6;

/** A race's junction: (ix, iz) reached heading `dir`. */
export interface RaceNode {
  ix: number;
  iz: number;
  dir: Dir;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Which junction of the route (x, z) going `heading` is driving toward
 * along the route's way: k if it's on the road into node k from the one
 * before it, the right way round; -1 off the route or the wrong way.
 */
export function routeLeg(route: readonly RaceNode[], x: number, z: number, heading: number): number {
  for (let k = 0; k < route.length; k++) {
    const n = route[k];
    const v = DIR_VEC[n.dir];
    if (Math.abs(wrap(heading - dirHeading(n.dir))) > JOIN_ANGLE) continue;
    // From the junction before, along the leg and across it.
    const ox = (n.ix - v.x) * BLOCK_SIZE;
    const oz = (n.iz - v.z) * BLOCK_SIZE;
    const along = (x - ox) * v.x + (z - oz) * v.z;
    const across = (x - ox) * -v.z + (z - oz) * v.x;
    if (along >= 0 && along <= BLOCK_SIZE && Math.abs(across) <= LEG_HALF_WIDTH) return k;
  }
  return -1;
}

export interface JoinCheck {
  /** routeLeg() of the player's car. */
  leg: number;
  /** Junctions on the route. */
  legs: number;
  /** The player's speed, m/s. */
  speed: number;
  /** The nearest racer still in it, m (Infinity: none). */
  gap: number;
  /** Someone's already won. */
  won: boolean;
}

/** Does the player join the race? */
export function joinsRace(c: JoinCheck): boolean {
  return !c.won && c.leg >= 0 && c.legs - c.leg >= JOIN_LEGS_LEFT && c.speed >= JOIN_SPEED && c.gap <= JOIN_GAP;
}

/** Is (x, z) through node `n` (within PASS_RADIUS of the junction's middle)? */
export function passes(n: RaceNode, x: number, z: number): boolean {
  return len2(x - n.ix * BLOCK_SIZE, z - n.iz * BLOCK_SIZE) <= PASS_RADIUS;
}

/** Distance from (x, z) to node `n`'s middle, m. */
export function toNode(n: RaceNode, x: number, z: number): number {
  return len2(x - n.ix * BLOCK_SIZE, z - n.iz * BLOCK_SIZE);
}

/**
 * Is a racer driving toward node `leg`, `dist` m from it, ahead of one
 * driving toward `otherLeg`, `otherDist` m from it? Further down the route
 * first, then nearer its next junction.
 */
export function ahead(leg: number, dist: number, otherLeg: number, otherDist: number): boolean {
  return leg > otherLeg || (leg === otherLeg && dist < otherDist);
}
