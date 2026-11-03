import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type GameEvent } from '../src/core/events';
import { Input } from '../src/core/input';
import { VEHICLE_HEALTH, createVehicleState, type VehicleArchetype } from '../src/entities/vehicle';
import { Combat, type AimInput } from '../src/game/combat';
import { SHOP_ITEMS, CHARGE_JOB, canBuy } from '../src/game/modes/shop';
import { Player } from '../src/game/player';
import type { CrowdPed, Vehicle } from '../src/game/population';
import { CASH_PAINT } from '../src/game/scenes/cashRun';
import type { CarMesh } from '../src/render/carMesh';
import {
  CASH_VAN_PAINT,
  Charges,
  FORGET_RANGE,
  GIFT_RANGE,
  LULL_LIMO_PAINT,
  MAX_CHARGES,
  canDetonate,
  detonateHint,
  partingGift,
  prizeOf,
  type Charge,
  type DetonateGate,
} from '../src/systems/charges';
import { blamesPlayer, createDamage, stepDamage } from '../src/systems/damage';
import { buildMissions } from '../src/systems/missionsData';
import { SAFEHOUSE, placeDocks } from '../src/game/modes/places';
import { generateCity } from '../src/world/city';
import { Score } from '../src/systems/score';
import { STAMPS, StampDetector } from '../src/systems/stamps';
import { WEAPONS, WEAPON_ORDER } from '../src/systems/weapons';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const DT = 1 / 60;
const MISSIONS = buildMissions(placeDocks(generateCity(1337)), SAFEHOUSE);

function car(x: number, z: number, archetype: VehicleArchetype = 'sedan', paint = '#fff'): Vehicle {
  const sim = createVehicleState(x, z, 0);
  return {
    archetype,
    paint,
    sim,
    prev: { ...sim },
    mesh: { root: {}, frontWheels: [] } as unknown as CarMesh,
    ai: null,
    damage: createDamage(VEHICLE_HEALTH[archetype]),
    wreckAge: 0,
    charred: false,
  };
}

function setup() {
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
    grid: new StaticGrid([]),
    rand: random(7),
    score: new Score(),
    award: (a) => a && bus.emit({ type: 'award', award: a }),
    ejectDriver: () => {},
    now: () => time,
    playing: () => true,
    focus: () => ({ x: 0, z: 0 }),
    stars: () => 0,
  });
  /** Run the sim, cars' damage too (burning down to the explosion, as main.ts steps it). */
  const step = (seconds: number) => {
    for (let t = 0; t < seconds; t += DT) {
      time += DT;
      player.step(DT);
      combat.step(DT);
      for (const v of vehicles) if (stepDamage(v.damage, DT)) combat.vehicleExploded(v);
    }
  };
  const arm = () => {
    player.arsenal.pickUp('charge');
    player.arsenal.current = 'charge';
  };
  return { bus, log, player, vehicles, combat, step, arm, now: () => time };
}

const noAim: AimInput = { heading: null, reach: 0, ground: null };
const ofType = <T extends GameEvent['type']>(log: GameEvent[], type: T) => log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

