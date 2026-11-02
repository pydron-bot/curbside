/**
 * Joining a city police chase (V2-03): the pure handoff rules, then the
 * scene end to end on the real city with the heat loop and the city's life
 * stepped together, as main.ts's simulate() does it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ColorRepresentation } from 'three';
import { EventBus, type GameEvent } from '../src/core/events';
import { PLAYER_ON_FOOT, stepPedestrian } from '../src/entities/pedestrian';
import { VEHICLE_HEALTH, VEHICLE_SPECS, createVehicleState, stepVehicle, type VehicleArchetype, type VehicleControls } from '../src/entities/vehicle';
import { CityLife } from '../src/game/cityLife';
import { Heat } from '../src/game/heat';
import { Player } from '../src/game/player';
import { Population, type Vehicle } from '../src/game/population';
import type { CarMesh } from '../src/render/carMesh';
import type { CharacterModel } from '../src/render/characterModel';
import {
  ARREST_GAP,
  FORGIVE_SECONDS,
  HELPED_SECONDS,
  TOOK_GETAWAY_STARS,
  chaseHandoff,
  citizensArrest,
  forgivenBump,
  type Handoff,
} from '../src/systems/chaseHandoff';
import { stepCrowdPed } from '../src/systems/crowd';
import { createDamage, markPlayerHit } from '../src/systems/damage';
import { collidePedStatic, collidePedVehicle, collideVehicleStatic, collideVehicles } from '../src/systems/physics';
import { UNITS_BY_STARS, holdsFire } from '../src/systems/police';
import { Score } from '../src/systems/score';
import type { Obstacle } from '../src/systems/traffic';
import { Wanted } from '../src/systems/wanted';
import { generateCity, type Rect } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const DT = 1 / 60;

describe('chase handoff: the decision table', () => {
  const cases: Array<[stars: number, inGetaway: boolean, near: boolean, crime: boolean, want: Handoff]> = [
    // In the getaway: always TAKE THE HEAT, wanted or not, whatever else.
    [0, true, false, false, 'takeHeat'],
    [0, true, true, true, 'takeHeat'],
    [3, true, true, false, 'takeHeat'],
    // Nothing done to this chase: it carries on, stars or not, near or far.
    [0, false, false, false, 'continue'],
    [0, false, true, false, 'continue'],
    [2, false, true, false, 'continue'],
    [5, false, false, false, 'continue'],
    // Attacked it, but it cost no star (one bump, a stray bullet): shrugged off.
    [0, false, true, true, 'continue'],
    [0, false, false, true, 'continue'],
    // Attacked it and wanted for it: close by they come for you, far off it breaks off.
    [1, false, true, true, 'turnedOn'],
    [4, false, true, true, 'turnedOn'],
    [1, false, false, true, 'breakOff'],
  ];
  it.each(cases)('stars %i, in getaway %s, near %s, crime %s: %s', (stars, playerInGetaway, playerNear, crimeOnThisChase, want) => {
    expect(chaseHandoff({ stars, playerInGetaway, playerNear, crimeOnThisChase })).toBe(want);
  });

  it('forgives one bump per car, only just after touching the getaway', () => {
    expect(forgivenBump(10, 9, false)).toBe(true);
    expect(forgivenBump(10, 10 - FORGIVE_SECONDS, false)).toBe(true);
    expect(forgivenBump(10, 10 - FORGIVE_SECONDS - 0.1, false)).toBe(false);
    expect(forgivenBump(10, 9, true)).toBe(false);
    expect(forgivenBump(10, -Infinity, false)).toBe(false);
  });

  it("a getaway stopped by the player beside a patrol is their citizen's arrest", () => {
    expect(citizensArrest(10, 8, 5)).toBe(true);
    expect(citizensArrest(10, 10 - HELPED_SECONDS - 0.1, 5)).toBe(false);
    expect(citizensArrest(10, 8, ARREST_GAP + 1)).toBe(false);
    expect(citizensArrest(10, -Infinity, 1)).toBe(false);
  });

  it('taking a getaway lands on 2 stars, witnessed or not, and never lowers more', () => {
    const w = new Wanted(new EventBus());
    w.commit('tookGetaway', false);
    expect(w.level).toBe(TOOK_GETAWAY_STARS);
    w.force(4);
    w.commit('tookGetaway', true);
    expect(w.level).toBe(4);
  });

  it('officers never fire on a player with no stars', () => {
    expect(holdsFire('cop', 0)).toBe(true);
    expect(holdsFire('cop', 1)).toBe(false);
    expect(holdsFire('civilian', 0)).toBe(false);
  });
});

// --- The scene, end to end ---

const city = generateCity(1337);
const grid = new StaticGrid(city.obstacles);

function world(seed: number, x = 9.5, z = 9.5) {
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
  const model = () =>
    ({ root: { visible: true }, dispose: vi.fn(), setOutfit: vi.fn(), reset: vi.fn(), punch: vi.fn(), shoot: vi.fn(), hail: vi.fn(), cheer: vi.fn() }) as unknown as CharacterModel;
  const population = new Population(
    vehicles,
    {
      createVehicle: makeVehicle,
      resetVehicle: (v) => {
        v.damage = createDamage(VEHICLE_HEALTH[v.archetype]);
        v.charred = false;
      },
      createPedModel: model,
    },
    rand,
  );
  const player = new Player(bus, x, z);
  const score = new Score();
  let now = 0;
  const view: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  const viewInto = (out: Rect) => {
    const p = player.position;
    out.minX = p.x - 26;
    out.maxX = p.x + 26;
    out.minZ = p.z - 12;
    out.maxZ = p.z + 12;
    return out;
  };
  const shotsAtPlayer: number[] = [];
  const awards: string[] = [];
  const paid: string[] = [];
  const award = (a: ReturnType<Score['award']> | null) => {
    if (!a) return;
    awards.push(a.kind);
    bus.emit({ type: 'award', award: a });
  };
  // eslint-disable-next-line prefer-const
  let life: CityLife;
  const heat = new Heat({
    bus,
    city,
    grid,
    vehicles,
    population,
    player,
    score,
    rand,
    view: () => viewInto(view),
    playing: () => true,
    award,
    ejectDriver: (v) => (v.ai = null),
    npcShoot: () => {},
    repaint: () => {},
    rammedSceneCop: (v) => life.chases.rammed(v),
  });
  life = new CityLife({
    bus,
    vehicles,
    population,
    player,
    city,
    signals: { at: () => null },
    rand,
    now: () => now,
    view: viewInto,
    playing: () => true,
    // No scene starts on its own: the test starts the chase.
    activity: () => true,
    stars: () => heat.wanted.level,
    tutorial: () => false,
    keep: () => false,
    avoid: [],
    busStops: [],
    vendors: [],
    trafficScale: () => 1,
    npcShoot: () => {},
    collect: () => false,
    focus: () => player.position,
    reward: (_cash, label) => paid.push(label),
    callIn: (crime) => heat.called(crime),
    enlist: (o) => heat.police.strays.push(o),
    adopt: (v, aboard) => heat.adopt(v, aboard),
    award: (kind) => award(score.award(kind)),
  });
  population.maintain({ x, z, vx: 0, vz: 0, view: viewInto(view), keep: [], seed: true });

  const obstacles: Obstacle[] = [];
  const contact = { x: 0, z: 0, nx: 0, nz: 0, closingA: 0, closingB: 0 };
  let maintainIn = 0;
  /** What the player's car does this step (the test drives it). */
  let playerControls: VehicleControls = { throttle: 0, steer: 0, handbrake: true };
  function step() {
    const driving = player.driving;
    obstacles.length = 0;
    for (const v of vehicles) obstacles.push({ x: v.sim.x, z: v.sim.z, halfWidth: 1, player: v === driving, owner: v.sim });
    if (!driving) obstacles.push({ x: player.ped.x, z: player.ped.z, halfWidth: 0.4, player: true });
    for (const v of vehicles) {
      Object.assign(v.prev, v.sim);
      let c: VehicleControls = { throttle: 0, steer: 0, handbrake: false };
      if (v === driving) c = playerControls;
      else if (!v.damage.wrecked && (v.ai || v.pursuit)) c = (v.scene ? v.scene.drive(v, obstacles, DT) : null) ?? heat.drive(v, obstacles, DT);
      stepVehicle(v.sim, c, VEHICLE_SPECS[v.archetype], DT);
    }
    if (!driving) stepPedestrian(player.ped, { x: 0, y: 0, sprint: false }, PLAYER_ON_FOOT, DT);
    const states = vehicles.map((v) => v.sim);
    const target = { x: player.position.x, z: player.position.z, inCar: !!driving, alive: player.alive && !player.arrested };
    for (const c of population.crowd) {
      const own = life.targetFor(c);
      const e = stepCrowdPed(c.agent, states, rand, DT, own ?? target);
      if (e?.kind === 'shoot') {
        if (own) life.shoot(c, e.dirX, e.dirZ);
        else if (!holdsFire(c.agent.role, heat.wanted.level)) shotsAtPlayer.push(now);
      }
    }
    for (const v of vehicles) collideVehicleStatic(v.sim, grid);
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        const a = vehicles[i];
        const b = vehicles[j];
        const impact = collideVehicles(a.sim, b.sim, contact, VEHICLE_SPECS[a.archetype].mass, VEHICLE_SPECS[b.archetype].mass);
        if (impact <= 0 || !driving || (a !== driving && b !== driving)) continue;
        markPlayerHit(a.damage, now);
        markPlayerHit(b.damage, now);
        if (impact > 6) heat.playerCrash(a === driving ? b : a, impact);
      }
    }
    if (!player.driving) {
      for (const s of states) collidePedVehicle(player.ped, s);
      collidePedStatic(player.ped, grid);
    }
    for (const c of population.crowd) {
      if (c.agent.mode !== 'down') for (const s of states) collidePedVehicle(c.agent.s, s);
      collidePedStatic(c.agent.s, grid);
    }
    now += DT;
    heat.step(DT);
    life.step(DT);
    player.step(DT);
    if ((maintainIn -= DT) <= 0) {
      maintainIn = 0.25;
      population.maintain({ x: player.position.x, z: player.position.z, vx: 0, vz: 0, view: viewInto(view), keep: [player.driving] });
    }
  }
  function run(seconds: number, until?: () => boolean): boolean {
    for (let t = 0; t < seconds; t += DT) {
      step();
      if (until?.()) return true;
    }
    return false;
  }
  /** Of `cars`, those showing a siren or emergency lights that nobody (a police unit or a scene) is driving. */
  const orphans = (cars: Vehicle[]) => cars.filter((v) => (v.mesh.siren || v.emergency) && !heat.police.unitOf(v) && !v.scene && v.mesh.root.visible);
  return {
    bus,
    log,
    heat,
    life,
    player,
    vehicles,
    population,
    step,
    run,
    orphans,
    shotsAtPlayer,
    awards,
    paid,
    drive: (c: VehicleControls) => (playerControls = c),
  };
}

