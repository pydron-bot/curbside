/**
 * The cash-in-transit van. By day (systems/incidents.ts CASH_HOURS) an
 * armoured van in its livery (an ordinary `van`, painted: no new model)
 * is brought into traffic near the player and does its rounds: three
 * times it pulls in at the kerb mid-block, hazards on, and a guard in a
 * helmet steps out of the back (`cashRun`), carries the box to the shop
 * door, waits inside a moment and carries it back; then on to the next.
 *
 * Joining in: knock the guard down while he has the box, ram the van till
 * it's broken open (under 45% health, wrecked or burning), or drive off in
 * it, and cash spills (`cashSpill`): bundles in the road (5 from the van,
 * 2 from the box), the `cash` model in a pulsing green ring, 40 s each.
 * Walk or drive over one to take it ($30–70 each, deps.reward), CASH GRAB
 * on the score (deps.award) when the player did it. Then the guards (the
 * one carrying and his mate from the cab) come after you with their fists
 * for 18 s, and it's called in (about a star's worth: deps.callIn).
 * Holds: HOLD below.
 */
import { LOUD, type SceneHold } from '../../systems/cityScenes';
import {
  CASH_GUARD_BUNDLES,
  CASH_HOURS,
  CASH_PICK_CAR,
  CASH_PICK_FOOT,
  CASH_STOPS,
  CASH_CLOCK,
  CASH_VALUE,
  CASH_VAN_BUNDLES,
  CashBundles,
  GUARD_CHASE,
  ROBBERY_CALL,
  carrying,
  cashSpill,
  inHours,
  robbedByPlayer,
  scatter,
  stepCashTrip,
  type CashTrip,
  type RobberySense,
} from '../../systems/incidents';
import { resumeWalking } from '../../systems/crowd';
import { blamesPlayer } from '../../systems/damage';
import type { Obstacle } from '../../systems/traffic';
import type { VehicleControls } from '../../entities/vehicle';
import { BLOCK_SIZE, ROAD_WIDTH, SIDEWALK } from '../../world/city';
import { dirHeading, type Dir } from '../../world/roads';
import { BUS_PULL_IN, roadPoint, segmentValid } from '../../world/streetSpots';
import type { CrowdPed, SceneDriver, Vehicle } from '../population';
import { SCENE_RANGE, watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { secs, type LabelSink } from '../debugLabels';
import { handBack, roomFor, streetBody } from './people';
import { holdStill, pullIn, stopped } from './service';
import { len2 } from '../../core/len';

/** A van in the road and guards with their fists up: held off by anything loud. */
const HOLD: readonly SceneHold[] = LOUD;
/** The armoured van's livery (a tint on the ordinary van). */
export const CASH_PAINT = '#4a5560';
export const GUARD = { shirt: '#30353d', pants: '#22262c', hair: '#d8d4c8', shoes: '#141414' };
/** Between stops, s; pulling in is given up after this long, s. */
const BETWEEN = [10, 18] as const;
const PULL_GIVE_UP = 14;
const PULL_SPEED = 7;
/** The guard counts as there within this, m; a leg wedged this long is skipped, s. */
const REACH = 1.1;
const LEG_GIVE_UP = 10;
/** A round that's taken this long is over (it drives off), s. */
const ROUND_MAX = 200;
/** A knock-down of the player's this close to where the guard fell, this recently, was them, m / s. */
const KNOCK_MATCH = 2;
const KNOCK_RECENT = 1.5;

type Phase = 'drive' | 'pull' | 'stop' | 'robbed' | 'leave';

export interface Round {
  v: Vehicle;
  phase: Phase;
  stops: number;
  /** Sim time it may next stop. */
  next: number;
  age: number;
  timer: number;
  /** The stop: in the lane (x, z, heading), the shop door it serves. */
  x: number;
  z: number;
  heading: number;
  shopX: number;
  shopZ: number;
  guard: CrowdPed | null;
  /** His mate from the cab, out once it's robbed. */
  mate: CrowdPed | null;
  readonly trip: CashTrip;
  /** Robbed by the player: the guards are after them this long still, s. */
  chase: number;
}

export class CashRuns implements Scene {
  readonly kind = 'cashRun';
  readonly rounds: Round[] = [];
  /** The cash in the road (any round's). */
  readonly bundles = new CashBundles();
  private scan = 0;
  private pickScan = 0;
  private readonly p = { x: 0, z: 0 };
  private readonly rear = { x: 0, z: 0 };
  private readonly left = { m: 0 };
  private readonly driver: SceneDriver;
  /** The player's last knock-down (anyone): where and when, to tell whose doing a fallen guard was. */
  private knockX = 0;
  private knockZ = 0;
  private knockAt = -Infinity;

  constructor(private readonly life: SceneCtx) {
    life.clock.define('cashRun', { ...CASH_CLOCK, hold: HOLD });
    this.driver = { drive: (v, obstacles) => this.drive(v, obstacles) };
    life.d.bus.on('pedDown', (e) => {
      if (!e.byPlayer || e.isPlayer) return;
      this.knockX = e.x;
      this.knockZ = e.z;
      this.knockAt = life.now;
    });
  }

  get running(): number {
    return this.rounds.length;
  }

  step(dt: number): void {
    const life = this.life;
    const scan = (this.scan -= dt) <= 0;
    if (scan) {
      this.scan = 1;
      if (life.due('cashRun', this.rounds.length)) this.bringIn();
    }
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      if (this.stepRound(this.rounds[i], dt, scan)) continue;
      this.end(this.rounds[i]);
      this.rounds.splice(i, 1);
    }
    this.bundles.step(life.now);
    if ((this.pickScan -= dt) <= 0) {
      this.pickScan = 0.1;
      this.pickUp();
    }
  }

  reset(): void {
    for (const r of this.rounds) this.end(r);
    this.rounds.length = 0;
    this.bundles.clear();
  }

  describe(out: LabelSink): void {
    for (const r of this.rounds) {
      const v = r.v;
      const what = r.phase === 'stop' ? `CASH VAN (stop ${r.stops + 1}/${CASH_STOPS})` : r.phase === 'robbed' ? 'CASH VAN (robbed)' : r.phase === 'pull' ? 'CASH VAN (pulling in)' : 'CASH VAN';
      if (out.wants(v.sim.x, v.sim.z)) out.car(v, what, 'traffic');
      if (r.guard) out.ped(r.guard, r.chase > 0 ? `GUARD (after you ${secs(r.chase)})` : carrying(r.trip.leg) ? 'GUARD (cash box)' : 'GUARD', 'people');
      if (r.mate) out.ped(r.mate, r.chase > 0 ? 'GUARD (after you)' : 'GUARD', 'people');
    }
    for (const b of this.bundles.list) if (b.alive && out.wants(b.x, b.z)) out.spot(b, `CASH $${b.value}`, 'people');
  }

  /** The van on its round (the guard while he's out). */
  subject(out: Subject): boolean {
    const r = this.rounds[0];
    if (!r || r.phase === 'leave') return false;
    const g = r.guard;
    if (g && r.phase !== 'drive') return watch(out, (g.agent.s.x + r.v.sim.x) / 2, (g.agent.s.z + r.v.sim.z) / 2);
    const s = r.v.sim;
    return watch(out, s.x, s.z, s.vx, s.vz);
  }

  /** Debug (TEST menu) and the title's show: a van put down at the kerb near the player, the guard stepping out. */
  force(): boolean {
    const life = this.life;
    if (this.rounds.length > 0) return false;
    const at = life.d.focus();
    let best = Infinity;
    let pick: [number, number, Dir] | null = null;
    const cx = Math.round(at.x / BLOCK_SIZE);
    const cz = Math.round(at.z / BLOCK_SIZE);
    for (let ix = cx - 1; ix <= cx + 1; ix++)
      for (let iz = cz - 1; iz <= cz + 1; iz++)
        for (let dir = 0 as Dir; dir < 4; dir++) {
          if (!segmentValid(ix, iz, dir)) continue;
          const p = roadPoint(ix, iz, dir, 30, BUS_PULL_IN, this.p);
          const d = len2(p.x - at.x, p.z - at.z);
          if (d < 10 || d > best || life.crowded(p.x, p.z, 4)) continue;
          best = d;
          pick = [ix, iz, dir];
        }
    if (!pick) return false;
    const [ix, iz, dir] = pick;
    const p = roadPoint(ix, iz, dir, 30, BUS_PULL_IN, this.p);
    const v = life.placeCar('van', CASH_PAINT, p.x, p.z, dirHeading(dir));
    const r = this.track(v);
    this.stopAt(r, ix, iz, dir, 30);
    this.arrive(r);
    life.clock.start('cashRun', life.now);
    return true;
  }

  // --- Internals ---

  private bringIn(): void {
    const life = this.life;
    const hour = life.d.hour?.() ?? life.d.mood?.hour ?? 13;
    // The guard and his mate (once it's robbed) come on top of the scenes' people.
    if (!inHours(hour, CASH_HOURS) || !roomFor(life, 2)) {
      life.clock.defer('cashRun', life.now, 15);
      return;
    }
    const v = life.spawnCar('van', CASH_PAINT, 0.7);
    if (!v) {
      life.clock.defer('cashRun', life.now, 4);
      return;
    }
    life.clock.start('cashRun', life.now);
    // Brought in to be seen: its first stop comes soon.
    this.track(v).next = life.now + 5;
  }

  private track(v: Vehicle): Round {
    v.scene = this.driver;
    const r: Round = {
      v,
      phase: 'drive',
      stops: 0,
      next: 0,
      age: 0,
      timer: 0,
      x: 0,
      z: 0,
      heading: 0,
      shopX: 0,
      shopZ: 0,
      guard: null,
      mate: null,
      trip: { leg: 'out', timer: 0 },
      chase: 0,
    };
    this.rounds.push(r);
    return r;
  }

  private drive(v: Vehicle, obstacles: Obstacle[]): VehicleControls | null {
    if (v.pursuit || !v.ai) return null;
    const r = this.roundOf(v);
    if (!r || r.phase === 'drive' || r.phase === 'leave') return null;
    if (r.phase !== 'pull') return holdStill(v.sim);
    const c = pullIn(v.sim, r.x, r.z, r.heading, PULL_SPEED, obstacles, this.left);
    if (this.left.m < 0.6 && stopped(v.sim, 0.5)) this.arrive(r);
    else if (this.left.m < -4) r.phase = 'drive';
    return c;
  }

  private roundOf(v: Vehicle): Round | null {
    for (const r of this.rounds) if (r.v === v) return r;
    return null;
  }

  /** One round's step; false when it's over (and handed back). */
  private stepRound(r: Round, dt: number, scan: boolean): boolean {
    const life = this.life;
    const v = r.v;
    r.age += dt;
    r.timer += dt;
    if (r.phase === 'leave') return false;
    if (r.phase === 'robbed') return this.afterRobbery(r, dt);
    // Done over? The van broken open, the guard flattened with the box, or the van driven off.
    const g = r.guard;
    const taken = v === life.d.player.driving;
    const how = taken
      ? 'van'
      : cashSpill({
          wrecked: v.damage.wrecked,
          burning: v.damage.burning,
          health: v.damage.health / v.damage.maxHealth,
          guardDown: g !== null && life.present(g) && g.agent.mode === 'down',
          // Out of the van he has the box (in his hands, or at the door).
          carrying: g !== null && r.trip.leg !== 'aboard',
        });
    if (how) {
      const s = g?.agent.s;
      this.rob(r, how, {
        taken,
        vanBlamed: blamesPlayer(v.damage, life.now),
        guardByPlayer: s !== undefined && life.now - this.knockAt < KNOCK_RECENT && len2(s.x - this.knockX, s.z - this.knockZ) < KNOCK_MATCH,
      });
      return true;
    }
    if (!v.mesh.root.visible || (v.scene !== this.driver && !taken)) return false;
    switch (r.phase) {
      case 'drive':
        if (r.stops >= CASH_STOPS || r.age > ROUND_MAX) return false;
        if (scan) this.maybeStop(r);
        if (life.distance(v.sim.x, v.sim.z) > SCENE_RANGE + 40) return false;
        return true;
      case 'pull':
        if (r.timer > PULL_GIVE_UP) r.phase = 'drive';
        return true;
      case 'stop':
        return this.walk(r, dt);
    }
    return true;
  }

  /** At the kerb: the guard's trip in and out with the box; aboard, and on to the next. */
  private walk(r: Round, dt: number): boolean {
    const life = this.life;
    const g = r.guard;
    if (!g || !life.present(g)) {
      this.depart(r);
      return true;
    }
    if (g.agent.mode !== 'arrest' && g.agent.mode !== 'walk') return true;
    const rear = life.rearOf(r.v.sim, this.rear);
    const s = g.agent.s;
    const atShop = len2(s.x - r.shopX, s.z - r.shopZ) < REACH || (r.trip.leg === 'out' && r.trip.timer > LEG_GIVE_UP);
    const atVan = len2(s.x - rear.x, s.z - rear.z) < REACH + 0.3 || (r.trip.leg === 'back' && r.trip.timer > LEG_GIVE_UP);
    const leg = stepCashTrip(r.trip, dt, atShop, atVan);
    if (leg === 'out') life.walkTo(g, r.shopX, r.shopZ);
    else if (leg === 'inside') {
      life.walkTo(g, r.shopX, r.shopZ);
      life.lookAt(g, r.shopX * 2 - r.x, r.shopZ * 2 - r.z);
    } else if (leg === 'back') life.walkTo(g, rear.x, rear.z);
    else {
      life.removePed(g);
      r.guard = null;
      this.depart(r);
    }
    return true;
  }

  /** Back in: on to the next stop (or off, after the last). */
  private depart(r: Round): void {
    r.stops++;
    r.phase = 'drive';
    r.timer = 0;
    r.next = this.life.now + BETWEEN[0] + this.life.d.rand() * (BETWEEN[1] - BETWEEN[0]);
  }

  /** Mid-block on its lane, the kerb ahead clear: pull in a little way on (as the ice cream van does). */
  private maybeStop(r: Round): void {
    const life = this.life;
    const v = r.v;
    const ai = v.ai;
    if (!ai || ai.phase !== 'approach' || life.now < r.next || !roomFor(life, 1)) return;
    const along = Math.abs(ai.ix * BLOCK_SIZE - v.sim.x) + Math.abs(ai.iz * BLOCK_SIZE - v.sim.z);
    if (along < 34 || along > 56) return;
    const stopAt = along - 14;
    const p = roadPoint(ai.ix, ai.iz, ai.dir, stopAt, BUS_PULL_IN, this.p);
    if (life.crowded(p.x, p.z, 4.5)) return;
    this.stopAt(r, ai.ix, ai.iz, ai.dir, stopAt);
    r.phase = 'pull';
    r.timer = 0;
  }

  private stopAt(r: Round, ix: number, iz: number, dir: Dir, along: number): void {
    const p = roadPoint(ix, iz, dir, along, BUS_PULL_IN, this.p);
    r.x = p.x;
    r.z = p.z;
    r.heading = dirHeading(dir);
    // The shop door: across the pavement from the van's back doors.
    const door = roadPoint(ix, iz, dir, along - 2.5, ROAD_WIDTH / 2 + SIDEWALK - 0.5, this.p);
    r.shopX = door.x;
    r.shopZ = door.z;
  }

  /** Pulled in: hazards on, the guard out of the back with the box. */
  private arrive(r: Round): void {
    const life = this.life;
    r.phase = 'stop';
    r.timer = 0;
    const rear = life.rearOf(r.v.sim, this.rear);
    const g = life.addPed(rear.x, rear.z, r.heading + Math.PI, GUARD, streetBody(life, true));
    g.agent.street = true;
    g.agent.temper = 'fighter';
    r.guard = g;
    r.trip.leg = 'out';
    r.trip.timer = 0;
    life.emit('cashRun', rear.x, rear.z);
  }

  /** Done over: the cash goes everywhere, and if it was the player the guards are after them and it's called in. */
  private rob(r: Round, how: 'van' | 'guard', blame: RobberySense): void {
    const life = this.life;
    const rand = life.d.rand;
    const v = r.v;
    const g = r.guard;
    const at = how === 'guard' && g ? g.agent.s : life.rearOf(v.sim, this.rear);
    const x = at.x;
    const z = at.z;
    const n = how === 'van' ? CASH_VAN_BUNDLES : CASH_GUARD_BUNDLES;
    for (let i = 0; i < n; i++) {
      const p = scatter(i, n, x, z, how === 'van' ? 2.2 : 1.2, this.p);
      this.bundles.drop(p.x, p.z, Math.round(CASH_VALUE[0] + rand() * (CASH_VALUE[1] - CASH_VALUE[0])), life.now);
    }
    life.emit('cashSpill', x, z);
    r.phase = 'robbed';
    r.timer = 0;
    // The crew out of the cab (unless it's the player's now), the van left where it stands.
    if (v.scene === this.driver) v.scene = null;
    const pl = life.d.player;
    if (v !== pl.driving && v.ai && !v.damage.wrecked && roomFor(life, 1)) {
      v.ai = null;
      v.towable = true;
      const door = life.doorOf(v.sim);
      r.mate = life.addPed(door.x, door.z, v.sim.heading, GUARD, streetBody(life, true));
      r.mate.agent.street = true;
      r.mate.agent.temper = 'fighter';
    }
    // The player's doing (they took it, rammed or shot it, or flattened the guard): CASH GRAB, the guards after them, and it's called in.
    if (!life.d.playing() || !pl.alive || !robbedByPlayer(how, blame)) return;
    r.chase = GUARD_CHASE;
    life.d.award?.('cashGrab');
    for (const crime of ROBBERY_CALL) life.d.callIn?.(crime);
  }

  /** The guards after the player (fists) a while, then they give up and stand about. */
  private afterRobbery(r: Round, dt: number): boolean {
    const chasing = r.chase > 0;
    r.chase = Math.max(0, r.chase - dt);
    this.guardChase(r.guard, r.chase, chasing);
    this.guardChase(r.mate, r.chase, chasing);
    // Over once the chase is and a few seconds have passed (the cash lies on).
    return r.chase > 0 || r.timer < 6;
  }

  private guardChase(c: CrowdPed | null, left: number, was: boolean): void {
    if (!c || !this.life.present(c)) return;
    const a = c.agent;
    if (a.mode === 'down') return;
    if (left > 0) {
      // Their target is the player (no scene opponent): fists.
      if (a.mode !== 'fight') {
        a.mode = 'fight';
        a.timer = left;
        a.attackCooldown = 0.4;
      }
    } else if (was && a.mode === 'fight') resumeWalking(a);
  }

  /** The player walking or driving over a bundle takes it. */
  private pickUp(): void {
    const life = this.life;
    if (this.bundles.count === 0 || !life.d.playing()) return;
    const p = life.d.player;
    if (!p.alive || p.arrested) return;
    const car = p.driving;
    const b = car ? this.bundles.at(car.sim.x, car.sim.z, CASH_PICK_CAR) : this.bundles.at(p.ped.x, p.ped.z, CASH_PICK_FOOT);
    if (!b) return;
    b.alive = false;
    life.d.reward?.(b.value, 'CASH');
  }

  /** Over: everyone handed back (the guards walk off, the knocked out stay down), the van to traffic. */
  private end(r: Round): void {
    const life = this.life;
    for (const c of [r.guard, r.mate]) {
      if (c && life.present(c)) handBack(life, c);
    }
    r.guard = r.mate = null;
    if (r.v.scene === this.driver) life.release(r.v);
    r.phase = 'leave';
  }
}
