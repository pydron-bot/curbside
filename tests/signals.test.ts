import { describe, expect, it } from 'vitest';
import { SEDAN, VEHICLE_BODIES, VEHICLE_SPECS, createVehicleState, speed, stepVehicle, type VehicleState } from '../src/entities/vehicle';
import { collideVehicles } from '../src/systems/physics';
import { driveAi, spawnAi, type Obstacle } from '../src/systems/traffic';
import { BLOCK_SIZE, ROAD_WIDTH } from '../src/world/city';
import { MAX_NODE, type Dir } from '../src/world/roads';
import { SIGNAL_CYCLE, TrafficSignals, hasSignals, signalAt, signalPoles, type Signal, type SignalView } from '../src/world/signals';
import { random } from './helpers';

const DT = 1 / 60;

describe('the signal cycle', () => {
  it('gives each road green, amber, then red, and never both green', () => {
    const seen = new Set<string>();
    for (let t = 0; t < SIGNAL_CYCLE * 2; t += 0.1) {
      const ns = signalAt(false, t);
      const ew = signalAt(true, t);
      seen.add(`${ns}/${ew}`);
      expect(ns === 'red' || ew === 'red').toBe(true);
    }
    expect(seen).toContain('green/red');
    expect(seen).toContain('red/green');
    expect(seen).toContain('amber/red');
    // A moment of all-red between them.
    expect(seen).toContain('red/red');
    expect(signalAt(false, 1)).toBe('green');
    expect(signalAt(false, 10)).toBe('amber');
    expect(signalAt(true, 13)).toBe('green');
  });

  it('puts a pole on the kerb before every approach of a signalled junction, facing the traffic', () => {
    const poles = signalPoles();
    expect(poles.length).toBeGreaterThan(300);
    for (const p of poles) {
      const ix = Math.round(p.x / BLOCK_SIZE);
      const iz = Math.round(p.z / BLOCK_SIZE);
      expect(hasSignals(ix, iz)).toBe(true);
      // On the pavement beside the road, never in a lane or on the junction.
      const across = Math.min(Math.abs(p.x - ix * BLOCK_SIZE), Math.abs(p.z - iz * BLOCK_SIZE));
      expect(across).toBeGreaterThan(ROAD_WIDTH / 2);
      // Facing back along the road toward the oncoming cars (away from the junction).
      const away = Math.atan2(p.x - ix * BLOCK_SIZE, p.z - iz * BLOCK_SIZE);
      expect(Math.cos(away - p.heading)).toBeGreaterThan(0.5);
    }
    // The outer ring is left to give way.
    expect(hasSignals(MAX_NODE, 0)).toBe(false);
  });
});

/** A signal view stuck on one colour (or switched by the test). */
class FixedLights implements SignalView {
  constructor(public light: Signal) {}
  at(): Signal {
    return this.light;
  }
}

function laneCar(ix: number, iz: number, dir: Dir, t: number, seed: number, body = VEHICLE_BODIES.sedan) {
  const rand = random(seed);
  const s = spawnAi(ix, iz, dir, t, rand)!;
  const car: VehicleState = { ...createVehicleState(s.x, s.z, s.heading), body };
  s.driver.next = dir; // straight on
  return { car, ai: s.driver, rand };
}

