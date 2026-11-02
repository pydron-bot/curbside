import { describe, expect, it } from 'vitest';
import { SEDAN, createVehicleState, speed, stepVehicle, type VehicleState } from '../src/entities/vehicle';
import { collideVehicleStatic } from '../src/systems/physics';
import { LOD_FAR, LOD_NEAR, SimLod, newSimClock, type LodTier } from '../src/systems/simLod';
import {
  JUNCTION_WATCH,
  clearDistance,
  driveAi,
  fullRateDriver,
  holdAi,
  nearJunction,
  spawnAi,
  type AiDriver,
  type Obstacle,
} from '../src/systems/traffic';
import { fullRatePed, spawnPed, stepCrowdPed } from '../src/systems/crowd';
import { generateCity } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { entryPoint, lanePoint, type Dir } from '../src/world/roads';
import type { Signal, SignalView } from '../src/world/signals';
import { random } from './helpers';

const DT = 1 / 60;
/** Everything off screen: the view is far away. */
const NOWHERE = { minX: 1e6, minZ: 1e6, maxX: 1e6 + 1, maxZ: 1e6 + 1 };

function makeCar(ix: number, iz: number, dir: Dir, seed: number) {
  const rand = random(seed);
  const s = spawnAi(ix, iz, dir, 0.3, rand)!;
  const car: VehicleState = { ...createVehicleState(), x: s.x, z: s.z, heading: s.heading, vx: 0, vz: 0, yawRate: 0 };
  return { car, ai: s.driver, rand };
}

/** One step of an off-screen driver as main.ts runs it: think on its tick, hold between. */
function lodDrive(lod: SimLod, clock: ReturnType<typeof newSimClock>, tier: LodTier, ai: AiDriver, car: VehicleState, obs: Obstacle[], rand: () => number, signals?: SignalView) {
  const t = tier === LOD_FAR && nearJunction(ai, car) ? LOD_NEAR : tier;
  let dt = lod.due(clock, t, DT, fullRateDriver(ai));
  if (dt === 0) {
    const held = holdAi(ai, car);
    if (held) return held;
    dt = lod.settle(clock);
  }
  return driveAi(ai, car, obs, rand, dt, signals);
}

