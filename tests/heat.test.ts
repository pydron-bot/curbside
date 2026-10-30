/**
 * The heat loop end to end on the real city: police respond to stars, arrive,
 * get out and arrest; heat clears on a bust, a respray or death; traffic
 * reacts. A small stand-in for main.ts's simulate() runs the same systems.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ColorRepresentation } from 'three';
import { EventBus, type GameEvent } from '../src/core/events';
import { PLAYER_ON_FOOT, stepPedestrian } from '../src/entities/pedestrian';
import { VEHICLE_HEALTH, VEHICLE_SPECS, createVehicleState, stepVehicle, type VehicleArchetype } from '../src/entities/vehicle';
import { Heat, rammedBy } from '../src/game/heat';
import { Player } from '../src/game/player';
import { Population, type Vehicle } from '../src/game/population';
import type { CarMesh } from '../src/render/carMesh';
import type { CharacterModel } from '../src/render/characterModel';
import { stepCrowdPed } from '../src/systems/crowd';
import { createDamage } from '../src/systems/damage';
import { collidePedStatic, collidePedVehicle, collideVehicleStatic, collideVehicles } from '../src/systems/physics';
import { Score } from '../src/systems/score';
import type { Obstacle } from '../src/systems/traffic';
import { generateCity, type Rect } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const DT = 1 / 60;
const city = generateCity(1337);
const grid = new StaticGrid(city.obstacles);

function world(seed = 3, x = 9.5, z = 9.5, held?: () => boolean) {
  const bus = new EventBus();
  const log: GameEvent[] = [];
  bus.onAny((e) => log.push(e));
  const rand = random(seed);
  const vehicles: Vehicle[] = [];
  const makeVehicle = (archetype: VehicleArchetype, paint: ColorRepresentation): Vehicle => {
    const sim = createVehicleState();
    return {
      archetype,
      paint,
      sim,
      prev: { ...sim },
      mesh: { root: { visible: true }, frontWheels: [], siren: false } as unknown as CarMesh,
      ai: null,
      damage: createDamage(VEHICLE_HEALTH[archetype]),
      wreckAge: 0,
      charred: false,
    };
  };
  const population = new Population(
    vehicles,
    {
      createVehicle: makeVehicle,
      resetVehicle: (v) => {
        v.damage = createDamage(VEHICLE_HEALTH[v.archetype]);
        v.charred = false;
      },
      createPedModel: () => ({ root: { visible: true }, dispose: vi.fn(), setOutfit: vi.fn() }) as unknown as CharacterModel,
    },
    rand,
  );
  const player = new Player(bus, x, z);
  const score = new Score();
  const view: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  const updateView = () => {
    const p = player.position;
    view.minX = p.x - 26;
    view.maxX = p.x + 26;
    view.minZ = p.z - 12;
    view.maxZ = p.z + 12;
    return view;
  };
  const shots: number[] = [];
  const heat = new Heat({
    bus,
    city,
    grid,
    vehicles,
    population,
    player,
    score,
    rand,
    view: updateView,
    playing: () => true,
    award: (a) => a && bus.emit({ type: 'award', award: a }),
    ejectDriver: (v) => (v.ai = null),
    npcShoot: () => shots.push(1),
    repaint: () => {},
    held,
  });
  population.maintain({ x, z, vx: 0, vz: 0, view: updateView(), keep: [], seed: true });

  const obstacles: Obstacle[] = [];
  let maintainIn = 0;
  /** One sim step, as main.ts does it (minus effects and scoring). */
  function step() {
    obstacles.length = 0;
    for (const v of vehicles) obstacles.push({ x: v.sim.x, z: v.sim.z, halfWidth: 1 });
    if (!player.driving) obstacles.push({ x: player.ped.x, z: player.ped.z, halfWidth: 0.4, player: true });
    for (const v of vehicles) {
      Object.assign(v.prev, v.sim);
      const c =
        v.damage.wrecked || v === player.driving || !(v.ai || v.pursuit)
          ? { throttle: 0, steer: 0, handbrake: v === player.driving }
          : heat.drive(v, obstacles, DT);
      stepVehicle(v.sim, c, VEHICLE_SPECS[v.archetype], DT);
    }
    if (!player.driving) stepPedestrian(player.ped, { x: 0, y: 0, sprint: false }, PLAYER_ON_FOOT, DT);
    const states = vehicles.map((v) => v.sim);
    const target = { x: player.position.x, z: player.position.z, inCar: !!player.driving, alive: player.alive && !player.arrested };
    for (const c of population.crowd) stepCrowdPed(c.agent, states, rand, DT, target);
    for (const v of vehicles) collideVehicleStatic(v.sim, grid);
    for (let i = 0; i < vehicles.length; i++)
      for (let j = i + 1; j < vehicles.length; j++) collideVehicles(vehicles[i].sim, vehicles[j].sim);
    if (!player.driving) {
      for (const s of states) collidePedVehicle(player.ped, s);
      collidePedStatic(player.ped, grid);
    }
    for (const c of population.crowd) {
      if (c.agent.mode !== 'down') for (const s of states) collidePedVehicle(c.agent.s, s);
      collidePedStatic(c.agent.s, grid);
    }
    heat.step(DT);
    player.step(DT);
    if ((maintainIn -= DT) <= 0) {
      maintainIn = 0.25;
      population.maintain({ x: player.position.x, z: player.position.z, vx: 0, vz: 0, view: updateView(), keep: [player.driving] });
    }
  }
  /** Run until `done` (or `seconds` pass); returns seconds taken or Infinity. */
  function runUntil(done: () => boolean, seconds: number): number {
    for (let t = 0; t < seconds; t += DT) {
      step();
      if (done()) return t;
    }
    return Infinity;
  }
  const types = () => log.map((e) => e.type);
  return { bus, log, types, heat, player, score, vehicles, population, step, runUntil, shots, rand };
}

