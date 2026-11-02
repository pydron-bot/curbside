/**
 * The taser (W3-B): the stun itself (systems/taser.ts), then the darts as
 * Combat fires them: one person, the first along the aim, walls and cars in
 * the way, the events heat and the scenes read, cartridges and crates.
 */
import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../src/core/events';
import { VEHICLE_HEALTH, createVehicleState } from '../src/entities/vehicle';
import { Combat, type AimInput } from '../src/game/combat';
import { Player } from '../src/game/player';
import type { CrowdPed, Vehicle } from '../src/game/population';
import type { CarMesh } from '../src/render/carMesh';
import type { CharacterModel } from '../src/render/characterModel';
import { PED_HP, spawnPed, stepCrowdPed, type PedAgent } from '../src/systems/crowd';
import { createDamage } from '../src/systems/damage';
import { Score } from '../src/systems/score';
import { TASER_RANGE, TASER_STUN, stun } from '../src/systems/taser';
import { WEAPONS } from '../src/systems/weapons';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const DT = 1 / 60;

function walker(x: number, z: number): PedAgent {
  const a = spawnPed(0, 0, 0, 0, random(2));
  Object.assign(a.s, { x, z, vx: 0, vz: 0 });
  a.temper = 'calm';
  a.mode = 'walk';
  return a;
}

function ped(x: number, z: number): CrowdPed {
  const agent = walker(x, z);
  return { agent, prev: { ...agent.s }, model: { punch() {} } as unknown as CharacterModel };
}

function car(x: number, z: number): Vehicle {
  const sim = createVehicleState(x, z, Math.PI / 2);
  return {
    archetype: 'sedan',
    paint: '#fff',
    sim,
    prev: { ...sim },
    mesh: { root: {}, frontWheels: [] } as unknown as CarMesh,
    ai: null,
    damage: createDamage(VEHICLE_HEALTH.sedan),
    wreckAge: 0,
    charred: false,
  };
}

function setup(walls: Array<{ minX: number; minZ: number; maxX: number; maxZ: number }> = []) {
  const bus = new EventBus();
  const log: GameEvent[] = [];
  bus.onAny((e) => log.push(e));
  const player = new Player(bus, 0, 0, 0); // facing +Z
  const crowd: CrowdPed[] = [];
  const vehicles: Vehicle[] = [];
  let time = 0;
  const combat = new Combat({
    bus,
    player,
    vehicles,
    crowd,
    grid: new StaticGrid(walls),
    rand: random(7),
    score: new Score(),
    award: (a) => a && bus.emit({ type: 'award', award: a }),
    ejectDriver: () => {},
    now: () => time,
    playing: () => true,
    focus: () => ({ x: 0, z: 0 }),
    stars: () => 0,
  });
  const step = (seconds: number) => {
    for (let t = 0; t < seconds; t += DT) {
      time += DT;
      player.step(DT);
      combat.step(DT);
    }
  };
  player.arsenal.pickUp('taser');
  return { bus, log, player, crowd, vehicles, combat, step };
}

const noAim: AimInput = { heading: null, reach: 0, ground: null };
const downs = (log: GameEvent[]) => log.filter((e): e is Extract<GameEvent, { type: 'pedDown' }> => e.type === 'pedDown');
const darts = (log: GameEvent[]) => log.filter((e): e is Extract<GameEvent, { type: 'taser' }> => e.type === 'taser');

describe('taser: the stun', () => {
  it('down where they stand for TASER_STUN s, nothing off their hit points, then up', () => {
    const a = walker(0, 3);
    expect(stun(a, 0, 0)).toBe(true);
    expect(a.mode).toBe('down');
    expect(a.timer).toBeCloseTo(TASER_STUN);
    expect(a.hp).toBe(PED_HP);
    expect(a.ko).toBe(false);
    // Folds rather than flies: a slow slide away from the darts.
    expect(a.s.vz).toBeGreaterThan(0);
    expect(a.s.vz).toBeLessThan(1);
    // Already down: nothing to stun.
    expect(stun(a, 0, 0)).toBe(false);
    for (let t = 0; t < TASER_STUN - 0.1; t += DT) stepCrowdPed(a, [], random(1), DT);
    expect(a.mode).toBe('down');
    for (let t = 0; t < 0.2; t += DT) stepCrowdPed(a, [], random(1), DT);
    expect(a.mode).not.toBe('down');
  });

  it('ordinary people get up provoked (a fighter comes at you); suspects and officers are left to their scene and the police', () => {
    const fighter = walker(0, 3);
    fighter.temper = 'fighter';
    stun(fighter, 0, 0);
    expect(fighter.provoked).toBe(true);
    const player = { x: 0, z: 0, inCar: false, alive: true };
    for (let t = 0; t < TASER_STUN + 0.1; t += DT) stepCrowdPed(fighter, [], random(1), DT, player);
    expect(fighter.mode).toBe('fight');
    const suspect = walker(0, 3);
    suspect.suspect = true;
    stun(suspect, 0, 0);
    expect(suspect.provoked).toBe(false);
    const cop = walker(0, 3);
    cop.role = 'cop';
    stun(cop, 0, 0);
    expect(cop.provoked).toBe(false);
    for (let t = 0; t < TASER_STUN + 0.1; t += DT) stepCrowdPed(cop, [], random(1), DT, player);
    expect(cop.mode).toBe('arrest');
  });
});

