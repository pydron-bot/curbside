/**
 * Tow trucks clearing the street. Every so often a tow truck comes for a
 * car near the player: a wreck once its fire is out (the player's own
 * included), else an abandoned car, else now and then one parked at the
 * kerb or in a bay (systems/emergency.ts towPriority). It drives over
 * (ServiceRun, no lights), lines up just beyond the car, its tail to it
 * (pullIn), winches it onto the hook over WINCH_SECONDS, and drives off
 * as traffic with it trailing behind (towPose), amber beacon going
 * (render/emergencyLook.ts). Both are retired once out of sight.
 *
 * Take the truck, knock its driver out or get into the towed car and the
 * tow's off: the car stays where it is, an ordinary abandoned car. Never
 * towed: cars an activity needs, police cars, scene cars, bikes and the big
 * models, anything still burning, and the car the player just left unless
 * it's a wreck. BUSY: held off by a timed race and the tutorial, fewer
 * while you're wanted (your pursuit's wrecks get towed too).
 */
import { isBike, type VehicleControls } from '../../entities/vehicle';
import { towPose, towPriority, winch, type Pose, type TowLook } from '../../systems/emergency';
import { BUSY, WANTED_PACE } from '../../systems/cityScenes';
import type { Obstacle } from '../../systems/traffic';
import type { SceneDriver, Vehicle } from '../population';
import { SCENE_RANGE, watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { FireCrews } from './fireCrews';
import { ServiceRun, holdStill, pullIn, stopped, type ServiceSpec } from './service';
import type { LabelSink } from '../debugLabels';

/** Cars this close to the player may be towed, m. */
export const TOW_RANGE = 110;
/** Chance a pick may take a parked car (wrecks and abandoned cars always may). */
const PARKED_CHANCE = 0.5;
/** Cars longer than this (half-length, m) are too big for the hook. */
const MAX_REACH = 3.3;
/** The winch takes this long, s. */
export const WINCH_SECONDS = 2.5;
/** The truck lines up this far to the side of the car's line, m. */
const LINE_SIDE = 3;
/** Lining up beyond the car: given up (winched from where it stands) after this long, s. */
const LINE_UP = 12;
/** A towed car is retired with its truck once both are unseen and far, or after this long towing unseen, s. */
const TOW_FOR = 40;
/** Most tows at once. */
export const MAX_TOWS = 1;

export const TOW_TRUCK: ServiceSpec = {
  archetype: 'tow_truck',
  paint: '#e8b923',
  claimRange: 140,
  cruise: 13,
  top: 19,
  arrive: 16,
  timeout: 70,
};

/** On its way (the run), lining up beyond the car, winching, towing. */
export type TowStage = 'drive' | 'line' | 'winch' | 'tow';

export interface Tow {
  run: ServiceRun;
  truck: Vehicle;
  car: Vehicle;
  stage: TowStage;
  timer: number;
  /** Hooked by its back end (the truck lined up behind it). */
  rear: boolean;
  /** Where the truck stops, and which way it faces. */
  spot: Pose;
  /** The car's pose when the winch started. */
  from: Pose;
  /** Metres still to go lining up (pullIn). */
  left: { m: number };
}

export class Tows implements Scene, SceneDriver {
  readonly tows: Tow[] = [];
  private scan = 0;
  private readonly pose: Pose = { x: 0, z: 0, heading: 0 };
  private readonly look: TowLook = { wrecked: false, burning: false, parked: false, distance: 0 };

  /** The director's tows (for the look). */
  static of(life: SceneCtx): Tows | null {
    for (const s of life.scenes) if (s instanceof Tows) return s;
    return null;
  }

  constructor(private readonly life: SceneCtx) {
    life.clock.define('tow', { every: [45, 90], cap: MAX_TOWS, first: 25, range: TOW_RANGE, hold: BUSY, pace: WANTED_PACE });
  }

  get running(): number {
    return this.tows.length;
  }

  /** The first tow's truck (the in-view meter). */
  subject(out: Subject): boolean {
    const t = this.tows[0];
    if (!t) return false;
    const s = t.truck.sim;
    return watch(out, s.x, s.z, s.vx, s.vz);
  }

  /** Is `v` a tow's (its truck, or the car on the hook)? */
  towing(v: Vehicle): Tow | null {
    for (const t of this.tows) if (t.truck === v || (t.car === v && t.stage !== 'drive')) return t;
    return null;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 1;
      if (life.due('tow', this.tows.length)) this.dispatch();
    }
    for (let i = this.tows.length - 1; i >= 0; i--) {
      if (this.stepTow(this.tows[i], dt)) continue;
      this.tows.splice(i, 1);
    }
  }

  reset(): void {
    for (const t of this.tows) this.drop(t);
    this.tows.length = 0;
  }

  /** Debug (TEST menu): a tow truck for `car` (else the best pick) now, whatever holds it off. */
  force(car: Vehicle | null = this.pick()): boolean {
    if (!car || this.tows.length >= MAX_TOWS || this.towing(car)) return false;
    const run = ServiceRun.call(this.life, TOW_TRUCK, car.sim.x, car.sim.z);
    if (!run) return false;
    this.tows.push({ run, truck: run.v, car, stage: 'drive', timer: 0, rear: false, spot: { x: 0, z: 0, heading: 0 }, from: { x: 0, z: 0, heading: 0 }, left: { m: 99 } });
    return true;
  }

  describe(out: LabelSink): void {
    for (const t of this.tows) {
      out.car(t.truck, t.stage === 'drive' ? 'TOW → car' : t.stage === 'line' ? 'TOW (lining up)' : t.stage === 'winch' ? 'TOW (winching)' : 'TOW (towing)', 'emergency');
      out.car(t.car, t.stage === 'drive' || t.stage === 'line' ? 'TO BE TOWED' : 'ON THE HOOK', 'emergency');
    }
  }

  /** The truck lining up and winching (v.scene once the run has brought it there). */
  drive(v: Vehicle, obstacles: Obstacle[]): VehicleControls | null {
    let t: Tow | null = null;
    for (const o of this.tows) if (o.truck === v) t = o;
    if (!t || v.pursuit) return null;
    if (t.stage === 'line') return pullIn(v.sim, t.spot.x, t.spot.z, t.spot.heading, 5, obstacles, t.left);
    if (t.stage === 'winch') return holdStill(v.sim);
    return null;
  }

  /** Pick the car to tow and send a truck for it. */
  private dispatch(): void {
    const life = this.life;
    const car = this.pick();
    if (!car) {
      life.clock.defer('tow', life.now, 8);
      return;
    }
    const run = ServiceRun.call(life, TOW_TRUCK, car.sim.x, car.sim.z);
    if (!run) {
      life.clock.defer('tow', life.now, 4);
      return;
    }
    life.clock.start('tow', life.now);
    this.tows.push({
      run,
      truck: run.v,
      car,
      stage: 'drive',
      timer: 0,
      rear: false,
      spot: { x: 0, z: 0, heading: 0 },
      from: { x: 0, z: 0, heading: 0 },
      left: { m: 99 },
    });
  }

  /** Wrecks (fire out) first, then abandoned cars, then (sometimes) parked ones, nearest first. */
  private pick(): Vehicle | null {
    const life = this.life;
    const p = life.d.player;
    const fires = FireCrews.of(life)?.board;
    const parkedOk = life.d.rand() < PARKED_CHANCE;
    const look = this.look;
    let best: Vehicle | null = null;
    let bestScore = 0;
    for (const v of life.d.vehicles) {
      if (v === p.driving || v.ai || v.police || v.ambient || v.scene || v.exported || v.tipped || !v.mesh.root.visible) continue;
      if (isBike(v.archetype) || (v.sim.body?.reach ?? 2.4) > MAX_REACH || life.d.keep(v) || this.towing(v)) continue;
      // The car the player just left stays put for them, unless it's a wreck.
      if (v === p.lastDriven && !v.damage.wrecked) continue;
      // A crash left in the lane (scenes/accidents.ts, a dumped getaway car) goes first, like a wreck.
      look.wrecked = v.damage.wrecked || v.towable === true;
      look.burning = v.damage.burning || (fires?.burningNear(v.sim.x, v.sim.z, 6) ?? false);
      look.parked = v.parked === true;
      look.distance = life.distance(v.sim.x, v.sim.z);
      const score = towPriority(look, TOW_RANGE, parkedOk);
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best;
  }

  /** One tow's step; false when it's over. */
  private stepTow(t: Tow, dt: number): boolean {
    const life = this.life;
    const { truck, car } = t;
    const p = life.d.player;
    t.timer += dt;
    const carGone = !car.mesh.root.visible || car === p.driving || car.ai !== null || (t.stage === 'drive' && (car.ambient === true || Boolean(car.scene)));
    if (carGone) {
      this.drop(t);
      return false;
    }
    if (t.stage === 'drive') {
      // A fire may have caught it since: leave it for the fire truck.
      if (t.run.phase === 'drive') {
        if (car.damage.burning) t.run.leave();
        else t.run.goTo(car.sim.x, car.sim.z);
      }
      const phase = t.run.step(dt);
      if (phase === 'done' || phase === 'failed') {
        this.drop(t);
        return false;
      }
      if (phase === 'onSite') this.lineUp(t);
      return true;
    }
    if (t.stage === 'tow' && !truck.mesh.root.visible) {
      // The truck was retired out of sight: the car goes with it.
      if (p.lastDriven === car) p.lastDriven = null;
      life.retire(car);
      return false;
    }
    if (life.lost(truck) || (t.stage !== 'tow' && truck.scene !== this)) {
      this.drop(t);
      return false;
    }
    if (t.stage === 'line') {
      if ((t.left.m < 0.6 && stopped(truck.sim, 0.6)) || t.timer > LINE_UP) this.hook(t);
      return true;
    }
    const ts = truck.sim;
    const cs = car.sim;
    const truckReach = ts.body?.reach ?? 3.2;
    const carReach = cs.body?.reach ?? 2.4;
    if (t.stage === 'winch') {
      // The car comes up onto the hook: eased from where it stood to where it rides.
      // Trailing from where it stood (or straight behind, should it stand ahead of the hook).
      const fx = Math.sin(ts.heading);
      const fz = Math.cos(ts.heading);
      const ahead = (t.from.x - ts.x) * fx + (t.from.z - ts.z) * fz > -truckReach;
      this.pose.x = ahead ? ts.x - fx * (truckReach + 2 * carReach) : t.from.x;
      this.pose.z = ahead ? ts.z - fz * (truckReach + 2 * carReach) : t.from.z;
      const pose = towPose(ts, truckReach, carReach, this.pose, this.pose, t.rear);
      const e = winch(t.timer / WINCH_SECONDS);
      cs.x = t.from.x + (pose.x - t.from.x) * e;
      cs.z = t.from.z + (pose.z - t.from.z) * e;
      cs.heading = t.from.heading + wrap(pose.heading - t.from.heading) * e;
      cs.vx = cs.vz = cs.yawRate = 0;
      if (t.timer >= WINCH_SECONDS) {
        t.stage = 'tow';
        t.timer = 0;
        // Off as calm traffic, the car in tow.
        life.release(truck);
      }
      return true;
    }
    // Towing: the car trails on the hook.
    this.pose.x = cs.x;
    this.pose.z = cs.z;
    this.pose.heading = cs.heading;
    towPose(ts, truckReach, carReach, this.pose, this.pose, t.rear);
    cs.x = this.pose.x;
    cs.z = this.pose.z;
    cs.heading = this.pose.heading;
    // Carried, not driven: no speed of its own (else its tyres skid and smoke as it's dragged round).
    cs.vx = cs.vz = cs.yawRate = 0;
    // Gone off out of sight (far, or a while towing round the block): both retired.
    const unseen = !life.inView(ts.x, ts.z, 6) && !life.inView(cs.x, cs.z, 6);
    if (unseen && (life.distance(ts.x, ts.z) > SCENE_RANGE || t.timer > TOW_FOR)) {
      if (p.lastDriven === car) p.lastDriven = null;
      life.retire(car);
      life.retire(truck);
      return false;
    }
    return true;
  }

  /**
   * Arrived by the car: take the wheel from the run and pull in just beyond
   * it, tail to it, facing the way the truck is already going (so it's
   * hooked by the nose or by the back). The line runs LINE_SIDE m off the
   * car's on the truck's side, so it passes the car rather than meeting it.
   */
  private lineUp(t: Tow): void {
    const { truck, car } = t;
    const cs = car.sim;
    t.run.end();
    t.rear = Math.cos(truck.sim.heading - cs.heading) < 0;
    const h = t.rear ? cs.heading + Math.PI : cs.heading;
    const d = (cs.body?.reach ?? 2.4) + (truck.sim.body?.reach ?? 3.2) + 0.9;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const side = (truck.sim.x - cs.x) * fz - (truck.sim.z - cs.z) * fx >= 0 ? LINE_SIDE : -LINE_SIDE;
    t.spot.heading = h;
    t.spot.x = cs.x + fx * d + fz * side;
    t.spot.z = cs.z + fz * d - fx * side;
    t.stage = 'line';
    t.timer = 0;
    t.left.m = 99;
    // The run handed it back to traffic: it's ours again for the hook.
    truck.scene = this;
  }

  /** Lined up (or as good as): the car is the tow's from now (upkeep leaves it), up it comes. */
  private hook(t: Tow): void {
    const life = this.life;
    const car = t.car;
    t.stage = 'winch';
    t.timer = 0;
    t.from.x = car.sim.x;
    t.from.z = car.sim.z;
    t.from.heading = car.sim.heading;
    car.parked = false;
    car.ambient = true;
    if (!life.owned.includes(car)) life.owned.push(car);
    life.emit('tow', car.sim.x, car.sim.z);
  }

  /** The tow's off: the truck back to traffic, the car left where it is (an ordinary abandoned car or wreck). */
  private drop(t: Tow): void {
    const life = this.life;
    if (t.stage === 'drive') t.run.end();
    else if (t.truck.scene === this) life.release(t.truck);
    if (t.stage === 'winch' || t.stage === 'tow') {
      const car = t.car;
      car.ambient = false;
      const i = life.owned.indexOf(car);
      if (i >= 0) life.owned.splice(i, 1);
    }
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
