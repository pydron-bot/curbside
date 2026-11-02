/**
 * Borrowed Blues: the tools on the service vehicles the player steals, one
 * action slot per vehicle type (the fire button's place): the fire truck's
 * hose, the ice cream van's chime and the tow truck's winch. The rules,
 * pure and tested (tests/serviceTools.test.ts): which vehicle has which
 * tool, the hose's knockback cone and where its jet stops, the chime's
 * ring-park-release cycle, which car the winch hooks and how the hooked
 * car follows, the tow speed cap, the pay tables and streaks, and the
 * guard that keeps the city's own service runs off the player's vehicle.
 * game/scenes/serviceTools.ts drives them; game/modes/serviceMode.ts pays.
 * No allocation per step.
 */
import type { VehicleArchetype } from '../entities/vehicle';
import { len2 } from '../core/len';
import { FIRE_AT, type DamageState } from './damage';
import { towPose, type Pose } from './emergency';

export type ToolKind = 'hose' | 'chime' | 'winch';

/** The tool a vehicle carries, or null (ambulance, bus and police duty wait for a later version). */
export function toolFor(archetype: VehicleArchetype): ToolKind | null {
  return archetype === 'firetruck' ? 'hose' : archetype === 'ice_cream_van' ? 'chime' : archetype === 'tow_truck' ? 'winch' : null;
}

// --- Hose -------------------------------------------------------------------

/** The roof monitor's reach, m. */
export const HOSE_RANGE = 16;
/** Half the cone's angle, rad (~13°): a jet, widening a little with distance. */
export const HOSE_HALF_ANGLE = 0.23;
/** The monitor sits this share of the body's reach ahead of the middle, this high, m. */
export const HOSE_NOZZLE_AHEAD = 0.45;
export const HOSE_NOZZLE_Y = 2.7;
/** The monitor is worth this many firefighters' hoses (HOSE_SECONDS each): a full fire out in ~2.3 s. */
export const HOSE_POWER = 3;
/** Each person in the jet is knocked flat at most once in this long, s. */
export const HOSE_KNOCK_EVERY = 1.4;
/** Knocked back this fast, m/s (at the nozzle; less at the far end), and down this long, s. */
export const HOSE_PUSH = 6;
export const HOSE_DOWN = 2.2;
/** Cars in the jet are shoved this hard, m/s². */
export const HOSE_CAR_SHOVE = 9;
/** Without an aim, the hose swings to a fire within this of the nose, rad (~60°). */
export const HOSE_AUTO_AIM = 1.05;

/**
 * How far along a cone from (ox, oz) going (dx, dz) (a unit vector),
 * `halfAngle` rad either side, a thing at (px, pz) of radius `r` is hit:
 * its distance along the cone, or -1 when it's outside (behind, past
 * `range`, or wide of it). The hose's jet and the air horn's blast.
 */
export function coneHit(ox: number, oz: number, dx: number, dz: number, px: number, pz: number, r: number, range: number, halfAngle: number): number {
  const rx = px - ox;
  const rz = pz - oz;
  const along = rx * dx + rz * dz;
  if (along < -r || along > range + r) return -1;
  const across = Math.abs(rx * dz - rz * dx);
  // The cone's half-width where it is, plus the thing's own size.
  if (across > Math.max(0, along) * Math.tan(halfAngle) + 0.35 + r) return -1;
  return Math.max(0, along);
}

/** coneHit for the hose's jet (HOSE_HALF_ANGLE). */
export function hoseHit(ox: number, oz: number, dx: number, dz: number, px: number, pz: number, r: number, range: number): number {
  return coneHit(ox, oz, dx, dz, px, pz, r, range, HOSE_HALF_ANGLE);
}

/** Knock-back at `along` m down the jet: full at the nozzle, half at the far end. */
export function hosePush(along: number, range = HOSE_RANGE): number {
  return HOSE_PUSH * (1 - 0.5 * Math.min(1, Math.max(0, along / range)));
}

/** The roof monitor of a truck at `pose` (body `reach` m), into `out`. */
export function nozzleOf(pose: Pose, reach: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = pose.x + Math.sin(pose.heading) * reach * HOSE_NOZZLE_AHEAD;
  out.z = pose.z + Math.cos(pose.heading) * reach * HOSE_NOZZLE_AHEAD;
  return out;
}

