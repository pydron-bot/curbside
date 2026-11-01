/**
 * The city getting on with its day around the player: the director of the
 * ambient scenes (game/scenes/), plus kerbside and car-park parking and
 * guns dropped by the armed when they go down. Scenes register with add();
 * the base has one, the ambulances (scenes/medics.ts), and the two
 * primitives the rest are built from: a service vehicle's call-out
 * (scenes/service.ts ServiceRun: ambulance, fire truck, tow truck,
 * police) and people gathering in a queue or a crowd
 * (scenes/gathering.ts Gathering: the ice cream van, bus stops, stands,
 * buskers, onlookers).
 *
 * Every scene is bounded: a cap on how many run at once, a cooldown
 * between starts, holds (title, activity, wanted, tutorial) and a range
 * from the player (systems/cityScenes.ts SceneClock); vehicles they bring
 * in arrive off-screen on a lane like the police do and are retired once
 * far and out of view. Nothing new is drawn: the cars and people are the
 * usual batches (the ambulance, fire truck, tow truck, ice cream van, bus,
 * police car and bike are all in vehicles.glb). None of it touches the
 * player's heat or score.
 *
 * main.ts calls step(dt) every sim step (after combat), maintain() with
 * population upkeep, reset() for a fresh run, and steers any car with a
 * `scene` through it; peds a scene sets on someone else get their target
 * from targetFor() (and their punches and shots go through punch() and
 * shoot()). What happens goes out on the bus as `street` events; the look
 * (render/cityLifeLook.ts) draws drops, the hospital and anything a scene
 * registers there. No three.js.
 */
import type { EventBus, StreetWhat } from '../core/events';
import {
  createVehicleState,
  driverDoorPosition,
  type VehicleArchetype,
  type VehicleState,
} from '../entities/vehicle';
import type { BodyKind } from './bodies';
import type { Outfit } from '../render/characterModel';
import { SceneClock, type SceneWorld } from '../systems/cityScenes';
import { PUNCH_REACH, hurtPed, resumeWalking, spawnPed, type PedAgent, type Target } from '../systems/crowd';
import { policeSpawnPoint } from '../systems/police';
import { driverFor } from '../systems/traffic';
import type { WeaponKind } from '../systems/weapons';
import type { Rect } from '../world/city';
import { WeaponDrops } from '../world/drops';
import type { SignalView } from '../world/signals';
import { PARKED_COUNT, inRect, trafficPaint, type CrowdPed, type Population, type Vehicle } from './population';
import {
  carParkBays,
  pickBay,
  pickParkingSpot,
  placeBusStops,
  placeHospital,
  type Avoid,
  type Bay,
  type BusStop,
  type Hospital,
  type RoadSpot,
} from '../world/streetSpots';
import type { City } from '../world/city';
import type { Player } from './player';
import { Medics } from './scenes/medics';
import { Chases } from './scenes/chases';
import { StreetRaces } from './scenes/streetRaces';
import { Accidents } from './scenes/accidents';
import { DoubleParking } from './scenes/doubleParking';
import { len2 } from '../core/len';

/** Scenes work within this distance of the player, m; people and cars they hold are let go beyond SCENE_DROP (out of view). */
export const SCENE_RANGE = 150;
export const SCENE_DROP = 190;
/** Parking fills this ring round the player, m (out of view); a fresh fill comes closer. */
const PARK_RING = [35, 150] as const;
const PARK_SEED_RING = [12, 150] as const;
/** Parking spots tried per maintain() call (more on a fresh fill). */
const PARK_TRIES = 3;
const PARK_SEED_TRIES = 80;
/** Share of picks that try a car-park bay (when one is in range) rather than a kerb. */
const LOT_SHARE = 0.45;
/** What's parked: ordinary cars, the odd van or pickup. */
const PARK_MIX: readonly VehicleArchetype[] = ['sedan', 'sedan', 'compact', 'compact', 'taxi', 'pickup', 'van', 'sports', 'muscle', 'sedan'];
/** NPC punches (people a scene set on each other), HP; one in this many knocks them over. */
const NPC_PED_PUNCH = 16;
const NPC_PED_KNOCK = 0.2;

