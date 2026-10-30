/**
 * Pursuit driving for police (and road-raging motorists). Like driveAi it
 * returns VehicleControls for stepVehicle, so pursuers obey exactly the same
 * physics as everyone else. Modes:
 *  - route: out of sight or far away, follow the lanes intersection to
 *    intersection toward where the player was last seen (driveAi with the
 *    turn at each junction chosen toward the goal; Manhattan moves are enough
 *    on a grid). Traffic's unstick and re-route logic comes with it.
 *  - chase: in sight, steer straight for an intercept point (the player's
 *    position plus their velocity times a lead that shrinks as we close),
 *    swerving round cars in the way, and settle a few metres behind.
 *  - ram: aggressive units close fast and hit them; after a hit they back
 *    off a moment and line up again.
 *  - pit: alongside a fast player, swerve into their rear quarter.
 *  - box: the player has (nearly) stopped: pull up in front, behind or
 *    beside them and brake, so they're hemmed in for an arrest; on foot,
 *    stop a few metres short so the officers can get out.
 * A pursuer that tries to move but doesn't backs out with opposite lock,
 * like traffic does. Pure logic, no three.js.
 */
import { forwardSpeed, speed, wrapAngle, type VehicleControls, type VehicleState } from '../entities/vehicle';
import { BLOCK_SIZE } from '../world/city';
import { DIR_VEC, canLeave, reverse, turnLeft, turnRight, type Dir } from '../world/roads';
import { driveAi, rerouteAi, type AiDriver, type Obstacle } from './traffic';

export type PursuitMode = 'route' | 'chase' | 'ram' | 'pit' | 'box';

/** What the pursuer knows about its quarry. */
export interface PursuitTarget {
  /** Where they are (or were last seen), and how they were moving. */
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  inCar: boolean;
  /** This pursuer can see them right now (else it's driving on old information). */
  seen: boolean;
}

export interface PursuitDriver {
  mode: PursuitMode;
  /** 0: follow and box in; 0.5 and up: also ram and PIT. */
  aggression: number;
  /** Boxes in a stopped player (police); road ragers just keep ramming. */
  boxes: boolean;
  /** Cruise speed when following the roads, m/s. */
  cruise: number;
  /** Fastest it will chase, m/s (the car's own top speed still applies). */
  topSpeed: number;
  /** Where to pull up when boxing in a car: 0 in front, 1 behind, 2 and 3 the sides. */
  slot: number;
  /** Seconds trying to move without moving. */
  stuck: number;
  /** Seconds left backing out. */
  reversing: number;
  /** Times it has backed out since last moving properly (for recycling hopeless ones). */
  attempts: number;
  /** Seconds before it rams again (after a hit it drops back and lines up). */
  ramCooldown: number;
  /** Lane follower used while routing. */
  road: AiDriver;
}

/** Further than this (or out of sight), follow the roads, m. */
export const ROUTE_DISTANCE = 70;
/** Aggressive pursuers ram from this close, m. */
export const RAM_DISTANCE = 16;
/** A quarry slower than this is boxed in, m/s. */
export const BOX_SPEED = 3;
/** Boxing starts within this distance, m. */
export const BOX_DISTANCE = 32;
/** Longest lead on the intercept point, s. */
export const MAX_LEAD = 1.2;
/** How far behind a chase settles when it isn't ramming, m. */
export const FOLLOW_GAP = 8;
/** How much faster than the quarry a ram comes in, m/s (closing speed sets the damage). */
export const RAM_CLOSING = 7;
/** On foot, cars stop this far short so the officers get out and run, m. */
export const FOOT_STOP = 7;
const STEER_GAIN = 2.3;
const STUCK_SECONDS = 1.2;
const REVERSE_SECONDS = 1;
/** After a ram, hang back this long before the next. */
const RAM_COOLDOWN = 1.4;
/** Swerve this far sideways round a car in the way, m. */
const SWERVE = 3.4;
/** Backed out this often without getting going: hopeless (recycle it when unseen). */
const HOPELESS_ATTEMPTS = 6;

