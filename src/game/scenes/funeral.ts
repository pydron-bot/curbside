/**
 * A funeral procession. By day (FUNERAL_HOURS) a cortege comes through
 * near the player: a black limo for the hearse and two or three black
 * cars behind it, nose to tail at a walking-pace 5.5 m/s, a bell tolling
 * (`funeral`) as it passes. The hearse drives as calm traffic (lights,
 * turns) at that pace and waits for anyone dropping back; the family's
 * cars follow its exact line round the corners (systems/incidents.ts
 * Trail). Calm traffic doesn't overtake (only the urgent do), so it
 * queues behind.
 *
 * Wrecking it: cut through the line between two of its cars, hit one, or
 * take one, and they stop, the mourners get out (two a car, in black) and
 * take it personally: fists for 16 s (NO RESPECT on the score, deps.award),
 * then they walk back, get in and carry on. Holds: HOLD below.
 */
import { LOUD, type SceneHold } from '../../systems/cityScenes';
import { resumeWalking } from '../../systems/crowd';
import {
  CUT_MARGIN,
  FUNERAL_CARS,
  FUNERAL_CLOCK,
  FUNERAL_GAP,
  FUNERAL_HOURS,
  FUNERAL_SECONDS,
  FUNERAL_SPEED,
  MOURN_CHASE,
  Trail,
  cutsThrough,
  followSpeed,
  inHours,
} from '../../systems/incidents';
import { clearDistance, driveAi, type Obstacle } from '../../systems/traffic';
import { forwardSpeed, speed, wrapAngle, type VehicleControls } from '../../entities/vehicle';
import { BLOCK_SIZE, ROAD_WIDTH } from '../../world/city';
import { dirHeading, type Dir } from '../../world/roads';
import { roadPoint, segmentValid } from '../../world/streetSpots';
import type { CrowdPed, SceneDriver, Vehicle } from '../population';
import { SCENE_RANGE, watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { secs, type LabelSink } from '../debugLabels';
import { handBack, roomFor, streetBody } from './people';
import { holdStill } from './service';
import { len2 } from '../../core/len';

/** Cars in the road and mourners with their fists up: held off by anything loud. */
const HOLD: readonly SceneHold[] = LOUD;
const HEARSE_PAINT = '#121316';
const CAR_PAINT = '#17181c';
const MOURNER = { shirt: '#141417', pants: '#141417', shoes: '#0b0b0d' };
/** A follower steers for the line this far ahead of where it is, m. */
const LOOK = 4.5;
/** The hearse waits once the car behind is this far back, m. */
const WAIT_GAP = FUNERAL_GAP * 2.2;
/** The bell tolls every this long while it's in procession, s. */
const TOLL_EVERY = 9;
/** Walking back to the car: in they get within this, or after this long anyway, m / s. */
const BACK_REACH = 1.4;
const BACK_GIVE_UP = 12;

type Phase = 'procession' | 'offended' | 'regroup';

interface Mourner {
  ped: CrowdPed;
  car: Vehicle;
  side: number;
}

export interface Cortege {
  cars: Vehicle[];
  readonly trail: Trail;
  phase: Phase;
  age: number;
  timer: number;
  mourners: Mourner[];
  offended: boolean;
  tollIn: number;
}

export class Funerals implements Scene {
  readonly kind = 'funeral';
  readonly list: Cortege[] = [];
  private scan = 0;
  private readonly p = { x: 0, z: 0 };
  private readonly door = { x: 0, z: 0 };
  private readonly controls: VehicleControls = { throttle: 0, steer: 0, handbrake: false };
  /** The player hit one of the cars this step (from the bus). */
  private hit = false;
  private hitX = 0;
  private hitZ = 0;

  constructor(private readonly life: SceneCtx) {
    life.clock.define('funeral', { ...FUNERAL_CLOCK, hold: HOLD });
    life.d.bus.on('crash', (e) => {
      if (!e.involvesPlayer || e.against !== 'vehicle') return;
      this.hit = true;
      this.hitX = e.x;
      this.hitZ = e.z;
    });
  }

  get running(): number {
    return this.list.length;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 1.5;
      if (life.due('funeral', this.list.length)) this.bringIn();
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.stepOne(this.list[i], dt)) continue;
      this.end(this.list[i]);
      this.list.splice(i, 1);
    }
    this.hit = false;
  }

  reset(): void {
    for (const c of this.list) this.end(c);
    this.list.length = 0;
  }

  describe(out: LabelSink): void {
    for (const c of this.list) {
      for (let i = 0; i < c.cars.length; i++) {
        const v = c.cars[i];
        if (out.wants(v.sim.x, v.sim.z)) out.car(v, i === 0 ? `HEARSE (${c.phase})` : `FUNERAL CAR ${i}`, 'traffic');
      }
      for (const m of c.mourners) out.ped(m.ped, c.phase === 'offended' ? `MOURNER (after you ${secs(MOURN_CHASE - c.timer)})` : 'MOURNER', 'people');
    }
  }

  /** The middle of the cortege, moving with the hearse. */
  subject(out: Subject): boolean {
    const c = this.list[0];
    if (!c) return false;
    const a = c.cars[0].sim;
    const b = c.cars[c.cars.length - 1].sim;
    return watch(out, (a.x + b.x) / 2, (a.z + b.z) / 2, a.vx, a.vz);
  }

  /** Debug (TEST menu) and the title's show: a cortege put down on a lane near the player now. */
  force(): boolean {
    const life = this.life;
    if (this.list.length > 0) return false;
    const at = life.d.focus();
    const cx = Math.round(at.x / BLOCK_SIZE);
    const cz = Math.round(at.z / BLOCK_SIZE);
    let best = Infinity;
    let pick: [number, number, Dir] | null = null;
    const n = FUNERAL_CARS[1];
    for (let ix = cx - 1; ix <= cx + 1; ix++)
      for (let iz = cz - 1; iz <= cz + 1; iz++)
        for (let dir = 0 as Dir; dir < 4; dir++) {
          if (!segmentValid(ix, iz, dir)) continue;
          // The middle of the line, in its lane.
          const p = roadPoint(ix, iz, dir, 12 + (FUNERAL_GAP * (n - 1)) / 2, ROAD_WIDTH / 4, this.p);
          const d = len2(p.x - at.x, p.z - at.z);
          if (d < 8 || d > best || life.crowded(p.x, p.z, FUNERAL_GAP * 1.6)) continue;
          best = d;
          pick = [ix, iz, dir];
        }
    if (!pick) return false;
    const [ix, iz, dir] = pick;
    const h = dirHeading(dir);
    const cars: Vehicle[] = [];
    for (let i = 0; i < n; i++) {
      const p = roadPoint(ix, iz, dir, 12 + i * FUNERAL_GAP, ROAD_WIDTH / 4, this.p);
      cars.push(life.placeCar(i === 0 ? 'limo' : 'sedan', i === 0 ? HEARSE_PAINT : CAR_PAINT, p.x, p.z, h));
    }
    this.start(cars);
    return true;
  }

  // --- Internals ---

  private bringIn(): void {
    const life = this.life;
    const hour = life.d.hour?.() ?? life.d.mood?.hour ?? 13;
    // The procession is all cars: room for a car's mourners is enough (each car's only get out if there's room).
    if (!inHours(hour, FUNERAL_HOURS) || !roomFor(life, 2)) {
      life.clock.defer('funeral', life.now, 15);
      return;
    }
    const lead = life.spawnCar('limo', HEARSE_PAINT, 0.75);
    if (!lead) {
      life.clock.defer('funeral', life.now, 4);
      return;
    }
    const s = lead.sim;
    const n = FUNERAL_CARS[0] + Math.floor(life.d.rand() * (FUNERAL_CARS[1] - FUNERAL_CARS[0] + 1));
    const cars = [lead];
    for (let i = 1; i < n; i++) {
      const x = s.x - Math.sin(s.heading) * FUNERAL_GAP * i;
      const z = s.z - Math.cos(s.heading) * FUNERAL_GAP * i;
      if (life.crowded(x, z, 3.5)) break;
      cars.push(life.placeCar('sedan', CAR_PAINT, x, z, s.heading));
    }
    this.start(cars);
  }

  private start(cars: Vehicle[]): Cortege {
    const life = this.life;
    life.clock.start('funeral', life.now);
    const lead = cars[0];
    const ai = lead.ai;
    if (ai) {
      ai.cruise = FUNERAL_SPEED;
      ai.mood = 'calm';
      ai.urgent = false;
    }
    lead.scene = this.hearse;
    for (let i = 1; i < cars.length; i++) cars[i].scene = this.follower;
    const c: Cortege = { cars, trail: new Trail(160, 0.6), phase: 'procession', age: 0, timer: 0, mourners: [], offended: false, tollIn: 0 };
    c.trail.reset(lead.sim.x, lead.sim.z, lead.sim.heading, FUNERAL_GAP * cars.length + 4);
    this.list.push(c);
    return c;
  }

  private of(v: Vehicle): Cortege | null {
    for (const c of this.list) if (c.cars.includes(v)) return c;
    return null;
  }

  /** The hearse: calm traffic at a walking pace, waiting for the cars behind; still while the mourners are out. */
  readonly hearse: SceneDriver = {
    drive: (v: Vehicle, obstacles: Obstacle[], dt: number): VehicleControls | null => {
      const c = this.of(v);
      if (!c || !v.ai) return null;
      if (c.phase !== 'procession') return holdStill(v.sim);
      const out = driveAi(v.ai, v.sim, obstacles, this.life.d.rand, dt, this.life.d.signals);
      const next = c.cars[1];
      if (next && len2(next.sim.x - v.sim.x, next.sim.z - v.sim.z) > WAIT_GAP) return holdStill(v.sim);
      // Never above the cortege's pace (driveAi eases toward cruise; keep it there).
      if (forwardSpeed(v.sim) > FUNERAL_SPEED && out.throttle > 0) out.throttle = 0;
      return out;
    },
  };

  /** A family car: along the hearse's line, keeping its distance to the car ahead. */
  readonly follower: SceneDriver = {
    drive: (v: Vehicle, obstacles: Obstacle[]): VehicleControls | null => {
      const c = this.of(v);
      if (!c) return null;
      if (c.phase !== 'procession') return holdStill(v.sim);
      const i = c.cars.indexOf(v);
      const ahead = c.cars[i - 1];
      const lead = c.cars[0].sim;
      const s = v.sim;
      const back = c.trail.backOf(lead.x, lead.z, s.x, s.z, FUNERAL_GAP * (c.cars.length + 2));
      const aim = c.trail.at(lead.x, lead.z, Math.max(0, back - LOOK), this.p);
      const diff = wrapAngle(Math.atan2(aim.x - s.x, aim.z - s.z) - s.heading);
      const vF = forwardSpeed(s);
      let want = followSpeed(len2(ahead.sim.x - s.x, ahead.sim.z - s.z), FUNERAL_GAP, speed(ahead.sim));
      if (clearDistance(s, obstacles) < 3 + Math.max(0, vF) * 0.9) want = 0;
      let throttle = Math.max(-1, Math.min(1, (want - vF) * 0.5));
      if (vF < 0.6 && throttle < 0) throttle = 0;
      const ctl = this.controls;
      ctl.throttle = throttle;
      ctl.steer = Math.max(-1, Math.min(1, -diff * 2.5));
      ctl.handbrake = false;
      return ctl;
    },
  };

  /** One cortege's step; false when it's over. */
  private stepOne(c: Cortege, dt: number): boolean {
    const life = this.life;
    c.age += dt;
    c.timer += dt;
    const lead = c.cars[0];
    c.trail.push(lead.sim.x, lead.sim.z);
    // Wrecked, burning or gone: that car drops out (the rest close up).
    for (let i = c.cars.length - 1; i >= 1; i--) {
      const v = c.cars[i];
      if (v.damage.wrecked || v.damage.burning || !v.mesh.root.visible || (v.scene !== this.follower && v !== life.d.player.driving && c.phase === 'procession')) {
        if (v.scene === this.follower) life.release(v);
        c.cars.splice(i, 1);
      }
    }
    if (!c.offended && life.d.playing() && this.disrespected(c)) this.offend(c);
    if (c.phase === 'offended') {
      this.chase(c);
      if (c.timer > MOURN_CHASE) {
        c.phase = 'regroup';
        c.timer = 0;
      }
      return true;
    }
    if (c.phase === 'regroup') return this.regroup(c);
    if (life.lost(lead) || lead.scene !== this.hearse) return false;
    if ((c.tollIn -= dt) <= 0) {
      c.tollIn = TOLL_EVERY;
      if (life.distance(lead.sim.x, lead.sim.z) < 90) life.emit('funeral', lead.sim.x, lead.sim.z);
    }
    if (c.age > FUNERAL_SECONDS && !life.inView(lead.sim.x, lead.sim.z, 10)) return false;
    return life.distance(lead.sim.x, lead.sim.z) < SCENE_RANGE + 30;
  }

  /** Cut through it, hit one, or took one? */
  private disrespected(c: Cortege): boolean {
    const p = this.life.d.player;
    const car = p.driving;
    if (!car) return false;
    for (const v of c.cars) if (v === car) return true;
    const s = car.sim;
    if (this.hit) {
      for (const v of c.cars) if (len2(v.sim.x - this.hitX, v.sim.z - this.hitZ) < (v.sim.body?.reach ?? 2.4) + 1.5) return true;
    }
    if (s.vx * s.vx + s.vz * s.vz < 4) return false;
    for (let i = 1; i < c.cars.length; i++) {
      const a = c.cars[i - 1].sim;
      const b = c.cars[i].sim;
      if (cutsThrough(s.x, s.z, a.x, a.z, b.x, b.z, CUT_MARGIN + (s.body?.halfWidth ?? 1))) return true;
    }
    return false;
  }

  /** They stop; out get the mourners, after whoever did it. */
  private offend(c: Cortege): void {
    const life = this.life;
    c.offended = true;
    c.phase = 'offended';
    c.timer = 0;
    life.d.award?.('noRespect');
    const pl = life.d.player;
    for (const v of c.cars) {
      if (v === pl.driving || v.damage.wrecked || !roomFor(life, 2)) continue;
      for (const side of [1, -1]) {
        const at = this.doorOf(v, side);
        const ped = life.addPed(at.x, at.z, v.sim.heading, MOURNER, streetBody(life, true));
        ped.agent.street = true;
        ped.agent.temper = 'fighter';
        c.mourners.push({ ped, car: v, side });
      }
    }
    const s = c.cars[0].sim;
    life.emit('funeral', s.x, s.z);
  }

  /** Fists (their target is the player: no scene opponent). */
  private chase(c: Cortege): void {
    for (const m of c.mourners) {
      const a = m.ped.agent;
      if (!this.life.present(m.ped) || a.mode === 'down' || a.mode === 'fight') continue;
      a.mode = 'fight';
      a.timer = MOURN_CHASE - c.timer + 1;
      a.attackCooldown = 0.5;
    }
  }

  /** Back to the cars and in; then on they go. */
  private regroup(c: Cortege): boolean {
    const life = this.life;
    for (let i = c.mourners.length - 1; i >= 0; i--) {
      const m = c.mourners[i];
      const a = m.ped.agent;
      const gone = !life.present(m.ped) || !c.cars.includes(m.car) || m.car === life.d.player.driving;
      if (gone || a.mode === 'down') {
        // Their car's gone (or they're flat out): theirs to walk home from.
        if (a.mode === 'fight') resumeWalking(a);
        handBack(life, m.ped);
        c.mourners.splice(i, 1);
        continue;
      }
      if (a.mode === 'fight') {
        a.mode = 'arrest';
        a.timer = 0;
      }
      const door = this.doorOf(m.car, m.side);
      life.walkTo(m.ped, door.x, door.z);
      if (len2(a.s.x - door.x, a.s.z - door.z) < BACK_REACH || c.timer > BACK_GIVE_UP) {
        life.removePed(m.ped);
        c.mourners.splice(i, 1);
      }
    }
    if (c.mourners.length > 0) return true;
    // All aboard: on with the procession (if there's a hearse to follow).
    const lead = c.cars[0];
    if (life.lost(lead) || lead.scene !== this.hearse) return false;
    // A car the player made off with is out of it; the rest close up behind the hearse.
    for (let i = c.cars.length - 1; i >= 1; i--) {
      const v = c.cars[i];
      if (v === life.d.player.driving || v.damage.wrecked || v.damage.burning || !v.mesh.root.visible) {
        // Let go, or it's never retired (the director keeps a car a scene is driving).
        if (v.scene === this.follower) life.release(v);
        c.cars.splice(i, 1);
      } else v.scene = this.follower;
    }
    c.trail.reset(lead.sim.x, lead.sim.z, lead.sim.heading, FUNERAL_GAP * c.cars.length + 4);
    c.phase = 'procession';
    c.timer = 0;
    return true;
  }

  /** A door of `v` on `side` (+1 the driver's), into this.door. */
  private doorOf(v: Vehicle, side: number): { x: number; z: number } {
    const s = v.sim;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const out = (s.body?.halfWidth ?? 0.95) + 0.6;
    this.door.x = s.x + fz * side * out;
    this.door.z = s.z - fx * side * out;
    return this.door;
  }

  /** Over: the mourners walk off, the cars go back to traffic. */
  private end(c: Cortege): void {
    const life = this.life;
    for (const m of c.mourners) {
      if (life.present(m.ped) && m.ped.agent.mode === 'fight') resumeWalking(m.ped.agent);
      handBack(life, m.ped);
    }
    c.mourners.length = 0;
    for (const v of c.cars) if (v.scene === this.hearse || v.scene === this.follower) life.release(v);
  }
}
