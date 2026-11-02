import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../src/core/events';
import {
  CAR_BODY,
  FLAT_TOP,
  VEHICLE_BODIES,
  VEHICLE_HEALTH,
  VEHICLE_SPECS,
  createVehicleState,
  forwardSpeed,
  stepVehicle,
  type VehicleArchetype,
  type VehicleState,
} from '../src/entities/vehicle';
import { Combat, type AimInput } from '../src/game/combat';
import { categoryOf } from '../src/game/modes/chaosRun';
import { Player } from '../src/game/player';
import type { CrowdPed, Vehicle } from '../src/game/population';
import type { CarMesh } from '../src/render/carMesh';
import { createDamage } from '../src/systems/damage';
import { Projectiles, type ProjectileWorld } from '../src/systems/projectiles';
import { STREET_TOPICS, TOPICS } from '../src/systems/scanner';
import { BASE_POINTS, Score } from '../src/systems/score';
import {
  DROP_BEHIND,
  MAX_STINGERS,
  SLEW_SLIDE,
  STINGER_BITES,
  STINGER_LENGTH,
  STINGER_LIFE,
  Stingers,
  burstTyres,
  stingerAcross,
  stingerTouches,
  type Stinger,
} from '../src/systems/stinger';
import { driverFor } from '../src/systems/traffic';
import { WEAPONS } from '../src/systems/weapons';
import { BLOCK_SIZE, ROAD_WIDTH } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const DT = 1 / 60;
const coast = { throttle: 0, steer: 0, handbrake: false };
const floor = { throttle: 1, steer: 0, handbrake: false };

function strip(x: number, z: number, ax = 1, az = 0): Stinger {
  return { alive: true, x, z, ax, az, age: 0, bites: 0, byPlayer: true };
}

/** A car at (x, z) heading `heading`, moving along it at `speed`. */
function moving(x: number, z: number, heading: number, speed: number): VehicleState {
  const s = createVehicleState(x, z, heading);
  s.vx = Math.sin(heading) * speed;
  s.vz = Math.cos(heading) * speed;
  return s;
}

/** Drive `s` straight on at its speed for `seconds`: did it touch the strip on the way? */
function drivesOver(st: Stinger, s: VehicleState, seconds: number): boolean {
  for (let t = 0; t < seconds; t += DT) {
    s.x += s.vx * DT;
    s.z += s.vz * DT;
    if (stingerTouches(st, s, CAR_BODY)) return true;
  }
  return false;
}

describe('stinger: laying it', () => {
  const at = { x: 0, z: 0, ax: 0, az: 0 };

  it('on a north-south road it lies east-west across it, kept on the tarmac', () => {
    // x = 0 is a road centreline; z = 20 is between junctions.
    stingerAcross(1, 20, 0, 1, at);
    expect(at).toMatchObject({ x: 1, z: 20, ax: 1, az: 0 });
    // Landing near the kerb: the strip's pulled in so its end is at the kerb, not on the pavement.
    stingerAcross(7, 20, 0, 1, at);
    expect(at.x + STINGER_LENGTH / 2).toBeCloseTo(ROAD_WIDTH / 2);
    // Thrown at an angle makes no difference: across the road it goes.
    stingerAcross(BLOCK_SIZE - 6.5, -BLOCK_SIZE - 25, 0.7, 0.7, at);
    expect(at).toMatchObject({ ax: 1, az: 0 });
    expect(at.x).toBeCloseTo(BLOCK_SIZE - (ROAD_WIDTH - STINGER_LENGTH) / 2);
  });

  it('on an east-west road it lies north-south', () => {
    stingerAcross(30, BLOCK_SIZE + 2, 1, 0, at);
    expect(at).toMatchObject({ x: 30, z: BLOCK_SIZE + 2, ax: 0, az: 1 });
  });

  it('in a junction or off the road, square to the way it was thrown', () => {
    stingerAcross(2, -3, 0, 5, at); // the junction at the origin, thrown north... south (+Z)
    expect(at.x).toBe(2);
    expect(Math.abs(at.ax)).toBeCloseTo(1);
    expect(at.az).toBeCloseTo(0);
    stingerAcross(30, 30, 3, 4, at); // in a block
    expect(at.ax * 3 + at.az * 4).toBeCloseTo(0);
    expect(Math.hypot(at.ax, at.az)).toBeCloseTo(1);
  });
});

