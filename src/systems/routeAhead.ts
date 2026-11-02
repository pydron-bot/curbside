/**
 * Route-ahead placement (V2-02): while the player is wanted, now and then a
 * busy scene that arrives by car (a police chase, a street race) is put on
 * a lane 60–150 m ahead of where they're driving, off-screen, coming their
 * way, so the pursuit runs into it instead of it starting somewhere behind.
 * At most once per ROUTE_EVERY s so it never feels scripted. Scenes that
 * pick among spots already there (a traffic pair for an accident, a turf
 * border) take only ones on the way (onRoute). Pure: tested in
 * tests/routeAhead.test.ts.
 */
import type { Rect } from '../world/city';
import { BLOCK_SIZE } from '../world/city';
import { DIR_VEC, MAX_NODE, type Dir } from '../world/roads';
import { spawnAi, type AiDriver } from './traffic';
import { len2 } from '../core/len';

/** How far ahead of the player, m. */
export const ROUTE_AHEAD = [60, 150] as const;
/** At most one placed ahead this often, s. */
export const ROUTE_EVERY = 45;
/** Slower than this there's no "ahead" to speak of, m/s. */
export const ROUTE_MIN_SPEED = 6;
/** Picks within this of the way they're going, rad (the lane snap then moves it a little). */
const CONE = Math.PI / 7;
/** The spot itself must be within this of the way they're going (cos 45°). */
const AHEAD_COS = Math.SQRT1_2;
/** Clear of the screen's edge by this, m (a car length). */
const VIEW_MARGIN = 6;
const TRIES = 24;

export interface RouteSpot {
  x: number;
  z: number;
  heading: number;
  /** A traffic driver on that lane, heading toward the player. */
  driver: AiDriver;
}

/**
 * A lane spot ahead of a player at (px, pz) moving at (vx, vz): 60–150 m
 * off, within 45° of their way, outside `view` (with a margin), not
 * `crowded`, its car facing back toward them. Null when they're slow or
 * nothing fits (the city's edge, a crowded road).
 */
export function routeAheadSpot(
  px: number,
  pz: number,
  vx: number,
  vz: number,
  view: Rect,
  rand: () => number,
  crowded: (x: number, z: number) => boolean,
): RouteSpot | null {
  const sp = len2(vx, vz);
  if (sp < ROUTE_MIN_SPEED) return null;
  const ux = vx / sp;
  const uz = vz / sp;
  const heading = Math.atan2(vz, vx);
  const [lo, hi] = ROUTE_AHEAD;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const a = heading + (rand() * 2 - 1) * CONE;
    const r = lo + rand() * (hi - lo);
    const sx = px + Math.cos(a) * r;
    const sz = pz + Math.sin(a) * r;
    // Drive toward the player along whichever axis has further to go (as the police arrive).
    const tx = px - sx;
    const tz = pz - sz;
    const dir: Dir = Math.abs(tx) > Math.abs(tz) ? (tx > 0 ? 1 : 3) : tz > 0 ? 2 : 0;
    const v = DIR_VEC[dir];
    const ix = Math.round(sx / BLOCK_SIZE) + v.x;
    const iz = Math.round(sz / BLOCK_SIZE) + v.z;
    if (Math.abs(ix) > MAX_NODE || Math.abs(iz) > MAX_NODE) continue;
    const spot = spawnAi(ix, iz, dir, 0.2 + rand() * 0.6, rand);
    if (!spot) continue;
    const dx = spot.x - px;
    const dz = spot.z - pz;
    const d = len2(dx, dz);
    if (d < lo || d > hi) continue;
    if (dx * ux + dz * uz < d * AHEAD_COS) continue;
    if (spot.x > view.minX - VIEW_MARGIN && spot.x < view.maxX + VIEW_MARGIN && spot.z > view.minZ - VIEW_MARGIN && spot.z < view.maxZ + VIEW_MARGIN) continue;
    if (crowded(spot.x, spot.z)) continue;
    return spot;
  }
  return null;
}

/** A scene picking among natural spots (traffic, a turf border) takes ones within this of a wanted player's way (cos 60°). */
export const ON_ROUTE_COS = 0.5;

/**
 * Is (x, z) on the way of a player at (px, pz) moving at (vx, vz): within
 * 60° of where they're heading? Anything is, for a player too slow to
 * have a way.
 */
export function onRoute(px: number, pz: number, vx: number, vz: number, x: number, z: number): boolean {
  const sp = len2(vx, vz);
  if (sp < ROUTE_MIN_SPEED) return true;
  const dx = x - px;
  const dz = z - pz;
  return dx * vx + dz * vz >= ON_ROUTE_COS * sp * len2(dx, dz);
}

/** The once-per-ROUTE_EVERY throttle, wanted only. */
export class RouteAhead {
  /** Placed so far (diagnostics, the harness). */
  placed = 0;
  private last = -Infinity;

  /** May the next car-borne scene go on the route at `now` with `stars`? */
  ready(now: number, stars: number): boolean {
    return stars > 0 && now - this.last >= ROUTE_EVERY;
  }

  /** One went on the route. */
  used(now: number): void {
    this.last = now;
    this.placed++;
  }

  /** A fresh run. */
  reset(): void {
    this.last = -Infinity;
  }
}
