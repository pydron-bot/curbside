/**
 * Start any of the city's scenes now, round a point: the TEST menu's scene
 * buttons (game/testTools.ts, round the player) and the title's highlights
 * (game/attractHighlights.ts, round the attract camera) share it. Most
 * scenes look round the camera's focus themselves (CityLifeDeps.focus);
 * the fire, the tow and the alarm get a car put down near the point given.
 * Nothing here is a cheat by itself: TestTools taints the life.
 */
import { createVehicleState, type VehicleArchetype } from '../entities/vehicle';
import { applyDamage, stepDamage } from '../systems/damage';
import type { StaticGrid } from '../world/collision';
import type { CityLife, Scene } from './cityLife';
import type { Player } from './player';
import { trafficPaint, type Population, type Vehicle } from './population';
import { CarAlarms } from './scenes/alarms';
import { FireCrews } from './scenes/fireCrews';
import { Tows } from './scenes/tows';
import { spawnBeside, type Free, type Spot } from './testSpots';
import { len2 } from '../core/len';

export type SceneId =
  | 'ambulance'
  | 'fire'
  | 'tow'
  | 'alarm'
  | 'chaseCar'
  | 'chaseBike'
  | 'chaseFoot'
  | 'race'
  | 'accident'
  | 'doublePark'
  | 'bus'
  | 'iceCream'
  | 'vendors'
  | 'busker'
  | 'fight'
  | 'mugging'
  | 'turf'
  | 'dogs'
  | 'dogChase'
  | 'rain';

/** The TEST menu's scene buttons, in order. */
export const SCENES: ReadonlyArray<readonly [SceneId, string]> = [
  ['ambulance', 'AMBULANCE CALL'],
  ['fire', 'FIRE + TRUCK'],
  ['tow', 'TOW TRUCK'],
  ['alarm', 'CAR ALARM'],
  ['chaseCar', 'CHASE · CAR'],
  ['chaseBike', 'CHASE · SCOOTER'],
  ['chaseFoot', 'CHASE · ON FOOT'],
  ['race', 'STREET RACE'],
  ['accident', 'ACCIDENT'],
  ['doublePark', 'DOUBLE-PARKED TRUCK'],
  ['bus', 'BUS STOP'],
  ['iceCream', 'ICE CREAM VAN'],
  ['vendors', 'FOOD-CART RUSH'],
  ['busker', 'BUSKER'],
  ['fight', 'FIGHT'],
  ['mugging', 'MUGGING'],
  ['turf', 'TURF WAR'],
  ['dogs', 'STRAY DOG'],
  ['dogChase', 'DOGS CHASE A RUNNER'],
  ['rain', 'RAIN CROWD'],
];

/** People scenes with a force() of their own, by the scene's `kind`. */
const PEOPLE_KIND: Partial<Record<SceneId, string>> = {
  bus: 'buses',
  iceCream: 'iceCream',
  vendors: 'vendors',
  busker: 'buskers',
  fight: 'fights',
  mugging: 'muggings',
};

/** The fire's car goes up this far off: clear of the 9 m blast, and on a phone often still on screen, m. */
const FIRE_RING = [11, 24] as const;
/** The car for the tow truck is left this far off, m. */
const TOW_RING = [8, 18] as const;

export interface SceneStarterDeps {
  cityLife: CityLife;
  population: Population;
  vehicles: Vehicle[];
  player: Player;
  /** Walls, props and ramps: where nothing can be put. */
  grids: readonly StaticGrid[];
  rand: () => number;
  /** A car blows up (main's explode: charred, then the blast). */
  explode(v: Vehicle): void;
}

export class SceneStarter {
  /** Did the last start() get one going? */
  ok = false;
  private ignore: Vehicle | null = null;
  private readonly spot: Spot = { x: 0, z: 0, heading: 0 };

  constructor(private readonly d: SceneStarterDeps) {}

  /**
   * Start `id` round (x, z), facing `heading` (where a car is put down),
   * leaving `ignore` (the player's car) out of the room check. Returns a
   * notice for the TEST sheet; `ok` says whether it started. 'rain' is the
   * TEST menu's own.
   */
  start(id: SceneId, x: number, z: number, heading: number, ignore: Vehicle | null = null): string {
    const life = this.d.cityLife;
    this.ok = false;
    switch (id) {
      case 'ambulance':
        return this.done(life.medics.force(), 'SOMEONE DOWN · AMBULANCE CALLED', 'NOBODY NEAR TO HELP');
      case 'fire':
        return this.fire(x, z, heading, ignore);
      case 'tow':
        return this.tow(x, z, heading, ignore);
      case 'alarm':
        return this.alarm(x, z, heading, ignore);
      case 'chaseCar':
      case 'chaseBike':
      case 'chaseFoot':
        return this.done(life.chases.begin(id === 'chaseCar' ? 'car' : id === 'chaseBike' ? 'bike' : 'foot'), 'POLICE CHASE', 'NO CHASE (ONE ON, OR NO ROOM)');
      case 'race':
        return this.done(life.races.begin(), 'STREET RACE', 'NO RACE (NO ROOM)');
      case 'accident':
        return this.done(life.accidents.begin(), 'ACCIDENT', 'NO ACCIDENT · NO TWO CARS CLOSE: TRY AGAIN');
      case 'doublePark':
        return this.done(life.doubleParking.begin(true), 'DOUBLE-PARKED TRUCK', 'TRUCK ON ITS WAY · STOPS AT THE NEXT SPOT');
      case 'turf':
        life.turfWar.soon();
        return this.done(true, 'TURF WAR STARTING', '');
      case 'dogs':
        return this.done(life.dogs.force(), 'A STRAY DOG', 'NO DOG (TOO MANY, OR NO PAVEMENT)');
      case 'dogChase':
        return this.done(life.dogs.chaseRunner() !== null, 'DOGS AFTER A RUNNER', 'NO RUNNER (NOBODY ON THE PAVEMENT NEAR)');
      case 'rain':
        return 'RAIN';
      default: {
        const label = SCENES.find(([k]) => k === id)![1];
        return this.done(this.people(id)?.force?.() ?? false, label, `NO ${label} NEAR`);
      }
    }
  }