describe('sticky charge: the pool', () => {
  const carrier = (x: number, z: number, heading = 0) => ({ sim: { x, z, heading } });

  it('a stuck charge rides along with its car, turning with it', () => {
    const charges = new Charges<ReturnType<typeof carrier>>();
    const c = carrier(10, 10);
    // Stuck 1 m in front of the middle.
    const ch = charges.stick(c, 10, 1, 11, true)!;
    expect(ch.car).toBe(c);
    c.sim.x = 50;
    c.sim.z = -20;
    c.sim.heading = Math.PI / 2; // now facing +X
    charges.step(DT, 0, 0, () => true);
    expect(ch.x).toBeCloseTo(51);
    expect(ch.z).toBeCloseTo(-20);
    expect(ch.y).toBeGreaterThan(0.5);
  });

  it('holds MAX_CHARGES; detonating them all empties it', () => {
    const charges = new Charges<ReturnType<typeof carrier>>();
    for (let i = 0; i < MAX_CHARGES; i++) expect(charges.lay(i, 0, true)).not.toBeNull();
    expect(charges.full).toBe(true);
    expect(charges.lay(9, 9, true)).toBeNull();
    const out: Array<Charge<ReturnType<typeof carrier>>> = [];
    expect(charges.detonateAll(out)).toHaveLength(MAX_CHARGES);
    expect(charges.live).toBe(false);
    expect(charges.count).toBe(0);
  });

  it('forgets one on the road FORGET_RANGE from the player, never one on a car', () => {
    const charges = new Charges<ReturnType<typeof carrier>>();
    const c = carrier(0, 0);
    charges.lay(0, 0, true);
    charges.stick(c, 0, 1, 1, true);
    charges.step(DT, 0, FORGET_RANGE - 1, () => true);
    expect(charges.count).toBe(2);
    c.sim.z = 5000;
    charges.step(DT, 0, FORGET_RANGE, () => true);
    expect(charges.count).toBe(1);
    expect(charges.carries(c)).toBe(true);
  });

  it('a car gone (retired by its own system) takes its charge with it', () => {
    const charges = new Charges<ReturnType<typeof carrier>>();
    const c = carrier(0, 0);
    charges.stick(c, 0, 1, 0, true);
    charges.step(DT, 0, 0, () => false);
    expect(charges.live).toBe(false);
  });

  it('lists each carrying car once (the keep guard), and release takes them off', () => {
    const charges = new Charges<ReturnType<typeof carrier>>();
    const a = carrier(0, 0);
    const b = carrier(9, 0);
    charges.stick(a, 0, 1, 0, true);
    charges.stick(a, 0, 1, 1, true);
    charges.stick(b, 9, 1, 0, true);
    expect(charges.cars([])).toEqual([a, b]);
    expect(charges.release(a)).toBe(2);
    expect(charges.carries(a)).toBe(false);
    expect(charges.cars([])).toEqual([b]);
  });
});

describe('sticky charge: PARTING GIFT and the prizes', () => {
  it('knows the cash van and the Mayor\'s limo by their paint', () => {
    expect(CASH_VAN_PAINT).toBe(CASH_PAINT);
    const s5 = MISSIONS.find((m) => m.id === 's5-ribbon')!;
    const limo = s5.steps.flatMap((s) => s.start ?? []).find((a) => a.do === 'spawnCar');
    expect(limo).toMatchObject({ archetype: 'limo', paint: LULL_LIMO_PAINT });
    expect(prizeOf('van', CASH_PAINT)).toBe('cashVan');
    expect(prizeOf('limo', LULL_LIMO_PAINT)).toBe('limo');
    expect(prizeOf('limo', '#d8c8a0')).toBeNull(); // Clamp's beige limo isn't the Mayor's
    expect(prizeOf('sedan', CASH_PAINT)).toBeNull();
  });

  it('is a car someone else drives with you GIFT_RANGE away, or a prize from anywhere', () => {
    expect(partingGift({ driven: true, distance: GIFT_RANGE, prize: null })).toBe(true);
    expect(partingGift({ driven: true, distance: GIFT_RANGE - 1, prize: null })).toBe(false);
    expect(partingGift({ driven: false, distance: 200, prize: null })).toBe(false);
    expect(partingGift({ driven: false, distance: 2, prize: 'cashVan' })).toBe(true);
    expect(partingGift({ driven: false, distance: 2, prize: 'limo' })).toBe(true);
  });

  it('stamps PARTING GIFT off a gift blast only', () => {
    expect(STAMPS.partingGift).toMatchObject({ label: 'PARTING GIFT', weight: 7 });
    const d = new StampDetector();
    expect(d.handle({ type: 'chargeBlast', x: 0, z: 0, onCar: true, gift: false, byPlayer: true }, 1)).toBeNull();
    expect(d.handle({ type: 'chargeBlast', x: 0, z: 0, onCar: true, gift: true, byPlayer: true }, 2)).toBe('partingGift');
  });
});