export interface CityLifeDeps {
  bus: EventBus;
  vehicles: Vehicle[];
  population: Population;
  player: Player;
  city: City;
  signals: SignalView;
  rand: () => number;
  /** Sim time, s. */
  now(): number;
  /** The ground the camera sees, written into `out`. */
  view(out: Rect): Rect;
  /** In play (false behind the title: the city still lives, nothing waits on the player). */
  playing(): boolean;
  /** A mission, race, frenzy, fare or Chaos Run is on. */
  activity(): boolean;
  /** The player's wanted stars. */
  stars(): number;
  /** The first run's tutorial pointers are still up. */
  tutorial(): boolean;
  /** Cars other systems need left where they are (an activity's): no scene may take them. */
  keep(v: Vehicle): boolean;
  /** Places parked cars keep clear of (landmarks, bays' mouths, ramps, the spawn corner). */
  avoid: readonly Avoid[];
  /** The quality tier's traffic multiplier. */
  trafficScale(): number;
  /** An NPC fires from (x, z) along unit (dx, dz) (combat's NPC bullet). */
  npcShoot(x: number, z: number, dx: number, dz: number): void;
  /** Hand the player a gun picked up off the street; false if they can't carry more. */
  collect(kind: WeaponKind): boolean;
  /** Who's looking: the focus of the camera (attract cruise or player). */
  focus(): { x: number; z: number; vx: number; vz: number };
  /** The game hour, 0..24 (render/timeOfDay.ts): street races run mostly at night. */
  hour?(): number;
  /** Hand a scene's officer to the police (the player turned on them): normal heat rules from there. */
  enlist?(officer: CrowdPed): void;
}

/** A scene's view of the director. */
export type SceneCtx = CityLife;

/**
 * A kind of ambient scene: stepped every sim step, reset for a fresh run.
 * It defines its kind on the clock (life.clock.define) in its constructor,
 * starts one when life.due(kind, running) says so, and life.clock.start()s
 * it (or defer()s, with nowhere to put one).
 */
export interface Scene {
  step(dt: number): void;
  /** How many are running (the clock's cap). */
  readonly running: number;
  /** Stop everything now (a fresh run, the title): hand back what it holds. */
  reset(): void;
}

export class CityLife {
  readonly d: CityLifeDeps;
  readonly clock: SceneClock;
  readonly hospital: Hospital;
  /** Bus stops (world/streetSpots.ts placeBusStops): parked cars keep clear of them. */
  readonly stops: BusStop[];
  /** The car parks' bays. */
  readonly bays: Bay[];
  readonly drops = new WeaponDrops();
  readonly medics: Medics;
  readonly chases: Chases;
  readonly races: StreetRaces;
  readonly accidents: Accidents;
  readonly doubleParking: DoubleParking;
  readonly scenes: Scene[] = [];
  /** Vehicles the scenes brought in (ambient): retired here once far and unseen. */
  readonly owned: Vehicle[] = [];
  /** People the scenes put on the street or borrowed (scene): handed back or removed here. */
  readonly people: CrowdPed[] = [];
  /** Peds a scene set on someone: their target (another ped), by agent. */
  private readonly targets = new Map<PedAgent, Target>();
  private readonly opponents = new Map<PedAgent, CrowdPed>();
  /** Where people standing about for a scene look (a queue's hatch, down the road for the bus). */
  private readonly looks = new Map<PedAgent, Target>();
  private readonly dropped = new WeakSet<PedAgent>();
  private readonly viewRect: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  private readonly spot: RoadSpot = { ix: 0, iz: 0, dir: 0, along: 0, x: 0, z: 0, heading: 0 };
  private readonly parkAvoid: readonly Avoid[];
  private readonly world: SceneWorld = { playing: false, activity: false, stars: 0, tutorial: false };
  private scanTimer = 0;
  private tidyTimer = 0;

