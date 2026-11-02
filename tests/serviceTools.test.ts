/**
 * Borrowed Blues (V2-09): the tools' pure rules (systems/serviceTools.ts),
 * then the hose, chime and winch end to end on the real city through the
 * city's director, with the guard that keeps its own service runs off the
 * player's vehicle.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ColorRepresentation } from 'three';
import { EventBus, type GameEvent, type ToolWhat } from '../src/core/events';
import { VEHICLE_BODIES, VEHICLE_HEALTH, createVehicleState, type VehicleArchetype } from '../src/entities/vehicle';
import { CityLife } from '../src/game/cityLife';
import { Player } from '../src/game/player';
import { Population, type Vehicle } from '../src/game/population';
import type { ModeCtx } from '../src/game/modes/context';
import { ServiceMode } from '../src/game/modes/serviceMode';
import { FIRE_TRUCK, FireCrews } from '../src/game/scenes/fireCrews';
import type { ServiceTools } from '../src/game/scenes/serviceTools';
import type { DialogueCard } from '../src/ui/progressScreens';
import { ServiceRun } from '../src/game/scenes/service';
import { Tows } from '../src/game/scenes/tows';
import type { CarMesh } from '../src/render/carMesh';
import type { CharacterModel } from '../src/render/characterModel';
import { spawnPed } from '../src/systems/crowd';
import { FIRE_AT, createDamage } from '../src/systems/damage';
import { type Pose } from '../src/systems/emergency';
import {
  CHIME_EVERY,
  CHIME_FOR,
  CHIME_LEAVE,
  CHIME_LINGER,
  Chime,
  CONTRACT_EVERY,
  CONTRACT_FIRST,
  CONTRACT_PAY,
  DUTY_STREAK_BONUS,
  DUTY_STREAK_EVERY,
  HOOK_RANGE,
  HOSE_HALF_ANGLE,
  HOSE_RANGE,
  SCRAP_PAY,
  TOW_STREAK_BONUS,
  TOW_STREAK_EVERY,
  TOW_TOP_SPEED,
  capThrottle,
  clipJet,
  douse,
  guarded,
  hookDistance,
  hookable,
  hoseHeading,
  hoseHit,
  hosePush,
  streakPay,
  toolFor,
  towPay,
  towedPose,
  vexRings,
} from '../src/systems/serviceTools';
import { driverFor } from '../src/systems/traffic';
import { generateCity, type Rect } from '../src/world/city';
import { random } from './helpers';

const DT = 1 / 60;

describe('which vehicle has which tool', () => {
  it('the fire truck hoses, the ice cream van chimes, the tow truck winches; nothing else has one', () => {
    expect(toolFor('firetruck')).toBe('hose');
    expect(toolFor('ice_cream_van')).toBe('chime');
    expect(toolFor('tow_truck')).toBe('winch');
    for (const a of ['sedan', 'ambulance', 'bus', 'police', 'taxi'] as const) expect(toolFor(a)).toBeNull();
  });
});

describe('the hose cone', () => {
  it('hits what is ahead along the jet, within its reach and its angle', () => {
    // From the origin, north (+z).
    expect(hoseHit(0, 0, 0, 1, 0, 8, 0.4, HOSE_RANGE)).toBeCloseTo(8);
    // Off to the side, inside the cone's widening.
    const wide = 10 * Math.tan(HOSE_HALF_ANGLE);
    expect(hoseHit(0, 0, 0, 1, wide, 10, 0.4, HOSE_RANGE)).toBeGreaterThan(0);
    // Well wide of it, behind it, past its reach.
    expect(hoseHit(0, 0, 0, 1, 6, 10, 0.4, HOSE_RANGE)).toBe(-1);
    expect(hoseHit(0, 0, 0, 1, 0, -3, 0.4, HOSE_RANGE)).toBe(-1);
    expect(hoseHit(0, 0, 0, 1, 0, HOSE_RANGE + 2, 0.4, HOSE_RANGE)).toBe(-1);
    // A wall cut the jet short: only that far.
    expect(hoseHit(0, 0, 0, 1, 0, 8, 0.4, 5)).toBe(-1);
  });

  it('knocks back hardest at the nozzle', () => {
    expect(hosePush(0)).toBeGreaterThan(hosePush(HOSE_RANGE));
    expect(hosePush(HOSE_RANGE)).toBeGreaterThan(0);
  });

  it('stops at the first building in the way', () => {
    const rects = [
      { minX: -2, maxX: 2, minZ: 6, maxZ: 9 },
      { minX: -2, maxX: 2, minZ: 3, maxZ: 4 },
      { minX: 10, maxX: 12, minZ: 0, maxZ: 20 },
    ];
    expect(clipJet(rects, 0, 0, 0, 1, HOSE_RANGE)).toBeCloseTo(3);
    expect(clipJet(rects, 0, 0, 0, -1, HOSE_RANGE)).toBe(HOSE_RANGE);
    expect(clipJet(rects, 0, 0, 1, 0, HOSE_RANGE)).toBeCloseTo(10);
  });

  it('points where aimed, else at a fire ahead, else straight on', () => {
    const fires = [{ x: 5, z: 8, alive: true }];
    expect(hoseHeading(0, 2, 0, 0, fires)).toBe(2);
    expect(hoseHeading(0, null, 0, 0, fires)).toBeCloseTo(Math.atan2(5, 8));
    // A fire behind the truck, or out of reach: ahead.
    expect(hoseHeading(0, null, 0, 0, [{ x: 0, z: -8, alive: true }])).toBe(0);
    expect(hoseHeading(0, null, 0, 0, [{ x: 0, z: 40, alive: true }])).toBe(0);
  });

  it('douses a car that has caught (not a burnt-out wreck)', () => {
    const d = createDamage(100);
    d.health = 10;
    d.burning = true;
    expect(douse(d)).toBe(true);
    expect(d.burning).toBe(false);
    expect(d.health).toBeGreaterThan(100 * FIRE_AT);
    const w = createDamage(100);
    w.wrecked = true;
    expect(douse(w)).toBe(false);
  });
});

describe('the chime', () => {
  it('rings, anchors a queue once parked, and lets it go when the van drives off', () => {
    const c = new Chime();
    expect(c.step(DT, 0, 0, 0)).toBeNull();
    c.press();
    expect(c.step(DT, 0, 0, 5)).toBe('ring');
    // Still moving: no queue yet.
    expect(c.step(DT, 0, 0, 5)).toBeNull();
    expect(c.step(DT, 0, 0, 0)).toBe('park');
    expect(c.anchored).toBe(true);
    // The jingle again a while on.
    let rings = 0;
    for (let t = 0; t < CHIME_EVERY + 0.1; t += DT) if (c.step(DT, 0, 0, 0) === 'ring') rings++;
    expect(rings).toBe(1);
    // Rolling a little doesn't count as leaving; past CHIME_LEAVE does.
    expect(c.step(DT, CHIME_LEAVE - 1, 0, 2)).not.toBe('release');
    expect(c.step(DT, CHIME_LEAVE + 1, 0, 2)).toBe('release');
    expect(c.anchored).toBe(false);
  });

  it('lets the queue go a while after the chime stops, and a second press stops it', () => {
    const c = new Chime();
    c.press();
    c.step(DT, 0, 0, 0);
    c.step(DT, 0, 0, 0);
    expect(c.anchored).toBe(true);
    c.press();
    expect(c.on).toBe(false);
    let released = -1;
    for (let t = 0; t < CHIME_LINGER + 1; t += DT) if (c.step(DT, 0, 0, 0) === 'release') released = t;
    expect(released).toBeGreaterThan(CHIME_LINGER - 0.1);
    // Left alone it plays for CHIME_FOR.
    c.press();
    for (let t = 0; t < CHIME_FOR + 0.1; t += DT) c.step(DT, 0, 0, 0);
    expect(c.on).toBe(false);
  });
});

describe('the winch', () => {
  const end = { rear: false };
  it('measures to the nearer end of the car (and says which)', () => {
    const car: Pose = { x: 0, z: -10, heading: 0 };
    // The hook at z = -6: the car's nose (z = -7.6) is 1.6 m off.
    expect(hookDistance(0, -6, car, 2.4, end)).toBeCloseTo(1.6);
    expect(end.rear).toBe(false);
    expect(hookDistance(0, -14, car, 2.4, end)).toBeCloseTo(1.6);
    expect(end.rear).toBe(true);
  });

  it('takes wrecks, crashes and abandoned cars, never a parked one, a busy one, a burning one or a big one', () => {
    const ok = { towable: true, wrecked: false, burning: false, parked: false, busy: false, reach: 2.4, delivered: false };
    expect(hookable(ok)).toBe(true);
    expect(hookable({ ...ok, towable: false, wrecked: true })).toBe(true);
    expect(hookable({ ...ok, parked: true })).toBe(false);
    expect(hookable({ ...ok, busy: true })).toBe(false);
    expect(hookable({ ...ok, burning: true })).toBe(false);
    expect(hookable({ ...ok, reach: 3.5 })).toBe(false);
    expect(hookable({ ...ok, delivered: true })).toBe(false);
  });

  it('caps the truck at the tow speed: no gas at the cap, brakes over it, braking left alone', () => {
    expect(capThrottle(1, 5, TOW_TOP_SPEED)).toBe(1);
    expect(capThrottle(1, TOW_TOP_SPEED, TOW_TOP_SPEED)).toBe(0);
    expect(capThrottle(1, TOW_TOP_SPEED + 3, TOW_TOP_SPEED)).toBeLessThan(0);
    expect(capThrottle(-1, TOW_TOP_SPEED + 3, TOW_TOP_SPEED)).toBe(-1);
    expect(capThrottle(-1, -TOW_TOP_SPEED - 2, TOW_TOP_SPEED)).toBeGreaterThan(0);
    // Under it nothing changes.
    expect(capThrottle(0.4, 3, TOW_TOP_SPEED)).toBe(0.4);
  });

  it("the hooked car trails the truck's own path round a corner (no swinging wide over the kerb)", () => {
    // The truck drives north, then turns right round a 9 m radius into the east road.
    const truck: Pose = { x: 0, z: -30, heading: 0 };
    const car: Pose = { x: 0, z: -30 - 3.5 - 0.6 - 2.4, heading: 0 };
    const from: Pose = { ...car };
    const path: { x: number; z: number }[] = [];
    let worst = 0;
    const v = 6;
    for (let t = 0; t < 12; t += DT) {
      if (truck.z < 0) truck.z += v * DT;
      else if (truck.heading < Math.PI / 2) {
        truck.heading = Math.min(Math.PI / 2, truck.heading + (v / 9) * DT);
        truck.x = 9 - 9 * Math.cos(truck.heading);
        truck.z = 9 * Math.sin(truck.heading);
      } else truck.x += v * DT;
      path.push({ x: truck.x, z: truck.z });
      towedPose(truck, 3.5, 2.4, car, false, from, 1, car);
      // How far the car's middle is off the line the truck drove.
      let d = Infinity;
      for (const p of path) d = Math.min(d, Math.hypot(p.x - car.x, p.z - car.z));
      if (path.length > 120) worst = Math.max(worst, d);
    }
    // A trailer cuts a little inside a tight turn: well within a lane (ROAD_WIDTH 16 m, two lanes), never out over the kerb.
    expect(worst).toBeLessThan(1);
    // And it ends up straight behind, facing the way it's towed.
    expect(car.heading).toBeCloseTo(Math.PI / 2, 1);
    expect(car.z).toBeCloseTo(truck.z, 1);
  });

  it('pays by condition, scrap least; a streak bonus every few in a row', () => {
    expect(towPay(0.9, false).pay).toBeGreaterThan(towPay(0.5, false).pay);
    expect(towPay(0.5, false).pay).toBeGreaterThan(towPay(0.1, false).pay);
    expect(towPay(0.1, false).pay).toBeGreaterThan(SCRAP_PAY);
    expect(towPay(1, true)).toEqual({ pay: SCRAP_PAY, label: 'SCRAP' });
    expect(towPay(0.9, false).label).toBe('CLEAN');
    expect(streakPay(TOW_STREAK_EVERY, TOW_STREAK_EVERY, TOW_STREAK_BONUS)).toBe(TOW_STREAK_BONUS);
    expect(streakPay(TOW_STREAK_EVERY + 1, TOW_STREAK_EVERY, TOW_STREAK_BONUS)).toBe(0);
    expect(streakPay(0, DUTY_STREAK_EVERY, DUTY_STREAK_BONUS)).toBe(0);
    expect(streakPay(DUTY_STREAK_EVERY * 2, DUTY_STREAK_EVERY, DUTY_STREAK_BONUS)).toBe(DUTY_STREAK_BONUS);
  });

  it('Vex rings after dark, on duty with nothing hooked, not too often', () => {
    expect(vexRings(true, true, false, false, CONTRACT_EVERY, CONTRACT_FIRST)).toBe(true);
    expect(vexRings(false, true, false, false, CONTRACT_EVERY, CONTRACT_FIRST)).toBe(false);
    expect(vexRings(true, false, false, false, CONTRACT_EVERY, CONTRACT_FIRST)).toBe(false);
    expect(vexRings(true, true, true, false, CONTRACT_EVERY, CONTRACT_FIRST)).toBe(false);
    expect(vexRings(true, true, false, true, CONTRACT_EVERY, CONTRACT_FIRST)).toBe(false);
    expect(vexRings(true, true, false, false, CONTRACT_EVERY - 1, CONTRACT_FIRST)).toBe(false);
    expect(vexRings(true, true, false, false, CONTRACT_EVERY, CONTRACT_FIRST - 1)).toBe(false);
  });
});

describe('the guard', () => {
  it("covers the player's borrowed vehicle and the car on its hook, nothing else", () => {
    const a = {};
    const b = {};
    expect(guarded(a, a, null)).toBe(true);
    expect(guarded(b, a, b)).toBe(true);
    expect(guarded({}, a, b)).toBe(false);
    expect(guarded(a, null, null)).toBe(false);
  });
});

// --- On the real city, through the director ---

const city = generateCity(1337);

function world(x = 9.5, z = 40) {
  const bus = new EventBus();
  const log: GameEvent[] = [];
  bus.onAny((e) => log.push(e));
  const rand = random(7);
  const vehicles: Vehicle[] = [];
  const makeVehicle = (archetype: VehicleArchetype, paint: ColorRepresentation): Vehicle => {
    const sim = createVehicleState();
    sim.body = VEHICLE_BODIES[archetype];
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
  const population = new Population(vehicles, { createVehicle: makeVehicle, resetVehicle: () => {}, createPedModel: model }, () => 0.1);
  const player = new Player(bus, x, z);
  let now = 0;
  const life = new CityLife({
    bus,
    vehicles,
    population,
    player,
    city,
    signals: { at: () => null },
    rand,
    now: () => now,
    view: (out: Rect) => Object.assign(out, { minX: x - 30, maxX: x + 30, minZ: z - 15, maxZ: z + 15 }),
    playing: () => true,
    // No scene starts on its own: the tests drive the tools.
    activity: () => true,
    stars: () => 0,
    tutorial: () => false,
    keep: () => false,
    avoid: [],
    busStops: [],
    vendors: [],
    trafficScale: () => 1,
    npcShoot: () => {},
    collect: () => false,
    focus: () => player.position,
  } as unknown as ConstructorParameters<typeof CityLife>[0]);
  /** A vehicle at (vx, vz) facing `heading` (abandoned: nobody driving). */
  const car = (archetype: VehicleArchetype, vx: number, vz: number, heading = 0): Vehicle => {
    const v = makeVehicle(archetype, '#888');
    Object.assign(v.sim, { x: vx, z: vz, heading });
    vehicles.push(v);
    return v;
  };
  /** Someone walking calmly at (px, pz). */
  const ped = (px: number, pz: number) => {
    const a = spawnPed(0, 0, 0, 0, rand);
    Object.assign(a.s, { x: px, z: pz, vx: 0, vz: 0 });
    a.street = true;
    a.temper = 'calm';
    a.mode = 'walk';
    return population.addPed(a);
  };
  const run = (seconds: number, each?: () => void) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      each?.();
      life.tools.step(DT);
      now += DT;
    }
  };
  return { bus, log, life, player, vehicles, population, car, ped, run, tools: life.tools };
}

