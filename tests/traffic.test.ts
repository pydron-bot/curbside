import { describe, expect, it } from 'vitest';
import { SEDAN, speed, stepVehicle, type VehicleState } from '../src/entities/vehicle';
import { collideVehicleStatic, collideVehicles } from '../src/systems/physics';
import { clearDistance, driveAi, isHopeless, reactToHit, rerouteAi, scareDriver, shouldYield, spawnAi } from '../src/systems/traffic';
import { BLOCK_SIZE, generateCity } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';
import { MAX_NODE, chooseTurn, entryPoint, lanePoint, rightOf, type Dir } from '../src/world/roads';

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

describe('AI getting unstuck', () => {
  const city = generateCity(1337);
  const grid = new StaticGrid(city.obstacles);
  const nearObstacle = (x: number, z: number) =>
    city.obstacles.some((o) => x > o.minX - 1.5 && x < o.maxX + 1.5 && z > o.minZ - 1.5 && z < o.maxZ + 1.5);

  /** Drive for `seconds`; returns how many route steps (waypoints) were reached. */
  function drive(car: VehicleState, ai: NonNullable<ReturnType<typeof spawnAi>>['driver'], rand: () => number, seconds: number) {
    let changes = 0;
    let last = `${ai.ix},${ai.iz},${ai.phase}`;
    for (let i = 0; i < 60 * seconds; i++) {
      stepVehicle(car, driveAi(ai, car, [], rand, DT), SEDAN, DT);
      collideVehicleStatic(car, grid);
      const key = `${ai.ix},${ai.iz},${ai.phase}`;
      if (key !== last) changes++;
      last = key;
    }
    return changes;
  }

  it('backs out of a wall it has driven into', () => {
    const rand = random(4);
    // A wreck-sized wall across the lane ahead (not in the obstacle list, so no braking).
    const wall = new StaticGrid([{ minX: 0, minZ: -60, maxX: 8, maxZ: -58 }]);
    const s = spawnAi(0, -1, 0, 0.9, rand)!; // heading north (-Z) on x = +4
    s.driver.next = 0;
    const car: VehicleState = { x: s.x, z: -50, heading: s.heading, vx: 0, vz: 0, yawRate: 0 };
    let reversed = false;
    for (let i = 0; i < 60 * 4; i++) {
      const c = driveAi(s.driver, car, [], rand, DT);
      if (c.throttle < 0) reversed = true;
      stepVehicle(car, c, SEDAN, DT);
      collideVehicleStatic(car, wall);
    }
    expect(reversed).toBe(true);
  });

  it('cars knocked off the road find their way back (Monte Carlo over the city)', () => {
    const rand = random(7);
    let trials = 0;
    let stuck = 0;
    for (let n = 0; n < 4000 && trials < 200; n++) {
      const ix = Math.floor(rand() * 12) - 6;
      const iz = Math.floor(rand() * 12) - 6;
      const s = spawnAi(ix, iz, Math.floor(rand() * 4) as Dir, rand(), rand);
      if (!s) continue;
      // Shoved up to 12 m off the lane, facing anywhere.
      const x = s.x + (rand() * 2 - 1) * 12;
      const z = s.z + (rand() * 2 - 1) * 12;
      if (nearObstacle(x, z)) continue;
      const car: VehicleState = { x, z, heading: rand() * Math.PI * 2, vx: 0, vz: 0, yawRate: 0 };
      trials++;
      if (drive(car, s.driver, rand, 40) < 2) stuck++;
    }
    expect(trials).toBe(200);
    // Before unsticking/merging, about 1% never got anywhere; allow a stray alley.
    expect(stuck).toBeLessThanOrEqual(1);
  });

  it('re-routes from where it is when shoved far off its lane', () => {
    const rand = random(8);
    const s = spawnAi(0, -2, 0, 0.5, rand)!; // northbound on x = +4
    // Blasted onto the east-west road at z = -64, pointing east.
    const car: VehicleState = { x: 40, z: -BLOCK_SIZE + 4, heading: Math.PI / 2, vx: 0, vz: 0, yawRate: 0 };
    driveAi(s.driver, car, [], rand, DT);
    expect(s.driver.dir).toBe(1); // now heading east along the road it's on
    const entry = entryPoint(s.driver.ix, s.driver.iz, s.driver.dir);
    expect(entry.x).toBeGreaterThan(car.x); // toward an intersection ahead, not behind
    expect(Math.abs(entry.z - car.z)).toBeLessThan(6);
    expect(drive(car, s.driver, rand, 20)).toBeGreaterThanOrEqual(2);
  });

  it('turns round at the edge of the map when re-routed', () => {
    const rand = random(9);
    const s = spawnAi(0, 0, 0, 0.5, rand)!;
    const car: VehicleState = { x: MAX_NODE * BLOCK_SIZE - 30, z: 4, heading: Math.PI / 2, vx: 0, vz: 0, yawRate: 0 };
    rerouteAi(s.driver, car, rand);
    expect(Math.abs(s.driver.ix)).toBeLessThanOrEqual(MAX_NODE);
    expect(Math.abs(s.driver.iz)).toBeLessThanOrEqual(MAX_NODE);
  });

  it('flags a car wedged for good as hopeless, but not one queueing in traffic', () => {
    const rand = random(10);
    const s = spawnAi(0, -1, 0, 0.9, rand)!;
    s.driver.next = 0;
    const box = new StaticGrid([
      { minX: -2, minZ: -60, maxX: 10, maxZ: -58 },
      { minX: -2, minZ: -40, maxX: 10, maxZ: -38 },
      { minX: -2, minZ: -60, maxX: 0, maxZ: -38 },
      { minX: 8, minZ: -60, maxX: 10, maxZ: -38 },
    ]);
    const car: VehicleState = { x: 4, z: -49, heading: s.heading, vx: 0, vz: 0, yawRate: 0 };
    for (let i = 0; i < 60 * 20; i++) {
      stepVehicle(car, driveAi(s.driver, car, [], rand, DT), SEDAN, DT);
      collideVehicleStatic(car, box);
    }
    expect(isHopeless(s.driver)).toBe(true);

    const q = spawnAi(0, -3, 0, 0.3, rand)!;
    q.driver.next = 0;
    const queued: VehicleState = { x: q.x, z: q.z, heading: q.heading, vx: 0, vz: 0, yawRate: 0 };
    const blocker = { ...lanePoint(0, -3, 0, -20), halfWidth: 1 };
    for (let i = 0; i < 60 * 20; i++) {
      stepVehicle(queued, driveAi(q.driver, queued, [blocker], rand, DT), SEDAN, DT);
      collideVehicleStatic(queued, grid);
    }
    expect(isHopeless(q.driver)).toBe(false);
  });
});