export function createPursuit(road: AiDriver, aggression: number, cruise: number, topSpeed: number, boxes = true): PursuitDriver {
  return {
    mode: 'route',
    aggression,
    boxes,
    cruise,
    topSpeed,
    slot: 0,
    stuck: 0,
    reversing: 0,
    attempts: 0,
    ramCooldown: 0,
    road,
  };
}

export function isPursuitHopeless(d: PursuitDriver): boolean {
  return d.attempts >= HOPELESS_ATTEMPTS || (d.mode === 'route' && d.road.attempts >= HOPELESS_ATTEMPTS);
}

/**
 * Seconds to lead the quarry by: the time to cover the gap at the closing
 * speed, clamped to MAX_LEAD (far away it would aim miles ahead; close in it
 * aims at the car itself).
 */
export function leadTime(distance: number, closing: number): number {
  if (closing <= 1) return MAX_LEAD;
  return Math.max(0, Math.min(MAX_LEAD, distance / closing));
}

type Point = { x: number; z: number };

/** Where to steer to meet the quarry: its position plus velocity × lead. */
export function interceptPoint(car: VehicleState, t: PursuitTarget, out: Point): Point {
  const dx = t.x - car.x;
  const dz = t.z - car.z;
  const d = Math.hypot(dx, dz) || 1;
  // How fast the gap shrinks driving straight at it: our speed (or what we'll
  // soon be doing) minus the quarry's speed away from us.
  const away = (t.vx * dx + t.vz * dz) / d;
  const lead = leadTime(d, Math.max(speed(car), 10) - away);
  out.x = t.x + t.vx * lead;
  out.z = t.z + t.vz * lead;
  return out;
}

/**
 * At intersection (ix, iz), arriving heading `dir`: which way to go toward
 * (tx, tz). Straight, left or right, whichever leaves the fewest blocks to
 * go, nudged toward the direction the goal actually lies (so a goal behind
 * us turns us off rather than carrying on away). U-turns only at a dead end.
 */
