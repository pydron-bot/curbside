import { describe, expect, it } from 'vitest';
import { VEHICLE_BODIES, VEHICLE_SPECS, createVehicleState, stepVehicle, type VehicleArchetype, type VehicleState } from '../src/entities/vehicle';
import { collideVehicles } from '../src/systems/physics';
import { createDriver, driveAi, vehicleObstacles, type Obstacle } from '../src/systems/traffic';
import {
  BOXED_GAP,
  BOXED_SECONDS,
  CUFF_SECONDS,
  DOUBLE_PARK_OFFSET,
  canPassAround,
  clearOf,
  crumple,
  escaped,
  fleeAxis,
  laneGapAhead,
  boxedIn,
  oncomingClear,
  pastBlocker,
  pickChaseKind,
  raceOdds,
  raceRoute,
  routeIndex,
  routeTurn,
  stepGrip,
} from '../src/systems/trafficScenes';
import { SMOKE_AT, FIRE_AT } from '../src/systems/damage';
import { DIR_VEC, MAX_NODE, dirHeading, lanePoint, type Dir } from '../src/world/roads';
import { random } from './helpers';

const DT = 1 / 60;
const car = (archetype: VehicleArchetype, x: number, z: number, heading: number): VehicleState => ({
  ...createVehicleState(x, z, heading),
  body: VEHICLE_BODIES[archetype],
});

describe('ambient police chases', () => {
  it('are mostly cars, then bikes, then people on foot', () => {
    expect(pickChaseKind(0.1)).toBe('car');
    expect(pickChaseKind(0.6)).toBe('bike');
    expect(pickChaseKind(0.9)).toBe('foot');
  });

  it('box a getaway in once it has stood still beside a police car', () => {
    expect(boxedIn(BOXED_SECONDS, 5)).toBe(true);
    expect(boxedIn(BOXED_SECONDS - 0.1, 5)).toBe(false);
    expect(boxedIn(BOXED_SECONDS + 3, BOXED_GAP + 1)).toBe(false);
  });

  it('cuff a suspect an officer holds close for long enough, and let go of a runner', () => {
    let grip = 0;
    for (let t = 0; t < CUFF_SECONDS + 0.1; t += DT) grip = stepGrip(grip, 1, 0.5, false, DT);
    expect(grip).toBeGreaterThan(CUFF_SECONDS);
    expect(stepGrip(grip, 1, 5, false, DT)).toBe(0);
    expect(stepGrip(grip, 1, 5, true, DT)).toBeGreaterThan(grip);
    expect(stepGrip(grip, 3, 0, true, DT)).toBe(0);
  });

  it('send a suspect on foot down the street, away from the cop', () => {
    const out = { x: 0, z: 0 };
    // On a north-south road (x = 64), the cop to the north: run south.
    expect(fleeAxis(66, 20, 66, 10, out)).toEqual({ x: 0, z: 1 });
    // On an east-west road (z = 0), the cop to the east: run west.
    expect(fleeAxis(30, 3, 40, 2, out)).toEqual({ x: -1, z: 0 });
  });

  it('end in an escape when the chase runs too long or gets lost far off', () => {
    expect(escaped(10, 100, false, 190)).toBe(false);
    expect(escaped(10, 200, true, 190)).toBe(false);
    expect(escaped(10, 200, false, 190)).toBe(true);
    expect(escaped(200, 10, true, 190)).toBe(true);
  });
});

describe('street races', () => {
  it('route through distinct junctions on the map, mostly straight on', () => {
    const rand = random(4);
    let straight = 0;
    let legs = 0;
    for (let i = 0; i < 50; i++) {
      const start = { ix: Math.floor(rand() * 9) - 4, iz: Math.floor(rand() * 9) - 4, dir: Math.floor(rand() * 4) as Dir };
      const route = raceRoute(start.ix, start.iz, start.dir, 6, rand);
      expect(route.length).toBeGreaterThanOrEqual(3);
      const seen = new Set([`${start.ix},${start.iz}`]);
      let prev = start;
      for (const n of route) {
        expect(Math.abs(n.ix) <= MAX_NODE && Math.abs(n.iz) <= MAX_NODE).toBe(true);
        // Each node is one block on from the last, the way it arrives.
        expect([n.ix - prev.ix, n.iz - prev.iz]).toEqual([DIR_VEC[n.dir].x, DIR_VEC[n.dir].z]);
        expect(seen.has(`${n.ix},${n.iz}`)).toBe(false);
        seen.add(`${n.ix},${n.iz}`);
        if (n.dir === prev.dir) straight++;
        legs++;
        prev = n;
      }
    }
    expect(straight / legs).toBeGreaterThan(0.5);
  });

  it('turn at each node the way the next one arrives, and find nodes on the route', () => {
    const route = raceRoute(0, 0, 1, 5, random(9));
    expect(routeTurn(route, 0)).toBe(route[1].dir);
    expect(routeTurn(route, route.length - 1)).toBeNull();
    expect(routeIndex(route, route[2].ix, route[2].iz)).toBe(2);
    expect(routeIndex(route, 99, 99)).toBe(-1);
  });

  it('run far more often at night', () => {
    expect(raceOdds(1)).toBe(1);
    expect(raceOdds(23)).toBe(1);
    expect(raceOdds(20)).toBeLessThan(1);
    expect(raceOdds(13)).toBeLessThan(raceOdds(20));
    expect(raceOdds(13, 2)).toBeCloseTo(raceOdds(13) * 2);
    expect(raceOdds(-1)).toBe(1);
  });
});

