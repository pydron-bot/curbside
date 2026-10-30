import { describe, expect, it } from 'vitest';
import { DIRECTIONAL, cornerSpeed, createDirectionalState, directionalControls, screenHeading, type DirectionalInput } from '../src/core/steering';
import { SEDAN, VEHICLE_SPECS, createVehicleState, forwardSpeed, speed, stepVehicle, wrapAngle, type VehicleControls } from '../src/entities/vehicle';

const stick = (x: number, y: number, extra: Partial<DirectionalInput> = {}): DirectionalInput => ({
  x,
  y,
  gas: false,
  brake: false,
  handbrake: false,
  ...extra,
});
const out = (): VehicleControls => ({ steer: 0, throttle: 0, handbrake: false });

/** Drive with a fixed stick for `seconds` through the real vehicle model. */
function drive(car: ReturnType<typeof createVehicleState>, input: DirectionalInput, seconds: number) {
  const state = createDirectionalState();
  const c = out();
  for (let t = 0; t < seconds; t += 1 / 60) {
    directionalControls(input, car, state, c);
    stepVehicle(car, c, SEDAN, 1 / 60);
  }
  return state;
}

describe('directional steering', () => {
  it('maps screen directions to world headings (screen-up is -Z)', () => {
    expect(screenHeading(0, 1)).toBeCloseTo(Math.PI); // up
    expect(screenHeading(1, 0)).toBeCloseTo(Math.PI / 2); // right: +X
    expect(screenHeading(0, -1)).toBeCloseTo(0); // down: +Z
  });

  it('drives straight on when the stick points the way the car faces', () => {
    const car = createVehicleState(0, 0, Math.PI);
    car.vz = -10;
    const c = directionalControls(stick(0, 0.8), car, createDirectionalState(), out());
    expect(c.steer).toBeCloseTo(0);
    expect(c.throttle).toBeCloseTo(0.8);
  });

  it('turns toward the stick, whichever way the car faces (no inversion driving down-screen)', () => {
    // Driving down the screen (+Z), push the stick screen-right: the car must end up going +X.
    const car = createVehicleState(0, 0, 0);
    car.vz = 12;
    drive(car, stick(1, 0), 3);
    expect(car.vx).toBeGreaterThan(8);
    expect(Math.abs(wrapAngle(car.heading - Math.PI / 2))).toBeLessThan(0.15);
  });

  it('settles on the target heading without oscillating', () => {
    const car = createVehicleState(0, 0, Math.PI / 2);
    drive(car, stick(0, 1), 4); // want screen-up
    expect(Math.abs(wrapAngle(car.heading - Math.PI))).toBeLessThan(0.08);
    expect(Math.abs(car.yawRate)).toBeLessThan(0.1);
    expect(car.vz).toBeLessThan(-10);
  });

  it('three-point turns when stopped facing away from the target', () => {
    const car = createVehicleState(0, 0, 0); // facing down-screen
    const state = createDirectionalState();
    const c = directionalControls(stick(0, 1), car, state, out()); // want up
    expect(state.reversing).toBe(true);
    expect(c.throttle).toBeLessThan(0);
    // Keep at it: it backs round, then drives off up the screen.
    drive(car, stick(0.05, 1), 6);
    expect(Math.abs(wrapAngle(car.heading - Math.PI))).toBeLessThan(0.3);
    expect(car.vz).toBeLessThan(-3);
  });

  it('brakes into a U-turn at speed instead of reversing', () => {
    const car = createVehicleState(0, 0, 0);
    car.vz = 25;
    const state = createDirectionalState();
    const c = directionalControls(stick(0.1, 1), car, state, out());
    expect(state.reversing).toBe(false);
    expect(c.throttle).toBe(-DIRECTIONAL.brakeAmount);
    expect(Math.abs(c.steer)).toBe(1);
  });

  it('lifts the throttle for sharp turns at speed', () => {
    const car = createVehicleState(0, 0, Math.PI);
    car.vz = -20;
    const c = directionalControls(stick(1, 0), car, createDirectionalState(), out()); // 90° right
    expect(c.throttle).toBeLessThanOrEqual(DIRECTIONAL.liftThrottle);
  });

  it('brakes into a right-angle corner taken flat out, so it makes the turn', () => {
    // Up the screen at top speed, stick pushed right: like turning off at a junction.
    for (const spec of [SEDAN, VEHICLE_SPECS.sports, VEHICLE_SPECS.van]) {
      const car = createVehicleState(0, 0, Math.PI);
      car.vz = -spec.maxSpeed;
      const state = createDirectionalState();
      const c = out();
      const first = directionalControls(stick(1, 0), car, state, c);
      expect(first.throttle).toBeLessThan(0);
      let overshoot = 0;
      for (let t = 0; t < 4 && Math.abs(wrapAngle(car.heading - Math.PI / 2)) > 0.1; t += 1 / 60) {
        directionalControls(stick(1, 0), car, state, c, 1 / 60);
        stepVehicle(car, c, spec, 1 / 60);
        overshoot = Math.max(overshoot, -car.z);
      }
      expect(overshoot).toBeLessThan(36); // past the junction, but round it inside the next block
      expect(speed(car)).toBeGreaterThan(cornerSpeed(Math.PI / 2) - 2); // not stopped dead
    }
    // Gentle bends keep more speed; GAS (or the drift chord) overrides it.
    expect(cornerSpeed(0.7)).toBeGreaterThan(cornerSpeed(1.5) + 5);
    const car = createVehicleState(0, 0, Math.PI);
    car.vz = -30;
    expect(directionalControls(stick(1, 0, { gas: true, handbrake: true }), car, createDirectionalState(), out()).throttle).toBe(1);
  });

  it('BRAKE brakes and then reverses; GAS forces full throttle', () => {
    const car = createVehicleState(0, 0, Math.PI);
    car.vz = -10;
    expect(directionalControls(stick(0, 0.5, { brake: true }), car, createDirectionalState(), out()).throttle).toBe(-1);
    expect(directionalControls(stick(0, 0.5, { gas: true }), car, createDirectionalState(), out()).throttle).toBe(1);
    // Pedals alone (stick centred) still work, without steering.
    const c = directionalControls(stick(0, 0, { brake: true, handbrake: true }), car, createDirectionalState(), out());
    expect(c).toEqual({ steer: 0, throttle: -1, handbrake: true });
  });

  it('coasts with the stick centred', () => {
    const car = createVehicleState(0, 0, 1);
    const c = directionalControls(stick(0.02, 0.03), car, createDirectionalState(), out());
    expect(c.throttle).toBe(0);
    expect(c.steer).toBe(0);
  });

  it('reversing with BRAKE still swings the nose toward the stick', () => {
    const car = createVehicleState(0, 0, Math.PI); // facing up
    car.vz = 3; // rolling backwards (down-screen)
    expect(forwardSpeed(car)).toBeLessThan(0);
    const before = car.heading;
    const state = createDirectionalState();
    const c = out();
    for (let i = 0; i < 30; i++) {
      directionalControls(stick(0.7, 0.7, { brake: true }), car, state, c); // want up-right
      stepVehicle(car, c, SEDAN, 1 / 60);
    }
    // Up-right is heading 3π/4: from π that's a decrease.
    expect(wrapAngle(car.heading - before)).toBeLessThan(0);
  });

  it('backs off a wall it is stuck against, then tries again', () => {
    const car = createVehicleState(0, 0, Math.PI); // nose against a wall up-screen
    const state = createDirectionalState();
    const c = out();
    const dt = 1 / 60;
    const throttles: number[] = [];
    for (let t = 0; t < 2; t += dt) {
      directionalControls(stick(0.3, 0.9), car, state, c, dt); // up and a little right
      throttles.push(c.throttle);
      car.vx = car.vz = 0; // the wall: it never moves
    }
    const firstReverse = throttles.findIndex((v) => v < 0);
    expect(firstReverse * dt).toBeCloseTo(DIRECTIONAL.stallTime, 1);
    const reverseFrames = throttles.slice(firstReverse).findIndex((v) => v > 0);
    expect(reverseFrames * dt).toBeCloseTo(DIRECTIONAL.unstickTime, 1);
  });

  it('does not count a standing start, a second read, or GAS as being stuck', () => {
    const car = createVehicleState(0, 0, Math.PI);
    const state = createDirectionalState();
    const c = out();
    for (let i = 0; i < 120; i++) directionalControls(stick(0, 1), car, state, c, 0); // dt 0: no time passes
    expect(c.throttle).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) directionalControls(stick(0, 1, { gas: true }), car, state, c, 1 / 60);
    expect(c.throttle).toBe(1);
    // A real start: moving within a few frames, never reverses.
    const moving = createVehicleState(0, 0, Math.PI);
    const s2 = createDirectionalState();
    for (let i = 0; i < 90; i++) {
      directionalControls(stick(0, 1), moving, s2, c, 1 / 60);
      expect(c.throttle).toBeGreaterThan(0);
      stepVehicle(moving, c, SEDAN, 1 / 60);
    }
  });
});
