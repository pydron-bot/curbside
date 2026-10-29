/**
 * Arcade vehicle physics on the XZ ground plane. Pure functions, no three.js,
 * so it can be unit-tested and tuned in isolation.
 *
 * Conventions: 1 unit = 1 m. `heading` is the rotation about +Y in radians;
 * a heading of h points the car's nose along (sin h, cos h) in (x, z), which
 * matches three.js `rotation.y = h` for a mesh whose front faces local +Z.
 * With the top-down camera, screen-up is -Z (heading PI) and screen-right is +X.
 */

export interface VehicleSpec {
  /** Top forward speed, m/s. */
  maxSpeed: number;
  /** Top reverse speed, m/s. */
  maxReverseSpeed: number;
  /** Engine acceleration at standstill, m/s². Tapers to 0 at maxSpeed. */
  accel: number;
  reverseAccel: number;
  /** Deceleration when braking against the direction of travel, m/s². */
  brakeDecel: number;
  /** Extra longitudinal deceleration while the handbrake is on, m/s². */
  handbrakeDecel: number;
  /** Aerodynamic-ish drag, fraction of speed lost per second. */
  drag: number;
  /** Constant coast-down deceleration, m/s². */
  rollingResistance: number;
  /** Peak yaw rate at full lock, rad/s. */
  steerRate: number;
  /** Speed at which steering reaches full authority, m/s. */
  steerFullSpeed: number;
  /** Steering authority halves by this speed above steerFullSpeed, m/s. */
  steerFalloffSpeed: number;
  /** How quickly yaw rate follows input, 1/s. */
  steerResponse: number;
  /** Lateral grip: fraction of sideways slip removed per second (as exp rate). */
  grip: number;
  /** Lateral grip with the handbrake on (lower = more drift). */
  handbrakeGrip: number;
  /** Yaw-rate multiplier while handbraking (rear steps out). */
  handbrakeYawBoost: number;
}

export interface VehicleState {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  yawRate: number;
}

export interface VehicleControls {
  /** -1 (brake/reverse) .. 1 (full throttle) */
  throttle: number;
  /** -1 (left) .. 1 (right), screen-relative when driving up the screen */
  steer: number;
  handbrake: boolean;
}

export const SEDAN: VehicleSpec = {
  maxSpeed: 38,
  maxReverseSpeed: 9,
  accel: 14,
  reverseAccel: 7,
  brakeDecel: 26,
  handbrakeDecel: 6,
  drag: 0.12,
  rollingResistance: 1.2,
  steerRate: 2.6,
  steerFullSpeed: 6,
  steerFalloffSpeed: 30,
  steerResponse: 10,
  grip: 9,
  handbrakeGrip: 1.4,
  handbrakeYawBoost: 1.5,
};

export function createVehicleState(x = 0, z = 0, heading = Math.PI): VehicleState {
  return { x, z, heading, vx: 0, vz: 0, yawRate: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Move `v` toward 0 by `amount` without overshooting. */
function decay(v: number, amount: number): number {
  return Math.abs(v) <= amount ? 0 : v - Math.sign(v) * amount;
}

export function forwardSpeed(s: VehicleState): number {
  return s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading);
}

export function lateralSpeed(s: VehicleState): number {
  return s.vx * Math.cos(s.heading) - s.vz * Math.sin(s.heading);
}

export function speed(s: VehicleState): number {
  return Math.hypot(s.vx, s.vz);
}

/** Advance the vehicle by `dt` seconds in place. */
export function stepVehicle(s: VehicleState, c: VehicleControls, spec: VehicleSpec, dt: number): void {
  const throttle = clamp(c.throttle, -1, 1);
  const steer = clamp(c.steer, -1, 1);

  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  // Lateral axis: points out of the car's left (driver's) side.
  const lx = Math.cos(s.heading);
  const lz = -Math.sin(s.heading);

  let vF = s.vx * fx + s.vz * fz;
  let vL = s.vx * lx + s.vz * lz;

  // --- Longitudinal ---
  if (throttle > 0) {
    if (vF < -0.5) {
      vF = decay(vF, spec.brakeDecel * throttle * dt);
    } else {
      const headroom = Math.max(0, 1 - vF / spec.maxSpeed);
      vF += spec.accel * throttle * headroom * dt;
    }
  } else if (throttle < 0) {
    if (vF > 0.5) {
      vF = decay(vF, spec.brakeDecel * -throttle * dt);
    } else {
      const headroom = Math.max(0, 1 + vF / spec.maxReverseSpeed);
      vF += spec.reverseAccel * throttle * headroom * dt;
    }
  }
  if (c.handbrake) vF = decay(vF, spec.handbrakeDecel * dt);
  vF -= vF * spec.drag * dt;
  if (throttle === 0) vF = decay(vF, spec.rollingResistance * dt);

  // --- Lateral grip: bleed off sideways slip ---
  const grip = c.handbrake ? spec.handbrakeGrip : spec.grip;
  vL *= Math.exp(-grip * dt);

  // --- Steering: yaw authority grows with speed, then tapers at high speed ---
  const absF = Math.abs(vF);
  const lowSpeedFactor = Math.min(1, absF / spec.steerFullSpeed);
  const highSpeedFactor = 1 / (1 + Math.max(0, absF - spec.steerFullSpeed) / spec.steerFalloffSpeed);
  const direction = vF >= 0 ? 1 : -1; // reversing flips steering, like a real car
  let targetYaw = -steer * spec.steerRate * lowSpeedFactor * highSpeedFactor * direction;
  if (c.handbrake) targetYaw *= spec.handbrakeYawBoost;
  s.yawRate += (targetYaw - s.yawRate) * Math.min(1, spec.steerResponse * dt);
  s.heading = wrapAngle(s.heading + s.yawRate * dt);

  // Rebuild world velocity from the *pre-rotation* axes: the body turns but
  // momentum doesn't, which creates slip that grip pulls back next step.
  s.vx = fx * vF + lx * vL;
  s.vz = fz * vF + lz * vL;

  s.x += s.vx * dt;
  s.z += s.vz * dt;
}

/** Where someone stands to get in: beside the driver's (left) door. */
export function driverDoorPosition(s: VehicleState, offset = 1.6): { x: number; z: number } {
  const lx = Math.cos(s.heading);
  const lz = -Math.sin(s.heading);
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  return { x: s.x + lx * offset + fx * 0.3, z: s.z + lz * offset + fz * 0.3 };
}

export function wrapAngle(a: number): number {
  const TAU = Math.PI * 2;
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Shortest-path angle interpolation, for render smoothing. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}
