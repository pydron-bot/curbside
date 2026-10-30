/**
 * Chaos score with a combo chain: every stunt or bit of mayhem within
 * COMBO_WINDOW seconds of the last bumps the multiplier (up to MAX_COMBO).
 * Drifts accrue while sliding and are banked when the slide ends.
 */
export type ScoreKind =
  | 'drift'
  | 'nearMiss'
  | 'smash'
  | 'hitAndRun'
  | 'knockout'
  | 'carjack'
  | 'boom'
  | 'copRam'
  | 'copWreck'
  | 'evaded'
  | 'stunt';

export const BASE_POINTS: Record<Exclude<ScoreKind, 'drift'>, number> = {
  nearMiss: 100,
  smash: 60,
  hitAndRun: 120,
  knockout: 150,
  carjack: 250,
  boom: 500,
  copRam: 200,
  copWreck: 750,
  // All bonus: see evadeBonus().
  evaded: 0,
  // All bonus: see systems/stunts.ts.
  stunt: 0,
};

export const LABELS: Record<ScoreKind, string> = {
  drift: 'DRIFT',
  nearMiss: 'NEAR MISS',
  smash: 'SMASH',
  hitAndRun: 'HIT & RUN',
  knockout: 'KNOCKOUT',
  carjack: 'CARJACK',
  boom: 'KABOOM',
  copRam: 'COP RAM',
  copWreck: 'COP CAR WRECKED',
  evaded: 'EVADED',
  stunt: 'STUNT',
};

/** Shaking off a chase of this many stars or more earns the EVADED bonus. */
export const EVADE_BONUS_FROM = 3;

/** The EVADED bonus for losing a chase that peaked at `stars` (0 below EVADE_BONUS_FROM). */
export function evadeBonus(stars: number): number {
  return stars >= EVADE_BONUS_FROM ? 1000 * stars : 0;
}

/** A car-on-car hit harder than this (m/s closing) can score SMASH. */
export const SMASH_MIN_IMPACT = 6;
/** Rammer, not victim: bring at least this much closing speed (m/s)... */
export const RAM_MIN_CLOSING = 3;
/** ...and this share of the total, so a head-on (half each) counts for both. */
export const RAM_MIN_SHARE = 0.4;

/**
 * Whether a car rammed the other, from each one's share of the closing
 * speed (CarContact.closingA/B). Being rear-ended, T-boned or PIT-ed while
 * slow or stopped is not ramming.
 */
export function rammed(own: number, other: number): boolean {
  return own >= RAM_MIN_CLOSING && own >= RAM_MIN_SHARE * (own + Math.max(0, other));
}

/** SMASH pays only the car that did the ramming. */
export function smashCredit(impact: number, own: number, other: number): boolean {
  return impact > SMASH_MIN_IMPACT && rammed(own, other);
}

export const COMBO_WINDOW = 3;
export const MAX_COMBO = 10;
/** Drift points per second per m/s of sideways slip. */
const DRIFT_RATE = 12;
/** A slide must stop for this long before it's banked (forgives wobbles). */
const DRIFT_GRACE = 0.35;
const MIN_DRIFT_BANK = 60;

export interface Award {
  kind: ScoreKind;
  label: string;
  points: number;
  multiplier: number;
}

export class Score {
  total = 0;
  combo = 1;
  /** Seconds left before the chain breaks. */
  comboTimer = 0;
  driftPoints = 0;
  private driftIdle = 0;

  constructor(public best = 0) {}

  award(kind: Exclude<ScoreKind, 'drift'>, bonus = 0): Award {
    return this.bank(kind, BASE_POINTS[kind] + bonus);
  }

  /** Call every step while driving; returns an Award when a drift is banked. */
  drift(slip: number, speed: number, dt: number): Award | null {
    if (slip > 3.5 && speed > 8) {
      this.driftPoints += slip * DRIFT_RATE * dt;
      this.driftIdle = 0;
      this.comboTimer = Math.max(this.comboTimer, 0.5); // a live drift keeps the chain alive
      return null;
    }
    if (this.driftPoints <= 0) return null;
    this.driftIdle += dt;
    if (this.driftIdle < DRIFT_GRACE) return null;
    const pts = Math.round(this.driftPoints);
    this.driftPoints = 0;
    return pts >= MIN_DRIFT_BANK ? this.bank('drift', pts) : null;
  }

  /**
   * The slide is over for good (got out, car blew up): bank what's pending if
   * `bank` and it's worth it, else drop it. Either way the counter clears so it
   * can't be banked later at a different multiplier.
   */
  endDrift(bank: boolean): Award | null {
    const pts = Math.round(this.driftPoints);
    this.driftPoints = 0;
    this.driftIdle = 0;
    return bank && pts >= MIN_DRIFT_BANK ? this.bank('drift', pts) : null;
  }

  /**
   * Busted: the run keeps going but loses `fraction` of its points, and the
   * combo and any slide in progress. Returns the points taken.
   */
  fine(fraction: number): number {
    const taken = Math.round(this.total * Math.max(0, Math.min(1, fraction)));
    this.total -= taken;
    this.combo = 1;
    this.comboTimer = 0;
    this.driftPoints = 0;
    this.driftIdle = 0;
    return taken;
  }

  /** Start a fresh run (after dying); the best score is kept. */
  resetRun(): void {
    this.total = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.driftPoints = 0;
    this.driftIdle = 0;
  }

  step(dt: number): void {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        this.combo = 1;
      }
    }
  }

  private bank(kind: ScoreKind, base: number): Award {
    const multiplier = this.combo;
    const points = Math.round(base * multiplier);
    this.total += points;
    this.best = Math.max(this.best, this.total);
    this.combo = Math.min(MAX_COMBO, this.combo + 1);
    this.comboTimer = COMBO_WINDOW;
    return { kind, label: LABELS[kind], points, multiplier };
  }
}
