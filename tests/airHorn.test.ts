import { describe, expect, it } from 'vitest';
import { createVehicleState } from '../src/entities/vehicle';
import {
  HORN_EARS,
  HORN_HALF_ANGLE,
  HORN_RANGE,
  HORN_REEL,
  HORN_STALL,
  hornClear,
  hornHit,
  startle,
  startleDriverByHorn,
} from '../src/systems/airHorn';
import { spawnPed, type PedAgent } from '../src/systems/crowd';
import { hoseHit } from '../src/systems/serviceTools';
import { driveAi, driverFor, fullRateDriver } from '../src/systems/traffic';
import { CRIME_HEAT, NUISANCE_CAP, Wanted } from '../src/systems/wanted';
import { ScannerFeed, TOPICS, type PingWorld } from '../src/systems/scanner';
import { EventBus } from '../src/core/events';
import { random } from './helpers';

function walker(x: number, z: number): PedAgent {
  const a = spawnPed(0, 0, 0, 0, random(2));
  Object.assign(a.s, { x, z, vx: 0, vz: 0 });
  a.temper = 'calm';
  a.mode = 'walk';
  return a;
}

describe('air horn: the cone', () => {
  it('reaches HORN_RANGE straight ahead, HORN_HALF_ANGLE either side, never behind', () => {
    expect(hornHit(0, 0, 0, 1, 0, 10, 0.4)).toBeCloseTo(10);
    expect(hornHit(0, 0, 0, 1, 0, HORN_RANGE + 1, 0.4)).toBe(-1);
    expect(hornHit(0, 0, 0, 1, 0, -3, 0.4)).toBe(-1);
    const inside = HORN_HALF_ANGLE * 0.85;
    const outside = HORN_HALF_ANGLE * 1.5;
    expect(hornHit(0, 0, 0, 1, Math.sin(inside) * 10, Math.cos(inside) * 10, 0.4)).toBeGreaterThan(0);
    expect(hornHit(0, 0, 0, 1, Math.sin(outside) * 10, Math.cos(outside) * 10, 0.4)).toBe(-1);
    // The same maths as the hose's jet, only wider: the hose misses what the horn hits.
    expect(hoseHit(0, 0, 0, 1, Math.sin(inside) * 10, Math.cos(inside) * 10, 0.4, 16)).toBe(-1);
  });

  it('a wall between stops it', () => {
    const wall = [{ minX: -3, minZ: 4, maxX: 3, maxZ: 5 }];
    expect(hornClear(wall, 0, 0, 0, 8, 0.4)).toBe(false);
    expect(hornClear(wall, 0, 0, 0, 3, 0.4)).toBe(true);
    expect(hornClear([], 0, 0, 0, 8, 0.4)).toBe(true);
    expect(hornClear(wall, 0, 0, 8, 8, 0.4)).toBe(true);
  });
});

describe('air horn: people', () => {
  it('right in front they reel and cover their ears, nearby they cover their ears, further off they scatter, all away from you', () => {
    const reel = walker(0, HORN_REEL - 1);
    expect(startle(reel, 0, 0, HORN_REEL - 1)).toBe('reel');
    expect(reel.stagger).toBeGreaterThan(0);
    expect(reel.cower).toBeGreaterThan(0);
    expect(reel.s.vz).toBeGreaterThan(0);
    const ears = walker(0, HORN_EARS - 1);
    expect(startle(ears, 0, 0, HORN_EARS - 1)).toBe('ears');
    expect(ears.cower).toBeGreaterThan(0);
    expect(ears.stagger).toBe(0);
    const run = walker(0, HORN_EARS + 2);
    expect(startle(run, 0, 0, HORN_EARS + 2)).toBe('flee');
    expect(run.cower).toBe(0);
    for (const a of [reel, ears, run]) {
      expect(a.mode).toBe('flee');
      expect(a.fleeZ).toBeGreaterThan(0.9);
      expect(a.hp).toBe(100);
    }
  });

  it('the police, fighters, the fallen and the burning stand their ground', () => {
    const cop = walker(0, 3);
    cop.role = 'cop';
    const fighter = walker(0, 3);
    fighter.mode = 'fight';
    const down = walker(0, 3);
    down.mode = 'down';
    const burning = walker(0, 3);
    burning.burning = 2;
    for (const a of [cop, fighter, down, burning]) {
      const was = a.mode;
      expect(startle(a, 0, 0, 3)).toBe('none');
      expect(a.mode).toBe(was);
    }
  });
});

describe('air horn: drivers', () => {
  it('brake hard, sit stalled, then honk back', () => {
    const rand = random(4);
    const car = createVehicleState(0, 0, 0);
    car.vz = 10; // heading +Z at 10 m/s
    const ai = driverFor(car, rand);
    startleDriverByHorn(ai, rand);
    expect(ai.startled).toBeGreaterThanOrEqual(HORN_STALL[0]);
    expect(ai.startled).toBeLessThanOrEqual(HORN_STALL[1]);
    expect(Math.abs(ai.swerve)).toBeLessThanOrEqual(0.6);
    expect(fullRateDriver(ai)).toBe(true);
    const c = driveAi(ai, car, [], rand, 1 / 60);
    expect(c.throttle).toBe(-1);
    let honked = false;
    for (let t = 0; t < HORN_STALL[1] + 0.1; t += 1 / 60) {
      driveAi(ai, car, [], rand, 1 / 60);
      if (ai.honk > 0) honked = true;
    }
    expect(ai.startled).toBeLessThanOrEqual(0);
    expect(honked).toBe(true);
  });

  it('not one chasing you in a rage', () => {
    const rand = random(4);
    const ai = driverFor(createVehicleState(0, 0, 0), rand);
    ai.mood = 'rage';
    startleDriverByHorn(ai, rand);
    expect(ai.startled).toBe(0);
  });
});

describe('air horn: heat and the scanner', () => {
  it('a blast is a nuisance, not an assault: a little heat, capped, never a star from a canister', () => {
    const w = new Wanted(new EventBus());
    w.commit('nuisance', true);
    expect(w.heat).toBeCloseTo(CRIME_HEAT.nuisance);
    expect(CRIME_HEAT.nuisance).toBeLessThan(CRIME_HEAT.assault);
    for (let i = 0; i < 5; i++) w.commit('nuisance', true);
    expect(w.heat).toBeCloseTo(NUISANCE_CAP);
    // A whole canister (12 blasts) a second or so apart.
    const v = new Wanted(new EventBus());
    for (let i = 0; i < 12; i++) {
      v.commit('nuisance', true);
      for (let t = 0; t < 1.1; t += 1 / 60) v.step(1 / 60, false);
    }
    expect(v.level).toBe(0);
    // Unseen: nothing.
    const u = new Wanted(new EventBus());
    u.commit('nuisance', false);
    expect(u.heat).toBe(0);
  });

  it('the scanner logs a noise complaint, then not again until its cooldown', () => {
    const still: PingWorld = { alive: () => true, where: () => false };
    const feed = new ScannerFeed(() => 0);
    feed.street('noise', 0, 0, 'COBBLE ROW', 20, 0);
    expect(feed.step(0, still)?.text).toBe('NOISE COMPLAINT IN COBBLE ROW. SOME CLOWN WITH AN AIR HORN.');
    feed.street('noise', 0, 0, 'COBBLE ROW', 20, 30);
    expect(feed.step(30, still)).toBeNull();
    feed.street('noise', 0, 0, 'COBBLE ROW', 20, TOPICS.noise.cooldown + 1);
    expect(feed.step(TOPICS.noise.cooldown + 1, still)?.topic).toBe('noise');
  });
});
