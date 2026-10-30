/**
 * The police response: units (a car and its officers) that spawn just out of
 * view as the wanted level rises, chase with the pursuit controller, box the
 * player in, get out and run them down on foot, set up roadblocks, and a
 * helicopter at 5 stars. Also what the police can see: line of sight from
 * every car, officer and the helicopter, shared over the radio.
 *
 * Cars and officers are ordinary vehicles and crowd peds lent by Population
 * (flagged so its upkeep leaves them alone), so they collide, get shot, run
 * over, blown up and stolen like anything else. A unit whose car is wrecked
 * or stolen carries on with what it has left; units the heat no longer calls
 * for collect their officers and go back to patrolling as traffic.
 *
 * No three.js: presentation (sirens, light bars, radar, helicopter) reads
 * the state each frame.
 */
import type { Outfit } from '../render/characterModel';
import { VEHICLE_HEALTH, speed, type VehicleArchetype, type VehicleControls, type VehicleState } from '../entities/vehicle';
import type { CrowdPed, Vehicle } from '../game/population';
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, type Rect } from '../world/city';
import type { StaticGrid } from '../world/collision';
import { DIR_VEC, MAX_NODE, type Dir } from '../world/roads';
import { carsTouching } from './arrest';
import { HELI_FROM, HELI_GONE, HELI_REFUEL, HELI_SHIFT, HELI_SPAWN, stepHelicopter, type Helicopter } from './helicopter';
import { sees } from './sight';
import { resumeWalking, spawnPed } from './crowd';
import { createPursuit, drivePursuit, isPursuitHopeless, type PursuitDriver, type PursuitTarget } from './pursuit';
import { CRUISE_SPEED, TURN_SPEED, createDriver, rerouteAi, spawnAi, type AiDriver, type Obstacle } from './traffic';

// --- Tunables -------------------------------------------------------------
/** Units chasing at each wanted level (index = stars). */
export const UNITS_BY_STARS = [0, 2, 3, 4, 6, 7] as const;
/** Of those, dark SWAT vans. */
export const SWAT_BY_STARS = [0, 0, 0, 0, 2, 3] as const;
/** Seconds between new units arriving, by stars (the first comes quicker). */
const SPAWN_EVERY = [0, 5, 3, 2, 1.6, 1.2] as const;
const FIRST_SPAWN = 0.6;
/** New units appear this far away, m (off-screen, see VIEW_MARGIN). */
export const SPAWN_RANGE = [75, 140] as const;
/** New units arrive already doing this, m/s. */
const SPAWN_SPEED = 16;
/** Spawns stay this far outside the visible ground, m. */
const VIEW_MARGIN = 8;
/** A unit this far away and out of sight is recycled (it fell behind), m. */
export const DESPAWN_RANGE = 210;
/** Seeing the player: always this close, m... */
export const CAR_PROXIMITY = 20;
/** ...and with a clear line of sight this close. */
export const CAR_SIGHT = 62;
export const OFFICER_PROXIMITY = 15;
export const OFFICER_SIGHT = 40;
/** Line-of-sight checks per unit per second (staggered). */
const SIGHT_HZ = 4;
/** Officers get out when their stopped car is this close to the player, m. */
const DEPLOY_RANGE = 18;
/** Officers run back to their car when the player drives off this far, m... */
const RECALL_RANGE = 14;
/** ...unless they're further than this from it: then they stay on foot. */
const ABANDON_RANGE = 30;
/** Officers on foot this far away (and off-screen) are taken off the street, m. */
const OFFICER_DESPAWN = 90;
/** Officers shoot (from 2 stars) at someone on foot further than this, m (closer: they grab). */
const SHOOT_FROM = 7;
/** From 4 stars, passengers shoot at the player's car from this close, m, this often, s. */
const CAR_SHOT_RANGE = 20;
const CAR_SHOT_EVERY = 2.2;
/** Pursuit speeds by stars: cruise when following roads, top when chasing, m/s. */
const CRUISE_BY_STARS = [0, 20, 22, 25, 26, 27] as const;
const TOP_BY_STARS = [0, 30, 32, 36, 38, 40] as const;
/** Ramming and PITs from this many stars. */
export const RAM_FROM = 3;
/** Roadblocks from this many stars, this often (when driving fast), s. */
export const ROADBLOCK_FROM = 3;
const ROADBLOCK_EVERY = 25;
/** A roadblock this far behind the player (or this old) packs up and gives chase, m / s. */
const ROADBLOCK_PASSED = 45;
const ROADBLOCK_LIFE = 35;
/** SWAT vans are armoured. */
const SWAT_HEALTH = 180;
const POLICE_PAINT = '#f2f2f2';
const SWAT_PAINT = '#1b1f27';
export const COP_OUTFIT: Outfit = { shirt: '#1d2f57', pants: '#141b2e', shoes: '#0b0b0d', hair: '#101828' };
export const SWAT_OUTFIT: Outfit = { shirt: '#22262d', pants: '#1a1d22', shoes: '#0b0b0d', hair: '#15171b' };
const SKIN = ['#e0ac84', '#c68e63', '#8d5a3b', '#f1c9a5', '#5e3b26'];

