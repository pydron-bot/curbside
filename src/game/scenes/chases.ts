/**
 * Police chases that have nothing to do with the player. Now and then
 * (never while the player is wanted, nor during a mission, race or Chaos
 * Run) a getaway comes through: a car or a scooter driven flat out in a
 * panic, running the lights, with one or two police cars on its tail,
 * lights and sirens going (traffic pulls over),
 * ramming, PITting and boxing it in like they would the player
 * (systems/pursuit.ts); or someone on foot running down the street from
 * officers, a car sometimes following. A street race can end in one
 * (pursue()). One traffic incident (chase, race, accident) at a time.
 *
 * How it ends: boxed in, the suspect gives up by the car (kneeling, hands
 * on head: the player's busted pose) or bolts on foot; a runner out of
 * breath gives up, a tackled one is cuffed on the ground; then they're
 * walked to a police car (one is called for a chase on foot) and driven
 * off: arrested. A hard crash, or an armed suspect shooting it out, leaves
 * them knocked out for the ambulance (scenes/medics.ts): taken down. Lost
 * far off, or too long: escaped. One at a time.
 *
 * None of it is the player's heat: the officers never go for the player
 * (every one has the suspect as its target, or stands). Attack them or
 * their cars and it's the usual crime (they're officers and police cars
 * like any other); then the chase breaks off and the officers on foot are
 * handed to the police (CityLifeDeps.enlist) under normal heat rules.
 */
import { speed, type VehicleArchetype, type VehicleControls } from '../../entities/vehicle';
import { LOUD } from '../../systems/cityScenes';
import { hurtPed, knockDown, resumeWalking, scare } from '../../systems/crowd';
import { COP_OUTFIT } from '../../systems/police';
import { createPursuit, drivePursuit, isPursuitHopeless, type PursuitDriver, type PursuitTarget } from '../../systems/pursuit';
import { driveAi, type Obstacle } from '../../systems/traffic';
import {
  CUFF_SECONDS,
  TACKLE_RANGE,
  TAKEN_OUT_HEALTH,
  boxedIn,
  escaped,
  fleeAxis,
  pickChaseKind,
  stepGrip,
  type ChaseEnd,
  type ChaseKind,
} from '../../systems/trafficScenes';
import { trafficPaint, type CrowdPed, type SceneDriver, type Vehicle } from '../population';
import { SCENE_DROP, type Scene, type SceneCtx } from '../cityLife';
import { ServiceRun, holdStill, type ServiceSpec } from './service';
import { len2 } from '../../core/len';
import type { LabelSink } from '../debugLabels';

type Phase = 'drive' | 'foot' | 'cuffed' | 'withdraw' | 'over';

/**
 * A traffic incident is on (a chase, a street race or an accident): only
 * one at a time, so their cars and officers never stack up on screen (each
 * model not otherwise in view costs a draw call and a shadow pass).
 */
export function incident(life: SceneCtx): boolean {
  return life.chases.running + life.races.running + life.accidents.running > 0;
}

/** A getaway driver in a panic cruises at this (panic doubles it), m/s. */
const GETAWAY_CRUISE = 13;
/** Police on the chase: cruise / flat out, m/s; ram and PIT (pursuit aggression). */
const COP_CRUISE = 22;
const COP_TOP = 32;
const COP_AGGRESSION = 0.6;
/** A pursuer sees its quarry (drives straight at it) this close, m. */
const COP_SIGHT = 45;
/** Officers get out once their car is stopped this close to a suspect on foot, m. */
const OUT_RANGE = 30;
/** A suspect on foot runs this long before they're out of breath, s. */
const RUN = [8, 14] as const;
/** Chance a suspect is armed (and shoots it out rather than giving up). */
export const ARMED_SHARE = 0.3;
/** Boxed in: chance an unarmed suspect gives up by the car rather than running. */
const SURRENDER_SHARE = 0.55;
/** Cuffed: kneel this long before being walked to the car, s. */
const CUFFED_WAIT = 3;
/** Walking to the car or leaving: give up on it (in they go anyway) after this, s. */
const WALK_GIVE_UP = 16;
const POLICE_PAINT = '#f2f2f2';
/** Common models (the sports car is the street racers'), so a chase adds few draw calls. */
const GETAWAY_CARS: readonly VehicleArchetype[] = ['sports', 'sedan', 'compact', 'sports'];
/** A police car called to take away someone arrested on foot. */
const PICKUP: ServiceSpec = { archetype: 'police', paint: POLICE_PAINT, claimRange: 0, emergency: false, cruise: 15, top: 22, arrive: 15, timeout: 60, aheadShare: 0.3 };

