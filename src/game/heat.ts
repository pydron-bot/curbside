/**
 * Heat: the wanted level and everything that follows from it, wired to the
 * rest of the game. Crimes come in as bus events (or a direct call for a
 * crash); a crime counts if it's on screen or near a cop. Each sim step it
 * runs the police (sight, units, officers, helicopter), the evasion clock,
 * arrests, Pay 'n' Spray bays and how traffic reacts to the player and to
 * sirens. main.ts calls step() once per sim step, drive() for every AI car,
 * playerCrash() on a hard crash, and reset() for a fresh run.
 *
 * No three.js: presentation (sirens, radar, HUD, the helicopter) reads this
 * state in heatPresenter.ts.
 */
import type { EventBus } from '../core/events';
import { VEHICLE_HEALTH, speed, type VehicleControls } from '../entities/vehicle';
import { DOOR_RANGE, BustMeter, type ArrestSituation } from '../systems/arrest';
import { scare } from '../systems/crowd';
import { createDamage } from '../systems/damage';
import { PoliceForce, type PoliceContext, type Suspect } from '../systems/police';
import { createPursuit, drivePursuit, type PursuitTarget } from '../systems/pursuit';
import { evadeBonus, type Award, type Score } from '../systems/score';
import { driveAi, reactToHit, rerouteAi, scareDriver, shouldYield, YIELD_RANGE, type Obstacle } from '../systems/traffic';
import { Wanted, WITNESS_RANGE, type Crime } from '../systems/wanted';
import type { City, Rect } from '../world/city';
import type { StaticGrid } from '../world/collision';
import { inShop, placeSprayShops, placeStation, type SprayShop, type Station } from '../world/landmarks';
import type { Player } from './player';
import type { Population, Vehicle } from './population';

/** Share of the run score a bust costs. */
export const BUST_FINE = 0.25;
/** Seconds stopped in a spray bay before the car comes out new. */
export const SPRAY_SECONDS = 2;
/**
 * What a respray costs. Free until cash arrives: then charge it through
 * HeatDeps.pay (which can refuse) and show the price on the bay.
 */
export const SPRAY_COST = 0;
/** Slower than this in the bay counts as stopped, m/s. */
const SPRAY_SPEED = 4;
const RESPRAY_PAINTS = ['#c8342b', '#2f6fc0', '#e8b923', '#3d7a4a', '#7a2f5a', '#c86a2b', '#e5e5e5', '#1f2328', '#2fb5a8', '#d94f8a'];
/** Road ragers: how hard and fast they come at you. */
const RAGE_CRUISE = 24;
const RAGE_TOP = 30;
/** Traffic within this distance of gunfire panics, m; people on foot run. */
const GUNFIRE_SCARE = 30;
/** How often drivers check for sirens behind them, s. */
const YIELD_EVERY = 0.2;
/** After losing sight, the radio keeps units on the player's real position this long, s. */
const TRACK_AFTER_SIGHTING = 2;
/** A second ram on the same police car within this long doesn't count again, s. */
const RAM_REPEAT = 1.5;

export interface HeatDeps {
  bus: EventBus;
  city: City;
  grid: StaticGrid;
  vehicles: Vehicle[];
  population: Population;
  player: Player;
  score: Score;
  rand: () => number;
  /** The ground rectangle the camera sees now (crimes there are witnessed). */
  view(): Rect;
  /** False behind the title (attract mode): nobody's wanted. */
  playing(): boolean;
  award(a: Award | null): void;
  /** Throw an NPC driver out of their car, running from (fromX, fromZ). */
  ejectDriver(v: Vehicle, fromX: number, fromZ: number): void;
  /** An NPC (police) shot from (x, z) along unit (dx, dz). */
  npcShoot(x: number, z: number, dx: number, dz: number): void;
  /** The car's paint changed: show it. */
  repaint(v: Vehicle): void;
  /** Take payment (see SPRAY_COST); false refuses. Defaults to free. */
  pay?(cost: number): boolean;
}

export class Heat {
  readonly wanted: Wanted;
  readonly police: PoliceForce;
  readonly bust = new BustMeter();
  readonly shops: SprayShop[];
  readonly station: Station;
  /** The bay the player's car is in (null when not in one). */
  shop: SprayShop | null = null;
  /** 0..1 while a respray runs. */
  sprayProgress = 0;
  /** The police saw the car drive into the bay: a respray won't lose them. */
  sprayWatched = false;
  private readonly suspect: Suspect = { x: 0, z: 0, vx: 0, vz: 0, heading: 0, inCar: false, armed: false, down: false, car: null, active: false };
  private readonly ctx: PoliceContext;
  private readonly situation: ArrestSituation = {
    stars: 0,
    onFoot: true,
    speed: 0,
    stunned: false,
    copDistance: Infinity,
    copCarTouching: false,
    copAtDoor: false,
  };
  /** Road ragers chase the real player, not the police's radio picture. */
  private readonly rageTarget: PursuitTarget = { x: 0, z: 0, vx: 0, vz: 0, heading: 0, inCar: false, seen: true, known: true };
  private readonly rammed = new Map<Vehicle, number>();
  private yieldIn = 0;
  private time = 0;