describe('taser: the darts', () => {
  it('stun the first person along the aim, no one behind them; a taser event, then a pedDown (cause taser), no gunfire', () => {
    const w = setup();
    const first = ped(0, 4);
    const behind = ped(0.2, 6);
    const aside = ped(3, 4);
    w.crowd.push(first, behind, aside);
    expect(w.combat.fire(noAim)).toBe(true);
    expect(first.agent.mode).toBe('down');
    expect(first.agent.hp).toBe(PED_HP);
    expect(behind.agent.mode).not.toBe('down');
    // Close by: they back away from it.
    expect(behind.agent.mode).toBe('flee');
    expect(aside.agent.mode).toBe('flee');
    const shot = darts(w.log);
    expect(shot).toHaveLength(1);
    expect(shot[0]).toMatchObject({ hit: true, byPlayer: true });
    expect(shot[0].toZ).toBeCloseTo(4 - 0.55, 1);
    expect(downs(w.log)).toEqual([expect.objectContaining({ cause: 'taser', byPlayer: true, cop: false, suspect: undefined })]);
    expect(w.log.findIndex((e) => e.type === 'taser')).toBeLessThan(w.log.findIndex((e) => e.type === 'pedDown'));
    expect(w.log.some((e) => e.type === 'shot' || e.type === 'bulletHit')).toBe(false);
  });

  it('reach TASER_RANGE and no further; a wall or a car in the way takes them', () => {
    const far = setup();
    const out = ped(0, TASER_RANGE + 1.5);
    far.crowd.push(out);
    expect(far.combat.fire({ heading: 0, reach: 1, ground: null })).toBe(true);
    expect(out.agent.mode).not.toBe('down');
    expect(darts(far.log)[0]).toMatchObject({ hit: false });
    expect(darts(far.log)[0].toZ).toBeCloseTo(0.6 + TASER_RANGE, 1);

    const walled = setup([{ minX: -3, minZ: 2.5, maxX: 3, maxZ: 3 }]);
    const shielded = ped(0, 5);
    walled.crowd.push(shielded);
    walled.combat.fire({ heading: 0, reach: 1, ground: null });
    expect(shielded.agent.mode).not.toBe('down');
    expect(darts(walled.log)[0].toZ).toBeCloseTo(2.5, 1);

    const parked = setup();
    const hidden = ped(0, 7);
    parked.crowd.push(hidden);
    parked.vehicles.push(car(0, 4));
    parked.combat.fire({ heading: 0, reach: 1, ground: null });
    expect(hidden.agent.mode).not.toBe('down');
    expect(downs(parked.log)).toHaveLength(0);
  });

  it('an officer: still knocked down, reported as one (heat: copDown); a fleeing suspect: reported as a suspect (no assault)', () => {
    const w = setup();
    const cop = ped(0, 3);
    cop.agent.role = 'cop';
    w.crowd.push(cop);
    w.combat.fire(noAim);
    expect(cop.agent.mode).toBe('down');
    expect(downs(w.log)[0]).toMatchObject({ cop: true, cause: 'taser' });

    const v = setup();
    const mugger = ped(0, 3);
    mugger.agent.suspect = true;
    v.crowd.push(mugger);
    v.combat.fire(noAim);
    expect(downs(v.log)[0]).toMatchObject({ suspect: true, cop: false });

  });

  it('lock-on with a taser in hand picks out a fleeing suspect over someone nearer', () => {
    const w = setup();
    const nearer = ped(-0.6, 3);
    const mugger = ped(0.8, 6);
    mugger.agent.suspect = true;
    w.crowd.push(nearer, mugger);
    w.combat.updateAim(true, noAim);
    expect(w.combat.lock).toBe(mugger);
    expect(w.combat.fire(noAim)).toBe(true);
    expect(mugger.agent.mode).toBe('down');
    expect(nearer.agent.mode).not.toBe('down');
    // The one it locked on is down: the lock lets go.
    expect(w.combat.lock).toBeNull();
  });

  it('one cartridge a shot, a beat to recharge, topped up by ammo crates', () => {
    const w = setup();
    expect(w.player.arsenal.current).toBe('taser');
    expect(w.player.arsenal.ammo.get('taser')).toBe(WEAPONS.taser.pickupAmmo);
    expect(w.combat.fire(noAim)).toBe(true);
    expect(w.combat.fire(noAim)).toBe(false); // recharging
    w.step(WEAPONS.taser.interval + 0.05);
    expect(w.combat.fire(noAim)).toBe(true);
    expect(w.player.arsenal.ammo.get('taser')).toBe(WEAPONS.taser.pickupAmmo - 2);
    expect(w.combat.collect('ammo')).toBe(true);
    expect(w.player.arsenal.ammo.get('taser')).toBe(WEAPONS.taser.pickupAmmo - 2 + Math.ceil(WEAPONS.taser.pickupAmmo / 2));
  });
});
