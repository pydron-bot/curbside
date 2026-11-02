/**
 * The rules behind the city's V2 incidents (game/scenes/: the cash-in-
 * transit van, kebab chucking-out time, a funeral procession, a burst
 * hydrant, a hen or stag party's conga, a film shoot): when each may
 * start (the hour, the district, how often), the state each moves
 * through, and when the player has joined in or wrecked it. Pure, no
 * three.js, tested in tests/incidents.test.ts. The holds (title, wanted...)
 * are each scene's own (its HOLD), the rest of its clock spec is here.
 */
import { len2 } from '../core/len';
import { BLOCK_SIZE, ROAD_WIDTH } from '../world/city';
import type { District } from '../world/districts';
import type { Crime } from './wanted';

/** A clock spec without its hold (systems/cityScenes.ts SceneSpec). */
export interface IncidentClock {
  every: readonly [number, number];
  cap: number;
  first: number;
  range: number;
}

/** Is `hour` (0..24) within [from, to)? Wraps past midnight when from > to. */
export function inHours(hour: number, [from, to]: readonly [number, number]): boolean {
  const h = ((hour % 24) + 24) % 24;
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

/** The kerb in front of a shopfront and the lane beside it (see kerbOf). */
export interface Kerb {
  /** On the pavement at the kerb's edge, straight out from the shop, m. */
  x: number;
  z: number;
  /** In the near lane, pulled in to the kerb (where a car stops for it). */
  laneX: number;
  laneZ: number;
  /** That lane's way of travel (the kerb on its right, traffic keeping right). */
  heading: number;
}

/** A car pulled in to the kerb stands this far from the road's centreline, m (as the ice cream van and buses). */
const PULL_IN = ROAD_WIDTH / 4 + 1.6;

/**
 * The kerb straight out from a shop at (x, z) whose front faces (outX,
 * outZ) (axis-aligned: world/shopSpots.ts ShopSpot), into `out`: the road's
 * centreline is the next block line that way.
 */
export function kerbOf(x: number, z: number, outX: number, outZ: number, out: Kerb): Kerb {
  const alongX = outX !== 0;
  const o = alongX ? outX : outZ;
  const c = alongX ? x : z;
  const road = o > 0 ? Math.ceil(c / BLOCK_SIZE) * BLOCK_SIZE : Math.floor(c / BLOCK_SIZE) * BLOCK_SIZE;
  const kerb = road - o * (ROAD_WIDTH / 2 + 0.7);
  const lane = road - o * PULL_IN;
  out.x = alongX ? kerb : x;
  out.z = alongX ? z : kerb;
  out.laneX = alongX ? lane : x;
  out.laneZ = alongX ? z : lane;
  // Right of heading h is (-cos h, sin h): pointing back at the shop.
  out.heading = Math.atan2(-outZ, outX);
  return out;
}

// --- Cash-in-transit van ----------------------------------------------------------

/** Its rounds are by day. */
export const CASH_HOURS = [8, 18] as const;
export const CASH_CLOCK: IncidentClock = { every: [220, 360], cap: 1, first: 60, range: 140 };
/** Kerb stops on a round, then it drives off. */
export const CASH_STOPS = 3;
/** The guard is inside the shop this long with the box, s. */
export const CASH_INSIDE = 3;
/** Under this share of its health (rammed, shot up), the back doors burst and it spills. */
export const CASH_SPILL_HEALTH = 0.45;
/** Bundles spilled from the van, and from a guard knocked down with the box. */
export const CASH_VAN_BUNDLES = 5;
export const CASH_GUARD_BUNDLES = 2;
/** Each bundle is worth this much, $ (random in the range). */
export const CASH_VALUE = [30, 70] as const;
/** A bundle lies this long, s; picked up within this on foot / in a car, m. */
export const CASH_LIFE = 40;
export const CASH_PICK_FOOT = 1.3;
export const CASH_PICK_CAR = 2.6;
/** The guards are after whoever did it for this long, s; and give up past this far, m. */
export const GUARD_CHASE = 18;
/** A robbery called in: about a star's worth (heat.called each). */
export const ROBBERY_CALL: readonly Crime[] = ['assault', 'assault', 'assault', 'assault'];

/** The guard's walk: the van's back doors to the shop door ('out'), inside, back ('back'), then aboard. */
export type CashLeg = 'out' | 'inside' | 'back' | 'aboard';
export interface CashTrip {
  leg: CashLeg;
  timer: number;
}

/** One step of the guard's trip; `atShop` / `atVan`: within reach of where that leg goes. Returns the leg. */
export function stepCashTrip(t: CashTrip, dt: number, atShop: boolean, atVan: boolean): CashLeg {
  t.timer += dt;
  if (t.leg === 'out' && atShop) {
    t.leg = 'inside';
    t.timer = 0;
  } else if (t.leg === 'inside' && t.timer >= CASH_INSIDE) {
    t.leg = 'back';
    t.timer = 0;
  } else if (t.leg === 'back' && atVan) {
    t.leg = 'aboard';
    t.timer = 0;
  }
  return t.leg;
}

/** Carrying the box: on the way in, and on the way back with the takings. */
export function carrying(leg: CashLeg): boolean {
  return leg === 'out' || leg === 'back';
}

export interface CashSense {
  wrecked: boolean;
  burning: boolean;
  /** The van's health, 0..1. */
  health: number;
  /** The guard is down (knocked over or out). */
  guardDown: boolean;
  /** ...and was carrying the box. */
  carrying: boolean;
}

/** Has the van been done over, and how: the van broken open, or the guard knocked down with the box? */
export function cashSpill(s: CashSense): 'van' | 'guard' | null {
  if (s.wrecked || s.burning || s.health < CASH_SPILL_HEALTH) return 'van';
  if (s.guardDown && s.carrying) return 'guard';
  return null;
}

export interface RobberySense {
  /** The player drove off in the van. */
  taken: boolean;
  /** The player hurt the van lately (systems/damage.ts blamesPlayer). */
  vanBlamed: boolean;
  /** The player knocked the guard down (a pedDown of theirs where he fell). */
  guardByPlayer: boolean;
}

/**
 * Was the spill the player's doing? Only what they did themselves: a van
 * a taxi ran into, or a guard the traffic or a burst hydrant knocked over,
 * spills its cash for anyone, but nobody's after the player for it.
 */
export function robbedByPlayer(how: 'van' | 'guard', s: RobberySense): boolean {
  if (s.taken) return true;
  return how === 'van' ? s.vanBlamed : s.guardByPlayer;
}

/** Where the `i`th of `n` bundles lands round (x, z) (a rough ring, so they don't stack), into `out`. */
export function scatter(i: number, n: number, x: number, z: number, r: number, out: { x: number; z: number }): { x: number; z: number } {
  const a = (i / Math.max(1, n)) * Math.PI * 2 + i * 0.7;
  const rad = 1 + r * (0.6 + 0.4 * ((i * 7) % 3) / 2);
  out.x = x + Math.sin(a) * rad;
  out.z = z + Math.cos(a) * rad;
  return out;
}

export interface CashBundle {
  x: number;
  z: number;
  value: number;
  /** Sim time it landed, s. */
  at: number;
  alive: boolean;
}

/** The bundles lying in the road: a fixed pool (the oldest goes when it's full), each CASH_LIFE s. */
export class CashBundles {
  readonly list: CashBundle[] = [];

  constructor(capacity = 8) {
    for (let i = 0; i < capacity; i++) this.list.push({ x: 0, z: 0, value: 0, at: 0, alive: false });
  }

  drop(x: number, z: number, value: number, now: number): CashBundle {
    let slot = this.list[0];
    for (const b of this.list) {
      if (!b.alive) {
        slot = b;
        break;
      }
      if (b.at < slot.at) slot = b;
    }
    slot.x = x;
    slot.z = z;
    slot.value = value;
    slot.at = now;
    slot.alive = true;
    return slot;
  }

  step(now: number): void {
    for (const b of this.list) if (b.alive && now - b.at > CASH_LIFE) b.alive = false;
  }

  /** A bundle within `reach` of (x, z), or null. */
  at(x: number, z: number, reach: number): CashBundle | null {
    for (const b of this.list) if (b.alive && len2(b.x - x, b.z - z) < reach) return b;
    return null;
  }

  get count(): number {
    let n = 0;
    for (const b of this.list) if (b.alive) n++;
    return n;
  }

  clear(): void {
    for (const b of this.list) b.alive = false;
  }
}

// --- Kebab chucking-out time -------------------------------------------------------

/** Round 2 a.m.: from a quarter to one till half three. */
export const KEBAB_HOURS = [0.75, 3.5] as const;
/** Only where there's nightlife enough to have a kebab shop doing this trade. */
export const KEBAB_DISTRICTS: readonly District[] = ['arts', 'oldtown'];
export const KEBAB_CLOCK: IncidentClock = { every: [150, 260], cap: 1, first: 15, range: 90 };
/** How long the shop's spilling out, s. */
export const KEBAB_SECONDS = [75, 105] as const;
/** Most out on the pavement at once (the taxi queue's included). */
export const KEBAB_CROWD = 8;
/** The argument starts this far in (a share of the time), runs this long, then comes to blows this often. */
export const KEBAB_ARGUE_AT = 0.2;
export const KEBAB_ARGUE = [5, 8] as const;
export const KEBAB_BLOWS = 0.45;
/** A taxi comes for the queue about this often, s; at most this many queue. */
export const TAXI_EVERY = [10, 18] as const;
export const TAXI_QUEUE = 4;

export type KebabPhase = 'spill' | 'peak' | 'drain';

/** Out they come for the first third, it's heaving, then the last quarter they drift off. */
export function kebabPhase(age: number, length: number): KebabPhase {
  const k = age / length;
  return k < 0.33 ? 'spill' : k < 0.75 ? 'peak' : 'drain';
}

/** How many should be out at `age`: rising to `max` through the spill, holding, then none new. */
export function kebabTarget(age: number, length: number, max = KEBAB_CROWD): number {
  const k = age / length;
  if (k >= 0.75) return 0;
  return Math.min(max, Math.ceil(max * Math.min(1, (k + 0.05) / 0.33)));
}

/** Chucking-out time here and now? */
export function kebabTime(hour: number, district: District): boolean {
  return inHours(hour, KEBAB_HOURS) && KEBAB_DISTRICTS.includes(district);
}

// --- Funeral procession ----------------------------------------------------------

export const FUNERAL_HOURS = [9, 16] as const;
export const FUNERAL_CLOCK: IncidentClock = { every: [240, 400], cap: 1, first: 90, range: 140 };
/** The cortege's pace, m/s; cars this far apart nose to nose, m; how many (the hearse and the family's cars). */
export const FUNERAL_SPEED = 5.5;
export const FUNERAL_GAP = 8.5;
export const FUNERAL_CARS = [3, 4] as const;
/** Cut through or hit one, and the mourners are out after you this long, s; then back in and on. */
export const MOURN_CHASE = 16;
/** It's over after this long, s (or once far off). */
export const FUNERAL_SECONDS = 120;
/** Passing this close to the line between two of its cars is cutting through it, m. */
export const CUT_MARGIN = 1.6;

/**
 * A path laid down by something moving (the hearse, the conga's leader):
 * points at least `step` m apart in a ring, and a point any distance back
 * along it, so followers keep to the same line round corners. Fixed size,
 * no allocation.
 */
export class Trail {
  private readonly xs: Float32Array;
  private readonly zs: Float32Array;
  private head = -1;
  private count = 0;

  constructor(
    readonly capacity = 160,
    readonly step = 0.6,
  ) {
    this.xs = new Float32Array(capacity);
    this.zs = new Float32Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  /** Where it's got to (the newest point is laid once it's `step` from the last). */
  push(x: number, z: number): void {
    if (this.count > 0 && len2(x - this.xs[this.head], z - this.zs[this.head]) < this.step) return;
    this.head = (this.head + 1) % this.capacity;
    this.xs[this.head] = x;
    this.zs[this.head] = z;
    if (this.count < this.capacity) this.count++;
  }

  /** Start again at (x, z) (a straight line back along `heading`, so followers have somewhere to go). */
  reset(x: number, z: number, heading: number, back: number): void {
    this.count = 0;
    this.head = -1;
    const n = Math.min(this.capacity, Math.ceil(back / this.step) + 1);
    for (let i = n - 1; i >= 0; i--) {
      const d = i * this.step;
      this.head = (this.head + 1) % this.capacity;
      this.xs[this.head] = x - Math.sin(heading) * d;
      this.zs[this.head] = z - Math.cos(heading) * d;
      this.count++;
    }
  }

  /**
   * How far back along the path (from the leader at (x, z)) the point on it
   * nearest (px, pz) is, m, looking no further back than `within`: where a
   * follower has got to. One pass, nothing allocated.
   */
  backOf(x: number, z: number, px: number, pz: number, within = 60): number {
    let ax = x;
    let az = z;
    let arc = 0;
    let best = 0;
    let bestD = (px - x) ** 2 + (pz - z) ** 2;
    for (let k = 0; k < this.count && arc < within; k++) {
      const i = (this.head - k + this.capacity) % this.capacity;
      const bx = this.xs[i];
      const bz = this.zs[i];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
      const cx = ax + dx * t - px;
      const cz = az + dz * t - pz;
      const d = cx * cx + cz * cz;
      const seg = Math.sqrt(l2);
      if (d < bestD) {
        bestD = d;
        best = arc + seg * t;
      }
      arc += seg;
      ax = bx;
      az = bz;
    }
    return best;
  }

  /** The point `back` m behind the newest along the path (from (x, z), the leader now), into `out`; the oldest if it's not that long. */
  at(x: number, z: number, back: number, out: { x: number; z: number }): { x: number; z: number } {
    let px = x;
    let pz = z;
    let left = back;
    for (let k = 0; k < this.count; k++) {
      const i = (this.head - k + this.capacity) % this.capacity;
      const qx = this.xs[i];
      const qz = this.zs[i];
      const seg = len2(qx - px, qz - pz);
      if (seg >= left && seg > 0) {
        const t = left / seg;
        out.x = px + (qx - px) * t;
        out.z = pz + (qz - pz) * t;
        return out;
      }
      left -= seg;
      px = qx;
      pz = qz;
    }
    out.x = px;
    out.z = pz;
    return out;
  }
}

/** Is (px, pz) within `margin` of the stretch between (ax, az) and (bx, bz), not past either end? */
export function cutsThrough(px: number, pz: number, ax: number, az: number, bx: number, bz: number, margin = CUT_MARGIN): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-6) return false;
  const t = ((px - ax) * dx + (pz - az) * dz) / l2;
  if (t <= 0.15 || t >= 0.85) return false;
  const cx = ax + dx * t - px;
  const cz = az + dz * t - pz;
  return cx * cx + cz * cz < margin * margin;
}

