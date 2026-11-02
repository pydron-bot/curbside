/**
 * The title screen's show (pure, tested in tests/attractShow.test.ts): when
 * to cut away from cruising traffic to a city scene and back, which scene
 * comes next, the fade for a long cut, and where to put the camera so the
 * subject sits in the open screen to the right of the menu column.
 *
 * The runtime (game/attractHighlights.ts) starts the scenes and says when
 * one has something to watch; ui/attract.ts flies the camera.
 */

// --- Rotation ------------------------------------------------------------------

/** Every item once in a shuffled round, then a fresh shuffle; never the same twice running. */
export class Rotation<T> {
  private bag: T[] = [];
  private last: T | null = null;

  constructor(
    private readonly items: readonly T[],
    private readonly rand: () => number,
  ) {}

  next(): T {
    if (this.bag.length === 0) this.refill();
    const t = this.bag.pop()!;
    this.last = t;
    return t;
  }

  private refill(): void {
    const b = this.bag;
    b.push(...this.items);
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    // Drawn from the end: don't open the round with the one that closed the last.
    if (b.length > 1 && b[b.length - 1] === this.last) [b[0], b[b.length - 1]] = [b[b.length - 1], b[0]];
  }
}

// --- Timing ----------------------------------------------------------------------

export interface ShowTiming {
  /** Cruising between highlights, s. */
  cruise: readonly [number, number];
  /** Cruising before the first one after the title opens, s. */
  first: readonly [number, number];
  /** A started scene has this long to show something before the next is tried, s. */
  settle: number;
  /** Most time on one highlight, s. */
  watch: readonly [number, number];
  /** Stay on a resolved one this long before cruising on, s. */
  linger: number;
  /** Highlights tried in a row (none would start) before cruising again. */
  tries: number;
  /** Not ready (the title's closed): look again in this long, s. */
  recheck: number;
}

export const SHOW_TIMING: ShowTiming = {
  cruise: [15, 25],
  first: [10, 14],
  settle: 8,
  watch: [25, 40],
  linger: 3,
  tries: 4,
  recheck: 2,
};

/** What the show asks of the city. */
export interface ShowStage<Id> {
  /** May a highlight start now (the title is up)? */
  ready(): boolean;
  /** Start one; false if it can't (no cars, no room). */
  start(id: Id): boolean;
  /** Does it have something to watch right now? False once it's resolved. */
  live(id: Id): boolean;
  /** The show is done with it. */
  stop(id: Id): void;
}

export type ShowPhase = 'cruise' | 'cue' | 'watch' | 'linger';
/** 'cut': a highlight just came live (take the camera there); 'release': back to cruising. */
export type ShowCue = 'cut' | 'release' | null;

/**
 * Cruise → (start a scene) cue → (it shows something) watch → (resolved)
 * linger → cruise; watch also ends after its time. A scene that won't start
 * or never shows anything is skipped for the next.
 */
export class AttractShow<Id> {
  phase: ShowPhase = 'cruise';
  current: Id | null = null;
  /** Seconds into the phase. */
  age = 0;
  private timer = 0;
  private failed = 0;
  private readonly rotation: Rotation<Id>;

  constructor(
    ids: readonly Id[],
    private readonly rand: () => number,
    readonly timing: ShowTiming = SHOW_TIMING,
  ) {
    this.rotation = new Rotation(ids, rand);
    this.reset();
  }

  /** Back to cruising, the first highlight a short wait off (the caller stops any scene). */
  reset(): void {
    this.phase = 'cruise';
    this.current = null;
    this.failed = 0;
    this.age = 0;
    this.timer = this.pick(this.timing.first);
  }

  step(dt: number, stage: ShowStage<Id>): ShowCue {
    const t = this.timing;
    this.age += dt;
    this.timer -= dt;
    switch (this.phase) {
      case 'cruise':
        if (this.timer > 0) return null;
        if (!stage.ready()) {
          this.timer = t.recheck;
          return null;
        }
        this.tryNext(stage);
        return null;
      case 'cue': {
        const id = this.current!;
        if (stage.live(id)) {
          this.to('watch', this.pick(t.watch));
          this.failed = 0;
          return 'cut';
        }
        if (this.timer > 0) return null;
        // Started but nothing to see: skip it.
        stage.stop(id);
        this.current = null;
        this.failed++;
        this.to('cruise', 0);
        if (this.failed >= t.tries) this.rest();
        return null;
      }
      case 'watch':
        if (!stage.live(this.current!)) this.to('linger', t.linger);
        else if (this.timer <= 0) return this.release(stage);
        return null;
      case 'linger':
        return this.timer <= 0 ? this.release(stage) : null;
    }
  }

