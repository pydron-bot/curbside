/**
 * Witnesses to the player's lesser crimes (game/scenes/witnesses.ts runs
 * them): who saw it (close enough and facing roughly that way), what each
 * does (calls it in, films it on their phone, or runs), and a call in
 * progress, which only gets through if the caller is left standing and the
 * player stays in range until it does. Heat (game/heat.ts) hands a lesser
 * crime seen only by passers-by to the witnesses through its `witnesses`
 * hook; a call that gets through commits it then. Pure, no three.js,
 * tested in tests/witnesses.test.ts.
 */
import { len2 } from '../core/len';
import type { Crime } from './wanted';

/**
 * Crimes passers-by can call in later instead of the heat landing at once:
 * knocking a civilian down and taking a car off its driver. Gunfire,
 * explosions and anything against the police stay immediate (heard
 * everywhere, or seen by the police themselves).
 */
export const DELAYED_CRIMES: ReadonlySet<Crime> = new Set<Crime>(['assault', 'carjack']);

/** A passer-by sees a crime this close, m... */
export const SEE_RANGE = 26;
/** ...facing within this of it (cos of the half-angle: ±75°); right beside it they notice anyway. */
const SEE_COS = Math.cos((75 * Math.PI) / 180);
const NOTICE_ANYWAY = 4;
/** A call takes this long to get through, s (random in the range). */
export const CALL_SECONDS = [3, 5] as const;
/** The call's dropped if the player gets this far from the caller first, m. */
export const CALL_RANGE = 45;

/** Did someone at (x, z) facing `heading` see something at (cx, cz)? */
export function sees(x: number, z: number, heading: number, cx: number, cz: number, range = SEE_RANGE): boolean {
  const dx = cx - x;
  const dz = cz - z;
  if (Math.abs(dx) > range || Math.abs(dz) > range) return false;
  const d = len2(dx, dz);
  if (d > range) return false;
  if (d < NOTICE_ANYWAY) return true;
  return (Math.sin(heading) * dx + Math.cos(heading) * dz) / d >= SEE_COS;
}

export type Reaction = 'call' | 'film' | 'flee';

/**
 * What a witness does. The first (nearest) one calls if a call can still
 * be made (`canCall`); the rest call now and then (a second caller), film
 * or run.
 */
export function react(rand: () => number, first: boolean, canCall: boolean): Reaction {
  const r = rand();
  if (canCall && (first || r < 0.2)) return 'call';
  return r < 0.5 ? 'film' : 'flee';
}

export type CallPhase = 'calling' | 'through' | 'dropped';

export interface CallState {
  phase: CallPhase;
  /** Seconds on the phone. */
  time: number;
  /** Seconds the call takes to get through. */
  needs: number;
}

/**
 * One step of a call. `callerOk`: the caller's still on their feet, not
 * scared off or fighting; `playerDistance`: how far the player is from
 * them, m. Through once it's taken its time; dropped if the caller's taken
 * out or the player's got clear first.
 */
export function stepCall(c: CallState, dt: number, callerOk: boolean, playerDistance: number): CallPhase {
  if (c.phase !== 'calling') return c.phase;
  if (!callerOk || playerDistance > CALL_RANGE) return (c.phase = 'dropped');
  c.time += dt;
  if (c.time >= c.needs) c.phase = 'through';
  return c.phase;
}
