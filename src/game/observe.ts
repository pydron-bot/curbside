/**
 * Observe mode's pure logic (the mode itself is ui/observeMode.ts): the free
 * camera's state and its clamps (inside the city, off the roofs, the
 * zoom-out capped per quality tier), the control strip's idle fade, picking
 * a car or person to follow under a tap, cycling NEXT INCIDENT through the
 * running scenes, and the patch round the camera that Population keeps its
 * spawns out of at a wide zoom. No three.js.
 */
import type { QualityTierName } from '../render/quality';
import { HALF_EXTENT, type Rect } from '../world/city';
import { len2 } from '../core/len';

/** Lowest the camera goes over open street, m (on foot in play it's 20–31). */
export const OBSERVE_MIN_HEIGHT = 12;
/** Where it starts, m: the title's cruise. */
export const OBSERVE_START_HEIGHT = 46;
/**
 * Highest per quality tier, m. Draw calls grow slowly with height (`medium`
 * at 852×393, turned 45°, at night with a fire and a chase on: 84 at 130 m;
 * docs/systems/ui.md *Observe mode* has the table), so what bounds it is the streets
 * (the crowd lives within 60 m of the focus, traffic within 160 m) and the
 * phone's fill: a lower tier sees less.
 */
export const OBSERVE_MAX_HEIGHT: Readonly<Record<QualityTierName, number>> = { high: 150, medium: 130, low: 100 };
/** The camera stays this far over the tallest roof round it (its rooftop kit, the near plane), m. */
export const ROOF_CLEARANCE = 8;
/** Roofs this close to the camera's ground point count, m. */
export const ROOF_REACH = 14;
/** Panning speed per m of height at full push (m/s), and its top speed: the streets fill round the camera at that pace. */
export const PAN_PER_HEIGHT = 0.9;
export const PAN_MAX = 70;
/** How fast a held pan comes up to speed and stops, 1/s. */
export const PAN_SMOOTH = 7;
/** Held zoom: e-folds of height per second; held rotate: rad/s. */
export const ZOOM_RATE = 1.3;
export const TURN_RATE = 1.6;
/** Following: close the gap at this rate (1/s), with the target's velocity fed forward, up to this speed (m/s). */
export const FOLLOW_CHASE = 2.2;
export const FOLLOW_SPEED = 80;
/** The control strip fades after this long without input, s. */
export const IDLE_FADE = 4;
/**
 * Over this height Population keeps its spawns out of a shrunken view (the
 * one this height would see) rather than the whole of it: at a wide zoom the
 * spawn rings sit inside the view and the streets would empty. Someone may
 * appear at the far edge, a few pixels tall.
 */
export const SHIELD_HEIGHT = 64;

export function maxHeight(tier: QualityTierName): number {
  return OBSERVE_MAX_HEIGHT[tier];
}

/** Anything with a footprint and a height (world/city.ts Building). */
export interface Roofed extends Rect {
  height: number;
}

/**
 * The lowest the camera may be at (x, z): ROOF_CLEARANCE over the tallest
 * building within `reach` of it, or 0 with none. A plain scan (1,400
 * buildings, a few µs, no allocation).
 */
export function roofFloor(buildings: readonly Roofed[], x: number, z: number, reach = ROOF_REACH): number {
  let top = 0;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (b.height <= top) continue;
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    if (dx * dx + dz * dz <= reach * reach) top = b.height;
  }
  return top > 0 ? top + ROOF_CLEARANCE : 0;
}

/** The height range: never under OBSERVE_MIN_HEIGHT or `floor` (roofFloor), never over the tier's cap. */
export function clampHeight(h: number, tier: QualityTierName, floor = 0): number {
  const hi = maxHeight(tier);
  return Math.min(hi, Math.max(OBSERVE_MIN_HEIGHT, floor, h));
}

/** A focus coordinate kept over the city (out to the ring road). */
export function clampToCity(v: number): number {
  return Math.max(-HALF_EXTENT, Math.min(HALF_EXTENT, v));
}

/**
 * Screen axes to world for a view turned by `yaw` (CameraRig.yaw): `right`
 * along screen-right, `up` along screen-up (at yaw 0, +X and -Z). Into `out`.
 */
export function screenToWorld(right: number, up: number, yaw: number, out: { x: number; z: number }): { x: number; z: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  out.x = right * c - up * s;
  out.z = -right * s - up * c;
  return out;
}

