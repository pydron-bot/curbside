/**
 * Chaos score with a combo chain: every stunt or bit of mayhem within
 * COMBO_WINDOW seconds of the last bumps the multiplier (up to MAX_COMBO).
 * Drifts accrue while sliding and are banked when the slide ends.
 */
export type ScoreKind = 'drift' | 'nearMiss' | 'smash' | 'hitAndRun' | 'knockout' | 'carjack' | 'boom';

export const BASE_POINTS: Record<Exclude<ScoreKind, 'drift'>, number> = {
  nearMiss: 100,
  smash: 60,
  hitAndRun: 120,
  knockout: 150,
  carjack: 250,
  boom: 500,
};

export const LABELS: Record<ScoreKind, string> = {
  drift: 'DRIFT',
  nearMiss: 'NEAR MISS',
  smash: 'SMASH',
  hitAndRun: 'HIT & RUN',
  knockout: 'KNOCKOUT',
  carjack: 'CARJACK',
  boom: 'KABOOM',
};

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