/**
 * How far a jet from (ox, oz) along unit (dx, dz) gets before a building
 * (axis-aligned `rects`) stops it: `range` if nothing's in the way. The
 * slab test; the nozzle inside a rect (it can't be) counts as clear.
 */
export function clipJet(
  rects: readonly { minX: number; minZ: number; maxX: number; maxZ: number }[],
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  range: number,
): number {
  let best = range;
  const ex = ox + dx * range;
  const ez = oz + dz * range;
  const loX = Math.min(ox, ex);
  const hiX = Math.max(ox, ex);
  const loZ = Math.min(oz, ez);
  const hiZ = Math.max(oz, ez);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.maxX < loX || r.minX > hiX || r.maxZ < loZ || r.minZ > hiZ) continue;
    let t0 = 0;
    let t1 = best;
    if (Math.abs(dx) < 1e-9) {
      if (ox < r.minX || ox > r.maxX) continue;
    } else {
      let a = (r.minX - ox) / dx;
      let b = (r.maxX - ox) / dx;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < r.minZ || oz > r.maxZ) continue;
    } else {
      let a = (r.minZ - oz) / dz;
      let b = (r.maxZ - oz) / dz;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
    }
    if (t0 <= t1 && t0 > 0) best = t0;
  }
  return best;
}

/**
 * Which way the hose points: the player's aim if they're aiming (mouse,
 * right stick, a drag on the touch button), else the nearest burning fire
 * within reach and HOSE_AUTO_AIM of the nose, else straight ahead.
 */
export function hoseHeading(
  heading: number,
  aim: number | null,
  ox: number,
  oz: number,
  fires: readonly { x: number; z: number; alive: boolean }[],
  range = HOSE_RANGE,
): number {
  if (aim !== null) return aim;
  let best = heading;
  let bestD = range + 2;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  for (let i = 0; i < fires.length; i++) {
    const f = fires[i];
    if (!f.alive) continue;
    const dx = f.x - ox;
    const dz = f.z - oz;
    const d = len2(dx, dz);
    if (d > bestD || d < 0.5 || (dx * fx + dz * fz) / d < Math.cos(HOSE_AUTO_AIM)) continue;
    bestD = d;
    best = Math.atan2(dx, dz);
  }
  return best;
}

/**
 * The jet on a car that's caught (burning down to its blast): the fire's
 * out, its health lifted just clear of FIRE_AT. True if it was burning.
 * A burnt-out wreck's fire is FireBoard's.
 */
export function douse(d: DamageState): boolean {
  if (!d.burning || d.wrecked) return false;
  d.burning = false;
  d.health = Math.max(d.health, d.maxHealth * (FIRE_AT + 0.04));
  return true;
}

/** Duty pay: a fire the player's hose puts out, and every DUTY_STREAK_EVERY-th in a row on top. */
export const FIRE_OUT_PAY = 40;
export const DUTY_STREAK_EVERY = 3;
export const DUTY_STREAK_BONUS = 120;

// --- Chime ------------------------------------------------------------------

/** A press plays the chime for this long, s, the jingle again every CHIME_EVERY s. */
export const CHIME_FOR = 30;
export const CHIME_EVERY = 6;
/** The van counts as parked below this speed, m/s, and has left once this far from where it parked, m. */
export const CHIME_PARK_SPEED = 0.8;
export const CHIME_LEAVE = 6;
/** The queue waits this long after the chime stops before it gives up, s. */
export const CHIME_LINGER = 15;
/** Most in the queue, and how far the chime carries to draw them, m. */
export const CHIME_QUEUE = 9;
export const CHIME_DRAW = 45;

export type ChimeEvent = 'ring' | 'park' | 'release' | null;

/**
 * The chime's cycle: press to play (the jingle now and every CHIME_EVERY s
 * for CHIME_FOR s; press again to stop); while it plays, the van parked
 * (stopped) anchors a queue there ('park'); driving off past CHIME_LEAVE,
 * or CHIME_LINGER s after it stops, the queue is let go ('release'). The
 * van needn't have the player in it: park, get out, wait for the queue.
 */