describe('accidents', () => {
  it('pair a car with the one just ahead of it in its lane', () => {
    const a = car('sedan', 0, 0, 0);
    expect(laneGapAhead(a, car('sedan', 0.4, 15, 0), 20)).toBeCloseTo(10.4);
    expect(laneGapAhead(a, car('sedan', 0, 40, 0), 20)).toBe(-1);
    expect(laneGapAhead(a, car('sedan', 0, -15, 0), 20)).toBe(-1); // behind
    expect(laneGapAhead(a, car('sedan', 8, 15, 0), 20)).toBe(-1); // the other lane
    expect(laneGapAhead(a, car('sedan', 0, 15, Math.PI), 20)).toBe(-1); // coming the other way
  });

  it('leave both cars smoking, never on fire', () => {
    for (const r of [0, 0.5, 0.999]) {
      expect(crumple(r)).toBeLessThan(SMOKE_AT);
      expect(crumple(r)).toBeGreaterThan(FIRE_AT);
    }
  });
});

describe('double-parked trucks', () => {
  it('keep clear of the places they must not stop at', () => {
    const keep = [{ x: 10, z: 10, r: 13 }];
    expect(clearOf(10, 24, keep)).toBe(true);
    expect(clearOf(10, 18, keep)).toBe(false);
  });

  it('let a queued driver round only with the oncoming lane clear', () => {
    // Heading east (dir 1) along z = 0: our lane at z = +4, the oncoming one at z = -4.
    const h = dirHeading(1);
    const truck = car('garbage_truck', 40, DOUBLE_PARK_OFFSET, h);
    const me = car('sedan', 30, 4, h);
    expect(canPassAround(me, truck, [truck, me], 2 * VEHICLE_BODIES.garbage_truck.reach)).toBe(true);
    // Someone coming the other way 40 m ahead, or parked on the far side.
    expect(oncomingClear(me, [car('sedan', 70, -4, -h)], 60)).toBe(false);
    expect(oncomingClear(me, [car('sedan', 50, -6.9, -h)], 60)).toBe(false);
    // Parked on our side, or well past: no matter.
    expect(oncomingClear(me, [car('sedan', 50, 6.9, h), car('sedan', 110, -4, -h)], 60)).toBe(true);
    // Still rolling, or too far back: not yet.
    expect(canPassAround({ ...me, vx: 8 }, truck, [], 9)).toBe(false);
    expect(canPassAround(car('sedan', 5, 4, h), truck, [], 9)).toBe(false);
    expect(pastBlocker(car('sedan', 52, -4, h), truck, 4.5, 3)).toBe(true);
    expect(pastBlocker(car('sedan', 44, -4, h), truck, 4.5, 3)).toBe(false);
  });

  it('a driver queued behind one pulls out round it without touching it, and back into its lane', () => {
    // Heading east toward node (2, 0): the truck mid-block, 34 m before the junction.
    const dir: Dir = 1;
    const h = dirHeading(dir);
    const at = lanePoint(2, 0, dir, -34);
    const truck = car('garbage_truck', at.x, at.z + (DOUBLE_PARK_OFFSET - 4), h);
    const start = lanePoint(2, 0, dir, -100);
    const me = car('sedan', start.x, start.z, h);
    me.vx = 10;
    const rand = random(3);
    const ai = createDriver(2, 0, dir, rand);
    ai.next = dir;
    const obstacles: Obstacle[] = [];
    const add = (x: number, z: number, halfWidth: number, player: boolean, owner: VehicleState) => obstacles.push({ x, z, halfWidth, player, owner });
    let waited = 0;
    let passing = false;
    let touched = 0;
    let passed = false;
    for (let t = 0; t < 30 && !passed; t += DT) {
      obstacles.length = 0;
      vehicleObstacles(truck, false, add);
      vehicleObstacles(me, false, add);
      if (!passing && canPassAround(me, truck, [truck, me], 2 * VEHICLE_BODIES.garbage_truck.reach)) passing = (waited += DT) > 1.5;
      if (passing) ai.overtaking = Math.max(ai.overtaking, 0.5);
      if (pastBlocker(me, truck, VEHICLE_BODIES.garbage_truck.reach, 3)) passed = true;
      const c = driveAi(ai, me, obstacles, rand, DT);
      stepVehicle(me, c, VEHICLE_SPECS.sedan, DT);
      if (collideVehicles(me, truck, undefined, 1, 4) > 0) touched++;
      truck.vx = truck.vz = 0;
    }
    expect(passing).toBe(true);
    expect(passed).toBe(true);
    expect(touched).toBe(0);
    // ...and back over into its own lane a little later.
    for (let t = 0; t < 2.5; t += DT) {
      obstacles.length = 0;
      vehicleObstacles(truck, false, add);
      stepVehicle(me, driveAi(ai, me, obstacles, rand, DT), VEHICLE_SPECS.sedan, DT);
    }
    expect(me.z).toBeGreaterThan(2);
  });
});