describe('traffic and the lights', () => {
  it('stops at the line on red, and goes on green', () => {
    const lights = new FixedLights('red');
    const { car, ai, rand } = laneCar(0, 0, 0, 0.2, 3); // northbound toward (0, 0)
    let maxNorth = -Infinity;
    for (let i = 0; i < 60 * 20; i++) {
      stepVehicle(car, driveAi(ai, car, [], rand, DT, lights), SEDAN, DT);
      maxNorth = Math.max(maxNorth, -car.z);
    }
    // Stopped with the nose behind the stop line (~12 m before the crossing's centre).
    expect(speed(car)).toBeLessThan(0.3);
    expect(-car.z + 2.24).toBeLessThan(-11.5);
    expect(-car.z + 2.24).toBeGreaterThan(-17);
    lights.light = 'green';
    for (let i = 0; i < 60 * 6; i++) stepVehicle(car, driveAi(ai, car, [], rand, DT, lights), SEDAN, DT);
    expect(car.z).toBeLessThan(-12); // through the junction
  });

  it('a bus and a scooter stop at the line too', () => {
    for (const [a, body] of [
      ['bus', VEHICLE_BODIES.bus],
      ['scooter', VEHICLE_BODIES.scooter],
    ] as const) {
      const lights = new FixedLights('red');
      const { car, ai, rand } = laneCar(0, 0, 0, 0.2, 5, body);
      for (let i = 0; i < 60 * 20; i++) stepVehicle(car, driveAi(ai, car, [], rand, DT, lights), VEHICLE_SPECS[a], DT);
      expect(speed(car), a).toBeLessThan(0.3);
      expect(-car.z + body.reach, a).toBeLessThan(-11.5);
    }
  });

  it('runs through an amber it is too close to stop for, but stops for one far off', () => {
    const lights = new FixedLights('green');
    const { car, ai, rand } = laneCar(0, 0, 0, 0.75, 9);
    car.vz = -14;
    // Close to the line at speed when it turns amber.
    for (let i = 0; i < 600 && car.z > -22; i++) stepVehicle(car, driveAi(ai, car, [], rand, DT, lights), SEDAN, DT);
    lights.light = 'amber';
    for (let i = 0; i < 60 * 4; i++) stepVehicle(car, driveAi(ai, car, [], rand, DT, lights), SEDAN, DT);
    expect(car.z).toBeLessThan(-12);
    const far = laneCar(0, 0, 0, 0.1, 11);
    for (let i = 0; i < 60 * 20; i++) stepVehicle(far.car, driveAi(far.ai, far.car, [], far.rand, DT, lights), SEDAN, DT);
    expect(speed(far.car)).toBeLessThan(0.3);
    expect(far.car.z).toBeGreaterThan(-12);
  });

  it('a queue waits out a long red without pushing into the car ahead, then clears', () => {
    const lights = new FixedLights('red');
    const a = laneCar(0, 0, 0, 0.5, 21);
    const b = laneCar(0, 0, 0, 0.15, 22);
    const obstacles: Obstacle[] = [
      { x: 0, z: 0, halfWidth: 1 },
      { x: 0, z: 0, halfWidth: 1 },
    ];
    let hardest = 0;
    const run = (seconds: number) => {
      for (let i = 0; i < 60 * seconds; i++) {
        obstacles[0].x = a.car.x;
        obstacles[0].z = a.car.z;
        obstacles[1].x = b.car.x;
        obstacles[1].z = b.car.z;
        stepVehicle(a.car, driveAi(a.ai, a.car, obstacles, a.rand, DT, lights), SEDAN, DT);
        stepVehicle(b.car, driveAi(b.ai, b.car, obstacles, b.rand, DT, lights), SEDAN, DT);
        hardest = Math.max(hardest, collideVehicles(a.car, b.car));
      }
    };
    run(15);
    expect(hardest).toBe(0);
    expect(b.ai.pushThrough).toBe(0);
    expect(b.car.z).toBeGreaterThan(a.car.z + 4);
    lights.light = 'green';
    run(10);
    expect(b.car.z).toBeLessThan(-12);
  });

  it('the clock runs with the sim, and junctions without lights report none', () => {
    const s = new TrafficSignals();
    let lit: [number, number] | null = null;
    let dark: [number, number] | null = null;
    for (let ix = -3; ix <= 3 && (!lit || !dark); ix++) {
      for (let iz = -3; iz <= 3; iz++) {
        if (hasSignals(ix, iz)) lit ??= [ix, iz];
        else dark ??= [ix, iz];
      }
    }
    expect(lit && dark).toBeTruthy();
    expect(s.at(dark![0], dark![1], 0)).toBeNull();
    const before = s.at(lit![0], lit![1], 0);
    const changes = new Set<Signal | null>([before]);
    for (let i = 0; i < SIGNAL_CYCLE * 60; i++) {
      s.step(DT);
      changes.add(s.at(lit![0], lit![1], 0));
    }
    expect(changes.size).toBe(3);
  });
});