export type UnitKind = 'patrol' | 'swat';
export type UnitRole = 'pursuit' | 'roadblock';

export interface PoliceUnit {
  id: number;
  /** "cop-<id>", e.g. for a radar blip. */
  label: string;
  kind: UnitKind;
  role: UnitRole;
  /** Null once the car is lost (wrecked, stolen). */
  vehicle: Vehicle | null;
  driver: PursuitDriver;
  /** Officers still in the car. */
  aboard: number;
  /** Officers out on foot. */
  officers: CrowdPed[];
  /** Can see the player (car or officers). */
  seesPlayer: boolean;
  /** A clear straight line from the car to the player: chase directly (else follow the roads). */
  direct: boolean;
  /** Seconds to the next line-of-sight check. */
  sightIn: number;
  /** Seconds to the next shot from the car (4 stars and up). */
  shootIn: number;
  /** The heat no longer calls for it: collect the officers, then go back to patrol. */
  dismissed: boolean;
  /** Seconds this roadblock has stood. */
  age: number;
}

/** Population's lending desk, as the police use it. */
export interface PoliceDepot {
  takeVehicle(archetype: VehicleArchetype, paint: string): Vehicle;
  retireVehicle(v: Vehicle): void;
  addPed(agent: CrowdPed['agent'], outfit?: Outfit): CrowdPed;
  removePed(ped: CrowdPed): void;
}

/** The player as the police see them this step. */
export interface Suspect {
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  inCar: boolean;
  /** On foot with a gun out. */
  armed: boolean;
  /** Their car, if driving. */
  car: VehicleState | null;
  /** In play (alive, free, not behind the title): otherwise nobody chases. */
  active: boolean;
}

export interface PoliceContext {
  stars: number;
  /** Dispatch is tracking the player (a fresh call): units know where to go without seeing them. */
  tracked: boolean;
  suspect: Suspect;
  /** Visible ground rectangle (spawns and despawns stay outside it). */
  view: Rect;
  grid: StaticGrid;
  rand: () => number;
}

/** Fire a shot from (x, z) along unit (dx, dz) (the game traces and resolves it). */
export type ShootHook = (x: number, z: number, dx: number, dz: number) => void;

const PARKED: VehicleControls = { throttle: 0, steer: 0, handbrake: true };

export class PoliceForce {
  readonly units: PoliceUnit[] = [];
  /** Officers whose unit is gone (car lost, or left behind): they carry on alone until out of sight. */
  readonly strays: CrowdPed[] = [];
  readonly heli: Helicopter = {
    active: false,
    leaving: false,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    heading: 0,
    spotX: 0,
    spotZ: 0,
    sweep: 0,
    sees: false,
    shift: 0,
    refuelling: false,
  };
  /** Somebody (any unit, officer or the helicopter) can see the player now. */
  seen = false;
  /** Where the police believe the player is: shared over the radio. */
  readonly target: PursuitTarget = { x: 0, z: 0, vx: 0, vz: 0, heading: 0, inCar: false, seen: false, known: false };
  private readonly byVehicle = new Map<Vehicle, PoliceUnit>();
  private nextId = 1;
  private spawnIn = FIRST_SPAWN;
  private roadblockIn = ROADBLOCK_EVERY / 2;
  private stars = 0;

  constructor(
    private readonly depot: PoliceDepot,
    private readonly shoot: ShootHook,
  ) {}

  /** The unit driving `v`, if it's a police car on duty. */
  unitOf(v: Vehicle): PoliceUnit | undefined {
    return this.byVehicle.get(v);
  }

  /** Units actually chasing (not dismissed). */
  get activeUnits(): number {
    let n = 0;
    for (const u of this.units) if (!u.dismissed && u.role === 'pursuit') n++;
    return n;
  }

  /** Advance one sim step: sight, spawning, roadblocks, officers, the helicopter. */
  step(dt: number, ctx: PoliceContext): void {
    const s = ctx.suspect;
    this.stars = s.active ? ctx.stars : 0;
    this.checkUnits(s, ctx);
    this.updateSight(dt, ctx);
    const known = this.seen || (ctx.tracked && s.active);
    if (known) this.report(s);
    this.target.seen = this.seen;
    this.target.known = known;
    this.staff(dt, ctx);
    if (this.stars >= ROADBLOCK_FROM) this.maybeRoadblock(dt, ctx);
    for (let i = this.units.length - 1; i >= 0; i--) this.stepUnit(this.units[i], dt, ctx);
    for (let i = this.strays.length - 1; i >= 0; i--) this.stepStray(i, ctx);
    this.stepHeli(dt, ctx);
  }

