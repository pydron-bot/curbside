import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../src/core/events';
import { VEHICLE_HEALTH, createVehicleState, type VehicleArchetype } from '../src/entities/vehicle';
import { COMBO_WINDOW, Combat, NPC_SHOT_DAMAGE, PUNCH_DAMAGE, type AimInput } from '../src/game/combat';
import { Player } from '../src/game/player';
import type { CrowdPed, Vehicle } from '../src/game/population';
import type { CarMesh } from '../src/render/carMesh';
import type { CharacterModel } from '../src/render/characterModel';
import { KO_SECONDS, PED_HP, STAGGER_SECONDS, hurtPed, spawnPed, stepCrowdPed } from '../src/systems/crowd';
import { createDamage, damageStage, stepDamage } from '../src/systems/damage';
import { Score } from '../src/systems/score';
import { WEAPONS, type WeaponKind } from '../src/systems/weapons';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const DT = 1 / 60;

function ped(x: number, z: number, rand = random(3)): CrowdPed {
  const agent = spawnPed(8, 8, 0, 0.5, rand);
  agent.s.x = x;
  agent.s.z = z;
  agent.temper = 'calm';
  return { agent, prev: { ...agent.s }, model: { punch() {} } as unknown as CharacterModel };
}

function car(x: number, z: number, archetype: VehicleArchetype = 'sedan'): Vehicle {
  const sim = createVehicleState(x, z, 0);
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

function setup(opts: { stars?: number } = {}) {
  const bus = new EventBus();
  const log: GameEvent[] = [];
  bus.onAny((e) => log.push(e));
  const player = new Player(bus, 0, 0, 0); // facing +Z
  const crowd: CrowdPed[] = [];
  const vehicles: Vehicle[] = [];
  const score = new Score();
  let time = 0;
  const combat = new Combat({
    bus,
    player,
    vehicles,
    crowd,
    grid: new StaticGrid([]),
    rand: random(7),
    score,
    award: (a) => a && bus.emit({ type: 'award', award: a }),
    ejectDriver: () => {},
    now: () => time,
    playing: () => true,
    focus: () => ({ x: 0, z: 0 }),
    stars: () => opts.stars ?? 0,
  });
  const rand = random(11);
  /** Run the sim; `people` also moves the crowd (fighting the player). */
  const step = (seconds: number, people = false) => {
    for (let t = 0; t < seconds; t += DT) {
      time += DT;
      player.step(DT);
      combat.step(DT);
      if (people) for (const c of crowd) stepCrowdPed(c.agent, [], rand, DT, { x: player.ped.x, z: player.ped.z, inCar: false, alive: true });
    }
  };
  const awards = () => log.filter((e) => e.type === 'award').map((e) => (e.type === 'award' ? e.award.kind : ''));
  return { bus, log, player, crowd, vehicles, combat, step, awards };
}

const noAim: AimInput = { heading: null, reach: 0, ground: null };

/** Fire `kind` at whatever's in front until `done` or out of shots; returns shots fired. */
function shootUntil(w: ReturnType<typeof setup>, kind: WeaponKind, done: () => boolean, limit = 30): number {
  w.player.arsenal.pickUp(kind);
  w.player.arsenal.current = kind;
  let shots = 0;
  while (!done() && shots < limit) {
    if (w.combat.fire(noAim)) shots++;
    w.step(WEAPONS[kind].interval + 0.01);
    for (const c of w.crowd) c.agent.s.vx = c.agent.s.vz = 0;
    // Let the spread settle a little, as a player tapping would.
    w.player.arsenal.bloom = 0;
  }
  return shots;
}

describe('ped hit points', () => {
  it('a hit staggers, the last one knocks out; KO is down for long, then they run', () => {
    const p = ped(0, 5);
    expect(p.agent.hp).toBe(PED_HP);
    expect(hurtPed(p.agent, 30, 0, 0)).toBe('hit');
    expect(p.agent.stagger).toBeCloseTo(STAGGER_SECONDS);
    const x0 = p.agent.s.x;
    p.agent.s.vx = p.agent.s.vz = 0;
    stepCrowdPed(p.agent, [], random(1), DT);
    expect(p.agent.s.x).toBe(x0); // reeling: no walking off
    expect(hurtPed(p.agent, 200, 0, 0)).toBe('ko');
    expect(p.agent.mode).toBe('down');
    expect(p.agent.timer).toBeCloseTo(KO_SECONDS);
    expect(hurtPed(p.agent, 50, 0, 0)).toBe('none'); // nothing more while down
    for (let t = 0; t < KO_SECONDS + 0.1; t += DT) stepCrowdPed(p.agent, [], random(1), DT);
    expect(p.agent.mode).toBe('flee');
    expect(p.agent.ko).toBe(false);
    expect(p.agent.hp).toBeGreaterThan(0);
  });

  it('pistol takes three hits, SMG about seven, shotgun one at close range', () => {
    const count = (kind: WeaponKind, dist: number) => {
      const w = setup();
      const target = ped(0, dist);
      w.crowd.push(target);
      return shootUntil(w, kind, () => target.agent.mode === 'down');
    };
    expect(count('pistol', 6)).toBe(3);
    expect(count('smg', 6)).toBeGreaterThanOrEqual(6);
    expect(count('smg', 6)).toBeLessThanOrEqual(8);
    expect(count('shotgun', 2)).toBe(1);
    expect(count('shotgun', 12)).toBeGreaterThan(1); // spread thins out at range
  });

  it('only a knockout scores KNOCKOUT', () => {
    const w = setup();
    const target = ped(0, 6);
    w.crowd.push(target);
    shootUntil(w, 'pistol', () => target.agent.mode === 'down');
    expect(w.awards()).toEqual(['knockout']);
    const down = w.log.filter((e) => e.type === 'pedDown');
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ cause: 'shot', byPlayer: true, ko: true });
  });

  it('police officers take hits the same way', () => {
    const w = setup({ stars: 2 });
    const cop = ped(0, 6);
    cop.agent.role = 'cop';
    w.crowd.push(cop);
    expect(shootUntil(w, 'pistol', () => cop.agent.mode === 'down')).toBe(3);
  });
});

