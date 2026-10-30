/**
 * Collision response for moving bodies. Cars are circles along their length
 * (three for a standard car, five for a bus, two small ones for a bike: see
 * VEHICLE_BODIES); peds are one circle. Static obstacles come from a
 * StaticGrid. Each function returns the impact speed (m/s along the contact
 * normal) so damage/sound can hook in; 0 means no hit. The hot paths here
 * run for every car/ped pair every step, so they reuse scratch objects
 * instead of allocating.
 */
import type { PedState } from '../entities/pedestrian';
import { CAR_BODY, type CarBody, type VehicleState } from '../entities/vehicle';
import type { StaticGrid } from '../world/collision';

/** The standard car's circles (most cars); long vehicles and bikes carry their own (VehicleState.body). */
export const CAR_CIRCLE_RADIUS = CAR_BODY.radius;
/** Circle centres along the standard car's forward axis, m. */
export const CAR_CIRCLE_OFFSETS = CAR_BODY.offsets;
export const PED_RADIUS = 0.35;

const WALL_RESTITUTION = 0.25;
/**
 * Wall friction scrubs the speed *along* the wall, growing with the square
 * of how hard the car hit it: a glancing touch keeps nearly all its pace
 * and slides along, a head-on hit (|vn| ≥ WALL_HARD) loses this share of it.
 */
const WALL_SCRUB = 0.45;
const WALL_HARD = 10;
/** Nose into the wall at less than this (sin of the angle, ~40°): swing it along the wall. */
const GLANCE_MAX = 0.64;
/** Yaw kick per radian of glancing angle, rad/s: the car turns parallel rather than grinding. */
const GLANCE_ALIGN = 7;
const CAR_RESTITUTION = 0.35;
/** Cars this high above the road (ramps, jumps) pass over other cars, m. */
export const CLEARANCE = 1.1;

export interface Point {
  x: number;
  z: number;
}

/**
 * Where two cars touched, plus what damage needs: the contact normal (from b
 * toward a) and how much of the closing speed each car brought (pre-impulse,
 * m/s along the normal; the rammer brings most of it).
 */
export interface CarContact extends Point {
  nx: number;
  nz: number;
  closingA: number;
  closingB: number;
}

const scratchA: Point[] = [];
const scratchB: Point[] = [];
const scratchPos: Point = { x: 0, z: 0 };
/**
 * Points dropped when an array is cut back to a shorter body (a bus's five
 * circles, then a sedan's three): reused when one grows again, so steady
 * play allocates nothing.
 */
const sparePoints: Point[] = [];

/** A vehicle's collision shape (the standard car's unless it carries its own). */
export function bodyOf(s: VehicleState): CarBody {
  return s.body ?? CAR_BODY;
}

/**
 * The car's collision-circle centres (bodyOf(s).radius each). Pass `out` to
 * reuse storage (it's resized to the body's circle count); without it a
 * fresh array is returned.
 */
export function carCircles(s: VehicleState, out: Point[] = []): Point[] {
  const offsets = bodyOf(s).offsets;
  const n = offsets.length;
  while (out.length > n) sparePoints.push(out.pop()!);
  while (out.length < n) out.push(sparePoints.pop() ?? { x: 0, z: 0 });
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  for (let i = 0; i < n; i++) {
    out[i].x = s.x + fx * offsets[i];
    out[i].z = s.z + fz * offsets[i];
  }
  return out;
}

/** Distance from (x, z) to the surface of the vehicle's body (0 inside), m. */
export function bodyDistance(s: VehicleState, x: number, z: number): number {
  const body = bodyOf(s);
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  let best = Infinity;
  for (const o of body.offsets) {
    const d = Math.hypot(s.x + fx * o - x, s.z + fz * o - z);
    if (d < best) best = d;
  }
  return Math.max(0, best - body.radius);
}

/**
 * Push a car out of walls and bounce it. If `contact` is given and the car
 * hit something, it receives the point of impact (on the wall surface).
 *
 * Only the part of the velocity into the wall is stopped (and bounced); the
 * part along it is scrubbed in proportion to how hard the hit was, and a
 * glancing nose-in swings the car parallel, so a glance slides along the
 * wall instead of sticking.
 */
