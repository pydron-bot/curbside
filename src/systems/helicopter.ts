/**
 * The police helicopter (5 stars): no model, just a shadow sliding over the
 * streets and a searchlight on the ground. It flies at the player's
 * predicted position, slower than a fast car (so it can be outrun), and
 * while the light is on them they're seen. Pure maths.
 */
export const HELI_FROM = 5;
const HELI_SPEED = 27;
const HELI_ACCEL = 7;
/** The spotlight's radius on the ground: inside it, the player is seen, m. */
export const SPOT_RADIUS = 7.5;
/** The spotlight wanders this far round its aim point, m. */
const SPOT_WANDER = 3.5;
/** Spawned / gone this far out, m. */
export const HELI_SPAWN = 150;
export const HELI_GONE = 260;
/**
 * It stays on station this long, then leaves to refuel for HELI_REFUEL:
 * the window to break away from a 5-star chase, s.
 */
export const HELI_SHIFT = 45;
export const HELI_REFUEL = 20;

export interface Helicopter {
  /** In the air near the player (or leaving). */
  active: boolean;
  leaving: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Nose direction (vehicle convention). */
  heading: number;
  /** Spotlight centre on the ground. */
  spotX: number;
  spotZ: number;
  /** Spotlight wander phase. */
  sweep: number;
  /** The spotlight is on the player. */
  sees: boolean;
  /** Seconds on station this shift (or, while refuelling, seconds until it's back). */
  shift: number;
  refuelling: boolean;
}

/**
 * Move the helicopter toward where the player is heading (accelerating up
 * to HELI_SPEED, so a fast car can outrun it), and swing the spotlight onto
 * the player with a little search wander. `sees` is set when the light is on them.
 */
export function stepHelicopter(h: Helicopter, goalX: number, goalZ: number, goalVx: number, goalVz: number, px: number, pz: number, dt: number): void {
  let tx: number;
  let tz: number;
  if (h.leaving) {
    const dx = h.x - px;
    const dz = h.z - pz;
    const d = Math.hypot(dx, dz) || 1;
    tx = h.x + (dx / d) * 100;
    tz = h.z + (dz / d) * 100;
  } else {
    // Hold just behind and to the side of where they're going.
    tx = goalX + goalVx * 0.8 + 6;
    tz = goalZ + goalVz * 0.8 + 8;
  }
  const dx = tx - h.x;
  const dz = tz - h.z;
  const d = Math.hypot(dx, dz);
  const want = Math.min(HELI_SPEED, d * 0.9);
  const wx = d > 0.01 ? (dx / d) * want : 0;
  const wz = d > 0.01 ? (dz / d) * want : 0;
  const ex = wx - h.vx;
  const ez = wz - h.vz;
  const e = Math.hypot(ex, ez);
  const maxDv = HELI_ACCEL * dt;
  if (e <= maxDv) {
    h.vx = wx;
    h.vz = wz;
  } else {
    h.vx += (ex / e) * maxDv;
    h.vz += (ez / e) * maxDv;
  }
  h.x += h.vx * dt;
  h.z += h.vz * dt;
  if (Math.hypot(h.vx, h.vz) > 1) h.heading = Math.atan2(h.vx, h.vz);

  // The light reaches 30 m from under the helicopter toward the target (led a
  // little, the operator anticipates), wandering a little.
  h.sweep += dt;
  const ax = goalX + goalVx * 0.25 - h.x;
  const az = goalZ + goalVz * 0.25 - h.z;
  const ad = Math.hypot(ax, az) || 1;
  const reach = Math.min(ad, 30);
  const sx = h.x + (ax / ad) * reach + Math.cos(h.sweep * 1.7) * SPOT_WANDER;
  const sz = h.z + (az / ad) * reach + Math.sin(h.sweep * 1.3) * SPOT_WANDER;
  // The operator swings it smoothly.
  const k = Math.min(1, dt * 4);
  h.spotX += (sx - h.spotX) * k;
  h.spotZ += (sz - h.spotZ) * k;
  h.sees = !h.leaving && Math.hypot(h.spotX - px, h.spotZ - pz) < SPOT_RADIUS;
}
