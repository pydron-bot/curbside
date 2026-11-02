/**
 * What was on screen, as a handful of numbers, so a frame-rate drop in the
 * session log can be put down to something: particles and their fill,
 * glows, fires and blasts, rubble, people, cars and the city's scenes. The
 * render side fills a SceneCounts from pool counters (render/sceneCensus.ts);
 * this file is the pure part: the record, its text forms, the explosion
 * window and the dip detector. Nothing here allocates per frame.
 */

export interface SceneCounts {
  /** Live particles in the fire (hot) and smoke (soft) pools. */
  hot: number;
  soft: number;
  /** Particles drawn last frame over BIG_PARTICLE m across: the fill-heavy ones. */
  big: number;
  /** Transparent particle area drawn last frame over the visible ground's: screens of overdraw (est.). */
  fill: number;
  /** Glow sprites drawn last frame, and their area in screens. */
  glows: number;
  glowFill: number;
  /** Fires burning (the fire scene's), and how many of them are in view. */
  fires: number;
  firesSeen: number;
  /** Cars on fire, or wrecks still in flames. */
  burning: number;
  /** Explosions in the last BOOM_WINDOW s. */
  booms: number;
  /** Rubble bodies alive, and drawn last frame. */
  rubble: number;
  rubbleDrawn: number;
  /** People (everyone the renderer knows who is shown), and drawn last frame. */
  people: number;
  peopleSeen: number;
  cars: number;
  carsSeen: number;
  /** City scenes running, and which (`kind×n` by kind, space separated). */
  scenes: number;
  kinds: string;
}

/** A particle wider than this, m, counts as big. */
export const BIG_PARTICLE = 2.5;
/** Explosions are counted over this many recent seconds. */
export const BOOM_WINDOW = 10;

