/**
 * Local play telemetry for tuning: a ring of the last LOG_CAP results (Chaos
 * Runs, races, chases) in localStorage under PLAY_LOG_KEY, each stamped with
 * the build, input device and quality tier. Listens to the bus; writes only
 * when an entry is added (a run, race or chase ends), never per frame. Local
 * only: nothing is sent anywhere. The diagnostics report reads the key raw.
 */
import type { EventBus, EventOf } from '../core/events';

export const PLAY_LOG_KEY = 'curbside.playlog';
export const LOG_CAP = 200;
/** Chases below this many stars are too common to be worth a slot. */
export const MIN_CHASE_STARS = 2;

type Medal = 'bronze' | 'silver' | 'gold';
export type LogDevice = 'touch' | 'keys' | 'pad';
export type ChaseEnd = 'lost' | 'busted' | 'wasted' | 'respray' | 'reset';

interface Stamp {
  /** Wall-clock ms (Date.now()). */
  at: number;
  build: string;
  device: LogDevice;
  tier: string;
}
export type PlayLogEntry = Stamp &
  (
    | { kind: 'chaos'; score: number; medal: Medal | null; elapsed: number; bonusTime: number; end: string }
    | { kind: 'race'; id: string; time: number; dev: number; ratio: number; medal: Medal | null; fail: string | null }
    | { kind: 'heat'; peak: number; atFive: number; duration: number; end: ChaseEnd }
  );

/** The storage calls the log needs (localStorage, or a fake in tests). */
export interface LogStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PlayLogDeps {
  storage: LogStorage | null;
  build: string;
  /** Input.lastDevice now. */
  device: () => 'keyboard' | 'touch' | 'gamepad';
  /** Quality tier name now. */
  tier: () => string;
  /** Sim clock, s (stops while paused). */
  now: () => number;
  /** Wall clock, ms. */
  wallClock?: () => number;
}

const DEVICE: Record<'keyboard' | 'touch' | 'gamepad', LogDevice> = { keyboard: 'keys', touch: 'touch', gamepad: 'pad' };

const round2 = (n: number) => Math.round(n * 100) / 100;

function chaseEnd(reason: EventOf<'wanted'>['reason']): ChaseEnd {
  switch (reason) {
    case 'busted':
      return 'busted';
    case 'died':
      return 'wasted';
    case 'respray':
      return 'respray';
    case 'lost':
    case 'evaded':
      return 'lost';
    default:
      return 'reset';
  }
}

function load(storage: LogStorage | null): PlayLogEntry[] {
  try {
    const raw = storage?.getItem(PLAY_LOG_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PlayLogEntry[]).slice(-LOG_CAP) : [];
  } catch {
    return [];
  }
}

export class PlayLog {
  private entries: PlayLogEntry[];
  /** Chase in progress: when it started and its peak, or start < 0 when none. */
  private chaseStart = -1;
  private chasePeak = 0;
  /** Seconds at five stars so far this chase, and when the current stretch began (-1: not at five). */
  private atFive = 0;
  private fiveSince = -1;
  private readonly unsubs: Array<() => void> = [];

  constructor(private readonly deps: PlayLogDeps) {
    this.entries = load(deps.storage);
  }

  /** Start listening. Returns a function that stops it. */
  attach(bus: EventBus): () => void {
    this.unsubs.push(
      bus.on('activityEnd', (e) => this.onActivityEnd(e)),
      bus.on('wanted', (e) => this.onWanted(e)),
    );
    return () => this.unsubs.splice(0).forEach((u) => u());
  }

  get list(): readonly PlayLogEntry[] {
    return this.entries;
  }

  /** The log as a JSON string (what's in storage). */
  export(): string {
    return JSON.stringify(this.entries);
  }

  clear(): void {
    this.entries = [];
    try {
      this.deps.storage?.removeItem(PLAY_LOG_KEY);
    } catch {
      // Storage blocked: the in-memory log is cleared anyway.
    }
  }

  private stamp(): Stamp {
    const d = this.deps;
    return { at: d.wallClock ? d.wallClock() : Date.now(), build: d.build, device: DEVICE[d.device()] ?? 'keys', tier: d.tier() };
  }

  private add(entry: PlayLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > LOG_CAP) this.entries.splice(0, this.entries.length - LOG_CAP);
    try {
      this.deps.storage?.setItem(PLAY_LOG_KEY, this.export());
    } catch {
      // Quota or private mode: keep the in-memory log.
    }
  }

  private onActivityEnd(e: EventOf<'activityEnd'>): void {
    if (e.kind === 'chaosRun') {
      this.add({ ...this.stamp(), kind: 'chaos', score: e.score ?? 0, medal: e.medal, elapsed: round2(e.time), bonusTime: round2(e.bonusTime ?? 0), end: e.end });
      return;
    }
    const dev = e.dev ?? 0;
    const finished = e.end === 'finish';
    this.add({
      ...this.stamp(),
      kind: 'race',
      id: e.id,
      time: round2(e.time),
      dev: round2(dev),
      ratio: dev > 0 ? Math.round((e.time / dev) * 1000) / 1000 : 0,
      medal: e.medal,
      fail: finished ? null : e.end,
    });
  }

  private onWanted(e: EventOf<'wanted'>): void {
    const t = this.deps.now();
    if (e.level > 0 && this.chaseStart < 0) {
      this.chaseStart = t;
      this.chasePeak = 0;
      this.atFive = 0;
      this.fiveSince = -1;
    }
    if (this.chaseStart < 0) return;
    this.chasePeak = Math.max(this.chasePeak, e.level);
    if (e.level >= 5 && this.fiveSince < 0) this.fiveSince = t;
    else if (e.level < 5 && this.fiveSince >= 0) {
      this.atFive += t - this.fiveSince;
      this.fiveSince = -1;
    }
    if (e.level > 0) return;
    const start = this.chaseStart;
    this.chaseStart = -1;
    if (this.chasePeak < MIN_CHASE_STARS) return;
    this.add({ ...this.stamp(), kind: 'heat', peak: this.chasePeak, atFive: round2(this.atFive), duration: round2(t - start), end: chaseEnd(e.reason) });
  }
}

/** window.localStorage, or null where it's missing or blocked. */
export function browserStorage(): LogStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
