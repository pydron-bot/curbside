/**
 * Twin-stick aiming helpers shared by touch, mouse and gamepad. Aim vectors
 * are screen-relative like movement (x = screen-right, y = screen-up); the
 * camera never rotates, so that maps straight onto the world. Pure.
 */
import { wrapAngle } from '../entities/vehicle';
import { screenHeading } from './steering';

/**
 * A deliberate aim (stick, mouse) snaps onto a target within this half-angle,
 * radians (~15°); firing without aiming keeps the wider assist around the
 * way the player faces.
 */
export const AIM_SNAP = 0.26;
/** Aim-stick deflection past which the aim stick fires (twin-stick). */
export const AIM_FIRE_AT = 0.55;
/** How fast the player turns to face the aim while walking, rad/s. */
export const AIM_TURN_RATE = 18;

/** Merged aim for this frame (Input.readAim). */
export interface AimState {
  /** Unit-ish screen-relative direction; meaningless unless `active`. */
  x: number;
  y: number;
  /** The player is aiming: face this way, shoot this way. */
  active: boolean;
  /** Twin-stick fire: keep shooting (at the weapon's rate) while true. */
  fire: boolean;
  /** The aim stick was just let go with a throwable aimed: throw along this aim, once. */
  release: boolean;
}

/** World heading of a screen-relative aim vector. */
export function aimHeading(x: number, y: number): number {
  return screenHeading(x, y);
}

/** Turn `from` toward `to` by at most `maxStep` radians (shortest way round). */
export function approachAngle(from: number, to: number, maxStep: number): number {
  const diff = wrapAngle(to - from);
  if (Math.abs(diff) <= maxStep) return wrapAngle(to);
  return wrapAngle(from + Math.sign(diff) * maxStep);
}

/**
 * Screen-relative aim vector from the player at (px, pz) to a ground point
 * (wx, wz), normalised; (0, 0) when the point is on top of the player.
 * Writes into `out`.
 */
export function aimToward(px: number, pz: number, wx: number, wz: number, out: { x: number; y: number }): void {
  const dx = wx - px;
  const dy = -(wz - pz); // screen-up is world -Z
  const d = Math.hypot(dx, dy);
  if (d < 0.25) {
    out.x = out.y = 0;
    return;
  }
  out.x = dx / d;
  out.y = dy / d;
}
