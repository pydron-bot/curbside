/**
 * What becomes of an ambient police chase (game/scenes/chases.ts) once the
 * player gets involved: asked first thing every chase step. Stars alone
 * change nothing (the city's chases run on while the player is wanted);
 * only the player's own part in this one does.
 *
 * - takeHeat: they're driving the getaway. TAKE THE HEAT: the chase cars
 *   nearby become their pursuit, and they're wanted (2 stars at least).
 * - turnedOn: they attacked this chase's police (and it cost them a star)
 *   with its cars close: the officers come after them instead.
 * - breakOff: the same, from far off: the chase just breaks off.
 * - continue: anything else, the chase carries on.
 *
 * Plus the two have-a-go rules: a bump on a chase car right after touching
 * the getaway is forgiven (touch steering is imprecise), and a getaway the
 * player stopped beside a patrol is their CITIZEN'S ARREST. Pure (no
 * three.js).
 */

export type Handoff = 'continue' | 'takeHeat' | 'turnedOn' | 'breakOff';

export interface HandoffSituation {
  /** The player's wanted stars. */
  stars: number;
  /** Driving the getaway while the police are still after it. */
  playerInGetaway: boolean;
  /** Within HANDOFF_RANGE of one of the chase's cars or officers. */
  playerNear: boolean;
  /** Rammed (unforgiven), shot at, floored or stole from this chase's police. */
  crimeOnThisChase: boolean;
}

/** Chase cars within this of the player join their pursuit, m. */
export const HANDOFF_RANGE = 80;
/** Taking the getaway lands on at least this many stars. */
export const TOOK_GETAWAY_STARS = 2;
/** A bump on a chase car this soon after touching the getaway is forgiven (once per car), s. */
export const FORGIVE_SECONDS = 3;
/** A getaway that stops this soon after the player touched it was stopped by them, s. */
export const HELPED_SECONDS = 5;
/** ...and it must stop within this of a chase patrol car, m. */
export const ARREST_GAP = 12;
/** A citizen's arrest pays this, $. */
export const CITIZENS_ARREST_REWARD = 150;

export function chaseHandoff(s: HandoffSituation): Handoff {
  if (s.playerInGetaway) return 'takeHeat';
  // A bump that cost no star changes nothing: the cops shrug it off, like any other.
  if (!s.crimeOnThisChase || s.stars <= 0) return 'continue';
  return s.playerNear ? 'turnedOn' : 'breakOff';
}

/** Is a bump on a chase car at `now` forgiven? The player touched the getaway at `touchedAt` (sim time). */
export function forgivenBump(now: number, touchedAt: number, alreadyForgiven: boolean): boolean {
  return !alreadyForgiven && now - touchedAt <= FORGIVE_SECONDS;
}

/** Did the player stop the getaway (touched at `touchedAt`) beside a patrol `copGap` m away? */
export function citizensArrest(now: number, touchedAt: number, copGap: number): boolean {
  return now - touchedAt <= HELPED_SECONDS && copGap < ARREST_GAP;
}
