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

/** Carried between steps: whether a three-point turn's reverse leg is under way. */
export interface DirectionalState {
  reversing: boolean;
}

export const DIRECTIONAL = {
  /** Steer per radian of heading error: full lock beyond ~26°. */
  gain: 2.2,
  /** Stick length below this is "no direction" (coast; pedals still work). */
  deadzone: 0.1,
  /** Heading error (rad) above which the throttle lifts... */
  liftAngle: 1.0,
  /** ...to at most this... */
  liftThrottle: 0.45,
  /** ...when faster than this, m/s (slow cars need the power to turn). */
  liftSpeed: 8,
  /** Target this far behind (rad) while faster than brakeSpeed: brake into the turn. */
  brakeAngle: 2.0,
  brakeSpeed: 9,
  brakeAmount: 0.7,
  /** Target this far behind (rad) and slower than reverseSpeed (m/s): back up. */
  reverseAngle: 2.4,
  reverseSpeed: 4,
  /** The reverse leg ends once the nose is within this of the target (rad). */
  reverseDone: 1.1,
} as const;

export function createDirectionalState(): DirectionalState {
  return { reversing: false };
}

/** World heading for a screen-relative direction (heading h points the nose along (sin h, cos h)). */
export function screenHeading(x: number, y: number): number {
  return Math.atan2(x, -y);
}

/**
 * Turn a directional stick into VehicleControls for `car`. Writes into `out`
 * (and `state`) and returns `out`.
 */
export function directionalControls(
  input: DirectionalInput,
  car: VehicleState,
  state: DirectionalState,
  out: VehicleControls,
): VehicleControls {
  const d = DIRECTIONAL;
  out.handbrake = input.handbrake;
  const mag = Math.min(1, Math.hypot(input.x, input.y));
  const vF = forwardSpeed(car);
  if (mag < d.deadzone) {
    state.reversing = false;
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
    else if (err > d.liftAngle && vF > d.liftSpeed && !input.gas) throttle = Math.min(throttle, d.liftThrottle);
  }

  // Swing the nose toward the target. Rolling backwards flips which way the
  // wheel yaws the car (see stepVehicle), so the wheel flips too.
  const backward = vF < -0.5 || (vF <= 0.5 && throttle < 0);
  const steer = Math.max(-1, Math.min(1, -diff * d.gain));
  out.steer = backward ? -steer : steer;
  out.throttle = throttle;
  return out;
}
