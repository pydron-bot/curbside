/**
 * Music on foot (pure, tested; GameAudio wires it up). Out of the car the
 * radio isn't in your ears any more: you hear music faintly from the street
 * as you pass it, one station at a time on the one music player.
 *
 *  - The car you got out of plays your station where you left it, so its
 *    radio fades as you walk away (and comes back up as you walk back).
 *  - Parked cars (nobody in them, not police, not wrecked or burning): about
 *    one in three has its radio on, its station picked by a hash of where
 *    it's parked, and kept while it stays about there (ParkedRadios).
 *  - Shopfronts: half the neon-lit ones and a quarter of those with awnings
 *    play, each district its own music (DISTRICT_STATIONS).
 *  - A VIPERS hangout's boombox (gangMode raises 'boombox' events) plays
 *    SIDEWAYS 808 loud enough to carry across the street.
 *
 * Each emitter fades with distance (an inverse falloff that reaches silence
 * at its range) and is muffled as if through a car body or a shop door until
 * you're close, panned by where it is. The loudest one is heard, but another
 * station takes over only when it's clearly louder than the one playing
 * (SWITCH_MARGIN), so walking between two doesn't flap. A change of station
 * fades the music out, retunes it quietly once it's down (the new station
 * from the top of a phrase) and fades it back in. Nothing in range for
 * DORMANT_AFTER seconds and the music stops booking notes until something is.
 *
 * begin() / offer() / end() run a few times a second with no allocation;
 * shops come from a grid built once (ShopEmitters).
 */
import { len2 } from '../core/len';
import type { District } from '../world/districts';
import { clamp01, panFor, smoothstep } from './mix';
import { STATIONS } from './music/stations';

export type EmitterKind = 'own' | 'car' | 'shop' | 'boombox';

/** How an emitter sounds from the pavement. */
export interface EmitterSound {
  /** Gain at `ref` metres or closer, against the in-car radio (1). */
  level: number;
  ref: number;
  /** Silent from here, m (fading out from FADE_FROM of it). */
  max: number;
  /** Lowpass far off and up close, Hz: through a car body or a shop door, or in the open. */
  far: number;
  near: number;
}

export const EMITTERS: Readonly<Record<EmitterKind, EmitterSound>> = {
  own: { level: 0.5, ref: 1.5, max: 20, far: 800, near: 3200 },
  car: { level: 0.34, ref: 1.5, max: 15, far: 650, near: 2400 },
  shop: { level: 0.34, ref: 2, max: 16, far: 1000, near: 4500 },
  boombox: { level: 0.62, ref: 4, max: 34, far: 2200, near: 11000 },
};
/** An emitter's falloff reaches silence between this share of its range and the range itself. */
export const FADE_FROM = 0.55;

/** Gain of an emitter `d` m away (0 past its range; never rises with distance). */
export function emitterGain(kind: EmitterKind, d: number): number {
  const e = EMITTERS[kind];
  if (!(d < e.max)) return 0;
  const inv = d <= e.ref ? 1 : e.ref / d;
  return e.level * inv * (1 - smoothstep(e.max * FADE_FROM, e.max, d));
}

/** Lowpass for an emitter `d` m away: opens as you get close (log between far and near). */
export function emitterCutoff(kind: EmitterKind, d: number): number {
  const e = EMITTERS[kind];
  const t = clamp01((d - e.ref) / (e.max - e.ref));
  return e.near * Math.pow(e.far / e.near, t);
}

/** What the shops in each district play: a hash picks one of the five, so a district's own sound (two stations twice each, or one three times) with a fifth or two of something else. */
export const DISTRICT_STATIONS: Readonly<Record<District, readonly string[]>> = {
  // NEON MILE: funk and phonk out of the bars and clubs.
  arts: ['getaway', 'sideways', 'getaway', 'sideways', 'breakneck'],
  // GLASS HEIGHTS: synthwave and breaks in the towers' lobbies.
  downtown: ['nightdrive', 'breakneck', 'nightdrive', 'breakneck', 'getaway'],
  // COBBLE ROW: lo-fi in the cafés, a dub record shop.
  oldtown: ['lowtide', 'lowtide', 'lowtide', 'dubwise', 'getaway'],
  // RUSTWATER DOCKS: dub from the yards.
  industrial: ['dubwise', 'dubwise', 'dubwise', 'breakneck', 'sideways'],
  // MAPLE FLATS: an arcade, lo-fi from open windows.
  residential: ['insertcoin', 'lowtide', 'insertcoin', 'lowtide', 'nightdrive'],
};