export function routeToward(ix: number, iz: number, dir: Dir, tx: number, tz: number): Dir {
  const gx = tx / BLOCK_SIZE;
  const gz = tz / BLOCK_SIZE;
  const ux = gx - ix;
  const uz = gz - iz;
  const len = Math.hypot(ux, uz) || 1;
  let best: Dir = reverse(dir);
  let bestScore = Infinity;
  for (let k = 0; k < 3; k++) {
    const d = k === 0 ? dir : k === 1 ? turnLeft(dir) : turnRight(dir);
    if (!canLeave(ix, iz, d)) continue;
    const v = DIR_VEC[d];
    const score = Math.abs(gx - (ix + v.x)) + Math.abs(gz - (iz + v.z)) - 0.6 * ((v.x * ux + v.z * uz) / len) - (d === dir ? 0.01 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * Is the pursuer alongside the quarry (slightly behind its nose, a car's
 * width or two to one side, going the same way)? Then a PIT is on.
 */
export function alongside(car: VehicleState, t: PursuitTarget): boolean {
  const fx = Math.sin(t.heading);
  const fz = Math.cos(t.heading);
  const rx = car.x - t.x;
  const rz = car.z - t.z;
  const along = rx * fx + rz * fz;
  const lateral = Math.abs(rx * fz - rz * fx);
  const sameWay = Math.abs(wrapAngle(car.heading - t.heading)) < 0.6;
  return sameWay && along > -5.5 && along < 1.5 && lateral > 1.4 && lateral < 5;
}

/** Pick this step's mode. */
export function choosePursuitMode(d: PursuitDriver, car: VehicleState, t: PursuitTarget, distance: number): PursuitMode {
  if (!t.seen || distance > ROUTE_DISTANCE) return 'route';
  const quarrySpeed = Math.hypot(t.vx, t.vz);
  if (d.boxes && distance < BOX_DISTANCE && (!t.inCar || quarrySpeed < BOX_SPEED)) return 'box';
  if (d.aggression >= 0.5 && d.ramCooldown <= 0 && distance < RAM_DISTANCE) {
    return t.inCar && quarrySpeed > 8 && alongside(car, t) ? 'pit' : 'ram';
  }
  return 'chase';
}

/** Reused output (consume it before the next call), as in traffic.ts. */
const controls: VehicleControls = { throttle: 0, steer: 0, handbrake: false };
const aim: Point = { x: 0, z: 0 };

/**
 * One step of pursuit: pick a mode, then return controls. The returned
 * object is reused: pass it to stepVehicle before calling again.
 */
export function drivePursuit(
  d: PursuitDriver,
  car: VehicleState,
  t: PursuitTarget,
  obstacles: Obstacle[],
  rand: () => number,
  dt: number,
): VehicleControls {
  d.ramCooldown = Math.max(0, d.ramCooldown - dt);
  const dx = t.x - car.x;
  const dz = t.z - car.z;
  const distance = Math.hypot(dx, dz);
  const mode = choosePursuitMode(d, car, t, distance);
  if (mode === 'route' && d.mode !== 'route') rerouteAi(d.road, car, rand);
  d.mode = mode;

  if (mode === 'route') {
    d.stuck = 0;
    d.road.cruise = d.cruise;
    const c = driveAi(d.road, car, obstacles, rand, dt);
    // driveAi picks turns at random as it passes a junction: steer it toward the goal instead.
    if (d.road.phase === 'approach') d.road.next = routeToward(d.road.ix, d.road.iz, d.road.dir, t.x, t.z);
    return c;
  }

  if (d.reversing > 0) {
    d.reversing -= dt;
    const diff = headingError(car, t.x, t.z);
    // Opposite lock swings the nose round toward the quarry (steering flips in reverse).
    controls.throttle = -0.8;
    controls.steer = Math.abs(diff) > 0.3 ? Math.max(-1, Math.min(1, diff * STEER_GAIN)) : d.attempts % 2 ? 0.8 : -0.8;
    controls.handbrake = false;
    return controls;
  }

  const quarrySpeed = Math.hypot(t.vx, t.vz);
  let want: number;
  if (mode === 'box') {
    const slot = boxSlot(d, car, t, aim);
    const gap = Math.hypot(slot.x - car.x, slot.z - car.z);
    // Slot behind us (we overshot) or reached: just stop where we are.
    const behind = Math.abs(headingError(car, slot.x, slot.z)) > 2 && gap < 12;
    want = gap < 2 || behind ? 0 : Math.min(14, gap * 0.9);
  } else if (mode === 'ram') {
    aim.x = t.x + t.vx * 0.25;
    aim.z = t.z + t.vz * 0.25;
    want = t.inCar ? quarrySpeed + RAM_CLOSING : 10;
    // Contact (or as good as): back off and line up the next one.
    if (distance < 5) d.ramCooldown = RAM_COOLDOWN;
  } else if (mode === 'pit') {
    // The rear quarter: just behind their back axle.
    const fx = Math.sin(t.heading);
    const fz = Math.cos(t.heading);
    aim.x = t.x - fx * 1.4 + t.vx * 0.15;
    aim.z = t.z - fz * 1.4 + t.vz * 0.15;
    want = quarrySpeed + 4;
    if (distance < 3.6) d.ramCooldown = RAM_COOLDOWN;
  } else {
    interceptPoint(car, t, aim);
    // Close the gap fast, then sit FOLLOW_GAP behind at the quarry's pace.
    want = quarrySpeed + Math.max(-6, Math.min(16, (distance - FOLLOW_GAP) * 0.7));
  }
  want = Math.max(0, Math.min(d.topSpeed, want));
  if (mode !== 'box') swerve(car, obstacles, t, aim);

  const diff = headingError(car, aim.x, aim.z);
  const vF = forwardSpeed(car);
  // Sharp corner at speed: brake into it, and throw it sideways if it's very sharp.
  if (Math.abs(diff) > 1 && vF > 14) want = Math.min(want, 8);
  let throttle = Math.max(-1, Math.min(1, (want - vF) * 0.45));
  if (vF < 0.6 && throttle < 0) throttle = 0; // never reverse by accident
  controls.throttle = throttle;
  controls.steer = Math.max(-1, Math.min(1, -diff * STEER_GAIN));
  controls.handbrake = Math.abs(diff) > 1.4 && vF > 9;
  trackStuck(d, want, car, dt);
  return controls;
}

/** Signed angle from the car's nose to (x, z). */
function headingError(car: VehicleState, x: number, z: number): number {
  return wrapAngle(Math.atan2(x - car.x, z - car.z) - car.heading);
}

/** Where to pull up to hem the quarry in (writes `out`). */
function boxSlot(d: PursuitDriver, car: VehicleState, t: PursuitTarget, out: Point): Point {
  if (!t.inCar) {
    // On foot: stop short, on our side of them.
    const dx = car.x - t.x;
    const dz = car.z - t.z;
    const dist = Math.hypot(dx, dz) || 1;
    out.x = t.x + (dx / dist) * FOOT_STOP;
    out.z = t.z + (dz / dist) * FOOT_STOP;
    return out;
  }
  const fx = Math.sin(t.heading);
  const fz = Math.cos(t.heading);
  switch (d.slot & 3) {
    case 0:
      out.x = t.x + fx * 5.6;
      out.z = t.z + fz * 5.6;
      break;
    case 1:
      out.x = t.x - fx * 5.6;
      out.z = t.z - fz * 5.6;
      break;
    case 2:
      out.x = t.x + fz * 2.6;
      out.z = t.z - fx * 2.6;
      break;
    default:
      out.x = t.x - fz * 2.6;
      out.z = t.z + fx * 2.6;
  }
  return out;
}

/**
 * A car (or person) dead ahead and not the quarry: aim a lane's width to the
 * side with more room instead of ploughing into it.
 */
function swerve(car: VehicleState, obstacles: Obstacle[], t: PursuitTarget, out: Point): void {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const reach = Math.min(16, Math.max(6, speed(car) * 0.9));
  let bestAlong = reach;
  let side = 0;
  for (const o of obstacles) {
    const rx = o.x - car.x;
    const rz = o.z - car.z;
    const along = rx * fx + rz * fz;
    if (along <= 1 || along >= bestAlong) continue;
    // The quarry (and anything right on top of it) is what we're after.
    if (Math.abs(o.x - t.x) < 2.5 && Math.abs(o.z - t.z) < 2.5) continue;
    const lateral = rx * fz - rz * fx;
    if (Math.abs(lateral) > 1.2 + o.halfWidth) continue;
    bestAlong = along;
    side = lateral >= 0 ? -1 : 1;
  }
  if (side === 0) return;
  // Perpendicular to our heading, away from the blocker.
  out.x += fz * side * SWERVE;
  out.z -= fx * side * SWERVE;
}

/** Trying to move but not moving (nose in a wall, wedged on a wreck): back out. */
function trackStuck(d: PursuitDriver, want: number, car: VehicleState, dt: number): void {
  const moving = speed(car);
  if (moving > 6) d.attempts = 0;
  if (want < 2 || moving > 1) {
    d.stuck = Math.max(0, d.stuck - dt * 2);
    return;
  }
  d.stuck += dt;
  if (d.stuck > STUCK_SECONDS) {
    d.stuck = 0;
    d.reversing = REVERSE_SECONDS;
    d.attempts++;
  }
}
