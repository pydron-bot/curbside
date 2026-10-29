/**
 * AI drivers. Each follows lane waypoints from intersection to intersection,
 * steering with pure pursuit and producing the same VehicleControls a player
 * would, so AI cars use the exact same physics.
 */
import { forwardSpeed, wrapAngle, type VehicleControls, type VehicleState } from '../entities/vehicle';
import { BLOCK_SIZE } from '../world/city';
import {
  DIR_VEC,
  canLeave,
  chooseTurn,
  dirHeading,
  entryPoint,
  exitPoint,
  lanePoint,
  type Dir,
} from '../world/roads';

export interface AiDriver {
  /** Intersection being driven toward. */
  ix: number;
  iz: number;
  dir: Dir;
  /** Direction to take at (ix, iz). */
  next: Dir;
  phase: 'approach' | 'turning';
  /** Seconds spent blocked; long waits make the driver push through. */
  waited: number;
  pushThrough: number;
  cruise: number;
}

export interface Obstacle {
  x: number;
  z: number;
  /** Half-width used for the "is it in my lane" test. */
  halfWidth: number;
}

export const CRUISE_SPEED = 12;
const TURN_SPEED = 6;
const WAYPOINT_RADIUS = 4;

/**
 * Place a new AI car on a random lane. Returns null if the pick was off-map.
 * `t` is how far (0..1) along the segment leading to (ix, iz) to start.
 */
export function spawnAi(
  ix: number,
  iz: number,
  dir: Dir,
  t: number,
  rand: () => number,
): { driver: AiDriver; x: number; z: number; heading: number } | null {
  const v = DIR_VEC[dir];
  if (!canLeave(ix - v.x, iz - v.z, dir)) return null; // segment must exist
  const along = -BLOCK_SIZE * (1 - t) - 12 * t; // stay out of both intersections
  const p = lanePoint(ix, iz, dir, Math.min(-12, along));
  return {
    driver: {
      ix,
      iz,
      dir,
      next: chooseTurn(ix, iz, dir, rand),
      phase: 'approach',
      waited: 0,
      pushThrough: 0,
      cruise: CRUISE_SPEED * (0.85 + rand() * 0.3),
    },
    x: p.x,
    z: p.z,
    heading: dirHeading(dir),
  };
}

/** Advance the driver's route and return controls for this step. */
export function driveAi(
  ai: AiDriver,
  car: VehicleState,
  obstacles: Obstacle[],
  rand: () => number,
  dt: number,
): VehicleControls {
  let target = ai.phase === 'approach' ? entryPoint(ai.ix, ai.iz, ai.dir) : exitPoint(ai.ix, ai.iz, ai.next);
  if (Math.hypot(target.x - car.x, target.z - car.z) < WAYPOINT_RADIUS) {
    if (ai.phase === 'approach') {
      ai.phase = 'turning';
    } else {
      // Through the intersection: now heading for the next one.
      ai.dir = ai.next;
      const v = DIR_VEC[ai.dir];
      ai.ix += v.x;
      ai.iz += v.z;
      ai.next = chooseTurn(ai.ix, ai.iz, ai.dir, rand);
      ai.phase = 'approach';
    }
    target = ai.phase === 'approach' ? entryPoint(ai.ix, ai.iz, ai.dir) : exitPoint(ai.ix, ai.iz, ai.next);
  }

  // Pure pursuit toward the waypoint.
  const desired = Math.atan2(target.x - car.x, target.z - car.z);
  const diff = wrapAngle(desired - car.heading);
  const steer = Math.max(-1, Math.min(1, -diff * 2.5));

  // Slow for turns (and while about to make one).
  const turning = ai.next !== ai.dir;
  const distToEntry = Math.hypot(target.x - car.x, target.z - car.z);
  let wantSpeed = ai.cruise;
  if (ai.phase === 'turning' && turning) wantSpeed = TURN_SPEED;
  else if (ai.phase === 'approach' && turning && distToEntry < 22) wantSpeed = TURN_SPEED + distToEntry * 0.3;
  if (Math.abs(diff) > 0.6) wantSpeed = Math.min(wantSpeed, TURN_SPEED);

  // Brake for anything in our path.
  const vF = forwardSpeed(car);
  if (ai.pushThrough > 0) {
    ai.pushThrough -= dt;
  } else {
    const gap = clearDistance(car, obstacles);
    const safe = 3 + Math.max(0, vF) * 0.9;
    if (gap < safe) {
      wantSpeed = 0;
      ai.waited += dt;
      if (ai.waited > 4) {
        // Gridlock breaker: ignore blockers briefly (physics still prevents overlap).
        ai.pushThrough = 1.5;
        ai.waited = 0;
      }
    } else {
      ai.waited = 0;
      wantSpeed = Math.min(wantSpeed, Math.max(0, (gap - safe) * 0.8 + 2));
    }
  }

  let throttle = Math.max(-1, Math.min(1, (wantSpeed - vF) * 0.4));
  // Our physics reverses on brake at a standstill; AI never wants that.
  if (vF < 0.6 && throttle < 0) throttle = 0;
  return { throttle, steer, handbrake: false };
}

/** Distance to the nearest obstacle ahead within our lane width, or Infinity. */
export function clearDistance(car: VehicleState, obstacles: Obstacle[]): number {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  let best = Infinity;
  for (const o of obstacles) {
    const rx = o.x - car.x;
    const rz = o.z - car.z;
    const along = rx * fx + rz * fz;
    if (along <= 0.5 || along > 30) continue;
    const lateral = Math.abs(rx * fz - rz * fx);
    if (lateral < 1.1 + o.halfWidth) best = Math.min(best, along - 2.4);
  }
  return best;
}