describe('traffic reactions', () => {
  function onRoad(seed = 1) {
    const rand = random(seed);
    const s = spawnAi(0, -2, 0, 0.3, rand)!;
    const car: VehicleState = { x: s.x, z: s.z, heading: s.heading, vx: 0, vz: 0, yawRate: 0 };
    return { car, ai: s.driver, rand };
  }

  it('honks at the player blocking its lane, but not at a car queueing ahead', () => {
    for (const player of [true, false]) {
      const { car, ai, rand } = onRoad(3);
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const blocker = { x: car.x + fx * 6, z: car.z + fz * 6, halfWidth: 0.4, player };
      let honks = 0;
      for (let i = 0; i < 60 * 5; i++) {
        stepVehicle(car, driveAi(ai, car, [blocker], rand, DT), SEDAN, DT);
        if (ai.honk > 0) {
          honks++;
          ai.honk = 0;
        }
      }
      expect(honks > 0).toBe(player);
    }
  });

  it('panicking drivers go much faster than cruising ones', () => {
    const calm = onRoad(4);
    const scared = onRoad(4);
    scareDriver(scared.ai, 10);
    let top = [0, 0];
    for (let i = 0; i < 60 * 5; i++) {
      stepVehicle(calm.car, driveAi(calm.ai, calm.car, [], calm.rand, DT), SEDAN, DT);
      stepVehicle(scared.car, driveAi(scared.ai, scared.car, [], scared.rand, DT), SEDAN, DT);
      top = [Math.max(top[0], speed(calm.car)), Math.max(top[1], speed(scared.car))];
    }
    expect(top[1]).toBeGreaterThan(top[0] * 1.4);
    expect(scared.ai.mood).toBe('panic');
  });

  it('pulls over to the kerb and slows for a siren coming up behind', () => {
    const { car, ai, rand } = onRoad(5);
    for (let i = 0; i < 60 * 1.5; i++) stepVehicle(car, driveAi(ai, car, [], rand, DT), SEDAN, DT);
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const siren = { x: car.x - fx * 20, z: car.z - fz * 20, heading: car.heading, vx: 0, vz: 0, yawRate: 0 };
    expect(shouldYield(car, siren)).toBe(true);
    // Head-on, close: yes. Behind but on a crossing road: no.
    expect(shouldYield(car, { ...siren, x: car.x + fx * 20, z: car.z + fz * 20, heading: car.heading + Math.PI })).toBe(true);
    expect(shouldYield(car, { ...siren, heading: car.heading + Math.PI / 2 })).toBe(false);
    const laneX = car.x;
    for (let i = 0; i < 60 * 1.5; i++) {
      ai.yielding = 1;
      stepVehicle(car, driveAi(ai, car, [], rand, DT), SEDAN, DT);
    }
    expect(speed(car)).toBeLessThan(4);
    // Heading north (-Z), the kerb side is +X.
    expect(car.x - laneX).toBeGreaterThan(0.8);
  });

  it('reacts to a hard hit: panic, rage or bail, about 55/25/20', () => {
    const rand = random(8);
    const tally = { panic: 0, rage: 0, bail: 0 };
    for (let i = 0; i < 1000; i++) tally[reactToHit(onRoad(1).ai, rand)]++;
    expect(tally.panic).toBeGreaterThan(500);
    expect(tally.panic).toBeLessThan(600);
    expect(tally.rage).toBeGreaterThan(200);
    expect(tally.rage).toBeLessThan(300);
    expect(tally.bail).toBeGreaterThan(150);
    expect(tally.bail).toBeLessThan(250);
  });
});