export class Chime {
  /** Seconds left playing (0: off). */
  left = 0;
  /** Until the next jingle, s. */
  next = 0;
  /** The queue's anchor: set while one is held. */
  anchored = false;
  x = 0;
  z = 0;
  /** Seconds since the chime stopped (the queue lingers). */
  quiet = 0;

  get on(): boolean {
    return this.left > 0;
  }

  /** The button: start the chime (or stop it if it's playing). */
  press(): void {
    if (this.left > 0) {
      this.left = 0;
      this.quiet = 0;
      return;
    }
    this.left = CHIME_FOR;
    this.next = 0;
  }

  /** Time passes for the van at (x, z) going `speed` m/s; what to act on this step (one thing a step at most). */
  step(dt: number, x: number, z: number, speed: number): ChimeEvent {
    if (this.anchored && len2(x - this.x, z - this.z) > CHIME_LEAVE) return this.release();
    if (this.left > 0) {
      this.left = Math.max(0, this.left - dt);
      this.quiet = 0;
      if ((this.next -= dt) <= 0) {
        this.next = CHIME_EVERY;
        return 'ring';
      }
      if (!this.anchored && speed < CHIME_PARK_SPEED) {
        this.anchored = true;
        this.x = x;
        this.z = z;
        return 'park';
      }
      return null;
    }
    if (this.anchored && (this.quiet += dt) > CHIME_LINGER) return this.release();
    return null;
  }

  reset(): void {
    this.left = this.next = this.quiet = 0;
    this.anchored = false;
  }

  private release(): ChimeEvent {
    this.anchored = false;
    this.quiet = 0;
    return 'release';
  }
}

// --- Winch ------------------------------------------------------------------

/** The winch reaches a car's nearer end within this of the hook, m. */
export const HOOK_RANGE = 4.5;
/** Hooking only with the truck all but stopped, m/s. */
export const HOOK_SPEED = 3;
/** Cars longer than this (half-length, m) are too big for the hook (as the city's tows). */
export const HOOK_MAX_REACH = 3.3;
/** Winching up takes this long, s (the truck held still). */
export const HOOK_SECONDS = 1.6;
/** Towing, the truck is held to this, m/s (~54 km/h); winching, to a crawl. */
export const TOW_TOP_SPEED = 15;
export const WINCH_CRAWL = 1;
/** The docks yard: the car within this of its middle, the truck stopped this long, delivers it, m / s. */
export const YARD_RADIUS = 16;
export const YARD_HOLD = 1;

/** What the winch sees of a car it might hook. */
export interface HookLook {
  /** Left in the road by a scene (a crash, a dumped getaway, the cash van): Vehicle.towable. */
  towable: boolean;
  wrecked: boolean;
  /** On fire, or a fire burning on it: the fire truck first. */
  burning: boolean;
  /** Parked at the kerb by upkeep (someone's car: not the side job's). */
  parked: boolean;
  /** Someone's driving it, a scene's using it, or it's a police car or a bike. */
  busy: boolean;
  /** Half-length, m. */
  reach: number;
  /** Already delivered to the yard once. */
  delivered: boolean;
}

/** May the winch take it? Wrecks (fire out), crashes and getaways left in the road, and abandoned cars; never a parked one. */
export function hookable(c: HookLook): boolean {
  return !c.busy && !c.burning && !c.parked && !c.delivered && c.reach <= HOOK_MAX_REACH;
}

/** The hook at the back of a truck at `pose` (its rear `reach` m behind the middle), into `out`. */
export function hookPoint(pose: Pose, reach: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = pose.x - Math.sin(pose.heading) * (reach + 0.6);
  out.z = pose.z - Math.cos(pose.heading) * (reach + 0.6);
  return out;
}

/**
 * How far the nearer end of a car (`pose`, half-length `reach`) is from the
 * hook at (hx, hz); `rear` (out) says it's the car's back end (it'll trail
 * facing away from the truck).
 */
export function hookDistance(hx: number, hz: number, pose: Pose, reach: number, end: { rear: boolean }): number {
  const fx = Math.sin(pose.heading) * reach;
  const fz = Math.cos(pose.heading) * reach;
  const nose = len2(pose.x + fx - hx, pose.z + fz - hz);
  const tail = len2(pose.x - fx - hx, pose.z - fz - hz);
  end.rear = tail < nose;
  return Math.min(nose, tail);
}

