import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../src/core/events';
import { VEHICLE_HEALTH, createVehicleState } from '../src/entities/vehicle';
import { BUSTED_SECONDS, MAX_ARMOUR, MAX_HEALTH, OWN_CAR_BLAST_DAMAGE, Player, REGEN_DELAY, REGEN_TO, RESPAWN_SECONDS } from '../src/game/player';
import type { Vehicle } from '../src/game/population';
import type { CarMesh } from '../src/render/carMesh';
import { createDamage } from '../src/systems/damage';

const DT = 1 / 60;

function car(x = 0, z = 0): Vehicle {
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

function setup() {
  const bus = new EventBus();
  const log: GameEvent[] = [];
  bus.onAny((e) => log.push(e));
  const player = new Player(bus, 0, 0);
  const types = () => log.map((e) => e.type);
  return { bus, log, player, types };
}

/** Run sim steps until respawn is due (or the limit); returns seconds taken. */
function runUntilRespawn(player: Player, limit = 10) {
  for (let t = 0; t < limit; t += DT) {
    // The body must stay down for the whole time it's dead.
    if (!player.alive) expect(player.down).toBe(true);
    if (player.step(DT)) return t;
  }
  return Infinity;
}

describe('player transitions', () => {
  it('gets in and out, announcing both', () => {
    const { player, types } = setup();
    const v = car(5, 0);
    expect(player.enter(v)).toBe(true);
    expect(player.driving).toBe(v);
    expect(player.exit()).toBe(v);
    expect(player.driving).toBeNull();
    expect(player.lastDriven).toBe(v);
    // Placed beside the driver's door.
    expect(Math.hypot(player.ped.x - 5, player.ped.z)).toBeLessThan(2);
    expect(types()).toEqual(['enterVehicle', 'exitVehicle']);
  });

  it('getting out on foot does nothing', () => {
    const { player, types } = setup();
    expect(player.exit()).toBeNull();
    expect(types()).toEqual([]);
  });

  it('a car blowing up under a badly hurt player kills them cleanly (no double exit)', () => {
    const { player, types } = setup();
    const v = car();
    player.enter(v);
    player.health = 30;
    expect(() => player.ownCarExploded()).not.toThrow();
    expect(player.driving).toBeNull();
    expect(player.alive).toBe(false);
    expect(types().filter((t) => t === 'exitVehicle')).toHaveLength(1);
    expect(types()).toContain('playerDied');
  });

  it('own car exploding hurts once and throws you clear of it', () => {
    const { player } = setup();
    const v = car();
    player.enter(v);
    player.ownCarExploded();
    expect(player.health).toBe(MAX_HEALTH - OWN_CAR_BLAST_DAMAGE);
    expect(player.alive).toBe(true);
    expect(Math.hypot(player.ped.vx, player.ped.vz)).toBeCloseTo(4);
    expect(player.stunned).toBeGreaterThanOrEqual(2.5);
  });

  it('a blast that kills keeps the body down until respawn', () => {
    const { player } = setup();
    player.health = 20;
    player.hurt(40); // dies: stunned for the whole death
    player.knockDown(3, 0, 6, 2, 'blast', false); // the blast's own (shorter) knock-down
    expect(player.stunned).toBeGreaterThanOrEqual(RESPAWN_SECONDS);
    const t = runUntilRespawn(player);
    expect(t).toBeGreaterThan(RESPAWN_SECONDS - 0.1);
    expect(t).toBeLessThan(RESPAWN_SECONDS + 0.1);
  });

  it('cannot get into a car while dead or stunned, or into a wreck', () => {
    const { player } = setup();
    const v = car();
    player.stunned = 1;
    expect(player.enter(v)).toBe(false);
    player.stunned = 0;
    player.hurt(500);
    expect(player.canEnter).toBe(false);
    expect(player.enter(v)).toBe(false);
    expect(player.driving).toBeNull();

    const fresh = setup().player;
    const wreck = car();
    wreck.damage.wrecked = true;
    expect(fresh.enter(wreck)).toBe(false);
  });

  it('dying at the wheel gets you out first; respawn is always on foot', () => {
    const { player, types } = setup();
    const v = car();
    player.enter(v);
    player.hurt(MAX_HEALTH);
    expect(player.driving).toBeNull();
    runUntilRespawn(player);
    player.respawn(9.5, 9.5);
    expect(player.driving).toBeNull();
    expect(player.alive).toBe(true);
    expect(player.ready).toBe(true);
    expect(player.health).toBe(MAX_HEALTH);
    expect(player.ped.x).toBe(9.5);
    expect(player.arsenal.current).toBeNull();
    expect(types().slice(-1)).toEqual(['respawn']);
  });

  it('a restart at the wheel gets out first (exitVehicle), then respawns on foot', () => {
    const { player, types } = setup();
    player.enter(car());
    player.respawn(9.5, 9.5);
    expect(player.driving).toBeNull();
    expect(player.ped.x).toBe(9.5);
    expect(types().slice(-2)).toEqual(['exitVehicle', 'respawn']);
  });

  it('reports hurt with the remaining health, and ignores damage when dead', () => {
    const { player, log } = setup();
    player.hurt(30);
    expect(log[0]).toEqual({ type: 'playerHurt', amount: 30, health: 70, armour: 0, absorbed: 0 });
    player.hurt(100);
    const n = log.length;
    player.hurt(10);
    expect(log.length).toBe(n);
  });

  it('armour soaks up hits before health, and is lost on death', () => {
    const { player, log } = setup();
    expect(player.addArmour(60)).toBe(60);
    expect(player.addArmour(60)).toBe(MAX_ARMOUR - 60); // tops up to the cap
    expect(player.addArmour(10)).toBe(0); // full: a pickup can stay put
    player.hurt(30);
    expect(player.health).toBe(MAX_HEALTH);
    expect(player.armour).toBe(MAX_ARMOUR - 30);
    player.hurt(MAX_ARMOUR); // the rest of the armour, then 30 off health
    expect(player.armour).toBe(0);
    expect(player.health).toBe(MAX_HEALTH - 30);
    expect(log.at(-1)).toMatchObject({ type: 'playerHurt', amount: MAX_ARMOUR, absorbed: MAX_ARMOUR - 30, armour: 0 });
    player.addArmour(50);
    player.hurt(1000);
    player.respawn(0, 0);
    expect(player.armour).toBe(0);
  });

  it('a badly hurt player recovers a little when left alone', () => {
    const { player } = setup();
    player.hurt(90);
    for (let t = 0; t < REGEN_DELAY - 0.5; t += DT) player.step(DT);
    expect(player.health).toBe(10);
    for (let t = 0; t < 15; t += DT) player.step(DT);
    expect(player.health).toBe(REGEN_TO);
  });

  it('stuns wear off on foot and knock-downs never shorten one', () => {
    const { player, log } = setup();
    player.knockDown(1, 0, 6, 2.5, 'blast', true);
    player.knockDown(1, 0, 6, 1, 'blast', true);
    expect(player.stunned).toBe(2.5);
    expect(player.ped.vx).toBeLessThan(0); // pushed away from (1, 0)
    expect(log.filter((e) => e.type === 'pedDown' && e.isPlayer)).toHaveLength(2);
    for (let t = 0; t < 2.6; t += DT) player.step(DT);
    expect(player.ready).toBe(true);
  });
});

describe('player: arrest', () => {
  it('drags you out of the car, takes your guns, holds you, then releases you', () => {
    const { player, log, types } = setup();
    const v = car();
    player.enter(v);
    player.arsenal.pickUp('smg');
    expect(player.arrest(123)).toBe(true);
    expect(player.driving).toBeNull();
    expect(player.arrested).toBe(true);
    expect(player.ready).toBe(false);
    expect(player.down).toBe(true);
    expect(player.arsenal.current).toBeNull();
    expect(types()).toContain('exitVehicle');
    expect(log.find((e) => e.type === 'busted')).toEqual({ type: 'busted', fine: 123 });
    // Can't be hurt, or arrested again, while held.
    expect(player.hurt(500)).toBe(false);
    expect(player.arrest()).toBe(false);
    expect(player.enter(car())).toBe(false);
    let released = -1;
    for (let t = 0; t < 10; t += DT) {
      if (player.step(DT)) {
        released = t;
        break;
      }
    }
    expect(released).toBeCloseTo(BUSTED_SECONDS, 1);
    expect(player.arrested).toBe(false);
    player.respawn(0, 0);
    expect(player.ready).toBe(true);
  });

  it('the dead can’t be arrested', () => {
    const { player } = setup();
    player.hurt(1000);
    expect(player.arrest()).toBe(false);
  });

  it('says when you take a police car', () => {
    const { player, log } = setup();
    const v = car();
    v.archetype = 'police';
    player.enter(v);
    expect(log.find((e) => e.type === 'enterVehicle')).toMatchObject({ police: true });
  });
});