describe('punch combos', () => {
  it('jab, jab, hook: the hook knocks down; a second combo knocks out', () => {
    const w = setup();
    const target = ped(0, 1);
    target.agent.temper = 'fighter';
    w.crowd.push(target);
    const punchesTo = (mode: string) => {
      let n = 0;
      while (target.agent.mode !== mode && n < 12) {
        w.combat.punch(null);
        n++;
        w.step(0.6);
        target.agent.s.x = 0;
        target.agent.s.z = 1;
      }
      return n;
    };
    expect(punchesTo('down')).toBe(3);
    expect(target.agent.hp).toBe(PED_HP - PUNCH_DAMAGE[0] - PUNCH_DAMAGE[1] - PUNCH_DAMAGE[2]);
    expect(target.agent.ko).toBe(false);
    expect(w.awards()).toEqual([]); // knocked over isn't knocked out
    // Back up and fighting (provoked): finish them.
    w.step(3, true);
    expect(target.agent.mode).toBe('fight');
    w.step(COMBO_WINDOW + 0.1); // the old combo has lapsed
    punchesTo('down');
    expect(target.agent.ko).toBe(true);
    expect(w.awards()).toEqual(['knockout']);
    const hooks = w.log.filter((e) => e.type === 'punch' && e.combo === 2);
    expect(hooks.length).toBeGreaterThanOrEqual(1);
  });

  it('a lapsed combo starts again from the first jab', () => {
    const w = setup();
    w.combat.punch(null);
    w.step(0.3);
    w.combat.punch(null);
    expect(w.combat.comboStep).toBe(1);
    w.step(COMBO_WINDOW + 0.1);
    w.combat.punch(null);
    expect(w.combat.comboStep).toBe(0);
  });
});

describe('lock-on and strafing', () => {
  it('locks on to someone fighting you over a bystander in front', () => {
    const w = setup();
    const bystander = ped(0, 5);
    const fighter = ped(-6, -2); // behind and to the side
    fighter.agent.mode = 'fight';
    fighter.agent.timer = 10;
    w.crowd.push(bystander, fighter);
    w.player.arsenal.pickUp('pistol');
    w.combat.updateAim(true, noAim);
    expect(w.combat.lock).toBe(fighter);
    const h = w.combat.lockHeading()!;
    expect(Math.sin(h)).toBeLessThan(-0.8); // facing -X, toward them
    // Shots go at the lock.
    w.combat.fire(noAim);
    expect(fighter.agent.hp).toBeLessThan(PED_HP);
    expect(bystander.agent.hp).toBe(PED_HP);
  });

  it('with a deliberate aim, only locks near it; lets go when firing stops', () => {
    const w = setup();
    const behind = ped(0, -6);
    behind.agent.mode = 'shoot';
    behind.agent.timer = 10;
    const ahead = ped(1, 8);
    w.crowd.push(behind, ahead);
    w.player.arsenal.pickUp('smg');
    w.combat.updateAim(true, { heading: 0, reach: 1, ground: null });
    expect(w.combat.lock).toBe(ahead);
    w.combat.fire({ heading: 0, reach: 1, ground: null });
    w.step(1);
    w.combat.updateAim(false, { heading: 0, reach: 1, ground: null });
    expect(w.combat.lock).toBeNull();
  });
});

