/**
 * Your Mess, Their Problem (V2-10): the pure rules (adopting a crash, the
 * domino chain and its cap, the patrol on arrival, the shots' call), then
 * the player's crash and gunfire end to end on the real city, with heat and
 * the city's life stepped together as main.ts's simulate() does it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ColorRepresentation } from 'three';
import { EventBus, type GameEvent } from '../src/core/events';
import { VEHICLE_HEALTH, VEHICLE_SPECS, createVehicleState, stepVehicle, type VehicleArchetype, type VehicleControls } from '../src/entities/vehicle';
import { CityLife } from '../src/game/cityLife';
import { Heat } from '../src/game/heat';
import { Player } from '../src/game/player';
import { Population, type Vehicle } from '../src/game/population';
import { SceneStarter } from '../src/game/sceneStarter';
import { CarAlarms } from '../src/game/scenes/alarms';
import { Tows } from '../src/game/scenes/tows';
import type { CarMesh } from '../src/render/carMesh';
import type { CharacterModel } from '../src/render/characterModel';
import { spawnPed, stepCrowdPed } from '../src/systems/crowd';
import { createDamage } from '../src/systems/damage';
import {
  ADOPT_IMPACT,
  BUSY_CARS,
  CALL_AFTER,
  CALL_LATEST,
  DOMINO_CAP,
  STILL_THERE,
  adoptVerdict,
  busyStreet,
  callDue,
  dominoAward,
  dominoBonus,
  dominoLabel,
  dominoPays,
  follows,
  patrolArrives,
  rootCause,
  type CrashCheck,
} from '../src/systems/mess';
import { held } from '../src/systems/cityScenes';
import { Score } from '../src/systems/score';
import { driverFor, type Obstacle } from '../src/systems/traffic';
import { generateCity, type Rect } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const DT = 1 / 60;

// --- The rules ---------------------------------------------------------------------

describe('adopting the player crash', () => {
  const ok: CrashCheck = { impact: 12, due: true, running: 0, ordinary: true, carsNear: 1, sitesNear: 0 };

  it('takes a hard hit on an ordinary car on a quiet street', () => {
    expect(adoptVerdict(ok)).toBe('adopt');
  });

  it('leaves a soft one to the usual reactions', () => {
    expect(adoptVerdict({ ...ok, impact: ADOPT_IMPACT - 0.1 })).toBe('soft');
    expect(adoptVerdict({ ...ok, impact: ADOPT_IMPACT })).toBe('adopt');
  });

  it('one at a time, and only when its clock says so', () => {
    expect(adoptVerdict({ ...ok, running: 1 })).toBe('one');
    expect(adoptVerdict({ ...ok, running: 1, due: false })).toBe('one');
    expect(adoptVerdict({ ...ok, due: false })).toBe('held');
  });

  it('never a car someone else needs (police, a scene, an activity, the player own)', () => {
    expect(adoptVerdict({ ...ok, ordinary: false })).toBe('car');
  });

  it('none on a busy street: a jam, or another site close by', () => {
    expect(busyStreet(BUSY_CARS - 1, 0)).toBe(false);
    expect(busyStreet(BUSY_CARS, 0)).toBe(true);
    expect(busyStreet(0, 1)).toBe(true);
    expect(adoptVerdict({ ...ok, carsNear: BUSY_CARS })).toBe('busy');
    expect(adoptVerdict({ ...ok, sitesNear: 1 })).toBe('busy');
  });
});

describe('the domino chain', () => {
  it('starts at depth 1 and goes one deeper per link, keeping its root', () => {
    const r = rootCause('player');
    expect(r).toEqual({ root: 'player', depth: 1 });
    const c = follows(follows(r));
    expect(c).toEqual({ root: 'player', depth: 3 });
    expect(follows(rootCause('city')).root).toBe('city');
  });

  it(`is capped at ×${DOMINO_CAP}`, () => {
    let c = rootCause('player');
    for (let i = 0; i < 10; i++) c = follows(c);
    expect(c.depth).toBe(DOMINO_CAP);
    expect(dominoLabel(9)).toBe(`DOMINO ×${DOMINO_CAP}`);
    expect(dominoBonus(9)).toBe(dominoBonus(DOMINO_CAP));
  });

  it("pays only the player's chains, from the second link", () => {
    expect(dominoPays({ root: 'player', depth: 1 })).toBe(false);
    expect(dominoPays({ root: 'player', depth: 2 })).toBe(true);
    expect(dominoPays({ root: 'city', depth: 4 })).toBe(false);
    const score = new Score();
    expect(dominoAward(score, { root: 'city', depth: 3 })).toBeNull();
    expect(dominoAward(score, { root: 'player', depth: 1 })).toBeNull();
    const a = dominoAward(score, { root: 'player', depth: 3 })!;
    expect(a.kind).toBe('domino');
    expect(a.label).toBe('DOMINO ×3');
    expect(a.points).toBe(dominoBonus(3) * a.multiplier);
    expect(dominoBonus(2)).toBeLessThan(dominoBonus(3));
    expect(dominoBonus(3)).toBeLessThan(dominoBonus(4));
  });
});

describe('the patrol at your mess', () => {
  it('joins a wanted player still there; anyone else gets a statement taken, never a bust', () => {
    expect(patrolArrives(2, STILL_THERE - 1)).toBe('joinPursuit');
    expect(patrolArrives(2, STILL_THERE + 1)).toBe('statement');
    expect(patrolArrives(0, 2)).toBe('statement');
  });

  it('the shots are called in once the volley stops, or it goes on too long', () => {
    expect(callDue(1, 0.5)).toBe(false);
    expect(callDue(1, CALL_AFTER)).toBe(true);
    expect(callDue(CALL_LATEST, 0)).toBe(true);
  });
});

// --- On the real city ---------------------------------------------------------------

const city = generateCity(1337);
const grid = new StaticGrid(city.obstacles);

function world(seed = 3, x = 9.5, z = 40) {
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
  const population = new Population(vehicles, { createVehicle: makeVehicle, resetVehicle: () => {}, createPedModel: model }, rand);
  const player = new Player(bus, x, z);
  const score = new Score();
  let now = 0;
  const viewInto = (out: Rect) => {
    const p = player.position;
    return Object.assign(out, { minX: p.x - 26, maxX: p.x + 26, minZ: p.z - 12, maxZ: p.z + 12 });
  };
  const awards: string[] = [];
  const award = (a: ReturnType<Score['award']> | null) => {
    if (!a) return;
    awards.push(a.label);
    bus.emit({ type: 'award', award: a });
  };
  const kept: Vehicle[] = [];
  // eslint-disable-next-line prefer-const
  let life: CityLife;
  // eslint-disable-next-line prefer-const
  let starter: SceneStarter;
  const heat = new Heat({
    bus,
    city,
    grid,
    vehicles,
    population,
    player,
    score,
    rand,
    view: () => viewInto({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 }),
    playing: () => true,
    award,
    ejectDriver: (v) => (v.ai = null),
    npcShoot: () => {},
    repaint: () => {},
    adoptCrash: (v, impact) => life.accidents.adopt(v, impact),
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
    // Nothing else starts on its own: the tests feature the kind they're about.
    activity: () => true,
    stars: () => heat.wanted.level,
    opening: () => false,
    keep: (v) => kept.includes(v),
    avoid: [],
    busStops: [],
    vendors: [],
    trafficScale: () => 1,
    npcShoot: () => {},
    collect: () => false,
    focus: () => player.position,
    adopt: (v, aboard) => heat.adopt(v, aboard),
    follow: (id, fx, fz, cause) => starter.follow(id, fx, fz, cause),
  });
  starter = new SceneStarter({ cityLife: life, population, vehicles, player, grids: [grid], rand, explode: () => {} });
  bus.on('domino', (e) => award(dominoAward(score, e)));

  const car = (archetype: VehicleArchetype, vx: number, vz: number, heading = 0, driven = false): Vehicle => {
    const v = population.takeVehicle(archetype, '#888');
    v.police = false;
    Object.assign(v.sim, createVehicleState(vx, vz, heading));
    Object.assign(v.prev, v.sim);
    v.ai = driven ? driverFor(v.sim, rand) : null;
    return v;
  };
  const ped = (px: number, pz: number) => {
    const a = spawnPed(0, 0, 0, 0, rand);
    Object.assign(a.s, { x: px, z: pz, vx: 0, vz: 0 });
    a.street = true;
    a.temper = 'calm';
    a.mode = 'walk';
    return population.addPed(a);
  };
  const obstacles: Obstacle[] = [];
  const hold: VehicleControls = { throttle: 0, steer: 0, handbrake: true };
  function step() {
    obstacles.length = 0;
    for (const v of vehicles) if (v.mesh.root.visible) obstacles.push({ x: v.sim.x, z: v.sim.z, halfWidth: 1, player: v === player.driving, owner: v.sim });
    for (const v of vehicles) {
      if (!v.mesh.root.visible) continue;
      Object.assign(v.prev, v.sim);
      let c: VehicleControls = hold;
      if (v !== player.driving && !v.damage.wrecked && (v.ai || v.pursuit)) c = (v.scene ? v.scene.drive(v, obstacles, DT) : null) ?? heat.drive(v, obstacles, DT);
      stepVehicle(v.sim, c, VEHICLE_SPECS[v.archetype], DT);
    }
    const target = { x: player.position.x, z: player.position.z, inCar: !!player.driving, alive: true };
    for (const c of population.crowd) stepCrowdPed(c.agent, [], rand, DT, life.targetFor(c) ?? target);
    now += DT;
    heat.step(DT);
    life.step(DT);
    player.step(DT);
  }
  function run(seconds: number, until?: () => boolean): boolean {
    for (let t = 0; t < seconds; t += DT) {
      step();
      if (until?.()) return true;
    }
    return false;
  }
  const dominoes = () => log.filter((e): e is Extract<GameEvent, { type: 'domino' }> => e.type === 'domino');
  return { bus, log, heat, life, player, vehicles, population, car, ped, run, awards, kept, dominoes };
}

type World = ReturnType<typeof world>;

/** The player in a car with a calm driver's car just ahead, and the crash between them reported as main.ts does. */
function crash(w: World, impact = 12) {
  const mine = w.car('sedan', 9.5, 40, 0);
  w.player.enter(mine);
  const theirs = w.car('compact', 9.5, 47, 0, true);
  w.heat.playerCrash(theirs, impact);
  return { mine, theirs };
}

