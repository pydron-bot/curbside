/**
 * The smoke grenade (W3-B): a thrown canister (systems/projectiles.ts, the
 * grenade's arc and bounce) that hisses into life SMOKE_FUSE after the
 * throw and pours a thick cloud for SMOKE_THICK seconds, then thins away
 * over SMOKE_FADE (the look only: a thinning cloud does nothing). At most
 * MAX_CLOUDS at once (the iPhone's smoke budget); another throw replaces
 * the oldest. Pure and tested (tests/smoke.test.ts); game/combat.ts pops
 * the cloud and applies it to people and traffic, systems/police.ts to
 * the police, render/smokeLook.ts draws it.
 *
 * - **Sight** (systems/sight.ts): nobody sees into, out of or through a
 *   thick cloud, unless they're within arm's length (SMOKE_NEAR). A unit
 *   inside or looking through it loses you and drops into search; the
 *   helicopter's spotlight can't find you inside it.
 * - **Police cars** in it are confused (Daze): each picks one of crawl to
 *   a stop, stop dead with hazards on, or take a wrong turn at the next
 *   junction, about a third each, so a chase visibly scatters. Crawling
 *   and stopped cars get going again once they're out of it (or it thins);
 *   a wrong turn is taken whatever happens to the cloud.
 * - **Officers on foot** stop and cough (no running, no shooting);
 *   **people** cough and walk out of it; **drivers** brake hard (rear-end
 *   shunts welcome) and sit there until it clears.
 */
import { forwardSpeed, type VehicleControls, type VehicleState } from '../entities/vehicle';
import { canLeave, reverse, turnLeft, turnRight, type Dir } from '../world/roads';
import type { PedAgent } from './crowd';
import { routeToward, type PursuitDriver, type PursuitTarget } from './pursuit';
import { driveAi, rerouteAi, startleDriver, type AiDriver, type Obstacle } from './traffic';
import { len2 } from '../core/len';

/** The canister hisses into life this long after the throw, s. */
export const SMOKE_FUSE = 1.2;
/** The cloud billows from SMOKE_START_RADIUS to SMOKE_RADIUS over this long, s. */
export const SMOKE_POUR = 1.5;
export const SMOKE_START_RADIUS = 2.5;
/** A full cloud's radius, m: about a road's width and a pavement either side. */
export const SMOKE_RADIUS = 6.5;
/** Thick (it hides and confuses) this long from the pop, s... */
export const SMOKE_THICK = 9;
/** ...then thins away over this long (no effect: the look only), s. */
export const SMOKE_FADE = 2.5;
/** Clouds at once: smoke is the costliest effect on the iPhone. */
export const MAX_CLOUDS = 2;
/** Closer than this, m, smoke hides nobody (bumping into you in it). */
export const SMOKE_NEAR = 2.5;
/** What the smoke does (a cough, a car's brake, a crawl) lasts this long after leaving it, s. */
export const SMOKE_LINGER = 0.6;
/** A wrong turn is taken within this long or forgotten, s. */
export const WRONG_TURN_MAX = 12;
/** A confused car on its wrong turn goes no faster than this, m/s. */
export const WRONG_TURN_CRUISE = 9;

export interface SmokeCloud {
  alive: boolean;
  x: number;
  z: number;
  /** Seconds since it popped. */
  age: number;
  byPlayer: boolean;
}

/** What sight needs to know about smoke (systems/sight.ts, systems/police.ts). */
export interface SmokeView {
  /** Is the line from (ax, az) to (bx, bz) through (or from or into) a thick cloud? Never under SMOKE_NEAR. */
  blocks(ax: number, az: number, bx: number, bz: number): boolean;
  /** Is (x, z) inside a thick cloud? */
  hides(x: number, z: number): boolean;
}

/** A cloud's radius `age` s after it popped, m. */
export function cloudRadius(age: number): number {
  if (age >= SMOKE_POUR) return SMOKE_RADIUS;
  const k = Math.max(0, age) / SMOKE_POUR;
  // Billows out fast, then settles.
  return SMOKE_START_RADIUS + (SMOKE_RADIUS - SMOKE_START_RADIUS) * (1 - (1 - k) * (1 - k));
}

/** Is the cloud still thick (hiding, confusing)? */
export function isThick(c: SmokeCloud): boolean {
  return c.alive && c.age < SMOKE_THICK;
}

/** Distance from (px, pz) to the segment (ax, az)-(bx, bz), m. */
function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return len2(ax + dx * t - px, az + dz * t - pz);
}

