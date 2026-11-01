/**
 * The last moments of game events for a bug report: a fixed ring of compact
 * entries (time, type, where, one number and one word), filled from the bus
 * with no allocation (preallocated slots; the words are the events' own
 * strings). Read out as plain arrays only when a report is made.
 */
import type { GameEvent } from './events';

export const TRAIL_CAPACITY = 600;
/** A report takes this many seconds of events. */
export const TRAIL_SECONDS = 30;

/** [seconds before the report, type, x, z, value, word, by the player 0/1]; x/z/value null when the event has none. */
export type TrailEntry = [number, string, number | null, number | null, number | null, string | null, number];

/** The first of these an event has is its value... */
const VALUE_KEYS = ['impact', 'level', 'amount', 'fine', 'strength', 'radius', 'airtime', 'points', 'distance'] as const;
/** ...and the first of these its word. */
const WORD_KEYS = ['source', 'weapon', 'target', 'cause', 'what', 'kind', 'archetype', 'reason', 'against', 'id', 'label'] as const;

type Loose = Record<string, unknown>;

export class EventTrail {
  private readonly t: Float64Array;
  private readonly type: string[];
  private readonly x: Float32Array;
  private readonly z: Float32Array;
  private readonly v: Float32Array;
  private readonly word: (string | null)[];
  /** Bit 0: by the player; bit 1: has x/z; bit 2: has a value. */
  private readonly bits: Uint8Array;
  private head = 0;
  private size = 0;

  constructor(readonly capacity = TRAIL_CAPACITY) {
    this.t = new Float64Array(capacity);
    this.type = new Array<string>(capacity).fill('');
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.v = new Float32Array(capacity);
    this.word = new Array<string | null>(capacity).fill(null);
    this.bits = new Uint8Array(capacity);
  }

  get count(): number {
    return this.size;
  }

  /** Note `e` at `nowS` (seconds, any clock that runs forward). */
  record(nowS: number, e: GameEvent): void {
    const r = e as unknown as Loose;
    const i = this.head;
    this.head = (i + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
    this.t[i] = nowS;
    this.type[i] = e.type;
    let bits = r.byPlayer === true || r.involvesPlayer === true ? 1 : 0;
    if (typeof r.x === 'number' && typeof r.z === 'number') {
      this.x[i] = r.x;
      this.z[i] = r.z;
      bits |= 2;
    }
    let word: string | null = null;
    const award = r.award as Loose | undefined;
    if (award && typeof award === 'object') {
      if (typeof award.points === 'number') {
        this.v[i] = award.points;
        bits |= 4;
      }
      if (typeof award.kind === 'string') word = award.kind;
    }
    for (let k = 0; k < VALUE_KEYS.length && !(bits & 4); k++) {
      const v = r[VALUE_KEYS[k]];
      if (typeof v === 'number') {
        this.v[i] = v;
        bits |= 4;
      }
    }
    for (let k = 0; k < WORD_KEYS.length && word === null; k++) {
      const w = r[WORD_KEYS[k]];
      if (typeof w === 'string') word = w;
    }
    this.word[i] = word;
    this.bits[i] = bits;
  }

  /** Entries from the last `seconds` before `nowS`, oldest first. Allocates: for reports only. */
  entries(nowS: number, seconds = TRAIL_SECONDS): TrailEntry[] {
    const out: TrailEntry[] = [];
    const r2 = (n: number) => Math.round(n * 100) / 100;
    for (let k = this.size; k > 0; k--) {
      const i = (this.head - k + this.capacity) % this.capacity;
      const ago = nowS - this.t[i];
      if (ago > seconds || ago < 0) continue;
      const b = this.bits[i];
      out.push([
        r2(ago),
        this.type[i],
        b & 2 ? r2(this.x[i]) : null,
        b & 2 ? r2(this.z[i]) : null,
        b & 4 ? r2(this.v[i]) : null,
        this.word[i],
        b & 1,
      ]);
    }
    return out;
  }

  clear(): void {
    this.size = 0;
    this.head = 0;
  }
}