describe('your crash becomes their problem', () => {
  it('the other driver gets out and argues, a patrol comes, then a tow: DOMINO ×2, ×3', () => {
    const w = world();
    w.life.featured = 'mess';
    const { mine, theirs } = crash(w);
    expect(w.life.accidents.verdict).toBe('adopt');
    expect(w.life.accidents.mine.length).toBe(1);
    // No panic, rage or bail: it's held for the scene.
    expect(theirs.ai!.mood).toBe('calm');
    expect(theirs.pursuit ?? null).toBeNull();
    expect(w.log.some((e) => e.type === 'street' && e.what === 'accident')).toBe(true);
    expect(w.dominoes()[0]).toMatchObject({ root: 'player', depth: 1, what: 'crash' });
    expect(w.awards).toEqual([]);

    w.run(2);
    const m = w.life.accidents.mine[0];
    expect(m.phase).toBe('argue');
    expect(theirs.ai).toBeNull();
    expect(theirs.towable).toBe(true);
    const driver = m.driver!;
    expect(w.population.crowd).toContain(driver);
    // The city's own tows leave it for now: the patrol comes first.
    expect(w.life.accidents.waiting(theirs)).toBe(true);

    // A patrol on its way, then there: the officer takes a statement.
    expect(w.run(40, () => m.phase === 'statement')).toBe(true);
    expect(w.dominoes().some((e) => e.what === 'patrol' && e.depth === 2 && e.root === 'player')).toBe(true);
    expect(w.awards).toContain('DOMINO ×2');
    // The driver came over to have it out with the player (they stayed put).
    expect(Math.hypot(driver.agent.s.x - mine.sim.x, driver.agent.s.z - mine.sim.z)).toBeLessThan(6);

    // Then the tow, for their car.
    expect(w.run(30, () => m.towed)).toBe(true);
    const tows = w.life.scenes.find((s): s is Tows => s instanceof Tows)!;
    expect(tows.tows[0].car).toBe(theirs);
    expect(w.awards).toContain('DOMINO ×3');
    expect(w.dominoes().filter((e) => e.root === 'player').map((e) => e.depth)).toEqual([1, 2, 3]);

    // Never the player's car: not held, flagged or hooked, and nobody busts a player at 0 stars.
    for (let i = 0; i < 20; i++) {
      w.run(1);
      expect(mine.scene ?? null).toBeNull();
      expect(mine.towable ?? false).toBe(false);
      expect(tows.tows.every((t) => t.car !== mine)).toBe(true);
    }
    expect(w.player.arrested).toBe(false);
    expect(w.heat.wanted.level).toBe(0);
  });

  it('at most one at a time: a second crash meanwhile gets the usual reaction', () => {
    const w = world();
    w.life.featured = 'mess';
    crash(w);
    const other = w.car('sedan', 14, 47, 0, true);
    w.heat.playerCrash(other, 14);
    expect(w.life.accidents.verdict).toBe('one');
    expect(w.life.accidents.mine.length).toBe(1);
    expect(other.scene ?? null).toBeNull();
  });

  it('not on a busy street, nor a car an activity keeps, nor a soft bump', () => {
    const w = world();
    w.life.featured = 'mess';
    for (let i = 0; i < BUSY_CARS; i++) w.car('sedan', 2 + i * 2.5, 60, 0);
    crash(w);
    expect(w.life.accidents.verdict).toBe('busy');

    const k = world();
    k.life.featured = 'mess';
    const mine = k.car('sedan', 9.5, 40, 0);
    k.player.enter(mine);
    const kept = k.car('compact', 9.5, 47, 0, true);
    k.kept.push(kept);
    k.heat.playerCrash(kept, 12);
    expect(k.life.accidents.verdict).toBe('car');
    k.heat.playerCrash(k.car('compact', 16, 47, 0, true), ADOPT_IMPACT - 1);
    expect(k.life.accidents.verdict).toBe('soft');
    expect(k.life.accidents.mine.length).toBe(0);
  });

  it('a patrol arriving at your crash joins the pursuit only if you are wanted and still there', () => {
    const stay = world();
    stay.life.featured = 'mess';
    const { theirs } = crash(stay);
    const m = stay.life.accidents.mine[0];
    // Wanted just as it pulls up (before the force has filled its quota for the stars).
    let patrol: Vehicle | null = null;
    expect(
      stay.run(40, () => {
        const v = m.patrol?.v ?? null;
        if (v && !patrol && Math.hypot(v.sim.x - theirs.sim.x, v.sim.z - theirs.sim.z) < 30) {
          patrol = v;
          stay.heat.wanted.heat = 1.2;
        }
        return m.phase === 'tow';
      }),
    ).toBe(true);
    expect(patrol).not.toBeNull();
    expect(stay.heat.police.unitOf(patrol!)).toBeTruthy();
    expect(m.patrol).toBeNull();

    const gone = world();
    gone.life.featured = 'mess';
    const { mine } = crash(gone);
    const g = gone.life.accidents.mine[0];
    gone.run(1.5);
    // Off down the road before anyone comes (the force's own units may still come for them: not this patrol).
    mine.sim.z += STILL_THERE + 20;
    gone.player.invulnerable = true;
    let gonePatrol: Vehicle | null = null;
    expect(
      gone.run(40, () => {
        const v = g.patrol?.v ?? null;
        if (v && !gonePatrol && Math.hypot(v.sim.x - mine.sim.x, v.sim.z - mine.sim.z) < STILL_THERE + 40) {
          gonePatrol = v;
          gone.heat.wanted.heat = 1.2;
        }
        return g.phase === 'statement';
      }),
    ).toBe(true);
    expect(gonePatrol).not.toBeNull();
    expect(gone.heat.police.unitOf(gonePatrol!)).toBeFalsy();
    expect(g.patrol?.v).toBe(gonePatrol);
  });
});