  constructor(d: CityLifeDeps) {
    this.d = d;
    this.clock = new SceneClock(d.rand);
    this.hospital = placeHospital(d.city);
    const avoid = [...d.avoid, { x: this.hospital.bayX, z: this.hospital.bayZ, r: 14 }];
    this.stops = placeBusStops(avoid);
    this.parkAvoid = [...avoid, ...this.stops.map((s) => ({ x: s.x, z: s.z, r: 13 }))];
    this.bays = carParkBays(d.city);
    // The scenes: one line each.
    this.medics = this.add(new Medics(this));
    this.chases = this.add(new Chases(this));
    this.races = this.add(new StreetRaces(this, this.chases));
    this.accidents = this.add(new Accidents(this));
    this.doubleParking = this.add(new DoubleParking(this));
  }

  /** Register a scene (stepped, reset with the rest). */
  add<T extends Scene>(scene: T): T {
    this.scenes.push(scene);
    return scene;
  }

  /** Sim time, s. */
  get now(): number {
    return this.d.now();
  }

  /** The visible ground this step (a shared rect: read it at once). */
  get view(): Rect {
    return this.d.view(this.viewRect);
  }

  /** One sim step: every scene, armed people's dropped guns, the player picking them up. */
  step(dt: number): void {
    const now = this.now;
    for (const s of this.scenes) s.step(dt);
    if ((this.scanTimer -= dt) <= 0) {
      this.scanTimer = 0.25;
      this.scanDrops(now);
    }
    if ((this.tidyTimer -= dt) <= 0) {
      this.tidyTimer = 1;
      this.tidy();
    }
    this.drops.step(now);
    const p = this.d.player;
    if (!p.driving && p.alive && !p.arrested && this.d.playing()) {
      const drop = this.drops.at(p.ped.x, p.ped.z);
      if (drop && this.d.collect(drop.kind)) {
        this.drops.take(drop);
        this.d.bus.emit({ type: 'pickup', kind: drop.kind, x: drop.x, z: drop.z });
      }
    }
  }

  /** With population upkeep (4×/s): keep the kerbs and car parks round the player stocked with parked cars. */
  maintain(seed = false): void {
    const pop = this.d.population;
    const scale = this.d.trafficScale();
    const target = Math.round(PARKED_COUNT * scale);
    let have = pop.parkedCount;
    if (have >= target) return;
    const at = this.d.focus();
    const view = this.view;
    const [lo, hi] = seed ? PARK_SEED_RING : PARK_RING;
    const tries = seed ? PARK_SEED_TRIES : PARK_TRIES;
    const rand = this.d.rand;
    for (let t = 0; t < tries && have < target; t++) {
      let x: number;
      let z: number;
      let heading: number;
      const bay = rand() < LOT_SHARE ? pickBay(this.bays, at.x, at.z, lo, hi, rand, this.parkAvoid) : null;
      if (bay) {
        x = bay.x;
        z = bay.z;
        heading = bay.heading;
      } else {
        const s = pickParkingSpot(at.x, at.z, lo, hi, rand, this.parkAvoid, this.spot);
        if (!s) continue;
        x = s.x;
        z = s.z;
        heading = s.heading;
      }
      if (inRect(x, z, view, 6)) continue;
      const archetype = PARK_MIX[Math.floor(rand() * PARK_MIX.length)];
      const v = pop.parkCar({ archetype, paint: trafficPaint(archetype, rand), x, z, heading }, scale);
      if (v) have++;
    }
  }

  /** A fresh run (or the title): every scene stops, the drops vanish, the clocks start over. */
  reset(): void {
    for (const s of this.scenes) s.reset();
    for (let i = this.people.length - 1; i >= 0; i--) this.removePed(this.people[i]);
    for (let i = this.owned.length - 1; i >= 0; i--) this.retire(this.owned[i]);
    this.targets.clear();
    this.opponents.clear();
    this.looks.clear();
    this.drops.clear();
    this.clock.reset(this.now);
  }

  /** May a `kind` start now, with `running` of them going (its clock, cap and holds)? */
  due(kind: string, running: number): boolean {
    const w = this.world;
    w.playing = this.d.playing();
    w.activity = this.d.activity();
    w.stars = this.d.stars();
    w.tutorial = this.d.tutorial();
    return this.clock.due(kind, this.now, running, w);
  }

