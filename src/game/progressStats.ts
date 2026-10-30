/**
 * How far through the game a save is: one completion figure over the story,
 * the activities and the collectibles, for the PROGRESS page. Pure,
 * unit-tested.
 */
import type { Medal, SaveData } from './progressSave';

/** Each part's share of 100%. */
export const COMPLETION_WEIGHTS = {
  missions: 0.3,
  frenzies: 0.15,
  packages: 0.15,
  races: 0.15,
  exports: 0.1,
  taxi: 0.1,
  chaosRun: 0.05,
} as const;

/** Fares that count as having done the taxi job. */
export const TAXI_GOAL = 10;
/** A medal's worth toward completing a race or the Chaos Run. */
export const MEDAL_WORTH: Readonly<Record<Medal, number>> = { bronze: 1 / 3, silver: 2 / 3, gold: 1 };

export interface CompletionTotals {
  missions: number;
  frenzies: number;
  packages: number;
  /** Race ids. */
  races: readonly string[];
  /** Orders on an export list. */
  exportOrders: number;
}

/** Each part's progress, 0..1. */
export function completionParts(s: SaveData, t: CompletionTotals): Record<keyof typeof COMPLETION_WEIGHTS, number> {
  const frac = (n: number, of: number) => (of > 0 ? Math.min(1, n / of) : 0);
  const medal = (id: string) => {
    const m = s.medals[id];
    return m ? MEDAL_WORTH[m] : 0;
  };
  return {
    missions: frac(s.missions.length, t.missions),
    frenzies: frac(s.frenzies.length, t.frenzies),
    packages: frac(s.packages.length, t.packages),
    races: t.races.length ? t.races.reduce((sum, id) => sum + medal(id), 0) / t.races.length : 0,
    exports: s.exports.lists > 0 ? 1 : frac(s.exports.done.length, t.exportOrders),
    taxi: frac(s.stats.fares, TAXI_GOAL),
    chaosRun: medal('chaosRun'),
  };
}

/** Overall completion, 0..1. */
export function completion(s: SaveData, t: CompletionTotals): number {
  const parts = completionParts(s, t);
  let sum = 0;
  for (const k of Object.keys(COMPLETION_WEIGHTS) as Array<keyof typeof COMPLETION_WEIGHTS>) sum += COMPLETION_WEIGHTS[k] * parts[k];
  return Math.min(1, sum);
}
