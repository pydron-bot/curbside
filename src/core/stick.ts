/**
 * Virtual-stick shaping for the touch joysticks: a rescaled radial deadzone
 * with an expo curve (fine control near the centre, full lock at the rim), an
 * origin that follows a thumb dragged past the rim, and continuous walk → run.
 * Pure: no DOM, so the feel can be unit-tested and tuned.
 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Shape a raw stick offset (px from the origin) into a vector of length 0..1:
 * nothing inside `deadzone` (a fraction of `radius`), then a ramp that starts
 * at 0 on the deadzone's edge (no jump) and bends by `expo` (1 = linear).
 * Writes the vector into `out` and returns its length.
 */
export function shapeStick(dx: number, dy: number, radius: number, deadzone: number, expo: number, out: Vec2): number {
  const len = Math.hypot(dx, dy);
  const raw = Math.min(1, len / radius);
  if (raw <= deadzone || len === 0) {
    out.x = out.y = 0;
    return 0;
  }
  const m = ((raw - deadzone) / (1 - deadzone)) ** expo;
  out.x = (dx / len) * m;
  out.y = (dy / len) * m;
  return m;
}

/** One axis (-1..1) with the same deadzone and expo, e.g. classic left/right steering. */
export function shapeAxis(v: number, deadzone: number, expo: number): number {
  const a = Math.min(1, Math.abs(v));
  if (a <= deadzone) return 0;
  return Math.sign(v) * ((a - deadzone) / (1 - deadzone)) ** expo;
}

/**
 * Drag the stick's origin along behind a thumb that has gone past the rim,
 * so it always sits exactly `radius` away: thumbs creep, and flicking from
 * full left to full right shouldn't need the whole stick crossed again.
 */
export function followThumb(origin: Vec2, x: number, y: number, radius: number): void {
  const dx = x - origin.x;
  const dy = y - origin.y;
  const d = Math.hypot(dx, dy);
  if (d <= radius) return;
  const k = (d - radius) / d;
  origin.x += dx * k;
  origin.y += dy * k;
}

/** Keep a point inside a rectangle (e.g. the stick base inside the safe area). */
export function clampToRect(p: Vec2, minX: number, maxX: number, minY: number, maxY: number): void {
  p.x = maxX < minX ? (minX + maxX) / 2 : Math.min(maxX, Math.max(minX, p.x));
  p.y = maxY < minY ? (minY + maxY) / 2 : Math.min(maxY, Math.max(minY, p.y));
}

/** Stick deflection up to which the player walks; beyond it the pace ramps up to a full run. */
export const WALK_UNTIL = 0.6;

/**
 * Continuous walk → run by stick deflection. The pedestrian model moves at
 * |vector| × (sprint ? runSpeed : walkSpeed), so this returns the factor to
 * scale a unit direction by, with sprint on: walking speed is reached at
 * WALK_UNTIL deflection and a full run at the rim.
 */
export function footScale(mag: number, walkSpeed: number, runSpeed: number, walkUntil = WALK_UNTIL): number {
  const m = Math.min(1, Math.max(0, mag));
  const speed = m < walkUntil ? (m / walkUntil) * walkSpeed : walkSpeed + ((m - walkUntil) / (1 - walkUntil)) * (runSpeed - walkSpeed);
  return speed / runSpeed;
}
