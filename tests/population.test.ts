import { describe, expect, it, vi } from 'vitest';
import type { ColorRepresentation } from 'three';
import { VEHICLE_HEALTH, createVehicleState, type VehicleArchetype } from '../src/entities/vehicle';
import {
  CROWD_COUNT,
  CROWD_DESPAWN,
  MAX_IDLE_VEHICLES,
  Population,
  TRAFFIC_COUNT,
  TRAFFIC_DESPAWN,
  VIEW_MARGIN,
  inRect,
  type MaintainContext,
  type ParkingSpot,
  type Vehicle,
} from '../src/game/population';
import type { CarMesh } from '../src/render/carMesh';
import type { CharacterModel } from '../src/render/characterModel';
import { spawnAi } from '../src/systems/traffic';
import { createDamage } from '../src/systems/damage';
import { WORLD_LIMIT, type Rect } from '../src/world/city';
import { random } from './helpers';

/** Population with fake meshes/models, counting what it builds. */
function setup(seed = 1) {
  const vehicles: Vehicle[] = [];
  const created = { vehicles: 0, models: 0, resets: 0 };
  const makeVehicle = (archetype: VehicleArchetype, paint: ColorRepresentation, x = 0, z = 0): Vehicle => {
    created.vehicles++;
    const sim = createVehicleState(x, z);
    return {
      archetype,
      paint,
      sim,
      prev: { ...sim },
      mesh: { root: { visible: true }, frontWheels: [] } as unknown as CarMesh,
      ai: null,
      damage: createDamage(VEHICLE_HEALTH[archetype]),
      wreckAge: 0,
      charred: false,
    };
  };
  const pop = new Population(
    vehicles,
    {
      createVehicle: (a, p) => makeVehicle(a, p),
      resetVehicle: (v) => {
        created.resets++;
        v.damage = createDamage(VEHICLE_HEALTH[v.archetype]);
        v.charred = false;
      },
      createPedModel: () => {
        created.models++;
        return { root: { visible: true }, dispose: vi.fn() } as unknown as CharacterModel;
      },
    },
    random(seed),
  );
  return { pop, vehicles, created, makeVehicle };
}

/** A view rectangle like the on-foot camera's (±18 × ±8 m on an iPhone in landscape). */
function viewAround(x: number, z: number, hw = 18, hh = 8): Rect {
  return { minX: x - hw, maxX: x + hw, minZ: z - hh, maxZ: z + hh };
}

function ctx(x: number, z: number, extra: Partial<MaintainContext> = {}): MaintainContext {
  return { x, z, vx: 0, vz: 0, view: viewAround(x, z), keep: [], ...extra };
}