  /** Controls for a police car this step, or null if `v` isn't one on duty. */
  drive(v: Vehicle, obstacles: Obstacle[], rand: () => number, dt: number): VehicleControls | null {
    const u = this.byVehicle.get(v);
    if (!u) return null;
    // Parked: a roadblock, or officers out on foot (nobody at the wheel).
    if (u.role === 'roadblock' || u.officers.length > 0 || u.aboard === 0) return PARKED;
    // The shared picture comes over the radio, but only a clear view lets a car
    // drive straight at them: otherwise it follows the roads there.
    const t = this.target;
    const radio = t.seen;
    t.seen = radio && u.direct;
    const c = drivePursuit(u.driver, v.sim, t, obstacles, rand, dt);
    t.seen = radio;
    return c;
  }

  /** Distance from (x, z) to the nearest officer on their feet, m. */
  nearestOfficer(x: number, z: number): number {
    let best = Infinity;
    for (const u of this.units) best = nearestIn(u.officers, x, z, best);
    return nearestIn(this.strays, x, z, best);
  }

  /** Is an officer on their feet within `range` of (x, z)? */
  officerWithin(x: number, z: number, range: number): boolean {
    return this.nearestOfficer(x, z) < range;
  }

  /** Is any police car on duty touching this car? */
  carTouching(car: VehicleState): boolean {
    for (const u of this.units) if (u.vehicle && carsTouching(u.vehicle.sim, car)) return true;
    return false;
  }

  /** Any police (car, officer, helicopter) within `range` of (x, z)? For witnessing crimes. */
  copWithin(x: number, z: number, range: number): boolean {
    for (const u of this.units) {
      const v = u.vehicle;
      if (v && Math.abs(v.sim.x - x) < range && Math.abs(v.sim.z - z) < range && Math.hypot(v.sim.x - x, v.sim.z - z) < range) return true;
    }
    if (this.heli.active && Math.hypot(this.heli.x - x, this.heli.z - z) < range) return true;
    return this.officerWithin(x, z, range);
  }

  /**
   * A crime was reported at the suspect's position (witnessed, or a new
   * star): units that can't see them head there.
   */
  report(s: Suspect): void {
    const t = this.target;
    t.x = s.x;
    t.z = s.z;
    t.vx = s.vx;
    t.vz = s.vz;
    t.heading = s.heading;
    t.inCar = s.inCar;
  }

  /** Everyone stands down at once (busted, died, a fresh run): units go back to patrol. */
  standDown(): void {
    for (const u of this.units) u.dismissed = true;
    this.heli.leaving = this.heli.active;
    this.seen = false;
    this.target.seen = this.target.known = false;
  }

  /** Clear the street of police now (back to the title, a fresh run far away). */
  reset(): void {
    for (let i = this.units.length - 1; i >= 0; i--) this.removeUnit(this.units[i], true);
    for (const p of this.strays) this.depot.removePed(p);
    this.strays.length = 0;
    this.heli.active = this.heli.leaving = this.heli.sees = this.heli.refuelling = false;
    this.heli.shift = 0;
    this.seen = false;
    this.target.seen = this.target.known = false;
    this.spawnIn = FIRST_SPAWN;
    this.roadblockIn = ROADBLOCK_EVERY / 2;
  }

  // --- Units ----------------------------------------------------------------

  /** Cars lost (wrecked or stolen) and units the heat no longer calls for. */
  private checkUnits(s: Suspect, ctx: PoliceContext): void {
    for (const u of this.units) {
      const v = u.vehicle;
      if (!v) continue;
      if (v.damage.wrecked) {
        // Whoever was inside didn't make it out.
        u.aboard = 0;
        this.loseCar(u);
      } else if (v.damage.burning) {
        // On fire: everyone out, and the car is left to burn.
        this.deploy(u, ctx.rand, u.aboard);
        this.loseCar(u);
      } else if (s.car === v.sim) {
        // The player took it: the crew bails out first.
        this.deploy(u, ctx.rand, u.aboard);
        this.loseCar(u);
      }
    }
    // Too many units for the level: the furthest (preferably unseen) stand down.
    let excess = this.activeUnits - UNITS_BY_STARS[this.stars];
    while (excess > 0) {
      let pick: PoliceUnit | null = null;
      let pickScore = -Infinity;
      for (const u of this.units) {
        if (u.dismissed || u.role !== 'pursuit') continue;
        const at = u.vehicle?.sim ?? u.officers[0]?.agent.s;
        const d = at ? Math.hypot(at.x - s.x, at.z - s.z) : Infinity;
        const score = d + (u.seesPlayer ? 0 : 1000);
        if (score > pickScore) {
          pickScore = score;
          pick = u;
        }
      }
      if (!pick) break;
      pick.dismissed = true;
      excess--;
    }
    if (this.stars === 0) for (const u of this.units) u.dismissed = true;
  }

