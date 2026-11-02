/**
 * The stinger (W3-B): a folding spike strip, thrown like a grenade on foot
 * or dropped out of the back of the car, that lies across the road and
 * bursts the tyres of whatever drives over it: police too, so it's a way to
 * shake a chase without firing a shot. Pure and tested (tests/stinger.test.ts);
 * game/combat.ts lays the strips (a `stinger` event), checks every car
 * against them each step and reports a `tyresBurst`, which heat, the scanner,
 * the score, audio and effects pick up.
 *
 * - **Laying it:** on a straight road it squares itself across the road and
 *   stays on the tarmac (STINGER_LENGTH covers one carriageway, more if it
 *   lands across the middle); in a junction or off the road it lies square
 *   to the way it was thrown or driven. MAX_STINGERS down at once (the
 *   oldest is pulled up), each for STINGER_LIFE or STINGER_BITES cars.
 * - **Crossing it:** a car whose wheels pass over the strip on the ground
 *   (one in the air over it is spared) gets its tyres burst: a slew (a yaw
 *   kick and the rear let loose, harder the faster it was going), then life
 *   on the rims (entities/vehicle.ts FLAT_*: half the top speed, less grip
 *   and brakes, a pull to one side). Traffic brakes hard and sits a moment
 *   (traffic.ts startleDriver); police in a chase limp on, falling behind.
 */
import { len2 } from '../core/len';
import type { CarBody, Tyres, VehicleState } from '../entities/vehicle';
import { BLOCK_SIZE, ROAD_WIDTH } from '../world/city';
import { startleDriver, type AiDriver } from './traffic';

/** The strip's length, m: one carriageway of a road. */
export const STINGER_LENGTH = ROAD_WIDTH / 2;
/** How close (m) to the strip's line a wheel has to come: the spikes' width and a tyre's. */
export const STINGER_REACH = 0.35;
/** It stays down this long, s, or until this many cars have run over it (chewed up). */
export const STINGER_LIFE = 40;
export const STINGER_BITES = 6;
/** Most strips down at once. */
export const MAX_STINGERS = 3;
/** It unrolls this fast after landing, s (the look; it bites from the first moment). */
export const STINGER_UNROLL = 0.3;
/** Dropped out of a car, it lands this far behind the back bumper, m. */
export const DROP_BEHIND = 1.2;
/** At this speed and up (m/s) a burst is the full slew: this yaw kick (rad/s) and the rear this loose (0..1). */
export const SLEW_SPEED = 20;
export const SLEW_YAW = 1.4;
export const SLEW_SLIDE = 0.85;
/** How hard the flats pull: between these (either way). */
export const PULL: readonly [number, number] = [0.45, 1];
/** Traffic that runs over it brakes and sits this long, s, then carries on on its rims. */
export const STUNG_STALL: readonly [number, number] = [1.5, 3];

export interface Stinger {
  alive: boolean;
  /** Its middle, m. */
  x: number;
  z: number;
  /** Unit vector along the strip. */
  ax: number;
  az: number;
  /** Seconds since it landed. */
  age: number;
  /** Cars it has burst. */
  bites: number;
  byPlayer: boolean;
}

/** Where and which way a strip lies (stingerAcross writes it). */
export interface StingerPlace {
  x: number;
  z: number;
  ax: number;
  az: number;
}

/**
 * Where a strip landing at (x, z), thrown or driven along (dirX, dirZ),
 * lies. On a straight road (x or z within half a road of a multiple of
 * BLOCK_SIZE, not both) it's square across it and kept on the tarmac; in a
 * junction or off the road, square to (dirX, dirZ). Writes into `out`.
 */
export function stingerAcross(x: number, z: number, dirX: number, dirZ: number, out: StingerPlace): StingerPlace {
  const half = ROAD_WIDTH / 2;
  // Offsets from the nearest road centrelines: x = k·BLOCK_SIZE runs north-south, z = k·BLOCK_SIZE east-west.
  const gx = x - Math.round(x / BLOCK_SIZE) * BLOCK_SIZE;
  const gz = z - Math.round(z / BLOCK_SIZE) * BLOCK_SIZE;
  const ns = Math.abs(gx) < half;
  const ew = Math.abs(gz) < half;
  // The middle may sit this far off the centreline and the strip still end at the kerb.
  const span = (ROAD_WIDTH - STINGER_LENGTH) / 2;
  if (ns && !ew) {
    out.x = x - gx + Math.max(-span, Math.min(span, gx));
    out.z = z;
    out.ax = 1;
    out.az = 0;
  } else if (ew && !ns) {
    out.x = x;
    out.z = z - gz + Math.max(-span, Math.min(span, gz));
    out.ax = 0;
    out.az = 1;
  } else {
    const d = len2(dirX, dirZ);
    out.x = x;
    out.z = z;
    out.ax = d > 1e-6 ? -dirZ / d : 1;
    out.az = d > 1e-6 ? dirX / d : 0;
  }
  return out;
}