describe('population: recycling', () => {
  it('keeps the vehicle list bounded through endless carjacks and ejections', () => {
    const { pop, vehicles, created } = setup(7);
    const rand = random(99);
    pop.maintain(ctx(0, 0, { seed: true }));
    let px = 0;
    let pz = 0;
    for (let i = 0; i < 400; i++) {
      // Wander round the city, pulling drivers out of nearby cars as we go.
      px = Math.max(-480, Math.min(480, px + (rand() - 0.5) * 60));
      pz = Math.max(-480, Math.min(480, pz + (rand() - 0.5) * 60));
      const victim = vehicles.find((v) => v.ai);
      if (victim) {
        victim.ai = null;
        victim.sim.x = px + 5;
        victim.sim.z = pz;
      }
      pop.maintain(ctx(px, pz));
      expect(vehicles.length).toBeLessThanOrEqual(Population.maxVehicles());
    }
    expect(created.vehicles).toBeLessThanOrEqual(Population.maxVehicles());
    // Abandoned cars near the player are capped too.
    const idle = vehicles.filter((v) => !v.ai);
    expect(idle.length).toBeLessThanOrEqual(MAX_IDLE_VEHICLES + 1);
  });

  it('never strands cars off the map when placement fails near a corner', () => {
    const { pop, vehicles } = setup(9);
    for (let i = 0; i < 200; i++) {
      for (const v of vehicles) v.ai = null; // force fresh spawns every call
      pop.maintain(ctx(515, 515));
    }
    for (const v of vehicles) {
      expect(Math.abs(v.sim.x)).toBeLessThan(WORLD_LIMIT);
      expect(Math.abs(v.sim.z)).toBeLessThan(WORLD_LIMIT);
    }
    expect(vehicles.length).toBeLessThanOrEqual(Population.maxVehicles());
  });

  it('recycles far-away driverless and wrecked cars, but never the kept ones', () => {
    const { pop, vehicles, makeVehicle } = setup(3);
    const mine = makeVehicle('sports', '#fff', 0, 0);
    const parked = makeVehicle('police', '#fff', 10, 0);
    const wreck = makeVehicle('sedan', '#333', 20, 0);
    wreck.damage.wrecked = true;
    wreck.charred = true;
    vehicles.push(mine, parked, wreck);
    pop.maintain(ctx(0, 0, { keep: [mine] }));
    expect(vehicles).toContain(parked);
    // Player drives 600 m away (in another car).
    for (let i = 0; i < 20; i++) pop.maintain(ctx(600, 0, { keep: [mine] }));
    expect(vehicles).toContain(mine);
    // The parked police car was recycled: gone, or back as ordinary traffic out here.
    if (vehicles.includes(parked)) {
      expect(parked.ai).not.toBeNull();
      expect(parked.archetype).not.toBe('police');
      expect(Math.hypot(parked.sim.x - 600, parked.sim.z)).toBeLessThan(TRAFFIC_DESPAWN);
    }
    // The wreck may come back as traffic, but only restyled and repaired.
    if (vehicles.includes(wreck)) {
      expect(wreck.charred).toBe(false);
      expect(wreck.damage.wrecked).toBe(false);
      expect(wreck.ai).not.toBeNull();
    }
  });

  it('puts the spawn point\'s parked cars back on respawn, reusing retired cars', () => {
    const { pop, vehicles, created } = setup(21);
    const parked: ParkingSpot[] = [
      { archetype: 'police', paint: '#f2f2f2', x: 5.5, z: 34, heading: Math.PI },
      { archetype: 'sports', paint: '#e8b923', x: -22, z: -5.5, heading: -Math.PI / 2 },
    ];
    pop.maintain(ctx(9.5, 9.5, { seed: true, parked }));
    const atSpot = (spot: ParkingSpot) =>
      vehicles.find((v) => !v.ai && Math.hypot(v.sim.x - spot.x, v.sim.z - spot.z) < 0.01);
    for (const spot of parked) expect(atSpot(spot)?.archetype).toBe(spot.archetype);
    // One gets wrecked, then the player drives far away: both are recycled.
    atSpot(parked[1])!.damage.wrecked = true;
    atSpot(parked[1])!.charred = true;
    for (let i = 0; i < 10; i++) pop.maintain(ctx(600, 0));
    for (const spot of parked) expect(atSpot(spot)).toBeUndefined();
    const built = created.vehicles;
    // Wasted out there; respawn at the start.
    pop.maintain(ctx(9.5, 9.5, { seed: true, parked }));
    for (const spot of parked) {
      const car = atSpot(spot)!;
      expect(car.archetype).toBe(spot.archetype);
      expect(car.paint).toBe(spot.paint);
      expect(car.mesh.root.visible).toBe(true);
      expect(car.charred).toBe(false);
      expect(car.damage.wrecked).toBe(false);
    }
    expect(created.vehicles).toBe(built); // all from the spare pool
    // Spots that already have a car aren't doubled up.
    const n = vehicles.length;
    pop.maintain(ctx(9.5, 9.5, { seed: true, parked }));
    expect(vehicles.length).toBe(n);
    expect(vehicles.length).toBeLessThanOrEqual(Population.maxVehicles());
  });

  it('recycles a hopelessly stuck AI car once it is off-screen', () => {
    const { pop, vehicles } = setup(4);
    pop.maintain(ctx(0, 0, { seed: true }));
    const stuck = vehicles.find((v) => v.ai)!;
    stuck.sim.x = 30;
    stuck.sim.z = 30;
    stuck.ai!.stalled = 60;
    pop.maintain(ctx(0, 0, { view: viewAround(30, 30) })); // on screen: left alone
    expect(vehicles).toContain(stuck);
    pop.maintain(ctx(0, 0)); // off screen: recycled
    expect(stuck.ai === null || stuck.ai.stalled === 0).toBe(true);
  });

  it('reuses ped models instead of building new ones', () => {
    const { pop, created } = setup(5);
    for (let i = 0; i < 60; i++) pop.maintain(ctx(i % 2 ? 400 : -400, 0, { seed: true }));
    // Each teleport swaps the whole crowd; pooled models make that free.
    expect(created.models).toBeLessThanOrEqual(CROWD_COUNT * 2 + 4);
    expect(pop.stats.spareModels).toBeLessThanOrEqual(40);
  });
});