describe('stinger: crossing it', () => {
  it('a car driven straight over it touches it; one passing its end or alongside does not', () => {
    const st = strip(0, 0);
    expect(drivesOver(st, moving(1.5, 10, Math.PI, 30), 1)).toBe(true);
    expect(drivesOver(st, moving(-3.5, -10, 0, 12), 2)).toBe(true);
    // Just past the end (the strip is ±4 m, the car ~1 m wide).
    expect(drivesOver(st, moving(STINGER_LENGTH / 2 + 2, 10, Math.PI, 20), 1.5)).toBe(false);
    // Driving along beside it.
    expect(drivesOver(st, moving(-10, 1.8, Math.PI / 2, 20), 1.5)).toBe(false);
  });

  it('a car in the air over it is spared', () => {
    const s = moving(0, 0.5, Math.PI, 20);
    expect(stingerTouches(strip(0, 0), s, CAR_BODY)).toBe(true);
    s.y = 1.2;
    expect(stingerTouches(strip(0, 0), s, CAR_BODY)).toBe(false);
  });

  it('a long vehicle is caught by its axles anywhere along it', () => {
    const bus = VEHICLE_BODIES.bus;
    const s = moving(0, 0, Math.PI, 10);
    // The strip under the bus's back wheels.
    s.z = bus.offsets[0] * -1;
    expect(stingerTouches(strip(0, 0), s, bus)).toBe(true);
  });

  it('bursting: flat, a pull one way, and a slew as hard as it was going fast', () => {
    const rand = random(4);
    const fast = moving(0, 0, 0, 30);
    const tyres = createDamage(100);
    burstTyres(fast, tyres, rand);
    expect(tyres.flat).toBe(1);
    expect(Math.abs(tyres.pull!)).toBeGreaterThan(0.4);
    expect(fast.slide).toBeCloseTo(SLEW_SLIDE);
    expect(Math.sign(fast.yawRate)).toBe(Math.sign(tyres.pull!));
    const crawl = moving(0, 0, 0, 2);
    burstTyres(crawl, createDamage(100), rand);
    expect(crawl.slide).toBeLessThan(0.1);
    expect(Math.abs(crawl.yawRate)).toBeLessThan(0.15);
  });
});

describe('stinger: on the rims', () => {
  it('half the top speed flat out, and a car already going fast scrubs down to it', () => {
    const spec = VEHICLE_SPECS.sedan;
    const s = createVehicleState(0, 0, 0);
    const tyres = { flat: 1, pull: 0 };
    for (let t = 0; t < 20; t += DT) stepVehicle(s, floor, spec, DT, tyres);
    expect(forwardSpeed(s)).toBeCloseTo(spec.maxSpeed * (1 - FLAT_TOP), 0);
    const fast = moving(0, 0, 0, spec.maxSpeed);
    for (let t = 0; t < 4; t += DT) stepVehicle(fast, floor, spec, DT, tyres);
    expect(forwardSpeed(fast)).toBeLessThan(spec.maxSpeed * (1 - FLAT_TOP) + 1);
    // Good tyres keep their pace.
    const fine = moving(0, 0, 0, spec.maxSpeed);
    for (let t = 0; t < 4; t += DT) stepVehicle(fine, floor, spec, DT);
    expect(forwardSpeed(fine)).toBeGreaterThan(spec.maxSpeed - 1);
  });

  it('the flats pull the nose their way with the wheel straight; good tyres run true', () => {
    const spec = VEHICLE_SPECS.police;
    for (const pull of [-1, 1]) {
      const s = moving(0, 0, 0, 12);
      for (let t = 0; t < 1.5; t += DT) stepVehicle(s, floor, spec, DT, { flat: 1, pull });
      expect(Math.sign(s.heading)).toBe(pull);
      expect(Math.abs(s.heading)).toBeGreaterThan(0.2);
    }
    const s = moving(0, 0, 0, 12);
    for (let t = 0; t < 1.5; t += DT) stepVehicle(s, floor, spec, DT, { flat: 0, pull: 1 });
    expect(s.heading).toBeCloseTo(0, 5);
  });

  it('a mended car (a fresh DamageState: respray, recycling) has good tyres again', () => {
    expect(createDamage(100).flat ?? 0).toBe(0);
  });
});