/** The clouds: a fixed pool of MAX_CLOUDS (nothing allocated while playing). */
export class SmokeClouds implements SmokeView {
  readonly list: SmokeCloud[] = [];

  constructor() {
    for (let i = 0; i < MAX_CLOUDS; i++) this.list.push({ alive: false, x: 0, z: 0, age: 0, byPlayer: false });
  }

  /** A canister pops at (x, z): a new cloud (the oldest makes way when they're all out). */
  add(x: number, z: number, byPlayer: boolean): SmokeCloud {
    let c = this.list.find((q) => !q.alive);
    if (!c) {
      c = this.list[0];
      for (const q of this.list) if (q.age > c.age) c = q;
    }
    c.alive = true;
    c.x = x;
    c.z = z;
    c.age = 0;
    c.byPlayer = byPlayer;
    return c;
  }

  step(dt: number): void {
    for (const c of this.list) {
      if (!c.alive) continue;
      c.age += dt;
      if (c.age >= SMOKE_THICK + SMOKE_FADE) c.alive = false;
    }
  }

  /** Any cloud still thick? (Nothing to apply otherwise.) */
  get thick(): boolean {
    for (const c of this.list) if (isThick(c)) return true;
    return false;
  }

  /** Any cloud at all, thick or thinning (the look)? */
  get active(): boolean {
    for (const c of this.list) if (c.alive) return true;
    return false;
  }

  /** The thick cloud (x, z) is in, give or take `margin` m, or null. */
  at(x: number, z: number, margin = 0): SmokeCloud | null {
    for (const c of this.list) {
      if (!isThick(c)) continue;
      const r = cloudRadius(c.age) + margin;
      if (Math.abs(x - c.x) < r && Math.abs(z - c.z) < r && len2(x - c.x, z - c.z) < r) return c;
    }
    return null;
  }

  hides(x: number, z: number): boolean {
    return this.at(x, z) !== null;
  }

  blocks(ax: number, az: number, bx: number, bz: number): boolean {
    if (len2(bx - ax, bz - az) < SMOKE_NEAR) return false;
    for (const c of this.list) {
      if (!isThick(c)) continue;
      if (segmentDistance(c.x, c.z, ax, az, bx, bz) < cloudRadius(c.age)) return true;
    }
    return false;
  }

  /** Clear the air (a fresh run, the title). */
  clear(): void {
    for (const c of this.list) c.alive = false;
  }
}

// --- People and drivers ----------------------------------------------------------

/**
 * Someone in a thick cloud centred on (cx, cz) coughs for SMOKE_LINGER
 * more: officers and anyone fighting stop where they are (no running, no
 * shooting), everyone else walks out of it, away from the middle. The
 * fallen and the burning have other worries. True if they've only just
 * started (for the sound).
 */
export function cough(p: PedAgent, cx: number, cz: number): boolean {
  if (p.mode === 'down' || p.burning > 0) return false;
  const fresh = p.cough <= 0;
  p.cough = Math.max(p.cough, SMOKE_LINGER);
  if (p.role === 'cop' || p.mode === 'fight' || p.mode === 'shoot') return fresh;
  if (fresh || p.mode !== 'flee') {
    const dx = p.s.x - cx;
    const dz = p.s.z - cz;
    const d = len2(dx, dz);
    p.mode = 'flee';
    p.cower = 0;
    p.fleeX = d > 0.05 ? dx / d : Math.sin(p.s.heading);
    p.fleeZ = d > 0.05 ? dz / d : Math.cos(p.s.heading);
  }
  p.timer = Math.max(p.timer, SMOKE_LINGER);
  return fresh;
}

/** A driver in the cloud brakes hard and sits there until SMOKE_LINGER after it's clear (then a honk). */
export function brakeInSmoke(ai: AiDriver): void {
  startleDriver(ai, SMOKE_LINGER, 0);
}

// --- Police cars: confused ---------------------------------------------------------

export type Confusion = 'none' | 'crawl' | 'hazards' | 'wrongTurn';

/** A police car's state of confusion (systems/police.ts keeps one per unit). */
export interface Daze {
  confused: Confusion;
  /** Seconds left (crawl, hazards: after leaving the cloud; a wrong turn: to take it). */
  left: number;
  /** A wrong turn: the junction it goes wrong at (NaN until picked) and the way it goes. */
  wrongIx: number;
  wrongIz: number;
  wrongDir: Dir;
}