describe('population: density and placement', () => {
  it('a seed pass fills the streets near the player, all of it out of view', () => {
    const { pop, vehicles } = setup(11);
    const view = viewAround(9.5, 9.5);
    pop.maintain(ctx(9.5, 9.5, { view, seed: true }));
    expect(pop.crowd.length).toBe(CROWD_COUNT);
    expect(vehicles.filter((v) => v.ai).length).toBe(TRAFFIC_COUNT);
    const near = pop.crowd.filter((c) => Math.hypot(c.agent.s.x - 9.5, c.agent.s.z - 9.5) < 45);
    expect(near.length).toBeGreaterThanOrEqual(CROWD_COUNT / 2);
    for (const c of pop.crowd) expect(inRect(c.agent.s.x, c.agent.s.z, view, VIEW_MARGIN - 1)).toBe(false);
    for (const v of vehicles) expect(inRect(v.sim.x, v.sim.z, view, VIEW_MARGIN)).toBe(false);
  });

  it('never spawns into the camera view while driving, even with a wide view', () => {
    const { pop, vehicles } = setup(12);
    let x = -300;
    const z = 0;
    const seen = new Set<object>();
    pop.maintain(ctx(x, z, { seed: true }));
    for (const c of pop.crowd) seen.add(c.agent);
    for (const v of vehicles) seen.add(v.sim);
    for (let i = 0; i < 120; i++) {
      x += 10; // 40 m/s across the map, maintained 4x a second
      const view = viewAround(x + 20, z, 52, 24); // camera at ~58 m, leading ahead
      const before = new Set(vehicles.filter((v) => v.ai).map((v) => v.ai));
      pop.maintain(ctx(x, z, { vx: 40, vz: 0, view }));
      for (const c of pop.crowd) {
        if (seen.has(c.agent)) continue;
        seen.add(c.agent);
        expect(inRect(c.agent.s.x, c.agent.s.z, view, VIEW_MARGIN - 1)).toBe(false);
      }
      for (const v of vehicles) {
        if (!v.ai || before.has(v.ai)) continue;
        expect(inRect(v.sim.x, v.sim.z, view, VIEW_MARGIN)).toBe(false);
      }
    }
  });

  it('only despawns peds that are far away and off-screen', () => {
    const { pop } = setup(13);
    pop.maintain(ctx(0, 0, { seed: true }));
    const ped = pop.crowd[0];
    ped.agent.s.x = CROWD_DESPAWN + 20;
    ped.agent.s.z = 0;
    const huge: Rect = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
    pop.maintain(ctx(0, 0, { view: huge }));
    expect(pop.crowd).toContain(ped);
    pop.maintain(ctx(0, 0));
    expect(pop.crowd).not.toContain(ped);
  });

  it('puts most new traffic ahead of a moving player', () => {
    let ahead = 0;
    let total = 0;
    for (let seed = 20; seed < 30; seed++) {
      const { pop, vehicles } = setup(seed);
      pop.maintain(ctx(-200, 0, { vx: 30, vz: 0 , seed: true }));
      for (const v of vehicles) {
        total++;
        if (v.sim.x > -200) ahead++;
      }
    }
    expect(ahead / total).toBeGreaterThan(0.7);
  });

  it('spawns peds in small groups at corners', () => {
    const { pop } = setup(14);
    pop.maintain(ctx(0, 0, { seed: true }));
    // Most peds have a neighbour within a few metres.
    const withCompany = pop.crowd.filter((c) =>
      pop.crowd.some((o) => o !== c && Math.hypot(o.agent.s.x - c.agent.s.x, o.agent.s.z - c.agent.s.z) < 6),
    );
    expect(withCompany.length / pop.crowd.length).toBeGreaterThan(0.7);
  });

  it('scales the counts with the quality tier', () => {
    const { pop, vehicles } = setup(15);
    pop.maintain(ctx(0, 0, { seed: true, crowdScale: 0.5, trafficScale: 0.5 }));
    expect(pop.crowd.length).toBe(Math.round(CROWD_COUNT * 0.5));
    expect(vehicles.filter((v) => v.ai).length).toBe(Math.round(TRAFFIC_COUNT * 0.5));
  });

  it('despawn distances leave room beyond the spawn rings', () => {
    expect(TRAFFIC_DESPAWN).toBeGreaterThan(160);
    expect(CROWD_DESPAWN).toBeGreaterThan(60);
    expect(spawnAi(0, 0, 0, 0.5, random(1))).not.toBeNull();
  });
});
