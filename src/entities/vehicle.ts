/**
 * Arcade vehicle physics on the XZ ground plane. Pure functions, no three.js,
 * so it can be unit-tested and tuned in isolation.
 *
 * Conventions: 1 unit = 1 m. `heading` is the rotation about +Y in radians;
 * a heading of h points the car's nose along (sin h, cos h) in (x, z), which
 * matches three.js `rotation.y = h` for a mesh whose front faces local +Z.
 * With the top-down camera, screen-up is -Z (heading PI) and screen-right is +X.
 *
 * The feel, in short: each car reaches exactly its `maxSpeed` flat out; grip
 * only turns a car as fast as `latAccel` allows (so corners taken flat out
 * understeer wide and you brake or drift into them); the handbrake kicks the
 * rear loose into a drift you hold with the throttle, steer with the wheel
 * (countersteer straightens it) and leave by lifting off; handbrake + throttle
 * from a standstill is a burnout that launches the car when you let go.
 * There's a vertical axis too, for ramps: airborne cars fly ballistic with no
 * grip or steering until they land.
 */

export interface VehicleSpec {
  /** Top forward speed flat out on the level, m/s: the car really reaches it. */
  maxSpeed: number;
  /** Top reverse speed, m/s. */
  maxReverseSpeed: number;
  /** Engine acceleration at standstill, m/s². Tapers so drag balances it at maxSpeed. */
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
  /** How quickly yaw rate follows input, 1/s (high = twitchy, low = heavy). */
  steerResponse: number;
  /** Lateral grip: fraction of sideways slip removed per second (as exp rate). */
  grip: number;
  /** Lateral grip with the handbrake on (lower = more drift). */
  handbrakeGrip: number;
  /** Yaw-rate multiplier while handbraking (rear steps out). */
  handbrakeYawBoost: number;
  /**
   * Cornering limit, m/s²: on grip the yaw rate is capped at latAccel / speed,
   * so a flat-out corner runs wide (and scrubs speed) unless you brake or drift.
   */
  latAccel: number;
  /** Lateral grip while the rear is still loose after a handbrake (a drift). */
  driftGrip: number;
  /** How fast a drift's loose rear grips again off the throttle, 1/s (on the throttle it holds longer). */
  driftRecover: number;
  /** Share of the sideways speed a power slide scrubs that goes into forward speed (drifts keep their pace). */
  driftCarry: number;
  /** Mass relative to a sedan, for car-on-car collisions and who gets hurt. */
  mass: number;
}

export interface VehicleState {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  yawRate: number;
  /** Height of the car above the road, m (0 on the ground; >0 on a ramp or flying). */
  y: number;
  /** Vertical speed, m/s (while airborne). */
  vy: number;
  /** Off the ground: no grip, no steering, no engine until it lands. */
  airborne: boolean;
  /** 0..1, how loose the rear is: 1 on the handbrake, fading as grip comes back. */
  slide: number;
  /** 0..1 burnout charge while held on the handbrake with the throttle down. */
  burnout: number;
  /** Seconds left of a launch (after a burnout), with extra acceleration. */
  launchTime: number;
}

/**
 * dst = src, field by field: the sim keeps last step's state of every car for
 * render interpolation, and Object.assign there boxed numbers every step.
 */
export function copyVehicleState(dst: VehicleState, src: VehicleState): void {
  dst.x = src.x;
  dst.z = src.z;
  dst.heading = src.heading;
  dst.vx = src.vx;
  dst.vz = src.vz;
  dst.yawRate = src.yawRate;
  dst.y = src.y;
  dst.vy = src.vy;
  dst.airborne = src.airborne;
  dst.slide = src.slide;
  dst.burnout = src.burnout;
  dst.launchTime = src.launchTime;
}

export interface VehicleControls {
  /** -1 (brake/reverse) .. 1 (full throttle) */
  throttle: number;
  /** -1 (left) .. 1 (right), screen-relative when driving up the screen */
  steer: number;
  handbrake: boolean;
  /** Nitro: more power and a higher top speed while held (the caller meters the tank). */
  boost?: boolean;
}

