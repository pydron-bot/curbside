/**
 * Service vehicles: the primitive behind every call-out (the ambulance,
 * and the fire truck, tow truck and police the other scenes send).
 *
 *   const run = ServiceRun.call(life, { archetype: 'ambulance', paint, emergency: true, claimRange: 140, ... }, x, z);
 *   // each step:
 *   run.goTo(x, z);                 // follow a moving point (optional)
 *   switch (run.step(dt)) {
 *     case 'onSite': ...            // pulled up: the scene's timed action (run.site = seconds there)
 *     case 'done': case 'failed':   // finished: drop it (the vehicle's already back in traffic)
 *   }
 *   run.leave(hospital.bayX, hospital.bayZ);   // drive off to a point (or leave() straight back into traffic)
 *
 * call() claims a vehicle of that model already in traffic within
 * `claimRange` of the point (if any), else brings one in off-screen on a
 * lane 75–140 m from the player in its livery (`paint`: the batch's
 * per-instance tint; a model the scene lacks can borrow the nearest one
 * in a distinct tint). On the way it drives the police's pursuit logic
 * toward the point standing still (systems/pursuit.ts via Errand: lanes
 * when far, straight in when close, ~7 m short of a person or at the end
 * of a car with `stopAtCar`), lights and siren on with `emergency`
 * (StreetLife sounds it, traffic gives way). On site it holds still.
 * Leaving, it drives to its point (or as traffic) with the lights off,
 * and once there, or far off out of sight, it's handed back to traffic;
 * the director retires vehicles it brought in once they're far and unseen.
 * The phases are systems/cityScenes.ts stepService (pure, tested).
 */
import { forwardSpeed, speed, wrapAngle, type VehicleArchetype, type VehicleControls, type VehicleState } from '../../entities/vehicle';
import { stepService, type ServicePhase, type ServiceState } from '../../systems/cityScenes';
import { createPursuit, drivePursuit, isPursuitHopeless, type PursuitDriver, type PursuitTarget } from '../../systems/pursuit';
import { CRUISE_SPEED, TURN_SPEED, clearDistance, driveAi, driverFor, rerouteAi, type Obstacle } from '../../systems/traffic';
import type { SceneDriver, Vehicle } from '../population';
import { SCENE_RANGE, type SceneCtx } from '../cityLife';
import { len2 } from '../../core/len';

export interface ServiceSpec {
  archetype: VehicleArchetype;
  /** Its livery: the paint (tint) for one brought in. */
  paint: string;
  /** Claim one of this model already in traffic this close to the point instead, m (0: always bring one in). */
  claimRange?: number;
  /** Lights and siren on the way (traffic pulls over). */
  emergency?: boolean;
  /** On the way: cruise and flat out, m/s. */
  cruise: number;
  top: number;
  /** Pulled up within this of the point counts as arrived, m. */
  arrive: number;
  /** The point is a car: pull up at its end (else ~7 m short of it). */
  stopAtCar?: boolean;
  /** Give up if not there in this long, s. */
  timeout: number;
  /** Drive off by itself after this long on site, s (unset: when the scene calls leave()). */
  dwell?: number;
  /** Share of spawns placed ahead of a moving player (police: 0.65). */
  aheadShare?: number;
}

/** Driving off: done when this close to where it's going, m. */
const AWAY_REACH = 16;

export class ServiceRun implements SceneDriver {
  readonly state: ServiceState = { phase: 'drive', age: 0, site: 0 };
  readonly errand: Errand;
  /** Where it's going when it leaves (null: straight back into traffic). */
  private leaveTo: { x: number; z: number } | null = null;
  private calmed = false;

  private constructor(
    private readonly life: SceneCtx,
    readonly spec: ServiceSpec,
    readonly v: Vehicle,
    readonly claimed: boolean,
  ) {
    this.errand = new Errand(v, life.d.rand, spec.cruise, spec.top);
    v.scene = this;
    if (spec.emergency) {
      v.emergency = true;
      v.mesh.siren = true;
    }
  }