  /** Is (x, z) close enough to the player for `kind` to start there? */
  near(kind: string, x: number, z: number): boolean {
    return this.clock.near(kind, this.distance(x, z));
  }

  // --- For the scenes -----------------------------------------------------------

  emit(what: StreetWhat, x: number, z: number): void {
    this.d.bus.emit({ type: 'street', what, x, z });
  }

  /** How far (x, z) is from the player (or the attract camera), m. */
  distance(x: number, z: number): number {
    const at = this.d.focus();
    return len2(x - at.x, z - at.z);
  }

  /** Is (x, z) on screen (with a margin, m)? */
  inView(x: number, z: number, margin = 2): boolean {
    return inRect(x, z, this.view, margin);
  }

  /**
   * A vehicle for a scene, arriving on a lane 75–140 m off (out of view),
   * heading toward the player; `ambient` (the director retires it). Null
   * when there's nowhere to put one.
   */
  spawnCar(archetype: VehicleArchetype, paint: string, aheadShare = 0.65): Vehicle | null {
    const at = this.d.focus();
    const spot = policeSpawnPoint(at.x, at.z, at.vx, at.vz, this.view, this.d.rand, (x, z) => this.crowded(x, z, 12), aheadShare);
    if (!spot) return null;
    const v = this.d.population.takeVehicle(archetype, paint);
    v.police = false;
    v.ambient = true;
    Object.assign(v.sim, createVehicleState(spot.x, spot.z, spot.heading));
    Object.assign(v.prev, v.sim);
    v.ai = spot.driver;
    this.owned.push(v);
    return v;
  }

  /** A vehicle for a scene put down at an exact spot (behind another, say), `ambient`. */
  placeCar(archetype: VehicleArchetype, paint: string, x: number, z: number, heading: number): Vehicle {
    const v = this.d.population.takeVehicle(archetype, paint);
    v.police = false;
    v.ambient = true;
    Object.assign(v.sim, createVehicleState(x, z, heading));
    Object.assign(v.prev, v.sim);
    v.ai = driverFor(v.sim, this.d.rand);
    this.owned.push(v);
    return v;
  }

  /** Anything within `gap` m (each axis) of (x, z)? */
  crowded(x: number, z: number, gap: number): boolean {
    for (const o of this.d.vehicles) if (Math.abs(o.sim.x - x) < gap && Math.abs(o.sim.z - z) < gap) return true;
    return false;
  }

  /**
   * A scene is done with `v`: lights off, back to ordinary traffic (a calm
   * driver from where it stands). Owned ones stay on the list and are
   * retired once far and out of view.
   */
  release(v: Vehicle): void {
    v.scene = null;
    if (v.emergency) v.emergency = false;
    v.mesh.siren = false;
    if (!v.damage.wrecked && v !== this.d.player.driving && v.ai) {
      v.ai = driverFor(v.sim, this.d.rand);
    }
  }

  /** Has a scene lost `v` (taken by the player, its driver out, wrecked, burning, recycled)? */
  lost(v: Vehicle): boolean {
    return v === this.d.player.driving || v.ai === null || v.damage.wrecked || v.damage.burning || !v.mesh.root.visible;
  }

  /** Is `c` still on the street? */
  present(c: CrowdPed): boolean {
    return this.d.population.crowd.includes(c);
  }

  /** Put someone on the street for a scene (`scene`: the director takes them off). */
  addPed(x: number, z: number, heading: number, outfit?: Outfit, body?: BodyKind): CrowdPed {
    const agent = spawnPed(0, 0, 0, 0, this.d.rand);
    Object.assign(agent.s, { x, z, vx: 0, vz: 0, heading });
    agent.temper = 'calm';
    agent.scene = true;
    const c = this.d.population.addPed(agent, outfit, body);
    this.people.push(c);
    return c;
  }

  /** Borrow a passer-by for a scene (the director hands them back). */
  borrow(c: CrowdPed): void {
    c.agent.scene = true;
    if (!this.people.includes(c)) this.people.push(c);
  }