export function createDaze(): Daze {
  return { confused: 'none', left: 0, wrongIx: NaN, wrongIz: NaN, wrongDir: 0 };
}

/** What a car entering the smoke does: crawl to a stop, stop dead with hazards on, or a wrong turn, a third each. */
export function pickConfusion(rand: () => number): Exclude<Confusion, 'none'> {
  const r = rand() * 3;
  return r < 1 ? 'crawl' : r < 2 ? 'hazards' : 'wrongTurn';
}

/**
 * One step of a police car's daze: entering a thick cloud picks a
 * confusion (`d`, its driver, goes back on the lanes for a wrong turn);
 * in it, it holds; out of it, a crawl or a stop lasts SMOKE_LINGER more
 * and a wrong turn until it's taken (or WRONG_TURN_MAX).
 */
export function stepDaze(z: Daze, inSmoke: boolean, d: PursuitDriver, car: VehicleState, rand: () => number, dt: number): void {
  if (z.confused === 'none') {
    if (!inSmoke) return;
    z.confused = pickConfusion(rand);
    if (z.confused === 'wrongTurn') {
      z.left = WRONG_TURN_MAX;
      z.wrongIx = z.wrongIz = NaN;
      rerouteAi(d.road, car, rand);
      d.mode = 'route';
    } else z.left = SMOKE_LINGER;
    return;
  }
  if (z.confused === 'wrongTurn') {
    if ((z.left -= dt) <= 0) z.confused = 'none';
    return;
  }
  if (inSmoke) z.left = SMOKE_LINGER;
  else if ((z.left -= dt) <= 0) z.confused = 'none';
}

/**
 * The way a lost driver goes at junction (ix, iz), arriving heading `dir`:
 * anything but the way to (tx, tz) (routeToward), never a U-turn unless
 * there's nothing else.
 */
export function wrongWay(ix: number, iz: number, dir: Dir, tx: number, tz: number, rand: () => number): Dir {
  const right = routeToward(ix, iz, dir, tx, tz);
  let n = 0;
  let pick: Dir = right;
  // Straight, left, right: a uniform pick among the wrong ones.
  for (let k = 0; k < 3; k++) {
    const d = k === 0 ? dir : k === 1 ? turnLeft(dir) : turnRight(dir);
    if (d === right || !canLeave(ix, iz, d)) continue;
    n++;
    if (rand() * n < 1) pick = d;
  }
  if (n === 0 && right !== reverse(dir) && canLeave(ix, iz, reverse(dir))) return reverse(dir);
  return pick;
}

/** Reused output (consume it before the next call), as in traffic.ts and pursuit.ts. */
const controls: VehicleControls = { throttle: 0, steer: 0, handbrake: false };

/**
 * Controls for a confused police car (`z.confused` isn't 'none'): a crawl
 * eases off to a stop, hazards stamp on the brake and hold it there, a
 * wrong turn drives the lanes at WRONG_TURN_CRUISE and goes the wrong way
 * at the next junction (`t`: where the police think the player is). The
 * returned object is reused.
 */
export function driveDazed(z: Daze, d: PursuitDriver, car: VehicleState, t: PursuitTarget, obstacles: Obstacle[], rand: () => number, dt: number): VehicleControls {
  const vF = forwardSpeed(car);
  if (z.confused === 'wrongTurn') {
    const road = d.road;
    road.cruise = WRONG_TURN_CRUISE;
    road.urgent = false;
    const c = driveAi(road, car, obstacles, rand, dt);
    if (road.phase === 'approach') {
      if (Number.isNaN(z.wrongIx)) {
        z.wrongIx = road.ix;
        z.wrongIz = road.iz;
        z.wrongDir = wrongWay(road.ix, road.iz, road.dir, t.x, t.z, rand);
      } else if (road.ix !== z.wrongIx || road.iz !== z.wrongIz) {
        // Through it the wrong way: snap out of it (the chase routes back from here).
        z.confused = 'none';
        return c;
      }
      road.next = z.wrongDir;
    }
    return c;
  }
  controls.steer = 0;
  if (z.confused === 'crawl') {
    // Easing off, rolling deeper into it.
    controls.throttle = vF > 0.6 ? Math.max(-0.3, -vF * 0.05) : 0;
    controls.handbrake = vF <= 0.6;
  } else {
    controls.throttle = vF > 0.6 ? -1 : 0;
    controls.handbrake = vF <= 0.6;
  }
  return controls;
}
