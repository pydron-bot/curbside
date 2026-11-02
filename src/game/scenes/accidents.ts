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
 *
 * **Your mess** (V2-10, rules in systems/mess.ts): the player's hard hit on
 * an ordinary car is adopted (adopt(), heat's adoptCrash hook) instead of
 * that driver's panic, rage or bail: the car stops, hazards on, and its
 * driver gets out and has a go at the player (at their car, or on foot;
 * at where they went if they've gone), a patrol comes (scenes/patrol.ts:
 * the scene's, it never busts; a player still there and wanted gets it in
 * their pursuit) and takes a statement, then a tow truck comes for the car
 * (SceneStarter via CityLifeDeps.follow). The player's car is never held,
 * flagged or towed. One at a time, never on a busy street. Each step is a
 * link of a chain rooted in the player (crash → patrol → tow: DOMINO ×2,
 * ×3); the city's own accidents chain the same way, rooted in the city.
 */
import { BUSY, WANTED_PACE } from '../../systems/cityScenes';
import { FIGHT_SHARE, crumple, laneGapAhead } from '../../systems/trafficScenes';
import { driveAi, type Obstacle } from '../../systems/traffic';
import { forwardSpeed, isBike, isPoliceArchetype, type VehicleControls } from '../../entities/vehicle';
import { entryPoint } from '../../world/roads';
import type { CrowdPed, SceneDriver, Vehicle } from '../population';
import { SCENE_DROP, watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { COP_OUTFIT } from '../../systems/police';
import { incident } from './chases';
import { LaneBlock } from './laneBlock';
import { ServiceRun, holdStill, type ServiceSpec } from './service';
import { len2 } from '../../core/len';
import type { LabelSink } from '../debugLabels';
import { BUSY_RANGE, SITE_RANGE, adoptVerdict, type AdoptVerdict, type Cause } from '../../systems/mess';
import { FIRE_AT } from '../../systems/damage';
import { Patrol } from './patrol';
import { handBack } from './people';

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
  /** Its chain (rooted in the city): the crash, then the patrol. */
  cause: Cause | null;
}

/** The driver out, arguing; the patrol on its way or taking a statement; waiting for the tow; done. */
type MessPhase = 'stopping' | 'argue' | 'statement' | 'tow';

/** A crash of the player's the city took over. */
export interface Mess {
  /** Theirs (never the player's). */
  car: Vehicle;
  phase: MessPhase;
  timer: number;
  /** Seconds since the crash. */
  age: number;
  driver: CrowdPed | null;
  patrol: Patrol | null;
  called: boolean;
  /** The tow's been asked for, and got (SceneStarter: its link). */
  towAsk: number;
  towed: boolean;
  /** Seconds the officer's had a word. */
  word: number;
  /** The driver's door (where they wait). */
  doorX: number;
  doorZ: number;
  /** Where the car stopped (to tell when the tow took it). */
  cx: number;
  cz: number;
  cause: Cause;
  readonly block: LaneBlock;
}

/** The driver gets out this long after the hit, s. */
const MESS_GET_OUT = 1.2;
/** The driver comes over to the player within this, m; further, they stay by their car. */
const MESS_REACH = 30;
/** The patrol's called this long after the driver's out, s. */
const MESS_CALL = 2;
/** No patrol by now: the driver gives up waiting and the tow's asked for, s. */
const MESS_NO_POLICE = 25;
/** Asking for the tow again (none free) this often, s; the driver waits at most this long for it. */
const TOW_ASK_EVERY = 4;
const TOW_WAIT = 40;
/** It's over this long after the crash whatever's happened, s. */
const MESS_FOR = 150;
/** Too long for the tow's hook (tows.ts MAX_REACH), m. */
const TOWABLE_REACH = 3.3;
/** The city's own service vehicles: theirs to crash in, not to abandon. */
const SERVICE: ReadonlySet<string> = new Set(['ambulance', 'firetruck', 'tow_truck', 'garbage_truck', 'ice_cream_van', 'bus']);

export class Accidents implements Scene {
  readonly list: Accident[] = [];
  /** The player's crashes the city took over (at most one). */
  readonly mine: Mess[] = [];
  /** Why the last adopt() did or didn't (tests, __ub). */
  verdict: AdoptVerdict | null = null;
  /** Patrols from a mess that ended while they were still about: stepped until gone. */
  private readonly leaving: Patrol[] = [];
  private scan = 0;
  private readonly wp = { x: 0, z: 0 };

  constructor(private readonly life: SceneCtx) {
    life.clock.define('accident', { every: [80, 160], cap: 1, first: 45, range: RANGE[1], hold: BUSY, pace: WANTED_PACE });
    // The player's own: the clock only spaces them out (each is the player's doing, so nothing to schedule).
    life.clock.define('mess', { every: [20, 40], cap: 1, first: 0, hold: BUSY, pace: WANTED_PACE });
  }

  /** Scenes still playing out (sites left in the road don't count; the player's mess does). */
  get running(): number {
    let n = this.mine.length;
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
    for (let i = this.mine.length - 1; i >= 0; i--) {
      if (!this.stepMess(this.mine[i], dt)) {
        this.dropMess(this.mine[i], false);
        this.mine.splice(i, 1);
      }
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) if (this.leaving[i].step(dt) !== 'onSite') this.leaving.splice(i, 1);
  }

  reset(): void {
    for (const c of this.list) this.drop(c, true);
    this.list.length = 0;
    for (const m of this.mine) this.dropMess(m, true);
    this.mine.length = 0;
    for (const p of this.leaving) p.end();
    this.leaving.length = 0;
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
    for (const m of this.mine) {
      out.car(m.car, m.towed ? 'YOUR MESS (tow called)' : 'YOUR MESS', 'traffic');
      if (m.driver) out.ped(m.driver, m.phase === 'statement' ? 'DRIVER (statement)' : m.phase === 'tow' ? 'DRIVER (waiting for the tow)' : 'DRIVER (your fault)', 'people');
      const o = m.patrol?.officer;
      if (o) out.ped(o, 'COP (your mess)', 'police');
      const v = m.patrol?.v;
      if (v) out.car(v, 'POLICE (your mess)', 'police');
    }
  }

  /** The two cars closing, then the drivers' argument; nothing once everyone's left. */
  subject(out: Subject): boolean {
    for (const m of this.mine) {
      const d = m.driver;
      return d ? watch(out, d.agent.s.x, d.agent.s.z) : watch(out, m.car.sim.x, m.car.sim.z);
    }
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
      cause: null,
    };
    this.list.push(c);
    return true;
  }

  // --- Your mess: the player's crash, adopted ---------------------------------------

  /**
   * The player's car hit `v` at `impact` m/s (heat's adoptCrash hook, for
   * an ordinary calm driver): true if the city takes it over (the driver
   * stops and gets out; heat skips their panic, rage or bail).
   */
  adopt(v: Vehicle, impact: number): boolean {
    const life = this.life;
    const ordinary = this.ordinary(v);
    const s = v.sim;
    this.verdict = adoptVerdict({
      impact,
      due: life.d.playing() && life.due('mess', this.mine.length),
      running: this.mine.length,
      ordinary,
      carsNear: ordinary ? this.carsNear(v) : 0,
      sitesNear: ordinary ? this.sitesNear(s.x, s.z) : 0,
    });
    if (this.verdict !== 'adopt') return false;
    life.clock.start('mess', life.now);
    v.scene = this.held;
    this.mine.push({
      car: v,
      phase: 'stopping',
      timer: 0,
      age: 0,
      word: 0,
      driver: null,
      patrol: null,
      called: false,
      towAsk: 0,
      towed: false,
      cx: s.x,
      cz: s.z,
      doorX: s.x,
      doorZ: s.z,
      cause: life.chain(null, 'crash', s.x, s.z, 'player'),
      block: new LaneBlock(life),
    });
    life.emit('accident', s.x, s.z);
    return true;
  }

  /** Is `v` the car of the player's mess? */
  isMess(v: Vehicle): boolean {
    return this.messOf(v) !== null;
  }

  /** An ordinary car on the road nobody else has a use for (the tow can take it; not the player's, not kept). */
  private ordinary(v: Vehicle): boolean {
    const life = this.life;
    const p = life.d.player;
    const d = v.damage;
    return (
      v.ai !== null &&
      v.ai.mood === 'calm' &&
      !v.scene &&
      !v.police &&
      !isPoliceArchetype(v.archetype) &&
      !v.pursuit &&
      !v.ambient &&
      !v.emergency &&
      !v.parked &&
      !isBike(v.archetype) &&
      !SERVICE.has(v.archetype) &&
      (v.sim.body?.reach ?? 2.4) <= TOWABLE_REACH &&
      !d.burning &&
      !d.wrecked &&
      d.health > d.maxHealth * FIRE_AT &&
      v !== p.driving &&
      v !== p.lastDriven &&
      !life.keeps(v)
    );
  }

  /** Other cars within BUSY_RANGE of `v` (the player's not counted). */
  private carsNear(v: Vehicle): number {
    const life = this.life;
    const s = v.sim;
    let n = 0;
    for (const o of life.d.vehicles) {
      if (o === v || o === life.d.player.driving || !o.mesh.root.visible) continue;
      if (Math.abs(o.sim.x - s.x) < BUSY_RANGE && Math.abs(o.sim.z - s.z) < BUSY_RANGE && len2(o.sim.x - s.x, o.sim.z - s.z) < BUSY_RANGE) n++;
    }
    return n;
  }

  /** Other scenes' sites in the road within SITE_RANGE of (x, z): a crash left standing, a double-parked truck. */
  private sitesNear(x: number, z: number): number {
    let n = 0;
    for (const c of this.list) if (len2(c.a.sim.x - x, c.a.sim.z - z) < SITE_RANGE) n++;
    for (const st of this.life.doubleParking?.stops ?? []) if (len2(st.truck.sim.x - x, st.truck.sim.z - z) < SITE_RANGE) n++;
    return n;
  }

  /** The mess's car: held where it stopped until the driver's out. */
  readonly held: SceneDriver = {
    drive: (v: Vehicle): VehicleControls | null => (this.messOf(v) ? holdStill(v.sim) : null),
  };

  private messOf(v: Vehicle): Mess | null {
    for (const m of this.mine) if (m.car === v) return m;
    return null;
  }

  /** One step of the player's mess; false when it's over. */
  private stepMess(m: Mess, dt: number): boolean {
    const life = this.life;
    const car = m.car;
    m.timer += dt;
    m.age += dt;
    const d = car.damage;
    // Taken (by the player, or anyone), burning, recycled, far off, or just old: it's over.
    if (car === life.d.player.driving || !car.mesh.root.visible || d.burning || d.wrecked || m.age > MESS_FOR) return false;
    if (life.distance(car.sim.x, car.sim.z) > SCENE_DROP) return false;
    if (m.phase === 'stopping') {
      if (m.timer >= MESS_GET_OUT) this.messOut(m);
      return true;
    }
    const moved = len2(car.sim.x - m.cx, car.sim.z - m.cz) > 3;
    // Shoved along before the tow's asked for: it stands where it is now.
    if (!m.towed) {
      m.cx = car.sim.x;
      m.cz = car.sim.z;
    }
    if (!moved) m.block.step(dt);
    // The patrol: called a moment after the driver's out.
    if (!m.called && m.timer > MESS_CALL) {
      m.called = true;
      m.patrol = Patrol.call(life, car.sim.x, car.sim.z);
    }
    if (m.patrol) {
      const at = m.patrol.step(dt);
      if (at === 'gone') m.patrol = null;
      else if (at === 'joined') {
        // Still there, and wanted: it's after them now. Nobody takes a statement.
        m.patrol = null;
        m.cause = life.chain(m.cause, 'patrol', car.sim.x, car.sim.z);
        if (m.phase === 'argue') this.messPhase(m, 'tow');
      } else if (at === 'onSite' && m.phase === 'argue') {
        m.cause = life.chain(m.cause, 'patrol', car.sim.x, car.sim.z);
        this.messPhase(m, 'statement');
      }
    }
    if (m.driver && !this.standing(m.driver)) {
      // Knocked down: theirs to lie there (the ambulance comes for the knocked out).
      handBack(life, m.driver);
      m.driver = null;
    }
    switch (m.phase) {
      case 'argue':
        this.messArgue(m);
        if (m.called && !m.patrol && m.timer > MESS_NO_POLICE) this.messPhase(m, 'tow');
        return true;
      case 'statement':
        this.messStatement(m, dt);
        return true;
      case 'tow':
        return this.messTow(m, dt, moved);
    }
    return true;
  }

  /** The driver steps out: the car's left in the lane, hazards on, for the tow. */
  private messOut(m: Mess): void {
    const life = this.life;
    const car = m.car;
    if (car.scene === this.held) car.scene = null;
    car.ai = null;
    car.towable = true;
    const door = life.doorOf(car.sim);
    m.doorX = door.x;
    m.doorZ = door.z;
    const p = life.addPed(door.x, door.z, car.sim.heading);
    p.agent.street = true;
    m.driver = p;
    m.block.set(car, car);
    this.messPhase(m, 'argue');
  }

  /** Over to the player (at their window, or face to face), jabbing a finger; gone, they glare after them from their car. */
  private messArgue(m: Mess): void {
    const life = this.life;
    const p = m.driver;
    if (!p) return;
    const pl = life.d.player;
    const at = pl.position;
    const s = p.agent.s;
    const dx = s.x - at.x;
    const dz = s.z - at.z;
    const dist = len2(dx, dz) || 1;
    if (pl.alive && len2(at.x - m.cx, at.z - m.cz) < MESS_REACH) {
      // A step in now and then, as the city's drivers do.
      const stand = (pl.driving ? (pl.driving.sim.body?.halfWidth ?? 1) + 1.4 : 1.5) + (Math.floor(m.timer / 1.3) % 4 === 1 ? -0.45 : 0);
      life.walkTo(p, at.x + (dx / dist) * stand, at.z + (dz / dist) * stand);
    } else life.walkTo(p, m.doorX, m.doorZ);
    life.lookAt(p, at.x, at.z);
  }

  /** The officer over to the driver (or the car), a word, then back in and off; the tow's asked for. */
  private messStatement(m: Mess, dt: number): void {
    const life = this.life;
    const o = m.patrol?.out() ?? null;
    if (!o) {
      // The patrol's gone (lost, or the officer's down): nobody to take it.
      if (!m.patrol) this.messPhase(m, 'tow');
      return;
    }
    const p = m.driver;
    const tx = p ? p.agent.s.x : m.doorX;
    const tz = p ? p.agent.s.z : m.doorZ;
    if (p) {
      life.walkTo(p, p.agent.s.x, p.agent.s.z);
      life.lookAt(p, o.agent.s.x, o.agent.s.z);
    }
    life.lookAt(o, tx, tz);
    if (len2(o.agent.s.x - tx, o.agent.s.z - tz) > 2.4 && m.timer < MESS_NO_POLICE) {
      life.walkTo(o, tx, tz);
      return;
    }
    life.walkTo(o, o.agent.s.x, o.agent.s.z);
    if ((m.word += dt) < WORD) return;
    m.patrol!.leave();
    this.messPhase(m, 'tow');
  }

  /** The tow asked for (again while none's free), the driver waiting by their car; over once it's taken. */
  private messTow(m: Mess, dt: number, moved: boolean): boolean {
    const life = this.life;
    const car = m.car;
    if (!m.towed && (m.towAsk -= dt) <= 0) {
      m.towAsk = TOW_ASK_EVERY;
      const link = life.d.follow?.('tow', car.sim.x, car.sim.z, m.cause) ?? null;
      if (link) {
        m.cause = link;
        m.towed = true;
      }
    }
    const p = m.driver;
    if (p) {
      life.walkTo(p, m.doorX, m.doorZ);
      life.lookAt(p, car.sim.x, car.sim.z);
    }
    // On the hook (or gone off on its own), or nobody came: the driver walks off, the patrol finishes leaving.
    const over = (m.towed && (moved || !car.towable)) || m.timer > (m.towed ? TOW_WAIT * 2 : TOW_WAIT);
    if (!over) return true;
    if (p) {
      handBack(life, p);
      m.driver = null;
    }
    return m.patrol !== null;
  }

  private messPhase(m: Mess, phase: MessPhase): void {
    m.phase = phase;
    m.timer = 0;
    m.word = 0;
    m.towAsk = 0;
  }

  /** Hand everything back (`now`: a fresh run, people off the street at once). */
  private dropMess(m: Mess, now: boolean): void {
    const life = this.life;
    m.block.clear();
    const car = m.car;
    if (car.scene === this.held) life.release(car);
    const p = m.driver;
    if (p && life.present(p)) {
      if (now) life.removePed(p);
      else handBack(life, p);
    }
    m.driver = null;
    if (m.patrol) {
      // Mid-call: stood down at once on a fresh run; else it finishes leaving by itself.
      if (now) m.patrol.end();
      else {
        m.patrol.leave();
        this.leaving.push(m.patrol);
      }
    }
    m.patrol = null;
  }

  /** A car with the one it'll hit just ahead in its lane, both calm traffic, mid-block, in range. */
  private findPair(): [Vehicle, Vehicle] | null {
    const life = this.life;
    const vs = life.d.vehicles;
    for (const a of vs) {
      if (!this.free(a) || forwardSpeed(a.sim) < 4) continue;
      const d = life.distance(a.sim.x, a.sim.z);
      if (d < RANGE[0] || d > RANGE[1] || !life.onRoute(a.sim.x, a.sim.z)) continue;
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
      !life.keeps(v)
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
    c.cause = life.chain(null, 'accident', (a.x + b.x) / 2, (a.z + b.z) / 2);
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
      if (c.cause) c.cause = life.chain(c.cause, 'patrol', c.x, c.z);
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
