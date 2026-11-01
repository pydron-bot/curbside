/**
 * Gangs and respect: the rules, no three.js. A gang has turf (a district),
 * colours and a few hangouts on its pavements; its respect for the player
 * runs from -100 to 100 (saved), starting at 0.
 *
 *  - Knocking one of them down costs respect (more for a knockout); hurting
 *    the police on their turf earns a little (they like that), up to a cap.
 *  - Grudges fade: respect below zero drifts back toward it while you play.
 *  - Below HOSTILE_BELOW they come at you on sight (armed ones shoot); at or
 *    above FRIENDLY_FROM they leave you alone even if you start something.
 *    In between they mind their own business until you hit one of them,
 *    and then the whole hangout joins in.
 *
 * modes/gangMode.ts puts the members on the street and reads these rules.
 */
import { pavement } from './modes/places';
import type { BodyKind } from './bodies';
import type { District } from '../world/districts';

export interface GangDef {
  id: string;
  /** Shown on the area card, feed lines and PROGRESS ("VIPERS"). */
  name: string;
  /** The district they run. */
  turf: District;
  shirt: string;
  pants: string;
  /** Who they're drawn as (crowd bodies, so no extra draw calls). */
  bodies: readonly BodyKind[];
  /** Hangouts as [block x, block z, pavement edge, t], each a few members standing about. */
  hangouts: ReadonlyArray<readonly [number, number, number, number]>;
}

export const GANGS: readonly GangDef[] = [
  {
    id: 'vipers',
    name: 'VIPERS',
    turf: 'arts',
    shirt: '#8dff2e',
    pants: '#16161c',
    bodies: ['ped_slim', 'ped_stocky', 'ped_coat'],
    hangouts: [
      [10, 1, 0, 0.5],
      [13, 1, 0, 0.5],
      [11, 4, 0, 0.5],
      [14, 5, 0, 0.5],
      [12, 6, 0, 0.5],
    ],
  },
];

export const RESPECT_MIN = -100;
export const RESPECT_MAX = 100;
/** Below this they attack on sight. */
export const HOSTILE_BELOW = -25;
/** From this up they never turn on you. */
export const FRIENDLY_FROM = 50;
/** One of them knocked over by the player / knocked out. */
export const DOWN_COST = 6;
export const KO_COST = 10;
/** The player hurt the police on their turf: an officer down / a police car blown up. */
export const COP_DOWN_GAIN = 2;
export const COP_CAR_GAIN = 3;
/** What hurting the police can earn on its own (more needs gang jobs, later). */
export const COP_GAIN_CAP = 40;
/** A grudge fades by one point every this many seconds of play. */
export const FORGIVE_EVERY = 20;
/** Members at each hangout. */
export const CREW_SIZE = 3;

export type Standing = 'hostile' | 'neutral' | 'friendly';

export function standing(respect: number): Standing {
  return respect < HOSTILE_BELOW ? 'hostile' : respect >= FRIENDLY_FROM ? 'friendly' : 'neutral';
}

export function clampRespect(r: number): number {
  return Math.max(RESPECT_MIN, Math.min(RESPECT_MAX, Math.round(r)));
}

/** Respect after the player knocked one of them over (ko: knocked out). */
export function afterMemberDown(respect: number, ko: boolean): number {
  return clampRespect(respect - (ko ? KO_COST : DOWN_COST));
}

/** Respect after the player hurt the police on their turf (never past COP_GAIN_CAP this way). */
export function afterCopHurt(respect: number, gain: number): number {
  if (respect >= COP_GAIN_CAP) return respect;
  return clampRespect(Math.min(COP_GAIN_CAP, respect + gain));
}

/**
 * A grudge fading: `carry` is the seconds banked toward the next point.
 * Returns the new respect and carry (respect at or above 0 doesn't drift).
 */
export function forgive(respect: number, carry: number, dt: number): { respect: number; carry: number } {
  if (respect >= 0) return { respect, carry: 0 };
  carry += dt;
  let r = respect;
  while (carry >= FORGIVE_EVERY && r < 0) {
    carry -= FORGIVE_EVERY;
    r++;
  }
  return { respect: r, carry: r >= 0 ? 0 : carry };
}

/** The gang whose turf a district is, if any. */
export function gangOn(district: District): GangDef | null {
  return GANGS.find((g) => g.turf === district) ?? null;
}

export interface Hangout {
  id: string;
  gang: GangDef;
  x: number;
  z: number;
  /** Where each member stands: spread along the pavement round the spot. */
  members: Array<{ x: number; z: number }>;
}

/** Every gang's hangouts, with each member's spot (pure: the same city gives the same places). */
export function placeHangouts(gangs: readonly GangDef[] = GANGS): Hangout[] {
  const out: Hangout[] = [];
  for (const g of gangs) {
    g.hangouts.forEach(([bx, bz, edge, t], i) => {
      const centre = pavement(bx, bz, edge, t);
      const members: Array<{ x: number; z: number }> = [];
      // Along the pavement, a couple of metres apart (the edge is ~45 m long).
      for (let k = 0; k < CREW_SIZE; k++) members.push(pavement(bx, bz, edge, t + (k - (CREW_SIZE - 1) / 2) * 0.05));
      out.push({ id: `${g.id}-${i}`, gang: g, x: centre.x, z: centre.z, members });
    });
  }
  return out;
}