describe('stinger: the pool', () => {
  it('at most MAX_STINGERS down (the oldest pulled up), each for its life or its bites', () => {
    const pool = new Stingers();
    const at = { x: 0, z: 0, ax: 1, az: 0 };
    const first = pool.lay(at, true);
    pool.step(1);
    for (let i = 1; i < MAX_STINGERS; i++) {
      at.x = i * 20;
      pool.lay(at, true);
      pool.step(0.5);
    }
    at.x = 99;
    const next = pool.lay(at, false);
    expect(next).toBe(first);
    expect(next).toMatchObject({ x: 99, age: 0, bites: 0, byPlayer: false });
    for (let i = 0; i < STINGER_BITES - 1; i++) pool.bite(next);
    expect(next.alive).toBe(true);
    pool.bite(next);
    expect(next.alive).toBe(false);
    pool.step(STINGER_LIFE);
    expect(pool.active).toBe(false);
  });
});

describe('stinger: thrown', () => {
  it('flies folded and lies where it lands, square to the throw', () => {
    const laid: Array<{ x: number; z: number; dirX: number; dirZ: number }> = [];
    const w: ProjectileWorld = {
      grid: new StaticGrid([]),
      rocketHits: () => false,
      bottleHits: () => true, // a car body in the way doesn't stop it, unlike a bottle
      explode: () => {},
      ignite: () => {},
      lay: (x, z, dirX, dirZ) => laid.push({ x, z, dirX, dirZ }),
    };
    const pr = new Projectiles();
    pr.throw('stinger', 0, 0, 0, 10, true);
    for (let t = 0; t < 3; t += DT) pr.step(DT, w);
    expect(laid).toHaveLength(1);
    expect(laid[0].z).toBeCloseTo(10, 0);
    expect(laid[0].dirZ).toBeGreaterThan(0);
    expect(pr.active).toBe(false);
  });
});

// --- In play: Combat --------------------------------------------------------

function car(x: number, z: number, heading: number, archetype: VehicleArchetype = 'sedan'): Vehicle {
  const sim = createVehicleState(x, z, heading);
  sim.body = VEHICLE_BODIES[archetype];
  return {
    archetype,
    paint: '#fff',
    sim,
    prev: { ...sim },
    mesh: { root: {}, frontWheels: [] } as unknown as CarMesh,
    ai: null,
    damage: createDamage(VEHICLE_HEALTH[archetype]),
    wreckAge: 0,
    charred: false,
  };
}

function setup(px = 0, pz = 20) {
  const bus = new EventBus();
  const log: GameEvent[] = [];
  bus.onAny((e) => log.push(e));
  const player = new Player(bus, px, pz, 0); // facing +Z
  const vehicles: Vehicle[] = [];
  const crowd: CrowdPed[] = [];
  let time = 0;
  const combat = new Combat({
    bus,
    player,
    vehicles,
    crowd,
    grid: new StaticGrid([]),
    rand: random(9),
    score: new Score(),
    award: (a) => a && bus.emit({ type: 'award', award: a }),
    ejectDriver: () => {},
    now: () => time,
    playing: () => true,
    focus: () => ({ x: 0, z: 0 }),
    stars: () => 0,
  });
  /** Run the sim: the cars driven as they are (coasting), combat stepped. */
  const step = (seconds: number) => {
    for (let t = 0; t < seconds; t += DT) {
      time += DT;
      player.step(DT);
      for (const v of vehicles) if (v !== player.driving) stepVehicle(v.sim, coast, VEHICLE_SPECS[v.archetype], DT, v.damage);
      combat.step(DT);
    }
  };
  const events = <T extends GameEvent['type']>(type: T) => log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
  return { bus, log, player, vehicles, combat, step, events };
}

const noAim: AimInput = { heading: null, reach: 0, ground: null };

