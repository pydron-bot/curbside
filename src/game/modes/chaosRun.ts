/**
 * CHAOS RUN: two minutes to score as much as you can. The clock buys time
 * back for mayhem (+5 s for every explosion you cause, +3 s each time a
 * chain reaches ×5), the last ten seconds count down out loud, and the run
 * ends with a medal and a breakdown of where the points came from. Getting
 * WASTED or BUSTED ends the run early with what you had. Pure logic: the
 * glue (car, HUD, results card) is in chaosRunMode.ts.
 */
import type { Award, ScoreKind } from '../../systems/score';
import type { Arsenal, WeaponKind } from '../../systems/weapons';
import type { Medal } from '../progressSave';

export const CHAOS_RUN_ID = 'chaosRun';
export const CHAOS_RUN_SECONDS = 120;
/** Seconds back for each explosion the player causes. */
export const BOOM_BONUS = 5;
/** Seconds back when a chain reaches COMBO_BONUS_AT. */
export const COMBO_BONUS = 3;
export const COMBO_BONUS_AT = 5;
/** The clock counts down out loud from here, s. */
export const FINAL_COUNT = 10;
/** Medal thresholds (points), tuned with scripted runs (see README). */
export const CHAOS_MEDALS: Readonly<Record<Medal, number>> = { bronze: 15_000, silver: 40_000, gold: 80_000 };

/**
 * The run's sports car is armoured: ×1.5 its health, so a run that drives
 * like a Chaos Run should (into things) keeps its car for more than 20 s.
 */
export const CHAOS_CAR_HEALTH = 1.5;

/**
 * Every run starts with the same guns (one clip each), whatever free roam or
 * the shop left in the pockets: rockets and grenades are worth KABOOMs and
 * +5 s a time, so carrying them in would buy medals.
 */
export const CHAOS_LOADOUT: readonly WeaponKind[] = ['pistol'];

/** Empty the arsenal and hand over the run's loadout. */
export function armForRun(arsenal: Arsenal): void {
  arsenal.clear();
  for (const k of CHAOS_LOADOUT) arsenal.pickUp(k);
}

export function chaosMedal(score: number): Medal | null {
  if (score >= CHAOS_MEDALS.gold) return 'gold';
  if (score >= CHAOS_MEDALS.silver) return 'silver';
  if (score >= CHAOS_MEDALS.bronze) return 'bronze';
  return null;
}

/** The next medal up from `score` and what it takes, or null at gold. */
export function nextMedal(score: number): { medal: Medal; at: number } | null {
  for (const medal of ['bronze', 'silver', 'gold'] as const) {
    if (score < CHAOS_MEDALS[medal]) return { medal, at: CHAOS_MEDALS[medal] };
  }
  return null;
}

/** How the results card groups the score kinds. */
export type ChaosCategory = 'drift' | 'nearMiss' | 'smash' | 'hitAndRun' | 'knockout' | 'carjack' | 'boom' | 'stunt' | 'cops';
export const CHAOS_CATEGORIES: ReadonlyArray<{ id: ChaosCategory; label: string }> = [
  { id: 'drift', label: 'DRIFT' },
  { id: 'nearMiss', label: 'NEAR MISS' },
  { id: 'smash', label: 'SMASH' },
  { id: 'hitAndRun', label: 'HIT & RUN' },
  { id: 'knockout', label: 'KO' },
  { id: 'carjack', label: 'CARJACK' },
  { id: 'boom', label: 'BOOM' },
  { id: 'stunt', label: 'STUNTS' },
  { id: 'cops', label: 'COPS' },
];

export function categoryOf(kind: ScoreKind): ChaosCategory {
  return kind === 'copRam' || kind === 'copWreck' || kind === 'evaded' ? 'cops' : kind;
}

export type ChaosEnd = 'time' | 'wasted' | 'busted';

/** Something the presentation should react to this step. */
export type ChaosCue =
  | { kind: 'bonus'; seconds: number; why: 'boom' | 'combo' }
  | { kind: 'count'; n: number }
  | { kind: 'end'; reason: ChaosEnd };

export class ChaosRun {
  timeLeft = CHAOS_RUN_SECONDS;
  elapsed = 0;
  /** Seconds the run bought back. */
  bonusTime = 0;
  ended: ChaosEnd | null = null;
  readonly tally = {} as Record<ChaosCategory, { count: number; points: number }>;
  /** Cues since the last drain (reused array; the caller empties it). */
  readonly cues: ChaosCue[] = [];

  constructor() {
    for (const c of CHAOS_CATEGORIES) this.tally[c.id] = { count: 0, points: 0 };
  }

  get running(): boolean {
    return this.ended === null;
  }

  /** An award was scored. */
  award(a: Award): void {
    // Time up still tallies through the slow-mo (the results count those points).
    if (!this.running && this.ended !== 'time') return;
    const t = this.tally[categoryOf(a.kind)];
    t.count++;
    t.points += a.points;
    // The award was scored at ×multiplier and lifts the combo by one.
    if (this.running && a.multiplier + 1 === COMBO_BONUS_AT) this.addTime(COMBO_BONUS, 'combo');
  }

  /** Something blew up (byPlayer: the player caused it; ownCar: it was their car). */
  explosion(byPlayer: boolean, ownCar: boolean): void {
    if (this.running && byPlayer && !ownCar) this.addTime(BOOM_BONUS, 'boom');
  }

  /** Advance the clock; cues (count, end) collect in `cues`. */
  step(dt: number): void {
    if (!this.running) return;
    const before = this.timeLeft;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.elapsed += dt;
    // Each whole second crossed inside the final count: 10, 9, ... 1.
    const from = Math.ceil(before);
    const to = Math.ceil(this.timeLeft);
    if (to < from && to >= 1 && to <= FINAL_COUNT) this.cues.push({ kind: 'count', n: to });
    if (this.timeLeft <= 0) this.end('time');
  }

  /** The run is over (time up, or cut short). */
  end(reason: ChaosEnd): void {
    if (!this.running) return;
    this.ended = reason;
    this.cues.push({ kind: 'end', reason });
  }

  private addTime(seconds: number, why: 'boom' | 'combo'): void {
    this.timeLeft += seconds;
    this.bonusTime += seconds;
    this.cues.push({ kind: 'bonus', seconds, why });
  }
}