/** Index into STATIONS of a station id (−1 if there's none). */
export function stationIndex(id: string): number {
  for (let i = 0; i < STATIONS.length; i++) if (STATIONS[i].id === id) return i;
  return -1;
}

/** The VIPERS' boombox plays phonk. */
export const BOOMBOX_STATION = stationIndex('sideways');

/** A stable 0..1 from two integers (an integer hash, the same everywhere). */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Share of parked cars with the radio on. */
export const PARKED_PLAYING = 1 / 3;

/** The station a car parked at (x, z) plays, or −1 if its radio is off: a hash of the 4 m cell it stands in (ParkedRadios keeps it when the car is nudged). */
export function parkedStation(x: number, z: number): number {
  // Salted so the van parked by the spawn point has its radio on, on the first station.
  const cx = Math.round(x / 4) + 1010;
  const cz = Math.round(z / 4);
  if (hash01(cx, cz) >= PARKED_PLAYING) return -1;
  return Math.floor(hash01(cz + 7919, cx - 104729) * STATIONS.length);
}

/** A parked car moved this far from where its station was picked has been re-parked (driven off, recycled), m: it picks again. */
export const REPARKED = 6;

/**
 * Each parked car's station, picked where it's first heard and kept while it
 * stays about there: a nudge (traffic, a blast, your shoulder) mustn't turn
 * its radio off or retune it. One record per car, made the first time.
 */
export class ParkedRadios {
  private readonly picked = new WeakMap<object, { x: number; z: number; station: number }>();

  /** The station `car` plays (−1: its radio is off). */
  stationOf(car: StreetCar): number {
    const { x, z } = car.sim;
    const p = this.picked.get(car);
    if (!p) {
      const station = parkedStation(x, z);
      this.picked.set(car, { x, z, station });
      return station;
    }
    if (Math.abs(x - p.x) > REPARKED || Math.abs(z - p.z) > REPARKED) {
      p.x = x;
      p.z = z;
      p.station = parkedStation(x, z);
    }
    return p.station;
  }
}

/** The bits of a car (the game's Vehicle fits) that say whether it can be playing a radio at the kerb. */
export interface StreetCar {
  sim: { x: number; z: number };
  damage: { burning: boolean; wrecked: boolean };
  ai?: unknown;
  pursuit?: unknown;
  police?: boolean;
  exported?: boolean;
  archetype?: string;
}

/** Nobody in it, not a police unit's, not wrecked or burning, not sold, and a car with a radio worth hearing. */
export function isParked(v: StreetCar): boolean {
  if (v.ai || v.pursuit || v.police || v.exported || v.damage.wrecked || v.damage.burning) return false;
  switch (v.archetype) {
    case 'scooter':
    case 'cop_bike':
    case 'police':
    case 'police_suv':
    case 'swat':
    case 'ambulance':
    case 'firetruck':
      return false;
    default:
      return true;
  }
}

/** A shopfront and its building, as much as picking its music needs (the city's plans fit). */
export interface ShopBuilding {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  district: District;
}
export interface ShopPlan {
  shopfronts: ReadonlyArray<{ side: 0 | 1 | 2 | 3; from: number; to: number; awning: string | null; neon: string | null }>;
}

/** Share of neon-lit shopfronts that play music, and of those with only an awning. */
export const NEON_PLAYING = 0.5;
export const AWNING_PLAYING = 0.25;
/** Emitters stand this far out from the shop's face, on the pavement, m. */
const SHOP_OUT = 0.6;
/** Grid cell for the shop lookup, m. */
const CELL = 32;

/**
 * The shopfronts that play music, as flat arrays and a coarse grid built
 * once: a lookup touches only the cells around the listener.
 */
export class ShopEmitters {
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly station: Int8Array;
  readonly count: number;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly cols: number;
  private readonly rows: number;
  /** Shops of cell c are items[start[c] .. start[c + 1]). */
  private readonly start: Uint32Array;
  private readonly items: Uint32Array;