describe('the hose on a borrowed fire truck', () => {
  it('knocks flat the people in its cone (and only them), and it is on the player', () => {
    const w = world();
    const truck = w.car('firetruck', 9.5, 40, 0);
    w.player.enter(truck);
    // Ahead of the monitor, just off the line, and one well to the side.
    const hit = w.ped(9.5, 52);
    const near = w.ped(10.3, 47);
    const clear = w.ped(20, 50);
    w.run(0.5, () => w.tools.control(false, true, null));
    expect(w.tools.hosing).toBe(true);
    expect(hit.agent.mode).toBe('down');
    expect(near.agent.mode).toBe('down');
    expect(clear.agent.mode).toBe('walk');
    // Knocked back along the jet (north).
    expect(hit.agent.s.vz).toBeGreaterThan(0);
    const downs = w.log.filter((e) => e.type === 'pedDown');
    expect(downs.length).toBe(2);
    expect(downs.every((e) => e.type === 'pedDown' && e.byPlayer && e.cause === 'water')).toBe(true);
    // Let go: off.
    w.run(0.1, () => w.tools.control(false, false, null));
    expect(w.tools.hosing).toBe(false);
    expect(w.log.some((e) => e.type === 'tool' && e.what === 'hoseOff')).toBe(true);
  });

  it('aims where the player aims', () => {
    const w = world();
    const truck = w.car('firetruck', 9.5, 40, 0);
    w.player.enter(truck);
    // Back down the road behind the truck.
    const behind = w.ped(9.5, 31);
    const north = w.ped(9.5, 52);
    w.run(0.3, () => w.tools.control(false, true, Math.PI));
    expect(behind.agent.mode).toBe('down');
    expect(north.agent.mode).toBe('walk');
  });

  it('puts out a burning wreck it reaches, faster than a crew, and says so', () => {
    const w = world();
    const board = FireCrews.of(w.life)!.board;
    const fire = board.start(9.5, 50, false);
    for (let i = 0; i < 40; i++) board.step(0.1);
    expect(fire.strength).toBe(1);
    const truck = w.car('firetruck', 9.5, 40, 0);
    w.player.enter(truck);
    let out = -1;
    let t = 0;
    w.run(4, () => {
      w.tools.control(false, true, null);
      t += DT;
      if (out < 0 && !fire.alive) out = t;
    });
    expect(fire.alive).toBe(false);
    // One crew hose takes HOSE_SECONDS (7 s); the monitor well under half that.
    expect(out).toBeLessThan(3);
    expect(w.log.some((e) => e.type === 'tool' && e.what === 'fireOut')).toBe(true);
    expect(w.log.some((e) => e.type === 'street' && e.what === 'fireOut')).toBe(true);
  });

  it("doesn't reach a fire out of its range, or work with the player out of the truck", () => {
    const w = world();
    const board = FireCrews.of(w.life)!.board;
    const fire = board.start(9.5, 40 + HOSE_RANGE + 8, false);
    for (let i = 0; i < 40; i++) board.step(0.1);
    const truck = w.car('firetruck', 9.5, 40, 0);
    w.player.enter(truck);
    w.run(1, () => w.tools.control(false, true, null));
    expect(fire.strength).toBe(1);
    w.player.exit();
    const hit = w.ped(9.5, 50);
    w.run(1, () => w.tools.control(false, true, null));
    expect(w.tools.hosing).toBe(false);
    expect(hit.agent.mode).toBe('walk');
  });
});

