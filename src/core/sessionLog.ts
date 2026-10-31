/**
 * A session's performance over time, for device tests without a desktop
 * console: a compact sample every 10 s in a fixed ring, plus timestamped
 * events (tier / ratio steps, context loss, audio and visibility changes).
 * Persisted to storage (throttled) so a crash or a reload keeps it. Pure: the
 * caller feeds the numbers and the clock.
 */

export const SAMPLE_EVERY_MS = 10_000;
/** An hour of samples at 10 s. */
export const SAMPLE_CAPACITY = 360;
export const EVENT_CAPACITY = 200;
/** Storage writes at most this often (plus on pagehide), ms. */
export const PERSIST_EVERY_MS = 30_000;
export const DIAG_KEY = 'curbside.diag';

export interface SessionSample {
  /** Seconds since the session started. */
  t: number;
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  jsP95: number;
  /** Hitches (>50 ms frames) per minute. */
  hitches: number;
  tier: string;
  ratio: number;
  /** Draw calls of the last frame. */
  dc: number;
  audioState: string;
  paused: boolean;
  /** The destruction test, while it is on: rubble bodies alive, and physics p95 per stepped frame (ms). */
  rubble?: number;
  physP95?: number;
}

export interface SessionEvent {
  t: number;
  kind: string;
  detail?: string;
}

export interface SessionLogData {
  /** Wall-clock start, ISO. */
  started: string;
  samples: SessionSample[];
  events: SessionEvent[];
  /** Events dropped once the event list was full. */
  droppedEvents: number;
}

/** The slice of localStorage this needs (fakeable in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export class SessionLog {
  private readonly samples: SessionSample[] = [];
  /** Next slot to overwrite once the ring is full. */
  private head = 0;
  private readonly events: SessionEvent[] = [];
  private dropped = 0;
  private lastSampleAt: number;
  private lastPersistAt: number;
  private dirty = false;

  constructor(
    /** Clock origin (performance.now() at boot), ms. */
    private readonly startMs: number,
    readonly started: string = new Date().toISOString(),
  ) {
    this.lastSampleAt = startMs;
    this.lastPersistAt = startMs;
  }

  /** Seconds since start, to 0.1 s. */
  seconds(nowMs: number): number {
    return r1((nowMs - this.startMs) / 1000);
  }

  /** True when a sample is due (call often; cheap). */
  due(nowMs: number): boolean {
    return nowMs - this.lastSampleAt >= SAMPLE_EVERY_MS;
  }

  /** Append a sample (rounded for a compact report); the oldest goes once the ring is full. */
  addSample(nowMs: number, s: Omit<SessionSample, 't'>): void {
    this.lastSampleAt = nowMs;
    const entry: SessionSample = {
      t: this.seconds(nowMs),
      fps: r1(s.fps),
      p50: r1(s.p50),
      p95: r1(s.p95),
      p99: r1(s.p99),
      jsP95: r1(s.jsP95),
      hitches: r1(s.hitches),
      tier: s.tier,
      ratio: Math.round(s.ratio * 100) / 100,
      dc: s.dc,
      audioState: s.audioState,
      paused: s.paused,
    };
    if (s.rubble !== undefined) entry.rubble = s.rubble;
    if (s.physP95 !== undefined) entry.physP95 = Math.round(s.physP95 * 100) / 100;
    if (this.samples.length < SAMPLE_CAPACITY) this.samples.push(entry);
    else {
      this.samples[this.head] = entry;
      this.head = (this.head + 1) % SAMPLE_CAPACITY;
    }
    this.dirty = true;
  }

  /** A timestamped event; once the list is full later ones are counted, not kept. */
  addEvent(nowMs: number, kind: string, detail?: string): void {
    if (this.events.length >= EVENT_CAPACITY) {
      this.dropped++;
      return;
    }
    const e: SessionEvent = { t: this.seconds(nowMs), kind };
    if (detail !== undefined) e.detail = detail;
    this.events.push(e);
    this.dirty = true;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  get eventCount(): number {
    return this.events.length + this.dropped;
  }

  /** Samples oldest first, events in order. */
  data(): SessionLogData {
    const ordered = this.samples.slice(this.head).concat(this.samples.slice(0, this.head));
    return { started: this.started, samples: ordered, events: this.events.slice(), droppedEvents: this.dropped };
  }

  /** Write to storage if there is news and PERSIST_EVERY_MS has passed (or `force`). Never throws. */
  persist(nowMs: number, store: KeyValueStore | null, force = false): boolean {
    if (!store || !this.dirty) return false;
    if (!force && nowMs - this.lastPersistAt < PERSIST_EVERY_MS) return false;
    this.lastPersistAt = nowMs;
    try {
      store.setItem(DIAG_KEY, JSON.stringify(this.data()));
      this.dirty = false;
      return true;
    } catch {
      return false; // Private mode or quota: the in-memory log still works
    }
  }
}

/** The previous session's log from storage, or null if absent or unreadable. */
export function loadPreviousLog(store: KeyValueStore | null): SessionLogData | null {
  if (!store) return null;
  try {
    const raw = store.getItem(DIAG_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<SessionLogData>;
    if (!d || !Array.isArray(d.samples) || !Array.isArray(d.events)) return null;
    return { started: String(d.started ?? ''), samples: d.samples, events: d.events, droppedEvents: Number(d.droppedEvents) || 0 };
  } catch {
    return null;
  }
}