/**
 * The throttle that holds a truck under `cap` m/s either way: no more gas
 * at the cap, a touch of brake over it. The player's own braking stands.
 */
export function capThrottle(throttle: number, forwardSpeed: number, cap: number): number {
  if (forwardSpeed > cap) return Math.min(throttle, -Math.min(1, (forwardSpeed - cap) * 0.5));
  if (forwardSpeed < -cap) return Math.max(throttle, Math.min(1, (-cap - forwardSpeed) * 0.5));
  if (forwardSpeed > cap - 1 && throttle > 0) return throttle * Math.max(0, cap - forwardSpeed);
  if (forwardSpeed < 1 - cap && throttle < 0) return throttle * Math.max(0, cap + forwardSpeed);
  return throttle;
}

/**
 * Where the hooked car rides: towPose (a trailer on the hook, following the
 * truck's path through a turn rather than swinging wide over the kerb),
 * eased in by `k` (0..1) from the pose it was winched from. Into `out`.
 */
export function towedPose(truck: Pose, truckReach: number, carReach: number, car: Pose, rear: boolean, from: Pose, k: number, out: Pose): Pose {
  towPose(truck, truckReach, carReach, car, out, rear);
  if (k >= 1) return out;
  out.x = from.x + (out.x - from.x) * k;
  out.z = from.z + (out.z - from.z) * k;
  out.heading = from.heading + Math.atan2(Math.sin(out.heading - from.heading), Math.cos(out.heading - from.heading)) * k;
  return out;
}

/** The yard's pay by what's left of the car (health share 0..1; a burnt-out shell is scrap). */
export const TOW_PAY = [
  { min: 0.7, pay: 150, label: 'CLEAN' },
  { min: 0.4, pay: 120, label: 'DENTED' },
  { min: 0, pay: 90, label: 'BATTERED' },
] as const;
export const SCRAP_PAY = 60;
/** Every TOW_STREAK_EVERY-th delivery in a row adds TOW_STREAK_BONUS. */
export const TOW_STREAK_EVERY = 3;
export const TOW_STREAK_BONUS = 150;
/** Vex's contract car pays this on top. */
export const CONTRACT_PAY = 250;

/** What the yard pays for a car in `condition` (0..1), `wrecked` or not, and why. */
export function towPay(condition: number, wrecked: boolean): { pay: number; label: string } {
  if (wrecked) return { pay: SCRAP_PAY, label: 'SCRAP' };
  for (const t of TOW_PAY) if (condition >= t.min) return t;
  return TOW_PAY[TOW_PAY.length - 1];
}

/** The bonus for the `streak`-th job in a row (every `every`-th pays `bonus`). */
export function streakPay(streak: number, every: number, bonus: number): number {
  return streak > 0 && streak % every === 0 ? bonus : 0;
}

// --- Vex's tow contract -------------------------------------------------------

/** Vex rings at most once in this long, s of play, and only after dark, in a tow truck with nothing on the hook. */
export const CONTRACT_EVERY = 150;
/** The first call of a session comes this soon after getting in, s. */
export const CONTRACT_FIRST = 8;
/** Her wreck is left this far from the player, m, and must reach the yard in this long, s. */
export const CONTRACT_RANGE = [110, 260] as const;
export const CONTRACT_TIME = 240;

/** Does Vex ring now? After dark, on duty in a tow truck, nothing hooked, nothing else on, the line quiet long enough. */
export function vexRings(dark: boolean, onDuty: boolean, hooked: boolean, busy: boolean, sinceCall: number, onDutyFor: number): boolean {
  return dark && onDuty && !hooked && !busy && onDutyFor >= CONTRACT_FIRST && sinceCall >= CONTRACT_EVERY;
}

// --- The guard ------------------------------------------------------------------

/**
 * May the city's own service runs (a fire truck or tow truck claimed from
 * traffic, an ice cream van adopted, a tow truck picking a car) take `v`?
 * Not the player's borrowed service vehicle (the one they're in, or left
 * standing with its tool going), nor the car on its hook.
 */
export function guarded<T>(v: T, tool: T | null, hooked: T | null): boolean {
  return v !== null && (v === tool || v === hooked);
}