  /** Send one to (x, z): claimed from traffic or brought in. Null when there's none to send (try again later). */
  static call(life: SceneCtx, spec: ServiceSpec, x: number, z: number): ServiceRun | null {
    let v: Vehicle | null = null;
    const range = spec.claimRange ?? 0;
    if (range > 0) {
      const p = life.d.player;
      for (const o of life.d.vehicles) {
        if (o.archetype !== spec.archetype || !o.ai || o.scene || o.police || o.pursuit || o === p.driving || o.damage.burning) continue;
        if (life.keeps(o) || len2(o.sim.x - x, o.sim.z - z) > range) continue;
        v = o;
        break;
      }
    }
    const claimed = v !== null;
    v ??= life.spawnCar(spec.archetype, spec.paint, spec.aheadShare ?? 0.5);
    if (!v) return null;
    const run = new ServiceRun(life, spec, v, claimed);
    run.goTo(x, z);
    return run;
  }

  get phase(): ServicePhase {
    return this.state.phase;
  }

  /** Seconds on site. */
  get site(): number {
    return this.state.site;
  }

  /** Head for (x, z) (a car there, with stopAtCar: `heading` is its heading). Called each step to follow something moving. */
  goTo(x: number, z: number, heading = 0): void {
    this.errand.goTo(x, z, this.spec.stopAtCar === true, heading);
  }

  /** Send it somewhere else from the scene (the next patient): back on the way there. */
  redirect(x: number, z: number): void {
    this.goTo(x, z);
    this.state.phase = 'drive';
    this.state.age = 0;
  }

  /** Done here: drive off to (x, z) (the hospital), or with no point straight back into traffic. Lights off, siren off. */
  leave(x?: number, z?: number): void {
    if (this.state.phase === 'done' || this.state.phase === 'failed') return;
    this.state.phase = 'leave';
    const v = this.v;
    v.mesh.siren = false;
    v.emergency = false;
    this.leaveTo = x === undefined || z === undefined ? null : { x, z };
    if (this.leaveTo) this.errand.goTo(this.leaveTo.x, this.leaveTo.z);
    else this.calm();
  }

  /** Keep the lights (and siren) on while leaving: an ambulance with a patient. */
  rush(): void {
    this.v.emergency = this.spec.emergency === true;
    this.v.mesh.siren = this.v.emergency;
  }

  /** One step: returns the phase. 'done' / 'failed': the run's over and the vehicle is back to traffic (or lost). */
  step(dt: number): ServicePhase {
    const s = this.state;
    if (s.phase === 'done' || s.phase === 'failed') return s.phase;
    const life = this.life;
    const v = this.v;
    const lost = life.lost(v) || v.scene !== this;
    // Leaving as traffic is done at once (it's traffic); to a point, once there or far off unseen.
    const away =
      s.phase === 'leave' &&
      (this.leaveTo === null || this.errand.arrived(v, AWAY_REACH) || (life.distance(v.sim.x, v.sim.z) > SCENE_RANGE && !life.inView(v.sim.x, v.sim.z, 4)));
    const phase = stepService(
      s,
      { lost, stuck: this.errand.hopeless, arrived: s.phase === 'drive' && this.errand.arrived(v, this.spec.arrive), away },
      dt,
      this.spec,
    );
    // A dwell ran out: off it goes as traffic.
    if (phase === 'leave' && this.leaveTo === null && !this.calmed) this.leave();
    if (phase === 'done' || phase === 'failed') this.end();
    return phase;
  }

  /** Stop now (a fresh run): the vehicle back to traffic (or left where it is if it was lost). */
  end(): void {
    const s = this.state;
    if (s.phase !== 'done' && s.phase !== 'failed') s.phase = 'failed';
    const v = this.v;
    if (v.scene === this) this.life.release(v);
    if (this.life.lost(v)) v.emergency = false;
  }

  /** Its steering (v.scene): on the way and leaving to a point, the errand; on site, still; else as traffic. */
  drive(v: Vehicle, obstacles: Obstacle[], dt: number): VehicleControls | null {
    if (v.pursuit) return null;
    const life = this.life;
    switch (this.state.phase) {
      case 'drive':
        return this.errand.drive(v, obstacles, life.d.rand, dt);
      case 'onSite':
        return holdStill(v.sim);
      case 'leave':
        if (this.leaveTo) return this.errand.drive(v, obstacles, life.d.rand, dt);
        if (!v.ai) return null;
        return driveAi(v.ai, v.sim, obstacles, life.d.rand, dt, life.d.signals);
      default:
        return null;
    }
  }

