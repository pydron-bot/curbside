import { describe, expect, it } from 'vitest';
import { VEHICLE_SPECS, createVehicleState, speed, stepVehicle, type VehicleState } from '../src/entities/vehicle';
import { collideVehicleStatic, collideVehicles } from '../src/systems/physics';
import {
  MAX_LEAD,
  ROUTE_DISTANCE,
  alongside,
  choosePursuitMode,
  createPursuit,
  drivePursuit,
  interceptPoint,
  leadTime,
  routeToward,
  type PursuitTarget,
} from '../src/systems/pursuit';
import { createDriver, rerouteAi } from '../src/systems/traffic';
import { BLOCK_SIZE, generateCity } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { LANE_OFFSET } from '../src/world/roads';
import { random } from './helpers';

const DT = 1 / 60;
const POLICE = VEHICLE_SPECS.police;
const city = generateCity(1337);
const grid = new StaticGrid(city.obstacles);

function target(over: Partial<PursuitTarget> = {}): PursuitTarget {
  return { x: 0, z: 0, vx: 0, vz: 0, heading: 0, inCar: true, seen: true, known: true, ...over };
}

function pursuer(x: number, z: number, heading: number, aggression = 0, seed = 1) {
  const rand = random(seed);
  const car = createVehicleState(x, z, heading);
  const road = createDriver(0, 0, 0, rand);
  rerouteAi(road, car, rand);
  const d = createPursuit(road, aggression, 22, 36);
  return { car, d, rand };
}

/** Keep `t` describing a car (sets position, velocity, heading from its state). */
function track(t: PursuitTarget, s: VehicleState) {
  t.x = s.x;
  t.z = s.z;
  t.vx = s.vx;
  t.vz = s.vz;
  t.heading = s.heading;
}

describe('pursuit maths', () => {
  it('leads by the time to close the gap, clamped', () => {
    expect(leadTime(0, 20)).toBe(0);
    expect(leadTime(10, 20)).toBeCloseTo(0.5);
    expect(leadTime(500, 20)).toBe(MAX_LEAD);
    // Not closing at all: the full lead.
    expect(leadTime(30, 0)).toBe(MAX_LEAD);
  });

  it('aims ahead of a moving target, at a parked one directly', () => {
    const car = createVehicleState(0, 40, Math.PI);
    const out = { x: 0, z: 0 };
    interceptPoint(car, target({ x: 0, z: 0 }), out);
    expect(out).toEqual({ x: 0, z: 0 });
    // Crossing left to right at 20 m/s, 40 m away: aim well to the right of it.
    interceptPoint(car, target({ x: 0, z: 0, vx: 20 }), out);
    expect(out.x).toBeGreaterThan(15);
    expect(out.z).toBe(0);
  });

  it('routes toward the goal at each junction, turning off when it lies behind', () => {
    // At (0,0) heading north (-Z); goal 3 blocks east: turn right (east).
    expect(routeToward(0, 0, 0, 3 * BLOCK_SIZE, 0)).toBe(1);
    // Goal ahead (north): straight on.
    expect(routeToward(0, 0, 0, 0, -4 * BLOCK_SIZE)).toBe(0);
    // Goal straight behind: not straight on (that leads away); a turn starts the loop back.
    expect([1, 3]).toContain(routeToward(0, 0, 0, 0, 3 * BLOCK_SIZE));
    // At the north-east corner heading north, the goal north-east: only west is possible... or a U-turn.
    expect([2, 3]).toContain(routeToward(8, -8, 0, 600, -600));
  });

  it('knows when it is alongside a car', () => {
    const t = target({ x: 0, z: 0, heading: 0, vz: 20 });
    expect(alongside(createVehicleState(2.5, -1, 0), t)).toBe(true);
    expect(alongside(createVehicleState(2.5, -10, 0), t)).toBe(false); // well behind
    expect(alongside(createVehicleState(0.3, -4, 0), t)).toBe(false); // straight behind
    expect(alongside(createVehicleState(2.5, -1, Math.PI), t)).toBe(false); // oncoming
  });

  it('picks its mode from distance, sight, speed and aggression', () => {
    const { car, d } = pursuer(0, 30, Math.PI);
    const near = target({ x: 0, z: 0, vz: -20, heading: Math.PI });
    expect(choosePursuitMode(d, car, { ...near, seen: false }, 30)).toBe('route');
    expect(choosePursuitMode(d, car, near, ROUTE_DISTANCE + 1)).toBe('route');
    expect(choosePursuitMode(d, car, near, 30)).toBe('chase');
    expect(choosePursuitMode(d, car, near, 10)).toBe('chase'); // not aggressive: no ramming
    expect(choosePursuitMode(d, car, { ...near, vz: 0 }, 20)).toBe('box');
    expect(choosePursuitMode(d, car, { ...near, inCar: false, vz: -5 }, 20)).toBe('box');
    d.aggression = 1;
    expect(choosePursuitMode(d, car, near, 10)).toBe('ram');
    d.ramCooldown = 1;
    expect(choosePursuitMode(d, car, near, 10)).toBe('chase');
    d.ramCooldown = 0;
    const side = createVehicleState(2.5, 1, Math.PI);
    expect(choosePursuitMode(d, side, near, 2.7)).toBe('pit');
  });
});