describe('shots fired', () => {
  it('an alarm, a call, a patrol: DOMINO ×2, ×3, ×4', () => {
    const w = world(5);
    w.life.featured = 'shotsFired';
    const parked = w.car('sedan', 14, 44, 0);
    parked.parked = true;
    // Walking passers-by who'll hear it (and stand to make the call).
    for (let i = 0; i < 4; i++) w.ped(4 + i * 3, 52);
    w.bus.emit({ type: 'shot', x: 9.5, z: 40, dirX: 0, dirZ: 1, weapon: 'pistol', byPlayer: true });
    expect(CarAlarms.of(w.life)!.board.sounding(parked)).toBe(true);
    expect(w.dominoes().map((e) => [e.what, e.depth])).toEqual([
      ['shots', 1],
      ['alarm', 2],
    ]);
    const s = w.life.shotsFired;
    expect(w.run(15, () => s.counts.called > 0)).toBe(true);
    expect(w.log.some((e) => e.type === 'street' && e.what === 'shotsFired')).toBe(true);
    expect(w.run(40, () => s.counts.arrived > 0)).toBe(true);
    expect(w.dominoes().map((e) => e.depth)).toEqual([1, 2, 3, 4]);
    expect(w.awards).toEqual(['DOMINO ×2', 'DOMINO ×3', 'DOMINO ×4']);
    // The officer looks round and they leave; no star for being looked for.
    expect(w.run(40, () => s.call === null)).toBe(true);
    expect(w.heat.wanted.level).toBe(0);
    // Its clock: the next shots don't start another.
    w.bus.emit({ type: 'shot', x: 9.5, z: 40, dirX: 0, dirZ: 1, weapon: 'pistol', byPlayer: true });
    expect(s.call).toBeNull();
  });

  it("nobody else's shots, and nothing while wanted (the police are coming anyway)", () => {
    const w = world(5);
    w.bus.emit({ type: 'shot', x: 9.5, z: 40, dirX: 0, dirZ: 1, weapon: null, byPlayer: false });
    expect(w.life.shotsFired.call).toBeNull();
    // LOUD: held while wanted; your crashes (BUSY) only thin out.
    const free = { playing: true, activity: false, stars: 0, opening: false };
    expect(held(w.life.clock.spec('shotsFired'), free)).toBe(false);
    expect(held(w.life.clock.spec('shotsFired'), { ...free, stars: 1 })).toBe(true);
    expect(held(w.life.clock.spec('mess'), { ...free, stars: 5 })).toBe(false);
    expect(held(w.life.clock.spec('mess'), { ...free, playing: false })).toBe(true);
    w.heat.wanted.heat = 1.5;
    w.bus.emit({ type: 'shot', x: 9.5, z: 40, dirX: 0, dirZ: 1, weapon: 'pistol', byPlayer: true });
    expect(w.life.shotsFired.call).toBeNull();
  });
});
