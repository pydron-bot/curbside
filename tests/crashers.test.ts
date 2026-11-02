/**
 * RACE CRASHER and VAN NICKED (V2-12): the pure rules (joining a race's
 * line, passing its junctions, who's ahead; when a queue's after the van,
 * when it pays, when they give up), then each hook end to end on the real
 * city, with heat and the city's life stepped together as main.ts's
 * simulate() does: a race joined and won (the prize handed over), a race
 * joined and lost, a city van taken from its queue and driven off, the
 * player's own chime queue, and the queue that never saw the van go.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ColorRepresentation } from 'three';
import { EventBus, type GameEvent } from '../src/core/events';
import { VEHICLE_HEALTH, VEHICLE_SPECS, createVehicleState, stepVehicle, type VehicleArchetype, type VehicleControls } from '../src/entities/vehicle';
import { CityLife } from '../src/game/cityLife';
import { Heat } from '../src/game/heat';
import { Player } from '../src/game/player';
import { Population, type Vehicle } from '../src/game/population';
import { IceCream } from '../src/game/scenes/iceCream';
import type { CarMesh } from '../src/render/carMesh';
import type { CharacterModel } from '../src/render/characterModel';
import { spawnPed, stepCrowdPed } from '../src/systems/crowd';
import { createDamage } from '../src/systems/damage';
import { JOIN_GAP, JOIN_LEGS_LEFT, JOIN_SPEED, PASS_RADIUS, PRIZE_KEEP, ahead, joinsRace, passes, routeLeg, type RaceNode } from '../src/systems/raceCrasher';
import { CHASE_GAP, NICK_OFF, NICK_PAY_QUEUE, NICK_WAIT, chaserVerdict, nickPays, nickStarts, surroundSpot } from '../src/systems/vanNicked';
import { STAMPS, StampDetector } from '../src/systems/stamps';
import { STREET_TOPICS, TOPICS } from '../src/systems/scanner';
import { Score } from '../src/systems/score';
import { type Obstacle } from '../src/systems/traffic';
import { BLOCK_SIZE, generateCity, type Rect } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { LANE_OFFSET, dirHeading } from '../src/world/roads';
import { random } from './helpers';

const DT = 1 / 60;

// --- The rules ---------------------------------------------------------------------

describe('race crasher: the rules', () => {
  // East from (0, 0) to (1, 0) and (2, 0), then south to (2, 1).
  const route: RaceNode[] = [
    { ix: 1, iz: 0, dir: 1 },
    { ix: 2, iz: 0, dir: 1 },
    { ix: 2, iz: 1, dir: 2 },
  ];
  const east = dirHeading(1);

  it('finds the leg a car is on, the race way round, on the road and not the pavement', () => {
    // In the eastbound lane between (0, 0) and (1, 0): driving to node 0.
    expect(routeLeg(route, 30, LANE_OFFSET, east)).toBe(0);
    expect(routeLeg(route, BLOCK_SIZE + 30, LANE_OFFSET, east)).toBe(1);
    // Going south down x = 128 toward (2, 1).
    expect(routeLeg(route, 2 * BLOCK_SIZE - LANE_OFFSET, 30, dirHeading(2))).toBe(2);
    // The wrong way, across it, off the road, off the route.
    expect(routeLeg(route, 30, LANE_OFFSET, dirHeading(3))).toBe(-1);
    expect(routeLeg(route, 30, LANE_OFFSET, dirHeading(2))).toBe(-1);
    expect(routeLeg(route, 30, 14, east)).toBe(-1);
    expect(routeLeg(route, -30, LANE_OFFSET, east)).toBe(-1);
    // A little off straight still counts.
    expect(routeLeg(route, 30, LANE_OFFSET, east + 0.4)).toBe(0);
  });

  it('joins at speed, near a racer, with junctions to go and nobody home yet', () => {
    const ok = { leg: 0, legs: 5, speed: JOIN_SPEED + 2, gap: 10, won: false };
    expect(joinsRace(ok)).toBe(true);
    expect(joinsRace({ ...ok, leg: -1 })).toBe(false);
    expect(joinsRace({ ...ok, speed: JOIN_SPEED - 0.5 })).toBe(false);
    expect(joinsRace({ ...ok, gap: JOIN_GAP + 1 })).toBe(false);
    expect(joinsRace({ ...ok, won: true })).toBe(false);
    // Not on the run-in.
    expect(joinsRace({ ...ok, leg: 5 - JOIN_LEGS_LEFT })).toBe(true);
    expect(joinsRace({ ...ok, leg: 5 - JOIN_LEGS_LEFT + 1 })).toBe(false);
  });

  it('passes a junction through its middle, and ranks further on, then nearer', () => {
    expect(passes(route[0], BLOCK_SIZE, LANE_OFFSET)).toBe(true);
    expect(passes(route[0], BLOCK_SIZE - PASS_RADIUS - 1, LANE_OFFSET)).toBe(false);
    expect(ahead(2, 50, 1, 5)).toBe(true);
    expect(ahead(1, 5, 1, 20)).toBe(true);
    expect(ahead(1, 20, 1, 5)).toBe(false);
  });
});

describe('van nicked: the rules', () => {
  it('starts once the van has gone, and pays only for the city queue, once', () => {
    expect(nickStarts(0, 0, NICK_OFF - 0.5, 0)).toBe(false);
    expect(nickStarts(0, 0, 0, NICK_OFF + 0.5)).toBe(true);
    expect(nickPays(false, NICK_PAY_QUEUE, false)).toBe(true);
    expect(nickPays(false, NICK_PAY_QUEUE - 1, false)).toBe(false);
    expect(nickPays(true, 9, false)).toBe(false);
    expect(nickPays(false, 9, true)).toBe(false);
  });

  it('gives up on its own time, or left behind', () => {
    expect(chaserVerdict(3, 10, 5)).toBe('chase');
    expect(chaserVerdict(10, 10, 5)).toBe('giveUp');
    expect(chaserVerdict(3, 10, CHASE_GAP + 1)).toBe('giveUp');
  });

  it('spreads them round the one they caught', () => {
    const a = surroundSpot(0, 0, 0, 4, 2, { x: 0, z: 0 });
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(2);
    const b = { ...surroundSpot(0, 0, 2, 4, 2, { x: 0, z: 0 }) };
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(4);
  });

  it('are stamps, scanner lines and score kinds of their own', () => {
    expect(STAMPS.raceCrasher.label).toBe('RACE CRASHER');
    expect(STAMPS.vanNicked.label).toBe('VAN NICKED');
    const d = new StampDetector();
    const score = new Score();
    expect(d.handle({ type: 'award', award: score.award('raceCrasher') }, 1)).toBe('raceCrasher');
    expect(d.handle({ type: 'award', award: score.award('vanNicked') }, 9)).toBe('vanNicked');
    expect(STREET_TOPICS.vanNicked).toBe('vanNicked');
    expect(TOPICS[STREET_TOPICS.raceCrasher!].lines.length).toBeGreaterThan(0);
  });
});

// --- On the real city ----------------------------------------------------------------

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
  });
  const life = new CityLife({
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
    // Nothing starts on its own: the tests begin what they're about.
    activity: () => true,
    stars: () => heat.wanted.level,
    opening: () => false,
    keep: () => false,
    avoid: [],
    busStops: [],
    vendors: [],
    trafficScale: () => 1,
    npcShoot: () => {},
    collect: () => false,
    focus: () => player.position,
    award: (kind) => award(score.award(kind)),
  });
  const car = (archetype: VehicleArchetype, vx: number, vz: number, heading = 0): Vehicle => {
    const v = population.takeVehicle(archetype, '#888');
    v.police = false;
    Object.assign(v.sim, createVehicleState(vx, vz, heading));
    Object.assign(v.prev, v.sim);
    v.ai = null;
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
  /** The player's car this step: driven by `drive` (kinematic: set its velocity, it's moved along it). */
  let drive: ((s: Vehicle['sim']) => void) | null = null;
  function step() {
    obstacles.length = 0;
    for (const v of vehicles) if (v.mesh.root.visible) obstacles.push({ x: v.sim.x, z: v.sim.z, halfWidth: 1, player: v === player.driving, owner: v.sim });
    for (const v of vehicles) {
      if (!v.mesh.root.visible) continue;
      Object.assign(v.prev, v.sim);
      if (v === player.driving && drive) {
        drive(v.sim);
        v.sim.x += v.sim.vx * DT;
        v.sim.z += v.sim.vz * DT;
        continue;
      }
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
  const setDrive = (f: ((s: Vehicle['sim']) => void) | null) => (drive = f);
  const street = (what: string) => log.filter((e) => e.type === 'street' && e.what === what).length;
  return { bus, log, heat, life, player, vehicles, population, car, ped, run, awards, setDrive, street };
}

type World = ReturnType<typeof world>;

/** Steer the kinematic car at (x, z) at `speed` m/s. */
function toward(s: Vehicle['sim'], x: number, z: number, speed: number): void {
  const dx = x - s.x;
  const dz = z - s.z;
  const d = Math.hypot(dx, dz) || 1;
  s.heading = Math.atan2(dx, dz);
  s.vx = (dx / d) * speed;
  s.vz = (dz / d) * speed;
}

/** A race lined up near the player (no police), and the player's car on its line beside the leader, rolling. */
function lineUp(w: World) {
  const races = w.life.races;
  expect(races.begin()).toBe(true);
  const r = races.races[0];
  r.police = Infinity;
  const lead = r.racers[0].v;
  const h = lead.sim.heading;
  const mine = w.car('muscle', lead.sim.x - Math.sin(h) * 3, lead.sim.z - Math.cos(h) * 3, h);
  mine.sim.vx = Math.sin(h) * 14;
  mine.sim.vz = Math.cos(h) * 14;
  w.player.enter(mine);
  return { races, r, mine };
}

/** The player drives the route from wherever they are: each junction's middle in turn at `speed`, then on past the last. */
function driveRoute(w: World, r: ReturnType<typeof lineUp>['r'], speed: () => number) {
  w.setDrive((s) => {
    const c = r.crasher;
    const k = c ? Math.min(c.next, r.route.length - 1) : 0;
    const n = r.route[k];
    if (c && c.next >= r.route.length) {
      // Through: straight on.
      const h = dirHeading(n.dir);
      toward(s, s.x + Math.sin(h) * 10, s.z + Math.cos(h) * 10, speed());
    } else toward(s, n.ix * BLOCK_SIZE, n.iz * BLOCK_SIZE, speed());
  });
}

describe('RACE CRASHER on the real city', () => {
  it("pulled onto the line, the player's in; first through the last junction wins, and the leader's car is handed over", () => {
    const w = world();
    const { races, r } = lineUp(w);
    driveRoute(w, r, () => 34);
    w.run(0.2);
    expect(r.crasher).not.toBeNull();
    expect(races.crashed.joined).toBe(1);
    expect(w.street('raceJoin')).toBe(1);
    // Faster than the racers (who don't slow or speed up for anyone): through every junction first.
    expect(w.run(40, () => races.crashed.won > 0)).toBe(true);
    expect(r.winner).toBe(w.player.driving);
    expect(w.awards).toContain('RACE CRASHER');
    expect(w.street('raceCrasher')).toBe(1);
    // The leader of the rest pulls up; its driver gets out and leaves it for the player.
    const prize = races.prize!;
    expect(prize).not.toBeNull();
    const v = prize.v;
    expect(r.racers.some((x) => x.v === v)).toBe(true);
    w.setDrive((s) => toward(s, s.x, s.z, 0));
    expect(w.run(12, () => prize.handed)).toBe(true);
    expect(v.ai).toBeNull();
    expect(Math.hypot(v.sim.vx, v.sim.vz)).toBeLessThan(0.6);
    // Kept from the city's scenes (tows, the ice cream van, double-parking) and from Population's recycling.
    expect(w.life.keeps(v)).toBe(true);
    expect(v.ambient).toBe(true);
    expect(w.life.owned.includes(v)).toBe(false);
    // Taken: no driver to throw out (no carjack), and it's an ordinary car from then on.
    w.player.exit();
    w.player.enter(v);
    w.run(0.1);
    expect(races.prize).toBeNull();
    expect(v.ambient).toBe(false);
    expect(w.life.keeps(v)).toBe(false);
    expect(w.log.some((e) => e.type === 'carjack')).toBe(false);
  });

  it('joined and beaten: no award, no prize, and the race carries on without them', () => {
    const w = world();
    const { races, r } = lineUp(w);
    let speed = 14;
    driveRoute(w, r, () => speed);
    w.run(0.2);
    expect(r.crasher).not.toBeNull();
    speed = 6;
    expect(w.run(60, () => r.winner !== null || !races.races.includes(r))).toBe(true);
    expect(r.crasher!.out).toBe(true);
    expect(r.crasher!.won).toBe(false);
    expect(races.crashed.lost).toBe(1);
    expect(w.awards).not.toContain('RACE CRASHER');
    expect(races.prize).toBeNull();
  });

  it("the wrong way, or too slow, isn't joining", () => {
    const w = world();
    const { races, r, mine } = lineUp(w);
    // Turned round against the race.
    mine.sim.heading += Math.PI;
    w.setDrive((s) => toward(s, s.x + Math.sin(s.heading), s.z + Math.cos(s.heading), 14));
    w.run(0.5);
    expect(r.crasher).toBeNull();
    // On its way, but crawling.
    const w2 = world(5);
    const two = lineUp(w2);
    w2.setDrive((s) => toward(s, s.x + Math.sin(s.heading), s.z + Math.cos(s.heading), JOIN_SPEED - 3));
    w2.run(0.5);
    expect(two.r.crasher).toBeNull();
    expect(races.crashed.joined + two.races.crashed.joined).toBe(0);
  });

  it('a prize left waiting goes back to the city after a while', () => {
    const w = world();
    const { races, r } = lineUp(w);
    driveRoute(w, r, () => 34);
    expect(w.run(40, () => races.crashed.won > 0)).toBe(true);
    const v = races.prize!.v;
    w.setDrive((s) => toward(s, s.x, s.z, 0));
    expect(w.run(12, () => races.prize?.handed === true)).toBe(true);
    w.run(PRIZE_KEEP);
    expect(races.prize).toBeNull();
    expect(v.ambient).toBe(false);
    expect(w.life.keeps(v)).toBe(false);
  });
});

/** The city's ice cream van open by the player, a queue at its hatch; the player takes it (as main.ts's carjack does). */
function openVan(w: World) {
  const ice = w.life.scenes.find((s): s is IceCream => s instanceof IceCream)!;
  expect(ice.force()).toBe(true);
  const van = ice.vans[ice.vans.length - 1].v;
  const queue = [...ice.vans[ice.vans.length - 1].queue.members];
  expect(queue.length).toBe(3);
  // The carjack: the driver out (ejectDriver), the player in.
  van.ai = null;
  w.player.enter(van);
  return { van, queue };
}

describe('VAN NICKED on the real city', () => {
  it("drive the city's van off from its queue and they come after you on foot, then give up; none of it heat", () => {
    const w = world();
    const { van, queue } = openVan(w);
    const nicked = w.life.vanNicked;
    w.run(0.2);
    // Handed over, staring: nothing paid till it goes.
    expect(nicked.chasers.length).toBe(3);
    expect(nicked.chasing).toBe(false);
    expect(w.awards).not.toContain('VAN NICKED');
    // Off up the road at a jog: after it.
    const h = van.sim.heading;
    w.setDrive((s) => toward(s, s.x + Math.sin(h) * 10, s.z + Math.cos(h) * 10, 4));
    w.run(2);
    expect(nicked.chasing).toBe(true);
    expect(w.awards.filter((a) => a === 'VAN NICKED').length).toBe(1);
    expect(w.street('vanNicked')).toBe(1);
    for (const c of queue) {
      expect(c.agent.mode).toBe('arrest');
      expect(c.agent.suspect).toBeFalsy();
    }
    // Running after it: closer to the van than where they queued.
    const gap0 = Math.hypot(queue[0].agent.s.x - van.sim.x, queue[0].agent.s.z - van.sim.z);
    w.run(1.5);
    expect(Math.hypot(queue[0].agent.s.x - van.sim.x, queue[0].agent.s.z - van.sim.z)).toBeLessThan(gap0 + 2);
    // Floored, one of them is an assault like anyone else's.
    const hit = queue[2];
    const heat0 = w.heat.wanted.heat;
    expect(heat0).toBe(0);
    hit.agent.mode = 'down';
    hit.agent.timer = 3;
    w.bus.emit({ type: 'pedDown', x: hit.agent.s.x, z: hit.agent.s.z, cause: 'vehicle', byPlayer: true, suspect: hit.agent.suspect });
    w.run(0.1);
    expect(w.heat.wanted.heat).toBeGreaterThan(0);
    expect(nicked.chasers.some((ch) => ch.c === hit)).toBe(false);
    expect(hit.agent.scene).toBe(false);
    // Flat out: left behind, they give up, glare and walk on. No calls, no paying twice.
    w.setDrive((s) => toward(s, s.x + Math.sin(h) * 10, s.z + Math.cos(h) * 10, 16));
    expect(w.run(20, () => nicked.chasers.length === 0)).toBe(true);
    for (const c of queue.slice(0, 2)) {
      expect(c.agent.scene).toBe(false);
      expect(c.agent.mode).toBe('walk');
    }
    expect(w.street('witnessCall')).toBe(0);
    expect(w.awards.filter((a) => a === 'VAN NICKED').length).toBe(1);
  });

  it('taken but never driven off: they shrug and walk on, unpaid', () => {
    const w = world();
    const { queue } = openVan(w);
    w.run(NICK_WAIT + 1);
    expect(w.life.vanNicked.chasers.length).toBe(0);
    for (const c of queue) expect(c.agent.scene).toBe(false);
    expect(w.awards).not.toContain('VAN NICKED');
    expect(w.street('vanNicked')).toBe(0);
  });

  it("the player's own chime queue chases unpaid, and catching the van parked with its chime on, they queue again", () => {
    const w = world();
    const van = w.car('ice_cream_van', 9.5, 40, 0);
    w.player.enter(van);
    const people = [w.ped(5, 34), w.ped(14, 46), w.ped(3, 44)];
    w.life.tools.control(true, false, null);
    w.setDrive((s) => toward(s, s.x, s.z, 0));
    w.run(3);
    expect(w.life.tools.queue.members.length).toBe(3);
    // Off up the road 12 m, then stop with the chime still on.
    let go = true;
    w.setDrive((s) => {
      if (s.z > 52) go = false;
      toward(s, 9.5, s.z + 10, go ? 6 : 0);
    });
    w.run(3);
    const nicked = w.life.vanNicked;
    expect(nicked.own).toBe(true);
    expect(nicked.counts.own).toBe(1);
    expect(w.awards).not.toContain('VAN NICKED');
    // They catch it up, and with the jingle playing, back in the queue they go.
    expect(w.run(12, () => w.life.tools.queue.members.length === 3)).toBe(true);
    expect(nicked.chasers.length).toBe(0);
    expect(nicked.counts.queued).toBe(3);
    for (const c of people) expect(c.agent.scene).toBe(true);
  });
});