  /** Back to a calm driver's pace from where it stands (the errand drove it in a hurry). */
  private calm(): void {
    this.calmed = true;
    const ai = this.v.ai;
    if (!ai) return;
    ai.urgent = false;
    ai.cruise = CRUISE_SPEED;
    ai.turnSpeed = TURN_SPEED;
    ai.mood = 'calm';
    rerouteAi(ai, this.v.sim, this.life.d.rand);
  }
}

/**
 * A vehicle's trip to a point (a patient, a fire, a car to tow, a
 * suspect): the police's pursuit driving with the quarry standing still,
 * so it follows the lanes there and pulls up short of it (`inCar`: at the
 * end of a car, else ~7 m short on its own side). ServiceRun drives with
 * one; a scene can use one on its own (a chase's unit after a suspect).
 */
export class Errand {
  readonly target: PursuitTarget = { x: 0, z: 0, vx: 0, vz: 0, heading: 0, inCar: false, seen: false, known: true };
  readonly pursuit: PursuitDriver;

  constructor(v: Vehicle, rand: () => number, cruise: number, topSpeed: number) {
    const road = v.ai ?? driverFor(v.sim, rand);
    this.pursuit = createPursuit(road, 0, cruise, topSpeed, true);
    v.ai = road;
  }

  goTo(x: number, z: number, inCar = false, heading = 0, vx = 0, vz = 0): void {
    const t = this.target;
    t.x = x;
    t.z = z;
    t.vx = vx;
    t.vz = vz;
    t.heading = heading;
    t.inCar = inCar;
  }

  drive(v: Vehicle, obstacles: Obstacle[], rand: () => number, dt: number): VehicleControls {
    const t = this.target;
    t.seen = len2(t.x - v.sim.x, t.z - v.sim.z) < ERRAND_SIGHT;
    return drivePursuit(this.pursuit, v.sim, t, obstacles, rand, dt);
  }

  /** Pulled up (all but stopped) within `within` m of the point. */
  arrived(v: Vehicle, within: number): boolean {
    return stopped(v.sim, 1.2) && len2(this.target.x - v.sim.x, this.target.z - v.sim.z) < within;
  }

  /** Wedged for good (backed out too often): give up on it. */
  get hopeless(): boolean {
    return isPursuitHopeless(this.pursuit);
  }
}

/** An errand drives straight for its point (not the lanes) within this distance, m. */
const ERRAND_SIGHT = 38;

/** Reused controls for the helpers below (consume before the next call, as with driveAi). */
const controls: VehicleControls = { throttle: 0, steer: 0, handbrake: false };

/** Brake to a standstill and stay there (no creeping into reverse). */
export function holdStill(s: VehicleState): VehicleControls {
  const vF = forwardSpeed(s);
  controls.steer = 0;
  controls.handbrake = false;
  controls.throttle = vF > 0.25 ? -Math.min(1, 0.3 + vF * 0.3) : vF < -0.25 ? 0.5 : 0;
  return controls;
}

/** Is `s` all but stopped? */
export function stopped(s: VehicleState, below = 0.8): boolean {
  return speed(s) < below;
}

/**
 * Pull in to stop at (x, z) on a line running `heading` (a bus stop, the
 * ice cream van's pitch: world/streetSpots.ts roadPoint at BUS_PULL_IN):
 * steer onto the line a few metres ahead, ease off to arrive at a crawl,
 * wait behind anything in the way. Writes the metres still to go into
 * `left.m` (negative once past).
 */
export function pullIn(car: VehicleState, x: number, z: number, heading: number, cruise: number, obstacles: Obstacle[], left: { m: number }): VehicleControls {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const along = (x - car.x) * fx + (z - car.z) * fz;
  left.m = along;
  if (along < 0.4) return holdStill(car);
  const look = Math.min(8, along + 1.5);
  const ax = x - fx * (along - look);
  const az = z - fz * (along - look);
  const diff = wrapAngle(Math.atan2(ax - car.x, az - car.z) - car.heading);
  let want = Math.min(cruise, Math.sqrt(2 * 2.2 * Math.max(0, along - 0.4)) + 0.5);
  const vF = forwardSpeed(car);
  if (clearDistance(car, obstacles) < 3 + Math.max(0, vF) * 0.9) want = 0;
  let throttle = Math.max(-1, Math.min(1, (want - vF) * 0.45));
  if (vF < 0.6 && throttle < 0) throttle = 0;
  controls.throttle = throttle;
  controls.steer = Math.max(-1, Math.min(1, -diff * 2.5));
  controls.handbrake = false;
  return controls;
}