interface Unit {
  v: Vehicle | null;
  pursuit: PursuitDriver | null;
  /** Officers still in the car. */
  aboard: number;
  /** Officers out on foot. */
  officers: CrowdPed[];
}

export interface Chase {
  kind: ChaseKind;
  phase: Phase;
  end: ChaseEnd | null;
  /** The getaway (null on foot). */
  car: Vehicle | null;
  suspect: CrowdPed | null;
  armed: boolean;
  units: Unit[];
  /** Seconds the getaway has stood still. */
  still: number;
  /** Seconds of running left; seconds into the cuffed / withdraw phase. */
  timer: number;
  age: number;
  grip: number;
  /** Re-aim the runner every so often. */
  aimIn: number;
  /** Gave up (hands on head): officers just come and cuff them. */
  surrendered: boolean;
  /** A police car called to take away a suspect cuffed on foot. */
  pickup: ServiceRun | null;
  readonly target: PursuitTarget;
}

export class Chases implements Scene {
  readonly chases: Chase[] = [];
  /** How each chase ended (tests, __ub): counts by outcome. */
  readonly ended: Record<ChaseEnd, number> = { arrested: 0, down: 0, escaped: 0 };
  private scan = 0;
  private readonly door = { x: 0, z: 0 };
  private readonly axis = { x: 0, z: 0 };

  constructor(private readonly life: SceneCtx) {
    life.clock.define('chase', { every: [100, 200], cap: 1, first: 75, range: 160, hold: LOUD });
  }

