/**
 * The rules behind the city's ambient scenes (game/cityLife.ts runs them):
 * when each kind may start (cooldowns, caps, distance from the player, and
 * what holds it off: the title screen, a mission or other activity, the
 * player being wanted, the first-run tutorial), the phases of a service
 * vehicle's call-out, and a queue served one at a time. Pure logic, no
 * three.js, tested in tests/cityScenes.test.ts.
 */
import { len2 } from '../core/len';

// --- Scheduling -------------------------------------------------------------

/** What can hold a scene off. */
export type SceneHold =
  /** Behind the title (the attract city): nobody's playing. */
  | 'title'
  /** A mission, race, frenzy, taxi fare or Chaos Run is on. */
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
}

/** The state of play the holds are judged against. */
export interface SceneWorld {
  playing: boolean;
  activity: boolean;
  stars: number;
  tutorial: boolean;
}

/** Holds for anything loud that could get in the way of play (chases, races, brawls): everything. */
export const LOUD: readonly SceneHold[] = ['title', 'activity', 'wanted', 'tutorial'];
/** Holds for a scene that only makes sense with someone playing (it waits on the player being near). */
export const IN_PLAY: readonly SceneHold[] = ['title'];
/** Default distance from the player a scene may start at, m. */
export const SCENE_START_RANGE = 150;

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
  private readonly specs = new Map<string, SceneSpec>();
  private readonly next = new Map<string, number>();
  private now = 0;

  constructor(private readonly rand: () => number) {}

  /** Register a kind (each scene does, once). Its first start is `first` (or a full wait) from the last reset. */
  define(kind: string, spec: SceneSpec): void {
    this.specs.set(kind, spec);
    this.next.set(kind, this.now + (spec.first ?? this.wait(spec)));
  }

  spec(kind: string): SceneSpec {
    const s = this.specs.get(kind);
    if (!s) throw new Error(`scene kind '${kind}' was never defined`);
    return s;
  }

  /** Every clock from `now` (a fresh run): each kind's first start after its `first` (or a full wait). */
  reset(now: number): void {
    this.now = now;
    for (const [k, s] of this.specs) this.next.set(k, now + (s.first ?? this.wait(s)));
  }

  /** May a `kind` start at `now` with `running` of them going, in `world`? */
  due(kind: string, now: number, running: number, world: SceneWorld): boolean {
    const s = this.spec(kind);
    return running < s.cap && now >= (this.next.get(kind) ?? 0) && !held(s, world);
  }

  /** Is a spot `distance` m from the player close enough for `kind` to start there? */
  near(kind: string, distance: number): boolean {
    return distance <= (this.spec(kind).range ?? SCENE_START_RANGE);
  }

  /** One started: the next no sooner than a fresh wait. */
  start(kind: string, now: number): void {
    this.next.set(kind, now + this.wait(this.spec(kind)));
  }

  /** Couldn't start one now (no spot, no vehicle): look again in `seconds`. */
  defer(kind: string, now: number, seconds = 3): void {
    this.next.set(kind, now + seconds);
  }

  /** Seconds until `kind` may start (tests, the debug hook). */
  left(kind: string, now: number): number {
    return Math.max(0, (this.next.get(kind) ?? 0) - now);
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