/**
 * The free camera: where it looks (x, z), how high, which way up the screen
 * points (yaw), and its velocity for the rig's feed-forward and for
 * Population (the streets stream ahead of a pan). Inputs are pans in screen
 * axes, zooms and turns; clamp() keeps it legal after every change.
 */
export class ObserveCamera {
  x = 0;
  z = 0;
  /** Velocity this frame, m/s (what moved it: a held pan, a drag, a follow). */
  vx = 0;
  vz = 0;
  height = OBSERVE_START_HEIGHT;
  yaw = 0;
  /** Held pan's eased velocity, m/s. */
  private panVx = 0;
  private panVz = 0;
  private lastX = 0;
  private lastZ = 0;
  private readonly tmp = { x: 0, z: 0 };

  reset(x: number, z: number, height: number, yaw = 0): void {
    this.x = this.lastX = x;
    this.z = this.lastZ = z;
    this.height = height;
    this.yaw = yaw;
    this.vx = this.vz = this.panVx = this.panVz = 0;
  }

  /** Top pan speed at this height, m/s. */
  get panSpeed(): number {
    return Math.min(PAN_MAX, this.height * PAN_PER_HEIGHT);
  }

  /**
   * Held controls for `dt`: pan (screen axes, -1..1 each), zoom (+1 in, -1
   * out) and turn (+1 clockwise on screen). The pan eases up to speed and to
   * a stop.
   */
  steer(dt: number, right: number, up: number, zoom: number, turn: number): void {
    const want = screenToWorld(right, up, this.yaw, this.tmp);
    const sp = this.panSpeed;
    const k = 1 - Math.exp(-PAN_SMOOTH * dt);
    this.panVx += (want.x * sp - this.panVx) * k;
    this.panVz += (want.z * sp - this.panVz) * k;
    this.x += this.panVx * dt;
    this.z += this.panVz * dt;
    if (zoom !== 0) this.height *= Math.exp(-zoom * ZOOM_RATE * dt);
    if (turn !== 0) this.yaw += turn * TURN_RATE * dt;
  }

  /** A drag of (dx, dy) screen px (down positive) at `metresPerPx`: the ground under the finger stays under it. */
  drag(dx: number, dy: number, metresPerPx: number): void {
    const w = screenToWorld(-dx * metresPerPx, dy * metresPerPx, this.yaw, this.tmp);
    this.x += w.x;
    this.z += w.z;
    this.panVx = this.panVz = 0;
  }

  /** Zoom by a factor of the height (pinch, wheel): over 1 goes higher. */
  zoomBy(factor: number): void {
    if (factor > 0 && Number.isFinite(factor)) this.height *= factor;
  }

  turnBy(radians: number): void {
    this.yaw += radians;
  }

  /** Ride along with something at (tx, tz) moving at (tvx, tvz): its velocity fed forward, the gap closed. */
  follow(dt: number, tx: number, tz: number, tvx: number, tvz: number): void {
    let vx = tvx + (tx - this.x) * FOLLOW_CHASE;
    let vz = tvz + (tz - this.z) * FOLLOW_CHASE;
    const sp = len2(vx, vz);
    if (sp > FOLLOW_SPEED) {
      vx *= FOLLOW_SPEED / sp;
      vz *= FOLLOW_SPEED / sp;
    }
    this.x += vx * dt;
    this.z += vz * dt;
    this.panVx = this.panVz = 0;
  }

  /** Straight to (x, z) (a cut under the fade). */
  jump(x: number, z: number): void {
    this.x = this.lastX = x;
    this.z = this.lastZ = z;
    this.vx = this.vz = this.panVx = this.panVz = 0;
  }

  /** Inside the city, off the roofs (`floor`, roofFloor), under the tier's cap; then this frame's velocity. */
  clamp(dt: number, tier: QualityTierName, floor = 0): void {
    this.x = clampToCity(this.x);
    this.z = clampToCity(this.z);
    this.height = clampHeight(this.height, tier, floor);
    // Wrapped, so a long spin can't lose precision.
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    if (dt > 0) {
      this.vx = (this.x - this.lastX) / dt;
      this.vz = (this.z - this.lastZ) / dt;
    }
    this.lastX = this.x;
    this.lastZ = this.z;
  }
}

/**
 * The control strip's fade: shown on any input, faded after IDLE_FADE s
 * without one (never while `hold`, e.g. the spawn palette is open).
 */
export class IdleFade {
  private idle = 0;
  shown = true;

