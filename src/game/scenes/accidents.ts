/**
 * Traffic accidents. Now and then a driver isn't looking: the car ahead
 * brakes hard and it ploughs into the back of it. Both cars are left
 * crumpled and smoking (the usual damage look: health below SMOKE_AT,
 * never on fire), hazards blinking; the drivers get out and argue beside
 * the cars, and about a third of the time it comes to blows (life.setOn).
 * A police car comes (ServiceRun), lights on; the officer walks over,
 * breaks it up and has a word, then everyone goes their way. Anyone
 * knocked out in the fight lies there for the ambulance (scenes/medics.ts).
 *
 * The two cars stay where they stopped, in the lane, flagged `towable`
 * (Vehicle.towable): a tow truck scene can take them (find them with
 * `towables()` or by the flag: abandoned, `ai` null; skip one the player
 * is in). The traffic behind queues, honks and goes round (LaneBlock)
 * while the player is near; the cars are recycled like any abandoned car
 * once far off and out of sight.
 */
import { LOUD } from '../../systems/cityScenes';
import { FIGHT_SHARE, crumple, laneGapAhead } from '../../systems/trafficScenes';
import { driveAi, type Obstacle } from '../../systems/traffic';
import { forwardSpeed, isBike, type VehicleControls } from '../../entities/vehicle';
import { entryPoint } from '../../world/roads';
import type { CrowdPed, SceneDriver, Vehicle } from '../population';
import { SCENE_DROP, watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { COP_OUTFIT } from '../../systems/police';
import { incident } from './chases';
import { LaneBlock } from './laneBlock';
import { ServiceRun, holdStill, type ServiceSpec } from './service';
import { len2 } from '../../core/len';
import type { LabelSink } from '../debugLabels';

type Phase = 'closing' | 'crashed' | 'argue' | 'fight' | 'sorted' | 'left';

/** Cars this far apart (nose to tail) in a lane can be the pair, m. */
const PAIR_GAP = [3, 30] as const;
/** The crash happens this far from the player, m. */
const RANGE = [20, 130] as const;
/** The car in front stops at least this far short of the junction's stop line (mid-block), m. */
const MID_BLOCK = 16;
/** Not in by now (the gap opened, someone swerved): called off, s. */
const CLOSE_GIVE_UP = 6;
/** The drivers get out this long after the hit, s. */
const GET_OUT = 1.4;
/** Arguing this long before it comes to blows (if it does), s; and before giving up waiting on the police. */
const ARGUE = [4, 7] as const;
const NO_POLICE = 22;
/** The officer has a word for this long, s. */
const WORD = 5;
const POLICE_CALL: ServiceSpec = {
  archetype: 'police',
  paint: '#f2f2f2',
  claimRange: 140,
  emergency: true,
  cruise: 17,
  top: 26,
  arrive: 16,
  timeout: 60,
  aheadShare: 0.4,
};

export interface Accident {
  /** `a` ran into the back of `b`. */
  a: Vehicle;
  b: Vehicle;
  phase: Phase;
  timer: number;
  /** The drivers (a's, b's) once out. */
  drivers: CrowdPed[];
  fight: boolean;
  /** When it comes to blows (s into the argument). */
  blows: number;
  police: ServiceRun | null;
  /** The police have been called (whether or not one came). */
  called: boolean;
  officer: CrowdPed | null;
  /** Where the drivers argue (beside where the cars meet, on the drivers' side). */
  x: number;
  z: number;
  /** Where the cars were left (to tell when a tow took them). */
  ax: number;
  az: number;
  readonly block: LaneBlock;
}

export class Accidents implements Scene {
  readonly list: Accident[] = [];
  private scan = 0;
  private readonly wp = { x: 0, z: 0 };

  constructor(private readonly life: SceneCtx) {
    life.clock.define('accident', { every: [80, 160], cap: 1, first: 45, range: RANGE[1], hold: LOUD });
  }

  /** Scenes still playing out (sites left in the road don't count). */
  get running(): number {
    let n = 0;
    for (const c of this.list) if (c.phase !== 'left') n++;
    return n;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 1;
      if (life.due('accident', this.running) && !incident(life)) this.begin();
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!this.stepOne(this.list[i], dt)) {
        this.drop(this.list[i], false);
        this.list.splice(i, 1);
      }
    }
  }

  reset(): void {
    for (const c of this.list) this.drop(c, true);
    this.list.length = 0;
  }

  describe(out: LabelSink): void {
    for (const c of this.list) {
      if (c.phase === 'closing') {
        out.car(c.a, 'ACCIDENT (not braking)', 'traffic');
        out.car(c.b, 'ACCIDENT (braking)', 'traffic');
      }
      const how = c.phase === 'fight' ? 'DRIVER (fighting)' : c.phase === 'sorted' ? 'DRIVER (statement)' : 'DRIVER (arguing)';
      for (const p of c.drivers) out.ped(p, how, 'people');
      if (c.officer) out.ped(c.officer, 'COP (accident)', 'police');
      if (c.police) out.car(c.police.v, 'POLICE (accident)', 'police');
    }
  }

  /** The two cars closing, then the drivers' argument; nothing once everyone's left. */
  subject(out: Subject): boolean {
    for (const c of this.list) {
      if (c.phase === 'left') continue;
      const a = c.a.sim;
      const b = c.b.sim;
      if (c.phase === 'closing') return watch(out, (a.x + b.x) / 2, (a.z + b.z) / 2, a.vx, a.vz);
      return c.phase === 'crashed' ? watch(out, (a.x + b.x) / 2, (a.z + b.z) / 2) : watch(out, c.x, c.z);
    }
    return false;
  }

  /** Cars crashes left in the road for a tow (also flagged Vehicle.towable). */
  towables(out: Vehicle[]): Vehicle[] {
    out.length = 0;
    for (const v of this.life.d.vehicles) if (v.towable && !v.ai && v !== this.life.d.player.driving && !v.damage.wrecked) out.push(v);
    return out;
  }

  /** Make one happen now between two cars near the player (tests, __ub): false if no pair would do. */
  begin(): boolean {
    const life = this.life;
    const pair = this.findPair();
    if (!pair) {
      life.clock.defer('accident', life.now, 4);
      return false;
    }
    life.clock.start('accident', life.now);
    const [a, b] = pair;
    a.scene = this.rammer;
    b.scene = this.braker;
    const c: Accident = {
      a,
      b,
      phase: 'closing',
      timer: 0,
      drivers: [],
      fight: life.d.rand() < FIGHT_SHARE,
      blows: ARGUE[0] + life.d.rand() * (ARGUE[1] - ARGUE[0]),
      police: null,
      called: false,
      officer: null,
      x: 0,
      z: 0,
      ax: 0,
      az: 0,
      block: new LaneBlock(life),
    };
    this.list.push(c);
    return true;
  }

  /** A car with the one it'll hit just ahead in its lane, both calm traffic, mid-block, in range. */
  private findPair(): [Vehicle, Vehicle] | null {
    const life = this.life;
    const vs = life.d.vehicles;
    for (const a of vs) {
      if (!this.free(a) || forwardSpeed(a.sim) < 4) continue;
      const d = life.distance(a.sim.x, a.sim.z);
      if (d < RANGE[0] || d > RANGE[1]) continue;
      for (const b of vs) {
        if (b === a || !this.free(b) || forwardSpeed(b.sim) < 2) continue;
        const gap = laneGapAhead(a.sim, b.sim, PAIR_GAP[1]);
        if (gap < PAIR_GAP[0]) continue;
        const ai = b.ai!;
        if (ai.phase !== 'approach' || ai.ix !== a.ai!.ix || ai.iz !== a.ai!.iz || ai.dir !== a.ai!.dir) continue;
        const e = entryPoint(ai.ix, ai.iz, ai.dir, this.wp);
        if (len2(e.x - b.sim.x, e.z - b.sim.z) < MID_BLOCK) continue;
        return [a, b];
      }
    }
    return null;
  }

  /** Ordinary calm traffic nobody else has a use for. */
  private free(v: Vehicle): boolean {
    const life = this.life;
    const ai = v.ai;
    return (
      ai !== null &&
      ai.mood === 'calm' &&
      ai.phase === 'approach' &&
      !v.scene &&
      !v.police &&
      !v.pursuit &&
      !v.ambient &&
      !v.emergency &&
      !v.parked &&
      !isBike(v.archetype) &&
      !v.damage.burning &&
      v !== life.d.player.driving &&
      !life.d.keep(v)
    );
  }

  // --- Driving ------------------------------------------------------------------------

  /** The car behind: on along its lane, foot down, eyes elsewhere. */
  readonly rammer: SceneDriver = {
    drive: (v: Vehicle, obstacles: Obstacle[], dt: number): VehicleControls | null => {
      const c = this.of(v);
      if (!c || !v.ai) return null;
      if (c.phase !== 'closing') return holdStill(v.sim);
      const out = driveAi(v.ai, v.sim, obstacles, this.life.d.rand, dt, this.life.d.signals);
      out.throttle = forwardSpeed(v.sim) < 13 ? 1 : 0.2;
      return out;
    },
  };

  /** The car in front: slams on (then stays put). */
  readonly braker: SceneDriver = {
    drive: (v: Vehicle): VehicleControls | null => (this.of(v) ? holdStill(v.sim) : null),
  };

  private of(v: Vehicle): Accident | null {
    for (const c of this.list) if (c.a === v || c.b === v) return c;
    return null;
  }

  // --- Playing out ---------------------------------------------------------------------

  /** One accident's step; false when it's over (and handed back). */
  private stepOne(c: Accident, dt: number): boolean {
    const life = this.life;
    c.timer += dt;
    const a = c.a.sim;
    const b = c.b.sim;
    if (c.phase === 'closing') {
      if (life.lost(c.a) || life.lost(c.b) || c.a.scene !== this.rammer || c.b.scene !== this.braker) return false;
      const touch = len2(a.x - b.x, a.z - b.z) < (a.body?.reach ?? 2.3) + (b.body?.reach ?? 2.3) + 0.3;
      if (touch) this.crash(c);
      else if (c.timer > CLOSE_GIVE_UP) return false;
      return true;
    }
    if (c.phase === 'left') return this.stepLeft(c, dt);
    c.block.step(dt);
    // The police: called a moment after the crash, driving to the scene.
    if (!c.called && c.phase === 'argue' && c.timer > 2) {
      c.called = true;
      c.police = ServiceRun.call(life, POLICE_CALL, c.x, c.z);
    }
    let onSite = false;
    if (c.police) {
      const p = c.police.step(dt);
      if (p === 'failed' || p === 'done') c.police = null;
      else onSite = p === 'onSite';
    }
    switch (c.phase) {
      case 'crashed':
        if (c.timer > GET_OUT) this.getOut(c);
        break;
      case 'argue':
      case 'fight':
        this.argue(c, onSite);
        break;
      case 'sorted':
        this.sorted(c, onSite);
        break;
    }
    return true;
  }

  /** The hit: both crumpled and smoking, hazards on, the lane blocked. */
  private crash(c: Accident): void {
    const life = this.life;
    for (const v of [c.a, c.b]) {
      const d = v.damage;
      d.health = Math.min(d.health, d.maxHealth * crumple(life.d.rand()));
      v.towable = true;
    }
    const a = c.a.sim;
    const b = c.b.sim;
    // Beside where the cars meet, on the drivers' side (left of travel): they argue in the road.
    const fx = Math.sin(b.heading);
    const fz = Math.cos(b.heading);
    c.x = (a.x + b.x) / 2 + fz * 2.5;
    c.z = (a.z + b.z) / 2 - fx * 2.5;
    c.ax = a.x;
    c.az = a.z;
    c.phase = 'crashed';
    c.timer = 0;
    c.block.set(c.a, c.b);
    life.emit('accident', (a.x + b.x) / 2, (a.z + b.z) / 2);
  }

  /** Both drivers out: the cars are abandoned (towable), the argument starts. */
  private getOut(c: Accident): void {
    const life = this.life;
    for (const v of [c.a, c.b]) {
      if (v.scene === this.rammer || v.scene === this.braker) v.scene = null;
      if (!v.ai || v === life.d.player.driving) continue;
      v.ai = null;
      const door = life.doorOf(v.sim);
      const p = life.addPed(door.x, door.z, v.sim.heading);
      p.agent.street = true;
      c.drivers.push(p);
    }
    c.ax = c.a.sim.x;
    c.az = c.a.sim.z;
    c.phase = 'argue';
    c.timer = 0;
  }

  /** Face to face between the cars, jabbing fingers (a step in, a step back); now and then fists. */
  private argue(c: Accident, police: boolean): void {
    const life = this.life;
    const [p, q] = c.drivers;
    if (!p || !q || !this.standing(p) || !this.standing(q)) {
      this.knockedOut(c);
      this.endArgument(c);
      return;
    }
    const fx = Math.sin(c.b.sim.heading) * 0.9;
    const fz = Math.cos(c.b.sim.heading) * 0.9;
    if (c.phase === 'argue') {
      // A step in toward the other now and then.
      const beat = Math.floor(c.timer / 1.3) % 4;
      life.walkTo(p, c.x - fx * (beat === 1 ? 0.45 : 1), c.z - fz * (beat === 1 ? 0.45 : 1));
      life.walkTo(q, c.x + fx * (beat === 3 ? 0.45 : 1), c.z + fz * (beat === 3 ? 0.45 : 1));
      life.lookAt(p, q.agent.s.x, q.agent.s.z);
      life.lookAt(q, p.agent.s.x, p.agent.s.z);
      if (c.fight && c.timer > c.blows && !police) {
        c.phase = 'fight';
        life.setOn(p, q, false, 14);
        life.setOn(q, p, false, 14);
        life.emit('fight', c.x, c.z);
      } else if (c.called && !c.police && c.timer > (c.fight ? NO_POLICE : 12)) this.endArgument(c);
      else if (c.timer > NO_POLICE * 3) this.endArgument(c);
    } else if (life.opponentOf(p) === null && life.opponentOf(q) === null) {
      // Fought themselves out.
      this.endArgument(c);
      return;
    }
    if (police) this.officerIn(c);
  }

  /** The officer walks over and breaks it up. */
  private officerIn(c: Accident): void {
    const life = this.life;
    const run = c.police!;
    if (!c.officer) {
      const door = life.doorOf(run.v.sim);
      c.officer = life.addPed(door.x, door.z, run.v.sim.heading, COP_OUTFIT, 'cop');
      c.officer.agent.role = 'cop';
    }
    const o = c.officer;
    if (!this.standing(o)) return;
    life.walkTo(o, c.x, c.z);
    life.lookAt(o, c.x, c.z);
    if (len2(o.agent.s.x - c.x, o.agent.s.z - c.z) < 2.6) this.endArgument(c);
  }

  /** It's over: the drivers stop, face the officer (if there is one), then go their ways. */
  private endArgument(c: Accident): void {
    const life = this.life;
    for (const p of c.drivers) {
      if (!life.present(p)) continue;
      life.unfight(p);
      if (p.agent.mode === 'fight' || p.agent.mode === 'shoot') p.agent.mode = 'arrest';
      if (p.agent.mode !== 'down') life.walkTo(p, p.agent.s.x, p.agent.s.z);
      if (c.officer) life.lookAt(p, c.officer.agent.s.x, c.officer.agent.s.z);
    }
    c.phase = 'sorted';
    c.timer = 0;
  }

  /** Statements taken: the drivers walk off, the officer back to the car and away; the cars stay for the tow. */
  private sorted(c: Accident, police: boolean): void {
    const life = this.life;
    const o = c.officer;
    if (o && this.standing(o)) life.lookAt(o, c.x, c.z);
    if (c.timer < (o ? WORD : 1.5)) return;
    for (const p of c.drivers) if (life.present(p) && p.agent.scene) life.giveBack(p);
    c.drivers.length = 0;
    if (o && life.present(o) && police) {
      const door = life.doorOf(c.police!.v.sim);
      life.walkTo(o, door.x, door.z);
      if (len2(o.agent.s.x - door.x, o.agent.s.z - door.z) > 1.6 && c.timer < WORD + 12) return;
      life.removePed(o);
    } else if (o && life.present(o)) life.removePed(o);
    c.officer = null;
    c.police?.leave();
    c.police = null;
    c.phase = 'left';
  }

  /** Someone knocked out in the fight: theirs to lie there for the ambulance. */
  private knockedOut(c: Accident): void {
    const life = this.life;
    for (let i = c.drivers.length - 1; i >= 0; i--) {
      const p = c.drivers[i];
      if (life.present(p) && p.agent.mode === 'down' && p.agent.ko) {
        life.giveBack(p);
        c.drivers.splice(i, 1);
      }
    }
  }

  private standing(p: CrowdPed): boolean {
    return this.life.present(p) && !(p.agent.mode === 'down' && p.agent.ko);
  }

  /** Left in the road: the queue goes round while the player's about; done once towed, taken, recycled or far off (SCENE_DROP). */
  private stepLeft(c: Accident, dt: number): boolean {
    const life = this.life;
    const a = c.a;
    const moved = len2(a.sim.x - c.ax, a.sim.z - c.az) > 3;
    if (!a.towable || !c.b.towable || moved || !a.mesh.root.visible || !c.b.mesh.root.visible || life.distance(a.sim.x, a.sim.z) > SCENE_DROP) return false;
    c.block.step(dt);
    return true;
  }

  /** Hand everything back (`now`: a fresh run, people off the street at once). */
  private drop(c: Accident, now: boolean): void {
    const life = this.life;
    c.block.clear();
    for (const v of [c.a, c.b]) {
      if (v.scene === this.rammer || v.scene === this.braker) life.release(v);
    }
    for (const p of c.drivers) {
      if (!life.present(p)) continue;
      if (now) life.removePed(p);
      else life.giveBack(p);
    }
    c.drivers.length = 0;
    if (c.officer && life.present(c.officer)) life.removePed(c.officer);
    c.officer = null;
    c.police?.end();
    c.police = null;
  }
}
