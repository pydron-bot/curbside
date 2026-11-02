/**
 * The rules behind the city's ambient scenes (game/cityLife.ts runs them):
 * when each kind may start (cooldowns, caps, distance from the player, what
 * holds it off: the title screen, a timed race, the first-run tutorial; and
 * how much slower the loud ones come while the player is wanted), the
 * phases of a service vehicle's call-out, and a queue served one at a
 * time. Pure logic, no three.js, tested in tests/cityScenes.test.ts.
 */
import { len2 } from '../core/len';
import type { QualityTierName } from '../render/quality';

// --- Scheduling -------------------------------------------------------------

/** What can hold a scene off. */
export type SceneHold =
  /** Behind the title (the attract city): nobody's playing. */
  | 'title'
  /** An activity that asks for a quiet city: a timed race, or a mission that says so (activityHolds). */
  | 'activity'
  /** The player has wanted stars. */
  | 'wanted'
  /** The first run's tutorial pointers are still up. */
  | 'tutorial';

export interface SceneSpec {
  /** Seconds between starts, picked at random in [min, max] after each one. */
  every: readonly [number, number];
  /** Most running at once. */
  cap: number;
  /** Seconds before the first one may start (else a full wait). */
  first?: number;
  /** Only starts with its spot within this many metres of the player (see SceneClock.near). */
  range?: number;
  /** Held off while any of these is so (none: always allowed). */
  hold?: readonly SceneHold[];
  /**
   * The clock's pace by the player's wanted stars (index 0..5; unset: wanted
   * doesn't slow it). A busy scene still comes while you're wanted, just
   * less often (WANTED_PACE): never zero.
   */
  pace?: readonly number[];
  /**
   * Arrives by car (CityLife.spawnCar): while wanted, now and then its car
   * is put on the road ahead of the player (systems/routeAhead.ts).
   */
  ahead?: boolean;
}

/** The state of play the holds are judged against. */
export interface SceneWorld {
  playing: boolean;
  activity: boolean;
  stars: number;
  tutorial: boolean;
}

/** Holds for anything that must stop for everything, stars included (no city scene does since V2: see BUSY). */
export const LOUD: readonly SceneHold[] = ['title', 'activity', 'wanted', 'tutorial'];
/**
 * Holds for the busy scenes (chases, races, accidents, fights, muggings,
 * turf, tows): the title, a timed race or a mission that asks, the
 * tutorial. Not stars: with BUSY specs give `pace: WANTED_PACE`, so the
 * city keeps going through a pursuit, a bit thinner.
 */
export const BUSY: readonly SceneHold[] = ['title', 'activity', 'tutorial'];
/** A busy scene's clock pace by wanted stars: fewer the hotter you are, never none. */
export const WANTED_PACE: readonly number[] = [1, 0.75, 0.6, 0.5, 0.4, 0.35];
/** Holds for a scene that only makes sense with someone playing (it waits on the player being near). */
export const IN_PLAY: readonly SceneHold[] = ['title'];
/** Default distance from the player a scene may start at, m. */
export const SCENE_START_RANGE = 150;

/** The pace of `spec`'s clock at `stars` (1: full pace). */
export function paceFor(spec: SceneSpec, stars: number): number {
  const p = spec.pace;
  if (!p || p.length === 0) return 1;
  return p[Math.max(0, Math.min(p.length - 1, Math.floor(stars)))];
}

/**
 * Does the activity on (ProgressDirector.busy: 'race', 'mission', 'taxi',
 * 'frenzy' or null) hold the busy scenes off? Only a timed race, or a
 * mission that asks (`quiet`). Chaos Run, free roam, fares and frenzies
 * let the city carry on.
 */
export function activityHolds(busy: string | null, missionQuiet: boolean): boolean {
  return busy === 'race' || (busy === 'mission' && missionQuiet);
}

/**
 * Most busy scenes running at once while the player is wanted, by quality
 * tier: police on top of scene cars on a phone (each model not otherwise in
 * view is a draw call and a shadow pass). Unlimited with no stars.
 */