  constructor(readonly after = IDLE_FADE) {}

  /** Input of any kind: show it again (and restart the wait). */
  poke(): void {
    this.idle = 0;
    this.shown = true;
  }

  /** Per frame; true while the strip should show. */
  step(dt: number, hold = false): boolean {
    this.idle = hold ? 0 : this.idle + dt;
    this.shown = this.idle < this.after;
    return this.shown;
  }
}

/** What a tap may pick to follow (structural: Population's Vehicle and CrowdPed). */
export interface PickCar {
  sim: { x: number; z: number; body?: { reach: number } | null };
  mesh: { root: { visible: boolean } };
}
export interface PickPed {
  agent: { s: { x: number; z: number } };
  model: { root: { visible: boolean } };
}
export type FollowPick<C, P> = { car: C; ped: null } | { car: null; ped: P } | null;

/** A car's reach without a body (CarBody's sedan), and a person's, m. */
const CAR_REACH = 2.4;
const PED_REACH = 0.7;

/**
 * The car or person a tap at ground (x, z) means, or null: the nearest
 * whose footprint plus `slack` (the tap's own slop in metres, which grows
 * with the zoom) covers the point, nearest edge first, so a person beside a
 * car can still be picked. Hidden ones don't count.
 */
export function pickFollow<C extends PickCar, P extends PickPed>(x: number, z: number, cars: readonly C[], crowd: readonly P[], slack: number): FollowPick<C, P> {
  let bestCar: C | null = null;
  let bestPed: P | null = null;
  let best = Infinity;
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    if (!c.mesh.root.visible) continue;
    const reach = c.sim.body?.reach ?? CAR_REACH;
    const edge = len2(c.sim.x - x, c.sim.z - z) - reach;
    if (edge <= slack && edge < best) {
      best = edge;
      bestCar = c;
    }
  }
  for (let i = 0; i < crowd.length; i++) {
    const p = crowd[i];
    if (!p.model.root.visible) continue;
    // People are small: favoured over a car whose edge is about as near.
    const edge = len2(p.agent.s.x - x, p.agent.s.z - z) - PED_REACH - 0.6;
    if (edge <= slack && edge < best) {
      best = edge;
      bestPed = p;
      bestCar = null;
    }
  }
  if (bestPed) return { car: null, ped: bestPed };
  if (bestCar) return { car: bestCar, ped: null };
  return null;
}

/**
 * NEXT INCIDENT's pick: the first of `count` scenes after `from` (wrapping,
 * `from` itself last) for which `live(i)` holds, or -1. Repeated presses
 * visit each running scene in turn.
 */
export function nextLive(count: number, from: number, live: (i: number) => boolean): number {
  for (let k = 1; k <= count; k++) {
    const i = (((from + k) % count) + count) % count;
    if (live(i)) return i;
  }
  return -1;
}

/**
 * The part of `view` Population keeps spawns out of: all of it up to
 * SHIELD_HEIGHT, above that the view shrunk about the focus (x, z) to what
 * SHIELD_HEIGHT would see. Into `out`.
 */
export function spawnShield(view: Rect, x: number, z: number, height: number, out: Rect): Rect {
  const k = height > SHIELD_HEIGHT ? SHIELD_HEIGHT / height : 1;
  out.minX = x + (view.minX - x) * k;
  out.maxX = x + (view.maxX - x) * k;
  out.minZ = z + (view.minZ - z) * k;
  out.maxZ = z + (view.maxZ - z) * k;
  return out;
}

/** The time-of-day nudge's stops, in order through the day (the city's incidents keep hours: kebabs at closing, a conga at night). */
export const OBSERVE_HOURS: ReadonlyArray<readonly [string, number]> = [
  ['DAWN', 6.4],
  ['NOON', 12.5],
  ['GOLDEN HOUR', 18.2],
  ['DUSK', 19.6],
  ['NIGHT', 22.5],
  ['SMALL HOURS', 2],
];

/** The first stop over half an hour after `hour` (wrapping past midnight): each press moves the day on. */
export function nextHour(hour: number): readonly [string, number] {
  let best = OBSERVE_HOURS[0];
  let bestAhead = Infinity;
  for (const stop of OBSERVE_HOURS) {
    const ahead = (((stop[1] - hour - 0.5) % 24) + 24) % 24;
    if (ahead < bestAhead) {
      bestAhead = ahead;
      best = stop;
    }
  }
  return best;
}
