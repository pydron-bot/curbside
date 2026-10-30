import { describe, expect, it } from 'vitest';
import { VEHICLE_BODIES, VEHICLE_SPECS, createVehicleState, stepVehicle, type VehicleArchetype, type VehicleState } from '../src/entities/vehicle';
import { collideVehicles } from '../src/systems/physics';
import { clearDistance, driveAi, spawnAi, vehicleObstacles, type AiDriver, type Obstacle } from '../src/systems/traffic';
import type { Signal, SignalView } from '../src/world/signals';
import { random } from './helpers';

const DT = 1 / 60;

class FixedLights implements SignalView {
  constructor(public light: Signal) {}
  at(): Signal {
    return this.light;
  }
}

interface Car {
  archetype: VehicleArchetype;
  car: VehicleState;
  ai: AiDriver;
  rand: () => number;
}

/** Northbound toward junction (0, 0), `t` of the way along the block, straight on. */
function laneCar(archetype: VehicleArchetype, t: number, seed: number): Car {
  const rand = random(seed);
  const s = spawnAi(0, 0, 0, t, rand)!;
  s.driver.next = 0;
  const car: VehicleState = { ...createVehicleState(s.x, s.z, s.heading), body: VEHICLE_BODIES[archetype] };
  return { archetype, car, ai: s.driver, rand };
}

/** Every car's obstacle points, as main.ts builds them (each car skips its own by owner). */
function obstaclesOf(cars: Car[], out: Obstacle[]): Obstacle[] {
  out.length = 0;
  for (const c of cars) vehicleObstacles(c.car, false, (x, z, halfWidth, player, owner) => out.push({ x, z, halfWidth, player, owner }));
  return out;
}

describe('long vehicles in traffic', () => {
  it('are seen along their length: a point per body circle, a car as its middle', () => {
    const pts: Obstacle[] = [];
    const bus: VehicleState = { ...createVehicleState(0, 0, 0), body: VEHICLE_BODIES.bus };
    vehicleObstacles(bus, false, (x, z, halfWidth, player, owner) => pts.push({ x, z, halfWidth, player, owner }));
    expect(pts.length).toBe(VEHICLE_BODIES.bus.offsets.length);
    expect(Math.min(...pts.map((p) => p.z))).toBeLessThan(-4);
    expect(pts.every((p) => p.owner === bus)).toBe(true);
    const sedan: VehicleState = { ...createVehicleState(0, 0, 0), body: VEHICLE_BODIES.sedan };
    pts.length = 0;
    vehicleObstacles(sedan, false, (x, z, halfWidth, player, owner) => pts.push({ x, z, halfWidth, player, owner }));
    expect(pts).toHaveLength(1);
  });

  it('a car behind a bus keeps its distance from the bus\'s tail, and the bus from its own nose', () => {
    const pts: Obstacle[] = [];
    // A bus parked 14 m ahead of a sedan (both facing +z): its tail is ~8 m from the sedan's middle.
    const bus: VehicleState = { ...createVehicleState(0, 14, 0), body: VEHICLE_BODIES.bus };
    const sedan: VehicleState = { ...createVehicleState(0, 0, 0), body: VEHICLE_BODIES.sedan };
    vehicleObstacles(bus, false, (x, z, halfWidth, player, owner) => pts.push({ x, z, halfWidth, player, owner }));
    vehicleObstacles(sedan, false, (x, z, halfWidth, player, owner) => pts.push({ x, z, halfWidth, player, owner }));
    expect(clearDistance(sedan, pts)).toBeLessThan(14 - 4.7 - 2.4);
    // The bus sees nothing of itself.
    expect(clearDistance(bus, pts)).toBe(Infinity);
  });

  it('a queue with a bus and a fire truck in it waits out a red without ramming, then clears', () => {
    const lights = new FixedLights('red');
    const kinds: Array<[VehicleArchetype, number]> = [
      ['sedan', 0.85],
      ['bus', 0.58],
      ['sedan', 0.36],
      ['firetruck', 0.16],
    ];
    const cars = kinds.map(([k, t], i) => laneCar(k, t, 40 + i));
    const obs: Obstacle[] = [];
    let hardest = 0;
    const run = (seconds: number) => {
      for (let i = 0; i < 60 * seconds; i++) {
        obstaclesOf(cars, obs);
        for (const c of cars) stepVehicle(c.car, driveAi(c.ai, c.car, obs, c.rand, DT, lights), VEHICLE_SPECS[c.archetype], DT);
        for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) hardest = Math.max(hardest, collideVehicles(cars[a].car, cars[b].car));
      }
    };
    run(20);
    expect(hardest).toBeLessThan(0.5);
    for (const c of cars) expect(c.ai.pushThrough).toBe(0);
    lights.light = 'green';
    run(20);
    expect(hardest).toBeLessThan(0.5);
    // The bus is through the junction.
    expect(cars[1].car.z).toBeLessThan(-12);
  });
});