  private loseCar(u: PoliceUnit): void {
    const v = u.vehicle;
    if (!v) return;
    this.byVehicle.delete(v);
    v.police = false;
    v.pursuit = null;
    v.mesh.siren = false;
    u.vehicle = null;
  }

  /** Top the force up to the level's strength, one unit at a time. */
  private staff(dt: number, ctx: PoliceContext): void {
    const want = UNITS_BY_STARS[this.stars];
    if (this.activeUnits >= want) {
      this.spawnIn = Math.min(this.spawnIn, FIRST_SPAWN);
      return;
    }
    if ((this.spawnIn -= dt) > 0) return;
    this.spawnIn = SPAWN_EVERY[this.stars];
    let swat = 0;
    for (const u of this.units) if (!u.dismissed && u.kind === 'swat') swat++;
    const kind: UnitKind = swat < SWAT_BY_STARS[this.stars] ? 'swat' : 'patrol';
    this.spawnUnit(kind, ctx);
  }

  private spawnUnit(kind: UnitKind, ctx: PoliceContext): PoliceUnit | null {
    const s = ctx.suspect;
    // Mid-chase, reinforcements come from all round (not always waiting ahead,
    // or outrunning them would be hopeless); on a fresh call, mostly ahead.
    const ahead = this.seen ? 0.3 : 0.65;
    const spot = policeSpawnPoint(s.x, s.z, s.vx, s.vz, ctx.view, ctx.rand, (x, z) => this.crowded(x, z), ahead);
    if (!spot) return null;
    const v = this.borrowCar(kind, spot.x, spot.z, spot.heading, SPAWN_SPEED);
    return this.addUnit(v, kind, 'pursuit', spot.driver);
  }

  /** A car for a unit at (x, z), already rolling at `rolling` m/s (they arrive on the scene at speed). */
  private borrowCar(kind: UnitKind, x: number, z: number, heading: number, rolling = 0): Vehicle {
    const v = this.depot.takeVehicle(kind === 'swat' ? 'van' : 'police', kind === 'swat' ? SWAT_PAINT : POLICE_PAINT);
    const sim = v.sim;
    sim.x = x;
    sim.z = z;
    sim.heading = heading;
    sim.vx = Math.sin(heading) * rolling;
    sim.vz = Math.cos(heading) * rolling;
    sim.yawRate = 0;
    Object.assign(v.prev, sim);
    if (kind === 'swat') v.damage.health = v.damage.maxHealth = SWAT_HEALTH;
    else v.damage.health = v.damage.maxHealth = VEHICLE_HEALTH.police;
    v.mesh.siren = true;
    return v;
  }

  private addUnit(v: Vehicle, kind: UnitKind, role: UnitRole, road: AiDriver): PoliceUnit {
    const stars = Math.max(1, this.stars);
    const driver = createPursuit(road, stars >= RAM_FROM ? 1 : 0, CRUISE_BY_STARS[stars], TOP_BY_STARS[stars]);
    driver.slot = this.units.length;
    const id = this.nextId++;
    const u: PoliceUnit = {
      id,
      label: `cop-${id}`,
      kind,
      role,
      vehicle: v,
      driver,
      aboard: 2,
      officers: [],
      seesPlayer: false,
      direct: false,
      sightIn: this.units.length / (SIGHT_HZ * 8),
      shootIn: CAR_SHOT_EVERY,
      dismissed: false,
      age: 0,
    };
    v.pursuit = driver;
    v.ai = null;
    this.units.push(u);
    this.byVehicle.set(v, u);
    return u;
  }

  /** Take a unit off the board: its car retires (if `retireCar`) and its officers leave the street. */
  private removeUnit(u: PoliceUnit, retireCar: boolean): void {
    const i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    for (const p of u.officers) this.depot.removePed(p);
    u.officers.length = 0;
    const v = u.vehicle;
    if (!v) return;
    this.byVehicle.delete(v);
    if (retireCar) this.depot.retireVehicle(v);
    u.vehicle = null;
  }

