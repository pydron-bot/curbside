/**
 * Your Mess, Their Problem (V2-10): the city taking over what the player
 * started. Pure rules, tested in tests/mess.test.ts; game/scenes/accidents.ts
 * (an adopted crash) and game/scenes/shotsFired.ts (gunfire called in) run
 * them, and SceneStarter carries a chain's cause from one scene to the next.
 *
 * - **Adopting a crash**: the player's hard hit on an ordinary car becomes
 *   an accident scene (the other driver out arguing, then a patrol and a
 *   tow) instead of the driver's usual panic, rage or bail. One at a time,
 *   never on a busy street, never a car someone else needs.
 * - **Dominoes**: every scene one thing sets off carries a cause, `root`
 *   (who started it: the player or the city) and `depth` (how many links
 *   from the root, the root itself 1, capped at DOMINO_CAP). A link of
 *   depth 2 or more rooted in the player pays DOMINO ×N; the city's own
 *   chains count the same way and pay nothing.
 * - **The patrol** a scene sends to the player's mess is the scene's, not
 *   one of the police's units: it can't see, chase or bust anyone. If the
 *   player is wanted and still there when it pulls up, it joins their
 *   pursuit (a unit from then on, under the usual rules: the bust meter
 *   still needs them stopped beside an officer); gone, it takes a statement
 *   and leaves.
 */
import type { Award, Score } from './score';

// --- Dominoes ---------------------------------------------------------------------

/** Who started a chain: the player (it can pay) or the city's own life (it never does). */
export type DominoRoot = 'player' | 'city';

/** What set a scene off: the chain's root and how far down it this link is (the root itself is 1). */
export interface Cause {
  readonly root: DominoRoot;
  readonly depth: number;
}

/** Links past this count as this (DOMINO ×4 at most). */
export const DOMINO_CAP = 4;
/** DOMINO pays by depth (index: depth; 0 and 1 pay nothing). */
export const DOMINO_BONUS: readonly number[] = [0, 0, 100, 200, 400];

/** The first link of a chain. */
export function rootCause(root: DominoRoot): Cause {
  return { root, depth: 1 };
}

/** The next link down from `by`: same root, one deeper, never past DOMINO_CAP. */
export function follows(by: Cause): Cause {
  return { root: by.root, depth: Math.min(DOMINO_CAP, Math.max(1, by.depth) + 1) };
}

/** Does this link pay? Only the player's chains, from the second link on. */
export function dominoPays(c: Cause): boolean {
  return c.root === 'player' && c.depth >= 2;
}

/** What a link at `depth` pays (on top of the score's base, which is 0). */
export function dominoBonus(depth: number): number {
  return DOMINO_BONUS[Math.max(0, Math.min(DOMINO_CAP, Math.floor(depth)))];
}

/** The feed's label for a link at `depth`: DOMINO ×2 .. DOMINO ×4. */
export function dominoLabel(depth: number): string {
  return `DOMINO ×${Math.max(1, Math.min(DOMINO_CAP, Math.floor(depth)))}`;
}

/** The award for a link (`domino` event), or null if it doesn't pay. */
export function dominoAward(score: Score, c: Cause): Award | null {
  if (!dominoPays(c)) return null;
  const a = score.award('domino', dominoBonus(c.depth));
  a.label = dominoLabel(c.depth);
  return a;
}

// --- Adopting the player's crash ----------------------------------------------------

/** A hit this hard (closing speed, m/s) is a crash worth stopping for; below it the usual reactions. */
export const ADOPT_IMPACT = 9;
/** Busy street: this many other cars within BUSY_RANGE of the crash... */
export const BUSY_CARS = 6;
export const BUSY_RANGE = 30;
/** ...or another scene's site (a crash left standing, a double-parked truck) within this, m. */
export const SITE_RANGE = 60;

/** What adoptVerdict() weighs. */
export interface CrashCheck {
  /** Closing speed, m/s. */
  impact: number;
  /** The 'mess' clock is due (its cooldown run down, nothing holding it off). */
  due: boolean;
  /** Adopted crashes still playing out. */
  running: number;
  /** The other car is an ordinary car nobody else has a use for (not police, a bike, a scene's, an activity's, the guard's). */
  ordinary: boolean;
  /** Other cars within BUSY_RANGE. */
  carsNear: number;
  /** Other scene sites within SITE_RANGE. */
  sitesNear: number;
}

/** adopt, or why not: too soft, held (clock, holds), one already on, not that car, a busy street. */
export type AdoptVerdict = 'adopt' | 'soft' | 'held' | 'one' | 'car' | 'busy';

/** Is the street too busy for a crash to stop in it (a jam would gridlock; a second site would crowd it)? */
export function busyStreet(carsNear: number, sitesNear: number): boolean {
  return carsNear >= BUSY_CARS || sitesNear > 0;
}

/** Does the city take over this crash? */
export function adoptVerdict(c: CrashCheck): AdoptVerdict {
  if (c.impact < ADOPT_IMPACT) return 'soft';
  if (c.running > 0) return 'one';
  if (!c.due) return 'held';
  if (!c.ordinary) return 'car';
  if (busyStreet(c.carsNear, c.sitesNear)) return 'busy';
  return 'adopt';
}

// --- The patrol at the player's mess ------------------------------------------------

/** The player within this of the patrol when it pulls up counts as still there, m. */
export const STILL_THERE = 30;

/** What a scene's patrol does on arrival: joins a wanted player's pursuit if they're still there, else takes a statement. */
export function patrolArrives(stars: number, playerDistance: number): 'joinPursuit' | 'statement' {
  return stars > 0 && playerDistance < STILL_THERE ? 'joinPursuit' : 'statement';
}

// --- Shots fired --------------------------------------------------------------------

/** A parked car this close to the shots has its alarm set off, m. */
export const SHOT_ALARM_RANGE = 25;
/** Passers-by within this of the shots hear them (whichever way they face), m. */
export const HEAR_RANGE = 40;
/** The call goes in once the shooting has stopped this long, s... */
export const CALL_AFTER = 2;
/** ...or this long after the first shot, whichever comes first, s. */
export const CALL_LATEST = 6;
/** The patrol looks round where the shots were for this long, s. */
export const LOOK_ROUND = 6;

/** Is it time to ask for a witness (the volley over, or going on too long)? */
export function callDue(sinceFirst: number, sinceLast: number): boolean {
  return sinceLast >= CALL_AFTER || sinceFirst >= CALL_LATEST;
}
