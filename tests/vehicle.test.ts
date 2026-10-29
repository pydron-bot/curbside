import { describe, expect, it } from 'vitest';
import {
  SEDAN,
  createVehicleState,
  forwardSpeed,
  lateralSpeed,
  lerpAngle,
  speed,
  stepVehicle,
  wrapAngle,
  type VehicleControls,
  type VehicleState,
} from '../src/entities/vehicle';

const DT = 1 / 60;
const idle: VehicleControls = { throttle: 0, steer: 0, handbrake: false };

function run(s: VehicleState, c: VehicleControls, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepVehicle(s, c, SEDAN, DT);
}

describe('vehicle physics', () => {
  it('starts at rest pointing up-screen (-Z)', () => {
    const s = createVehicleState();
    expect(Math.sin(s.heading)).toBeCloseTo(0);
    expect(Math.cos(s.heading)).toBeCloseTo(-1);
    run(s, idle, 1);
    expect(speed(s)).toBe(0);
  });

  it('accelerates forward and stays under top speed', () => {
    const s = createVehicleState();
    run(s, { ...idle, throttle: 1 }, 2);
    expect(forwardSpeed(s)).toBeGreaterThan(15);
    expect(s.z).toBeLessThan(-10); // moved up-screen
    run(s, { ...idle, throttle: 1 }, 30);
    expect(forwardSpeed(s)).toBeLessThanOrEqual(SEDAN.maxSpeed);
    expect(forwardSpeed(s)).toBeGreaterThan(SEDAN.maxSpeed * 0.6);
  });

  it('brakes to a stop, then reverses while brake is held', () => {
    const s = createVehicleState();
    run(s, { ...idle, throttle: 1 }, 3);
    const startSpeed = forwardSpeed(s);
    let stoppedAfter = Infinity;
    for (let t = 0; t < 3; t += DT) {
      stepVehicle(s, { ...idle, throttle: -1 }, SEDAN, DT);
      if (Math.abs(forwardSpeed(s)) < 0.6) {
        stoppedAfter = t;
        break;
      }
    }
    // Stops at roughly brakeDecel (drag helps a little).
    expect(stoppedAfter).toBeLessThan(startSpeed / SEDAN.brakeDecel + 0.1);
    run(s, { ...idle, throttle: -1 }, 3);
    expect(forwardSpeed(s)).toBeLessThan(-3);
    expect(forwardSpeed(s)).toBeGreaterThanOrEqual(-SEDAN.maxReverseSpeed);
  });

  it('coasts to a full stop', () => {
    const s = createVehicleState();
    run(s, { ...idle, throttle: 1 }, 2);
    run(s, idle, 30);
    expect(speed(s)).toBe(0);
  });

  it('does not rotate when stationary', () => {
    const s = createVehicleState();
    const h = s.heading;
    run(s, { ...idle, steer: 1 }, 2);
    expect(s.heading).toBeCloseTo(h);
  });

  it('steering right while driving up-screen turns toward +X', () => {
    const s = createVehicleState();
    run(s, { ...idle, throttle: 1 }, 1);
    run(s, { throttle: 0.5, steer: 1, handbrake: false }, 0.5);
    expect(s.x).toBeGreaterThan(1);
    expect(Math.sin(s.heading)).toBeGreaterThan(0.3); // nose now points partly +X
  });

  it('reversing flips steering direction', () => {
    const s = createVehicleState();
    run(s, { ...idle, throttle: -1 }, 1.5);
    const h0 = s.heading;
    run(s, { throttle: -1, steer: 1, handbrake: false }, 0.5);
    // Forward + right steer gives negative yaw; reverse should give positive.
    expect(wrapAngle(s.heading - h0)).toBeGreaterThan(0);
  });

  it('handbrake turns produce more sideways slip than normal turns', () => {
    const slip = (handbrake: boolean) => {
      const s = createVehicleState();
      run(s, { ...idle, throttle: 1 }, 3);
      let peak = 0;
      for (let i = 0; i < 40; i++) {
        stepVehicle(s, { throttle: 0.3, steer: 1, handbrake }, SEDAN, DT);
        peak = Math.max(peak, Math.abs(lateralSpeed(s)));
      }
      return peak;
    };
    expect(slip(true)).toBeGreaterThan(slip(false) * 2);
  });

  it('is deterministic', () => {
    const a = createVehicleState();
    const b = createVehicleState();
    const script: VehicleControls[] = [
      { throttle: 1, steer: 0, handbrake: false },
      { throttle: 1, steer: -0.7, handbrake: false },
      { throttle: 0.2, steer: 1, handbrake: true },
    ];
    for (const c of script) {
      run(a, c, 1);
      run(b, c, 1);
    }
    expect(a).toEqual(b);
  });
});

describe('angle helpers', () => {
  it('wrapAngle keeps angles in (-PI, PI]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });

  it('lerpAngle takes the short way round', () => {
    const r = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    expect(Math.abs(wrapAngle(r - Math.PI))).toBeLessThan(1e-9);
  });
});
