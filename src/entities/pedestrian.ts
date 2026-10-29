/**
 * On-foot movement on the XZ plane. Pure, like vehicle.ts.
 *
 * Movement is screen-relative (push the stick up, walk up the screen), which
 * suits a fixed top-down camera far better than tank controls on a phone.
 * Heading uses the same convention as vehicles: nose along (sin h, cos h).
 */
import { wrapAngle } from './vehicle';

export interface PedSpec {
  /** Full-stick walking speed, m/s. */
  walkSpeed: number;
  /** Sprint speed, m/s. */
  runSpeed: number;
  /** How fast velocity reaches the target, m/s². */
  accel: number;
  /** Turn speed toward the movement direction, rad/s. */
  turnRate: number;
}

export interface PedState {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
}

export interface MoveInput {
  /** Screen-right, -1..1 */
  x: number;
  /** Screen-up, -1..1 */
  y: number;
  sprint: boolean;
}

export const PLAYER_ON_FOOT: PedSpec = {
  walkSpeed: 2.4,
  runSpeed: 6,
  accel: 30,
  turnRate: 14,
};

const DEADZONE = 0.05;

export function createPedState(x = 0, z = 0, heading = Math.PI): PedState {
  return { x, z, heading, vx: 0, vz: 0 };
}

export function stepPedestrian(s: PedState, m: MoveInput, spec: PedSpec, dt: number): void {
  let mag = Math.hypot(m.x, m.y);
  let dx = 0;
  let dz = 0;
  if (mag > DEADZONE) {
    dx = m.x / mag;
    dz = -m.y / mag; // screen-up is world -Z
    mag = Math.min(1, mag);
  } else {
    mag = 0;
  }

  const speed = mag * (m.sprint ? spec.runSpeed : spec.walkSpeed);
  const tx = dx * speed;
  const tz = dz * speed;

  // Move velocity toward the target, limited by accel.
  const ex = tx - s.vx;
  const ez = tz - s.vz;
  const err = Math.hypot(ex, ez);
  const maxDelta = spec.accel * dt;
  if (err <= maxDelta) {
    s.vx = tx;
    s.vz = tz;
  } else {
    s.vx += (ex / err) * maxDelta;
    s.vz += (ez / err) * maxDelta;
  }

  if (mag > 0) {
    const target = Math.atan2(dx, dz);
    const diff = wrapAngle(target - s.heading);
    const maxTurn = spec.turnRate * dt;
    s.heading = wrapAngle(s.heading + Math.max(-maxTurn, Math.min(maxTurn, diff)));
  }

  s.x += s.vx * dt;
  s.z += s.vz * dt;
}
