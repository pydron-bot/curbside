import { describe, expect, it } from 'vitest';
import { SEDAN, createVehicleState, forwardSpeed, stepVehicle, type VehicleState } from '../src/entities/vehicle';
import type { CrowdPed, Vehicle } from '../src/game/population';
import { createDamage } from '../src/systems/damage';
import { spawnPed, stepCrowdPed, type PedAgent } from '../src/systems/crowd';
import { PoliceForce, type PoliceContext, type Suspect } from '../src/systems/police';
import { GRENADE_FUSE, Projectiles, type ProjectileWorld } from '../src/systems/projectiles';
import { createPursuit, routeToward } from '../src/systems/pursuit';
import { sees } from '../src/systems/sight';
import {
  MAX_CLOUDS,
  SMOKE_FADE,
  SMOKE_FUSE,
  SMOKE_LINGER,
  SMOKE_NEAR,
  SMOKE_POUR,
  SMOKE_RADIUS,
  SMOKE_START_RADIUS,
  SMOKE_THICK,
  SmokeClouds,
  WRONG_TURN_MAX,
  brakeInSmoke,
  cloudRadius,
  cough,
  createDaze,
  driveDazed,
  pickConfusion,
  stepDaze,
  wrongWay,
} from '../src/systems/smoke';
import { driveAi, driverFor, spawnAi } from '../src/systems/traffic';
import { generateCity } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const DT = 1 / 60;
const open = new StaticGrid([]);

/** A cloud at (0, 0), `age` s old. */
function cloudAt(age: number): SmokeClouds {
  const s = new SmokeClouds();
  s.add(0, 0, true);
  s.step(age);
  return s;
}

function walker(x: number, z: number): PedAgent {
  const a = spawnPed(0, 0, 0, 0, random(2));
  Object.assign(a.s, { x, z, vx: 0, vz: 0 });
  a.temper = 'calm';
  a.mode = 'walk';
  return a;
}

describe('smoke: the cloud', () => {
  it('billows out over SMOKE_POUR, is thick for SMOKE_THICK, then thins away over SMOKE_FADE', () => {
    expect(cloudRadius(0)).toBeCloseTo(SMOKE_START_RADIUS);
    expect(cloudRadius(SMOKE_POUR / 2)).toBeGreaterThan((SMOKE_START_RADIUS + SMOKE_RADIUS) / 2);
    expect(cloudRadius(SMOKE_POUR)).toBe(SMOKE_RADIUS);
    // About 8-10 s of thick smoke, as the plan asks.
    expect(SMOKE_THICK).toBeGreaterThanOrEqual(8);
    expect(SMOKE_THICK).toBeLessThanOrEqual(10);
    const s = cloudAt(0);
    expect(s.hides(SMOKE_START_RADIUS - 0.5, 0)).toBe(true);
    expect(s.hides(SMOKE_RADIUS - 0.5, 0)).toBe(false);
    s.step(SMOKE_POUR);
    expect(s.hides(SMOKE_RADIUS - 0.5, 0)).toBe(true);
    expect(s.hides(SMOKE_RADIUS + 0.5, 0)).toBe(false);
    s.step(SMOKE_THICK - SMOKE_POUR - 0.1);
    expect(s.thick).toBe(true);
    s.step(0.2);
    // Thinning: still there to see, hides nothing.
    expect(s.thick).toBe(false);
    expect(s.active).toBe(true);
    expect(s.hides(0, 0)).toBe(false);
    expect(s.blocks(-20, 0, 20, 0)).toBe(false);
    s.step(SMOKE_FADE);
    expect(s.active).toBe(false);
  });

  it(`at most ${MAX_CLOUDS} at once: another replaces the oldest`, () => {
    const s = new SmokeClouds();
    s.add(0, 0, true);
    s.step(3);
    s.add(100, 0, true);
    s.step(1);
    s.add(200, 0, true);
    expect(s.list.filter((c) => c.alive)).toHaveLength(MAX_CLOUDS);
    expect(s.hides(0, 0)).toBe(false);
    expect(s.hides(100, 0)).toBe(true);
    expect(s.hides(200, 0)).toBe(true);
    s.clear();
    expect(s.active).toBe(false);
  });

  it('a thrown canister flies like a grenade and pours at the end of its fuse instead of going off', () => {
    const p = new Projectiles();
    const poured: Array<[number, number]> = [];
    let booms = 0;
    const world: ProjectileWorld = {
      grid: open,
      rocketHits: () => false,
      bottleHits: () => false,
      explode: () => booms++,
      lay: () => {},
      ignite: () => {},
      smoke: (x, z) => poured.push([x, z]),
    };
    p.throw('smoke', 0, 0, 0, 12, true);
    expect(SMOKE_FUSE).toBeLessThan(GRENADE_FUSE);
    for (let t = 0; t < SMOKE_FUSE - 0.05; t += DT) p.step(DT, world);
    expect(poured).toHaveLength(0);
    for (let t = 0; t < 0.1; t += DT) p.step(DT, world);
    expect(poured).toHaveLength(1);
    expect(booms).toBe(0);
    expect(p.active).toBe(false);
    // Near where it was aimed (rolled a little).
    expect(Math.hypot(poured[0][0], poured[0][1] - 12)).toBeLessThan(2);
  });
});