export function emptyCounts(): SceneCounts {
  return {
    hot: 0,
    soft: 0,
    big: 0,
    fill: 0,
    glows: 0,
    glowFill: 0,
    fires: 0,
    firesSeen: 0,
    burning: 0,
    booms: 0,
    rubble: 0,
    rubbleDrawn: 0,
    people: 0,
    peopleSeen: 0,
    cars: 0,
    carsSeen: 0,
    scenes: 0,
    kinds: '',
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A copy for the log: fills to 0.1, the rest whole. */
export function roundCounts(c: SceneCounts): SceneCounts {
  return { ...c, fill: r1(c.fill), glowFill: r1(c.glowFill) };
}

/** The Full perf overlay's line. */
export function formatCounts(c: SceneCounts): string {
  return (
    `fx ${c.hot}/${c.soft} big ${c.big} fill ${c.fill.toFixed(1)} · glow ${c.glows} (${c.glowFill.toFixed(1)})` +
    ` · fire ${c.firesSeen}/${c.fires} burn ${c.burning} boom ${c.booms}` +
    `\nppl ${c.peopleSeen}/${c.people} · cars ${c.carsSeen}/${c.cars} · scenes ${c.scenes}${c.kinds ? ` ${c.kinds}` : ''}` +
    (c.rubble > 0 ? ` · rubble ${c.rubbleDrawn}/${c.rubble}` : '')
  );
}

/** The Diagnostics summary's line. */
export function countsSummary(c: SceneCounts): string {
  return (
    `ON SCREEN particles ${c.hot} fire + ${c.soft} smoke (${c.big} big, fill ${c.fill.toFixed(1)}x) · glows ${c.glows} (${c.glowFill.toFixed(1)}x)` +
    ` · fires ${c.firesSeen}/${c.fires} · burning cars ${c.burning} · blasts/${BOOM_WINDOW}s ${c.booms}` +
    `\n          people ${c.peopleSeen}/${c.people} · cars ${c.carsSeen}/${c.cars} · rubble ${c.rubbleDrawn}/${c.rubble} · scenes ${c.scenes}${c.kinds ? ` (${c.kinds})` : ''}`
  );
}

/** Running scenes as `kind×n` words, in the order given. A few times a second at most: it builds a string. */
export function sceneKinds(labels: readonly string[], running: readonly number[]): { count: number; kinds: string } {
  let count = 0;
  let kinds = '';
  for (let i = 0; i < labels.length; i++) {
    const n = running[i] ?? 0;
    if (n <= 0) continue;
    count += n;
    kinds += `${kinds ? ' ' : ''}${labels[i]}${n > 1 ? `×${n}` : ''}`;
  }
  return { count, kinds };
}

/** Times of recent explosions in a fixed ring; counts those within BOOM_WINDOW. */
export class BoomWindow {
  private readonly times: Float64Array;
  private head = 0;

  constructor(capacity = 64) {
    this.times = new Float64Array(capacity).fill(-Infinity);
  }

  /** One went off at `nowS` (seconds, any clock). */
  add(nowS: number): void {
    this.times[this.head] = nowS;
    this.head = (this.head + 1) % this.times.length;
  }

  /** How many in the last `window` seconds before `nowS`. */
  count(nowS: number, window = BOOM_WINDOW): number {
    let n = 0;
    for (let i = 0; i < this.times.length; i++) if (nowS - this.times[i] <= window) n++;
    return n;
  }

  clear(): void {
    this.times.fill(-Infinity);
  }
}

/** A frame over this is slow, ms (40 fps). */
export const DIP_FRAME_MS = 25;
/** Frames are judged in windows this long, ms. */
export const DIP_WINDOW_MS = 1000;
/** At most one dip per this long, ms. */
export const DIP_COOLDOWN_MS = 5000;
/** A window needs this many frames to count (one long stall is not a dip). */
const DIP_MIN_FRAMES = 10;
const WINDOW_SLOTS = 256;

export interface DipWindow {
  fps: number;
  p95: number;
  max: number;
  /** The window's JS p95 (main-thread ms per frame): high with slow frames means CPU-bound, low means the GPU (or the browser). */
  js: number;
}

/**
 * Spots sustained slow frames: the frames of each DIP_WINDOW_MS window are
 * ranked, and a window whose p95 is over DIP_FRAME_MS is a dip, at most one
 * per DIP_COOLDOWN_MS. `sample()` runs every frame; it sorts a fixed array
 * once per window, nothing more. The clock is the summed frame intervals,
 * so paused time (no frames) doesn't count.
 */
export class DipDetector {
  private readonly frames = new Float32Array(WINDOW_SLOTS);
  private readonly js = new Float32Array(WINDOW_SLOTS);
  private n = 0;
  private count = 0;
  private elapsed = 0;
  private sinceDip = Infinity;
  /** The window that made the last dip. */
  readonly last: DipWindow = { fps: 0, p95: 0, max: 0, js: 0 };

  /** One frame's interval and its JS time, ms. True when it closes a window that is a dip. */
  sample(intervalMs: number, jsMs = 0): boolean {
    if (!(intervalMs > 0) || !Number.isFinite(intervalMs)) return false;
    if (this.n < WINDOW_SLOTS) {
      this.js[this.n] = jsMs > 0 ? jsMs : 0;
      this.frames[this.n++] = intervalMs;
    }
    this.count++;
    this.elapsed += intervalMs;
    this.sinceDip += intervalMs;
    if (this.elapsed < DIP_WINDOW_MS) return false;
    const f = this.frames;
    const n = this.n;
    f.fill(Infinity, n);
    f.sort();
    const rank95 = Math.min(n - 1, Math.max(0, Math.ceil(0.95 * n) - 1));
    const p95 = f[rank95];
    const max = f[n - 1];
    const js = this.js;
    js.fill(Infinity, n);
    js.sort();
    const jsP95 = js[rank95];
    const fps = (this.count * 1000) / this.elapsed;
    const enough = this.count >= DIP_MIN_FRAMES;
    this.n = 0;
    this.count = 0;
    this.elapsed = 0;
    if (!enough || p95 <= DIP_FRAME_MS || this.sinceDip < DIP_COOLDOWN_MS) return false;
    this.sinceDip = 0;
    this.last.fps = fps;
    this.last.p95 = p95;
    this.last.max = max;
    this.last.js = jsP95;
    return true;
  }

  reset(): void {
    this.n = 0;
    this.count = 0;
    this.elapsed = 0;
  }
}