  constructor(buildings: ReadonlyArray<ShopBuilding>, plans: ReadonlyArray<ShopPlan>) {
    const xs: number[] = [];
    const zs: number[] = [];
    const st: number[] = [];
    const n = Math.min(buildings.length, plans.length);
    for (let i = 0; i < n; i++) {
      const b = buildings[i];
      const choices = DISTRICT_STATIONS[b.district];
      plans[i].shopfronts.forEach((s, k) => {
        const u = hash01(i, k);
        if (u >= (s.neon ? NEON_PLAYING : s.awning ? AWNING_PLAYING : 0)) return;
        const mid = (s.from + s.to) / 2;
        xs.push(s.side === 1 ? b.maxX + SHOP_OUT : s.side === 3 ? b.minX - SHOP_OUT : mid);
        zs.push(s.side === 0 ? b.minZ - SHOP_OUT : s.side === 2 ? b.maxZ + SHOP_OUT : mid);
        st.push(stationIndex(choices[Math.floor(hash01(k + 31, i + 977) * choices.length)]));
      });
    }
    this.count = xs.length;
    this.x = Float32Array.from(xs);
    this.z = Float32Array.from(zs);
    this.station = Int8Array.from(st);
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < this.count; i++) {
      minX = Math.min(minX, xs[i]);
      maxX = Math.max(maxX, xs[i]);
      minZ = Math.min(minZ, zs[i]);
      maxZ = Math.max(maxZ, zs[i]);
    }
    if (this.count === 0) minX = minZ = maxX = maxZ = 0;
    this.minX = minX;
    this.minZ = minZ;
    this.cols = Math.floor((maxX - minX) / CELL) + 1;
    this.rows = Math.floor((maxZ - minZ) / CELL) + 1;
    // Counting sort into cells.
    const cells = this.cols * this.rows;
    this.start = new Uint32Array(cells + 1);
    const cellOf = new Uint32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const c = this.cell(xs[i], zs[i]);
      cellOf[i] = c;
      this.start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) this.start[c + 1] += this.start[c];
    this.items = new Uint32Array(this.count);
    const fill = this.start.slice(0, cells);
    for (let i = 0; i < this.count; i++) this.items[fill[cellOf[i]]++] = i;
  }

  private cell(x: number, z: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / CELL)));
    const cz = Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / CELL)));
    return cz * this.cols + cx;
  }

  /** Offer `mix` every playing shop within shop range of (x, z). */
  offerNear(mix: StreetMusic, x: number, z: number): void {
    const r = EMITTERS.shop.max;
    const c0 = Math.max(0, Math.floor((x - r - this.minX) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((x + r - this.minX) / CELL));
    const r0 = Math.max(0, Math.floor((z - r - this.minZ) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((z + r - this.minZ) / CELL));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const c = row * this.cols + col;
        for (let k = this.start[c]; k < this.start[c + 1]; k++) {
          const i = this.items[k];
          mix.offer('shop', this.station[i], this.x[i], this.z[i]);
        }
      }
    }
  }
}

/** The gang hangouts' boomboxes as their 'boombox' events report them (a handful, kept for good). */
export class Boomboxes {
  readonly list: Array<{ id: string; x: number; z: number; on: boolean }> = [];

  /** A boombox started or stopped. */
  track(e: { id: string; x: number; z: number; on: boolean }): void {
    for (const b of this.list) {
      if (b.id !== e.id) continue;
      b.x = e.x;
      b.z = e.z;
      b.on = e.on;
      return;
    }
    this.list.push({ id: e.id, x: e.x, z: e.z, on: e.on });
  }

  /** Offer `mix` every boombox playing. */
  offerTo(mix: StreetMusic): void {
    for (const b of this.list) if (b.on) mix.offer('boombox', BOOMBOX_STATION, b.x, b.z);
  }

  get playing(): number {
    let n = 0;
    for (const b of this.list) if (b.on) n++;
    return n;
  }
}

/** Another station takes over only when its emitter is this much louder than the loudest one of the station playing. */
export const SWITCH_MARGIN = 1.6;
/** Faded out this long before a quiet retune, s. */
export const SWITCH_FADE = 0.35;
/** Nothing to hear for this long, the music goes dormant (no notes booked), s. */
export const DORMANT_AFTER = 4;
/** Gain smoothing (setTargetAtTime), s: following a source as you walk, stepping out of the car, fading for a retune. */
const FOLLOW_TAU = 0.25;
const STEP_OUT_TAU = 0.4;
const FADE_TAU = 0.08;

interface Pick {
  kind: EmitterKind | null;
  station: number;
  x: number;
  z: number;
  d: number;
  gain: number;
}

const pick = (): Pick => ({ kind: null, station: -1, x: 0, z: 0, d: 0, gain: 0 });