  constructor(private readonly deps: HeatDeps) {
    const bus = deps.bus;
    this.wanted = new Wanted(bus);
    this.police = new PoliceForce(
      {
        takeVehicle: (a, p) => deps.population.takeVehicle(a, p),
        retireVehicle: (v) => deps.population.retireVehicle(v),
        addPed: (agent, outfit) => deps.population.addPed(agent, outfit),
        removePed: (ped) => deps.population.removePed(ped),
      },
      deps.npcShoot,
    );
    this.shops = placeSprayShops(deps.city);
    this.station = placeStation(deps.city);
    this.ctx = { stars: 0, tracked: false, suspect: this.suspect, view: deps.view(), grid: deps.grid, rand: deps.rand };

    // --- Crimes, as the simulation reports them ---
    bus.on('pedDown', (e) => {
      if (e.byPlayer && !e.isPlayer) this.crime(e.cop ? 'copDown' : 'assault', e.x, e.z);
    });
    bus.on('carjack', (e) => this.crime('carjack', e.x, e.z));
    bus.on('shot', (e) => {
      if (e.byPlayer) this.crime('gunfire', e.x, e.z);
      this.gunfire(e.x, e.z, e.byPlayer);
    });
    bus.on('bulletHit', (e) => {
      if (e.byPlayer && e.police) this.crime('shootCop', e.x, e.z);
    });
    bus.on('explosion', (e) => {
      // Your own car going up isn't a crime (what it takes with it is).
      if (!e.byPlayer || e.ownCar || !this.live) return;
      this.crime('explosion', e.x, e.z);
      if (e.police) {
        this.crime('copCarWrecked', e.x, e.z);
        deps.award(deps.score.award('copWreck'));
      }
    });
    bus.on('enterVehicle', (e) => {
      if (e.police) this.crime('copCarStolen', deps.player.ped.x, deps.player.ped.z);
    });
    // A chase that ends in death is over too.
    bus.on('playerDied', () => {
      this.wanted.clear('died');
      this.police.standDown();
      this.bust.reset();
    });
    bus.on('wanted', (e) => {
      if (e.reason === 'evaded') deps.award(this.evadedAward());
    });
  }

  /** In play: not behind the title, alive and free. */
  private get live(): boolean {
    const p = this.deps.player;
    return this.deps.playing() && p.alive && !p.arrested;
  }

  /** One sim step. */
  step(dt: number): void {
    this.time += dt;
    this.updateSuspect();
    const level = this.wanted.level;
    // A new star (however it came: crimes, a script) is a fresh report.
    if (level > this.ctx.stars) this.police.report(this.suspect);
    this.ctx.stars = level;
    // Dispatch tracks them on a fresh call, and for a few seconds after a sighting.
    this.ctx.tracked = this.wanted.responding || (level > 0 && this.wanted.unseen < TRACK_AFTER_SIGHTING);
    this.ctx.view = this.deps.view();
    this.police.step(dt, this.ctx);
    this.wanted.step(dt, this.police.seen);
    this.stepArrest(dt);
    this.stepRespray(dt);
    if ((this.yieldIn -= dt) <= 0) {
      this.yieldIn = YIELD_EVERY;
      this.pullOver();
    }
  }

  /**
   * Controls for any car not driven by the player: police units, road
   * ragers and ordinary traffic (whose honks go out as events).
   */
  drive(v: Vehicle, obstacles: Obstacle[], dt: number): VehicleControls {
    const rand = this.deps.rand;
    const police = this.police.drive(v, obstacles, rand, dt);
    if (police) return police;
    const ai = v.ai;
    if (!ai) return NO_CONTROLS;
    if (v.pursuit) {
      // Road rage: chase the player until it wears off (or they're out of play).
      ai.moodTimer -= dt;
      ai.hornCooldown -= dt;
      if (ai.moodTimer > 0 && this.live) {
        if (ai.hornCooldown <= 0) {
          ai.hornCooldown = 1.2 + rand() * 1.5;
          this.deps.bus.emit({ type: 'horn', x: v.sim.x, z: v.sim.z, duration: 0.3 + rand() * 0.5 });
        }
        this.updateRageTarget();
        return drivePursuit(v.pursuit, v.sim, this.rageTarget, obstacles, rand, dt);
      }
      v.pursuit = null;
      ai.mood = 'calm';
      rerouteAi(ai, v.sim, rand);
    }
    const c = driveAi(ai, v.sim, obstacles, rand, dt);
    if (ai.honk > 0) {
      this.deps.bus.emit({ type: 'horn', x: v.sim.x, z: v.sim.z, duration: ai.honk });
      ai.honk = 0;
    }
    return c;
  }

