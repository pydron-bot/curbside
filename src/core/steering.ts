/**
 * Directional ("point where you want to go") touch steering. The stick's angle
 * is the world heading the player wants; the camera never rotates, so
 * screen-up is always world -Z and pushing right always means "go screen-right",
 * whichever way the car faces. Car-relative steering inverts when you drive
 * down the screen, which is what makes top-down driving miserable on a phone.
 *
 * The stick's length is the throttle (auto-gas) unless BRAKE is held. The
 * helper lifts off for sharp turns, brakes when the target is well behind at
 * speed, and reverses with the wheel flipped (a three-point turn) when it's
 * behind and the car is slow. Pure: no DOM, no three.js.
 */
import { forwardSpeed, wrapAngle, type VehicleControls, type VehicleState } from '../entities/vehicle';
import { tune } from './touchTuning';

export interface DirectionalInput {
  /** Stick, screen-relative, already shaped: x = screen-right, y = screen-up, length 0..1. */
  x: number;
  y: number;
  /** Full throttle override (the GAS pedal). */
  gas: boolean;
  /** Brake, then reverse (the BRAKE pedal). */
  brake: boolean;
  handbrake: boolean;
}

/** Carried between steps. */
export interface DirectionalState {
  /** A three-point turn's reverse leg is under way. */
  reversing: boolean;
  /** Seconds the car has been asked forward but hasn't moved (nose in a wall). */
  stalled: number;
  /** Seconds left backing away from whatever it's stuck against. */
  unstick: number;
}

/**
 * The point-to-steer helper's constants. Its gain (steer per radian of
 * heading error: full lock beyond ~26° at 2.2) and deadzone (a stick shorter
 * than this is "no direction": coast, pedals still work) are tuned live:
 * `tune.dirGain` / `tune.dirDeadzone` (core/touchTuning.ts).
 */
export const DIRECTIONAL = {
  /** Heading error (rad) above which the throttle lifts... */
  liftAngle: 1.0,
  /** ...to at most this... */
  liftThrottle: 0.45,
  /** ...when faster than this, m/s (slow cars need the power to turn). */
  liftSpeed: 8,
  /**
   * Corners: grip only turns a car so fast (VehicleSpec.latAccel), so for a
   * turn of more than cornerAngle (rad) the helper brakes down toward a
   * corner speed: cornerSpeed (m/s) for a right angle or more, rising to
   * cornerSpeed + cornerSlack for gentler bends. Full brake cornerBrake m/s over.
   */
  cornerAngle: 0.6,
  cornerSpeed: 16,
  cornerSlack: 11,
  cornerBrake: 8,
  /** Target this far behind (rad) while faster than brakeSpeed: brake into the turn. */
  brakeAngle: 2.0,
  brakeSpeed: 9,
  brakeAmount: 0.7,
  /** Target this far behind (rad) and slower than reverseSpeed (m/s): back up. */
  reverseAngle: 2.4,
  reverseSpeed: 4,
  /** The reverse leg ends once the nose is within this of the target (rad). */
  reverseDone: 1.1,
  /** Asked forward this long (s) while slower than stallSpeed (m/s): stuck, so back off... */
  stallTime: 0.6,
  stallSpeed: 0.8,
  /** ...for this long (s), swinging the nose toward the target. */
  unstickTime: 0.8,
} as const;

export function createDirectionalState(): DirectionalState {
  return { reversing: false, stalled: 0, unstick: 0 };
}

/** Forget any turn or unstick in progress (pause, getting out). */
export function resetDirectionalState(state: DirectionalState): void {
  state.reversing = false;
  state.stalled = state.unstick = 0;
}

/** Fastest the helper takes a turn of `err` radians on grip, m/s. */
export function cornerSpeed(err: number): number {
  const d = DIRECTIONAL;
  const k = Math.min(1, Math.max(0, (err - d.cornerAngle) / (Math.PI / 2 - d.cornerAngle)));
  return d.cornerSpeed + d.cornerSlack * (1 - k);
}

/** World heading for a screen-relative direction (heading h points the nose along (sin h, cos h)). */
export function screenHeading(x: number, y: number): number {
  return Math.atan2(x, -y);
}

/**
 * Turn a directional stick into VehicleControls for `car`. Writes into `out`
 * (and `state`) and returns `out`. `dt` (s) advances the stuck-against-a-wall
 * timers; pass 0 for a read that mustn't (a second read in the same frame).
 */
export function directionalControls(
  input: DirectionalInput,
  car: VehicleState,
  state: DirectionalState,
  out: VehicleControls,
  dt = 0,
): VehicleControls {
  const d = DIRECTIONAL;
  out.handbrake = input.handbrake;
  const mag = Math.min(1, Math.hypot(input.x, input.y));
  const vF = forwardSpeed(car);
  if (mag < tune.dirDeadzone) {
    resetDirectionalState(state);
    out.steer = 0;
    out.throttle = input.brake ? -1 : input.gas ? 1 : 0;
    return out;
  }

  const diff = wrapAngle(screenHeading(input.x, input.y) - car.heading);
  const err = Math.abs(diff);
  if (state.reversing) {
    if (err < d.reverseDone || input.gas || vF > 1) state.reversing = false;
  } else if (err > d.reverseAngle && vF < d.reverseSpeed && !input.gas) {
    state.reversing = true;
  }

  let throttle: number;
  if (input.brake) throttle = -1;
  else if (state.reversing) throttle = -mag;
  else {
    throttle = input.gas ? 1 : mag;
    if (err > d.brakeAngle && vF > d.brakeSpeed) throttle = -d.brakeAmount;
    else if (!input.gas && !input.handbrake && err > d.cornerAngle && vF > cornerSpeed(err)) {
      // Too fast for this corner on grip: brake into it (a drift is the GAS + HAND way round).
      throttle = -Math.min(1, (vF - cornerSpeed(err)) / d.cornerBrake);
    } else if (err > d.liftAngle && vF > d.liftSpeed && !input.gas) throttle = Math.min(throttle, d.liftThrottle);
  }

  // Nose in a wall (or another car): pushing on would just grind, and with
  // auto-gas there's no pedal to let go of. Back off, then try again. The
  // GAS pedal means "really, forward" and overrides it.
  if (input.gas || input.brake || state.reversing) state.stalled = state.unstick = 0;
  else if (state.unstick > 0) {
    state.unstick = Math.max(0, state.unstick - dt);
    throttle = -Math.max(0.6, mag);
  } else if (throttle > 0.25 && Math.abs(vF) < d.stallSpeed) {
    state.stalled += dt;
    if (state.stalled >= d.stallTime) {
      state.stalled = 0;
      state.unstick = d.unstickTime;
      throttle = -Math.max(0.6, mag);
    }
  } else state.stalled = 0;

  // Swing the nose toward the target. Rolling backwards flips which way the
  // wheel yaws the car (see stepVehicle), so the wheel flips too.
  const backward = vF < -0.5 || (vF <= 0.5 && throttle < 0);
  const steer = Math.max(-1, Math.min(1, -diff * tune.dirGain));
  out.steer = backward ? -steer : steer;
  out.throttle = throttle;
  return out;
}