/** A follower's speed to keep `gap` m behind the car ahead (going at `ahead` m/s), `dist` m off now. */
export function followSpeed(dist: number, gap: number, ahead: number, top = FUNERAL_SPEED * 1.6): number {
  return Math.max(0, Math.min(top, ahead + (dist - gap) * 0.8));
}

// --- Burst hydrant ---------------------------------------------------------------

export const HYDRANT_CLOCK: IncidentClock = { every: [45, 60], cap: 1, first: 0, range: 120 };
/** A burst hydrant geysers this long, s, dying away over the last HYDRANT_FADE. */
export const HYDRANT_SECONDS = 40;
export const HYDRANT_FADE = 8;
/** Anyone (or a scooter) in the spray is knocked flat at most once in this long, s. */
export const HYDRANT_KNOCK_EVERY = 3;
/** Bystanders gather to gawp this far out, m; kids play in it by day when it's dry. */
export const GAWP_RADIUS = 5.5;
export const PLAY_HOURS = [10, 19] as const;

/** How hard it's going `age` s after the burst, 0..1: a moment to build, full, then easing off. */
export function geyserStrength(age: number, length = HYDRANT_SECONDS): number {
  if (age < 0 || age >= length) return 0;
  const rise = Math.min(1, age / 0.6);
  const fall = Math.min(1, (length - age) / HYDRANT_FADE);
  return rise * fall;
}

