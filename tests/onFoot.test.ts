/**
 * Stage 6 (on foot): the dodge roll, the three enemy kinds and the bat.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BODY_KINDS } from '../src/game/bodies';
import { EventBus, type GameEvent } from '../src/core/events';
import { PLAYER_ON_FOOT } from '../src/entities/pedestrian';
import { Combat, NPC_BAT_DAMAGE, NPC_PELLET_DAMAGE, SWING_CONTACT, type AimInput } from '../src/game/combat';
import { crewRole } from '../src/game/modes/gangMode';
import { Player } from '../src/game/player';
import type { CrowdPed, Vehicle } from '../src/game/population';
import { ROLL_COOLDOWN, ROLL_DISTANCE, ROLL_SECONDS, Roll } from '../src/game/roll';
import type { CharacterModel } from '../src/render/characterModel';
import { HEAVY_KNOCK, HEAVY_SPEC, HEAVY_TAKEN, NPC_SPEC, PED_HP, RUSHER_HP, RUSHER_SPEC, hurtPed, makeEnemy, spawnPed } from '../src/systems/crowd';
import { Score } from '../src/systems/score';
import { Arsenal, WEAPONS, WEAPON_ORDER } from '../src/systems/weapons';
import { BAT_COUNT, generateBats, placePickups } from '../src/world/pickups';
import { NO_EDITS } from '../src/world/mapEdits';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const DT = 1 / 60;

function ped(x: number, z: number): CrowdPed {
  const agent = spawnPed(8, 8, 0, 0.5, random(3));
  agent.s.x = x;
  agent.s.z = z;
  agent.temper = 'calm';
  const model = { punch() {}, swingBat() {}, shoot() {} } as unknown as CharacterModel;
  return { agent, prev: { ...agent.s }, model };
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
    award: () => {},
    ejectDriver: () => {},
    now: () => time,
    playing: () => true,
    focus: () => ({ x: 0, z: 0 }),
    stars: () => 0,
  });
  const step = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      time += DT;
      player.step(DT);
      player.roll.move(player.ped, DT);
      combat.step(DT);
    }
  };
  return { bus, log, player, crowd, combat, step };
}

const NO_AIM: AimInput = { heading: null, reach: 0, ground: null };
const STILL = { x: 0, y: 0, sprint: false };

describe('dodge roll', () => {
  it('carries ROLL_DISTANCE along the stick in ROLL_SECONDS, then cools down', () => {
    const r = new Roll();
    const s = { x: 0, z: 0, vx: 0, vz: 0, heading: 0 };
    // Stick right (screen-relative: world +X).
    expect(r.start({ x: 1, y: 0, sprint: true }, 0)).toBe(true);
    let t = 0;
    while (r.move(s, DT)) {
      r.tick(DT);
      t += DT;
    }
    expect(s.x).toBeCloseTo(ROLL_DISTANCE, 5);
    expect(s.z).toBeCloseTo(0, 5);
    expect(t).toBeCloseTo(ROLL_SECONDS, 1);
    expect(r.start(STILL, 0)).toBe(false);
    for (let k = 0; k < Math.ceil(ROLL_COOLDOWN / DT) + 1; k++) r.tick(DT);
    expect(r.readiness).toBe(1);
    expect(r.start(STILL, 0)).toBe(true);
  });

  it('with the stick at rest, rolls the way they face; screen-up is world -Z', () => {
    const r = new Roll();
    r.start(STILL, Math.PI / 2);
    expect(r.dirX).toBeCloseTo(1);
    const u = new Roll();
    u.start({ x: 0, y: 1, sprint: false }, 0);
    expect(u.dirZ).toBeCloseTo(-1);
  });

  it('nothing lands mid-roll: no damage, no knock-down; after it, hits land again', () => {
    const { player, step } = setup();
    expect(player.tryRoll({ x: 1, y: 0, sprint: false })).toBe(true);
    const hp = player.health;
    expect(player.hurt(30)).toBe(false);
    player.knockDown(1, 0, 3, 2, 'punch', false);
    expect(player.health).toBe(hp);
    expect(player.stunned).toBe(0);
    step(ROLL_SECONDS + 0.05);
    expect(player.rolling).toBe(false);
    player.hurt(30);
    expect(player.health).toBe(hp - 30);
  });

  it('not in a car, not while down, and says so on the bus', () => {
    const { player, log } = setup();
    player.stunned = 1;
    expect(player.tryRoll(STILL)).toBe(false);
    player.stunned = 0;
    expect(player.tryRoll(STILL)).toBe(true);
    expect(log.some((e) => e.type === 'roll')).toBe(true);
  });
});

describe('enemy kinds', () => {
  it('a rusher is lighter and closes faster than a fighter, still short of the player’s sprint', () => {
    const a = spawnPed(8, 8, 0, 0.5, random(1));
    makeEnemy(a, 'rusher', true);
    expect(a.hp).toBe(RUSHER_HP);
    expect(a.temper).toBe('fighter');
    expect(a.bat).toBe(true);
    expect(RUSHER_SPEC.runSpeed).toBeGreaterThan(NPC_SPEC.runSpeed * 0.95);
    expect(RUSHER_SPEC.runSpeed).toBeLessThan(PLAYER_ON_FOOT.runSpeed);
  });

  it('a heavy is armed, slow, takes half of every hit and isn’t floored by a punch or a bat', () => {
    const a = spawnPed(8, 8, 0, 0.5, random(1));
    makeEnemy(a, 'heavy');
    expect(a.temper).toBe('armed');
    expect(HEAVY_SPEC.runSpeed).toBeLessThan(PLAYER_ON_FOOT.walkSpeed * 1.5);
    expect(hurtPed(a, 40, 0, 0, 4.5)).toBe('hit');
    expect(a.hp).toBe(PED_HP - 40 * HEAVY_TAKEN);
    a.stagger = 0;
    // A blast's or a car's push still bowls them over.
    expect(hurtPed(a, 10, 0, 0, HEAVY_KNOCK)).toBe('down');
  });

  it('VIPERS crews: a shooter, a rusher (a bat at every other corner), then a rusher or, at every other corner, a heavy', () => {
    for (let slot = 0; slot < 5; slot++) {
      expect(crewRole(slot, 0).kind).toBeNull();
      expect(crewRole(slot, 1)).toEqual({ kind: 'rusher', bat: slot % 2 === 0 });
      expect(crewRole(slot, 2).kind).toBe(slot % 2 === 1 ? 'heavy' : 'rusher');
    }
  });
});

describe('SWAT', () => {
  it('a SWAT truck’s second officer is a heavy with a shotgun; the first keeps the SMG', async () => {
    const { PoliceForce } = await import('../src/systems/police');
    const { createVehicleState } = await import('../src/entities/vehicle');
    const { createDamage } = await import('../src/systems/damage');
    const peds: CrowdPed[] = [];
    const bodies: string[] = [];
    const police = new PoliceForce(
      {
        takeVehicle: (archetype: Vehicle['archetype'], paint: string) => {
          const sim = createVehicleState();
          return { archetype, paint, sim, prev: { ...sim }, mesh: { siren: false }, ai: null, damage: createDamage(), wreckAge: 0, charred: false } as unknown as Vehicle;
        },
        retireVehicle: () => {},
        addPed: (agent, _outfit, body) => {
          const c = { agent, prev: { ...agent.s } } as unknown as CrowdPed;
          peds.push(c);
          bodies.push(body ?? '');
          return c;
        },
        removePed: () => {},
      },
      () => {},
    );
    const p = police as unknown as { borrowCar(k: string, x: number, z: number, h: number): Vehicle; addUnit(v: Vehicle, k: string, r: string, road: unknown): unknown; deploy(u: unknown, rand: () => number, n: number): void };
    const v = p.borrowCar('swat', 0, 0, 0);
    const u = p.addUnit(v, 'swat', 'pursuit', {});
    p.deploy(u, random(2), 2);
    expect(peds.map((c) => c.gun)).toEqual(['smg', 'shotgun']);
    expect(bodies).toEqual(['cop', 'heavy']);
    expect(peds[1].agent.kind).toBe('heavy');
    expect(peds[1].agent.role).toBe('cop');
  });
});

describe('the bat', () => {
  it('comes first in the weapon order, swings without spending, and breaks after its hits', () => {
    expect(WEAPON_ORDER[0]).toBe('bat');
    const a = new Arsenal();
    a.pickUp('pistol');
    a.pickUp('bat');
    a.current = 'bat';
    expect(a.tryFire()).toBe('bat');
    expect(a.ammo.get('bat')).toBe(WEAPONS.bat.pickupAmmo);
    for (let i = 1; i < WEAPONS.bat.pickupAmmo; i++) expect(a.wear('bat')).toBe(false);
    expect(a.wear('bat')).toBe(true);
    expect(a.has('bat')).toBe(false);
    expect(a.current).toBe('pistol');
    // An ammo crate doesn't mend it.
    a.pickUp('bat');
    a.ammo.set('bat', 1);
    a.addAmmo();
    expect(a.ammo.get('bat')).toBe(1);
  });

  it('lands at the Swing clip’s contact, floors an ordinary person in one, and wears one hit per swing that lands', () => {
    const { player, crowd, combat, step, log } = setup();
    player.arsenal.pickUp('bat');
    const c = ped(0, 1.5);
    crowd.push(c);
    expect(combat.fire(NO_AIM)).toBe(true);
    step(SWING_CONTACT * 0.5);
    expect(c.agent.mode).not.toBe('down');
    step(SWING_CONTACT);
    expect(c.agent.mode).toBe('down');
    expect(player.arsenal.ammo.get('bat')).toBe(WEAPONS.bat.pickupAmmo - 1);
    expect(log.some((e) => e.type === 'punch' && e.bat && e.hit)).toBe(true);
    // A swing at nobody costs nothing.
    step(1);
    combat.fire(NO_AIM);
    step(0.5);
    expect(player.arsenal.ammo.get('bat')).toBe(WEAPONS.bat.pickupAmmo - 1);
  });

  it('a heavy takes several swings', () => {
    const { player, crowd, combat, step } = setup();
    player.arsenal.pickUp('bat');
    const c = ped(0, 1.5);
    makeEnemy(c.agent, 'heavy');
    crowd.push(c);
    let swings = 0;
    while (c.agent.mode !== 'down' && swings < 10) {
      combat.fire(NO_AIM);
      swings++;
      step(1);
      c.agent.s.x = 0;
      c.agent.s.z = 1.5;
    }
    expect(swings).toBeGreaterThanOrEqual(3);
    expect(c.agent.mode).toBe('down');
  });

  it('a rusher’s bat lands at its contact, unless the player rolled clear', () => {
    for (const roll of [false, true]) {
      const { player, crowd, combat, step } = setup();
      const c = ped(0, 1.2);
      makeEnemy(c.agent, 'rusher', true);
      crowd.push(c);
      const hp = player.health;
      combat.npcPunch(c);
      if (roll) player.tryRoll({ x: 1, y: 0, sprint: false });
      step(SWING_CONTACT + 0.05);
      expect(player.health).toBe(roll ? hp : hp - NPC_BAT_DAMAGE);
    }
  });

  it('a heavy’s shotgun throws pellets that hurt up close', () => {
    const { player, crowd, combat, log } = setup();
    const c = ped(0, 4);
    makeEnemy(c.agent, 'heavy');
    c.gun = 'shotgun';
    crowd.push(c);
    combat.npcFire(c, 0, -1);
    expect(log.filter((e) => e.type === 'shot' && !e.byPlayer)).toHaveLength(1);
    expect(player.health).toBeLessThan(100);
    expect((100 - player.health) % NPC_PELLET_DAMAGE).toBe(0);
  });

  it('lies loose at a handful of spots, after every crate (their ids and kinds stay put)', () => {
    const bats = generateBats(1337);
    expect(bats).toHaveLength(BAT_COUNT);
    const all = placePickups(1337, NO_EDITS);
    const crates = all.filter((p) => p.kind !== 'bat');
    expect(all.filter((p) => p.kind === 'bat').map((p) => p.id)).toEqual(bats.map((_, i) => `pickup-bat-${i}`));
    expect(crates.every((p) => !p.id!.startsWith('pickup-bat'))).toBe(true);
  });
});

/** A GLB's JSON chunk (no loader needed for names, extras and clip lengths). */
function gltfJson(name: string): any {
  const d = readFileSync(`public/assets/${name}.glb`);
  return JSON.parse(d.subarray(20, 20 + d.readUInt32LE(12)).toString('utf8'));
}