export const WANTED_SCENE_CAP: Readonly<Record<QualityTierName, number>> = { high: 4, medium: 3, low: 2 };

/** The busy-scene cap for `tier` at `stars` (Infinity: none). */
export function busyCap(tier: QualityTierName, stars: number): number {
  return stars > 0 ? WANTED_SCENE_CAP[tier] : Infinity;
}

/** Is `kind`'s scene held off in `world`? */
export function held(spec: SceneSpec, world: SceneWorld): boolean {
  for (const h of spec.hold ?? []) {
    if (h === 'title' && !world.playing) return true;
    if (h === 'activity' && world.activity) return true;
    if (h === 'wanted' && world.stars > 0) return true;
    if (h === 'tutorial' && world.tutorial) return true;
  }
  return false;
}

/**
 * When each kind of scene may start. Scenes define() their kind with a
 * spec; one may start when nothing holds it off, its clock has run down
 * and fewer than its cap are running. start() winds the clock again;
 * defer() tries again shortly (nowhere to put one just now).
 */
export class SceneClock {
  /** Each kind's index into the parallel lists (a plain number list: setting a time boxes nothing). */
  private readonly index = new Map<string, number>();
  private readonly names: string[] = [];
  private readonly specs: SceneSpec[] = [];
  private readonly next: number[] = [];
  private now = 0;

  constructor(private readonly rand: () => number) {}

  /** Register a kind (each scene does, once). Its first start is `first` (or a full wait) from the last reset. */
  define(kind: string, spec: SceneSpec): void {
    let i = this.index.get(kind);
    if (i === undefined) {
      i = this.names.length;
      this.index.set(kind, i);
      this.names.push(kind);
      this.specs.push(spec);
      this.next.push(0);
    }
    this.specs[i] = spec;
    this.next[i] = this.now + (spec.first ?? this.wait(spec));
  }

  /** Kinds defined so far, in order. */
  get kinds(): string[] {
    return this.names.slice();
  }

  spec(kind: string): SceneSpec {
    return this.specs[this.at(kind)];
  }

  /** Every clock from `now` (a fresh run): each kind's first start after its `first` (or a full wait). */
  reset(now: number): void {
    this.now = now;
    for (let i = 0; i < this.specs.length; i++) this.next[i] = now + (this.specs[i].first ?? this.wait(this.specs[i]));
  }

  /**
   * Time passes at `stars`: a paced kind's clock runs at its pace (its next
   * start slides later by the rest of `dt`). `except`: a kind that keeps
   * full pace (a featured scene).
   */
  tick(dt: number, stars: number, except: string | null = null): void {
    if (stars <= 0) return;
    for (let i = 0; i < this.specs.length; i++) {
      const pace = paceFor(this.specs[i], stars);
      if (pace < 1 && this.names[i] !== except) this.next[i] += dt * (1 - pace);
    }
  }

  /** Is `kind` a busy one (slowed by stars, counted against busyCap)? */
  busy(kind: string): boolean {
    return this.specs[this.at(kind)].pace !== undefined;
  }

  /** May a `kind` start at `now` with `running` of them going, in `world`? */
  due(kind: string, now: number, running: number, world: SceneWorld): boolean {
    const i = this.at(kind);
    const s = this.specs[i];
    return running < s.cap && now >= this.next[i] && !held(s, world);
  }

  /** Is a spot `distance` m from the player close enough for `kind` to start there? */
  near(kind: string, distance: number): boolean {
    return distance <= (this.spec(kind).range ?? SCENE_START_RANGE);
  }

  /** One started: the next no sooner than a fresh wait. */
  start(kind: string, now: number): void {
    const i = this.at(kind);
    this.next[i] = now + this.wait(this.specs[i]);
  }

  /** Couldn't start one now (no spot, no vehicle): look again in `seconds`. */
  defer(kind: string, now: number, seconds = 3): void {
    this.next[this.at(kind)] = now + seconds;
  }

  /** Seconds until `kind` may start (tests, the debug hook). */
  left(kind: string, now: number): number {
    return Math.max(0, this.next[this.at(kind)] - now);
  }