describe('sticky charge: DETONATE only in play', () => {
  const play: DetonateGate = { paused: false, title: false, observing: false, menu: false, blocked: false, alive: true };

  it('goes in play, and nowhere else', () => {
    expect(canDetonate(play)).toBe(true);
    // The title, pause (Settings, TEST and the map editor open from it), observe mode, a menu or panel, a card, WASTED / BUSTED.
    for (const k of ['paused', 'title', 'observing', 'menu', 'blocked'] as const) expect(canDetonate({ ...play, [k]: true }), k).toBe(false);
    expect(canDetonate({ ...play, alive: false })).toBe(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('G and the D-pad down count, D-pad down still navigates menus, and a pause drops what was pending', () => {
    const target = new EventTarget();
    const input = new Input(target as unknown as Window);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyG', repeat: false, shiftKey: false }));
    expect(input.consumeDetonate()).toBe(true);
    expect(input.consumeDetonate()).toBe(false);
    const pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    pad.buttons[13].pressed = true; // D-pad down
    input.pollGamepad(0);
    input.pollGamepad(16); // held: still one press
    expect(input.consumeNav()).toBe('down');
    expect(input.consumeDetonate()).toBe(true);
    expect(input.consumeDetonate()).toBe(false);
    // Pressed in a menu: the pause's reset (and the resume's) leaves nothing to go off in play.
    pad.buttons[13].pressed = false;
    input.pollGamepad(32);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyG', repeat: false, shiftKey: false }));
    input.resetAll();
    expect(input.consumeDetonate()).toBe(false);
  });

  it('tells each device how to set it off', () => {
    expect(detonateHint('keyboard')).toContain('G');
    expect(detonateHint('touch')).toContain('BOOM');
    expect(detonateHint('gamepad')).toContain('D-PAD');
  });
});

describe('sticky charge: in the game', () => {
  it('is a throwable, last in the order, never dropped out of a car', () => {
    expect(WEAPONS.charge).toMatchObject({ label: 'STICKY CHARGE', mode: 'throw', driveBy: false, pickupAmmo: 2 });
    expect(WEAPON_ORDER.at(-1)).toBe('charge');
  });

  it('sticks to a car in front, which then carries it away', () => {
    const w = setup();
    const v = car(0, 7);
    w.vehicles.push(v);
    w.arm();
    expect(w.combat.fire(noAim)).toBe(true);
    w.step(1.2);
    expect(w.combat.charges.carries(v)).toBe(true);
    expect(ofType(w.log, 'charge')).toMatchObject([{ what: 'stuck', byPlayer: true }]);
    v.sim.x += 30;
    w.step(DT);
    const ch = w.combat.charges.list.find((c) => c.alive)!;
    expect(ch.x).toBeGreaterThan(25);
  });

  it('lies on an empty road, and a fourth throw is refused without spending one', () => {
    const w = setup();
    w.arm();
    w.player.arsenal.pickUp('charge'); // 4 now
    for (let i = 0; i < MAX_CHARGES; i++) {
      expect(w.combat.fire(noAim)).toBe(true);
      w.step(1.2);
    }
    expect(ofType(w.log, 'charge').filter((e) => e.what === 'laid')).toHaveLength(MAX_CHARGES);
    expect(w.combat.fire(noAim)).toBe(false);
    expect(ofType(w.log, 'charge').at(-1)).toMatchObject({ what: 'full' });
    expect(w.player.arsenal.ammo.get('charge')).toBe(1);
  });

  it('DETONATE blows the car it is on, the player\'s doing, and a road one goes off like a grenade', () => {
    const w = setup();
    const v = car(0, 7);
    w.vehicles.push(v);
    w.arm();
    w.combat.fire(noAim);
    w.step(1.2);
    // The next one off to the side, onto the road.
    w.combat.fire({ heading: -Math.PI / 2, reach: 0.6, ground: null });
    w.step(1.2);
    expect(w.combat.charges.count).toBe(2);
    expect(w.combat.charges.list.filter((c) => c.alive && c.car === null)).toHaveLength(1);
    expect(w.combat.detonate()).toBe(2);
    expect(w.combat.charges.live).toBe(false);
    expect(ofType(w.log, 'detonate')).toMatchObject([{ count: 2 }]);
    expect(ofType(w.log, 'explosion')).toMatchObject([{ source: 'grenade', byPlayer: true }]);
    w.step(0.1);
    expect(v.damage.wrecked).toBe(true);
    expect(blamesPlayer(v.damage, w.now())).toBe(true);
    expect(ofType(w.log, 'explosion').some((e) => e.source === 'vehicle' && e.byPlayer)).toBe(true);
    expect(ofType(w.log, 'chargeBlast')).toHaveLength(2);
    // Nothing left to go off.
    expect(w.combat.detonate()).toBe(0);
  });

  it('a gift on a driven car far off or the cash van; not on a parked car next to you', () => {
    const w = setup();
    const near = car(0, 7);
    const van = car(0, 7, 'van', CASH_PAINT);
    w.vehicles.push(near);
    w.arm();
    w.combat.fire(noAim);
    w.step(1.2);
    w.combat.detonate();
    expect(ofType(w.log, 'chargeBlast').at(-1)).toMatchObject({ onCar: true, gift: false });
    w.vehicles.length = 0;
    w.vehicles.push(van);
    w.arm();
    w.combat.fire(noAim);
    w.step(1.2);
    w.combat.detonate();
    expect(ofType(w.log, 'chargeBlast').at(-1)).toMatchObject({ onCar: true, gift: true });
    // A driven car that has got away from you.
    const driven = car(0, 7);
    w.vehicles.length = 0;
    w.vehicles.push(driven);
    w.arm();
    w.combat.fire(noAim);
    w.step(1.2);
    driven.ai = {} as Vehicle['ai'];
    driven.sim.z = 7 + GIFT_RANGE + 5;
    w.step(DT);
    w.combat.detonate();
    expect(ofType(w.log, 'chargeBlast').at(-1)).toMatchObject({ onCar: true, gift: true });
  });

  it('a car wrecked some other way first takes its charge with it, and the wreck is the player\'s', () => {
    const w = setup();
    const v = car(0, 7);
    w.vehicles.push(v);
    w.arm();
    w.combat.fire(noAim);
    w.step(1.2);
    v.damage.lastPlayerHit = -Infinity;
    v.damage.health = 0;
    w.step(DT);
    expect(w.combat.charges.live).toBe(false);
    expect(ofType(w.log, 'chargeBlast')).toHaveLength(1);
    expect(ofType(w.log, 'explosion').at(-1)).toMatchObject({ source: 'vehicle', byPlayer: true });
  });
});

describe('sticky charge: the story reward and the shop', () => {
  it('RIBBON CUTTING hands over two, in hand', () => {
    const s5 = MISSIONS.find((m) => m.id === CHARGE_JOB)!;
    const gives = s5.steps.flatMap((s) => s.start ?? []).filter((a) => a.do === 'give');
    expect(gives.at(-1)).toMatchObject({ weapon: 'charge' });
  });

  it('STICKY CHARGES are on the shelf once RIBBON CUTTING is passed', () => {
    const item = SHOP_ITEMS.find((i) => i.weapon === 'charge')!;
    expect(item).toMatchObject({ name: 'STICKY CHARGES', price: 700, after: CHARGE_JOB });
    const owned = () => false;
    expect(canBuy(item, 10_000, owned, () => false)).toBe('locked');
    expect(canBuy(item, 10_000, owned, (job) => job === CHARGE_JOB)).toBe('ok');
    expect(canBuy(item, 100, owned, () => true)).toBe('broke');
  });
});