export class StreetMusic {
  // What to do, read after end():
  /** The street chain: gain against the in-car radio, lowpass, pan, and the smoothing to get there. */
  gain = 0;
  cutoff = 20000;
  pan = 0;
  tau = FOLLOW_TAU;
  /** The station the music should be on (−1: none yet). */
  station = -1;
  /** Tune the music to this station (−1: leave it as it is); nothing of it is audible, so at once. */
  tune = -1;
  /** Nothing to hear for a while: stop booking notes. */
  dormant = false;
  /** The emitter heard (null: nothing in range), and where it is. */
  kind: EmitterKind | null = null;
  x = 0;
  z = 0;

  private lx = 0;
  private lz = 0;
  private readonly best = pick();
  private readonly same = pick();
  private active = false;
  private stepOut = false;
  /** Stepped out with the music in your ears (not from silence). */
  private carry = false;
  private fading = 0;
  private silent = 0;

  /** Start a scan from the listener at (x, z). */
  begin(x: number, z: number): void {
    this.lx = x;
    this.lz = z;
    this.best.gain = 0;
    this.same.gain = 0;
  }

  /** One emitter that may be heard: its kind, its station (an index into STATIONS) and where it is. */
  offer(kind: EmitterKind, station: number, x: number, z: number): void {
    if (station < 0) return;
    const d = len2(x - this.lx, z - this.lz);
    const g = emitterGain(kind, d);
    if (g <= 0) return;
    if (g > this.best.gain) set(this.best, kind, station, x, z, d, g);
    if (station === this.station && g > this.same.gain) set(this.same, kind, station, x, z, d, g);
  }

  /**
   * Decide, `dt` s after the last call. `heard`: the station the music is
   * playing (an index into STATIONS; −1 for anything off the dial).
   * `audible`, read on the first call after leave(): the music was in your
   * ears (false after WASTED, or the chase's last bar on foot).
   */
  end(dt: number, heard: number, audible = true): void {
    this.tune = -1;
    if (!this.active) {
      // Out of the car: carry on from the radio, at the level it plays. Out of the chase, the title or silence: start from nothing.
      this.active = true;
      this.stepOut = true;
      this.carry = audible && heard >= 0;
      this.station = heard;
      this.gain = this.carry ? 1 : 0;
      this.fading = 0;
    }
    const best = this.best;
    const same = this.same;
    const follow = best.gain <= 0 ? null : this.station < 0 || same.gain <= 0 || best.gain > same.gain * SWITCH_MARGIN ? best : same;
    if (!follow) {
      this.kind = null;
      this.gain = 0;
      // Not carrying the radio on (the chase or the theme was in your ears): down before the radio's next song comes in.
      this.tau = this.stepOut ? (this.carry ? STEP_OUT_TAU : FADE_TAU) : FOLLOW_TAU;
      this.fading = 0;
      this.silent += dt;
      this.dormant = this.silent >= DORMANT_AFTER;
      return;
    }
    this.silent = 0;
    this.dormant = false;
    if (follow.station !== this.station) {
      this.station = follow.station;
      // Something's audible on another station: fade it out before the retune. Silent already: retune now.
      this.fading = this.gain > 0.01 && heard >= 0 ? SWITCH_FADE : 0;
    }
    this.kind = follow.kind;
    this.x = follow.x;
    this.z = follow.z;
    if (this.fading > 0) {
      this.fading -= dt;
      this.gain = 0;
      this.tau = FADE_TAU;
      if (this.fading > 0) return;
    }
    if (heard !== this.station) {
      // Waiting for the bar line: keep it down, and keep asking (a no-op once it's tuned).
      this.tune = this.station;
      this.gain = 0;
      this.tau = FADE_TAU;
      return;
    }
    this.gain = follow.gain;
    this.cutoff = emitterCutoff(follow.kind!, follow.d);
    this.pan = panFor(follow.x - this.lx);
    this.tau = this.stepOut ? STEP_OUT_TAU : FOLLOW_TAU;
    this.stepOut = false;
  }

  /** The source heard stopped dead (a boombox cut): silent at once; the next scan finds what else there is. */
  cut(): void {
    this.gain = 0;
    this.tau = 0.02;
    this.kind = null;
  }

  /** Back in the car, or the chase or the title took over: start afresh next time. */
  leave(): void {
    this.active = false;
    this.fading = 0;
    this.silent = 0;
    this.dormant = false;
    this.tune = -1;
    this.kind = null;
  }

  get onFoot(): boolean {
    return this.active;
  }
}

function set(p: Pick, kind: EmitterKind, station: number, x: number, z: number, d: number, gain: number): void {
  p.kind = kind;
  p.station = station;
  p.x = x;
  p.z = z;
  p.d = d;
  p.gain = gain;
}