export function collideVehicleStatic(s: VehicleState, grid: StaticGrid, contact?: Point): number {
  let impact = 0;
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  const pos = scratchPos;
  const { offsets, radius } = bodyOf(s);
  for (const offset of offsets) {
    pos.x = s.x + fx * offset;
    pos.z = s.z + fz * offset;
    const c = grid.resolveCircle(pos, radius);
    if (!c) continue;
    // Shift the whole car by however far this circle was pushed.
    s.x = pos.x - fx * offset;
    s.z = pos.z - fz * offset;
    const vn = s.vx * c.nx + s.vz * c.nz;
    if (vn < 0) {
      const hard = Math.min(1, -vn / WALL_HARD);
      const keep = 1 - WALL_SCRUB * hard * hard;
      const tx = (s.vx - vn * c.nx) * keep;
      const tz = (s.vz - vn * c.nz) * keep;
      s.vx = tx - WALL_RESTITUTION * vn * c.nx;
      s.vz = tz - WALL_RESTITUTION * vn * c.nz;
      // Nose-in at a shallow angle: turn along the wall (toward the side the
      // normal points to; +yaw swings the nose toward the car's left).
      const noseIn = -(fx * c.nx + fz * c.nz);
      if (noseIn > 0 && noseIn < GLANCE_MAX) {
        const left = Math.cos(s.heading) * c.nx - Math.sin(s.heading) * c.nz;
        s.yawRate = s.yawRate * (1 - 0.5 * hard) + Math.sign(left) * Math.asin(noseIn) * GLANCE_ALIGN;
      } else {
        s.yawRate *= 1 - 0.4 * hard;
      }
      if (-vn > impact) {
        impact = -vn;
        if (contact) {
          contact.x = pos.x - c.nx * radius;
          contact.z = pos.z - c.nz * radius;
        }
      }
    }
  }
  return impact;
}

/**
 * Separate two overlapping cars and exchange momentum, the heavier car
 * (`massA`, `massB`: relative masses) moving less. If `contact` is given
 * and they hit, it receives where they touched, the normal and each car's
 * share of the closing speed. Cars more than CLEARANCE apart in height
 * (one flying over the other) don't touch.
 */
export function collideVehicles(a: VehicleState, b: VehicleState, contact?: Point | CarContact, massA = 1, massB = 1): number {
  // Cheap reject: centres further apart than the two bodies reach.
  const bodyA = bodyOf(a);
  const bodyB = bodyOf(b);
  const reach = bodyA.reach + bodyB.reach;
  if (Math.abs(a.x - b.x) > reach || Math.abs(a.z - b.z) > reach) return 0;
  if (Math.abs(a.y - b.y) > CLEARANCE) return 0;

  let impact = 0;
  const touch = bodyA.radius + bodyB.radius;
  const ca = carCircles(a, scratchA);
  const cb = carCircles(b, scratchB);
  const ia = 1 / massA;
  const ib = 1 / massB;
  const shareA = ia / (ia + ib);
  const shareB = 1 - shareA;
  for (const p of ca) {
    for (const q of cb) {
      let dx = p.x - q.x;
      let dz = p.z - q.z;
      const d = Math.hypot(dx, dz);
      const overlap = touch - d;
      if (overlap <= 0) continue;
      if (d > 1e-6) {
        dx /= d;
        dz /= d;
      } else {
        dx = 1;
        dz = 0;
      }
      // Separate (the lighter car gives way more), then exchange momentum along the normal.
      a.x += dx * overlap * shareA;
      a.z += dz * overlap * shareA;
      b.x -= dx * overlap * shareB;
      b.z -= dz * overlap * shareB;
      const closingA = -(a.vx * dx + a.vz * dz);
      const closingB = b.vx * dx + b.vz * dz;
      const vrel = -(closingA + closingB);
      if (contact) {
        contact.x = (p.x + q.x) / 2;
        contact.z = (p.z + q.z) / 2;
        if ('nx' in contact) {
          contact.nx = dx;
          contact.nz = dz;
          contact.closingA = closingA;
          contact.closingB = closingB;
        }
      }
      if (vrel < 0) {
        const j = (-(1 + CAR_RESTITUTION) * vrel) / (ia + ib);
        a.vx += j * ia * dx;
        a.vz += j * ia * dz;
        b.vx -= j * ib * dx;
        b.vz -= j * ib * dz;
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
  const body = bodyOf(v);
  const reach = body.reach + PED_RADIUS;
  if (Math.abs(p.x - v.x) > reach || Math.abs(p.z - v.z) > reach) return 0;
  let impact = 0;
  for (const q of carCircles(v, scratchA)) {
    let dx = p.x - q.x;
    let dz = p.z - q.z;
    const d = Math.hypot(dx, dz);
    const overlap = body.radius + PED_RADIUS - d;
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