describe('pursuit driving (real physics and city)', () => {
  /** A quarry driving straight north along the x = 0 road at `v` m/s. */
  function quarry(v: number, z0 = -40) {
    const s = createVehicleState(LANE_OFFSET, z0, Math.PI);
    s.vz = -v;
    return s;
  }
  function cruise(s: VehicleState, v: number) {
    // Hold speed and line (no AI needed: it's a straight road).
    s.vx = 0;
    s.vz = -v;
    s.heading = Math.PI;
    s.x += s.vx * DT;
    s.z += s.vz * DT;
  }

  it('closes on a car fleeing at 22 m/s and settles behind it without overshooting', () => {
    const q = quarry(22, -40);
    // Arrives on the scene already moving (as spawned units do).
    const { car, d, rand } = pursuer(LANE_OFFSET, 20, Math.PI);
    car.vz = -16;
    const t = target();
    let closest = Infinity;
    let passed = false;
    for (let i = 0; i < 60 * 12; i++) {
      cruise(q, 22);
      track(t, q);
      stepVehicle(car, drivePursuit(d, car, t, [], rand, DT), POLICE, DT);
      collideVehicleStatic(car, grid);
      const gap = Math.hypot(q.x - car.x, q.z - car.z);
      closest = Math.min(closest, gap);
      if (car.z < q.z - 2) passed = true;
    }
    expect(closest).toBeLessThan(14);
    expect(passed).toBe(false);
    expect(Math.hypot(q.x - car.x, q.z - car.z)).toBeLessThan(20);
  });

  it('an aggressive pursuer rams from behind: firm contact, not a wrecking blow', () => {
    const q = quarry(18, -25);
    const { car, d, rand } = pursuer(LANE_OFFSET, 0, Math.PI, 1);
    const t = target();
    let hardest = 0;
    let hits = 0;
    for (let i = 0; i < 60 * 8; i++) {
      stepVehicle(car, drivePursuit(d, car, t, [], rand, DT), POLICE, DT);
      cruise(q, 18);
      track(t, q);
      // Let the collision shove the quarry, then put it back on its line.
      const qs = { ...q };
      const impact = collideVehicles(car, qs);
      if (impact > 1) hits++;
      hardest = Math.max(hardest, impact);
    }
    expect(hits).toBeGreaterThan(0);
    expect(hardest).toBeGreaterThan(2);
    expect(hardest).toBeLessThan(10);
  });

  it('never rams a car coming the other way', () => {
    // Head-on on the same road: the quarry heads south in its lane, the pursuer north in the other.
    const q = createVehicleState(-LANE_OFFSET, -40, 0);
    q.vz = 20;
    const { car, d, rand } = pursuer(LANE_OFFSET, 0, Math.PI, 1);
    car.vz = -15;
    const t = target();
    let hardest = 0;
    for (let i = 0; i < 60 * 3; i++) {
      stepVehicle(car, drivePursuit(d, car, t, [], rand, DT), POLICE, DT);
      q.z += q.vz * DT;
      track(t, q);
      t.heading = 0;
      // Only once it has turned round to follow them.
      if (d.mode === 'ram') expect(Math.cos(car.heading - t.heading)).toBeGreaterThan(-0.3);
      hardest = Math.max(hardest, collideVehicles(car, { ...q }));
    }
    expect(hardest).toBeLessThan(4);
  });

  it('boxes in a stopped car: pulls up close and stops', () => {
    const q = createVehicleState(LANE_OFFSET, -60, Math.PI);
    const { car, d, rand } = pursuer(LANE_OFFSET, 0, Math.PI);
    const t = target();
    track(t, q);
    for (let i = 0; i < 60 * 10; i++) {
      stepVehicle(car, drivePursuit(d, car, t, [], rand, DT), POLICE, DT);
      stepVehicle(q, { throttle: 0, steer: 0, handbrake: true }, VEHICLE_SPECS.sedan, DT);
      collideVehicleStatic(car, grid);
      collideVehicles(car, q);
      track(t, q);
    }
    expect(d.mode).toBe('box');
    expect(speed(car)).toBeLessThan(1.5);
    expect(Math.hypot(q.x - car.x, q.z - car.z)).toBeLessThan(10);
  });

  it('stops short of a suspect on foot so the officers can get out', () => {
    const { car, d, rand } = pursuer(LANE_OFFSET, 0, Math.PI);
    const t = target({ x: LANE_OFFSET + 6, z: -50, inCar: false });
    for (let i = 0; i < 60 * 10; i++) {
      stepVehicle(car, drivePursuit(d, car, t, [], rand, DT), POLICE, DT);
      collideVehicleStatic(car, grid);
    }
    const gap = Math.hypot(t.x - car.x, t.z - car.z);
    expect(speed(car)).toBeLessThan(1.5);
    expect(gap).toBeGreaterThan(3);
    expect(gap).toBeLessThan(14);
  });

  it('follows the roads to a far, unseen goal without getting stuck', () => {
    const rand = random(5);
    let arrived = 0;
    const trials = 6;
    for (let k = 0; k < trials; k++) {
      // Start somewhere on a road, goal 4–6 blocks away.
      const sx = (Math.floor(rand() * 8) - 4) * BLOCK_SIZE + LANE_OFFSET;
      const sz = (Math.floor(rand() * 8) - 4) * BLOCK_SIZE + 20;
      const { car, d } = pursuer(sx, sz, Math.PI, 0, 10 + k);
      const gx = sx + (rand() < 0.5 ? -1 : 1) * 4 * BLOCK_SIZE;
      const gz = sz + (rand() < 0.5 ? -1 : 1) * 2 * BLOCK_SIZE;
      const t = target({ x: gx, z: gz, seen: false, known: false });
      for (let i = 0; i < 60 * 90; i++) {
        stepVehicle(car, drivePursuit(d, car, t, [], rand, DT), POLICE, DT);
        collideVehicleStatic(car, grid);
        if (Math.hypot(gx - car.x, gz - car.z) < 40) {
          arrived++;
          break;
        }
      }
    }
    expect(arrived).toBe(trials);
  });

  it('backs out of a wall it has driven into during a chase', () => {
    // Nose into a building, quarry on the other side of it.
    const b = city.buildings.find((r) => r.maxX - r.minX > 10 && r.maxZ - r.minZ > 10)!;
    const car = createVehicleState(b.minX - 1.6, (b.minZ + b.maxZ) / 2, Math.PI / 2);
    const rand = random(2);
    const road = createDriver(0, 0, 0, rand);
    const d = createPursuit(road, 0, 22, 36);
    const t = target({ x: b.maxX + 20, z: (b.minZ + b.maxZ) / 2, inCar: true, vx: 0.1 });
    let reversed = false;
    for (let i = 0; i < 60 * 4; i++) {
      const c = drivePursuit(d, car, t, [], rand, DT);
      if (c.throttle < 0) reversed = true;
      stepVehicle(car, c, POLICE, DT);
      collideVehicleStatic(car, grid);
    }
    expect(reversed).toBe(true);
    expect(car.x).toBeLessThan(b.minX - 2);
  });
});