/** How far the spray knocks people over at `strength`, m. */
export function sprayReach(strength: number): number {
  return strength <= 0 ? 0 : 0.8 + 1.7 * strength;
}

/** Kids out playing in it (by day, dry), or a crowd standing well back to watch? */
export function playsInIt(hour: number, raining: boolean): boolean {
  return !raining && inHours(hour, PLAY_HOURS);
}

// --- Hen or stag conga -----------------------------------------------------------

export const CONGA_HOURS = [20, 2.5] as const;
export const CONGA_CLOCK: IncidentClock = { every: [180, 300], cap: 1, first: 40, range: 90 };
/** Dancers in the line; a pace apart, m; how long it goes on, s. */
export const CONGA_SIZE = [6, 9] as const;
export const CONGA_PITCH = 0.8;
export const CONGA_SECONDS = [70, 110] as const;
/** A fight this close and the conga piles in, m; mayhem this close gets a cheer, m. */
export const CONGA_JOIN = 24;
export const CONGA_CHEER = 45;
/** The night's out: the hens in pink, the stags in matching green tops (colours only). */
export const PARTY_OUTFITS = {
  hen: { shirt: '#ff5fa2', pants: '#f4e9f0' },
  stag: { shirt: '#7ad13c', pants: '#1d2330' },
} as const;