export const SEDAN: VehicleSpec = {
  maxSpeed: 33,
  maxReverseSpeed: 9,
  accel: 14,
  reverseAccel: 7,
  brakeDecel: 26,
  handbrakeDecel: 6,
  drag: 0.04,
  rollingResistance: 1.2,
  steerRate: 2.6,
  steerFullSpeed: 6,
  steerFalloffSpeed: 30,
  steerResponse: 10,
  grip: 9,
  handbrakeGrip: 1.4,
  handbrakeYawBoost: 1.5,
  latAccel: 21,
  driftGrip: 2.5,
  driftRecover: 2.2,
  driftCarry: 0.35,
  mass: 1,
};

export type VehicleArchetype = 'sedan' | 'compact' | 'sports' | 'van' | 'police' | 'taxi' | 'pickup';

/**
 * Handling per archetype, as tweaks on the sedan baseline: the sports car is
 * quick and twitchy (fast steering response, high cornering limit, a loose
 * rear), the van heavy and lazy (slow response, low limit, grips back fast,
 * shoves other cars about), police a little quicker than most traffic.
 */
export const VEHICLE_SPECS: Record<VehicleArchetype, VehicleSpec> = {
  sedan: SEDAN,
  compact: { ...SEDAN, maxSpeed: 30, accel: 13, steerRate: 2.9, steerResponse: 12, grip: 9.5, latAccel: 22, mass: 0.85 },
  sports: {
    ...SEDAN,
    maxSpeed: 42,
    accel: 20,
    brakeDecel: 30,
    steerRate: 3,
    steerResponse: 15,
    grip: 10.5,
    handbrakeGrip: 1.1,
    handbrakeYawBoost: 1.6,
    latAccel: 26,
    driftGrip: 2.4,
    driftRecover: 1.8,
    driftCarry: 0.42,
    mass: 0.9,
  },
  van: {
    ...SEDAN,
    maxSpeed: 27,
    accel: 11,
    brakeDecel: 19,
    steerRate: 2.1,
    steerResponse: 6,
    grip: 7.5,
    handbrakeGrip: 1.9,
    handbrakeYawBoost: 1.3,
    latAccel: 16,
    driftGrip: 3.8,
    driftRecover: 3,
    driftCarry: 0.25,
    mass: 1.6,
  },
  police: { ...SEDAN, maxSpeed: 34, accel: 17, brakeDecel: 28, steerRate: 2.7, steerResponse: 11, latAccel: 24, mass: 1.15 },
  taxi: { ...SEDAN, maxSpeed: 32, accel: 13, latAccel: 20 },
  pickup: {
    ...SEDAN,
    maxSpeed: 31,
    accel: 12,
    steerRate: 2.3,
    steerResponse: 8,
    grip: 8,
    handbrakeGrip: 1.6,
    latAccel: 18,
    driftGrip: 3.4,
    mass: 1.35,
  },
};

/**
 * Max health per archetype. Tuned with damage.ts so a car survives a couple
 * of solid crashes: big and heavy takes more, the sports car the least.
 */
export const VEHICLE_HEALTH: Record<VehicleArchetype, number> = {
  sedan: 100,
  compact: 90,
  sports: 90,
  van: 140,
  police: 130,
  taxi: 100,
  pickup: 125,
};

/** Gravity for airborne cars, m/s² (a touch heavier than real: jumps read snappier from above). */
export const GRAVITY = 22;
/** Nitro: acceleration and top speed multipliers while boosting. */
export const BOOST_ACCEL = 1.7;
export const BOOST_TOP_SPEED = 1.25;
/** Handbrake + throttle below this speed is a burnout, m/s. */
export const BURNOUT_SPEED = 2.5;
/** Seconds of burnout to a full launch charge. */
const BURNOUT_CHARGE = 0.9;
/** A full charge launches for this long, s, with this much extra acceleration. */
const LAUNCH_SECONDS = 1.4;
const LAUNCH_ACCEL = 1.75;
/** Spinning on the spot in a burnout (a donut), rad/s at full lock. */
const DONUT_YAW = 2.3;
/** Speed lost per s while asking for more turn than grip gives, m/s² at the worst. */
const SCRUB = 5;
/** A loose rear turns this much faster than the grip limit allows (×, at slide 1). */
const DRIFT_YAW = 2.4;
/** Yaw rate decays in the air at this rate, 1/s (spins carry, slowly). */
const AIR_YAW_DAMP = 0.3;
/** Air drag on a flying car, per s. */
const AIR_DRAG = 0.02;