describe('heat: police response', () => {
  it('one star brings a patrol car that pulls up, and an officer who arrests someone standing still', () => {
    const w = world(3);
    w.heat.wanted.force(1);
    const t = w.runUntil(() => w.types().includes('busted'), 90);
    expect(t).toBeLessThan(90);
    expect(w.player.arrested).toBe(true);
    expect(w.heat.wanted.level).toBe(0);
    // Police cars stayed police (Population didn't recycle them mid-chase).
    expect(w.log.some((e) => e.type === 'wanted' && e.reason === 'busted')).toBe(true);
  });

  it('never sends more units than the level calls for, and stands them down when the heat is gone', () => {
    const w = world(5);
    w.heat.wanted.force(3);
    let most = 0;
    for (let i = 0; i < 60 * 8; i++) {
      w.step();
      most = Math.max(most, w.heat.police.activeUnits);
      expect(w.heat.police.activeUnits).toBeLessThanOrEqual(5);
    }
    expect(most).toBeGreaterThanOrEqual(3);
    expect(w.vehicles.filter((v) => v.police).length).toBeGreaterThan(0);
    w.heat.wanted.clear('reset');
    w.heat.police.standDown();
    w.runUntil(() => w.heat.police.units.length === 0, 60);
    expect(w.heat.police.units.length).toBe(0);
    expect(w.vehicles.filter((v) => v.police)).toHaveLength(0);
  });

  it('nobody is busted while the game holds them still (a 3-2-1); the meter picks up after', () => {
    let held = true;
    const w = world(3, 9.5, 9.5, () => held);
    w.heat.wanted.force(1);
    let gripped = 0;
    w.runUntil(() => {
      gripped = Math.max(gripped, w.heat.bust.progress);
      return false;
    }, 40);
    expect(w.player.arrested).toBe(false);
    expect(gripped).toBe(0);
    // An officer is right there, waiting for the GO.
    expect(w.heat.police.nearestOfficer(w.player.ped.x, w.player.ped.z)).toBeLessThan(2);
    held = false;
    expect(w.runUntil(() => w.player.arrested, 3)).toBeLessThan(3);
  });

  it('a busted player is fined, loses their guns and the police clear off', () => {
    const w = world(7);
    w.score.total = 1000;
    w.player.arsenal.pickUp('pistol');
    w.heat.wanted.force(2);
    w.runUntil(() => w.player.arrested, 90);
    expect(w.player.arrested).toBe(true);
    const busted = w.log.find((e) => e.type === 'busted');
    expect(busted).toMatchObject({ fine: 250 });
    expect(w.score.total).toBe(750);
    expect(w.player.arsenal.current).toBeNull();
    expect(w.heat.police.units.every((u) => u.dismissed)).toBe(true);
  });

  it('officers cuff someone lying on the ground rather than shoot them, even at 3 stars', () => {
    const w = world(29);
    w.heat.wanted.force(3);
    let shooting = 0;
    const t = w.runUntil(() => {
      // Keep the player knocked down.
      w.player.stunned = Math.max(w.player.stunned, 1);
      w.heat.police.forEachOfficerMode((mode) => {
        if (mode === 'shoot') shooting++;
      });
      return w.player.arrested;
    }, 90);
    expect(t).toBeLessThan(90);
    expect(shooting).toBe(0);
  });

  it('someone who stands still with empty hands is cuffed, not shot, even at 3 stars', () => {
    const w = world(29);
    w.heat.wanted.force(3);
    let shooting = 0;
    const t = w.runUntil(() => {
      w.heat.police.forEachOfficerMode((mode) => {
        if (mode === 'shoot') shooting++;
      });
      return w.player.arrested;
    }, 90);
    expect(t).toBeLessThan(90);
    expect(shooting).toBe(0);
    expect(w.player.alive).toBe(true);
  });

  it('with a gun out at 3 stars, officers open fire', () => {
    const w = world(29);
    w.player.arsenal.pickUp('pistol');
    w.heat.wanted.force(3);
    let shooting = 0;
    w.runUntil(() => {
      w.heat.police.forEachOfficerMode((mode) => {
        if (mode === 'shoot') shooting++;
      });
      return shooting > 0 || w.player.arrested;
    }, 90);
    expect(shooting).toBeGreaterThan(0);
  });

  it('a unit waiting on an officer who can’t get back leaves them after a while', () => {
    const w = world(31);
    w.heat.wanted.force(1);
    // Wait for the crew to get out.
    w.runUntil(() => w.heat.police.units.some((u) => u.officers.length > 0), 90);
    const unit = w.heat.police.units.find((u) => u.officers.length > 0)!;
    expect(unit).toBeDefined();
    w.heat.wanted.clear('reset');
    // Pin the officers near the car (too close to give up on it), as if wedged behind a building.
    const car = unit.vehicle!.sim;
    const pinned = unit.officers.map((p, i) => ({ p, x: car.x + 8 + i, z: car.z + 8 }));
    let gone = Infinity;
    for (let t = 0; t < 30; t += 1 / 60) {
      for (const { p, x, z } of pinned) Object.assign(p.agent.s, { x, z, vx: 0, vz: 0 });
      w.step();
      if (!w.heat.police.units.includes(unit)) {
        gone = t;
        break;
      }
    }
    // Not straight away (they get a fair chance), but well before the next run.
    expect(gone).toBeGreaterThan(5);
    expect(gone).toBeLessThan(20);
  });

  it('five stars put the helicopter up', () => {
    const w = world(9);
    w.heat.wanted.force(5);
    w.runUntil(() => w.heat.police.heli.sees, 30);
    expect(w.heat.police.heli.active).toBe(true);
    expect(w.heat.police.seen).toBe(true);
  });
});