  private at(kind: string): number {
    const i = this.index.get(kind);
    if (i === undefined) throw new Error(`scene kind '${kind}' was never defined`);
    return i;
  }

  private wait(s: SceneSpec): number {
    const [lo, hi] = s.every;
    return lo + this.rand() * (hi - lo);
  }
}

// --- Service vehicles ---------------------------------------------------------

/**
 * A service vehicle's call-out: on its way ('drive'), pulled up at the
 * scene ('onSite'), driving off ('leave'), then 'done'; 'failed' if it was
 * lost (taken, wrecked, its driver out), got stuck, or never arrived.
 */
export type ServicePhase = 'drive' | 'onSite' | 'leave' | 'done' | 'failed';

export interface ServiceState {
  phase: ServicePhase;
  /** Seconds since the call (or since it was last sent somewhere new). */
  age: number;
  /** Seconds on site. */
  site: number;
}

/** What the runtime sees this step. */
export interface ServiceSense {
  /** The vehicle's gone from the scene: the player took it, it's wrecked or burning, its driver's out, it was recycled. */
  lost: boolean;
  /** Wedged for good (backed out too many times). */
  stuck: boolean;
  /** Pulled up (all but stopped) within reach of its point. */
  arrived: boolean;
  /** Driving off: it's reached where it was going, or is far off out of sight. */
  away: boolean;
}

export interface ServiceTimes {
  /** Give up if not there in this long, s. */
  timeout: number;
  /** Drive off by itself after this long on site, s (unset: when the scene says). */
  dwell?: number;
}

/** One step of a call-out: advances `s` and returns its phase. */
export function stepService(s: ServiceState, sense: ServiceSense, dt: number, times: ServiceTimes): ServicePhase {
  if (s.phase === 'done' || s.phase === 'failed') return s.phase;
  s.age += dt;
  if (sense.lost) return (s.phase = s.phase === 'leave' ? 'done' : 'failed');
  switch (s.phase) {
    case 'drive':
      if (sense.arrived) {
        s.phase = 'onSite';
        s.site = 0;
      } else if (sense.stuck || s.age > times.timeout) s.phase = 'failed';
      break;
    case 'onSite':
      s.site += dt;
      if (times.dwell !== undefined && s.site >= times.dwell) s.phase = 'leave';
      break;
    case 'leave':
      if (sense.away || sense.stuck) s.phase = 'done';
      break;
  }
  return s.phase;
}

// --- Queues -----------------------------------------------------------------

/**
 * A queue served one at a time (an ice cream van, a stand, a bus door):
 * join() at the back, step() serves the front every `every` seconds once
 * they've reached the front (`ready`).
 */
export class ServeQueue<T> {
  readonly members: T[] = [];
  private timer = 0;

  constructor(
    private readonly every: number,
    readonly capacity: number,
  ) {}

  join(m: T): boolean {
    if (this.members.length >= this.capacity || this.members.includes(m)) return false;
    this.members.push(m);
    return true;
  }

  leave(m: T): void {
    const i = this.members.indexOf(m);
    if (i < 0) return;
    this.members.splice(i, 1);
    if (i === 0) this.timer = 0;
  }

  /** Time passes; returns whoever was just served (and has left the queue), or null. `ready`: the front one is at the hatch. */
  step(dt: number, ready: boolean): T | null {
    if (this.members.length === 0 || !ready) {
      this.timer = 0;
      return null;
    }
    this.timer += dt;
    if (this.timer < this.every) return null;
    this.timer = 0;
    return this.members.shift() ?? null;
  }

  clear(): void {
    this.members.length = 0;
    this.timer = 0;
  }
}

// --- Picking ----------------------------------------------------------------

/** The nearest of `list` to (x, z) within `range` that `ok` accepts, or null. */
export function nearest<T extends { x: number; z: number }>(list: readonly T[], x: number, z: number, range: number, ok: (t: T) => boolean): T | null {
  let best: T | null = null;
  let bestD = range;
  for (const t of list) {
    if (!ok(t)) continue;
    const d = len2(t.x - x, t.z - z);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}
