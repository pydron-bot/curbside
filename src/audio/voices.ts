/**
 * Bookkeeping for one-shot voices: per-category caps that steal the oldest
 * voice, a global cap, and expiry so finished voices get disconnected. Generic
 * over the voice handle and free of Web Audio, so it's unit-tested; a chain
 * reaction of thirty explosions can't pile hundreds of nodes onto an iPhone.
 */

interface Entry<T> {
  category: string;
  voice: T;
  start: number;
  end: number;
  /** Being faded out to make room; no longer counts against the caps. */
  dying: boolean;
}

export class VoiceLimiter<T> {
  private readonly entries: Array<Entry<T>> = [];

  constructor(
    /** Max concurrent voices per category. */
    private readonly limits: Readonly<Record<string, number>>,
    /** Max concurrent voices overall. */
    private readonly globalLimit = 40,
    /** Cap for categories missing from `limits`. */
    private readonly defaultLimit = 6,
  ) {}

  /** Every tracked voice, including ones fading out. */
  get size(): number {
    return this.entries.length;
  }

  /** Voices still playing normally, in one category or overall. */
  count(category?: string): number {
    let n = 0;
    for (const e of this.entries) if (!e.dying && (category === undefined || e.category === category)) n++;
    return n;
  }

  limit(category: string): number {
    return this.limits[category] ?? this.defaultLimit;
  }

  /**
   * Track a voice that plays from `start` until `end`. If its category (or the
   * whole pool) is full, the oldest playing voice goes to `steal`, which must
   * fade it out quickly and return the time it falls silent.
   */
  add(category: string, voice: T, start: number, end: number, steal: (v: T) => number): void {
    const cap = this.limit(category);
    while (this.count(category) >= cap) this.stealOldest(category, steal);
    while (this.count() >= this.globalLimit) this.stealOldest(undefined, steal);
    this.entries.push({ category, voice, start, end, dying: false });
  }

  /** Hand every voice that has finished by `now` to `release` and forget it. */
  reap(now: number, release: (v: T) => void): void {
    let w = 0;
    for (let r = 0; r < this.entries.length; r++) {
      const e = this.entries[r];
      if (e.end <= now) release(e.voice);
      else this.entries[w++] = e;
    }
    this.entries.length = w;
  }

  /** Release everything (shutdown). */
  clear(release: (v: T) => void): void {
    for (const e of this.entries) release(e.voice);
    this.entries.length = 0;
  }

  private stealOldest(category: string | undefined, steal: (v: T) => number): void {
    let oldest: Entry<T> | null = null;
    for (const e of this.entries) {
      if (e.dying || (category !== undefined && e.category !== category)) continue;
      if (!oldest || e.start < oldest.start) oldest = e;
    }
    if (!oldest) return;
    oldest.dying = true;
    oldest.end = Math.min(oldest.end, steal(oldest.voice));
  }
}

/**
 * Lets at most `burst` events per key through in any `window` seconds, so a
 * pile-up of identical events in one frame makes a couple of sounds, not dozens.
 */
export class RateGate {
  private readonly times = new Map<string, number[]>();

  allow(key: string, now: number, window: number, burst = 1): boolean {
    let list = this.times.get(key);
    if (!list) this.times.set(key, (list = []));
    let n = 0;
    for (const t of list) if (now - t < window && t <= now) list[n++] = t;
    list.length = n;
    if (n >= burst) return false;
    list.push(now);
    return true;
  }

  reset(): void {
    this.times.clear();
  }
}
