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
 *   (CPU-bound or capped): it's undone, and drops pause for a while.
 * - The first seconds after boot, resume or a big asset load are noise.
 */

/** One rung of the quality ladder. */
export interface QualityLevel {
  tier: QualityTierName;
  pixelRatio: number;
}

const RATIO_STEP = 0.25;

/**
 * Best to cheapest. With `auto`, effects tiers step down first at the
 * starting pixel ratio, then resolution steps down to the floor (1.0 on
 * high-DPI screens, LOW_DPI_FLOOR on 1x ones).
 */
export function buildLadder(start: QualityTierName, auto: boolean, devicePixelRatio: number): QualityLevel[] {
  const dpr = devicePixelRatio || 1;
  const top = Math.min(QUALITY_TIERS[start].maxPixelRatio, dpr);
  const tiers = auto ? TIER_ORDER.slice(TIER_ORDER.indexOf(start)) : [start];
  const levels: QualityLevel[] = tiers.map((tier) => ({ tier, pixelRatio: top }));
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
  probeSeconds: 2,
  minImprovement: 0.1,
  dropBackoff: 30,
  raiseBackoff: 30,
  slack: 1.12,
};

/** We aim for 60 fps; a faster display (120/144 Hz) needn't be matched. */
const TARGET_INTERVAL = 1000 / 60;
/** Intervals longer than this are a stall (tab switch, debugger), not load. */
const STALL_MS = 250;
const MAX_SAMPLES = 512;

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
  /** Set right after a drop, to check it was worth it. */
  private probe: { from: number; baseline: number; until: number } | null = null;

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
    this.probe = null;
    this.goodRun = this.slowRun = 0;
    this.holdOff();
  }

  /** Ignore frames for a while (resume, context restored, big asset loaded). */
  holdOff(seconds = this.options.warmupSeconds): void {
    this.warmup = Math.max(this.warmup, seconds);
    this.count = 0;
    this.windowTime = 0;
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
    const changed = this.judgeWindow();
    this.count = 0;
    this.windowTime = 0;
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
    if (steady && (this.refreshInterval === 0 || interval < this.refreshInterval)) this.refreshInterval = interval;
    this.lastInterval = interval;

    // Until a steady window shows the real refresh rate, assume 60 Hz.
    const refresh = this.refreshInterval || TARGET_INTERVAL;
    const target = Math.max(refresh, TARGET_INTERVAL) * o.slack;
    let verdict: WindowVerdict;
    if (interval <= target) verdict = 'good';
    else if (steady && isMultiple(interval, refresh)) verdict = 'capped';
    else verdict = 'slow';
    this.lastVerdict = verdict;

    // Judge the last drop once it has had time to show.
    if (this.probe && this.now >= this.probe.until) {
      const { from, baseline } = this.probe;
      this.probe = null;
      if (verdict !== 'good' && baseline / interval - 1 < o.minImprovement) {
        // Didn't help: put it back and stop trying for a while.
        this.level = from;
        this.dropsBlockedUntil = this.now + this.dropBackoff;
        this.dropBackoff = Math.min(this.dropBackoff * 2, 240);
        this.goodRun = this.slowRun = 0;
        return true;
      }
    }

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

    const canDrop = this.level < this.ladder.length - 1 && this.now >= this.dropsBlockedUntil && !this.probe;
    if (this.slowRun >= o.dropAfter && canDrop) {
      if (this.now - this.lastRaise < o.dropAfter + 2 * w) {
        // The last raise was one step too far: wait longer before the next.
        this.raisesBlockedUntil = this.now + this.raiseBackoff;
        this.raiseBackoff = Math.min(this.raiseBackoff * 2, 160);
      }
      this.probe = { from: this.level, baseline: interval, until: this.now + o.probeSeconds };
      this.level++;
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
      this.lastRaise = this.now;
      this.goodRun = 0;
      return true;
    }
    return false;
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

  /** Feed the time since the last frame. */
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

  summary(): string {
    const c = this.controller;
    const fps = c.lastInterval > 0 ? Math.round(1000 / c.lastInterval) : 0;
    const capped = c.lastVerdict === 'capped' ? ' capped' : '';
    return `${fps} fps${capped} · ${c.current.pixelRatio.toFixed(2)}x ${c.current.tier}`;
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
    if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    setQualityTier(tier);
  }
}
