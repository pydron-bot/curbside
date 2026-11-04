/**
 * What a frenzy the map adds (W3-D round 3) may ask: each goal's sensible
 * target and time limits, whether it needs a car, and the HUD title it
 * gets, the same as the shipped eight's (frenzies.ts). A leaf (types only),
 * so the map file's parser can read it without pulling in the game.
 */
import type { FrenzyGoal } from './frenzies';
import type { WeaponKind } from '../../systems/weapons';

export const FRENZY_GOALS: readonly FrenzyGoal[] = ['knockdown', 'wreck', 'drift', 'nearMiss', 'carjack', 'hitAndRun', 'smash', 'combo'];

/** Gifts a frenzy may hand over at GO (every weapon but the story's sticky charge). */
export const FRENZY_GIFTS: readonly WeaponKind[] = ['pistol', 'smg', 'shotgun', 'grenade', 'molotov', 'rocket', 'horn', 'taser', 'stinger', 'smoke'];

export interface FrenzyLimit {
  /** Target, inclusive; `step` apart (drift points come in hundreds). */
  target: readonly [number, number];
  step: number;
  /** Seconds, inclusive (5 s steps). */
  seconds: readonly [number, number];
  /** What the goal counts, for the editor. */
  label: string;
}

/** Room either side of the shipped frenzies' own (a combo can't count past ×10: frenzyCredit caps it). */
export const FRENZY_LIMITS: Readonly<Record<FrenzyGoal, FrenzyLimit>> = {
  knockdown: { target: [3, 40], step: 1, seconds: [20, 180], label: 'KNOCK DOWN PEOPLE' },
  wreck: { target: [2, 20], step: 1, seconds: [20, 180], label: 'WRECK CARS' },
  drift: { target: [500, 10000], step: 100, seconds: [15, 120], label: 'DRIFT POINTS' },
  nearMiss: { target: [3, 30], step: 1, seconds: [20, 120], label: 'NEAR MISSES' },
  carjack: { target: [2, 12], step: 1, seconds: [30, 240], label: 'CARJACKS' },
  hitAndRun: { target: [3, 30], step: 1, seconds: [20, 120], label: 'HIT & RUNS' },
  smash: { target: [3, 40], step: 1, seconds: [20, 120], label: 'SMASH THROUGH PROPS' },
  combo: { target: [3, 10], step: 1, seconds: [20, 120], label: 'COMBO LEVEL' },
};
export const SECONDS_STEP = 5;

/** The goals that only start from a car (as the shipped ones say needsCar). */
export const NEEDS_CAR_GOALS: ReadonlySet<FrenzyGoal> = new Set<FrenzyGoal>(['nearMiss', 'drift', 'hitAndRun', 'smash']);

/** A frenzy's definition as the map file holds it (the id and place are the spot's). */
export interface FrenzySpec {
  goal: FrenzyGoal;
  target: number;
  seconds: number;
  gift?: WeaponKind;
}

/** A new frenzy's starting values for `goal`: the middle of the shipped ones' ground. */
export const FRENZY_DEFAULTS: Readonly<Record<FrenzyGoal, { target: number; seconds: number }>> = {
  knockdown: { target: 15, seconds: 60 },
  wreck: { target: 6, seconds: 90 },
  drift: { target: 3000, seconds: 40 },
  nearMiss: { target: 8, seconds: 60 },
  carjack: { target: 5, seconds: 120 },
  hitAndRun: { target: 10, seconds: 60 },
  smash: { target: 12, seconds: 50 },
  combo: { target: 8, seconds: 45 },
};

const fmt = (n: number) => n.toLocaleString('en-GB');

/** The HUD's title for a goal and target, worded as the shipped frenzies' are ("KNOCK DOWN 15", "DRIFT 3,000"). */
export function frenzyTitle(goal: FrenzyGoal, target: number): string {
  switch (goal) {
    case 'knockdown':
      return `KNOCK DOWN ${target}`;
    case 'wreck':
      return `WRECK ${target} CAR${target === 1 ? '' : 'S'}`;
    case 'drift':
      return `DRIFT ${fmt(target)}`;
    case 'nearMiss':
      return `NEAR MISS ×${target}`;
    case 'carjack':
      return `CARJACK ${target}`;
    case 'hitAndRun':
      return `HIT & RUN ×${target}`;
    case 'smash':
      return `SMASH ×${target}`;
    default:
      return `HIT A ×${target} COMBO`;
  }
}

/** `v` into the goal's range, on its step. */
export function clampTarget(goal: FrenzyGoal, v: number): number {
  const l = FRENZY_LIMITS[goal];
  const s = Math.round(v / l.step) * l.step;
  return Math.min(l.target[1], Math.max(l.target[0], s));
}

export function clampSeconds(goal: FrenzyGoal, v: number): number {
  const l = FRENZY_LIMITS[goal];
  const s = Math.round(v / SECONDS_STEP) * SECONDS_STEP;
  return Math.min(l.seconds[1], Math.max(l.seconds[0], s));
}

/** What's off about a spec (empty: nothing): an unknown goal or gift, a target or time outside its goal's limits. */
export function frenzySpecProblems(f: { goal?: unknown; target?: unknown; seconds?: unknown; gift?: unknown } | undefined): string[] {
  if (!f) return ['has no frenzy (goal, target, seconds)'];
  if (!FRENZY_GOALS.includes(f.goal as FrenzyGoal)) return [`has no goal the game knows (${JSON.stringify(f.goal)})`];
  const l = FRENZY_LIMITS[f.goal as FrenzyGoal];
  const out: string[] = [];
  const t = f.target;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < l.target[0] || t > l.target[1] || t % l.step !== 0) {
    out.push(`its target must be ${fmt(l.target[0])} to ${fmt(l.target[1])}${l.step > 1 ? ` in ${l.step}s` : ''} for ${f.goal}`);
  }
  const s = f.seconds;
  if (typeof s !== 'number' || !Number.isFinite(s) || s < l.seconds[0] || s > l.seconds[1]) out.push(`its time must be ${l.seconds[0]} to ${l.seconds[1]} s for ${f.goal}`);
  if (f.gift !== undefined && !FRENZY_GIFTS.includes(f.gift as WeaponKind)) out.push(`its gift ${JSON.stringify(f.gift)} isn't a weapon it can hand over`);
  return out;
}
