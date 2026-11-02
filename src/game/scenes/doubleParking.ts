/**
 * Double-parked trucks. Now and then a delivery van or a garbage truck in
 * traffic near the player stops in its lane, mid-block, hazards on, for
 * 20–40 s: the courier carries parcels from the back doors to a shopfront,
 * one at a time; the garbage crew (two, hi-vis) wheel the bins put out at
 * the kerb to the back of the truck, tip them in and wheel them back. Then they climb back in and it drives
 * on. The traffic behind queues and honks, and the odd driver pulls out
 * round it when the oncoming lane is clear (LaneBlock); the rest wait.
 *
 * Never at a junction (26–44 m before the one ahead), on a lane with road
 * works at the kerb, or at a bus stop, a landmark or a spray bay
 * (CityLifeDeps.avoid). With no truck about, one is brought into traffic
 * off-screen (vans and garbage trucks are ordinary traffic models, in
 * their liveries: no new draw call) and stops once it's in a good spot.
 */
import { IN_PLAY } from '../../systems/cityScenes';
import { DOUBLE_PARK_ALONG, DOUBLE_PARK_OFFSET, clearOf } from '../../systems/trafficScenes';
import { type Obstacle } from '../../systems/traffic';
import { type VehicleArchetype, type VehicleControls } from '../../entities/vehicle';
import { BLOCK_SIZE, ROAD_WIDTH, SIDEWALK } from '../../world/city';
import { DIR_VEC, dirHeading } from '../../world/roads';
import { roadPoint } from '../../world/streetSpots';
import type { CrowdPed, SceneDriver, Vehicle } from '../population';
import type { Scene, SceneCtx } from '../cityLife';
import { LaneBlock } from './laneBlock';
import { holdStill, pullIn } from './service';
import { len2 } from '../../core/len';
import { secs, type LabelSink } from '../debugLabels';

export type TruckJob = 'delivery' | 'garbage';
type Phase = 'pullIn' | 'work' | 'back' | 'leave';
type Trip = 'fetch' | 'carry' | 'drop' | 'return';

/** Stopped this long, s. */
const DWELL = [20, 40] as const;
/** Trucks are taken from traffic this close to the player (and far enough not to stop on top of them), m. */
const RANGE = [30, 130] as const;
/** It stops this far ahead of where it is when picked, m. */
const AHEAD = 14;
/** Share of stops that are the garbage truck. */
const GARBAGE_SHARE = 0.4;
/** Delivery vans' livery: parcel brown, now and then white. */
const VAN_PAINTS = ['#7a5230', '#7a5230', '#f2f2ee'];
const GARBAGE_PAINT = '#3f7a3a';
const COURIER = { shirt: '#6b4a2b', pants: '#4a3a28' };
const CREW = { shirt: '#ff7a1a', pants: '#2a3340' };
/** A trip leg wedged this long (a parked car in the way) is skipped, s. */
const LEG_GIVE_UP = 9;
/** Pause at each end of a trip (handing a parcel in, picking up a bag), s. */
const PAUSE = [1.6, 0.8] as const;
/** Brought-in trucks that haven't found a spot by now are let go, s. */
const PENDING_GIVE_UP = 50;

export interface Crew {
  ped: CrowdPed;
  trip: Trip;
  timer: number;
  /** Carrying a parcel or wheeling a bin (the look draws it; a bin not carried stands at x, z). */
  carrying: boolean;
  /** The round's far end: the shop door, or where this one's bin stands at the kerb. */
  x: number;
  z: number;
}

export interface Stop {
  truck: Vehicle;
  job: TruckJob;
  phase: Phase;
  /** Where it stops (its middle) and its heading. */
  x: number;
  z: number;
  heading: number;
  /** Lane: travelling `dir` toward node (ix, iz), the stop `along` m before the node. */
  ix: number;
  iz: number;
  dir: 0 | 1 | 2 | 3;
  along: number;
  dwell: number;
  timer: number;
  crew: Crew[];
  readonly left: { m: number };
  readonly block: LaneBlock;
}

export class DoubleParking implements Scene {
  readonly stops: Stop[] = [];
  /** A truck brought into traffic to stop when it finds a spot. */
  private pending: Vehicle | null = null;
  private pendingAge = 0;
  private scan = 0;
  private readonly p = { x: 0, z: 0 };
  private readonly door = { x: 0, z: 0 };