  get running(): number {
    return this.chases.length;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 1;
      if (life.due('chase', this.chases.length) && !incident(life)) this.begin();
    }
    for (let i = this.chases.length - 1; i >= 0; i--) {
      const c = this.chases[i];
      c.age += dt;
      this.stepChase(c, dt);
      if (c.phase === 'over') {
        this.end(c, false);
        this.chases.splice(i, 1);
      }
    }
  }

  reset(): void {
    for (const c of this.chases) this.end(c, true);
    this.chases.length = 0;
  }

  describe(out: LabelSink): void {
    for (const c of this.chases) {
      const what = c.kind === 'bike' ? 'bike' : 'car';
      if (c.car && c.phase === 'drive') out.car(c.car, `CHASE: SUSPECT (${what})`, 'police');
      if (c.suspect) {
        const how = c.phase === 'cuffed' ? 'cuffed' : c.surrendered ? 'gave up' : c.suspect.agent.mode === 'down' ? 'down' : 'on foot';
        out.ped(c.suspect, `CHASE: SUSPECT (${how})`, 'police');
      }
      const cop = c.phase === 'withdraw' ? 'CHASE COP (leaving)' : 'CHASE COP';
      for (const u of c.units) {
        if (u.v) out.car(u.v, cop, 'police');
        for (const o of u.officers) out.ped(o, cop, 'police');
      }
      if (c.pickup) out.car(c.pickup.v, 'CHASE COP (pickup)', 'police');
    }
  }

  /** Start one now (of `kind` if given: tests, __ub). False if there was nowhere to put it (or one's on). */
  begin(kind?: ChaseKind): boolean {
    const life = this.life;
    if (this.chases.length > 0) return false;
    const k = kind ?? pickChaseKind(life.d.rand());
    const chase = k === 'foot' ? this.footChase() : this.carChase(k);
    if (!chase) {
      life.clock.defer('chase', life.now, 5);
      return false;
    }
    life.clock.start('chase', life.now);
    this.chases.push(chase);
    const at = chase.car?.sim ?? chase.suspect!.agent.s;
    life.emit('chase', at.x, at.z);
    return true;
  }

  /**
   * The police turn up for `v` (a street racer, say): it becomes the
   * getaway, a unit comes after it. False if a chase is on already or the
   * player is wanted.
   */
  pursue(v: Vehicle): boolean {
    const life = this.life;
    if (this.chases.length > 0 || life.d.stars() > 0 || !v.ai || life.lost(v)) return false;
    const chase = this.blank('car');
    this.getawayFrom(chase, v);
    // One car behind it, else one from off-screen.
    if (!this.unitBehind(chase, 26) && !this.unitFromAfar(chase)) {
      this.release(v);
      return false;
    }
    this.chases.push(chase);
    life.clock.start('chase', life.now);
    life.emit('chase', v.sim.x, v.sim.z);
    return true;
  }

  // --- Driving --------------------------------------------------------------------

  /** The getaway: flat out in a panic, honking, through the lights. */
  readonly getaway: SceneDriver = {
    drive: (v: Vehicle, obstacles: Obstacle[], dt: number): VehicleControls | null => {
      const c = this.chaseOf(v);
      if (!c || !v.ai) return null;
      if (c.phase !== 'drive') return holdStill(v.sim);
      const life = this.life;
      v.ai.mood = 'panic';
      v.ai.moodTimer = 10;
      const out = driveAi(v.ai, v.sim, obstacles, life.d.rand, dt, life.d.signals);
      if (v.ai.honk > 0) {
        life.d.bus.emit({ type: 'horn', x: v.sim.x, z: v.sim.z, duration: v.ai.honk });
        v.ai.honk = 0;
      }
      return out;
    },
  };

  /** The police: pursuit after the getaway, or after the suspect on foot until close; parked with the crew out. */
  readonly police: SceneDriver = {
    drive: (v: Vehicle, obstacles: Obstacle[], dt: number): VehicleControls | null => {
      for (const c of this.chases) {
        for (const u of c.units) {
          if (u.v !== v) continue;
          if (!u.pursuit || u.officers.length > 0 || u.aboard === 0 || !this.aim(c, v)) return holdStill(v.sim);
          return drivePursuit(u.pursuit, v.sim, c.target, obstacles, this.life.d.rand, dt);
        }
      }
      return null;
    },
  };

  /** Point the chase's target at the quarry as it is now (seen from `from`); false if there's none to chase. */
  private aim(c: Chase, from: Vehicle): boolean {
    const t = c.target;
    if (c.phase === 'drive' && c.car) {
      const s = c.car.sim;
      t.x = s.x;
      t.z = s.z;
      t.vx = s.vx;
      t.vz = s.vz;
      t.heading = s.heading;
      t.inCar = true;
    } else if (c.phase === 'foot' && c.suspect) {
      const s = c.suspect.agent.s;
      t.x = s.x;
      t.z = s.z;
      t.vx = s.vx;
      t.vz = s.vz;
      t.heading = s.heading;
      t.inCar = false;
    } else return false;
    t.known = true;
    t.seen = len2(t.x - from.sim.x, t.z - from.sim.z) < COP_SIGHT;
    return true;
  }

  private chaseOf(v: Vehicle): Chase | null {
    for (const c of this.chases) if (c.car === v) return c;
    return null;
  }

  // --- Setting up -------------------------------------------------------------------

  private carChase(kind: 'car' | 'bike'): Chase | null {
    const life = this.life;
    const rand = life.d.rand;
    const arch: VehicleArchetype = kind === 'bike' ? 'scooter' : GETAWAY_CARS[Math.floor(rand() * GETAWAY_CARS.length)];
    const car = life.spawnCar(arch, trafficPaint(arch, rand), 0.75);
    if (!car) return null;
    const chase = this.blank(kind);
    this.getawayFrom(chase, car);
    // One or two units on its tail, back along the lane (out of view: it all arrives from off-screen).
    // (Patrol cars only: one police model on screen, not three.)
    const n = kind === 'car' && rand() < 0.5 ? 2 : 1;
    for (let i = 0; i < n; i++) this.unitBehind(chase, 16 + i * 13);
    if (chase.units.length === 0) {
      this.release(car);
      life.retire(car);
      return null;
    }
    // Already doing a fair lick.
    const s = car.sim;
    s.vx = Math.sin(s.heading) * 16;
    s.vz = Math.cos(s.heading) * 16;
    return chase;
  }

  /** Someone on the pavement off-screen bolts, an officer or two after them, a car now and then. */
  private footChase(): Chase | null {
    const life = this.life;
    const rand = life.d.rand;
    const at = life.d.focus();
    for (const p of life.d.population.crowd) {
      const a = p.agent;
      if (!a.street || a.scene || a.mode !== 'walk' || a.role !== 'civilian') continue;
      const d = life.distance(a.s.x, a.s.z);
      if (d < 26 || d > 70 || life.inView(a.s.x, a.s.z, 4)) continue;
      // The officers come from further out, so the suspect runs the player's way.
      const ux = (a.s.x - at.x) / d;
      const uz = (a.s.z - at.z) / d;
      const chase = this.blank('foot');
      chase.suspect = p;
      life.borrow(p);
      const n = rand() < 0.5 ? 2 : 1;
      const unit: Unit = { v: null, pursuit: null, aboard: 0, officers: [] };
      for (let i = 0; i < n; i++) {
        const ox = a.s.x + ux * (9 + i * 2) + uz * (i ? 1.5 : 0);
        const oz = a.s.z + uz * (9 + i * 2) - ux * (i ? 1.5 : 0);
        if (life.inView(ox, oz, 2)) continue;
        unit.officers.push(this.officer(ox, oz));
      }
      if (unit.officers.length === 0) {
        life.giveBack(p);
        return null;
      }
      chase.units.push(unit);
      // Sometimes a car comes too.
      if (rand() < 0.4) this.unitFromAfar(chase);
      this.bolt(chase, a.s.x + ux, a.s.z + uz);
      chase.phase = 'foot';
      return chase;
    }
    return null;
  }

  private blank(kind: ChaseKind): Chase {
    return {
      kind,
      phase: kind === 'foot' ? 'foot' : 'drive',
      end: null,
      car: null,
      suspect: null,
      armed: this.life.d.rand() < ARMED_SHARE,
      units: [],
      still: 0,
      timer: 0,
      age: 0,
      grip: 0,
      aimIn: 0,
      surrendered: false,
      pickup: null,
      target: { x: 0, z: 0, vx: 0, vz: 0, heading: 0, inCar: true, seen: true, known: true },
    };
  }

  private getawayFrom(c: Chase, v: Vehicle): void {
    c.car = v;
    v.scene = this.getaway;
    v.ai!.cruise = GETAWAY_CRUISE * (v.archetype === 'scooter' ? 0.9 : 1);
    v.ai!.urgent = false;
  }

  /** A unit put down `back` m behind the getaway on its lane, rolling; false if that's on screen or taken. */
  private unitBehind(c: Chase, back: number): boolean {
    const life = this.life;
    const s = c.car!.sim;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const x = s.x - fx * back;
    const z = s.z - fz * back;
    if (life.crowded(x, z, 4) || life.inView(x, z, 6)) return false;
    const v = life.placeCar('police', POLICE_PAINT, x, z, s.heading);
    v.sim.vx = fx * 15;
    v.sim.vz = fz * 15;
    this.addUnit(c, v);
    return true;
  }

  /** A unit from off-screen (pursuit routes it in); false if there's nowhere to put one. */
  private unitFromAfar(c: Chase): boolean {
    const v = this.life.spawnCar('police', POLICE_PAINT, 0.3);
    if (!v) return false;
    this.addUnit(c, v);
    return true;
  }

  private addUnit(c: Chase, v: Vehicle): void {
    v.emergency = true;
    v.mesh.siren = true;
    v.scene = this.police;
    const pursuit = createPursuit(v.ai!, COP_AGGRESSION, COP_CRUISE, COP_TOP, true);
    c.units.push({ v, pursuit, aboard: 2, officers: [] });
  }

  private officer(x: number, z: number): CrowdPed {
    const o = this.life.addPed(x, z, 0, COP_OUTFIT, 'cop');
    o.agent.role = 'cop';
    o.agent.temper = 'armed';
    o.gun = 'pistol';
    return o;
  }

  /** The suspect runs (away from (fromX, fromZ), down the street) until out of breath. */
  private bolt(c: Chase, fromX: number, fromZ: number): void {
    const s = c.suspect!;
    const life = this.life;
    c.phase = 'foot';
    c.timer = RUN[0] + life.d.rand() * (RUN[1] - RUN[0]);
    c.aimIn = 0;
    s.agent.temper = c.armed ? 'armed' : 'calm';
    if (c.armed) s.gun = 'pistol';
    scare(s.agent, fromX, fromZ, 2);
  }

  // --- Running it -------------------------------------------------------------------

  private stepChase(c: Chase, dt: number): void {
    const life = this.life;
    // The player turned on them (or is wanted for anything else): the chase breaks off, normal heat rules.
    if (life.d.stars() > 0 && c.phase !== 'withdraw') {
      this.breakOff(c);
      return;
    }
    if (c.phase === 'withdraw') {
      this.stepWithdraw(c, dt);
      return;
    }
    const at = c.phase === 'drive' ? c.car?.sim : c.suspect?.agent.s;
    if (!at || (c.phase !== 'cuffed' && escaped(c.age, life.distance(at.x, at.z), life.inView(at.x, at.z, 4), SCENE_DROP))) {
      this.finish(c, 'escaped');
      return;
    }
    this.checkUnits(c);
    if (c.phase === 'drive') this.stepDrive(c, dt);
    else if (c.phase === 'foot') this.stepFoot(c, dt);
    else if (c.phase === 'cuffed') this.stepCuffed(c, dt);
  }

  /** Units whose car is lost (wrecked, stolen, wedged out of sight) carry on without it; officers knocked out are out of it. */
  private checkUnits(c: Chase): void {
    const life = this.life;
    let left = 0;
    for (const u of c.units) {
      const v = u.v;
      if (v && (life.lost(v) || v.scene !== this.police)) {
        if (v.scene === this.police) v.scene = null;
        if (v.emergency) v.emergency = false;
        u.v = null;
        u.pursuit = null;
        u.aboard = 0;
      } else if (v && u.pursuit && isPursuitHopeless(u.pursuit) && !life.inView(v.sim.x, v.sim.z, 4)) {
        this.release(v);
        u.v = null;
        u.pursuit = null;
        u.aboard = 0;
      }
      for (let i = u.officers.length - 1; i >= 0; i--) {
        const o = u.officers[i];
        if (!life.present(o) || (o.agent.mode === 'down' && o.agent.ko)) {
          // Knocked out: left lying (the director takes them off once nobody's looking).
          life.unfight(o);
          u.officers.splice(i, 1);
        }
      }
      if (u.v || u.officers.length > 0) left++;
    }
    if (left === 0) this.finish(c, 'escaped');
  }

  private stepDrive(c: Chase, dt: number): void {
    const life = this.life;
    const car = c.car!;
    const p = life.d.player;
    if (car === p.driving || car.scene !== this.getaway) {
      // Carjacked (or taken by something else): the police lose their man.
      this.finish(c, 'escaped');
      return;
    }
    c.still = speed(car.sim) < 1.5 ? c.still + dt : 0;
    const crashed = car.ai === null || car.tipped === true || car.damage.burning || car.damage.wrecked;
    const smashed = car.damage.wrecked || car.damage.health < car.damage.maxHealth * TAKEN_OUT_HEALTH;
    if (!crashed && !smashed && !boxedIn(c.still, this.copCarGap(c, car.sim.x, car.sim.z))) return;
    // Out of the car: thrown off a bike, pulled out of a wreck, or stepping out boxed in.
    const s = car.sim;
    car.scene = null;
    car.towable = true;
    let suspect = car.tipped ? this.adoptNear(s.x, s.z) : null;
    if (!suspect) {
      const door = life.doorOf(s);
      suspect = life.addPed(door.x, door.z, s.heading);
      suspect.agent.street = true;
    }
    car.ai = null;
    c.suspect = suspect;
    const cop = this.nearestCop(c, s.x, s.z);
    if (smashed) {
      // Taken out by the crash: down and out, for the ambulance.
      hurtPed(suspect.agent, 999, cop?.x ?? s.x, cop?.z ?? s.z, 3);
      this.takenDown(c);
      return;
    }
    if (!crashed && !c.armed && life.d.rand() < SURRENDER_SHARE) {
      // Gives up by the car: kneeling, hands on head.
      c.phase = 'foot';
      c.timer = 0;
      this.surrender(c);
    } else this.bolt(c, cop?.x ?? s.x - s.vx, cop?.z ?? s.z - s.vz);
    life.emit('suspectRuns', s.x, s.z);
  }

  /** Whoever was just thrown off the bike by (x, z) (main.ts throwRider): the suspect. */
  private adoptNear(x: number, z: number): CrowdPed | null {
    for (const p of this.life.d.population.crowd) {
      const a = p.agent;
      if (a.scene || !a.street || a.role !== 'civilian' || len2(a.s.x - x, a.s.z - z) > 5) continue;
      this.life.borrow(p);
      return p;
    }
    return null;
  }

  /** The nearest police car's distance from (x, z), m. */
  private copCarGap(c: Chase, x: number, z: number): number {
    let best = Infinity;
    for (const u of c.units) if (u.v) best = Math.min(best, len2(u.v.sim.x - x, u.v.sim.z - z));
    return best;
  }

  /** The nearest officer (on foot, else a car), or null. */
  private nearestCop(c: Chase, x: number, z: number): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const u of c.units) {
      for (const o of u.officers) {
        const d = len2(o.agent.s.x - x, o.agent.s.z - z);
        if (o.agent.mode !== 'down' && d < bestD) {
          bestD = d;
          best = o.agent.s;
        }
      }
      if (u.v) {
        const d = len2(u.v.sim.x - x, u.v.sim.z - z);
        if (d < bestD) {
          bestD = d;
          best = u.v.sim;
        }
      }
    }
    return best;
  }

  private nearestOfficer(c: Chase, x: number, z: number): CrowdPed | null {
    let best: CrowdPed | null = null;
    let bestD = Infinity;
    for (const u of c.units) {
      for (const o of u.officers) {
        if (o.agent.mode === 'down') continue;
        const d = len2(o.agent.s.x - x, o.agent.s.z - z);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
    }
    return best;
  }

  private stepFoot(c: Chase, dt: number): void {
    const life = this.life;
    const s = c.suspect;
    if (!s || !life.present(s)) {
      this.finish(c, 'escaped');
      return;
    }
    const a = s.agent;
    if (a.mode === 'down' && a.ko) {
      this.takenDown(c);
      return;
    }
    // Officers out of their cars once they're close and stopped.
    for (const u of c.units) {
      const v = u.v;
      if (!v || u.aboard === 0) continue;
      if (speed(v.sim) < 1.5 && len2(v.sim.x - a.s.x, v.sim.z - a.s.z) < OUT_RANGE) this.deploy(u);
    }
    const shooting = life.opponentOf(s) !== null && (a.mode === 'shoot' || a.mode === 'fight');
    // Running: down the street, away from the nearest officer, until out of breath.
    if (!c.surrendered && !shooting && a.mode !== 'down') {
      c.timer -= dt;
      if (c.timer > 0) {
        if ((c.aimIn -= dt) <= 0) {
          c.aimIn = 0.6;
          const cop = this.nearestCop(c, a.s.x, a.s.z);
          if (cop) {
            const ax = fleeAxis(a.s.x, a.s.z, cop.x, cop.z, this.axis);
            a.mode = 'flee';
            a.cower = 0;
            a.fleeX = ax.x;
            a.fleeZ = ax.z;
          }
        }
        a.timer = Math.max(a.timer, 1);
      } else {
        const o = this.nearestOfficer(c, a.s.x, a.s.z);
        if (c.armed && o) {
          // Cornered and armed: shoots it out with them.
          life.setOn(s, o, true, 30);
          for (const u of c.units) for (const q of u.officers) if (q.agent.mode !== 'down') life.setOn(q, s, true, 30);
        } else this.surrender(c);
      }
    }
    // Officers run them down (unless shooting it out), tackle a runner, cuff one who's stopped or down.
    const runSpeed = len2(a.s.vx, a.s.vz);
    let closest = Infinity;
    for (const u of c.units) {
      for (const o of u.officers) {
        const oa = o.agent;
        if (oa.mode === 'down') continue;
        const fighting = life.opponentOf(o) !== null && (oa.mode === 'shoot' || oa.mode === 'fight');
        if (fighting) continue;
        // Never left in a fighting mode with nobody to fight: that would turn them on the player.
        if (oa.mode !== 'arrest') oa.mode = 'arrest';
        life.walkTo(o, a.s.x, a.s.z);
        life.lookAt(o, a.s.x, a.s.z);
        const gap = len2(oa.s.x - a.s.x, oa.s.z - a.s.z);
        if (a.mode === 'flee' && runSpeed > 2.8 && gap < TACKLE_RANGE) {
          knockDown(a, oa.s.x, oa.s.z, 2.5, 3);
          c.surrendered = true;
          life.emit('suspectDown', a.s.x, a.s.z);
        }
        closest = Math.min(closest, gap);
      }
    }
    c.grip = stepGrip(c.grip, closest, runSpeed, a.mode === 'down', dt);
    if (c.grip > CUFF_SECONDS) this.cuff(c, s);
  }

  /** Gives up: stops where they are, hands on head (the busted pose). */
  private surrender(c: Chase): void {
    const life = this.life;
    const s = c.suspect!;
    c.surrendered = true;
    life.unfight(s);
    if (s.agent.mode !== 'down') {
      s.agent.mode = 'arrest';
      life.walkTo(s, s.agent.s.x, s.agent.s.z);
    }
    s.model.arrested = true;
  }

  /** `count` officers climb out of the car. */
  private deploy(u: Unit): void {
    const v = u.v!;
    const life = this.life;
    for (; u.aboard > 0; u.aboard--) {
      const side = u.aboard % 2 ? 1 : -1;
      const x = v.sim.x + Math.cos(v.sim.heading) * side * 1.7;
      const z = v.sim.z - Math.sin(v.sim.heading) * side * 1.7;
      u.officers.push(this.officer(x, z));
    }
    // Lights on, siren off: parked.
    v.emergency = false;
    life.emit('suspectRuns', v.sim.x, v.sim.z);
  }

  private cuff(c: Chase, s: CrowdPed): void {
    const life = this.life;
    life.unfight(s);
    s.agent.temper = 'calm';
    s.agent.injured = false;
    if (s.agent.mode === 'down') s.agent.timer = Math.min(s.agent.timer, 0.5);
    s.agent.mode = 'arrest';
    life.walkTo(s, s.agent.s.x, s.agent.s.z);
    s.model.arrested = true;
    for (const u of c.units) for (const o of u.officers) life.unfight(o);
    c.phase = 'cuffed';
    c.timer = 0;
    c.end = 'arrested';
    life.emit('arrest', s.agent.s.x, s.agent.s.z);
  }

  /** Cuffed: kneel a moment, then walked to a police car (one's called if none came) and driven off. */
  private stepCuffed(c: Chase, dt: number): void {
    const life = this.life;
    const s = c.suspect;
    if (!s || !life.present(s)) {
      this.finish(c, 'arrested');
      return;
    }
    c.timer += dt;
    const a = s.agent;
    if (a.mode === 'down') {
      // Knocked down again (a car, a stray bullet): wait for them.
      if (a.ko) this.takenDown(c);
      return;
    }
    let car: Vehicle | null = null;
    let best = Infinity;
    for (const u of c.units) {
      const v = u.v;
      if (!v || life.lost(v)) continue;
      const d = len2(v.sim.x - a.s.x, v.sim.z - a.s.z);
      if (d < best) {
        best = d;
        car = v;
      }
    }
    if (!car && !c.pickup && c.timer > 1) {
      c.pickup = ServiceRun.call(life, PICKUP, a.s.x, a.s.z);
      if (!c.pickup) c.timer = Math.max(c.timer, CUFFED_WAIT + WALK_GIVE_UP);
    }
    if (c.pickup) {
      const phase = c.pickup.step(dt);
      if (phase === 'onSite') car = c.pickup.v;
      else if (phase === 'failed' || phase === 'done') c.pickup = null;
    }
    for (const u of c.units) for (const o of u.officers) life.lookAt(o, a.s.x, a.s.z);
    if (c.timer < CUFFED_WAIT || (!car && c.timer < CUFFED_WAIT + WALK_GIVE_UP)) {
      for (const u of c.units) for (const o of u.officers) life.walkTo(o, o.agent.s.x, o.agent.s.z);
      return;
    }
    // On their feet, walked to the car's back door with an officer at their side.
    s.model.arrested = false;
    const door = car ? life.rearOf(car.sim, this.door) : null;
    const gx = door ? door.x : a.s.x;
    const gz = door ? door.z : a.s.z;
    life.walkTo(s, gx, gz);
    for (const u of c.units) for (const o of u.officers) life.walkTo(o, gx + (o.agent.s.x - a.s.x) * 0.2, gz + (o.agent.s.z - a.s.z) * 0.2);
    const there = len2(a.s.x - gx, a.s.z - gz) < 1.5;
    if (there || c.timer > CUFFED_WAIT + WALK_GIVE_UP * 2) {
      life.removePed(s);
      c.suspect = null;
      if (c.pickup) {
        // In the back: the officers ride along.
        for (const u of c.units) {
          for (const o of u.officers) life.removePed(o);
          u.officers.length = 0;
        }
        c.pickup.leave();
        c.pickup = null;
      }
      this.finish(c, 'arrested');
    }
  }

  /** Down and out (a crash, a bullet): theirs to lie there for the ambulance; the officers stand down. */
  private takenDown(c: Chase): void {
    const life = this.life;
    const s = c.suspect;
    if (s) {
      life.emit('suspectDown', s.agent.s.x, s.agent.s.z);
      s.model.arrested = false;
      s.agent.street = true;
      // Back to the street (medics.ts finds them there).
      life.giveBack(s);
      c.suspect = null;
    }
    this.finish(c, 'down');
  }

  /** It's over (`end`): the officers go back to their cars and drive off. */
  private finish(c: Chase, end: ChaseEnd): void {
    if (c.phase === 'withdraw' || c.phase === 'over') return;
    c.end ??= end;
    this.ended[c.end]++;
    const life = this.life;
    if (c.car && c.car.scene === this.getaway) {
      // Got away: back into traffic (still in a hurry for a while).
      this.release(c.car);
    }
    if (c.suspect && life.present(c.suspect) && c.suspect.agent.scene) {
      c.suspect.model.arrested = false;
      if (c.suspect.agent.mode !== 'down') life.giveBack(c.suspect);
    }
    c.suspect = null;
    if (c.pickup) {
      c.pickup.leave();
      c.pickup = null;
    }
    for (const u of c.units) {
      for (const o of u.officers) {
        life.unfight(o);
        if (o.agent.mode !== 'down') o.agent.mode = 'arrest';
      }
      if (u.v && u.officers.length === 0) {
        this.release(u.v);
        u.v = null;
      } else if (u.v) u.v.emergency = false;
    }
    c.phase = 'withdraw';
    c.timer = 0;
  }

  /** Officers walk back to their cars and get in (those without one walk off); then the cars leave. */
  private stepWithdraw(c: Chase, dt: number): void {
    const life = this.life;
    c.timer += dt;
    let busy = false;
    for (const u of c.units) {
      const v = u.v && !life.lost(u.v) ? u.v : null;
      for (let i = u.officers.length - 1; i >= 0; i--) {
        const o = u.officers[i];
        const oa = o.agent;
        if (!life.present(o)) {
          u.officers.splice(i, 1);
          continue;
        }
        if (oa.mode === 'down') continue;
        if (oa.mode === 'shoot' || oa.mode === 'fight') oa.mode = 'arrest';
        if (!v) {
          // No car: off along the pavement; the director takes them off once out of sight.
          if (oa.mode !== 'walk') {
            life.unfight(o);
            resumeWalking(oa);
          }
          u.officers.splice(i, 1);
          continue;
        }
        const door = life.doorOf(v.sim);
        life.walkTo(o, door.x, door.z);
        if (len2(oa.s.x - door.x, oa.s.z - door.z) < 1.6 || c.timer > WALK_GIVE_UP) {
          life.removePed(o);
          u.officers.splice(i, 1);
        } else busy = true;
      }
      if (u.v && u.officers.length === 0) {
        this.release(u.v);
        u.v = null;
      }
      if (!v && u.v) {
        u.v.scene = null;
        u.v = null;
      }
    }
    if (!busy) c.phase = 'over';
  }

  /** The player is wanted mid-chase (they turned on it): it breaks off; the officers are the police's now. */
  private breakOff(c: Chase): void {
    const life = this.life;
    const enlist = life.d.enlist;
    for (const u of c.units) {
      for (const o of u.officers) {
        if (!life.present(o)) continue;
        if (enlist) {
          life.unfight(o);
          o.agent.scene = false;
          const k = life.people.indexOf(o);
          if (k >= 0) life.people.splice(k, 1);
          if (o.agent.mode === 'shoot' || o.agent.mode === 'fight') o.agent.mode = 'arrest';
          enlist(o);
        } else life.removePed(o);
      }
      u.officers.length = 0;
    }
    this.finish(c, 'escaped');
  }

  /** A car this scene drove, back to ordinary traffic (lights off). */
  private release(v: Vehicle): void {
    if (v.scene === this.getaway || v.scene === this.police) this.life.release(v);
  }

  /** Over: everything handed back at once (a fresh run, or after the withdrawal). */
  private end(c: Chase, now: boolean): void {
    const life = this.life;
    if (now && c.phase !== 'withdraw' && c.phase !== 'over') c.end = null;
    for (const u of c.units) {
      for (const o of u.officers) if (life.present(o)) life.removePed(o);
      u.officers.length = 0;
      if (u.v) this.release(u.v);
      u.v = null;
    }
    if (c.suspect && life.present(c.suspect)) {
      if (now) life.removePed(c.suspect);
      else life.giveBack(c.suspect);
    }
    c.suspect = null;
    if (c.car) this.release(c.car);
    c.pickup?.end();
    c.pickup = null;
  }
}
