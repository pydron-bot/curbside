import type { WebGLRenderer } from 'three';
import { onSettingsChange, settings } from '../core/settings';
import {
  LOW_DPI_FLOOR,
  QUALITY_TIERS,
  TIER_ORDER,
  getDevice,
  preferredTier,
  refreshDevice,
  setQualityTier,
  type QualityTierName,
} from './quality';

/**
 * Keeps frames on time by trading quality: first effects tiers (when the
 * quality setting is 'auto'), then resolution, and climbs back when there's
 * room. The decisions are made by ResolutionController, which is pure (fed
 * frame intervals, no DOM or renderer) and unit-tested.
 *
 * What it has to get right on phones:
 * - A steady 33.3 ms (or any whole multiple of the refresh interval) with
 *   little jitter is a cap — iOS Low Power Mode, a hot phone, a 30 Hz
 *   display — not an overloaded GPU, so it must not drop resolution for it.
 * - rAF never runs faster than the display, so "at the refresh rate" doesn't
 *   prove there's headroom: raises are cautious (6 s good, at most one per
 *   10 s) and a raise that promptly fails backs off longer each time.
 * - A drop that doesn't make frames at least 10% faster wasn't helping
 *   (CPU-bound or capped): it's undone, and drops pause for a while. It's
 *   judged on several seconds each side (a phone in Low Power Mode misses
 *   30 Hz ticks at random, so one-second windows let noise keep a useless
 *   drop: an iPhone went from medium@1.5x to low@1x, losing its shadows,
 *   at the same ~24 fps), and audited again over 10 s once kept. An
 *   effects-only drop (same pixel ratio) is the exception: when the GPU is
 *   busy filling pixels, dropping bloom or shadows may not show, so it's kept
 *   and the next, resolution drop is judged against where the run began.
 * - The first seconds after boot, resume or a big asset load are noise.
 */

/** One rung of the quality ladder. */
export interface QualityLevel {
  tier: QualityTierName;
  pixelRatio: number;
}

const RATIO_STEP = 0.25;

/**
 * Best to cheapest. Each tier sits at its own pixel-ratio cap, so with `auto`
 * a tier step usually lowers resolution too (phone: medium@1.5 → low@1.25;
 * desktop: high@2 → medium@1.5 → low@1.25); then resolution alone steps down
 * to the floor (1.0 on high-DPI screens, LOW_DPI_FLOOR on 1x ones).
 */
export function buildLadder(start: QualityTierName, auto: boolean, devicePixelRatio: number): QualityLevel[] {
  const dpr = devicePixelRatio || 1;
  const tiers = auto ? TIER_ORDER.slice(TIER_ORDER.indexOf(start)) : [start];
  const levels: QualityLevel[] = [];
  let top = dpr;
  for (const tier of tiers) {
    top = Math.min(top, QUALITY_TIERS[tier].maxPixelRatio);
    levels.push({ tier, pixelRatio: round2(top) });
  }
  const last = tiers[tiers.length - 1];
  const floor = Math.min(top, dpr >= 2 ? QUALITY_TIERS[last].minPixelRatio : LOW_DPI_FLOOR);
  for (let r = top - RATIO_STEP; r > floor + 1e-6; r -= RATIO_STEP) levels.push({ tier: last, pixelRatio: round2(r) });
  if (floor < top - 1e-6) levels.push({ tier: last, pixelRatio: round2(floor) });
  return levels;
}

export interface ControllerOptions {
  /** Ignore this long after start / resume / hitches, s. */
  warmupSeconds: number;
  /** Frames are judged in windows this long, s. */
  windowSeconds: number;
  /** Consecutive slow time before stepping down, s. */
  dropAfter: number;
  /** Consecutive good time before stepping up, s. */
  raiseAfter: number;
  /** At most one raise per this long, s. */
  raiseCooldown: number;
  /** No raise this soon after a drop, s. */
  raiseAfterDrop: number;
  /** After a drop, judge whether it helped over this long, s. */
  probeSeconds: number;
  /** A kept run of drops is checked again over this long at a settled level, s. */
  auditSeconds: number;
  /** A drop must make frames this much faster to stay (0.1 = 10%). */
  minImprovement: number;
  /** First pause on drops after one didn't help, s (doubles each time). */
  dropBackoff: number;
  /** First pause on raises after one promptly failed, s (doubles each time). */
  raiseBackoff: number;
  /** Frames count as on time within this factor of the target interval. */
  slack: number;
}

