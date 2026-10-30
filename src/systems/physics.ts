/**
 * Collision response for moving bodies. Cars are three circles along their
 * length; peds are one circle. Static obstacles come from a StaticGrid.
 * Each function returns the impact speed (m/s along the contact normal) so
 * damage/sound can hook in; 0 means no hit. The hot paths here run for every
 * car/ped pair every step, so they reuse scratch objects instead of allocating.
 */
import type { PedState } from '../entities/pedestrian';
import type { VehicleState } from '../entities/vehicle';
import type { StaticGrid } from '../world/collision';

export const CAR_CIRCLE_RADIUS = 0.98;
/** Circle centres along the car's forward axis, m. */
export const CAR_CIRCLE_OFFSETS = [-1.38, 0, 1.38] as const;
export const PED_RADIUS = 0.35;

const WALL_RESTITUTION = 0.25;
const WALL_FRICTION = 0.85;
const CAR_RESTITUTION = 0.35;
/** Centre distance beyond which two cars can't touch. */
const CAR_REACH = (CAR_CIRCLE_OFFSETS[2] + CAR_CIRCLE_RADIUS) * 2;
/** Centre distance beyond which a ped can't touch a car. */
const PED_CAR_REACH = CAR_CIRCLE_OFFSETS[2] + CAR_CIRCLE_RADIUS + PED_RADIUS;

export interface Point {
  x: number;
  z: number;
}

const newCircles = (): Point[] => [
  { x: 0, z: 0 },
  { x: 0, z: 0 },
  { x: 0, z: 0 },
];
const scratchA = newCircles();
const scratchB = newCircles();
const scratchPos: Point = { x: 0, z: 0 };

/**
 * The car's three collision-circle centres. Pass `out` (three points) to
 * reuse storage; without it a fresh array is returned.
 */
export function carCircles(s: VehicleState, out: Point[] = newCircles()): Point[] {
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  for (let i = 0; i < 3; i++) {
    out[i].x = s.x + fx * CAR_CIRCLE_OFFSETS[i];
    out[i].z = s.z + fz * CAR_CIRCLE_OFFSETS[i];
  }
  return out;
}

/**
 * Push a car out of walls and bounce it. If `contact` is given and the car
 * hit something, it receives the point of impact (on the wall surface).
 */
export function collideVehicleStatic(s: VehicleState, grid: StaticGrid, contact?: Point): number {
  let impact = 0;
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  const pos = scratchPos;
  for (const offset of CAR_CIRCLE_OFFSETS) {
    pos.x = s.x + fx * offset;
    pos.z = s.z + fz * offset;
    const c = grid.resolveCircle(pos, CAR_CIRCLE_RADIUS);
    if (!c) continue;
    // Shift the whole car by however far this circle was pushed.
    s.x = pos.x - fx * offset;
    s.z = pos.z - fz * offset;
    const vn = s.vx * c.nx + s.vz * c.nz;
    if (vn < 0) {
      s.vx -= (1 + WALL_RESTITUTION) * vn * c.nx;
      s.vz -= (1 + WALL_RESTITUTION) * vn * c.nz;
      s.vx *= WALL_FRICTION;
      s.vz *= WALL_FRICTION;
      s.yawRate *= 0.6;
      if (-vn > impact) {
        impact = -vn;
        if (contact) {
          contact.x = pos.x - c.nx * CAR_CIRCLE_RADIUS;
          contact.z = pos.z - c.nz * CAR_CIRCLE_RADIUS;
        }
      }
    }
  }
  return impact;
}

/**
 * Separate two overlapping cars and exchange momentum (equal masses). If
 * `contact` is given and they hit, it receives the point where they touched.
 */
export function collideVehicles(a: VehicleState, b: VehicleState, contact?: Point): number {
  // Cheap reject: centres further apart than the cars' full lengths.
  if (Math.abs(a.x - b.x) > CAR_REACH || Math.abs(a.z - b.z) > CAR_REACH) return 0;

  let impact = 0;
  const ca = carCircles(a, scratchA);
  const cb = carCircles(b, scratchB);
  for (const p of ca) {
    for (const q of cb) {
      let dx = p.x - q.x;
      let dz = p.z - q.z;
      const d = Math.hypot(dx, dz);
      const overlap = CAR_CIRCLE_RADIUS * 2 - d;
      if (overlap <= 0) continue;
      if (d > 1e-6) {
        dx /= d;
        dz /= d;
      } else {
        dx = 1;
        dz = 0;
      }
      if (contact) {
        contact.x = (p.x + q.x) / 2;
        contact.z = (p.z + q.z) / 2;
      }
      // Separate equally, then exchange momentum along the normal (equal masses).
      a.x += dx * overlap * 0.5;
      a.z += dz * overlap * 0.5;
      b.x -= dx * overlap * 0.5;
      b.z -= dz * overlap * 0.5;
      const vrel = (a.vx - b.vx) * dx + (a.vz - b.vz) * dz;
      if (vrel < 0) {
        const j = (-(1 + CAR_RESTITUTION) * vrel) / 2;
        a.vx += j * dx;
        a.vz += j * dz;
        b.vx -= j * dx;
        b.vz -= j * dz;
        a.yawRate *= 0.7;
        b.yawRate *= 0.7;
        impact = Math.max(impact, -vrel);
      }
      return impact; // one contact pair per step is enough to separate
    }
  }
  return impact;
}

export function collidePedStatic(p: PedState, grid: StaticGrid): number {
  const c = grid.resolveCircle(p, PED_RADIUS);
  if (!c) return 0;
  return removeInward(p, c.nx, c.nz);
}

/** Peds can't walk through cars; the car isn't affected (it's far heavier). */
export function collidePedVehicle(p: PedState, v: VehicleState): number {
  if (Math.abs(p.x - v.x) > PED_CAR_REACH || Math.abs(p.z - v.z) > PED_CAR_REACH) return 0;
  let impact = 0;
  for (const q of carCircles(v, scratchA)) {
    let dx = p.x - q.x;
    let dz = p.z - q.z;
    const d = Math.hypot(dx, dz);
    const overlap = CAR_CIRCLE_RADIUS + PED_RADIUS - d;
    if (overlap <= 0) continue;
    if (d > 1e-6) {
      dx /= d;
      dz /= d;
    } else {
      dx = 1;
      dz = 0;
    }
    p.x += dx * overlap;
    p.z += dz * overlap;
    impact = Math.max(impact, removeInward(p, dx, dz));
  }
  return impact;
}

function removeInward(p: { vx: number; vz: number }, nx: number, nz: number): number {
  const vn = p.vx * nx + p.vz * nz;
  if (vn >= 0) return 0;
  p.vx -= vn * nx;
  p.vz -= vn * nz;
  return -vn;
}
