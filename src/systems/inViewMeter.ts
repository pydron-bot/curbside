/**
 * How much of the city the player actually sees: per scene kind, the
 * seconds its subject (Scene.subject) was on screen, how many started, how
 * many of those were seen at all and how many ended unseen, plus the
 * longest stretch with no incident in view. game/cityLife.ts samples it a
 * few times a second in play; the session log and tools/tune/inview.mjs
 * read it. Fixed typed arrays, so sampling never allocates. Pure: tested in
 * tests/inViewMeter.test.ts.
 *
 * A kind's "episode" runs from its count going above zero until it's back
 * at zero; with two running at once (fights) they share one, and only the
 * one the subject shows can be seen.
 */

/** A quiet stretch (no incident in view) at least this long counts as a long one, s. */
export const LONG_QUIET = 90;

export interface InViewRow {
  kind: string;
  /** Seconds in view. */
  seconds: number;
  started: number;
  seen: number;
  unseen: number;
}

export interface InViewReport {
  /** Seconds of play sampled. */
  played: number;
  /** Seconds with any incident in view. */
  anyInView: number;
  /** Longest stretch with no incident in view, s. */
  longestQuiet: number;
  /** Quiet stretches of LONG_QUIET or more. */
  longQuiets: number;
  rows: InViewRow[];
}

export class InViewMeter {
  played = 0;
  anyInView = 0;
  /** Seconds since an incident was last in view. */
  quiet = 0;
  longestQuiet = 0;
  longQuiets = 0;
  readonly seconds: Float64Array;
  readonly started: Uint32Array;
  readonly seen: Uint32Array;
  readonly unseen: Uint32Array;
  /** Each kind's count at the last sample, and whether its episode has been seen. */
  private readonly was: Uint16Array;
  private readonly episodeSeen: Uint8Array;
  private any = false;

  /** `incident[i]`: kind i counts toward "an incident in view" (the loud ones, fires). */
  constructor(
    readonly kinds: readonly string[],
    private readonly incident: readonly boolean[],
  ) {
    const n = kinds.length;
    this.seconds = new Float64Array(n);
    this.started = new Uint32Array(n);
    this.seen = new Uint32Array(n);
    this.unseen = new Uint32Array(n);
    this.was = new Uint16Array(n);
    this.episodeSeen = new Uint8Array(n);
  }

  /** Kind `i` this sample: `running` going, its subject on screen (`visible`), over the last `dt` s. */
  sample(i: number, running: number, visible: boolean, dt: number): void {
    const was = this.was[i];
    if (running > was) this.started[i] += running - was;
    if (running > 0 && visible) {
      this.seconds[i] += dt;
      if (this.episodeSeen[i] === 0) {
        this.episodeSeen[i] = 1;
        this.seen[i]++;
      }
      if (this.incident[i]) this.any = true;
    }
    if (running === 0 && was > 0) {
      if (this.episodeSeen[i] === 0) this.unseen[i]++;
      this.episodeSeen[i] = 0;
    }
    this.was[i] = running;
  }

  /** After every kind's sample: the sample's time and the quiet stretch. */
  tick(dt: number): void {
    this.played += dt;
    if (this.any) {
      this.anyInView += dt;
      this.quiet = 0;
    } else {
      const before = this.quiet;
      this.quiet += dt;
      if (before < LONG_QUIET && this.quiet >= LONG_QUIET) this.longQuiets++;
      if (this.quiet > this.longestQuiet) this.longestQuiet = this.quiet;
    }
    this.any = false;
  }

  /** The scenes were all reset (a fresh run): forget what was running without counting it as unseen. */
  cut(): void {
    this.was.fill(0);
    this.episodeSeen.fill(0);
  }

  /** Back to nothing (a harness's fresh measurement). */
  clear(): void {
    this.cut();
    this.seconds.fill(0);
    this.started.fill(0);
    this.seen.fill(0);
    this.unseen.fill(0);
    this.played = this.anyInView = this.quiet = this.longestQuiet = this.longQuiets = 0;
    this.any = false;
  }

  /** A copy for logs and harnesses (allocates: not per frame). */
  report(): InViewReport {
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      played: r1(this.played),
      anyInView: r1(this.anyInView),
      longestQuiet: r1(this.longestQuiet),
      longQuiets: this.longQuiets,
      rows: this.kinds.map((kind, i) => ({ kind, seconds: r1(this.seconds[i]), started: this.started[i], seen: this.seen[i], unseen: this.unseen[i] })),
    };
  }

  /** One compact line for the session log: "played 600 s · any 140 s · quiet max 95 s (1) · race 12/2/1/1 …" (seconds/started/seen/unseen). */
  line(): string {
    const parts = [`played ${Math.round(this.played)} s`, `any ${Math.round(this.anyInView)} s`, `quiet max ${Math.round(this.longestQuiet)} s (${this.longQuiets})`];
    for (let i = 0; i < this.kinds.length; i++) {
      if (this.started[i] === 0 && this.seconds[i] === 0) continue;
      parts.push(`${this.kinds[i]} ${Math.round(this.seconds[i])}/${this.started[i]}/${this.seen[i]}/${this.unseen[i]}`);
    }
    return parts.join(' · ');
  }
}
