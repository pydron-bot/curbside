/**
 * Frame-time statistics for the perf overlay. Unlike DynamicResolution's
 * judged-window mean (which skips warmup, stalls and outliers on purpose),
 * this keeps every frame, so jank shows. Fixed rings, no allocation: sample()
 * runs every frame, summarize() a few times a second.
 */

/** Enough frames for the percentile window at 120 Hz. */
const CAPACITY = 1200;
/** fps is counted over this much recent time, ms. */
const FPS_WINDOW = 1000;
/** Percentiles and hitch rates cover this much recent time, ms. */
const STATS_WINDOW = 10_000;
/** Sort at most this often (in sampled time), ms. */
const SORT_EVERY = 250;
export const HITCH_MS = 50;
export const BIG_HITCH_MS = 100;

export interface FrameSummary {
  /** Frames per second over the last second (fractional when slow). */
  fps: number;
  /** Frame interval percentiles and max over the stats window, ms. */
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Frames over HITCH_MS / BIG_HITCH_MS, per minute of the stats window. */
  hitchesPerMin: number;
  bigHitchesPerMin: number;
  /** JS time per frame (main-loop work, not GPU), ms. */
  jsP95: number;
  /** Frames in the stats window. */
  frames: number;
  /** Steady ~33 ms frames: Safari's Low Power Mode caps rAF at 30 Hz. */
  capped30: boolean;
}

export function emptySummary(): FrameSummary {
  return { fps: 0, p50: 0, p95: 0, p99: 0, max: 0, hitchesPerMin: 0, bigHitchesPerMin: 0, jsP95: 0, frames: 0, capped30: false };
}

/** Nearest-rank percentile of the first n entries of an ascending array. */
function rank(sorted: Float32Array, n: number, p: number): number {
  if (n === 0) return 0;
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
}

export class FrameStats {
  private readonly intervals = new Float32Array(CAPACITY);
  private readonly js = new Float32Array(CAPACITY);
  private readonly sortedIntervals = new Float32Array(CAPACITY);
  private readonly sortedJs = new Float32Array(CAPACITY);
  private head = 0;
  private count = 0;
  /** Sum of all sampled intervals: the clock the sort throttle runs on. */
  private clock = 0;
  private sortedAt = -Infinity;
  private readonly cached = emptySummary();

  /** One frame: real time since the previous frame and JS time spent in it, ms. */
  sample(intervalMs: number, jsMs: number): void {
    if (!(intervalMs > 0) || !Number.isFinite(intervalMs)) return;
    this.intervals[this.head] = intervalMs;
    this.js[this.head] = jsMs > 0 ? jsMs : 0;
    this.head = (this.head + 1) % CAPACITY;
    if (this.count < CAPACITY) this.count++;
    this.clock += intervalMs;
  }

  /** Fills `out` (reused by the caller); percentiles refresh at most every SORT_EVERY ms. */
  summarize(out: FrameSummary): FrameSummary {
    const c = this.cached;
    c.fps = this.fps();
    if (this.clock - this.sortedAt >= SORT_EVERY) {
      this.sortedAt = this.clock;
      this.refresh(c);
    }
    out.fps = c.fps;
    out.p50 = c.p50;
    out.p95 = c.p95;
    out.p99 = c.p99;
    out.max = c.max;
    out.hitchesPerMin = c.hitchesPerMin;
    out.bigHitchesPerMin = c.bigHitchesPerMin;
    out.jsP95 = c.jsP95;
    out.frames = c.frames;
    out.capped30 = c.capped30;
    return out;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.clock = 0;
    this.sortedAt = -Infinity;
  }

  /** Index of the i-th newest sample (0 = newest). */
  private at(i: number): number {
    return (this.head - 1 - i + CAPACITY) % CAPACITY;
  }

  private fps(): number {
    let sum = 0;
    let n = 0;
    while (n < this.count && sum < FPS_WINDOW) sum += this.intervals[this.at(n++)];
    return sum > 0 ? (n * 1000) / sum : 0;
  }

  private refresh(c: FrameSummary): void {
    const si = this.sortedIntervals;
    const sj = this.sortedJs;
    let sum = 0;
    let n = 0;
    let hitches = 0;
    let big = 0;
    while (n < this.count && sum < STATS_WINDOW) {
      const k = this.at(n);
      const v = this.intervals[k];
      si[n] = v;
      sj[n] = this.js[k];
      sum += v;
      if (v > HITCH_MS) hitches++;
      if (v > BIG_HITCH_MS) big++;
      n++;
    }
    // Pad and sort the whole array: sorting a subarray would allocate a view.
    si.fill(Infinity, n);
    sj.fill(Infinity, n);
    si.sort();
    sj.sort();
    c.frames = n;
    c.p50 = rank(si, n, 0.5);
    c.p95 = rank(si, n, 0.95);
    c.p99 = rank(si, n, 0.99);
    c.max = n > 0 ? si[n - 1] : 0;
    c.jsP95 = rank(sj, n, 0.95);
    const perMin = sum > 0 ? 60_000 / sum : 0;
    c.hitchesPerMin = hitches * perMin;
    c.bigHitchesPerMin = big * perMin;
    c.capped30 = n >= 30 && c.p50 > 30 && c.p50 < 36 && c.p95 < 40;
  }
}

const fmt = (ms: number) => (ms >= 100 ? String(Math.round(ms)) : ms.toFixed(1));

/** fps as shown: whole numbers, one decimal when slow (so 0.4 fps doesn't read 0). */
export function formatFps(fps: number): string {
  return fps >= 10 ? String(Math.round(fps)) : fps.toFixed(1);
}

/** The overlay's frame-time line for 'full' mode. */
export function formatFrameStats(s: FrameSummary): string {
  return (
    `${formatFps(s.fps)} fps · ${fmt(s.p50)}/${fmt(s.p95)}/${fmt(s.p99)}/${fmt(s.max)} ms` +
    ` · ${Math.round(s.hitchesPerMin)} hitch/min · JS p95 ${fmt(s.jsP95)} ms${s.capped30 ? ' · 30 Hz (Low Power Mode?)' : ''}`
  );
}