describe('stage 6 assets, as BLENDER_TODO §18–20 promise', () => {
  const clipLength = (g: any, name: string): number => {
    const a = g.animations.find((x: { name: string }) => x.name === name);
    if (!a) return NaN;
    return Math.max(...a.samplers.map((s: { input: number }) => g.accessors[s.input].max[0]));
  };

  it('every body (the heavy too) has Roll (0.333 s), Swing (0.417 s) and AimBat (0.292 s)', () => {
    for (const body of BODY_KINDS) {
      const g = gltfJson(body);
      expect(clipLength(g, 'Roll'), body).toBeCloseTo(0.333, 2);
      expect(clipLength(g, 'Swing'), body).toBeCloseTo(0.417, 2);
      expect(clipLength(g, 'AimBat'), body).toBeCloseTo(0.292, 2);
    }
  });

  it('weapons.glb has the bat with its tip at 0.785 m; pickups.glb has bat_pickup', () => {
    const w = gltfJson('weapons');
    const bat = w.scenes[0].nodes.map((i: number) => w.nodes[i]).find((n: { name: string }) => n.name === 'bat');
    expect(bat?.extras?.muzzle).toBeCloseTo(0.785, 3);
    const p = gltfJson('pickups');
    expect(p.scenes[0].nodes.map((i: number) => p.nodes[i].name)).toContain('bat_pickup');
  });
});