export const DEFAULT_OPTIONS: ControllerOptions = {
  warmupSeconds: 3,
  windowSeconds: 1,
  dropAfter: 2,
  raiseAfter: 6,
  raiseCooldown: 10,
  raiseAfterDrop: 8,
  probeSeconds: 3,
  auditSeconds: 10,
  minImprovement: 0.1,
  dropBackoff: 30,
  raiseBackoff: 30,
  slack: 1.12,
};

/** We aim for 60 fps; a faster display (120/144 Hz) needn't be matched. */
const TARGET_INTERVAL = 1000 / 60;
/**
 * Intervals longer than this are a stall (tab switch, GC, shader compile),
 * not load. Kept under main's 0.25 s sim clamp so it works on clamped input too.
 */
export const STALL_MS = 200;
const MAX_SAMPLES = 512;
/**
 * A drop's baseline is the mean of up to this many windows since the last
 * level change, and needs at least MIN_BASELINE of them: the few slow
 * windows that set a drop off are a biased sample on their own.
 */
const BASELINE_WINDOWS = 10;
const MIN_BASELINE = 4;
/** A steady window slower than this isn't a display's refresh (30 Hz at the slowest), ms. */
const MAX_REFRESH = 35;

export type WindowVerdict = 'good' | 'capped' | 'slow';

export class ResolutionController {
  readonly options: ControllerOptions;
  level = 0;
  /** Typical frame interval of the last judged window (trimmed mean), ms; 0 until one completes. */
  lastInterval = 0;
  lastVerdict: WindowVerdict | null = null;
  /** Shortest steady interval seen: the display's refresh interval, ms (0 = unknown). */
  refreshInterval = 0;
  private ladder: QualityLevel[];
  private readonly samples = new Float64Array(MAX_SAMPLES);
  private readonly sorted = new Float64Array(MAX_SAMPLES);
  private count = 0;
  private windowTime = 0;
  private warmup: number;
  private now = 0;
  private goodRun = 0;
  private slowRun = 0;
  private lastRaise = -Infinity;
  private lastDrop = -Infinity;
  private dropsBlockedUntil = 0;
  private raisesBlockedUntil = 0;
  private dropBackoff: number;
  private raiseBackoff: number;
  /**
   * Set right after a drop, to check it was worth it: `from` and `baseline`
   * are the level and frame interval where this run of drops began.
   */
  private probe: { from: number; baseline: number; until: number; sum: number; n: number } | null = null;
  /** A kept run of drops, checked again once settled: `from` and `baseline` as for the probe. */
  private audit: { from: number; baseline: number; sum: number; n: number } | null = null;
  /** Interval of the windows judged since the last level change (newest last, at most BASELINE_WINDOWS). */
  private readonly recent = new Float64Array(BASELINE_WINDOWS);
  private recentCount = 0;
  /** An effects-only drop that didn't help yet: the next drop is judged together with it. */
  private carry: { from: number; baseline: number } | null = null;

  constructor(ladder: QualityLevel[], options: Partial<ControllerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.ladder = ladder;
    this.warmup = this.options.warmupSeconds;
    this.dropBackoff = this.options.dropBackoff;
    this.raiseBackoff = this.options.raiseBackoff;
  }

  get current(): QualityLevel {
    return this.ladder[this.level];
  }

  get levels(): readonly QualityLevel[] {
    return this.ladder;
  }

  /** New ladder (setting or screen changed): back to the top, judged afresh. */
  setLadder(ladder: QualityLevel[]): void {
    this.ladder = ladder;
    this.level = 0;
    this.probe = this.carry = this.audit = null;
    this.recentCount = 0;
    this.goodRun = this.slowRun = 0;
    this.holdOff();
  }

  /** Ignore frames for a while (resume, context restored, big asset loaded). */
  holdOff(seconds = this.options.warmupSeconds): void {
    this.warmup = Math.max(this.warmup, seconds);
    // Whatever comes after the pause is judged afresh.
    this.carry = null;
    this.count = 0;
    this.windowTime = 0;
    this.recentCount = 0;
    if (this.audit) this.audit.sum = this.audit.n = 0;
  }

  /** Feed one frame interval (ms). Returns true when the level changed. */
  sample(intervalMs: number): boolean {
    if (!(intervalMs > 0)) return false;
    if (intervalMs > STALL_MS) {
      this.holdOff(1);
      return false;
    }
    const seconds = intervalMs / 1000;
    this.now += seconds;
    if (this.warmup > 0) {
      this.warmup -= seconds;
      return false;
    }
    if (this.count < MAX_SAMPLES) this.samples[this.count++] = intervalMs;
    this.windowTime += seconds;
    if (this.windowTime < this.options.windowSeconds) return false;
    const from = this.level;
    const changed = this.judgeWindow();
    this.count = 0;
    this.windowTime = 0;
    if (this.level !== from) this.recentCount = 0;
    return changed;
  }