describe('heat: crimes and clearing', () => {
  it('crimes on screen count; dying clears the heat', () => {
    const w = world(11);
    for (let i = 0; i < 4; i++) w.bus.emit({ type: 'pedDown', x: 12, z: 9, cause: 'punch', byPlayer: true });
    expect(w.heat.wanted.level).toBe(1);
    // Knocking down a cop is worth a star on its own.
    w.bus.emit({ type: 'pedDown', x: 12, z: 9, cause: 'punch', byPlayer: true, cop: true });
    expect(w.heat.wanted.level).toBe(2);
    // Far off-screen with no police about: nobody saw.
    w.bus.emit({ type: 'carjack', x: 400, z: 400 });
    expect(w.heat.wanted.heat).toBeCloseTo(2.2);
    w.player.hurt(1000);
    expect(w.heat.wanted.level).toBe(0);
  });

  it('stealing a police car is a star; wrecking one is a crime against the police', () => {
    const w = world(13);
    const cop = w.vehicles.find((v) => v.archetype === 'police') ?? w.population.takeVehicle('police', '#fff');
    cop.police = false;
    Object.assign(cop.sim, createVehicleState(10, 9.5, 0));
    w.player.enter(cop);
    expect(w.heat.wanted.level).toBe(1);
    w.bus.emit({ type: 'explosion', x: 12, z: 10, distance: 0, byPlayer: true, police: true });
    expect(w.heat.wanted.heat).toBeCloseTo(1 + 0.6 + 1);
    expect(w.log.some((e) => e.type === 'award' && e.award.kind === 'copWreck')).toBe(true);
  });

  it('a Pay ’n’ Spray loses the police only if they didn’t see you go in', () => {
    for (const watched of [false, true]) {
      const shop = world().heat.shops[0];
      // Wait by the bay (in a car) for the police to turn up, or drive straight in.
      const w = world(17, shop.x + 30, shop.z);
      const car = w.population.takeVehicle('sedan', '#c8342b');
      car.police = false;
      Object.assign(car.sim, createVehicleState(shop.x + 30, shop.z, 0));
      w.player.enter(car);
      w.heat.wanted.force(2);
      if (watched) {
        w.runUntil(() => w.heat.police.seen, 60);
        expect(w.heat.police.seen).toBe(true);
      }
      car.damage.health = 20;
      Object.assign(car.sim, createVehicleState(shop.x, shop.z, shop.heading));
      const before = car.paint;
      for (let i = 0; i < 60 * 2.2; i++) w.heat.step(DT);
      const sprayed = w.log.find((e) => e.type === 'respray');
      expect(sprayed).toMatchObject({ cleared: !watched });
      expect(car.paint).not.toBe(before);
      expect(car.damage.health).toBe(car.damage.maxHealth);
      // Unwatched: clean. Watched: the stars stay.
      expect(w.heat.wanted.level).toBe(watched ? 2 : 0);
    }
  });
});

