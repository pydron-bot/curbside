/**
 * JS time per frame by section (the crowd, traffic AI, scenes...), for
 * profiling the simulation in a harness (`__ub.simProfile`). Off by default:
 * then begin() and end() return at once. On, each frame's time per section
 * goes into a fixed ring; summary() gives the mean and p95 over it.
 * A section can be entered many times a frame (once per car); it adds up.
 */

/** Frames kept per section. */
const CAPACITY = 1800;

export interface SectionSummary {
  name: string;
  /** JS ms per frame. */
  mean: number;
  p95: number;
  max: number;
}

export class SectionTimes {
  enabled = false;
  private readonly frame: Float64Array;
  private readonly started: Float64Array;
  private readonly rings: Float32Array[];
  private head = 0;
  private count = 0;

  constructor(
    readonly names: readonly string[],
    private readonly now: () => number = () => performance.now(),
  ) {
    this.frame = new Float64Array(names.length);
    this.started = new Float64Array(names.length);
    this.rings = names.map(() => new Float32Array(CAPACITY));
  }

  begin(section: number): void {
    if (this.enabled) this.started[section] = this.now();
  }

  end(section: number): void {
    if (this.enabled) this.frame[section] += this.now() - this.started[section];
  }

  /** Add `ms` measured elsewhere to this frame's section. */
  add(section: number, ms: number): void {
    if (this.enabled) this.frame[section] += ms;
  }

  /** Close the frame: its totals go into the rings. */
  endFrame(): void {
    if (!this.enabled) return;
    for (let i = 0; i < this.names.length; i++) {
      this.rings[i][this.head] = this.frame[i];
      this.frame[i] = 0;
    }
    this.head = (this.head + 1) % CAPACITY;
    if (this.count < CAPACITY) this.count++;
  }

  /** Forget everything sampled (and start sampling). */
  start(): void {
    this.enabled = true;
    this.head = this.count = 0;
    this.frame.fill(0);
  }

  /** The last frame's time in `section`, ms. */
  last(section: number): number {
    return this.count ? this.rings[section][(this.head - 1 + CAPACITY) % CAPACITY] : 0;
  }

  /** Frames sampled. */
  get frames(): number {
    return this.count;
  }

  /** Mean, p95 and max per section over the sampled frames (allocates: call it now and then). */
  summary(): SectionSummary[] {
    return this.names.map((name, i) => {
      const xs = Array.from(this.rings[i].subarray(0, this.count)).sort((a, b) => a - b);
      const n = xs.length;
      const mean = n ? xs.reduce((s, x) => s + x, 0) / n : 0;
      const p95 = n ? xs[Math.min(n - 1, Math.ceil(0.95 * n) - 1)] : 0;
      return { name, mean, p95, max: n ? xs[n - 1] : 0 };
    });
  }
}