  private judgeWindow(): boolean {
    const o = this.options;
    const n = this.count;
    const sorted = this.sorted.subarray(0, n);
    sorted.set(this.samples.subarray(0, n));
    sorted.sort();
    // Mean with the odd hitch trimmed off each end: unlike the median it
    // sees a 16.7/33.3 alternation (vsync misses) for what it is, ~25 ms.
    const trim = Math.max(1, Math.floor(n * 0.05));
    let sum = 0;
    for (let i = trim; i < n - trim; i++) sum += sorted[i];
    const interval = n > 2 * trim ? sum / (n - 2 * trim) : sorted[n >> 1];
    // Spread of the middle half: small when every frame takes the same time.
    const spread = sorted[Math.floor(n * 0.75)] - sorted[Math.floor(n * 0.25)];
    const steady = spread < Math.max(1, interval * 0.06);
    if (steady && interval < MAX_REFRESH && (this.refreshInterval === 0 || interval < this.refreshInterval)) this.refreshInterval = interval;
    this.lastInterval = interval;
    if (this.recentCount === BASELINE_WINDOWS) this.recent.copyWithin(0, 1);
    else this.recentCount++;
    this.recent[this.recentCount - 1] = interval;

    // Until a steady window shows the real refresh rate, assume 60 Hz.
    const refresh = this.refreshInterval || TARGET_INTERVAL;
    const target = Math.max(refresh, TARGET_INTERVAL) * o.slack;
    let verdict: WindowVerdict;
    if (interval <= target) verdict = 'good';
    else if (steady && isMultiple(interval, refresh)) verdict = 'capped';
    else verdict = 'slow';
    this.lastVerdict = verdict;

    // Judge the last drop once it has had time to show, on every window since.
    if (this.probe) {
      this.probe.sum += interval;
      this.probe.n++;
    }
    if (this.probe && this.now >= this.probe.until) {
      const { from, baseline } = this.probe;
      const after = this.probe.sum / this.probe.n;
      this.probe = null;
      if (after > target && baseline / after - 1 < o.minImprovement) {
        const effectsOnly = this.ladder[this.level].pixelRatio >= this.ladder[from].pixelRatio;
        if (verdict === 'slow' && effectsOnly && this.level < this.ladder.length - 1) {
          // Fewer effects may cost nothing to a GPU that's busy filling
          // pixels: keep the step and let the next one, which lowers
          // resolution, be judged against where this run began.
          this.carry = { from, baseline };
        } else {
          return this.undo(from);
        }
      } else if (this.audit) {
        this.audit.sum = this.audit.n = 0;
      } else {
        this.audit = { from, baseline, sum: 0, n: 0 };
      }
    } else if (this.audit && !this.probe) {
      // A kept drop must still pay once things settle; noise can pass a probe.
      const a = this.audit;
      a.sum += interval;
      a.n++;
      if (a.n * o.windowSeconds >= o.auditSeconds) {
        const mean = a.sum / a.n;
        this.audit = null;
        if (a.baseline / mean - 1 < o.minImprovement) return this.undo(a.from);
      }
    }
    if (verdict !== 'slow') this.carry = null;

    const w = o.windowSeconds;
    if (verdict === 'good') {
      this.goodRun += w;
      this.slowRun = 0;
    } else if (verdict === 'slow') {
      this.slowRun += w;
      this.goodRun = 0;
    } else {
      this.goodRun = this.slowRun = 0;
    }

    const canDrop =
      this.level < this.ladder.length - 1 && this.now >= this.dropsBlockedUntil && !this.probe && (this.carry !== null || this.recentCount >= MIN_BASELINE);
    if (this.slowRun >= o.dropAfter && canDrop) {
      if (this.now - this.lastRaise < Math.max(o.dropAfter, MIN_BASELINE * w) + 2 * w) {
        // The last raise was one step too far: wait longer before the next.
        this.raisesBlockedUntil = this.now + this.raiseBackoff;
        this.raiseBackoff = Math.min(this.raiseBackoff * 2, 160);
      }
      const run = this.carry ?? { from: this.level, baseline: this.recentMean() };
      this.carry = null;
      this.probe = { from: run.from, baseline: run.baseline, until: this.now + o.probeSeconds, sum: 0, n: 0 };
      this.level++;
      if (this.audit) this.audit.sum = this.audit.n = 0;
      this.lastDrop = this.now;
      this.slowRun = this.goodRun = 0;
      return true;
    }
    const canRaise =
      this.level > 0 &&
      this.now - this.lastRaise >= o.raiseCooldown &&
      this.now - this.lastDrop >= o.raiseAfterDrop &&
      this.now >= this.raisesBlockedUntil;
    if (this.goodRun >= o.raiseAfter && canRaise) {
      this.level--;
      this.audit = null;
      this.lastRaise = this.now;
      this.goodRun = 0;
      return true;
    }
    return false;
  }