describe('smoke: sight', () => {
  it('nobody sees into, out of or through it, bar arm’s length; around it is clear', () => {
    const s = cloudAt(SMOKE_POUR);
    // Through it, across the road.
    expect(sees(open, -20, 0, 20, 0, 30, 60)).toBe(true);
    expect(sees(open, -20, 0, 20, 0, 30, 60, s)).toBe(false);
    // Into it (the target inside), and out of it (the watcher inside), even within `near`.
    expect(sees(open, -10, 0, 0, 0, 30, 60, s)).toBe(false);
    expect(sees(open, 0, 0, 10, 0, 30, 60, s)).toBe(false);
    // Bumping into each other in it.
    expect(sees(open, 0, 0, SMOKE_NEAR - 0.5, 0, 30, 60, s)).toBe(true);
    // A line that passes it by.
    expect(sees(open, -20, SMOKE_RADIUS + 1, 20, SMOKE_RADIUS + 1, 30, 60, s)).toBe(true);
  });

  it('no effect once it thins', () => {
    const s = cloudAt(SMOKE_THICK + 0.05);
    expect(s.active).toBe(true);
    expect(sees(open, -20, 0, 20, 0, 30, 60, s)).toBe(true);
    expect(sees(open, -10, 0, 0, 0, 30, 60, s)).toBe(true);
  });
});

/** A police force with one unit parked at (x, z), its car only (no officers out). */
function force() {
  const depot = {
    takeVehicle: (archetype: Vehicle['archetype'], paint: string): Vehicle => {
      const sim = createVehicleState();
      return { archetype, paint, sim, prev: { ...sim }, mesh: { siren: false }, ai: null, damage: createDamage(), wreckAge: 0, charred: false } as unknown as Vehicle;
    },
    retireVehicle: () => {},
    addPed: (agent: CrowdPed['agent']) => ({ agent, prev: { ...agent.s } }) as unknown as CrowdPed,
    removePed: () => {},
  };
  return new PoliceForce(depot, () => {});
}

function suspectAt(x: number, z: number): Suspect {
  return { x, z, vx: 0, vz: 0, heading: 0, inCar: true, armed: false, down: false, car: null, active: true };
}

