/**
 * VAN NICKED (V2-12): drive off in the ice cream van while people are
 * queueing at it and the queue comes after you on foot. Pure rules, tested
 * in tests/crashers.test.ts; game/scenes/vanNicked.ts runs them.
 *
 * - **Whose queue**: the city's van taken while it's open (the queue at
 *   its hatch: scenes/iceCream.ts) pays VAN NICKED once per van with
 *   NICK_PAY_QUEUE or more queueing; the player's own chime queue
 *   (Borrowed Blues, scenes/serviceTools.ts) chases the same way and pays
 *   nothing (it's your van already, and a chime is free to press).
 * - **When**: they stand and stare until the van has gone NICK_OFF m from
 *   where it stood (NICK_WAIT s of it not going and they shrug and walk
 *   on); then they run after the player (in the van, or out of it).
 * - **Giving up**: each after their own CHASE_FOR s, or once the player's
 *   CHASE_GAP m ahead of them; a glare for GLARE s and they walk on.
 *   Caught up, they stand round you waving their arms; nobody throws a
 *   punch, nobody calls the police (no heat: they're not witnesses, and
 *   hitting one is an assault like anyone else's).
 * - **Ice cream after all**: one who reaches the van parked with its chime
 *   on joins the chime's queue.
 */
import { len2 } from '../core/len';

/** The van's gone this far from where it stood: they're after it, m. */
export const NICK_OFF = 5;
/** It hasn't gone in this long: they walk on, s. */
export const NICK_WAIT = 8;
/** VAN NICKED pays for a queue this long or longer. */
export const NICK_PAY_QUEUE = 2;
/** Each chases for a while in this range, s. */
export const CHASE_FOR = [9, 15] as const;
/** The player this far ahead: that one gives up, m. */
export const CHASE_GAP = 32;
/** Stood glaring after you this long before walking on, s. */
export const GLARE = 1.6;
/** Round someone on foot at this, m; round a vehicle at its half-width plus this. */
export const SURROUND_FOOT = 1.3;
export const SURROUND_CAR = 1.2;
/** Within this of a van parked with its chime on: into its queue, m. */
export const QUEUE_REACH = 4.5;

/** Has the van gone far enough from (x0, z0) to be nicked? */
export function nickStarts(x0: number, z0: number, x: number, z: number): boolean {
  return len2(x - x0, z - z0) > NICK_OFF;
}

/** Does driving off with this queue pay VAN NICKED? */
export function nickPays(own: boolean, queued: number, paidBefore: boolean): boolean {
  return !own && !paidBefore && queued >= NICK_PAY_QUEUE;
}

/** A chaser `age` s in, after their own `limit`, `gap` m behind the player: still after them? */
export function chaserVerdict(age: number, limit: number, gap: number): 'chase' | 'giveUp' {
  return age >= limit || gap > CHASE_GAP ? 'giveUp' : 'chase';
}

/** Where the `i`th of `n` chasers runs to: a ring of `radius` m round (x, z), into `out`. */
export function surroundSpot(x: number, z: number, i: number, n: number, radius: number, out: { x: number; z: number }): { x: number; z: number } {
  const a = (i / Math.max(1, n)) * Math.PI * 2;
  out.x = x + Math.sin(a) * radius;
  out.z = z + Math.cos(a) * radius;
  return out;
}