  /** Mean of the windows since the last level change: a drop's baseline. */
  private recentMean(): number {
    let sum = 0;
    for (let i = 0; i < this.recentCount; i++) sum += this.recent[i];
    return this.recentCount ? sum / this.recentCount : this.lastInterval;
  }

  /** Didn't help (CPU-bound or capped): put it all back and stop trying for a while. */
  private undo(from: number): boolean {
    this.level = from;
    // An earlier kept drop below this one is still on trial.
    if (this.audit && this.audit.from < from) this.audit.sum = this.audit.n = 0;
    else this.audit = null;
    this.dropsBlockedUntil = this.now + this.dropBackoff;
    this.dropBackoff = Math.min(this.dropBackoff * 2, 240);
    this.goodRun = this.slowRun = 0;
    return true;
  }
}

/** Is `interval` close to a whole multiple (2x, 3x, ...) of `base`? */
function isMultiple(interval: number, base: number): boolean {
  const k = Math.round(interval / base);
  return k >= 2 && Math.abs(interval - k * base) < base * 0.08;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * `?renderScale=0.35` (test harnesses only): draw the canvas at that share of
 * the chosen pixel ratio. Software rendering (SwiftShader in the smoke test)
 * costs by the pixel; draw calls, tiers and effects stay as chosen.
 */
export function renderScaleFrom(search: string): number {
  const v = Number(new URLSearchParams(search).get('renderScale'));
  return Number.isFinite(v) && v > 0 ? Math.min(1, Math.max(0.1, v)) : 1;
}
const RENDER_SCALE = typeof location === 'undefined' ? 1 : renderScaleFrom(location.search);

/** Applies ResolutionController decisions to the renderer and the quality tier. */
export class DynamicResolution {
  private readonly controller: ResolutionController;
  private dprCheck = 0;
  private lastQuality = settings.quality;

  constructor(private readonly renderer: WebGLRenderer) {
    this.controller = new ResolutionController(this.ladder());
    this.apply();
    onSettingsChange((s) => {
      if (s.quality === this.lastQuality) return;
      this.lastQuality = s.quality;
      this.rebuild();
    });
  }

  /** Feed the real time since the last frame (unclamped, so stalls show as stalls). */
  sample(frameSeconds: number): void {
    if (this.controller.sample(frameSeconds * 1000)) this.apply();
    // Moved to a screen with a different pixel ratio? (checked once a second)
    if ((this.dprCheck += frameSeconds) > 1) {
      this.dprCheck = 0;
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      if (dpr !== getDevice().pixelRatio) {
        refreshDevice();
        this.rebuild();
      }
    }
  }

  /** Ignore frame times for a while (resume, context restore, asset loads). */
  holdOff(seconds?: number): void {
    this.controller.holdOff(seconds);
  }

  get pixelRatio(): number {
    return this.controller.current.pixelRatio;
  }

  /** Pixel ratio and tier for the perf overlay (fps comes from FrameStats, which sees every frame). */
  summary(): string {
    const c = this.controller;
    const capped = c.lastVerdict === 'capped' ? ' capped' : '';
    return `${c.current.pixelRatio.toFixed(2)}x ${c.current.tier}${capped}`;
  }

  /**
   * The GPU breakdown only (render/gpuLayers.ts), while paused: draw at k ×
   * the chosen pixel ratio; 1 puts it back.
   */
  probeScale(k: number): void {
    const drawn = this.controller.current.pixelRatio * RENDER_SCALE * k;
    if (this.renderer.getPixelRatio() !== drawn) this.renderer.setPixelRatio(drawn);
  }

  private ladder(): QualityLevel[] {
    return buildLadder(preferredTier(), settings.quality === 'auto', getDevice().pixelRatio);
  }

  private rebuild(): void {
    this.controller.setLadder(this.ladder());
    this.apply();
  }

  private apply(): void {
    const { pixelRatio, tier } = this.controller.current;
    const drawn = pixelRatio * RENDER_SCALE;
    if (this.renderer.getPixelRatio() !== drawn) this.renderer.setPixelRatio(drawn);
    setQualityTier(tier);
  }
}