describe('spread bloom', () => {
  it('holding the trigger blooms the spread; it settles when you stop', () => {
    const w = setup();
    const a = w.player.arsenal;
    a.pickUp('smg');
    const settled = a.spread;
    for (let i = 0; i < 10; i++) {
      w.combat.fire(noAim);
      w.step(WEAPONS.smg.interval + 0.001);
    }
    expect(a.spread).toBeGreaterThan(settled * 2);
    expect(a.spread).toBeLessThanOrEqual(settled + WEAPONS.smg.bloomMax + 1e-9);
    w.step(1.5);
    expect(a.spread).toBeCloseTo(settled);
  });
});

describe('throws', () => {
  it('a throwable always shows where it lands, aimed or not, and a tap throws right there', () => {
    const w = setup();
    w.player.arsenal.pickUp('grenade');
    w.player.arsenal.current = 'grenade';
    w.combat.updateAim(false, noAim);
    expect(w.combat.marker.show).toBe(true);
    // Nobody about: ahead of the player (facing +Z), within the throw's range.
    expect(Math.abs(w.combat.marker.x)).toBeLessThan(0.01);
    expect(w.combat.marker.z).toBeGreaterThan(3);
    expect(w.combat.marker.z).toBeLessThanOrEqual(WEAPONS.grenade.range);
    const { x, z } = w.combat.marker;
    expect(w.combat.fire(noAim)).toBe(true);
    expect(w.log.find((e) => e.type === 'throw')).toMatchObject({ toX: x, toZ: z, weapon: 'grenade' });
  });
});

describe('rockets', () => {
  it("don't lock on or snap to anyone inside their own blast; further out they do", () => {
    const w = setup();
    w.player.arsenal.pickUp('rocket');
    w.player.arsenal.current = 'rocket';
    // A fighter 4 m away, off to the side of the facing (+Z).
    const close = ped(1.5, 3.7);
    close.agent.mode = 'fight';
    w.crowd.push(close);
    w.combat.updateAim(true, noAim);
    expect(w.combat.lock).toBeNull();
    expect(w.combat.fire(noAim)).toBe(true);
    const r = w.combat.projectiles.list.find((p) => p.alive && p.kind === 'rocket')!;
    expect(Math.abs(Math.atan2(r.vx, r.vz))).toBeLessThan(0.05); // straight on, not at them
    // The same fighter 15 m away is fair game.
    w.combat.reset();
    Object.assign(close.agent.s, { x: 5, z: 14 });
    w.combat.updateAim(true, noAim);
    expect(w.combat.lock).toBe(close);
  });
});

describe('drive-bys', () => {
  it('fires out of the side window at the target there, not straight ahead', () => {
    const w = setup();
    const own = car(0, 0);
    w.vehicles.push(own);
    w.player.enter(own); // facing +Z
    const ahead = ped(0, 10);
    const beside = ped(-7, 1); // out of the right window (left axis is +X at heading 0)
    w.crowd.push(ahead, beside);
    w.player.arsenal.pickUp('pistol');
    w.player.arsenal.current = null; // fists selected: FIRE picks the drive-by gun
    expect(w.combat.driveBy(null)).toBe(true);
    expect(w.player.arsenal.current).toBe('pistol');
    const shot = w.log.find((e) => e.type === 'shot');
    expect(shot).toMatchObject({ byPlayer: true, driveBy: true });
    if (shot?.type === 'shot') expect(shot.dirX).toBeLessThan(-0.8);
    expect(ahead.agent.hp).toBe(PED_HP);
    // Never hits its own car.
    expect(own.damage.health).toBe(own.damage.maxHealth);
  });

  it('needs a pistol or SMG', () => {
    const w = setup();
    const own = car(0, 0);
    w.vehicles.push(own);
    w.player.enter(own);
    w.player.arsenal.pickUp('shotgun');
    w.player.arsenal.pickUp('grenade');
    expect(w.combat.driveBy(null)).toBe(false);
    // Cycling in the car offers only what fires out of a window.
    w.player.arsenal.pickUp('smg');
    w.player.arsenal.current = 'grenade';
    w.player.arsenal.cycle(1, (k) => WEAPONS[k].driveBy);
    expect(w.player.arsenal.current).toBe('smg');
  });
});