  constructor(private readonly life: SceneCtx) {
    life.clock.define('doublePark', { every: [45, 100], cap: 1, first: 25, range: RANGE[1], hold: [...IN_PLAY, 'activity'] });
  }

  get running(): number {
    return this.stops.length;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 0.5;
      if (life.due('doublePark', this.stops.length)) this.begin(false);
      else if (this.pending && this.stops.length > 0) this.pending = null;
    }
    if (this.pending && (this.pendingAge += dt) > PENDING_GIVE_UP) this.pending = null;
    for (let i = this.stops.length - 1; i >= 0; i--) {
      if (this.stepStop(this.stops[i], dt)) continue;
      this.end(this.stops[i], false);
      this.stops.splice(i, 1);
    }
  }

  reset(): void {
    for (const s of this.stops) this.end(s, true);
    this.stops.length = 0;
    this.pending = null;
  }

  describe(out: LabelSink): void {
    for (const s of this.stops) {
      const job = s.job === 'garbage' ? 'GARBAGE' : 'DELIVERY';
      const v = s.truck;
      if (out.wants(v.sim.x, v.sim.z)) out.car(v, s.phase === 'work' ? `${job} ${secs(s.dwell - s.timer)}` : s.phase === 'pullIn' ? `${job} (pulling in)` : job, 'traffic');
      for (const c of s.crew) out.ped(c.ped, s.job === 'garbage' ? (c.carrying ? 'BIN CREW (bin)' : 'BIN CREW') : c.carrying ? 'COURIER (parcel)' : 'COURIER', 'people');
    }
  }

  /**
   * Stop a truck now if one in traffic is in a good spot (`force`: tests,
   * __ub; any job, else brings one in). False if none is (yet).
   */
  begin(force = true, job?: TruckJob): boolean {
    const life = this.life;
    for (const v of life.d.vehicles) {
      if (v.archetype !== 'van' && v.archetype !== 'garbage_truck') continue;
      if (job && (v.archetype === 'van') !== (job === 'delivery')) continue;
      if (!this.free(v) || !this.spot(v)) continue;
      this.start(v);
      return true;
    }
    if (!this.pending || life.lost(this.pending) || !this.pending.ai) {
      // None about: bring one in (it stops once it finds a spot).
      const garbage = job ? job === 'garbage' : life.d.rand() < GARBAGE_SHARE;
      const arch: VehicleArchetype = garbage ? 'garbage_truck' : 'van';
      const paint = garbage ? GARBAGE_PAINT : VAN_PAINTS[Math.floor(life.d.rand() * VAN_PAINTS.length)];
      this.pending = life.spawnCar(arch, paint, 0.75);
      this.pendingAge = 0;
    }
    if (!force) life.clock.defer('doublePark', life.now, 2);
    return false;
  }

  /** Calm traffic nobody else has a use for (or the one brought in for this). */
  private free(v: Vehicle): boolean {
    const life = this.life;
    const ai = v.ai;
    if (!ai || ai.mood !== 'calm' || ai.phase !== 'approach' || ai.overtaking > 0 || ai.yielding > 0) return false;
    if (v.scene || v.police || v.pursuit || v.emergency || v.parked || v.damage.burning) return false;
    if (v.ambient && v !== this.pending) return false;
    if (v === life.d.player.driving || life.keeps(v)) return false;
    const d = life.distance(v.sim.x, v.sim.z);
    return d >= RANGE[0] && d <= RANGE[1];
  }

  /** A stop AHEAD m on in its lane, mid-block, clear of works, stops, landmarks and anything already there? Writes the stop. */
  private spot(v: Vehicle): boolean {
    const life = this.life;
    const ai = v.ai!;
    const dv = DIR_VEC[ai.dir];
    // Metres before the node it's heading to, and where it would stop.
    const before = (ai.ix * BLOCK_SIZE - v.sim.x) * dv.x + (ai.iz * BLOCK_SIZE - v.sim.z) * dv.z;
    const along = before - AHEAD;
    if (along < DOUBLE_PARK_ALONG[0] || along > DOUBLE_PARK_ALONG[1]) return false;
    // Coming in from a turn: its lane must start a full block back.
    if (before > BLOCK_SIZE - 8) return false;
    if (life.d.signals.kerbWorks?.(ai.ix, ai.iz, ai.dir)) return false;
    const p = roadPoint(ai.ix, ai.iz, ai.dir, along, DOUBLE_PARK_OFFSET, this.p);
    if (!clearOf(p.x, p.z, life.d.avoid)) return false;
    for (const s of life.stops) if (len2(s.x - p.x, s.z - p.z) < 18) return false;
    // Nobody stopped just there (a queue, another truck, a crash).
    for (const o of life.d.vehicles) {
      if (o === v) continue;
      if (Math.abs(o.sim.x - p.x) < 7 && Math.abs(o.sim.z - p.z) < 7 && len2(o.sim.vx, o.sim.vz) < 2) return false;
    }
    return true;
  }

  private start(v: Vehicle): void {
    const life = this.life;
    const ai = v.ai!;
    const dv = DIR_VEC[ai.dir];
    const before = (ai.ix * BLOCK_SIZE - v.sim.x) * dv.x + (ai.iz * BLOCK_SIZE - v.sim.z) * dv.z;
    const along = before - AHEAD;
    const p = roadPoint(ai.ix, ai.iz, ai.dir, along, DOUBLE_PARK_OFFSET, this.p);
    if (v === this.pending) this.pending = null;
    v.scene = this.driver;
    life.clock.start('doublePark', life.now);
    this.stops.push({
      truck: v,
      job: v.archetype === 'garbage_truck' ? 'garbage' : 'delivery',
      phase: 'pullIn',
      x: p.x,
      z: p.z,
      heading: dirHeading(ai.dir),
      ix: ai.ix,
      iz: ai.iz,
      dir: ai.dir,
      along,
      dwell: DWELL[0] + life.d.rand() * (DWELL[1] - DWELL[0]),
      timer: 0,
      crew: [],
      left: { m: 0 },
      block: new LaneBlock(life),
    });
  }

  /** The truck's driving: in to the stop, then still until the crew is back. */
  readonly driver: SceneDriver = {
    drive: (v: Vehicle, obstacles: Obstacle[]): VehicleControls | null => {
      for (const s of this.stops) {
        if (s.truck !== v) continue;
        if (s.phase === 'pullIn') return pullIn(v.sim, s.x, s.z, s.heading, 8, obstacles, s.left);
        if (s.phase === 'leave') return null;
        return holdStill(v.sim);
      }
      return null;
    },
  };

  /** One stop's step; false when it's over. */
  private stepStop(s: Stop, dt: number): boolean {
    const life = this.life;
    const v = s.truck;
    if (life.lost(v) || v.scene !== this.driver) return false;
    s.timer += dt;
    switch (s.phase) {
      case 'pullIn':
        if (s.left.m < 0.5 && v.sim.vx * v.sim.vx + v.sim.vz * v.sim.vz < 0.2) this.arrive(s);
        else if (s.timer > 20) return false;
        return true;
      case 'work':
        s.block.step(dt);
        this.work(s, dt);
        if (s.timer > s.dwell) {
          s.phase = 'back';
          s.timer = 0;
        }
        return true;
      case 'back':
        s.block.step(dt);
        return this.backIn(s) && s.timer < 20 ? true : this.drive(s);
      default:
        return false;
    }
  }

  /** Stopped: hazards on, the crew out. */
  private arrive(s: Stop): void {
    const life = this.life;
    const v = s.truck;
    s.phase = 'work';
    s.timer = 0;
    s.block.set(v, v);
    const n = s.job === 'garbage' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      // The driver's door, then the other side for a second.
      const door = life.doorOf(v.sim);
      const side = i === 0 ? 0 : 2 * ((v.sim.body?.halfWidth ?? 1) + 0.7);
      const ped = life.addPed(door.x + Math.cos(v.sim.heading) * -side, door.z - Math.sin(v.sim.heading) * -side, v.sim.heading, s.job === 'garbage' ? CREW : COURIER);
      ped.agent.street = true;
      const c: Crew = { ped, trip: 'fetch', timer: -i * 1.5, carrying: false, x: 0, z: 0 };
      this.farEnd(s, c, i);
      s.crew.push(c);
    }
    life.emit('doublePark', v.sim.x, v.sim.z);
  }

  /**
   * The crew's round: delivery, from the back doors to the shopfront with a
   * parcel and back; garbage, out to the kerb for a bag and back to sling it in.
   */
  private work(s: Stop, dt: number): void {
    const life = this.life;
    const rear = life.rearOf(s.truck.sim, this.door);
    for (let i = 0; i < s.crew.length; i++) {
      const c = s.crew[i];
      const a = c.ped.agent;
      if (!life.present(c.ped) || a.mode === 'down') {
        c.carrying = false;
        continue;
      }
      if ((c.timer += dt) < 0) continue;
      const garbage = s.job === 'garbage';
      switch (c.trip) {
        case 'fetch':
          // To the load: the van's back doors, or the bin put out at the kerb.
          if (this.walk(c, garbage ? c.x : rear.x, garbage ? c.z : rear.z)) this.next(c, 'carry', true);
          break;
        case 'carry':
          // The parcel to the shop door, or the bin to the back of the truck.
          if (this.walk(c, garbage ? rear.x : c.x, garbage ? rear.z : c.z)) this.next(c, 'drop', true);
          break;
        case 'drop':
          // Handing it in, or tipping the bin in the back.
          life.walkTo(c.ped, a.s.x, a.s.z);
          if (c.timer > PAUSE[garbage ? 1 : 0]) this.next(c, 'return', garbage);
          break;
        case 'return':
          // The empty bin back to its spot; the courier straight back to the van for the next.
          if (!garbage || this.walk(c, c.x, c.z)) this.next(c, 'fetch', false);
          break;
      }
    }
  }

  /** Walk toward (x, z): true once there (or wedged too long). */
  private walk(c: Crew, x: number, z: number): boolean {
    const s = c.ped.agent.s;
    this.life.walkTo(c.ped, x, z);
    return len2(s.x - x, s.z - z) < 1.1 || c.timer > LEG_GIVE_UP;
  }

  private next(c: Crew, trip: Trip, carrying: boolean): void {
    c.trip = trip;
    c.timer = 0;
    c.carrying = carrying;
  }

  /** The far end of the round: the shopfront beside the van, or this one's bin at the kerb a few metres along. */
  private farEnd(s: Stop, c: Crew, i: number): void {
    const rand = this.life.d.rand;
    const garbage = s.job === 'garbage';
    const along = garbage ? s.along + (i === 0 ? -1 : 1) * (3 + rand() * 6) : s.along - 2 + rand() * 4;
    const offset = garbage ? ROAD_WIDTH / 2 + 0.6 : ROAD_WIDTH / 2 + SIDEWALK - 0.5;
    const p = roadPoint(s.ix, s.iz, s.dir, along, offset, this.p);
    c.x = p.x;
    c.z = p.z;
  }

  /** Done: everyone back to the cab. True while anyone's still walking back. */
  private backIn(s: Stop): boolean {
    const life = this.life;
    const door = life.doorOf(s.truck.sim);
    let busy = false;
    for (let i = s.crew.length - 1; i >= 0; i--) {
      const c = s.crew[i];
      c.carrying = false;
      if (!life.present(c.ped)) {
        s.crew.splice(i, 1);
        continue;
      }
      if (c.ped.agent.mode === 'down') {
        // Knocked over (by the player?): left to the street.
        life.giveBack(c.ped);
        s.crew.splice(i, 1);
        continue;
      }
      life.walkTo(c.ped, door.x, door.z);
      if (len2(c.ped.agent.s.x - door.x, c.ped.agent.s.z - door.z) < 1.4 || s.timer > 16) {
        life.removePed(c.ped);
        s.crew.splice(i, 1);
      } else busy = true;
    }
    return busy;
  }

  /** Off it goes, as traffic. */
  private drive(s: Stop): boolean {
    const life = this.life;
    for (const c of s.crew) if (life.present(c.ped)) life.removePed(c.ped);
    s.crew.length = 0;
    s.block.clear();
    life.release(s.truck);
    s.phase = 'leave';
    s.timer = 0;
    return false;
  }

  private end(s: Stop, now: boolean): void {
    const life = this.life;
    s.block.clear();
    for (const c of s.crew) {
      if (!life.present(c.ped)) continue;
      if (now) life.removePed(c.ped);
      else life.giveBack(c.ped);
    }
    s.crew.length = 0;
    if (s.truck.scene === this.driver) life.release(s.truck);
  }
}
