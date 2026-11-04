/**
 * Buses and their shelters (world/streetStops.ts, `life.stops`). People
 * gather at the shelters near the player over time: passers-by drift over
 * and wait in a line along the front facing the road (a Gathering with the
 * shelter's own places), and a stop coming into range out of view may
 * already have someone waiting. Any bus near the player (one in traffic,
 * or one brought in now and then while people wait and none is about)
 * heads for the nearest shelter with people waiting, pulls in at its bay
 * (pullIn), hisses its doors open: a rider or two steps off and walks on,
 * the ones waiting walk to the front door and get on (off the street),
 * and once they're aboard it pulls out again. Buses still stop now and
 * then at an empty shelter. Riders who give up waiting walk off.
 */
import type { VehicleControls } from '../../entities/vehicle';
import { IN_PLAY } from '../../systems/cityScenes';
import { routeToward } from '../../systems/pursuit';
import { busDoor, shelterSpot, type Stand } from '../../systems/streetPeople';
import { driveAi, type Obstacle } from '../../systems/traffic';
import type { BusStop } from '../../world/streetStops';
import { trafficPaint, type CrowdPed, type SceneDriver, type Vehicle } from '../population';
import { SCENE_RANGE, watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { labelMembers, type LabelSink } from '../debugLabels';
import { Gathering } from './gathering';
import { roomFor, streetBody } from './people';
import { holdStill, pullIn, stopped } from './service';
import { len2 } from '../../core/len';

/** Shelters this close to the player gather riders, m; they disperse once it's further than STOP_DROP and out of view. */
const STOP_RANGE = 110;
const STOP_DROP = 150;
/** Most shelters gathering at once (the nearest). */
const MAX_STOPS = 4;
/** Riders at one shelter. */
const PER_STOP = 5;
/** A shelter coming into range out of view has this many waiting already (0..). */
const SEED_MAX = 2;
/** A bus heads for a shelter with people waiting this close, m. */
const SEEK_RANGE = 240;
/** A bus pulls in at an empty shelter this often. */
const EMPTY_STOP_CHANCE = 0.3;
/** Doors open at least / at most, s. */
const DWELL = [4, 14] as const;
/** Giving up on pulling in (blocked) after, s. */
const PULL_GIVE_UP = 18;
/** Pulling in, m/s. */
const PULL_SPEED = 8;
/** Boarding: this close to the door is aboard, m. */
const ABOARD = 0.9;

type Phase = 'drive' | 'pull' | 'dwell';

interface Run {
  v: Vehicle;
  phase: Phase;
  stop: BusStop | null;
  last: BusStop | null;
  /** The lane last looked at for a stop (so the coin is tossed once a block). */
  checked: number;
  timer: number;
  /** Getting on: walking to the door. */
  boarding: CrowdPed[];
}

interface Waiting {
  stop: BusStop;
  crowd: Gathering;
}

export class Buses implements Scene {
  readonly kind = 'buses';
  readonly runs: Run[] = [];
  /** Shelters near the player with their riders. */
  readonly waiting: Waiting[] = [];
  private readonly byLane = new Map<number, BusStop>();
  private readonly looked = new Set<BusStop>();
  private scan = 0;
  /** The run force() started (the title's highlight watches it, not a bus adopted from traffic). */
  private forced: Run | null = null;
  private readonly left = { m: 0 };
  private readonly door = { x: 0, z: 0 };
  private readonly spot: Stand = { x: 0, z: 0, heading: 0 };
  /** The SceneDriver for the buses (v.scene), allocation-free. */
  private readonly driver: SceneDriver;

  constructor(private readonly life: SceneCtx) {
    this.remap();
    // A bus brought in now and then while people wait and none is about.
    life.clock.define('bus', { every: [45, 90], cap: 1, first: 25, range: STOP_RANGE, hold: IN_PLAY });
    this.driver = { drive: (v, obstacles, dt) => this.drive(v, obstacles, dt) };
  }

  get running(): number {
    return this.runs.length;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 1;
      this.adopt();
      this.tendStops();
    }
    for (const w of this.waiting) w.crowd.step(dt);
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i];
      if (life.lost(r.v) || r.v.scene !== this.driver) {
        this.endRun(r);
        this.runs.splice(i, 1);
        continue;
      }
      if (r.phase === 'pull' && (r.timer += dt) > PULL_GIVE_UP) this.pullOut(r);
      else if (r.phase === 'dwell') this.dwell(r, dt);
      // Far off and done with: back to plain traffic.
      if (r.phase === 'drive' && life.distance(r.v.sim.x, r.v.sim.z) > SCENE_RANGE + 60) {
        this.endRun(r);
        this.runs.splice(i, 1);
      }
    }
  }

  remap(): void {
    this.byLane.clear();
    for (const s of this.life.stops) if (!this.byLane.has(laneKey(s.ix, s.iz, s.dir))) this.byLane.set(laneKey(s.ix, s.iz, s.dir), s);
  }

  reset(): void {
    for (const r of this.runs) this.endRun(r);
    this.runs.length = 0;
    this.forced = null;
    for (const w of this.waiting) w.crowd.close();
    this.waiting.length = 0;
    this.looked.clear();
  }

  describe(out: LabelSink): void {
    for (const r of this.runs) {
      out.car(r.v, r.phase === 'dwell' ? 'BUS (doors open)' : r.phase === 'pull' ? 'BUS (pulling in)' : r.stop ? 'BUS → stop' : 'BUS', 'traffic');
      labelMembers(out, r.boarding, 'BOARDING', false);
    }
    for (const w of this.waiting) labelMembers(out, w.crowd.members, 'BUS STOP', true);
  }

  /** The bus force() sent pulling in (framed with its stop) or at the stop; nothing once it's away. */
  subject(out: Subject): boolean {
    const r = this.forced;
    if (!r || !this.runs.includes(r) || r.phase === 'drive' || !r.stop) return false;
    const s = r.v.sim;
    const st = r.stop;
    return watch(out, (s.x + st.waitX) / 2, (s.z + st.waitZ) / 2, s.vx / 2, s.vz / 2);
  }

  /**
   * The TEST menu, the title's show and the cold open: the shelter nearest
   * the player (or `at`) gets three riders and a bus `back` m back on its
   * lane, pulling in. False if there's none near.
   */
  force(at?: BusStop, back = 40): boolean {
    const life = this.life;
    let best: BusStop | null = at ?? null;
    if (!best) for (const s of life.stops) if (!best || life.distance(s.x, s.z) < life.distance(best.x, best.z)) best = s;
    if (!best || life.distance(best.x, best.z) > STOP_RANGE) return false;
    const w = this.waitingAt(best) ?? this.openStop(best);
    // Marked looked at: tendStops won't open a second gathering on it.
    this.looked.add(best);
    for (let i = 0; i < 3; i++) this.seedRider(w);
    const fx = Math.sin(best.stopHeading);
    const fz = Math.cos(best.stopHeading);
    const v = life.placeCar('bus', trafficPaint('bus', life.d.rand), best.stopX - fx * back, best.stopZ - fz * back, best.stopHeading);
    const r = this.track(v);
    r.phase = 'pull';
    r.stop = best;
    this.forced = r;
    return true;
  }

  // --- Driving ------------------------------------------------------------------

  private drive(v: Vehicle, obstacles: Obstacle[], dt: number): VehicleControls | null {
    // Road rage (the player rammed it) is heat's to drive.
    if (v.pursuit || !v.ai) return null;
    const r = this.runOf(v);
    if (!r) return null;
    if (r.phase === 'dwell') return holdStill(v.sim);
    const s = r.stop;
    if (r.phase === 'pull' && s) {
      const c = pullIn(v.sim, s.stopX, s.stopZ, s.stopHeading, PULL_SPEED, obstacles, this.left);
      if (this.left.m < 0.8 && stopped(v.sim, 0.5)) this.open(r);
      else if (this.left.m < -4) this.pullOut(r);
      return c;
    }
    const life = this.life;
    const ai = v.ai;
    const c = driveAi(ai, v.sim, obstacles, life.d.rand, dt, life.d.signals);
    if (ai.honk > 0) {
      life.d.bus.emit({ type: 'horn', x: v.sim.x, z: v.sim.z, duration: ai.honk });
      ai.honk = 0;
    }
    if (ai.phase !== 'approach') return c;
    // A shelter on this block, ahead: pull in if anyone's waiting (and now and then if not).
    const key = laneKey(ai.ix, ai.iz, ai.dir);
    const stop = this.byLane.get(key);
    if (stop && stop !== r.last && r.checked !== key) {
      const ahead = (stop.stopX - v.sim.x) * Math.sin(stop.stopHeading) + (stop.stopZ - v.sim.z) * Math.cos(stop.stopHeading);
      if (ahead > 10) {
        r.checked = key;
        const w = this.waitingAt(stop);
        if ((w && w.crowd.members.length > 0) || life.d.rand() < EMPTY_STOP_CHANCE) {
          r.phase = 'pull';
          r.stop = stop;
          r.timer = 0;
          return c;
        }
      }
    }
    // Otherwise turn toward the nearest shelter with people waiting.
    const goal = this.goalFor(r);
    if (goal) ai.next = routeToward(ai.ix, ai.iz, ai.dir, goal.stopX, goal.stopZ);
    return c;
  }

  private runOf(v: Vehicle): Run | null {
    for (const r of this.runs) if (r.v === v) return r;
    return null;
  }

  private track(v: Vehicle): Run {
    v.scene = this.driver;
    const r: Run = { v, phase: 'drive', stop: null, last: null, checked: -1, timer: 0, boarding: [] };
    this.runs.push(r);
    return r;
  }

  /** Buses near the player join the round; with people waiting and none about, one comes now and then. */
  private adopt(): void {
    const life = this.life;
    const p = life.d.player;
    for (const v of life.d.vehicles) {
      if (v.archetype !== 'bus' || !v.ai || v.scene || v.police || v.pursuit || v === p.driving || life.keeps(v)) continue;
      if (life.distance(v.sim.x, v.sim.z) > SCENE_RANGE) continue;
      this.track(v);
    }
    if (this.runs.length > 0 || !life.due('bus', 0)) return;
    let anyone = false;
    for (const w of this.waiting) if (w.crowd.members.length > 0) anyone = true;
    if (!anyone) return;
    const v = life.spawnCar('bus', trafficPaint('bus', life.d.rand), 0.6);
    if (!v) {
      life.clock.defer('bus', life.now, 4);
      return;
    }
    life.clock.start('bus', life.now);
    this.track(v);
  }

  private goalFor(r: Run): BusStop | null {
    let best: BusStop | null = null;
    let bestD = SEEK_RANGE;
    for (const w of this.waiting) {
      if (w.crowd.members.length === 0 || w.stop === r.last) continue;
      const d = len2(w.stop.stopX - r.v.sim.x, w.stop.stopZ - r.v.sim.z);
      if (d < bestD) {
        bestD = d;
        best = w.stop;
      }
    }
    return best;
  }

  // --- At the stop ----------------------------------------------------------------

  /** Doors open: someone may step off; whoever's waiting walks to the front door. */
  private open(r: Run): void {
    const life = this.life;
    const s = r.stop!;
    r.phase = 'dwell';
    r.timer = 0;
    life.emit('busStop', s.stopX, s.stopZ);
    const v = r.v.sim;
    const reach = v.body?.reach ?? 5;
    const half = v.body?.halfWidth ?? 1.3;
    // Off the middle door and on their way: ordinary passers-by from here.
    const off = life.d.rand() < 0.6 ? 1 + (life.d.rand() < 0.35 ? 1 : 0) : 0;
    for (let i = 0; i < off; i++) {
      const d = busDoor(v.x, v.z, v.heading, reach, half, false, this.door);
      const c = life.addPed(d.x - Math.sin(v.heading) * i * 0.8, d.z - Math.cos(v.heading) * i * 0.8, s.heading, undefined, streetBody(life));
      c.agent.street = true;
      life.giveBack(c);
    }
    const w = this.waitingAt(s);
    if (!w) return;
    // Most get on (someone may be waiting for another route).
    for (let i = w.crowd.members.length - 1; i >= 0; i--) {
      const c = w.crowd.members[i];
      if (life.d.rand() < 0.85 && w.crowd.release(c)) r.boarding.push(c);
    }
  }

  private dwell(r: Run, dt: number): void {
    const life = this.life;
    r.timer += dt;
    const v = r.v.sim;
    const door = busDoor(v.x, v.z, v.heading, v.body?.reach ?? 5, v.body?.halfWidth ?? 1.3, true, this.door);
    for (let i = r.boarding.length - 1; i >= 0; i--) {
      const c = r.boarding[i];
      const a = c.agent;
      if (!life.present(c) || !a.scene || a.mode === 'down' || a.mode === 'flee' || a.mode === 'fight') {
        r.boarding.splice(i, 1);
        if (life.present(c) && a.scene && a.mode !== 'down') life.giveBack(c);
        continue;
      }
      life.walkTo(c, door.x, door.z);
      if (len2(a.s.x - door.x, a.s.z - door.z) < ABOARD) {
        // Aboard: off the street.
        life.removePed(c);
        r.boarding.splice(i, 1);
      }
    }
    if ((r.timer > DWELL[0] && r.boarding.length === 0) || r.timer > DWELL[1]) this.pullOut(r);
  }

  /** Doors shut (anyone who didn't make it walks on), back into the traffic. */
  private pullOut(r: Run): void {
    for (const c of r.boarding) if (this.life.present(c) && c.agent.scene) this.life.giveBack(c);
    r.boarding.length = 0;
    r.phase = 'drive';
    r.last = r.stop;
    r.stop = null;
    r.timer = 0;
  }

  private endRun(r: Run): void {
    this.pullOut(r);
    if (r.v.scene === this.driver) r.v.scene = null;
  }

  // --- The shelters -----------------------------------------------------------------

  private waitingAt(s: BusStop): Waiting | null {
    for (const w of this.waiting) if (w.stop === s) return w;
    return null;
  }

  private openStop(s: BusStop): Waiting {
    const crowd = new Gathering(this.life, {
      kind: 'crowd',
      capacity: PER_STOP,
      draw: 16,
      joinChance: 0.12,
      // Long enough for a bus to come; then they give up and walk on.
      stay: [70, 150],
      place: (i: number, out: Stand) => shelterSpot(s.waitX, s.waitZ, s.heading, i, out),
    });
    crowd.at(s.waitX, s.waitZ, s.heading);
    const w = { stop: s, crowd };
    this.waiting.push(w);
    return w;
  }

  /** Someone already waiting (a stop coming into range out of view). */
  private seedRider(w: Waiting): void {
    const p = shelterSpot(w.stop.waitX, w.stop.waitZ, w.stop.heading, w.crowd.members.length, this.spot);
    const c = this.life.addPed(p.x, p.z, p.heading, undefined, streetBody(this.life));
    c.agent.street = true;
    w.crowd.add(c);
  }

  /** Shelters near the player gather riders; far ones let theirs go. */
  private tendStops(): void {
    const life = this.life;
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      const w = this.waiting[i];
      const s = w.stop;
      if (life.distance(s.waitX, s.waitZ) > STOP_DROP && !life.inView(s.waitX, s.waitZ, 4)) {
        w.crowd.close();
        this.waiting.splice(i, 1);
        this.looked.delete(s);
      }
    }
    if (!life.lively('bus')) return;
    for (const w of this.waiting) if (roomFor(life, 2)) w.crowd.recruit();
    if (this.waiting.length >= MAX_STOPS) return;
    for (const s of life.stops) {
      if (this.looked.has(s) || life.distance(s.waitX, s.waitZ) > STOP_RANGE) continue;
      this.looked.add(s);
      const w = this.openStop(s);
      // Already someone waiting, if it comes into range out of view.
      if (!life.inView(s.waitX, s.waitZ, 6)) {
        const n = Math.floor(life.d.rand() * (SEED_MAX + 1));
        if (!roomFor(life, n)) continue;
        for (let i = 0; i < n; i++) this.seedRider(w);
      }
      if (this.waiting.length >= MAX_STOPS) return;
    }
  }
}

/** A number for the lane arriving at (ix, iz) heading `dir` (no string per step). */
function laneKey(ix: number, iz: number, dir: number): number {
  return ((ix + 32) * 64 + (iz + 32)) * 4 + dir;
}