  /**
   * The player's car hit `other` hard (impact > 6 m/s closing). Ramming a
   * police car is a crime (if the player did the ramming); an ordinary
   * driver panics, flies into a rage or bails out.
   */
  playerCrash(other: Vehicle, impact: number): void {
    const own = this.deps.player.driving;
    if (!own || !this.live || impact <= 6) return;
    if (other.police || other.archetype === 'police') {
      // In a chase, bumps happen both ways: only a clear ram counts. A cop
      // ramming, PITting or boxing you in was asking for it.
      const unit = this.police.unitOf(other);
      const mode = unit?.role === 'pursuit' ? unit.driver.mode : null;
      if (mode === 'ram' || mode === 'pit' || mode === 'box') return;
      if (!rammedBy(own, other, mode ? CHASE_RAM_MARGIN : RAM_MARGIN)) return;
      const last = this.rammed.get(other) ?? -Infinity;
      this.rammed.set(other, this.time);
      if (this.time - last < RAM_REPEAT) return;
      // The cop you hit saw it.
      this.wanted.commit('ramCop', true);
      this.deps.award(this.deps.score.award('copRam'));
      return;
    }
    const ai = other.ai;
    if (!ai || other.damage.wrecked || ai.mood !== 'calm' || other.pursuit) return;
    const reaction = reactToHit(ai, this.deps.rand);
    if (reaction === 'rage') {
      other.pursuit = createPursuit(ai, 1, RAGE_CRUISE, RAGE_TOP, false);
      other.pursuit.mode = 'chase';
    } else if (reaction === 'bail') {
      this.deps.ejectDriver(other, own.sim.x, own.sim.z);
    }
  }

  /** A fresh run (or the title): nobody's wanted, the police clear the street. */
  reset(): void {
    this.wanted.clear('reset');
    this.police.reset();
    this.bust.reset();
    this.shop = null;
    this.sprayProgress = 0;
    this.rammed.clear();
    for (const v of this.deps.vehicles) {
      if (v.pursuit && !v.police && v.ai) {
        v.pursuit = null;
        v.ai.mood = 'calm';
      }
    }
  }

  /** The player as the police see them, refreshed. */
  private updateSuspect(): Suspect {
    const { player } = this.deps;
    const s = this.suspect;
    const car = player.driving;
    const at = player.position;
    s.x = at.x;
    s.z = at.z;
    s.vx = at.vx;
    s.vz = at.vz;
    s.heading = car ? car.sim.heading : player.ped.heading;
    s.inCar = car !== null;
    s.armed = !car && player.arsenal.current !== null;
    s.down = !car && player.stunned > 0;
    s.car = car ? car.sim : null;
    s.active = this.live;
    return s;
  }

  /** Was a crime at (x, z) witnessed: on screen, or near any police? */
  witnessed(x: number, z: number): boolean {
    const r = this.ctx.view;
    if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return true;
    return this.police.copWithin(x, z, WITNESS_RANGE);
  }

  private crime(crime: Crime, x: number, z: number): void {
    if (!this.live) return;
    const witnessed = this.witnessed(x, z);
    this.wanted.commit(crime, witnessed);
    // Called in: the police know where you are.
    if (witnessed || crime === 'copCarStolen') this.police.report(this.updateSuspect());
  }

  private evadedAward(): Award | null {
    const bonus = evadeBonus(this.wanted.peak);
    return bonus > 0 ? this.deps.score.award('evaded', bonus) : null;
  }

  /** Gunfire: drivers nearby panic; people run (the player's own shots already scare them). */
  private gunfire(x: number, z: number, byPlayer: boolean): void {
    for (const v of this.deps.vehicles) {
      if (!v.ai || v.police || v.pursuit) continue;
      if (Math.abs(v.sim.x - x) < GUNFIRE_SCARE && Math.abs(v.sim.z - z) < GUNFIRE_SCARE) scareDriver(v.ai, 6);
    }
    if (byPlayer) return;
    for (const c of this.deps.population.crowd) {
      const a = c.agent;
      if (a.role === 'cop' || a.mode === 'down') continue;
      if (Math.abs(a.s.x - x) < 20 && Math.abs(a.s.z - z) < 20) scare(a, x, z, 4);
    }
  }