/**
 * Are the wheels of a car at `s` with footprint `body` over the strip? The
 * line between its axles (the body's first and last circles) has to cross
 * the strip's line within STINGER_REACH, inside the strip's ends (plus the
 * track). Not while it's in the air.
 */
export function stingerTouches(st: Stinger, s: VehicleState, body: CarBody): boolean {
  if (s.y > 0.3) return false;
  const lim = STINGER_LENGTH / 2 + body.reach;
  if (Math.abs(s.x - st.x) > lim || Math.abs(s.z - st.z) > lim) return false;
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  const offs = body.offsets;
  const front = offs[offs.length - 1];
  const rear = offs[0];
  // Each axle in the strip's frame: u along it, w across it.
  const rx = s.x - st.x;
  const rz = s.z - st.z;
  const uf = (rx + fx * front) * st.ax + (rz + fz * front) * st.az;
  const wf = -(rx + fx * front) * st.az + (rz + fz * front) * st.ax;
  const ur = (rx + fx * rear) * st.ax + (rz + fz * rear) * st.az;
  const wr = -(rx + fx * rear) * st.az + (rz + fz * rear) * st.ax;
  if (Math.min(wf, wr) > STINGER_REACH || Math.max(wf, wr) < -STINGER_REACH) return false;
  // Where along the strip the car crosses it (lying along it: its middle).
  const t = Math.abs(wf - wr) > 1e-3 ? Math.max(0, Math.min(1, wf / (wf - wr))) : 0.5;
  const u = uf + (ur - uf) * t;
  return Math.abs(u) <= STINGER_LENGTH / 2 + body.halfWidth * 0.8;
}

/**
 * Burst a car's tyres: they go flat (`tyres`, its DamageState) with a pull
 * one way, and it slews, a yaw kick and the rear let loose, as hard as it
 * was going fast.
 */
export function burstTyres(s: VehicleState, tyres: Tyres, rand: () => number): void {
  tyres.flat = 1;
  tyres.pull = (rand() < 0.5 ? -1 : 1) * (PULL[0] + rand() * (PULL[1] - PULL[0]));
  const k = Math.min(1, len2(s.vx, s.vz) / SLEW_SPEED);
  s.yawRate += tyres.pull * SLEW_YAW * k;
  s.slide = Math.max(s.slide, SLEW_SLIDE * k);
}

/** A driver who's just run over one: stamp on the brake, sit a moment, then crawl on. */
export function stungDriver(ai: AiDriver, rand: () => number): void {
  startleDriver(ai, STUNG_STALL[0] + rand() * (STUNG_STALL[1] - STUNG_STALL[0]), 0);
}

/** The strips down on the road, in a fixed pool. */
export class Stingers {
  readonly list: Stinger[] = [];

  constructor() {
    for (let i = 0; i < MAX_STINGERS; i++) this.list.push({ alive: false, x: 0, z: 0, ax: 1, az: 0, age: 0, bites: 0, byPlayer: false });
  }

  /** Lay one where `at` says (the oldest is pulled up if they're all down). */
  lay(at: StingerPlace, byPlayer: boolean): Stinger {
    let st = this.list[0];
    for (const q of this.list) {
      if (!q.alive) {
        st = q;
        break;
      }
      if (q.age > st.age) st = q;
    }
    st.alive = true;
    st.x = at.x;
    st.z = at.z;
    st.ax = at.ax;
    st.az = at.az;
    st.age = 0;
    st.bites = 0;
    st.byPlayer = byPlayer;
    return st;
  }

  /** It burst a car's tyres: one bite nearer chewed up. */
  bite(st: Stinger): void {
    if (++st.bites >= STINGER_BITES) st.alive = false;
  }

  /** Any strip down? */
  get active(): boolean {
    for (const st of this.list) if (st.alive) return true;
    return false;
  }

  step(dt: number): void {
    for (const st of this.list) {
      if (!st.alive) continue;
      if ((st.age += dt) >= STINGER_LIFE) st.alive = false;
    }
  }

  clear(): void {
    for (const st of this.list) st.alive = false;
  }
}