describe('the chime on a borrowed ice cream van', () => {
  it('draws a queue to wherever it parks, and lets it go when the van leaves', () => {
    const w = world();
    const van = w.car('ice_cream_van', 9.5, 40, 0);
    w.player.enter(van);
    const people = [w.ped(5, 30), w.ped(14, 55), w.ped(30, 40)];
    w.tools.control(true, false, null);
    w.run(3);
    expect(w.tools.chime.on).toBe(true);
    expect(w.tools.chime.anchored).toBe(true);
    expect(w.log.some((e) => e.type === 'tool' && e.what === 'chime')).toBe(true);
    expect(w.tools.queue.members.length).toBe(3);
    for (const c of people) expect(c.agent.scene).toBe(true);
    // The player gets out to watch: the queue stays.
    w.player.exit();
    w.run(2);
    expect(w.tools.queue.members.length).toBe(3);
    // Back in and off: they're let go, walking on.
    w.player.enter(van);
    w.run(0.2, () => (van.sim.z += 0.8));
    expect(w.tools.queue.members.length).toBe(0);
    for (const c of people) expect(c.agent.scene).toBe(false);
    expect(w.log.some((e) => e.type === 'tool' && e.what === 'release')).toBe(true);
  });
});

describe('the winch on a borrowed tow truck', () => {
  it('hooks the nearest towable car within reach of the hook, not one further off', () => {
    const w = world();
    const truck = w.car('tow_truck', 9.5, 40, 0);
    w.player.enter(truck);
    // The hook is 4.1 m behind the truck's middle: z = 35.9. A crash 3 m beyond it (nose at 32.9), another further.
    const near = w.car('sedan', 9.5, 32.9 - 2.4, 0);
    near.towable = true;
    const far = w.car('sedan', 2, 20, 0);
    far.towable = true;
    w.tools.control(true, false, null);
    w.run(0.1);
    expect(w.tools.hooked).toBe(near);
    // Winched up onto the hook, then trailing.
    w.run(2);
    expect(Math.hypot(near.sim.x - 9.5, near.sim.z - (40 - 3.5 - 0.6 - 2.4))).toBeLessThan(0.05);
    expect(far.sim.z).toBe(20);
  });

  it('finds nothing beyond HOOK_RANGE, nor a parked car right behind', () => {
    const w = world();
    const truck = w.car('tow_truck', 9.5, 40, 0);
    w.player.enter(truck);
    const out = w.car('sedan', 9.5, 35.9 - HOOK_RANGE - 0.5 - 2.4, 0);
    out.towable = true;
    const parked = w.car('sedan', 9.5, 35.9 - 1 - 2.4, 0);
    parked.parked = true;
    w.tools.control(true, false, null);
    w.run(0.1);
    expect(w.tools.hooked).toBeNull();
    expect(w.log.some((e) => e.type === 'tool' && e.what === 'noHook')).toBe(true);
  });

  it('holds the truck to the tow speed while a car is on, and not without one', () => {
    const w = world();
    const truck = w.car('tow_truck', 9.5, 40, 0);
    w.player.enter(truck);
    const c = { throttle: 1, steer: 0, handbrake: false, boost: true };
    truck.sim.vz = TOW_TOP_SPEED + 2;
    w.tools.limit(c);
    expect(c.throttle).toBe(1);
    const wreck = w.car('sedan', 9.5, 33, 0);
    wreck.damage.wrecked = true;
    truck.sim.vz = 0;
    w.tools.control(true, false, null);
    w.run(2);
    expect(w.tools.hooked).toBe(wreck);
    truck.sim.vz = TOW_TOP_SPEED + 2;
    w.tools.limit(c);
    expect(c.throttle).toBeLessThan(0);
    expect(c.boost).toBe(false);
  });

  it('delivers in the docks yard: paid by condition, the car left there and never paid for twice', () => {
    const w = world();
    const y = w.tools.yard;
    const truck = w.car('tow_truck', y.x, y.z + 6, 0);
    w.player.enter(truck);
    const crash = w.car('sedan', y.x, y.z + 6 - 4.1 - 2.4 - 1, 0);
    crash.towable = true;
    crash.damage.health = crash.damage.maxHealth * 0.5;
    w.tools.control(true, false, null);
    w.run(3);
    const deliver = w.log.find((e) => e.type === 'tool' && e.what === 'deliver');
    expect(deliver && deliver.type === 'tool' && deliver.condition).toBeCloseTo(0.5);
    expect(w.tools.hooked).toBeNull();
    expect(w.tools.delivered).toBe(crash);
    expect(crash.towable).toBe(false);
    expect(w.life.owned).toContain(crash);
    // Hooked again: not paid twice.
    w.tools.control(true, false, null);
    w.run(0.2);
    expect(w.tools.hooked).toBeNull();
  });
});

