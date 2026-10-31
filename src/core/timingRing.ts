/**
 * A fixed ring of timing samples (ms) summarised as average, p95 and max, in
 * the FrameStats pattern: no allocation, summarize() a few times a second.
 * Also keeps the average of each second of sampled time, because WebKit
 * without cross-origin isolation quantises performance.now() to ~1 ms: a
 * 0.3 ms step then reads 0 or 1 and p95 means little, but a second's mean
 * of many such reads is still unbiased.
 */

export interface TimingSummary {
  /** Mean, 95th percentile and max over the ring, ms. */
  avg: number;
  p95: number;
  max: number;
  /** Samples in the ring. */
  samples: number;
  /** Samples ever taken (since the last reset). */
  total: number;
  /** Worst and 95th-percentile per-second average over the second ring, ms. */
  secAvgMax: number;
  secAvgP95: number;
  /** Whole seconds in the second ring. */
  seconds: number;
}

export function emptyTiming(): TimingSummary {
  return { avg: 0, p95: 0, max: 0, samples: 0, total: 0, secAvgMax: 0, secAvgP95: 0, seconds: 0 };
}

/** Nearest-rank percentile of the first n entries of an ascending array. */
function rank(sorted: Float32Array, n: number, p: number): number {
  if (n === 0) return 0;
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
}

export class TimingRing {
  private readonly ring: Float32Array;
  private readonly sorted: Float32Array;
  private readonly secRing: Float32Array;
  private readonly secSorted: Float32Array;
  private head = 0;
  private count = 0;
  private total = 0;
  private secHead = 0;
  private secCount = 0;
  private secSum = 0;
  private secN = 0;
  private secT = 0;

  constructor(capacity = 600, seconds = 120) {
    this.ring = new Float32Array(capacity);
    this.sorted = new Float32Array(capacity);
    this.secRing = new Float32Array(seconds);
    this.secSorted = new Float32Array(seconds);
  }

  /** One sample of `ms`, covering `seconds` of the clock being timed (it rolls the per-second averages). */
  sample(ms: number, seconds: number): void {
    if (!(ms >= 0) || !Number.isFinite(ms)) return;
    const cap = this.ring.length;
    this.ring[this.head] = ms;
    this.head = (this.head + 1) % cap;
    if (this.count < cap) this.count++;
    this.total++;
    this.secSum += ms;
    this.secN++;
    this.secT += seconds > 0 ? seconds : 0;
    if (this.secT >= 1 - 1e-9) {
      const sc = this.secRing.length;
      this.secRing[this.secHead] = this.secSum / this.secN;
      this.secHead = (this.secHead + 1) % sc;
      if (this.secCount < sc) this.secCount++;
      this.secSum = 0;
      this.secN = 0;
      this.secT = 0;
    }
  }

  /** Fills and returns `out`. */
  summarize(out: TimingSummary): TimingSummary {
    const n = this.count;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = this.ring[i];
      this.sorted[i] = v;
      sum += v;
    }
    // Pad and sort the whole array: sorting a subarray would allocate a view.
    this.sorted.fill(Infinity, n);
    this.sorted.sort();
    out.avg = n > 0 ? sum / n : 0;
    out.p95 = rank(this.sorted, n, 0.95);
    out.max = n > 0 ? this.sorted[n - 1] : 0;
    out.samples = n;
    out.total = this.total;
    const m = this.secCount;
    for (let i = 0; i < m; i++) this.secSorted[i] = this.secRing[i];
    this.secSorted.fill(Infinity, m);
    this.secSorted.sort();
    out.secAvgMax = m > 0 ? this.secSorted[m - 1] : 0;
    out.secAvgP95 = rank(this.secSorted, m, 0.95);
    out.seconds = m;
    return out;
  }

  reset(): void {
    this.head = this.count = this.total = 0;
    this.secHead = this.secCount = 0;
    this.secSum = this.secN = this.secT = 0;
  }
}