  /** Hand someone back to the crowd (walking on, unless down). */
  giveBack(c: CrowdPed): void {
    const a = c.agent;
    a.scene = false;
    this.unfight(c);
    c.model.arrested = false;
    const i = this.people.indexOf(c);
    if (i >= 0) this.people.splice(i, 1);
    // People the scenes made up for themselves (paramedics, officers) have no life of their own.
    if (!a.street && a.role !== 'civilian') return;
    if (a.mode === 'arrest' || a.mode === 'fight' || a.mode === 'shoot') {
      a.provoked = false;
      resumeWalking(a);
    }
  }

  /** Take someone off the street (into an ambulance, a police car, a bus). */
  removePed(c: CrowdPed): void {
    this.unfight(c);
    c.model.arrested = false;
    c.agent.scene = false;
    c.agent.injured = false;
    const i = this.people.indexOf(c);
    if (i >= 0) this.people.splice(i, 1);
    if (this.present(c)) this.d.population.removePed(c);
  }

  /** Off the list and back in the pool. */
  retire(v: Vehicle): void {
    const i = this.owned.indexOf(v);
    if (i >= 0) this.owned.splice(i, 1);
    if (v === this.d.player.driving || v === this.d.player.lastDriven) {
      v.ambient = false;
      v.scene = null;
      return;
    }
    this.d.population.retireVehicle(v);
  }

  /** Walk `c` (in 'arrest' mode: steered to a point) toward (x, z). */
  walkTo(c: CrowdPed, x: number, z: number): void {
    const a = c.agent;
    if (a.mode === 'down') return;
    if (a.mode !== 'arrest' && a.mode !== 'fight' && a.mode !== 'shoot') a.mode = 'arrest';
    a.goalX = x;
    a.goalZ = z;
  }

  /** The point at a vehicle's back doors (`out`). */
  rearOf(s: VehicleState, out: { x: number; z: number }): { x: number; z: number } {
    const back = (s.body?.reach ?? 2.4) + 0.8;
    out.x = s.x - Math.sin(s.heading) * back;
    out.z = s.z - Math.cos(s.heading) * back;
    return out;
  }

  /** Where a driver steps out (`out`). */
  doorOf(s: VehicleState): { x: number; z: number } {
    return driverDoorPosition(s);
  }

  // --- Fights between people ------------------------------------------------------

  /** Set `a` on `b` (punching, or shooting if `gun`): they fight until one is down or it runs out. */
  setOn(a: CrowdPed, b: CrowdPed, gun = false, seconds = 15): void {
    const t = this.targets.get(a.agent) ?? { x: 0, z: 0, inCar: false, alive: true };
    this.targets.set(a.agent, t);
    this.opponents.set(a.agent, b);
    const ag = a.agent;
    ag.cower = 0;
    ag.mode = gun ? 'shoot' : 'fight';
    ag.timer = seconds;
    ag.attackCooldown = gun ? 0.8 : 0.3;
    if (gun) a.gun ??= 'pistol';
  }

  /** Stop `c` fighting anyone (or looking anywhere in particular). */
  unfight(c: CrowdPed): void {
    this.targets.delete(c.agent);
    this.opponents.delete(c.agent);
    this.looks.delete(c.agent);
  }

  /** Someone standing about for a scene faces (x, z) (not the player) once they've got where they're going. */
  lookAt(c: CrowdPed, x: number, z: number): void {
    let t = this.looks.get(c.agent);
    if (!t) this.looks.set(c.agent, (t = { x: 0, z: 0, inCar: false, alive: true }));
    t.x = x;
    t.z = z;
  }

  /** Who `c` is fighting, if a scene set them on someone. */
  opponentOf(c: CrowdPed): CrowdPed | null {
    return this.opponents.get(c.agent) ?? null;
  }