/** A conga here now? Late on, where there's nightlife (`nightlife`: the district's, 0..1). */
export function congaTime(hour: number, nightlife: number): boolean {
  return inHours(hour, CONGA_HOURS) && nightlife >= 0.3;
}

/** How many break off to pile into a fight: a third of the line (at least two, if there are two). */
export function congaJoiners(size: number): number {
  return Math.min(size, Math.max(2, Math.ceil(size / 3)));
}

// --- Film shoot ------------------------------------------------------------------

export const FILM_HOURS = [8, 23] as const;
export const FILM_DISTRICT: District = 'downtown';
export const FILM_CLOCK: IncidentClock = { every: [240, 400], cap: 1, first: 75, range: 110 };
/** The shoot lasts this long, s (two or three takes). */
export const FILM_SECONDS = [100, 140] as const;
/**
 * The set's roped off this far round its middle (half sizes along the kerb
 * and across it), m: the parking strip and the pavement, so the lane stays
 * open. Its middle stands this far from the road's centreline, m.
 */
export const SET_HALF = [9, 2.6] as const;
export const SET_OFFSET = 8.4;
/** A take: setting up, ACTION (the clapper), the staged blast, CUT, re-dress. Seconds from the take's start. */
export const TAKE = { action: 9, boom: 14, cut: 17, end: 26 } as const;
/** A car entering the set faster than this (or any crash on it) wrecks the shoot, m/s. */
export const SET_CRASH_SPEED = 4;
/** Made real: about a star's worth called in. */
export const REAL_CALL: readonly Crime[] = ['assault', 'assault', 'assault', 'assault'];

