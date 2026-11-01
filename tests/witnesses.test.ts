import { describe, expect, it, vi } from 'vitest';
import type { ColorRepresentation } from 'three';
import { EventBus } from '../src/core/events';
import { VEHICLE_HEALTH, createVehicleState, type VehicleArchetype } from '../src/entities/vehicle';
import { Heat } from '../src/game/heat';
import { Player } from '../src/game/player';
import { Population, type Vehicle } from '../src/game/population';
import type { CarMesh } from '../src/render/carMesh';
import type { CharacterModel } from '../src/render/characterModel';
import { createDamage } from '../src/systems/damage';
import { Score } from '../src/systems/score';
import type { Crime } from '../src/systems/wanted';
import { CALL_RANGE, DELAYED_CRIMES, react, sees, stepCall, type CallState } from '../src/systems/witnesses';
import { generateCity, type Rect } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

describe('witnesses: who saw it', () => {
  it('sees what is in range and roughly ahead, not behind or far off', () => {
    // Facing +z (heading 0).
    expect(sees(0, 0, 0, 0, 10)).toBe(true);
    expect(sees(0, 0, 0, 8, 10)).toBe(true);
    expect(sees(0, 0, 0, 0, -10)).toBe(false);
    expect(sees(0, 0, 0, 15, 2)).toBe(false);
    expect(sees(0, 0, 0, 0, 40)).toBe(false);
    // Right beside it, they notice whichever way they face.
    expect(sees(0, 0, 0, 0, -2)).toBe(true);
  });

  it('only lesser crimes wait for a call', () => {
    expect([...DELAYED_CRIMES].sort()).toEqual(['assault', 'carjack']);
    for (const c of ['gunfire', 'explosion', 'ramCop', 'shootCop', 'copDown', 'copCarWrecked', 'copCarStolen'] as Crime[]) expect(DELAYED_CRIMES.has(c)).toBe(false);
  });

  it('the first witness calls when a call can be made; the rest mostly film or run', () => {
    const rand = random(3);
    expect(react(rand, true, true)).toBe('call');
    expect(react(() => 0.9, true, false)).toBe('flee');
    const n = { call: 0, film: 0, flee: 0 };
    for (let i = 0; i < 2000; i++) n[react(rand, false, true)]++;
    expect(n.call / 2000).toBeGreaterThan(0.15);
    expect(n.call / 2000).toBeLessThan(0.25);
    expect(n.film).toBeGreaterThan(400);
    expect(n.flee).toBeGreaterThan(800);
  });

  it('a call gets through after its time, unless the caller is stopped or the player gets clear first', () => {
    const call = (): CallState => ({ phase: 'calling', time: 0, needs: 4 });
    const a = call();
    for (let t = 0; t < 3.9; t += 0.1) expect(stepCall(a, 0.1, true, 10)).toBe('calling');
    for (let i = 0; i < 3; i++) stepCall(a, 0.1, true, 10);
    expect(a.phase).toBe('through');
    const b = call();
    stepCall(b, 1, true, 10);
    expect(stepCall(b, 0.1, false, 10)).toBe('dropped');
    // Dropped stays dropped.
    expect(stepCall(b, 5, true, 10)).toBe('dropped');
    const c = call();
    stepCall(c, 1, true, 10);
    expect(stepCall(c, 0.1, true, CALL_RANGE + 1)).toBe('dropped');
  });
});

describe('witnesses: the heat hook', () => {
  const city = generateCity(1337);
  const grid = new StaticGrid(city.obstacles);

  function world(witnesses?: (crime: Crime, x: number, z: number) => boolean) {
    const bus = new EventBus();
    const rand = random(5);
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
        resetVehicle: () => {},
        createPedModel: (_o, body) => ({ root: { visible: true }, dispose: vi.fn(), setOutfit: vi.fn(), reset: vi.fn(), bodyKind: body }) as unknown as CharacterModel,
      },
      rand,
    );
    const player = new Player(bus, 9.5, 9.5);
    const view: Rect = { minX: -20, minZ: -5, maxX: 40, maxZ: 25 };
    const heat = new Heat({
      bus,
      city,
      grid,
      vehicles,
      population,
      player,
      score: new Score(),
      rand,
      view: () => view,
      playing: () => true,
      award: () => {},
      ejectDriver: () => {},
      npcShoot: () => {},
      repaint: () => {},
      witnesses,
    });
    return { bus, heat };
  }

  it('without the hook, or when it finds nobody, a crime on screen counts at once (as before)', () => {
    for (const hook of [undefined, () => false]) {
      const w = world(hook);
      w.bus.emit({ type: 'pedDown', x: 12, z: 9, cause: 'punch', byPlayer: true });
      expect(w.heat.wanted.heat).toBeCloseTo(0.3);
    }
  });

  it('a lesser crime a witness takes waits for the call; called() lands it', () => {
    const taken: Crime[] = [];
    const w = world((crime) => (taken.push(crime), true));
    w.bus.emit({ type: 'pedDown', x: 12, z: 9, cause: 'punch', byPlayer: true });
    w.bus.emit({ type: 'carjack', x: 12, z: 9 });
    expect(taken).toEqual(['assault', 'carjack']);
    expect(w.heat.wanted.heat).toBe(0);
    w.heat.called('assault');
    expect(w.heat.wanted.heat).toBeCloseTo(0.3);
  });

  it('immediate crimes never go to the witnesses', () => {
    const hook = vi.fn(() => true);
    const w = world(hook);
    w.bus.emit({ type: 'shot', x: 12, z: 9, dirX: 1, dirZ: 0, weapon: 'pistol', byPlayer: true });
    w.bus.emit({ type: 'pedDown', x: 12, z: 9, cause: 'punch', byPlayer: true, cop: true });
    w.bus.emit({ type: 'explosion', x: 12, z: 9, distance: 0, byPlayer: true });
    expect(hook).not.toHaveBeenCalled();
    expect(w.heat.wanted.heat).toBeCloseTo(0.05 + 1 + 0.6);
  });

  it('unseen crimes stay unseen: the hook is only asked about witnessed ones', () => {
    const hook = vi.fn(() => true);
    const w = world(hook);
    w.bus.emit({ type: 'pedDown', x: 400, z: 400, cause: 'punch', byPlayer: true });
    expect(hook).not.toHaveBeenCalled();
    expect(w.heat.wanted.heat).toBe(0);
  });
});