  private stepUnit(u: PoliceUnit, dt: number, ctx: PoliceContext): void {
    const s = ctx.suspect;
    const v = u.vehicle;
    // Keep the chase tuned to the level.
    const stars = Math.max(1, this.stars);
    u.driver.aggression = stars >= RAM_FROM ? 1 : 0;
    u.driver.cruise = CRUISE_BY_STARS[stars];
    u.driver.topSpeed = TOP_BY_STARS[stars] * (u.kind === 'swat' ? 0.85 : 1);

    for (let i = u.officers.length - 1; i >= 0; i--) this.stepOfficer(u, i, ctx);

    if (!v) {
      // No car left: once its officers are gone (or stray), the unit is done.
      for (const p of u.officers) this.strays.push(p);
      u.officers.length = 0;
      this.removeUnit(u, false);
      return;
    }
    if (u.aboard === 0 && u.officers.length === 0) {
      // Nobody left to drive it: an abandoned police car (free to steal).
      this.loseCar(u);
      this.removeUnit(u, false);
      return;
    }
    const d = Math.hypot(v.sim.x - s.x, v.sim.z - s.z);
    const onScreen = inView(v.sim.x, v.sim.z, ctx.view, 4);

    if (u.dismissed) {
      if (u.officers.length > 0) return; // waiting for the crew
      if (!onScreen && d > 60) this.removeUnit(u, true);
      else this.backToPatrol(u, ctx.rand);
      return;
    }
    if (u.role === 'roadblock') {
      u.age += dt;
      const fx = Math.sin(s.heading);
      const fz = Math.cos(s.heading);
      const behind = (s.x - v.sim.x) * fx + (s.z - v.sim.z) * fz;
      if ((s.inCar && behind > ROADBLOCK_PASSED) || u.age > ROADBLOCK_LIFE) {
        // Passed or stale: back in and give chase.
        u.role = 'pursuit';
        u.driver.mode = 'chase';
        this.recall(u);
      }
      return;
    }
    // Fell far behind out of sight, or wedged for good: recycle it (a fresh one spawns closer).
    if (!onScreen && !u.seesPlayer && (d > DESPAWN_RANGE || isPursuitHopeless(u.driver))) {
      this.removeUnit(u, true);
      return;
    }
    // Stopped near the player: the crew gets out.
    if (u.aboard > 0 && s.active && d < DEPLOY_RANGE && speed(v.sim) < 2.5 && (!s.inCar || Math.hypot(s.vx, s.vz) < 3)) {
      this.deploy(u, ctx.rand, this.stars >= 2 || u.kind === 'swat' ? u.aboard : 1);
    }
    // From 4 stars, passengers shoot at the player's car.
    if (this.stars >= 4 && s.inCar && u.aboard > 0 && u.seesPlayer && d < CAR_SHOT_RANGE) {
      if ((u.shootIn -= dt) <= 0) {
        u.shootIn = CAR_SHOT_EVERY * (0.8 + ctx.rand() * 0.4);
        const dx = (s.x - v.sim.x) / (d || 1);
        const dz = (s.z - v.sim.z) / (d || 1);
        this.shoot(v.sim.x + dx * 1.6, v.sim.z + dz * 1.6, dx, dz);
      }
    }
  }

  /** Dismissed with the crew aboard: an ordinary patrol car in traffic from now on. */
  private backToPatrol(u: PoliceUnit, rand: () => number): void {
    const v = u.vehicle!;
    const road = u.driver.road;
    road.cruise = CRUISE_SPEED;
    road.turnSpeed = TURN_SPEED;
    road.urgent = false;
    road.overtaking = 0;
    road.mood = 'calm';
    rerouteAi(road, v.sim, rand);
    this.loseCar(u);
    v.ai = road;
    this.removeUnit(u, false);
  }

  /** `count` officers climb out by the doors. */
  private deploy(u: PoliceUnit, rand: () => number, count: number): void {
    const v = u.vehicle;
    if (!v) return;
    const n = Math.min(count, u.aboard);
    for (let i = 0; i < n; i++) {
      const side = i === 0 ? 1 : -1;
      const lx = Math.cos(v.sim.heading) * side;
      const lz = -Math.sin(v.sim.heading) * side;
      const agent = spawnPed(0, 0, 0, 0, rand);
      agent.role = 'cop';
      agent.temper = 'armed';
      agent.mode = 'arrest';
      agent.s.x = v.sim.x + lx * 1.7;
      agent.s.z = v.sim.z + lz * 1.7;
      agent.s.heading = v.sim.heading;
      agent.goalX = agent.s.x;
      agent.goalZ = agent.s.z;
      const base = u.kind === 'swat' ? SWAT_OUTFIT : COP_OUTFIT;
      const outfit: Outfit = { ...base, skin: SKIN[Math.floor(rand() * SKIN.length)] };
      u.officers.push(this.depot.addPed(agent, outfit));
      u.aboard--;
    }
  }

