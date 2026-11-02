/**
 * The live cold open (V2-07), as rules and geometry: PLAY on a fresh save
 * puts the player at a bus shelter as a bus pulls in, and a police chase's
 * getaway comes down the far lane, swerves across and piles into the kerb a
 * few steps away: GET IN · LOSE THE HEAT (story job s1, WRONG STOP). If the
 * chase can't start, the getaway is already there, crashed (the fallback),
 * and getting in brings the same 2 stars. It runs once (`save.opening`).
 *
 * Also the side-mode gate: Chaos Run, frenzies, races, exports and taxi
 * fares stay hidden from a brand-new player until story job 2 is passed.
 *
 * Pure (no three.js): modes/openingMode.ts puts it on the street.
 */
import { BLOCK_SIZE } from '../world/city';
import { LANE_OFFSET } from '../world/roads';
import type { BusStop } from '../world/streetStops';
import type { SaveData } from './progressSave';

/** The cold open's story job (systems/missionsData.ts), a `direct` one: nothing rings for it. */
export const OPENING_JOB = 's1-wrongstop';
/** The getaway's tag in that job. */
export const GETAWAY_TAG = 'getaway';
/** Passing this job opens the side modes. */
export const SIDE_MODES_AFTER = 's2-noise';
/** An unlock (save.unlocks) that opens them without it: a save from before the gate. */
export const SIDE_MODES_UNLOCK = 'sideModes';

/** The player stands this far past the middle of the shelter (by its end, toward where the getaway ends up: in view on a phone), m. */
export const STAND_AHEAD = 7;
/** The getaway piles in this far ahead of the bus's stop (clear of its nose), m... */
export const CRASH_AHEAD = 11;
/** ...this far from the road's centreline on the shelter's side (its kerb lane, tight to the kerb), m. */
export const CRASH_ACROSS = 5;
/** It starts on the far lane this far ahead of the stop (off screen), coming the other way, m. */
export const GETAWAY_AHEAD = 62;
/** The bus is put down this far back on its lane, pulling in. */
export const BUS_BACK = 22;
/** The getaway (and its units) wait this long off screen, sirens going, before it comes, s. */
export const CHASE_WAIT = 2;
/** Once it sets off it crashes within this, wherever it's got to, s (the spec: within 10 s of PLAY). */
export const CRASH_BY = 6;
/** A staged chase that hasn't crashed by then has gone wrong: the fallback, s after PLAY. */
export const CHASE_GIVE_UP = CHASE_WAIT + CRASH_BY + 2;
/** A stop needs at least this much road ahead of it to the next junction's middle, m (the crash clear of the junction). */
const ROOM_AHEAD = CRASH_AHEAD + 12;

export interface Pose {
  x: number;
  z: number;
  heading: number;
}

export interface OpeningPlan {
  stop: BusStop;
  /** Where the player stands, facing the road. */
  stand: Pose;
  /** Where the getaway ends up (and the fallback's crashed car stands). */
  crash: Pose;
  /** Where it starts: the far lane, heading back toward the stop. */
  getaway: Pose;
  /** The road the getaway comes down (from `back` m behind the stop to `ahead` m ahead, both lanes): cleared of traffic first. */
  road: { x: number; z: number; fx: number; fz: number; back: number; ahead: number; half: number };
}

/** The plan round shelter `s`. */
export function openingPlan(s: BusStop): OpeningPlan {
  const h = s.stopHeading;
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  // Across the road toward the shelter (the stop's lane is on that side).
  let ax = s.waitX - s.stopX;
  let az = s.waitZ - s.stopZ;
  const al = Math.hypot(ax, az) || 1;
  ax /= al;
  az /= al;
  // The road's centreline beside the stop: the stop's offset from the junction's line, across.
  const jx = s.ix * BLOCK_SIZE;
  const jz = s.iz * BLOCK_SIZE;
  const kerbSide = (s.stopX - jx) * ax + (s.stopZ - jz) * az;
  const cx = s.stopX - ax * kerbSide;
  const cz = s.stopZ - az * kerbSide;
  // The getaway arrives along -f on the far lane and swerves across: it ends up nose-in toward the kerb.
  const crashHeading = Math.atan2(-fx + ax * 0.6, -fz + az * 0.6);
  return {
    stop: s,
    stand: { x: s.waitX + fx * STAND_AHEAD, z: s.waitZ + fz * STAND_AHEAD, heading: s.heading },
    crash: { x: cx + ax * CRASH_ACROSS + fx * CRASH_AHEAD, z: cz + az * CRASH_ACROSS + fz * CRASH_AHEAD, heading: crashHeading },
    getaway: { x: cx - ax * LANE_OFFSET + fx * GETAWAY_AHEAD, z: cz - az * LANE_OFFSET + fz * GETAWAY_AHEAD, heading: Math.atan2(-fx, -fz) },
    road: { x: cx, z: cz, fx, fz, back: BUS_BACK + 20, ahead: GETAWAY_AHEAD + 50, half: 9 },
  };
}

/** Road ahead of a stop to the next junction's middle, m. */
export function roomAhead(s: BusStop): number {
  const fx = Math.sin(s.stopHeading);
  const fz = Math.cos(s.stopHeading);
  return (s.ix * BLOCK_SIZE - s.stopX) * fx + (s.iz * BLOCK_SIZE - s.stopZ) * fz;
}

/**
 * Is the shelter on the south side of its road? The camera looks north
 * with a tilt (render/cameraRig.ts), so the building behind such a shelter
 * stands between the camera and the player.
 */
export function southSide(s: BusStop): boolean {
  const ax = s.waitX - s.stopX;
  const az = s.waitZ - s.stopZ;
  return az > 0.5 * Math.hypot(ax, az);
}

/** The shelter the opening plays at: the nearest to (x, z) in view of the camera, with room for the crash ahead of it (null if none). */
export function pickOpeningStop(stops: readonly BusStop[], x: number, z: number): BusStop | null {
  let best: BusStop | null = null;
  let bestD = Infinity;
  for (const s of stops) {
    if (roomAhead(s) < ROOM_AHEAD || southSide(s)) continue;
    const d = Math.hypot(s.waitX - x, s.waitZ - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Is (x, z) on the plan's road (to be cleared before the getaway comes)? */
export function onOpeningRoad(p: OpeningPlan, x: number, z: number): boolean {
  const r = p.road;
  const along = (x - r.x) * r.fx + (z - r.z) * r.fz;
  const across = (x - r.x) * r.fz - (z - r.z) * r.fx;
  return along > -r.back && along < r.ahead && Math.abs(across) < r.half;
}

/** Does PLAY start with the cold open? Not once it has run (or a save from before it skipped it). */
export function openingDue(save: Pick<SaveData, 'opening'>): boolean {
  return !save.opening;
}

/** Are Chaos Run, frenzies, races, exports and taxi fares open (on the title, in the street)? */
export function sideModesOpen(save: Pick<SaveData, 'missions' | 'unlocks'>): boolean {
  return save.missions.includes(SIDE_MODES_AFTER) || save.unlocks.includes(SIDE_MODES_UNLOCK);
}
