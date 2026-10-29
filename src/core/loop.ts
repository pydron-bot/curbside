/**
 * Fixed-timestep simulation driver.
 *
 * Simulation always advances in exact `stepSeconds` increments so physics is
 * deterministic and frame-rate independent. Rendering gets an `alpha` in [0,1)
 * to interpolate between the previous and current simulation state.
 */
export class FixedStep {
  private accumulator = 0;

  constructor(
    readonly stepSeconds = 1 / 60,
    /** Cap on steps per frame so a long stall can't snowball (spiral of death). */
    readonly maxStepsPerFrame = 5,
  ) {}

  /**
   * Feed elapsed real time; calls `step` zero or more times.
   * Returns the interpolation alpha for rendering.
   */
  advance(frameSeconds: number, step: (dt: number) => void): number {
    this.accumulator += Math.max(0, frameSeconds);
    let steps = 0;
    while (this.accumulator >= this.stepSeconds && steps < this.maxStepsPerFrame) {
      step(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      steps++;
    }
    if (steps === this.maxStepsPerFrame && this.accumulator >= this.stepSeconds) {
      // Drop the backlog rather than trying to catch up.
      this.accumulator = 0;
    }
    return this.accumulator / this.stepSeconds;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