  /**
   * The target for a ped's step: another ped a scene set them on (written
   * fresh from where that ped is now), or null for the usual (the player).
   */
  targetFor(c: CrowdPed): Target | null {
    if (this.targets.size === 0 && this.looks.size === 0) return null;
    const t = this.targets.get(c.agent);
    if (!t) return c.agent.mode === 'arrest' ? (this.looks.get(c.agent) ?? null) : null;
    const o = this.opponents.get(c.agent)!;
    t.x = o.agent.s.x;
    t.z = o.agent.s.z;
    t.alive = o.agent.mode !== 'down' && this.present(o);
    return t;
  }

  /** A ped a scene set on another threw a punch: it lands on that one, not the player. */
  punch(c: CrowdPed): void {
    const o = this.opponents.get(c.agent);
    if (!o) return;
    const a = c.agent.s;
    const hit = len2(o.agent.s.x - a.x, o.agent.s.z - a.z) < PUNCH_REACH + 0.25;
    this.d.bus.emit({ type: 'punch', x: a.x, z: a.z, hit, byPlayer: false });
    c.model.punch();
    if (!hit) return;
    const res = hurtPed(o.agent, NPC_PED_PUNCH, a.x, a.z, this.d.rand() < NPC_PED_KNOCK ? 4 : 0);
    if (res === 'down' || res === 'ko') {
      const s = o.agent.s;
      this.d.bus.emit({ type: 'pedDown', x: s.x, z: s.z, cause: 'punch', byPlayer: false, cop: o.agent.role === 'cop', ko: res === 'ko', gang: o.agent.gang });
    }
  }

  /** A ped a scene set on another fired: the bullet goes their way (and can hit anyone between). */
  shoot(c: CrowdPed, dx: number, dz: number): void {
    c.model.shoot();
    this.d.npcShoot(c.agent.s.x, c.agent.s.z, dx, dz);
  }

  // --- Internals ----------------------------------------------------------------

  /** Armed people knocked out drop their gun (once each); a civilian who lost theirs fights with fists after. */
  private scanDrops(now: number): void {
    for (const c of this.d.population.crowd) {
      const a = c.agent;
      if (a.mode !== 'down' || !a.ko || this.dropped.has(a)) continue;
      const armed = a.temper === 'armed' || a.role === 'cop' || c.gun !== undefined;
      if (!armed) continue;
      this.dropped.add(a);
      const kind: WeaponKind = c.gun ?? 'pistol';
      // A step beside them (not under the body), toward where they fell from.
      const x = a.s.x + Math.sin(a.s.heading) * 0.7;
      const z = a.s.z + Math.cos(a.s.heading) * 0.7;
      this.drops.drop(kind, x, z, now);
      if (a.role !== 'cop' && a.temper === 'armed') a.temper = 'fighter';
      this.emit('weaponDrop', x, z);
    }
  }

  /** Retire owned cars and drop borrowed people once far off and out of view; forget fighters whose fight is over. */
  private tidy(): void {
    for (let i = this.owned.length - 1; i >= 0; i--) {
      const v = this.owned[i];
      if (v === this.d.player.driving) {
        // Taken by the player: theirs now (it'll be an abandoned car when they leave it).
        v.ambient = false;
        v.scene = null;
        this.owned.splice(i, 1);
        continue;
      }
      if (!v.mesh.root.visible) {
        this.owned.splice(i, 1);
        continue;
      }
      if (v.scene) continue;
      if (this.distance(v.sim.x, v.sim.z) > SCENE_RANGE + 20 && !this.inView(v.sim.x, v.sim.z, 4)) this.retire(v);
    }
    for (let i = this.people.length - 1; i >= 0; i--) {
      const c = this.people[i];
      if (!this.present(c) || !c.agent.scene) {
        this.people.splice(i, 1);
        this.unfight(c);
        continue;
      }
      const s = c.agent.s;
      if (this.distance(s.x, s.z) > SCENE_DROP && !this.inView(s.x, s.z, 4)) this.removePed(c);
    }
    for (const [agent, o] of this.opponents) {
      if (agent.mode !== 'fight' && agent.mode !== 'shoot') {
        this.opponents.delete(agent);
        this.targets.delete(agent);
      } else if (!this.present(o)) agent.timer = 0;
    }
  }
}