  /** Everyone back to the car. */
  private recall(u: PoliceUnit): void {
    for (const p of u.officers) {
      if (p.agent.mode !== 'down') p.agent.mode = 'arrest';
    }
  }

  /**
   * One officer's orders: grab or shoot a player on foot, go for the door of
   * a stopped car, shoot at a fast one (4 stars), else head back to their car
   * and get in. Too far from their car to bother: they stay on foot.
   */
  private stepOfficer(u: PoliceUnit, i: number, ctx: PoliceContext): void {
    const p = u.officers[i];
    const a = p.agent;
    const s = ctx.suspect;
    const v = u.vehicle;
    const d = Math.hypot(s.x - a.s.x, s.z - a.s.z);
    const carD = v ? Math.hypot(v.sim.x - a.s.x, v.sim.z - a.s.z) : Infinity;
    if (a.mode === 'down' || (a.mode === 'flee' && a.timer > 0)) return;
    a.timer = 5; // keeps 'shoot' from timing out on its own

    const playerFast = s.inCar && Math.hypot(s.vx, s.vz) > 4;
    const goHome = u.dismissed || u.role === 'roadblock' ? false : playerFast && d > RECALL_RANGE;
    if (u.dismissed || goHome || this.stars === 0 || !s.active) {
      if (!v || carD > ABANDON_RANGE) {
        // Left behind: carries on alone.
        u.officers.splice(i, 1);
        this.strays.push(p);
        return;
      }
      if (carD < 2.2) {
        // Back in the car.
        this.depot.removePed(p);
        u.officers.splice(i, 1);
        u.aboard++;
        return;
      }
      a.mode = 'arrest';
      a.goalX = v.sim.x + Math.cos(v.sim.heading) * 1.6;
      a.goalZ = v.sim.z - Math.sin(v.sim.heading) * 1.6;
      return;
    }
    if (u.role === 'roadblock' && s.inCar && Math.hypot(s.vx, s.vz) > 4) {
      // Holding the line behind the cars: guns up as the car comes.
      a.mode = this.stars >= ROADBLOCK_FROM && d < CAR_SHOT_RANGE ? 'shoot' : 'arrest';
      a.goalX = a.s.x;
      a.goalZ = a.s.z;
      return;
    }
    this.orders(p, d, s);
  }

  /** What an officer on the job does about the suspect. */
  private orders(p: CrowdPed, d: number, s: Suspect): void {
    const a = p.agent;
    if (s.inCar) {
      const fast = Math.hypot(s.vx, s.vz) > 4;
      if (fast) {
        a.mode = this.stars >= 4 && d < CAR_SHOT_RANGE ? 'shoot' : 'arrest';
        a.goalX = s.x;
        a.goalZ = s.z;
        return;
      }
      // Stopped: to the driver's door.
      a.mode = 'arrest';
      a.goalX = s.x + Math.cos(s.heading) * 1.6;
      a.goalZ = s.z - Math.sin(s.heading) * 1.6;
      return;
    }
    // On foot: from 3 stars they shoot on sight; at 2 only at someone armed or running.
    // Someone who stops and gives up just gets cuffed.
    const running = Math.hypot(s.vx, s.vz) > 3.5;
    const shoot = d > SHOOT_FROM && (this.stars >= 3 || (this.stars >= 2 && (s.armed || running)));
    a.mode = shoot ? 'shoot' : 'arrest';
    a.goalX = s.x;
    a.goalZ = s.z;
  }

  /** An officer with no unit: on the job while there's heat and they're close, else off home. */
  private stepStray(i: number, ctx: PoliceContext): void {
    const p = this.strays[i];
    const a = p.agent;
    const s = ctx.suspect;
    const d = Math.hypot(s.x - a.s.x, s.z - a.s.z);
    if (d > OFFICER_DESPAWN && !inView(a.s.x, a.s.z, ctx.view, 2)) {
      this.depot.removePed(p);
      this.strays.splice(i, 1);
      return;
    }
    if (a.mode === 'down' || (a.mode === 'flee' && a.timer > 0)) return;
    if (this.stars > 0 && s.active && d < 60) {
      a.timer = 5;
      this.orders(p, d, s);
    } else if (a.mode !== 'walk') {
      // Off duty: back to walking the pavement (and out of sight).
      resumeWalking(a);
    }
  }

  // --- Sight ----------------------------------------------------------------