export function createVehicleState(x = 0, z = 0, heading = Math.PI): VehicleState {
  return { x, z, heading, vx: 0, vz: 0, yawRate: 0, y: 0, vy: 0, airborne: false, slide: 0, burnout: 0, launchTime: 0 };
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

/**
 * Where the engine's taper reaches zero, so that engine and drag balance at
 * exactly `top`: accel·(1 − v/L) = drag·v at v = top.
 */
export function taperLimit(accel: number, top: number, drag: number): number {
  const net = accel - drag * top;
  return net > 1e-6 ? (accel * top) / net : top * 4;
}

/** Top speed flat out (what the speedometer should read at the limit), m/s. */
export function terminalSpeed(spec: Pick<VehicleSpec, 'maxSpeed'>, boost = false): number {
  return spec.maxSpeed * (boost ? BOOST_TOP_SPEED : 1);
}

/**
 * Advance the vehicle by `dt` seconds in place. Returns the vertical speed
 * (m/s) of a landing on this step, 0 otherwise, for landing damage and fx.
 */
export function stepVehicle(s: VehicleState, c: VehicleControls, spec: VehicleSpec, dt: number): number {
  if (s.airborne) return stepAir(s, dt);
  const throttle = clamp(c.throttle, -1, 1);
  const steer = clamp(c.steer, -1, 1);
  const boost = c.boost === true && throttle > 0;

  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  // Lateral axis: points out of the car's left (driver's) side.
  const lx = Math.cos(s.heading);
  const lz = -Math.sin(s.heading);

  let vF = s.vx * fx + s.vz * fz;
  let vL = s.vx * lx + s.vz * lz;

  // --- Burnout: held on the handbrake with the throttle down, it spins up a launch ---
  const burning = c.handbrake && throttle > 0.5 && Math.abs(vF) < BURNOUT_SPEED;
  if (burning) {
    s.burnout = Math.min(1, s.burnout + dt / BURNOUT_CHARGE);
  } else if (s.burnout > 0) {
    // Let go of the handbrake still on the gas: launch, as hard as it was charged.
    if (!c.handbrake && throttle > 0.3 && s.burnout > 0.25) s.launchTime = LAUNCH_SECONDS * s.burnout;
    s.burnout = 0;
  }
  if (s.launchTime > 0) s.launchTime = throttle > 0 ? Math.max(0, s.launchTime - dt) : 0;

  // --- Longitudinal ---
  const top = terminalSpeed(spec, boost);
  const accel = spec.accel * (boost ? BOOST_ACCEL : 1) * (s.launchTime > 0 ? LAUNCH_ACCEL : 1);
  const limit = taperLimit(accel, top, spec.drag);
  if (burning) {
    // The brakes hold the car while the rear wheels spin.
    vF = decay(vF, 14 * dt);
  } else if (throttle > 0) {
    if (vF < -0.5) {
      vF = decay(vF, spec.brakeDecel * throttle * dt);
    } else {
      const headroom = Math.max(0, 1 - vF / limit);
      vF += accel * throttle * headroom * dt;
    }
  } else if (throttle < 0) {
    if (vF > 0.5) {
      vF = decay(vF, spec.brakeDecel * -throttle * dt);
    } else {
      const headroom = Math.max(0, 1 + vF / spec.maxReverseSpeed);
      vF += spec.reverseAccel * throttle * headroom * dt;
    }
  }
  if (c.handbrake && !burning) vF = decay(vF, spec.handbrakeDecel * dt);
  vF -= vF * spec.drag * dt;
  if (throttle === 0) vF = decay(vF, spec.rollingResistance * dt);

  // --- Drift: the handbrake kicks the rear loose; grip comes back slowly on the
  // throttle (a power slide holds) and quickly off it, or once the car is straight. ---
  const absF = Math.abs(vF);
  if (c.handbrake && absF > 4) s.slide = 1;
  else if (s.slide > 0) {
    const straight = Math.abs(vL) < 0.15 * Math.max(4, absF);
    const rate = spec.driftRecover * (throttle > 0.5 ? 0.3 : 1) * (straight ? 4 : 1);
    s.slide = Math.max(0, s.slide - rate * dt);
  }

  // --- Lateral grip: bleed off sideways slip ---
  const grip = c.handbrake ? spec.handbrakeGrip : spec.grip + (spec.driftGrip - spec.grip) * s.slide;
  const vL0 = vL;
  vL *= Math.exp(-grip * dt);
  // A power slide carries part of the speed the tyres scrub sideways into forward speed.
  if (s.slide > 0 && throttle > 0 && vF > 0) {
    vF = Math.min(Math.max(vF, top), vF + Math.abs(vL0 - vL) * spec.driftCarry * s.slide * throttle);
  }

  // --- Steering: yaw authority grows with speed, then tapers at high speed ---
  let targetYaw: number;
  let response = spec.steerResponse;
  if (burning) {
    // Donuts: the wheel swings the car round on the spot.
    targetYaw = -steer * DONUT_YAW;
  } else {
    const lowSpeedFactor = Math.min(1, absF / spec.steerFullSpeed);
    const highSpeedFactor = 1 / (1 + Math.max(0, absF - spec.steerFullSpeed) / spec.steerFalloffSpeed);
    const direction = vF >= 0 ? 1 : -1; // reversing flips steering, like a real car
    targetYaw = -steer * spec.steerRate * lowSpeedFactor * highSpeedFactor * direction;
    if (c.handbrake) targetYaw *= spec.handbrakeYawBoost;
    // Cornering limit: grip turns the car only as fast as latAccel allows. A
    // loose rear rotates past it (that's the drift), and catches a bit quicker.
    const cap = (spec.latAccel / Math.max(1, absF)) * (1 + (DRIFT_YAW - 1) * s.slide);
    const want = Math.abs(targetYaw);
    if (want > cap) {
      targetYaw = Math.sign(targetYaw) * cap;
      // Asking for more than the tyres give: they scrub (understeer costs speed).
      if (s.slide < 0.5) vF = decay(vF, SCRUB * Math.min(1, want / cap - 1) * dt);
    }
    response *= 1 + 0.4 * s.slide;
  }
  s.yawRate += (targetYaw - s.yawRate) * Math.min(1, response * dt);
  s.heading = wrapAngle(s.heading + s.yawRate * dt);

  // Rebuild world velocity from the *pre-rotation* axes: the body turns but
  // momentum doesn't, which creates slip that grip pulls back next step.
  s.vx = fx * vF + lx * vL;
  s.vz = fz * vF + lz * vL;

  s.x += s.vx * dt;
  s.z += s.vz * dt;
  return 0;
}

/** Flying: gravity, a little air drag, the spin it left with; no grip, steering or engine. */
function stepAir(s: VehicleState, dt: number): number {
  s.vy -= GRAVITY * dt;
  s.y += s.vy * dt;
  const k = 1 - AIR_DRAG * dt;
  s.vx *= k;
  s.vz *= k;
  s.yawRate *= Math.exp(-AIR_YAW_DAMP * dt);
  s.heading = wrapAngle(s.heading + s.yawRate * dt);
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.burnout = 0;
  if (s.y > 0) return 0;
  const impact = Math.max(0, -s.vy);
  s.y = 0;
  s.vy = 0;
  s.airborne = false;
  // Landing at an angle to the way it's moving skids out like a drift.
  const slip = Math.abs(lateralSpeed(s)) / Math.max(4, speed(s));
  s.slide = Math.max(s.slide, Math.min(1, slip * 2));
  return impact;
}

/** Throw the car into the air at its current height with vertical speed `vy` (a ramp lip). */
export function launch(s: VehicleState, vy: number): void {
  s.airborne = true;
  s.vy = vy;
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
