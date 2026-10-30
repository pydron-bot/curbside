import { describe, expect, it } from 'vitest';
import {
  BOOST_TOP_SPEED,
  GRAVITY,
  SEDAN,
  VEHICLE_SPECS,
  copyVehicleState,
  createVehicleState,
  launch,
  driverDoorPosition,
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

describe('driving feel', () => {
  const full: VehicleControls = { throttle: 1, steer: 0, handbrake: false };

  it('every car reaches its rated top speed flat out, and no more', () => {
    for (const [name, spec] of Object.entries(VEHICLE_SPECS)) {
      const s = createVehicleState(0, 0, 0);
      for (let i = 0; i < 60 * 40; i++) stepVehicle(s, full, spec, DT);
      expect(forwardSpeed(s), name).toBeGreaterThan(spec.maxSpeed * 0.97);
      expect(forwardSpeed(s), name).toBeLessThanOrEqual(spec.maxSpeed + 0.01);
    }
    // The sports car is the fastest thing on the road, the garbage truck the
    // slowest; of the ordinary cars, the van.
    const tops = Object.values(VEHICLE_SPECS).map((v) => v.maxSpeed);
    expect(VEHICLE_SPECS.sports.maxSpeed).toBe(Math.max(...tops));
    expect(VEHICLE_SPECS.garbage_truck.maxSpeed).toBe(Math.min(...tops));
    const saloons = (['sedan', 'compact', 'sports', 'van', 'police', 'taxi', 'pickup'] as const).map((a) => VEHICLE_SPECS[a].maxSpeed);
    expect(VEHICLE_SPECS.van.maxSpeed).toBe(Math.min(...saloons));
  });

  it('nitro lifts the top speed and the pull', () => {
    const plain = createVehicleState(0, 0, 0);
    const boosted = createVehicleState(0, 0, 0);
    for (let i = 0; i < 60 * 3; i++) {
      stepVehicle(plain, full, SEDAN, DT);
      stepVehicle(boosted, { ...full, boost: true }, SEDAN, DT);
    }
    expect(forwardSpeed(boosted)).toBeGreaterThan(forwardSpeed(plain) + 3);
    for (let i = 0; i < 60 * 40; i++) stepVehicle(boosted, { ...full, boost: true }, SEDAN, DT);
    expect(forwardSpeed(boosted)).toBeCloseTo(SEDAN.maxSpeed * BOOST_TOP_SPEED, 0);
  });

  /** Seconds and forward distance to turn 90° at full lock from v0, holding `c`. */
  const quarterTurn = (v0: number, c: VehicleControls, spec = SEDAN) => {
    const s = createVehicleState(0, 0, 0);
    s.vz = v0;
    let t = 0;
    while (Math.abs(wrapAngle(s.heading)) < Math.PI / 2 && t < 6) {
      stepVehicle(s, c, spec, DT);
      t += DT;
    }
    return { t, forward: s.z, speed: speed(s) };
  };

  it('caps cornering at speed: a flat-out corner runs wide and scrubs speed', () => {
    const fast = quarterTurn(28, { throttle: 1, steer: 1, handbrake: false });
    expect(fast.forward).toBeGreaterThan(30); // a city road is 16 m wide: brake or drift
    expect(fast.speed).toBeLessThan(26); // the tyres scrub at the limit
    const slow = quarterTurn(10, { throttle: 0.5, steer: 1, handbrake: false });
    expect(slow.forward).toBeLessThan(11); // town speeds barely notice the cap
  });

  it('a handbrake drift gets round the same corner far tighter', () => {
    const grip = quarterTurn(28, { throttle: 1, steer: 1, handbrake: false });
    const drift = quarterTurn(28, { throttle: 0.6, steer: 1, handbrake: true });
    expect(drift.forward).toBeLessThan(grip.forward * 0.7);
    expect(drift.t).toBeLessThan(grip.t * 0.6);
  });

  it('a drift holds on the throttle, countersteer straightens it, and grip comes back', () => {
    const slipAngle = (s: VehicleState) => Math.abs(Math.atan2(lateralSpeed(s), forwardSpeed(s)));
    const flick = () => {
      const s = createVehicleState(0, 0, 0);
      s.vz = 24;
      run(s, { throttle: 1, steer: 1, handbrake: true }, 0.3);
      return s;
    };
    const held = flick();
    expect(held.slide).toBe(1);
    run(held, { throttle: 1, steer: 0.7, handbrake: false }, 0.3);
    const counter = flick();
    run(counter, { throttle: 1, steer: -0.5, handbrake: false }, 0.3);
    expect(slipAngle(held)).toBeGreaterThan(0.3); // still sideways, ~20°+
    expect(slipAngle(counter)).toBeLessThan(slipAngle(held) * 0.5);
    // Lift off and centre the wheel: it grips up and drives straight on, keeping its pace.
    run(held, { throttle: 0, steer: 0, handbrake: false }, 1.5);
    expect(held.slide).toBe(0);
    expect(slipAngle(held)).toBeLessThan(0.05);
    expect(speed(held)).toBeGreaterThan(14);
  });

  it('the sports car is twitchier than the van', () => {
    const yawAfter = (spec = SEDAN) => {
      const s = createVehicleState(0, 0, 0);
      s.vz = 12;
      for (let i = 0; i < 6; i++) stepVehicle(s, { throttle: 0.5, steer: 1, handbrake: false }, spec, DT);
      return Math.abs(s.yawRate);
    };
    expect(yawAfter(VEHICLE_SPECS.sports)).toBeGreaterThan(yawAfter(VEHICLE_SPECS.van) * 1.8);
    expect(VEHICLE_SPECS.van.mass).toBeGreaterThan(VEHICLE_SPECS.sports.mass);
  });

  it('a burnout holds the car, spins it with the wheel, and launches it harder', () => {
    const timeTo20 = (burnout: boolean) => {
      const s = createVehicleState(0, 0, 0);
      if (burnout) {
        run(s, { throttle: 1, steer: 0, handbrake: true }, 1);
        expect(speed(s)).toBeLessThan(0.5);
        expect(s.burnout).toBe(1);
      }
      let t = 0;
      while (forwardSpeed(s) < 20 && t < 10) {
        stepVehicle(s, full, SEDAN, DT);
        t += DT;
      }
      return t;
    };
    expect(timeTo20(true)).toBeLessThan(timeTo20(false) * 0.75);
    const donut = createVehicleState(0, 0, 0);
    run(donut, { throttle: 1, steer: 1, handbrake: true }, 0.5);
    expect(Math.abs(wrapAngle(donut.heading))).toBeGreaterThan(0.5);
    expect(speed(donut)).toBeLessThan(0.5);
  });
});

describe('airborne', () => {
  it('flies ballistic without steering, then lands and reports the impact', () => {
    const s = createVehicleState(0, 0, 0);
    s.vz = 25;
    s.y = 1.5;
    s.yawRate = 0.8;
    launch(s, 8);
    expect(s.airborne).toBe(true);
    let t = 0;
    let impact = 0;
    let peak = 0;
    while (s.airborne && t < 5) {
      // Full lock and throttle in the air do nothing.
      impact = stepVehicle(s, { throttle: 1, steer: 1, handbrake: false }, SEDAN, DT);
      peak = Math.max(peak, s.y);
      t += DT;
    }
    const expected = (8 + Math.sqrt(64 + 2 * GRAVITY * 1.5)) / GRAVITY;
    expect(t).toBeCloseTo(expected, 1);
    expect(peak).toBeCloseTo(1.5 + (8 * 8) / (2 * GRAVITY), 0);
    expect(impact).toBeGreaterThan(9);
    expect(s.y).toBe(0);
    expect(s.z).toBeGreaterThan(24 * t);
    // It kept the spin it left with (slowly damped), and steered not at all.
    expect(s.heading).toBeGreaterThan(0.6 * t);
    expect(s.heading).toBeLessThan(0.8 * t + 0.01);
  });

  it('lands skidding when it comes down turned across its path', () => {
    const s = createVehicleState(0, 0, 0);
    s.vz = 20;
    s.heading = 0.6;
    launch(s, 2);
    s.y = 0.1;
    while (s.airborne) stepVehicle(s, { throttle: 0, steer: 0, handbrake: false }, SEDAN, DT);
    expect(s.slide).toBeGreaterThan(0.5);
  });
});

describe('driverDoorPosition', () => {
  it('is on the screen-left side of a car pointing up-screen', () => {
    const s = createVehicleState(10, 20); // heading PI = nose toward -Z
    const door = driverDoorPosition(s);
    expect(door.x).toBeCloseTo(10 - 1.6);
    expect(door.z).toBeLessThan(20); // slightly toward the front
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

describe('vehicle state copy', () => {
  it('copyVehicleState copies every field (a new field must be added there too)', () => {
    const src = createVehicleState(1, 2, 3) as unknown as Record<string, number | boolean>;
    let n = 1;
    for (const k of Object.keys(src)) src[k] = typeof src[k] === 'boolean' ? !src[k] : (n += 1.5);
    const dst = createVehicleState();
    copyVehicleState(dst, src as unknown as VehicleState);
    expect(dst).toEqual(src);
  });
});