type World = ReturnType<typeof world>;

/** Start a car chase (a few seeds: one may find nowhere to put it); its getaway and the unit cars. */
function startChase(w: World) {
  expect(w.life.chases.begin('car')).toBe(true);
  const c = w.life.chases.chases[0];
  const cars = c.units.map((u) => u.v!).filter(Boolean);
  expect(cars.length).toBeGreaterThan(0);
  return { c, getaway: c.car!, cars };
}

/** Put the player on foot by `v`'s door, as boardVehicle does: the driver thrown out, then in. */
function carjack(w: World, v: Vehicle) {
  if (w.player.driving) w.player.exit();
  v.sim.vx = v.sim.vz = 0;
  w.player.ped.x = v.sim.x + Math.cos(v.sim.heading) * 1.6;
  w.player.ped.z = v.sim.z - Math.sin(v.sim.heading) * 1.6;
  v.ai = null;
  w.bus.emit({ type: 'carjack', x: v.sim.x, z: v.sim.z });
  expect(w.player.enter(v)).toBe(true);
}

describe('chase handoff: in the city', () => {
  it('TAKE THE HEAT: carjack the getaway and its cops are your pursuit, at 2 stars, no siren left orphaned', () => {
    const w = world(21);
    const { getaway, cars } = startChase(w);
    w.run(1);
    carjack(w, getaway);
    w.step();
    expect(w.heat.wanted.level).toBeGreaterThanOrEqual(2);
    expect(w.life.chases.joined.takeHeat).toBe(1);
    expect(w.awards).toContain('takeTheHeat');
    expect(w.log.some((e) => e.type === 'street' && e.what === 'takeTheHeat')).toBe(true);
    // The chase cars nearby are police units now (within the 2-star cap), owned by the police alone.
    const adopted = cars.filter((v) => w.heat.police.unitOf(v));
    expect(adopted.length).toBeGreaterThan(0);
    expect(w.heat.police.units.length).toBeLessThanOrEqual(UNITS_BY_STARS[2]);
    for (const v of adopted) {
      expect(v.police).toBe(true);
      expect(v.scene ?? null).toBeNull();
      expect(w.life.owned).not.toContain(v);
    }
    expect(w.orphans([getaway, ...cars])).toEqual([]);
    w.run(2);
    expect(w.life.chases.running).toBe(0);
    expect(w.orphans([getaway, ...cars])).toEqual([]);
    // Still theirs a while on, chasing the player.
    for (const v of adopted) expect(w.heat.police.unitOf(v)?.dismissed).toBe(false);
    expect(w.heat.wanted.level).toBeGreaterThanOrEqual(2);
  });

  it("CITIZEN'S ARREST: ram the getaway to a stop by its patrol and the suspect is arrested, at 0 stars", () => {
    const w = world(5);
    const { c, getaway, cars } = startChase(w);
    const cop = cars[0];
    // The getaway stopped in its lane with the patrol on its tail; the player's car nose to nose with it.
    const h = getaway.sim.heading;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    for (const v of [getaway, cop]) v.sim.vx = v.sim.vz = 0;
    Object.assign(cop.sim, createVehicleState(getaway.sim.x - fx * 6.5, getaway.sim.z - fz * 6.5, h));
    const mine = w.population.takeVehicle('sedan', '#333');
    mine.police = false;
    mine.ai = null;
    Object.assign(mine.sim, createVehicleState(getaway.sim.x + fx * 9, getaway.sim.z + fz * 9, h + Math.PI));
    Object.assign(mine.prev, mine.sim);
    w.player.ped.x = mine.sim.x;
    w.player.ped.z = mine.sim.z;
    expect(w.player.enter(mine)).toBe(true);
    // Into it, then on the brakes and hold it there.
    mine.sim.vx = -fx * 9;
    mine.sim.vz = -fz * 9;
    w.drive({ throttle: 0, steer: 0, handbrake: false });
    w.run(0.6);
    w.drive({ throttle: 0, steer: 0, handbrake: true });
    expect(getaway.damage.lastPlayerHit).toBeGreaterThan(0);
    const arrested = w.run(40, () => w.life.chases.ended.arrested > 0);
    expect(w.life.chases.joined.citizensArrest).toBe(1);
    expect(arrested).toBe(true);
    expect(c.end).toBe('arrested');
    expect(w.awards).toContain('citizensArrest');
    expect(w.paid).toContain("CITIZEN'S ARREST");
    expect(w.heat.wanted.level).toBe(0);
    expect(w.heat.wanted.heat).toBeLessThan(1);
    expect(w.shotsAtPlayer).toEqual([]);
  });

  it('a chase the player has nothing to do with runs on while they have 2 stars', () => {
    const w = world(21);
    const { c, cars } = startChase(w);
    w.heat.wanted.force(2);
    w.run(4);
    // Same chase, same cars, still the scene's (not the police's), still after the getaway.
    expect(w.life.chases.chases[0]).toBe(c);
    expect(c.phase).not.toBe('withdraw');
    expect(w.life.chases.joined).toEqual({ takeHeat: 0, turnedOn: 0, breakOff: 0, citizensArrest: 0, haveAGo: 0 });
    for (const v of cars) {
      if (!c.units.some((u) => u.v === v)) continue;
      expect(w.heat.police.unitOf(v)).toBeUndefined();
      expect(v.scene).toBe(w.life.chases.police);
    }
    expect(w.heat.wanted.level).toBe(2);
  });

  it('attacking a chase cop once you are wanted for it turns its police on you', () => {
    const w = world(21);
    const { c, cars } = startChase(w);
    w.run(0.5);
    const cop = cars[0];
    // Shot at from the pavement by the player, more than once (stars from shooting at the police).
    for (let i = 0; i < 8; i++) {
      w.bus.emit({ type: 'shot', x: w.player.ped.x, z: w.player.ped.z, dirX: 1, dirZ: 0, weapon: 'pistol', byPlayer: true });
      w.bus.emit({ type: 'bulletHit', x: cop.sim.x, z: cop.sim.z, target: 'vehicle', byPlayer: true, police: true });
    }
    expect(c.crime).toBe(true);
    // Witnessed or not (it may be off screen), force the point: wanted for it.
    if (w.heat.wanted.level === 0) w.heat.wanted.force(1);
    w.step();
    expect(w.life.chases.joined.turnedOn + w.life.chases.joined.breakOff).toBe(1);
    w.run(2);
    expect(w.life.chases.running).toBe(0);
    expect(w.orphans([c.car!, ...cars])).toEqual([]);
  });

  it('flooring a fleeing suspect is a have-a-go, not an assault', () => {
    const w = world(21);
    w.bus.emit({ type: 'pedDown', x: 12, z: 9, cause: 'punch', byPlayer: true, suspect: true });
    expect(w.heat.wanted.heat).toBe(0);
    w.bus.emit({ type: 'pedDown', x: 12, z: 9, cause: 'punch', byPlayer: true });
    expect(w.heat.wanted.heat).toBeGreaterThan(0);
  });
});