describe('smoke: the police', () => {
  const city = generateCity(1337);
  const grid = new StaticGrid(city.obstacles);

  it('a unit looking through the cloud loses you (and drops into search); once it thins it sees you again', () => {
    const smoke = new SmokeClouds();
    const police = force();
    // Down the open x = 0 road: the unit at z = 0, the player 30 m on, the smoke between.
    const suspect = suspectAt(0, 30);
    const ctx: PoliceContext = { stars: 1, tracked: false, suspect, view: { minX: 1000, maxX: 1100, minZ: 1000, maxZ: 1100 }, grid, rand: random(3), smoke };
    const rand = random(4);
    const u = police.adopt(
      (() => {
        const v = { archetype: 'police', paint: '#fff', sim: createVehicleState(0, 0, 0), mesh: { siren: false }, damage: createDamage(), wreckAge: 0, charred: false } as unknown as Vehicle;
        v.prev = { ...v.sim };
        v.ai = driverFor(v.sim, rand);
        return v;
      })(),
      2,
      1,
    )!;
    expect(u).not.toBeNull();
    police.step(0.3, ctx);
    expect(u.seesPlayer).toBe(true);
    expect(police.seen).toBe(true);
    smoke.add(0, 15, true);
    smoke.step(SMOKE_POUR);
    police.step(0.3, ctx);
    expect(u.seesPlayer).toBe(false);
    expect(u.direct).toBe(false);
    expect(police.seen).toBe(false);
    // Not tracked: the radio's picture goes stale, the cars route to the last sighting.
    expect(police.target.known).toBe(false);
    smoke.step(SMOKE_THICK);
    police.step(0.3, ctx);
    expect(u.seesPlayer).toBe(true);
  });

  it("the helicopter's spotlight can't find you inside it", () => {
    const smoke = new SmokeClouds();
    const police = force();
    const suspect = suspectAt(0, 0);
    const ctx: PoliceContext = { stars: 5, tracked: true, suspect, view: { minX: -30, maxX: 30, minZ: -14, maxZ: 14 }, grid, rand: random(3), smoke };
    // Long enough for it to arrive and settle the light on a still target.
    let lit = false;
    for (let t = 0; t < 40 && !lit; t += DT) {
      police.step(DT, ctx);
      lit = police.heli.sees;
    }
    expect(lit).toBe(true);
    smoke.add(0, 0, true);
    smoke.step(SMOKE_POUR);
    for (let t = 0; t < 1; t += DT) {
      police.step(DT, ctx);
      smoke.step(DT);
      expect(police.heli.sees).toBe(false);
    }
  });

  it('cars driving into it are confused: a third crawl, a third stop with hazards, a third take a wrong turn', () => {
    const rand = random(9);
    const n = 3000;
    const count = { crawl: 0, hazards: 0, wrongTurn: 0 };
    for (let i = 0; i < n; i++) count[pickConfusion(rand)]++;
    for (const k of ['crawl', 'hazards', 'wrongTurn'] as const) {
      expect(count[k] / n).toBeGreaterThan(0.29);
      expect(count[k] / n).toBeLessThan(0.38);
    }
    // And a squad driving in scatters: not all the same.
    const car = createVehicleState(0, 0, 0);
    const picks = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const z = createDaze();
      stepDaze(z, true, createPursuit(driverFor(car, rand), 1, 20, 30), car, rand, DT);
      picks.add(z.confused);
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('a crawl eases to a stop, hazards stop dead; both get going SMOKE_LINGER after it’s clear', () => {
    const rand = random(2);
    const stop = (confused: 'crawl' | 'hazards') => {
      const car = createVehicleState(0, 0, 0);
      car.vz = 15;
      const d = createPursuit(driverFor(car, rand), 1, 20, 30);
      const z = createDaze();
      z.confused = confused;
      z.left = SMOKE_LINGER;
      const first = driveDazed(z, d, car, { x: 0, z: 100, vx: 0, vz: 0, heading: 0, inCar: true, seen: false, known: false }, [], rand, DT).throttle;
      let t = 0;
      for (; t < 20 && forwardSpeed(car) > 0.6; t += DT) {
        stepVehicle(car, driveDazed(z, d, car, { x: 0, z: 100, vx: 0, vz: 0, heading: 0, inCar: true, seen: false, known: false }, [], rand, DT), SEDAN, DT);
        stepDaze(z, true, d, car, rand, DT);
      }
      return { first, t, z, d, car };
    };
    const crawl = stop('crawl');
    const hazards = stop('hazards');
    expect(hazards.first).toBe(-1);
    expect(crawl.first).toBeGreaterThan(-1);
    expect(crawl.first).toBeLessThan(0);
    expect(hazards.t).toBeLessThan(crawl.t);
    // Still in it: still stopped.
    for (const s of [crawl, hazards]) {
      stepDaze(s.z, true, s.d, s.car, rand, 5);
      expect(s.z.confused).not.toBe('none');
      stepDaze(s.z, false, s.d, s.car, rand, SMOKE_LINGER - 0.1);
      expect(s.z.confused).not.toBe('none');
      stepDaze(s.z, false, s.d, s.car, rand, 0.2);
      expect(s.z.confused).toBe('none');
    }
  });

  it('a wrong turn goes any way but the way to you, and is over once taken', () => {
    const rand = random(5);
    for (let i = 0; i < 200; i++) {
      const ix = Math.floor(rand() * 9) - 4;
      const iz = Math.floor(rand() * 9) - 4;
      const dir = Math.floor(rand() * 4) as 0 | 1 | 2 | 3;
      const tx = (rand() - 0.5) * 600;
      const tz = (rand() - 0.5) * 600;
      expect(wrongWay(ix, iz, dir, tx, tz, rand)).not.toBe(routeToward(ix, iz, dir, tx, tz));
    }
    // Drive one through: heading north (-Z) from (0, 2) with the player straight ahead to the north.
    const s = spawnAi(0, 0, 0, 0.3, rand)!;
    const car: VehicleState = { ...createVehicleState(), x: s.x, z: s.z, heading: s.heading };
    const d = createPursuit(s.driver, 1, 20, 30);
    const z = createDaze();
    const target = { x: s.x, z: -300, vx: 0, vz: 0, heading: 0, inCar: true, seen: false, known: true };
    const thirds = [0.9]; // a wrong turn
    stepDaze(z, true, d, car, () => thirds.pop() ?? rand(), DT);
    expect(z.confused).toBe('wrongTurn');
    expect(z.left).toBe(WRONG_TURN_MAX);
    const right = routeToward(d.road.ix, d.road.iz, d.road.dir, target.x, target.z);
    let took = -1;
    for (let t = 0; t < WRONG_TURN_MAX && z.confused !== 'none'; t += DT) {
      stepVehicle(car, driveDazed(z, d, car, target, [], rand, DT), SEDAN, DT);
      stepDaze(z, false, d, car, rand, DT);
      if ((z.confused as string) === 'none') took = d.road.dir;
    }
    expect(took).toBeGreaterThanOrEqual(0);
    expect(took).not.toBe(right);
  });
});

describe('smoke: people and drivers', () => {
  it('people cough and walk (not run) out of it, then go back to their walk', () => {
    const a = walker(2, 0);
    expect(cough(a, 0, 0)).toBe(true);
    expect(cough(a, 0, 0)).toBe(false); // already coughing: no second cough sound
    expect(a.mode).toBe('flee');
    expect(a.fleeX).toBeCloseTo(1);
    const rand = random(3);
    for (let t = 0; t < 0.5; t += DT) stepCrowdPed(a, [], rand, DT);
    const pace = Math.hypot(a.s.vx, a.s.vz);
    expect(pace).toBeGreaterThan(1);
    expect(pace).toBeLessThan(3);
    expect(a.s.x).toBeGreaterThan(2);
    for (let t = 0; t < SMOKE_LINGER; t += DT) stepCrowdPed(a, [], rand, DT);
    expect(a.cough).toBe(0);
    expect(a.mode).toBe('walk');
  });

  it('officers stop and cough: no running, no shooting', () => {
    const cop = walker(0, 0);
    cop.role = 'cop';
    cop.mode = 'shoot';
    cop.timer = 5;
    const target = { x: 0, z: 15, inCar: false, alive: true };
    const rand = random(3);
    let shots = 0;
    for (let t = 0; t < 3; t += DT) {
      cough(cop, 1, 1);
      if (stepCrowdPed(cop, [], rand, DT, target)?.kind === 'shoot') shots++;
    }
    expect(shots).toBe(0);
    expect(cop.mode).toBe('shoot');
    expect(Math.hypot(cop.s.x, cop.s.z)).toBeLessThan(0.3);
    // Out of it, back to work.
    for (let t = 0; t < SMOKE_LINGER + 2; t += DT) if (stepCrowdPed(cop, [], rand, DT, target)?.kind === 'shoot') shots++;
    expect(shots).toBeGreaterThan(0);
  });

  it('the fallen and the burning don’t cough', () => {
    const down = walker(0, 0);
    down.mode = 'down';
    const burning = walker(0, 0);
    burning.burning = 2;
    expect(cough(down, 0, 0)).toBe(false);
    expect(cough(burning, 0, 0)).toBe(false);
    expect(down.cough).toBe(0);
    expect(burning.cough).toBe(0);
  });

  it('drivers brake hard and sit there until SMOKE_LINGER after it clears', () => {
    const rand = random(4);
    const car = createVehicleState(0, 0, 0);
    car.vz = 12;
    const ai = driverFor(car, rand);
    brakeInSmoke(ai);
    expect(driveAi(ai, car, [], rand, DT).throttle).toBe(-1);
    for (let t = 0; t < 3; t += DT) {
      brakeInSmoke(ai);
      stepVehicle(car, driveAi(ai, car, [], rand, DT), SEDAN, DT);
    }
    expect(forwardSpeed(car)).toBeLessThan(0.6);
    for (let t = 0; t < SMOKE_LINGER + 0.1; t += DT) driveAi(ai, car, [], rand, DT);
    expect(ai.startled).toBeLessThanOrEqual(0);
  });
});