  /** Arrests: an officer's grip on someone on foot, or a car boxed in. */
  private stepArrest(dt: number): void {
    const p = this.deps.player;
    if (!this.live) {
      this.bust.reset();
      return;
    }
    const car = p.driving;
    const sit = this.situation;
    sit.stars = this.wanted.level;
    sit.onFoot = car === null;
    sit.stunned = p.stunned > 0;
    if (car) {
      const c = car.sim;
      sit.speed = speed(c);
      sit.copDistance = Infinity;
      sit.copCarTouching = this.police.carTouching(c);
      // The driver's door: beside the left side, a little forward.
      const dx = c.x + Math.cos(c.heading) * 1.6 + Math.sin(c.heading) * 0.3;
      const dz = c.z - Math.sin(c.heading) * 1.6 + Math.cos(c.heading) * 0.3;
      sit.copAtDoor = this.police.officerWithin(dx, dz, DOOR_RANGE);
    } else {
      sit.speed = Math.hypot(p.ped.vx, p.ped.vz);
      sit.copDistance = this.police.nearestOfficer(p.ped.x, p.ped.z);
      sit.copCarTouching = false;
      sit.copAtDoor = false;
    }
    if (this.bust.step(dt, sit)) this.arrest();
  }

  /** BUSTED: a cut of the score, weapons gone, heat cleared, the police stand down. */
  private arrest(): void {
    const fine = this.deps.score.fine(BUST_FINE);
    if (!this.deps.player.arrest(fine)) return;
    this.wanted.clear('busted');
    this.police.standDown();
    this.bust.reset();
  }

  /**
   * Pay 'n' Spray: stop in a bay for SPRAY_SECONDS and the car comes out a new
   * colour and repaired, and the police lose you, unless they saw you go in.
   * One spray per visit: drive out and back in for another.
   */
  private stepRespray(dt: number): void {
    const car = this.deps.player.driving;
    let shop: SprayShop | null = null;
    if (car && this.live && !car.damage.wrecked) {
      for (const s of this.shops) {
        if (inShop(s, car.sim.x, car.sim.z)) {
          shop = s;
          break;
        }
      }
    }
    if (shop !== this.shop) {
      // Driving in: were they being watched?
      this.shop = shop;
      this.sprayWatched = this.police.seen;
      this.sprayProgress = 0;
    }
    if (!shop || !car || this.sprayProgress >= 1) return;
    if (speed(car.sim) > SPRAY_SPEED) {
      this.sprayProgress = 0;
      return;
    }
    this.sprayProgress = Math.min(1, this.sprayProgress + dt / SPRAY_SECONDS);
    if (this.sprayProgress < 1) return;
    if (this.deps.pay && !this.deps.pay(SPRAY_COST)) return;
    const rand = this.deps.rand;
    let paint = car.paint;
    while (paint === car.paint) paint = RESPRAY_PAINTS[Math.floor(rand() * RESPRAY_PAINTS.length)];
    car.paint = paint;
    car.damage = createDamage(VEHICLE_HEALTH[car.archetype]);
    this.deps.repaint(car);
    const cleared = this.wanted.level > 0 && !this.sprayWatched;
    if (cleared) {
      this.wanted.clear('respray');
      this.police.standDown();
    }
    this.deps.bus.emit({ type: 'respray', x: car.sim.x, z: car.sim.z, cleared });
  }

  /** Traffic pulls over for police cars with sirens coming up behind (or head-on). */
  private pullOver(): void {
    for (const u of this.police.units) {
      const cop = u.vehicle;
      if (!cop || u.dismissed || u.role !== 'pursuit' || speed(cop.sim) < 5) continue;
      for (const v of this.deps.vehicles) {
        const ai = v.ai;
        if (!ai || v.police || v.pursuit || ai.mood !== 'calm') continue;
        if (Math.abs(v.sim.x - cop.sim.x) > YIELD_RANGE || Math.abs(v.sim.z - cop.sim.z) > YIELD_RANGE) continue;
        if (shouldYield(v.sim, cop.sim)) ai.yielding = 1;
      }
    }
  }

  private updateRageTarget(): void {
    const s = this.suspect;
    const t = this.rageTarget;
    t.x = s.x;
    t.z = s.z;
    t.vx = s.vx;
    t.vz = s.vz;
    t.heading = s.heading;
    t.inCar = s.inCar;
  }
}

const NO_CONTROLS: VehicleControls = { throttle: 0, steer: 0, handbrake: false };

/** The rammer must have been closing this much faster than the other car, m/s... */
const RAM_MARGIN = 2;
/** ...and by this much on a police car that's chasing you. */
const CHASE_RAM_MARGIN = 7;

/**
 * Who did the ramming? Judged from the speeds just before the hit (the cars'
 * `prev` states): whoever was closing on the other clearly faster.
 */
export function rammedBy(rammer: Vehicle, other: Vehicle, margin = RAM_MARGIN): boolean {
  const a = rammer.prev;
  const b = other.prev;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz) || 1;
  const aCloses = (a.vx * dx + a.vz * dz) / d;
  const bCloses = -(b.vx * dx + b.vz * dz) / d;
  return aCloses > bCloses + margin;
}