describe('stinger: in play', () => {
  it('thrown onto a road it lies across it; the cars that drive over have their tyres burst (police too), and a police car scores SPIKED', () => {
    const w = setup();
    w.player.arsenal.pickUp('stinger');
    expect(w.player.arsenal.current).toBe('stinger');
    expect(w.combat.fire({ heading: null, reach: 0, ground: { x: 1, z: 30 } })).toBe(true);
    w.step(1.2);
    const laid = w.events('stinger');
    expect(laid).toHaveLength(1);
    expect(laid[0]).toMatchObject({ ax: 1, az: 0, byPlayer: true, dropped: false });
    expect(laid[0].z).toBeCloseTo(30, 0);
    // Northbound traffic and a police car in the other lane, both heading over it.
    const sedan = car(-2, 50, Math.PI);
    sedan.ai = driverFor(sedan.sim, random(3));
    const cop = car(2.5, 10, 0, 'police');
    cop.police = true;
    for (const v of [sedan, cop]) {
      v.sim.vx = Math.sin(v.sim.heading) * 18;
      v.sim.vz = Math.cos(v.sim.heading) * 18;
    }
    w.vehicles.push(sedan, cop);
    w.step(2);
    expect(sedan.damage.flat).toBe(1);
    expect(cop.damage.flat).toBe(1);
    // Traffic stamps on the brake.
    expect(sedan.ai.startled).toBeGreaterThan(0);
    const bursts = w.events('tyresBurst');
    expect(bursts).toHaveLength(2);
    expect(bursts.find((e) => e.police)).toMatchObject({ byPlayer: true, own: false });
    expect(w.combat.stingers.list.find((s) => s.alive)!.bites).toBe(2);
    expect(w.events('award').map((e) => e.award.kind)).toEqual(['spiked']);
    expect(w.events('street').map((e) => e.what)).toEqual(['spiked']);
    // A car already on its rims doesn't burst again.
    w.step(3);
    expect(w.events('tyresBurst')).toHaveLength(2);
  });

  it('in a car, FIRE drops it out of the back, across the road behind; the guns still come first for a drive-by', () => {
    const w = setup(0, 30);
    const mine = car(0, 30, Math.PI); // heading south (-Z) down the x = 0 road
    w.vehicles.push(mine);
    expect(w.player.enter(mine)).toBe(true);
    w.player.arsenal.pickUp('stinger');
    expect(w.player.arsenal.driveByGun()).toBeNull();
    w.player.arsenal.pickUp('smg');
    expect(w.player.arsenal.driveByGun()).toBe('smg');
    w.player.arsenal.current = 'stinger';
    expect(w.combat.driveBy(null)).toBe(true);
    const laid = w.events('stinger');
    expect(laid).toHaveLength(1);
    expect(laid[0]).toMatchObject({ dropped: true, ax: 1, az: 0 });
    // Behind: north of the car, past its back bumper.
    expect(laid[0].z).toBeCloseTo(30 + CAR_BODY.reach + DROP_BEHIND);
    expect(w.events('shot')).toHaveLength(0);
    expect(w.player.arsenal.ammo.get('stinger')).toBe(WEAPONS.stinger.pickupAmmo - 1);
    // Driving on, the player's own car isn't caught by it...
    w.step(0.5);
    expect(mine.damage.flat ?? 0).toBe(0);
    // ...but reversing over it is.
    mine.sim.vz = 8;
    for (let t = 0; t < 1.5; t += DT) {
      mine.sim.z += mine.sim.vz * DT;
      w.step(DT);
    }
    expect(mine.damage.flat).toBe(1);
    expect(w.events('tyresBurst')[0]).toMatchObject({ own: true });
    expect(w.events('award')).toHaveLength(0);
  });

  it('chewed up after STINGER_BITES cars, gone after STINGER_LIFE', () => {
    const w = setup();
    w.player.arsenal.pickUp('stinger');
    w.combat.fire({ heading: null, reach: 0, ground: { x: 0, z: 30 } });
    w.step(1.2);
    for (let i = 0; i < STINGER_BITES + 1; i++) {
      const v = car(-3 + i, 34 + i * 6, Math.PI);
      v.sim.vz = -15;
      w.vehicles.push(v);
    }
    w.step(5);
    expect(w.events('tyresBurst')).toHaveLength(STINGER_BITES);
    expect(w.combat.stingers.active).toBe(false);
    w.player.arsenal.pickUp('stinger');
    w.step(WEAPONS.stinger.interval);
    w.combat.fire(noAim);
    w.step(1.2);
    expect(w.combat.stingers.active).toBe(true);
    w.step(STINGER_LIFE);
    expect(w.combat.stingers.active).toBe(false);
  });

  it('shows where it would lie: at the throw marker on foot, behind the car in one', () => {
    const w = setup();
    const at = { x: 0, z: 0, ax: 0, az: 0 };
    expect(w.combat.stingerAim(at)).toBe(false);
    w.player.arsenal.pickUp('stinger');
    w.combat.updateAim(false, noAim);
    expect(w.combat.stingerAim(at)).toBe(true);
    expect(at).toMatchObject({ x: w.combat.marker.x, z: w.combat.marker.z, ax: 1 });
  });
});

describe('stinger: score and scanner', () => {
  it('SPIKED is a cops award; the scanner has a line for it', () => {
    expect(BASE_POINTS.spiked).toBeGreaterThan(0);
    expect(categoryOf('spiked')).toBe('cops');
    expect(STREET_TOPICS.spiked).toBe('spiked');
    expect(TOPICS.spiked.lines.length).toBeGreaterThan(0);
  });
});