export type TakePhase = 'setup' | 'action' | 'boom' | 'cut';

/** Where a take is `t` s in (they loop every TAKE.end). */
export function takePhase(t: number): TakePhase {
  const k = ((t % TAKE.end) + TAKE.end) % TAKE.end;
  return k < TAKE.action ? 'setup' : k < TAKE.boom ? 'action' : k < TAKE.cut ? 'boom' : 'cut';
}

export interface FilmSense {
  /** The player drove onto the set fast, or crashed into its cars. */
  setHit: boolean;
  /** The player drove off in the hero car. */
  heroTaken: boolean;
  /** The player knocked someone down on the set, fired a gun or set off a real blast there. */
  realFight: boolean;
}

/** Has the player made it real, and how? Stealing the star car first, then a fight, then the wreck. */
export function madeReal(s: FilmSense): 'stolen' | 'fight' | 'wrecked' | null {
  return s.heroTaken ? 'stolen' : s.realFight ? 'fight' : s.setHit ? 'wrecked' : null;
}

/** Is (x, z) on the set (centre (cx, cz), along the kerb `heading`)? `pad` grows it, m. */
export function onSet(x: number, z: number, cx: number, cz: number, heading: number, pad = 0): boolean {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const dx = x - cx;
  const dz = z - cz;
  const along = dx * fx + dz * fz;
  const across = dx * fz - dz * fx;
  return Math.abs(along) < SET_HALF[0] + pad && Math.abs(across) < SET_HALF[1] + pad;
}

/**
 * The `i`th of `n` rope posts round the set (centre (cx, cz), along the
 * kerb `heading`): along its two ends and its road side (the shopfronts
 * close the other), evenly, into `out`. Across is + toward the road (left
 * of the lane's heading, the kerb being on its right).
 */
export function ropePost(i: number, n: number, cx: number, cz: number, heading: number, out: { x: number; z: number }): { x: number; z: number } {
  const [a, b] = SET_HALF;
  let d = (i / Math.max(1, n - 1)) * (2 * a + 4 * b);
  let u: number;
  let v: number;
  if (d <= 2 * b) {
    u = -a;
    v = -b + d;
  } else if ((d -= 2 * b) <= 2 * a) {
    u = -a + d;
    v = b;
  } else {
    d -= 2 * a;
    u = a;
    v = b - d;
  }
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  out.x = cx + fx * u + fz * v;
  out.z = cz + fz * u - fx * v;
  return out;
}
