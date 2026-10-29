import { describe, expect, it } from 'vitest';
import { SEDAN, speed, stepVehicle, type VehicleState } from '../src/entities/vehicle';
import { collideVehicleStatic, collideVehicles } from '../src/systems/physics';
import { clearDistance, driveAi, spawnAi } from '../src/systems/traffic';
import { generateCity } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';
import { MAX_NODE, chooseTurn, lanePoint, rightOf, type Dir } from '../src/world/roads';

const DT = 1 / 60;

describe('road geometry', () => {
  it('drives on the right', () => {
    // Heading north (-Z), the right-hand lane is at +X.
    expect(rightOf(0).x).toBe(1);
    expect(rightOf(0).z).toBeCloseTo(0);
    expect(lanePoint(0, 0, 0, -10).x).toBeGreaterThan(0);
    // Heading east (+X), right is +Z.
    expect(lanePoint(0, 0, 1, -10).z).toBeGreaterThan(0);
  });

  it('never turns off the map', () => {
    const rand = random(3);
    for (let i = 0; i < 200; i++) {
      // At the north-east corner heading north: only west (left) is possible... or a U-turn.
      const d = chooseTurn(MAX_NODE, -MAX_NODE, 0, rand);
      expect([3, 2]).toContain(d);
    }
  });
});

describe('AI driving', () => {
  const city = generateCity(1337);
  const grid = new StaticGrid(city.obstacles);

  function makeCar(ix: number, iz: number, dir: Dir, seed: number) {
    const rand = random(seed);
    const s = spawnAi(ix, iz, dir, 0.3, rand)!;
    const car: VehicleState = { x: s.x, z: s.z, heading: s.heading, vx: 0, vz: 0, yawRate: 0 };
    return { car, ai: s.driver, rand };
  }

  it('drives a long route through the city without hitting buildings', () => {
    const { car, ai, rand } = makeCar(0, 0, 0, 7);
    let hits = 0;
    let intersections = 0;
    let lastNode = `${ai.ix},${ai.iz}`;
    for (let i = 0; i < 60 * 90; i++) {
      stepVehicle(car, driveAi(ai, car, [], rand, DT), SEDAN, DT);
      if (collideVehicleStatic(car, grid) > 1) hits++;
      const node = `${ai.ix},${ai.iz}`;
      if (node !== lastNode) intersections++;
      lastNode = node;
    }
    expect(hits).toBe(0);
    expect(intersections).toBeGreaterThan(8);
  });

  it('stays in its lane on a straight', () => {
    const { car, ai, rand } = makeCar(0, -2, 0, 1);
    ai.next = 0; // force straight on
    for (let i = 0; i < 60 * 4; i++) stepVehicle(car, driveAi(ai, car, [], rand, DT), SEDAN, DT);
    expect(car.x).toBeGreaterThan(2.5);
    expect(car.x).toBeLessThan(5.5);
  });

  it('stops behind a stationary obstacle', () => {
    const { car, ai, rand } = makeCar(0, -3, 0, 2);
    ai.next = 0;
    const blocker = { ...lanePoint(0, -3, 0, -20), halfWidth: 1 };
    for (let i = 0; i < 60 * 8; i++) stepVehicle(car, driveAi(ai, car, [blocker], rand, DT), SEDAN, DT);
    expect(speed(car)).toBeLessThan(0.5);
    const gap = clearDistance(car, [blocker]);
    expect(gap).toBeGreaterThan(0.5);
    expect(gap).toBeLessThan(6);
  });

  it('a queue of AI cars does not pile into each other', () => {
    const cars = [0, 1, 2, 3].map((k) => makeCar(0, -1, 0, 10 + k));
    // Line them up on the same lane, 10 m apart.
    cars.forEach((c, k) => {
      c.car.z = -30 + k * 10;
      c.ai.next = 0;
    });
    let maxImpact = 0;
    for (let i = 0; i < 60 * 20; i++) {
      for (const c of cars) {
        const obs = cars.filter((o) => o !== c).map((o) => ({ x: o.car.x, z: o.car.z, halfWidth: 1 }));
        stepVehicle(c.car, driveAi(c.ai, c.car, obs, c.rand, DT), SEDAN, DT);
        collideVehicleStatic(c.car, grid);
      }
      for (let a = 0; a < cars.length; a++)
        for (let b = a + 1; b < cars.length; b++) maxImpact = Math.max(maxImpact, collideVehicles(cars[a].car, cars[b].car));
    }
    expect(maxImpact).toBeLessThan(3);
  });
});