describe('the guard in the city', () => {
  it("keeps the city's tow trucks off the car on the player's hook, and off the borrowed truck once left", () => {
    const w = world();
    const tows = Tows.of(w.life)! as unknown as { pick(): Vehicle | null };
    const truck = w.car('tow_truck', 9.5, 40, 0);
    const crash = w.car('sedan', 9.5, 33, 0);
    crash.towable = true;
    w.player.lastDriven = w.car('sedan', 300, 300, 0);
    // Nobody's: the city's tow would take it.
    expect(tows.pick()).toBe(crash);
    w.player.enter(truck);
    w.tools.control(true, false, null);
    w.run(0.2);
    expect(w.tools.hooked).toBe(crash);
    expect(w.life.keeps(crash)).toBe(true);
    expect(tows.pick()).toBeNull();
    // The player gets out: the truck and its car stay theirs.
    w.player.exit();
    w.run(0.2);
    expect(w.life.keeps(truck)).toBe(true);
    expect(w.life.keeps(crash)).toBe(true);
    // Into another car: the truck's left behind, its car let go, the city may have them again.
    const other = w.car('sedan', 12, 40, 0);
    w.player.enter(other);
    w.run(0.2);
    expect(w.life.keeps(truck)).toBe(false);
    expect(w.tools.hooked).toBeNull();
    expect(tows.pick()).toBe(crash);
  });

  it('a borrowed ice cream van left chiming stays the player\'s', () => {
    const w = world();
    const van = w.car('ice_cream_van', 9.5, 40, 0);
    w.player.enter(van);
    w.run(0.1);
    w.player.exit();
    w.run(0.1);
    expect(w.life.keeps(van)).toBe(true);
    expect(w.life.keeps(w.car('ice_cream_van', 20, 40, 0))).toBe(false);
  });

  it("a fire call never claims the player's borrowed fire truck, even one with a driver in it", () => {
    const w = world();
    const truck = w.car('firetruck', 9.5, 40, 0);
    w.player.enter(truck);
    w.run(0.1);
    w.player.exit();
    w.run(0.1);
    // As if someone had got in: the claim would take it but for the guard.
    truck.ai = driverFor(truck.sim, random(3));
    const run = ServiceRun.call(w.life, FIRE_TRUCK, 9.5, 60);
    expect(run?.v).not.toBe(truck);
    run?.end();
    // Not the player's any more: claimed.
    w.player.enter(w.car('sedan', 12, 40, 0));
    w.run(0.1);
    const again = ServiceRun.call(w.life, FIRE_TRUCK, 9.5, 60);
    expect(again?.v).toBe(truck);
  });
});

