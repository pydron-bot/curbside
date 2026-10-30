/**
 * Turns the flow of play into a music intensity 0..5. Mayhem (score awards,
 * explosions, gunfire, crashes) adds energy that drains away with a half-life;
 * the level climbs as soon as the energy crosses a threshold but only steps
 * down after it has stayed low for a while, so the soundtrack doesn't flap
 * between layers. Pure, so it's unit-tested.
 */
export interface ChaosOptions {
  /** Seconds for the energy to halve. */
  halfLife: number;
  /** Energy needed for levels 1..5. */
  thresholds: readonly number[];
  /** Seconds the energy must stay below a level before the music drops a layer. */
  holdDown: number;
  maxEnergy: number;
}

export const DEFAULT_CHAOS: ChaosOptions = {
  halfLife: 9,
  thresholds: [0.6, 1.5, 2.7, 4.1, 5.8],
  holdDown: 4,
  maxEnergy: 8,
};

export const MAX_INTENSITY = 5;

export class ChaosMeter {
  energy = 0;
  level = 0;
  private lowFor = 0;

  constructor(readonly opts: ChaosOptions = DEFAULT_CHAOS) {}

  add(amount: number): void {
    if (amount > 0) this.energy = Math.min(this.opts.maxEnergy, this.energy + amount);
  }

  /** Raw level for an energy, ignoring hysteresis. */
  levelFor(energy: number): number {
    let n = 0;
    for (const t of this.opts.thresholds) if (energy >= t) n++;
    return n;
  }

  step(dt: number): number {
    this.energy *= Math.pow(0.5, dt / this.opts.halfLife);
    const raw = this.levelFor(this.energy);
    if (raw > this.level) {
      this.level = raw;
      this.lowFor = 0;
    } else if (raw < this.level) {
      this.lowFor += dt;
      if (this.lowFor >= this.opts.holdDown) {
        this.level--;
        this.lowFor = 0;
      }
    } else {
      this.lowFor = 0;
    }
    return this.level;
  }

  reset(): void {
    this.energy = 0;
    this.level = 0;
    this.lowFor = 0;
  }
}