  /** Start the next in the rotation that will; after `tries` refusals, cruise a while. */
  private tryNext(stage: ShowStage<Id>): void {
    while (this.failed < this.timing.tries) {
      const id = this.rotation.next();
      if (stage.start(id)) {
        this.current = id;
        this.to('cue', this.timing.settle);
        return;
      }
      this.failed++;
    }
    this.rest();
  }

  private release(stage: ShowStage<Id>): ShowCue {
    stage.stop(this.current!);
    this.current = null;
    this.to('cruise', this.pick(this.timing.cruise));
    return 'release';
  }

  /** Nothing would start: cruise a full wait. */
  private rest(): void {
    this.failed = 0;
    this.to('cruise', this.pick(this.timing.cruise));
  }

  private to(phase: ShowPhase, timer: number): void {
    this.phase = phase;
    this.timer = timer;
    this.age = 0;
  }

  private pick([lo, hi]: readonly [number, number]): number {
    return lo + this.rand() * (hi - lo);
  }
}

// --- Cuts ----------------------------------------------------------------------------

/** A long cut: fade the city out over FADE_OUT, move the camera, fade back in over FADE_IN, s. */
export const FADE_OUT = 0.3;
export const FADE_IN = 0.5;
/** Closer than this (m) and on screen, the camera glides over instead of cutting. */
export const GLIDE_RANGE = 45;

/** How dark the city is `t` s into a cut (0 clear, 1 black); smooth at both ends. */
export function fadeAlpha(t: number): number {
  if (t < 0) return 0;
  if (t < FADE_OUT) return smooth(t / FADE_OUT);
  const u = (t - FADE_OUT) / FADE_IN;
  return u >= 1 ? 0 : 1 - smooth(u);
}

function smooth(u: number): number {
  return u * u * (3 - 2 * u);
}

// --- Framing -----------------------------------------------------------------------

/** The menu never takes more than this share of the width for framing (a narrow window). */
const MENU_SHARE_MAX = 0.7;

/**
 * Screen px from the centre to the middle of the free area right of the
 * menu column (its right edge `menuRight` px, in a `viewW` px wide view).
 */
export function freeCentreOffsetPx(menuRight: number, viewW: number): number {
  const m = Math.max(0, Math.min(menuRight, viewW * MENU_SHARE_MAX));
  return m / 2;
}

/**
 * Ground metres per screen px across the middle of the view, for the rig's
 * near-overhead camera: `height` m up, sat `tilt` × height back, vertical
 * FOV `fovDeg`, `aspect` width / height, `viewW` px wide. The ground line
 * through the look point is all at one depth, so this is exact there.
 */
export function groundPerPx(height: number, tilt: number, fovDeg: number, aspect: number, viewW: number): number {
  const depth = height * Math.sqrt(1 + tilt * tilt);
  const halfW = depth * Math.tan((fovDeg * Math.PI) / 360) * aspect;
  return viewW > 0 ? (2 * halfW) / viewW : 0;
}

/**
 * The camera's sideways shift for the title (px, eased so a layout change
 * or the menu closing doesn't jump the view); world() turns it into metres
 * to take off the camera's x (screen right is world +x).
 */
export class TitleFraming {
  px = 0;

  constructor(private readonly rate = 2.5) {}

  update(dt: number, menuRight: number, viewW: number): number {
    const want = freeCentreOffsetPx(menuRight, viewW);
    this.px += (want - this.px) * (1 - Math.exp(-this.rate * dt));
    return this.px;
  }

  snap(menuRight: number, viewW: number): void {
    this.px = freeCentreOffsetPx(menuRight, viewW);
  }

  /** The shift in metres for a camera `height` m up (see groundPerPx). */
  world(height: number, tilt: number, fovDeg: number, aspect: number, viewW: number): number {
    return this.px * groundPerPx(height, tilt, fovDeg, aspect, viewW);
  }
}