describe('blasts and fire', () => {
  it('a car going up sets the cars beside it alight: chain reactions still happen', () => {
    const w = setup();
    const source = car(0, 20);
    const beside = car(4.2, 20);
    const across = car(12, 20);
    w.vehicles.push(source, beside, across);
    w.combat.vehicleExploded(source);
    expect(beside.damage.burning).toBe(true);
    expect(across.damage.burning).toBe(false);
    let t = 0;
    while (!stepDamage(beside.damage, DT) && t < 5) t += DT;
    expect(t).toBeLessThan(2.5); // a short fuse: the chain ripples
    expect(t).toBeGreaterThan(0.4); // ...not all on the next step
    expect(w.log.some((e) => e.type === 'explosion' && e.source === 'vehicle')).toBe(true);
  });

  it("a blast that sets the player's own car alight leaves time to bail out", () => {
    const w = setup();
    const source = car(0, 20);
    const own = car(4.2, 20);
    w.vehicles.push(source, own);
    w.player.enter(own);
    w.combat.vehicleExploded(source);
    expect(own.damage.burning).toBe(true);
    let t = 0;
    while (!stepDamage(own.damage, DT) && t < 6) t += DT;
    expect(t).toBeGreaterThan(2.9);
  });

  it('grenade blasts knock people out near the centre and down further out', () => {
    const w = setup();
    const near = ped(0, 21);
    const far = ped(6.5, 20);
    w.crowd.push(near, far);
    w.combat.blast('grenade', 0, 20, true);
    expect(near.agent.ko).toBe(true);
    expect(far.agent.mode).toBe('down');
    expect(far.agent.ko).toBe(false);
    expect(w.awards()).toEqual(['knockout']);
    expect(w.log.find((e) => e.type === 'explosion')).toMatchObject({ source: 'grenade', byPlayer: true });
  });

  it("molotov fire burns people who walk into it, and cars parked in it", () => {
    const w = setup();
    const p = ped(0, 10);
    const parked = car(2, 12);
    w.crowd.push(p);
    w.vehicles.push(parked);
    w.combat.projectiles.addFire(0, 10, true);
    w.step(0.1);
    expect(p.agent.burning).toBeGreaterThan(0);
    for (let t = 0; t < 6; t += DT) {
      stepCrowdPed(p.agent, [], random(2), DT);
      w.step(DT);
      if (p.agent.mode === 'down') break;
    }
    expect(p.agent.ko).toBe(true);
    expect(w.log.find((e) => e.type === 'pedDown')).toMatchObject({ cause: 'fire', byPlayer: true });
    expect(damageStage(parked.damage)).not.toBe('ok');
  });
});

describe('NPC gunfire on the player', () => {
  it('armour takes the hits first', () => {
    const w = setup();
    w.player.addArmour(20);
    const shooter = { x: 0, z: 8 };
    let shots = 0;
    while (w.player.armour > 0 && shots < 200) {
      w.combat.npcShoot(shooter.x, shooter.z, 0, -1);
      shots++;
    }
    expect(w.player.health).toBeGreaterThan(100 - NPC_SHOT_DAMAGE);
    expect(shots).toBeGreaterThan(2);
  });
});

describe('pickups', () => {
  it('armour, ammo and weapons apply; a crate you cannot use stays', () => {
    const w = setup();
    expect(w.combat.collect('health')).toBe(false); // already full
    expect(w.combat.collect('armour')).toBe(true);
    expect(w.combat.collect('armour')).toBe(true); // tops up to the cap
    expect(w.combat.collect('armour')).toBe(false);
    expect(w.combat.collect('ammo')).toBe(true); // no gun: a pistol
    expect(w.player.arsenal.current).toBe('pistol');
    const before = w.player.arsenal.ammo.get('pistol')!;
    expect(w.combat.collect('ammo')).toBe(true);
    expect(w.player.arsenal.ammo.get('pistol')).toBeGreaterThan(before);
    expect(w.combat.collect('rocket')).toBe(true);
    expect(w.player.arsenal.current).toBe('rocket');
  });
});