  /** The scene behind a people id (bus, iceCream, vendors, busker, fight, mugging). */
  people(id: SceneId): (Scene & { force?(): boolean }) | null {
    const kind = PEOPLE_KIND[id];
    if (!kind) return null;
    return (this.d.cityLife.scenes.find((x) => (x as { kind?: string }).kind === kind) as (Scene & { force?(): boolean }) | undefined) ?? null;
  }

  /** A clear spot `min`–`max` m beside (x, z) along `heading`, or null; `ignore` doesn't count as in the way. */
  beside(x: number, z: number, heading: number, min: number, max: number, ignore: Vehicle | null): Spot | null {
    this.ignore = ignore;
    const spot = spawnBeside(x, z, heading, this.free, min, max, this.spot);
    this.ignore = null;
    return spot;
  }

  /** Run `fn` with `ignore` left out of the room check (a car being moved). */
  ignoring<T>(ignore: Vehicle | null, fn: () => T): T {
    this.ignore = ignore;
    try {
      return fn();
    } finally {
      this.ignore = null;
    }
  }

  /** A car of `archetype` at `spot`, empty and still (an abandoned car: recycled once far and unseen). */
  place(archetype: VehicleArchetype, spot: Spot): Vehicle {
    const v = this.d.population.takeVehicle(archetype, trafficPaint(archetype, this.d.rand));
    v.police = false;
    v.ai = null;
    Object.assign(v.sim, createVehicleState(spot.x, spot.z, spot.heading));
    Object.assign(v.prev, v.sim);
    return v;
  }

  /** Clear of walls, props, ramps, cars and the player (testSpots' Free). */
  readonly free: Free = (x, z, r) => {
    for (const g of this.d.grids) {
      const near = g.near(x, z, r);
      for (let i = 0; i < near.length; i++) {
        const o = near[i];
        if (x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r) return false;
      }
    }
    for (const v of this.d.vehicles) {
      if (v === this.ignore || !v.mesh.root.visible) continue;
      const reach = v.sim.body?.reach ?? 2.4;
      if (len2(v.sim.x - x, v.sim.z - z) < r + reach) return false;
    }
    const p = this.d.player;
    return p.driving !== null || len2(p.ped.x - x, p.ped.z - z) > r + 0.5;
  };

  private done(ok: boolean, yes: string, no: string): string {
    this.ok = ok;
    return ok ? yes : no;
  }

  /** A car blown up a safe way off; a fire truck comes for it. */
  private fire(x: number, z: number, heading: number, ignore: Vehicle | null): string {
    const spot = this.beside(x, z, heading, FIRE_RING[0], FIRE_RING[1], ignore);
    if (!spot) return 'NO ROOM FOR A FIRE HERE';
    const v = this.place('sedan', spot);
    applyDamage(v.damage, v.damage.maxHealth);
    if (stepDamage(v.damage, 1)) this.d.explode(v);
    const crews = FireCrews.of(this.d.cityLife);
    // The fire's going either way.
    this.ok = true;
    return crews?.force() ? 'CAR FIRE · FIRE TRUCK CALLED' : 'CAR FIRE (NO TRUCK FREE)';
  }

  /** An abandoned car left in the road nearby, and a tow truck for it. */
  private tow(x: number, z: number, heading: number, ignore: Vehicle | null): string {
    const spot = this.beside(x, z, heading, TOW_RING[0], TOW_RING[1], ignore);
    if (!spot) return 'NO ROOM FOR A CAR HERE';
    const v = this.place('compact', spot);
    v.towable = true;
    const tows = this.d.cityLife.scenes.find((s): s is Tows => s instanceof Tows);
    return this.done(tows?.force(v) ?? false, 'TOW TRUCK CALLED', 'NO TOW TRUCK FREE');
  }

  /** The nearest parked car's alarm (one parked beside the point if there's none). */
  private alarm(x: number, z: number, heading: number, ignore: Vehicle | null): string {
    const alarms = CarAlarms.of(this.d.cityLife);
    if (!alarms) return 'NO ALARMS';
    if (alarms.force()) return this.done(true, 'CAR ALARM', '');
    const spot = this.beside(x, z, heading, 6, 16, ignore);
    if (!spot) return 'NO PARKED CAR NEAR';
    const v = this.place('sedan', spot);
    v.parked = true;
    return this.done(alarms.force(v), 'CAR ALARM', 'NO ALARM');
  }
}