describe('duty pay (serviceMode)', () => {
  /** Does nothing, whatever's asked of it. */
  const anything = (): never => new Proxy(() => anything(), { get: () => anything() }) as never;
  function duty(hour = 22) {
    const bus = new EventBus();
    const player = new Player(bus, 0, 0);
    const paid: [number, string][] = [];
    const shown: string[] = [];
    const tools = { hooked: null as Vehicle | null, delivered: null as Vehicle | null, yard: { x: 500, z: 500 }, winchUp: 1, chime: { on: false, anchored: false }, queue: { members: [] } };
    const spawned: Vehicle[] = [];
    const ctx = {
      deps: { bus, player, vehicles: [], input: { lastDevice: 'keyboard' }, look: { time: { hour } }, radar: anything(), audio: anything(), rand: random(5) },
      live: true,
      freeRoam: true,
      busy: null as string | null,
      focusRing: false,
      ui: anything(),
      pay: (n: number, _reason: string, label: string) => (paid.push([n, label]), n),
      notice() {},
      blip() {},
      unblip() {},
      unpin() {},
      openModal() {},
      closeModal() {},
      spawnCar: (archetype: VehicleArchetype, _paint: string, x: number, z: number, heading: number) => {
        const sim = createVehicleState(x, z, heading);
        const v = { archetype, sim, mesh: { root: { visible: true } }, damage: createDamage(100), ai: null } as unknown as Vehicle;
        spawned.push(v);
        return v;
      },
    };
    const card = { show: (head: string, _t: string, _l: unknown, _r: string, _b: string, _f: boolean, done: () => void) => (shown.push(head), done()) };
    const mode = new ServiceMode(ctx as unknown as ModeCtx, tools as unknown as ServiceTools, card as unknown as DialogueCard);
    const truck = (archetype: VehicleArchetype) => {
      const sim = createVehicleState(0, 0, 0);
      return { archetype, sim, damage: createDamage(100), mesh: { root: { visible: true } } } as unknown as Vehicle;
    };
    const tool = (what: ToolWhat, condition?: number, wrecked?: boolean) => bus.emit({ type: 'tool', tool: 'winch', what, x: 0, z: 0, condition, wrecked });
    return { bus, player, paid, shown, tools, spawned, mode, truck, tool };
  }

  it('pays for each fire the hose puts out, a streak bonus every third, and getting out loses the streak', () => {
    const d = duty();
    d.player.enter(d.truck('firetruck'));
    d.mode.step(DT);
    for (let i = 0; i < DUTY_STREAK_EVERY; i++) d.tool('fireOut');
    expect(d.paid.filter(([, l]) => l === 'FIRE OUT').length).toBe(DUTY_STREAK_EVERY);
    expect(d.paid.some(([n]) => n === DUTY_STREAK_BONUS)).toBe(true);
    d.player.exit();
    d.mode.step(DT);
    d.player.enter(d.truck('firetruck'));
    d.mode.step(DT);
    d.paid.length = 0;
    for (let i = 0; i < DUTY_STREAK_EVERY - 1; i++) d.tool('fireOut');
    expect(d.paid.some(([n]) => n === DUTY_STREAK_BONUS)).toBe(false);
  });

  it("pays the yard's price by condition for a delivery", () => {
    const d = duty();
    d.player.enter(d.truck('tow_truck'));
    d.mode.step(DT);
    d.tool('deliver', 0.9, false);
    d.tool('deliver', 0.2, true);
    expect(d.paid).toEqual([
      [towPay(0.9, false).pay, 'TOWED · CLEAN'],
      [SCRAP_PAY, 'TOWED · SCRAP'],
    ]);
  });

  it("Vex rings after dark with a contract; her wreck delivered pays the contract on top", () => {
    const d = duty(23);
    d.player.enter(d.truck('tow_truck'));
    for (let t = 0; t < CONTRACT_FIRST + 1; t += DT) d.mode.step(DT);
    expect(d.shown.length).toBe(1);
    expect(d.spawned.length).toBe(1);
    const wreck = d.spawned[0];
    expect(wreck.towable).toBe(true);
    d.tools.delivered = wreck;
    d.tool('deliver', 0.4, false);
    expect(d.paid.some(([n, l]) => n === CONTRACT_PAY && l === "VEX'S CONTRACT")).toBe(true);
    // Not again straight away.
    for (let t = 0; t < 10; t += DT) d.mode.step(DT);
    expect(d.shown.length).toBe(1);
  });

  it('Vex never rings by day', () => {
    const d = duty(13);
    d.player.enter(d.truck('tow_truck'));
    for (let t = 0; t < CONTRACT_FIRST + 5; t += DT) d.mode.step(DT);
    expect(d.shown.length).toBe(0);
  });
});