  /** Who can see the player: each unit checks SIGHT_HZ times a second, staggered. */
  private updateSight(dt: number, ctx: PoliceContext): void {
    const s = ctx.suspect;
    let seen = false;
    if (s.active) {
      for (const u of this.units) {
        if ((u.sightIn -= dt) <= 0) {
          u.sightIn += 1 / SIGHT_HZ;
          u.seesPlayer = !u.dismissed && this.unitSees(u, s, ctx.grid);
          const v = u.vehicle;
          u.direct = u.seesPlayer && v !== null && sees(ctx.grid, v.sim.x, v.sim.z, s.x, s.z, 6, CAR_SIGHT);
        }
        if (u.seesPlayer) seen = true;
      }
      for (const p of this.strays) {
        const d = Math.hypot(p.agent.s.x - s.x, p.agent.s.z - s.z);
        if (p.agent.mode !== 'down' && d < OFFICER_PROXIMITY) seen = true;
      }
      if (this.heli.active && !this.heli.leaving && this.heli.sees) seen = true;
    } else {
      for (const u of this.units) u.seesPlayer = u.direct = false;
    }
    this.seen = seen;
  }

  private unitSees(u: PoliceUnit, s: Suspect, grid: StaticGrid): boolean {
    const v = u.vehicle;
    if (v && sees(grid, v.sim.x, v.sim.z, s.x, s.z, CAR_PROXIMITY, CAR_SIGHT)) return true;
    for (const p of u.officers) {
      if (p.agent.mode === 'down') continue;
      if (sees(grid, p.agent.s.x, p.agent.s.z, s.x, s.z, OFFICER_PROXIMITY, OFFICER_SIGHT)) return true;
    }
    return false;
  }

  // --- Roadblocks -------------------------------------------------------------

  private maybeRoadblock(dt: number, ctx: PoliceContext): void {
    if ((this.roadblockIn -= dt) > 0) return;
    const s = ctx.suspect;
    if (!s.inCar || !this.seen) return;
    const spot = roadblockSpot(s.x, s.z, s.vx, s.vz, ctx.view);
    // Not now (slow, diagonal, near the edge): try again shortly.
    if (!spot) {
      this.roadblockIn = 2;
      return;
    }
    this.roadblockIn = ROADBLOCK_EVERY;
    const cars = this.stars >= 4 ? 3 : 2;
    for (let i = 0; i < cars; i++) {
      const c = spot.cars[i];
      if (this.crowded(c.x, c.z)) continue;
      const v = this.borrowCar('patrol', c.x, c.z, c.heading);
      const road = createDriver(0, 0, 0, ctx.rand);
      rerouteAi(road, v.sim, ctx.rand);
      const u = this.addUnit(v, 'patrol', 'roadblock', road);
      // The crew stands behind the cars, guns out.
      this.deploy(u, ctx.rand, 1);
      const o = u.officers[0];
      if (o) {
        // Beyond the cars, from where the player's coming.
        o.agent.s.x = c.x + spot.dirX * 3;
        o.agent.s.z = c.z + spot.dirZ * 3;
        o.agent.goalX = o.agent.s.x;
        o.agent.goalZ = o.agent.s.z;
        Object.assign(o.prev, o.agent.s);
      }
    }
  }

  private crowded(x: number, z: number): boolean {
    for (const u of this.units) {
      const v = u.vehicle;
      if (v && Math.abs(v.sim.x - x) < 7 && Math.abs(v.sim.z - z) < 7) return true;
    }
    return false;
  }

  // --- Helicopter -------------------------------------------------------------

  private stepHeli(dt: number, ctx: PoliceContext): void {
    const h = this.heli;
    const s = ctx.suspect;
    // Shifts: on station HELI_SHIFT, then away refuelling HELI_REFUEL.
    h.shift += dt;
    if (!h.refuelling && h.active && !h.leaving && h.shift > HELI_SHIFT) {
      h.refuelling = true;
      h.shift = 0;
    } else if (h.refuelling && h.shift > HELI_REFUEL) {
      h.refuelling = false;
      h.shift = 0;
    }
    const wanted = this.stars >= HELI_FROM && s.active && !h.refuelling;
    if (wanted && (!h.active || h.leaving)) {
      if (!h.active) {
        // In from off-screen, ahead of the player and to one side, so it meets them.
        const a = Math.atan2(s.vz, s.vx) + (ctx.rand() < 0.5 ? 1 : -1) * (0.6 + ctx.rand() * 0.6);
        h.x = s.x + Math.cos(a) * HELI_SPAWN;
        h.z = s.z + Math.sin(a) * HELI_SPAWN;
        h.vx = h.vz = 0;
        h.spotX = h.x;
        h.spotZ = h.z;
        h.shift = 0;
      }
      h.active = true;
      h.leaving = false;
    } else if (!wanted && h.active) h.leaving = true;
    if (!h.active) {
      h.sees = false;
      return;
    }
    stepHelicopter(h, this.target.x, this.target.z, this.target.vx, this.target.vz, s.x, s.z, dt);
    if (h.leaving) {
      h.sees = false;
      if (Math.hypot(h.x - s.x, h.z - s.z) > HELI_GONE) h.active = h.leaving = false;
    }
  }
}