describe('off-screen traffic (think on a tick, hold between)', () => {
  const city = generateCity(1337);
  const grid = new StaticGrid(city.obstacles);

  for (const tier of [LOD_NEAR, LOD_FAR] as const) {
    const hz = tier === LOD_NEAR ? 15 : 5;

    it(`at ${hz} Hz drives a long route without hitting buildings, as far as every step does`, () => {
      const full = makeCar(0, 0, 0, 7);
      const held = makeCar(0, 0, 0, 7);
      const lod = new SimLod();
      const clock = newSimClock();
      let hits = 0;
      let nodes = 0;
      let last = `${held.ai.ix},${held.ai.iz}`;
      let fullNodes = 0;
      let fullLast = `${full.ai.ix},${full.ai.iz}`;
      for (let i = 0; i < 60 * 90; i++) {
        lod.begin(0, 0, NOWHERE);
        stepVehicle(held.car, lodDrive(lod, clock, tier, held.ai, held.car, [], held.rand), SEDAN, DT);
        if (collideVehicleStatic(held.car, grid) > 1) hits++;
        stepVehicle(full.car, driveAi(full.ai, full.car, [], full.rand, DT), SEDAN, DT);
        collideVehicleStatic(full.car, grid);
        const k = `${held.ai.ix},${held.ai.iz}`;
        if (k !== last) nodes++;
        last = k;
        const f = `${full.ai.ix},${full.ai.iz}`;
        if (f !== fullLast) fullNodes++;
        fullLast = f;
      }
      expect(hits).toBe(0);
      expect(nodes).toBeGreaterThan(fullNodes * 0.85);
    });

    it(`at ${hz} Hz stops behind a stationary obstacle without touching it`, () => {
      const { car, ai, rand } = makeCar(0, -3, 0, 2);
      ai.next = 0;
      const blocker = { ...lanePoint(0, -3, 0, -20), halfWidth: 1 };
      const lod = new SimLod();
      const clock = newSimClock();
      let closest = Infinity;
      for (let i = 0; i < 60 * 8; i++) {
        lod.begin(0, 0, NOWHERE);
        stepVehicle(car, lodDrive(lod, clock, tier, ai, car, [blocker], rand), SEDAN, DT);
        closest = Math.min(closest, clearDistance(car, [blocker]));
      }
      expect(speed(car)).toBeLessThan(0.5);
      expect(closest).toBeGreaterThan(0.5);
      expect(clearDistance(car, [blocker])).toBeLessThan(6);
    });

    it(`at ${hz} Hz stops at a red light, short of the line`, () => {
      const { car, ai, rand } = makeCar(0, -3, 0, 3);
      ai.next = 0;
      const red: SignalView = { at: (): Signal => 'red' };
      const lod = new SimLod();
      const clock = newSimClock();
      const fullCar = makeCar(0, -3, 0, 3);
      fullCar.ai.next = 0;
      for (let i = 0; i < 60 * 10; i++) {
        lod.begin(0, 0, NOWHERE);
        stepVehicle(car, lodDrive(lod, clock, tier, ai, car, [], rand, red), SEDAN, DT);
        stepVehicle(fullCar.car, driveAi(fullCar.ai, fullCar.car, [], fullCar.rand, DT, red), SEDAN, DT);
      }
      expect(speed(car)).toBeLessThan(0.3);
      expect(ai.phase).toBe('approach');
      // Within a metre of where a driver thinking every step stops.
      const line = entryPoint(0, -3, 0);
      const d = Math.hypot(line.x - car.x, line.z - car.z);
      const dFull = Math.hypot(line.x - fullCar.car.x, line.z - fullCar.car.z);
      expect(Math.abs(d - dFull)).toBeLessThan(1);
    });
  }

  it('near a junction or crossing it counts as busy; mid-block does not', () => {
    const { car, ai } = makeCar(0, -3, 0, 5);
    const e = entryPoint(ai.ix, ai.iz, ai.dir);
    Object.assign(car, { x: e.x, z: e.z + JUNCTION_WATCH + 10 });
    expect(nearJunction(ai, car)).toBe(false);
    Object.assign(car, { x: e.x, z: e.z + JUNCTION_WATCH - 5 });
    expect(nearJunction(ai, car)).toBe(true);
    ai.phase = 'turning';
    Object.assign(car, { x: e.x, z: e.z + JUNCTION_WATCH + 10 });
    expect(nearJunction(ai, car)).toBe(true);
  });

  it('drivers worked up about the player, in a hurry or pulling over think every step', () => {
    const { ai } = makeCar(0, -3, 0, 6);
    expect(fullRateDriver(ai)).toBe(false);
    for (const set of [{ mood: 'panic' }, { mood: 'rage' }, { urgent: true }, { yielding: 0.5 }, { blockedByPlayer: 0.2 }] as const) {
      expect(fullRateDriver({ ...ai, ...set })).toBe(true);
    }
  });
});

describe('off-screen walkers', () => {
  it('cover the same ground on 15 Hz and 5 Hz ticks as every step', () => {
    for (const tier of [LOD_NEAR, LOD_FAR] as const) {
      const a = spawnPed(4, 4, 0, 0.2, random(9));
      const b = spawnPed(4, 4, 0, 0.2, random(9));
      const ra = random(11);
      const rb = random(11);
      const lod = new SimLod();
      const clock = newSimClock();
      let maxGap = 0;
      for (let i = 0; i < 60 * 30; i++) {
        lod.begin(0, 0, NOWHERE);
        stepCrowdPed(a, [], ra, DT);
        const dt = lod.due(clock, tier, DT, fullRatePed(b));
        if (dt > 0) stepCrowdPed(b, [], rb, dt);
        // Compared on b's ticks (between them b stands where it last was).
        if (dt > 0) maxGap = Math.max(maxGap, Math.hypot(a.s.x - b.s.x, a.s.z - b.s.z));
      }
      // Same corners, same pace: never more than a stride or two apart.
      expect(maxGap).toBeLessThan(1);
    }
  });

  it('officers, fighters, shooters, the hurt and other systems\' people always think every step', () => {
    const p = spawnPed(0, 0, 0, 0.5, random(1));
    p.street = true;
    expect(fullRatePed(p)).toBe(false);
    expect(fullRatePed({ ...p, street: false, scene: true })).toBe(false);
    expect(fullRatePed({ ...p, street: false })).toBe(true); // a gang member, a story character
    expect(fullRatePed({ ...p, role: 'cop' })).toBe(true);
    expect(fullRatePed({ ...p, mode: 'fight' })).toBe(true);
    expect(fullRatePed({ ...p, mode: 'shoot' })).toBe(true);
    expect(fullRatePed({ ...p, stagger: 0.2 })).toBe(true);
    expect(fullRatePed({ ...p, burning: 2 })).toBe(true);
  });
});
