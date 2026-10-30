/**
 * CHAOS FRENZIES: eight pulsing tokens round the city, each a timed
 * rampage. Touch one, 3-2-1, then do the thing before the clock runs out:
 * knock 15 people down in a minute, wreck 6 cars, drift 3,000 points...
 * They count the same bus events the score does. Beating one pays $1,000
 * the first time (a replay pays FRENZY_REPLAY) and turns its token gold.
 * Pure logic; the glue is in frenzyMode.ts.
 */
import type { GameEvent } from '../../core/events';
import type { WeaponKind } from '../../systems/weapons';

export type FrenzyGoal = 'knockdown' | 'wreck' | 'drift' | 'nearMiss' | 'carjack' | 'hitAndRun' | 'smash' | 'combo';

export interface FrenzyDef {
  id: string;
  /** What to do, as the HUD says it: "KNOCK DOWN 15". */
  title: string;
  goal: FrenzyGoal;
  target: number;
  seconds: number;
  /** Only startable from a car (the goal needs one). */
  needsCar?: boolean;
  /** Handed over at GO, ammo and all. */
  gift?: WeaponKind;
}

export const FRENZY_PAY = 1000;
export const FRENZY_REPLAY = 150;
/** The 3-2-1 before a frenzy starts, s. */
export const FRENZY_COUNTDOWN = 3;

export const FRENZIES: readonly FrenzyDef[] = [
  { id: 'fz-brawl', title: 'KNOCK DOWN 15', goal: 'knockdown', target: 15, seconds: 60, gift: 'smg' },
  { id: 'fz-nearmiss', title: 'NEAR MISS ×8', goal: 'nearMiss', target: 8, seconds: 60, needsCar: true },
  { id: 'fz-carjack', title: 'CARJACK 5', goal: 'carjack', target: 5, seconds: 120 },
  { id: 'fz-drift', title: 'DRIFT 3,000', goal: 'drift', target: 3000, seconds: 40, needsCar: true },
  { id: 'fz-wreck', title: 'WRECK 6 CARS', goal: 'wreck', target: 6, seconds: 90, gift: 'shotgun' },
  { id: 'fz-hitrun', title: 'HIT & RUN ×10', goal: 'hitAndRun', target: 10, seconds: 60, needsCar: true },
  { id: 'fz-smash', title: 'SMASH ×12', goal: 'smash', target: 12, seconds: 50, needsCar: true },
  { id: 'fz-combo', title: 'HIT A ×8 COMBO', goal: 'combo', target: 8, seconds: 45 },
];

/**
 * How much a bus event counts toward `goal`: 1 per knockdown / wreck /
 * carjack / scored stunt, drift points for drifts, and for 'combo' the
 * combo level the award lifted the chain to (the run keeps the highest).
 */
export function frenzyCredit(goal: FrenzyGoal, e: GameEvent): number {
  switch (goal) {
    case 'knockdown':
      return e.type === 'pedDown' && e.byPlayer && !e.isPlayer ? 1 : 0;
    case 'wreck':
      return e.type === 'explosion' && e.byPlayer && !e.ownCar ? 1 : 0;
    case 'carjack':
      return e.type === 'carjack' ? 1 : 0;
    case 'drift':
      return e.type === 'award' && e.award.kind === 'drift' ? e.award.points : 0;
    case 'combo':
      return e.type === 'award' ? Math.min(10, e.award.multiplier + 1) : 0;
    default:
      return e.type === 'award' && e.award.kind === goal ? 1 : 0;
  }
}

export type FrenzyPhase = 'countdown' | 'live' | 'passed' | 'failed';

/** One attempt at a frenzy. */
export class FrenzyRun {
  phase: FrenzyPhase = 'countdown';
  /** Seconds of 3-2-1 left. */
  countdown = FRENZY_COUNTDOWN;
  timeLeft: number;
  count = 0;

  constructor(readonly def: FrenzyDef) {
    this.timeLeft = def.seconds;
  }

  get done(): boolean {
    return this.phase === 'passed' || this.phase === 'failed';
  }

  /** Feed a bus event; true if it counted. */
  event(e: GameEvent): boolean {
    if (this.phase !== 'live') return false;
    const c = frenzyCredit(this.def.goal, e);
    if (c <= 0) return false;
    this.count = this.def.goal === 'combo' ? Math.max(this.count, c) : this.count + c;
    if (this.count >= this.def.target) this.phase = 'passed';
    return true;
  }

  /** Advance the clock (the 3-2-1, then the challenge). Returns the phase. */
  step(dt: number): FrenzyPhase {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'live';
    } else if (this.phase === 'live') {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) this.phase = 'failed';
    }
    return this.phase;
  }

  /** Called off (WASTED, BUSTED, quit). */
  fail(): void {
    if (!this.done) this.phase = 'failed';
  }
}