/** Placement for a new unit: on a lane, out of view, heading the player's way. */
export function policeSpawnPoint(
  px: number,
  pz: number,
  vx: number,
  vz: number,
  view: Rect,
  rand: () => number,
  crowded: (x: number, z: number) => boolean,
  aheadShare = 0.65,
): { x: number; z: number; heading: number; driver: AiDriver } | null {
  const [lo, hi] = SPAWN_RANGE;
  const sp = Math.hypot(vx, vz);
  const heading = Math.atan2(vz, vx);
  for (let attempt = 0; attempt < 30; attempt++) {
    // Mostly ahead of a moving player, so they come at you rather than trail behind.
    const a = sp > 4 && rand() < aheadShare ? heading + (rand() * 2 - 1) * (Math.PI / 3) : rand() * Math.PI * 2;
    const r = lo + rand() * (hi - lo);
    const sx = px + Math.cos(a) * r;
    const sz = pz + Math.sin(a) * r;
    // Drive toward the player along whichever axis has further to go.
    const dx = px - sx;
    const dz = pz - sz;
    const dir: Dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 2 : 0;
    const v = DIR_VEC[dir];
    const ix = Math.round(sx / BLOCK_SIZE) + v.x;
    const iz = Math.round(sz / BLOCK_SIZE) + v.z;
    if (Math.abs(ix) > MAX_NODE || Math.abs(iz) > MAX_NODE) continue;
    const spawned = spawnAi(ix, iz, dir, 0.2 + rand() * 0.6, rand);
    if (!spawned) continue;
    const d = Math.hypot(spawned.x - px, spawned.z - pz);
    if (d < lo * 0.85 || d > hi * 1.15) continue;
    if (inView(spawned.x, spawned.z, view, VIEW_MARGIN)) continue;
    if (crowded(spawned.x, spawned.z)) continue;
    return spawned;
  }
  return null;
}

export interface RoadblockSpot {
  /** Unit vector along the road the way the player is driving (they arrive from the -dir side). */
  dirX: number;
  dirZ: number;
  cars: Array<{ x: number; z: number; heading: number }>;
}

/**
 * Where to block the road the player is speeding along: mid-block, 120-170 m
 * ahead (out of view), cars across the lanes in a staggered line. Null when
 * they're slow, not clearly on a road along an axis, or near the city edge.
 */
export function roadblockSpot(px: number, pz: number, vx: number, vz: number, view: Rect): RoadblockSpot | null {
  const sp = Math.hypot(vx, vz);
  if (sp < 10) return null;
  const alongX = Math.abs(vx) > 2 * Math.abs(vz);
  const alongZ = Math.abs(vz) > 2 * Math.abs(vx);
  if (!alongX && !alongZ) return null;
  // The road line they're on.
  const line = Math.round((alongX ? pz : px) / BLOCK_SIZE) * BLOCK_SIZE;
  if (Math.abs((alongX ? pz : px) - line) > ROAD_WIDTH / 2 + 1) return null;
  const sign = Math.sign(alongX ? vx : vz);
  const pos = alongX ? px : pz;
  for (const ahead of [140, 170, 120]) {
    const mid = (Math.floor((pos + sign * ahead) / BLOCK_SIZE) + 0.5) * BLOCK_SIZE;
    if (Math.abs(mid) > HALF_EXTENT - BLOCK_SIZE / 2) continue;
    if ((mid - pos) * sign < 90) continue;
    const x = alongX ? mid : line;
    const z = alongX ? line : mid;
    if (inView(x, z, view, 12)) continue;
    const dirX = alongX ? sign : 0;
    const dirZ = alongX ? 0 : sign;
    // Across the road (heading along the perpendicular), staggered a little.
    const across = alongX ? 0 : Math.PI / 2;
    const cars = [-2.6, 2.6, 6.4].map((off, i) => ({
      x: x + (alongX ? i * 2.5 * sign : off),
      z: z + (alongX ? off : i * 2.5 * sign),
      heading: across + (i % 2 ? 0.25 : -0.25),
    }));
    return { dirX, dirZ, cars };
  }
  return null;
}

/** Nearest officer on their feet in `list` to (x, z), if nearer than `best`. */
function nearestIn(list: readonly CrowdPed[], x: number, z: number, best: number): number {
  for (const p of list) {
    if (p.agent.mode === 'down') continue;
    const d = Math.hypot(p.agent.s.x - x, p.agent.s.z - z);
    if (d < best) best = d;
  }
  return best;
}

function inView(x: number, z: number, r: Rect, margin: number): boolean {
  return x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin;
}