describe('heat: traffic reactions', () => {
  it('a driver rammed hard panics, rages or bails out, in about the designed shares', () => {
    const w = world(19);
    const own = w.population.takeVehicle('sedan', '#fff');
    own.police = false;
    w.player.enter(own);
    const tally = { panic: 0, rage: 0, bail: 0 };
    for (let i = 0; i < 400; i++) {
      const other = w.population.takeVehicle('sedan', '#123');
      other.police = false;
      other.ai = { ...w.vehicles.find((v) => v.ai)!.ai!, mood: 'calm', moodTimer: 0 };
      w.heat.playerCrash(other, 12);
      if (!other.ai) tally.bail++;
      else if (other.pursuit) tally.rage++;
      else if (other.ai.mood === 'panic') tally.panic++;
      w.population.retireVehicle(other);
    }
    expect(tally.panic / 400).toBeGreaterThan(0.45);
    expect(tally.panic / 400).toBeLessThan(0.65);
    expect(tally.rage / 400).toBeGreaterThan(0.17);
    expect(tally.rage / 400).toBeLessThan(0.33);
    expect(tally.bail / 400).toBeGreaterThan(0.12);
    expect(tally.bail / 400).toBeLessThan(0.28);
  });

  it('only the faster-closing car did the ramming', () => {
    const a = { prev: createVehicleState(0, 0, 0) } as Vehicle;
    const b = { prev: createVehicleState(0, 4, Math.PI) } as Vehicle;
    a.prev.vz = 15;
    b.prev.vz = -2;
    expect(rammedBy(a, b)).toBe(true);
    expect(rammedBy(b, a)).toBe(false);
  });

  it('ramming a police car is a crime; being rammed by one isn’t', () => {
    const w = world(23);
    const own = w.population.takeVehicle('sedan', '#fff');
    own.police = false;
    w.player.enter(own);
    const cop = w.population.takeVehicle('police', '#fff');
    Object.assign(own.prev, createVehicleState(0, 0, 0), { vz: 20 });
    Object.assign(cop.prev, createVehicleState(0, 5, 0), { vz: 2 });
    w.heat.playerCrash(cop, 15);
    expect(w.heat.wanted.heat).toBeCloseTo(0.6);
    expect(w.log.some((e) => e.type === 'award' && e.award.kind === 'copRam')).toBe(true);
    w.heat.wanted.clear('reset');
    Object.assign(own.prev, createVehicleState(0, 0, 0), { vz: 2 });
    Object.assign(cop.prev, createVehicleState(0, 5, 0), { vz: -20 });
    w.heat.playerCrash(cop, 15);
    expect(w.heat.wanted.heat).toBe(0);
  });

  it('in a chase, smashing a roadblock or meeting a cop head-on doesn’t add stars', () => {
    const w = world(37);
    w.heat.wanted.force(3);
    const spawned = w.runUntil(() => w.heat.police.units.length > 0, 30);
    expect(spawned).toBeLessThan(30);
    const own = w.population.takeVehicle('sedan', '#fff');
    own.police = false;
    w.player.enter(own);
    const unit = w.heat.police.units[0];
    const cop = unit.vehicle!;
    const heat = w.heat.wanted.heat;
    // Head-on: both closing fast.
    unit.driver.mode = 'chase';
    Object.assign(own.prev, createVehicleState(0, 0, 0), { vz: 30 });
    Object.assign(cop.prev, createVehicleState(0, 5, Math.PI), { vz: -15 });
    w.heat.playerCrash(cop, 45);
    expect(w.heat.wanted.heat).toBe(heat);
    // A parked roadblock.
    unit.role = 'roadblock';
    Object.assign(cop.prev, createVehicleState(0, 5, Math.PI / 2), { vz: 0 });
    w.heat.playerCrash(cop, 30);
    expect(w.heat.wanted.heat).toBe(heat);
    // Running down a cop from behind still counts.
    unit.role = 'pursuit';
    Object.assign(cop.prev, createVehicleState(0, 5, 0), { vz: 5 });
    w.heat.playerCrash(cop, 25);
    expect(w.heat.wanted.heat).toBeGreaterThan(heat);
  });
});
