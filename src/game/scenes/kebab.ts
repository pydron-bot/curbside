/**
 * Kebab chucking-out time. Round 2 a.m. in the Neon Mile or Cobble Row
 * (systems/incidents.ts kebabTime), a kebab shop with its neon on near
 * the player spills out: people come out of the door in ones and twos
 * (`kebab`), stand about on the pavement swaying, staggering and singing
 * (a cheer now and then), and a few drift to the kerb to queue for a taxi
 * (a Gathering line along the kerb). A taxi (one in traffic close by,
 * else one brought in: ServiceRun) pulls up every 10–18 s and takes the
 * front of the queue or two. A little way in, two of them have words,
 * face to face, a step in and a step back; 45% of the time it comes to
 * blows (Fights.start: the shove, the fists and a ring of onlookers).
 * Then they drift off home as passers-by.
 *
 * Joining in: walk into it (they're drunk: shove one and it kicks off as
 * any scuffle), pile into the fight, or drive through the taxi queue.
 * Holds: HOLD below (one place).
 */
import { LOUD, type SceneHold } from '../../systems/cityScenes';
import {
  KEBAB_ARGUE,
  KEBAB_ARGUE_AT,
  KEBAB_BLOWS,
  KEBAB_CLOCK,
  KEBAB_SECONDS,
  KEBAB_DISTRICTS,
  TAXI_EVERY,
  TAXI_QUEUE,
  kebabPhase,
  kebabTarget,
  kebabTime,
  kerbOf,
  type Kerb,
} from '../../systems/incidents';
import { busDoor } from '../../systems/streetPeople';
import { districtAt } from '../../world/districts';
import type { ShopSpot } from '../../world/shopSpots';
import { trafficPaint, type CrowdPed } from '../population';
import { watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { labelMembers, secs, type LabelSink } from '../debugLabels';
import type { Fights } from './fights';
import { Gathering } from './gathering';
import { handBack, letGo, roomFor, streetBody } from './people';
import { ServiceRun, type ServiceSpec } from './service';
import { len2 } from '../../core/len';

/** The argument can come to blows: held off by anything loud. */
const HOLD: readonly SceneHold[] = LOUD;
/** The shop is picked this far from the player, m. */
const PICK = [18, 90] as const;
/** Out the door every this long while it's spilling, s. */
const OUT_EVERY = [1.6, 3.4] as const;
/** People stand about within this of the shop's front, m; pick a new spot to sway to every so often, s. */
const MILL_ALONG = 3.5;
const MILL_OUT = [0.8, 2.4] as const;
const MILL_EVERY = [2, 4.5] as const;
/** Chance per second each one staggers, sings (a cheer). */
const STAGGER_RATE = 0.22;
const SING_RATE = 0.08;
/** Share of those out who want a taxi. */
const TAXI_SHARE = 0.4;
/** Drift home one every this long once it's draining, s. */
const DRAIN_EVERY = 2.2;
/** Getting into the taxi: give up walking to the door after this long (in they go anyway), s. */
const BOARD_GIVE_UP = 8;

const TAXI: ServiceSpec = {
  archetype: 'taxi',
  paint: '#e8b923',
  claimRange: 130,
  cruise: 12,
  top: 17,
  arrive: 9,
  timeout: 40,
  aheadShare: 0.6,
};

interface Drunk {
  ped: CrowdPed;
  gx: number;
  gz: number;
  /** Seconds to the next spot to sway to. */
  next: number;
}

interface Argument {
  a: CrowdPed;
  b: CrowdPed;
  timer: number;
  length: number;
  blows: boolean;
}

export interface Kebab {
  spot: ShopSpot;
  kerb: Kerb;
  age: number;
  length: number;
  drunks: Drunk[];
  queue: Gathering;
  argument: Argument | null;
  argued: boolean;
  outIn: number;
  taxi: ServiceRun | null;
  taxiIn: number;
  /** Who's walking to the taxi's door, and how long they've been at it. */
  boarding: CrowdPed | null;
  boardT: number;
  drainIn: number;
}

export class Kebabs implements Scene {
  readonly kind = 'kebab';
  readonly list: Kebab[] = [];
  private scan = 0;
  private readonly door = { x: 0, z: 0 };
  private seekX = 0;
  private seekZ = 0;
  private readonly pickable = (i: number): boolean => {
    const s = this.life.streetMood.spots[i];
    if (!s.neon || !KEBAB_DISTRICTS.includes(s.district)) return false;
    const d = len2(s.x - this.seekX, s.z - this.seekZ);
    return d > PICK[0] && !this.life.crowded(s.x, s.z, 3);
  };

  constructor(
    private readonly life: SceneCtx,
    private readonly fights: Fights,
  ) {
    life.clock.define('kebab', { ...KEBAB_CLOCK, hold: HOLD });
  }

  get running(): number {
    return this.list.length;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 1;
      if (life.due('kebab', this.list.length)) this.look();
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.stepOne(this.list[i], dt)) continue;
      this.end(this.list[i]);
      this.list.splice(i, 1);
    }
  }

  reset(): void {
    for (const k of this.list) this.end(k);
    this.list.length = 0;
  }

  describe(out: LabelSink): void {
    for (const k of this.list) {
      if (out.wants(k.spot.x, k.spot.z)) out.spot(k.spot, `KEBAB (${kebabPhase(k.age, k.length)} ${secs(k.length - k.age)})`, 'people');
      for (const d of k.drunks) if (out.wants(d.ped.agent.s.x, d.ped.agent.s.z)) out.ped(d.ped, 'DRUNK', 'people');
      if (k.argument) {
        out.ped(k.argument.a, 'DRUNK (arguing)', 'people');
        out.ped(k.argument.b, 'DRUNK (arguing)', 'people');
      }
      labelMembers(out, k.queue.members, 'TAXI QUEUE', true);
      if (k.boarding) out.ped(k.boarding, 'GETTING A CAB', 'people');
      if (k.taxi) out.car(k.taxi.v, k.taxi.phase === 'drive' ? 'TAXI → kebab' : 'TAXI', 'traffic');
    }
  }

  /** The shop's front (the argument once it's on). */
  subject(out: Subject): boolean {
    const k = this.list[0];
    if (!k) return false;
    const a = k.argument;
    if (a) return watch(out, (a.a.agent.s.x + a.b.agent.s.x) / 2, (a.b.agent.s.z + a.a.agent.s.z) / 2);
    return watch(out, k.spot.x + k.spot.outX * 2, k.spot.z + k.spot.outZ * 2);
  }

  /** Debug (TEST menu) and the title's show: the nearest lit shopfront spills out now, whatever the hour, a few out already. */
  force(): boolean {
    const life = this.life;
    if (this.list.length > 0) return false;
    const at = life.d.focus();
    const spots = life.streetMood.spots;
    const i = life.streetMood.grid.nearest(at.x, at.z, 90, (j) => spots[j].neon && life.distance(spots[j].x, spots[j].z) > 8);
    if (i < 0) return false;
    const k = this.start(spots[i]);
    for (let n = 0; n < 4; n++) this.comeOut(k);
    // Words in a few seconds.
    k.age = k.length * KEBAB_ARGUE_AT - 3;
    return true;
  }

  // --- Internals ---

  private look(): void {
    const life = this.life;
    const at = life.d.focus();
    const hour = life.d.hour?.() ?? life.d.mood?.hour ?? 13;
    if (!kebabTime(hour, districtAt(at.x, at.z)) || !roomFor(life, 6)) {
      life.clock.defer('kebab', life.now, 10);
      return;
    }
    this.seekX = at.x;
    this.seekZ = at.z;
    const i = life.streetMood.grid.nearest(at.x, at.z, PICK[1], this.pickable);
    if (i < 0) {
      life.clock.defer('kebab', life.now, 8);
      return;
    }
    this.start(life.streetMood.spots[i]);
  }

  private start(spot: ShopSpot): Kebab {
    const life = this.life;
    life.clock.start('kebab', life.now);
    const rand = life.d.rand;
    const kerb = kerbOf(spot.x, spot.z, spot.outX, spot.outZ, { x: 0, z: 0, laneX: 0, laneZ: 0, heading: 0 });
    // The taxi queue: along the kerb a pace apart, facing the road.
    const queue = new Gathering(life, {
      kind: 'crowd',
      capacity: TAXI_QUEUE,
      draw: 0,
      joinChance: 0,
      stay: [1e6, 1e6],
      place: (i, out) => {
        out.x = kerb.x + spot.alongX * (2 + i * 0.95) - spot.outX * 0.3;
        out.z = kerb.z + spot.alongZ * (2 + i * 0.95) - spot.outZ * 0.3;
        out.heading = Math.atan2(spot.outX, spot.outZ);
        return out;
      },
    });
    const k: Kebab = {
      spot,
      kerb,
      age: 0,
      length: KEBAB_SECONDS[0] + rand() * (KEBAB_SECONDS[1] - KEBAB_SECONDS[0]),
      drunks: [],
      queue,
      argument: null,
      argued: false,
      outIn: 0,
      taxi: null,
      taxiIn: TAXI_EVERY[0],
      boarding: null,
      boardT: 0,
      drainIn: DRAIN_EVERY,
    };
    this.list.push(k);
    life.emit('kebab', spot.x, spot.z);
    return k;
  }

  /** One out of the door (in the doorway, then off to sway about). */
  private comeOut(k: Kebab): void {
    const life = this.life;
    const s = k.spot;
    const rand = life.d.rand;
    const along = (rand() - 0.5) * 1.2;
    const c = life.addPed(s.x - s.outX * 0.4 + s.alongX * along, s.z - s.outZ * 0.4 + s.alongZ * along, Math.atan2(s.outX, s.outZ), undefined, streetBody(life, true));
    c.agent.street = true;
    // Drunk: anyone shoved squares up.
    c.agent.temper = rand() < 0.5 ? 'fighter' : 'calm';
    if (rand() < TAXI_SHARE && k.queue.add(c)) return;
    const d: Drunk = { ped: c, gx: 0, gz: 0, next: 0 };
    this.mill(k, d);
    k.drunks.push(d);
  }

  /** A new spot on the pavement out front to sway over to. */
  private mill(k: Kebab, d: Drunk): void {
    const rand = this.life.d.rand;
    const s = k.spot;
    const along = (rand() * 2 - 1) * MILL_ALONG;
    const out = MILL_OUT[0] + rand() * (MILL_OUT[1] - MILL_OUT[0]);
    d.gx = s.x + s.alongX * along + s.outX * out;
    d.gz = s.z + s.alongZ * along + s.outZ * out;
    d.next = MILL_EVERY[0] + rand() * (MILL_EVERY[1] - MILL_EVERY[0]);
  }

  /** One shop's step; false when it's over. */
  private stepOne(k: Kebab, dt: number): boolean {
    const life = this.life;
    const rand = life.d.rand;
    k.age += dt;
    const phase = kebabPhase(k.age, k.length);
    // Out of the door, up to how many there should be by now.
    const out = k.drunks.length + k.queue.members.length + (k.argument ? 2 : 0);
    if (phase !== 'drain' && (k.outIn -= dt) <= 0) {
      k.outIn = OUT_EVERY[0] + rand() * (OUT_EVERY[1] - OUT_EVERY[0]);
      if (out < kebabTarget(k.age, k.length) && roomFor(life, 1) && life.lively('kebab')) {
        this.comeOut(k);
        if (out === 0) life.emit('kebab', k.spot.x, k.spot.z);
      }
    }
    // Swaying about.
    for (let i = k.drunks.length - 1; i >= 0; i--) {
      const d = k.drunks[i];
      const a = d.ped.agent;
      if (!life.present(d.ped) || !a.scene || a.mode === 'down' || a.mode === 'flee' || a.mode === 'fight' || a.mode === 'shoot') {
        // Knocked about, scared off or provoked: theirs to sort out (the knocked out wait for the ambulance).
        letGo(life, d.ped);
        k.drunks.splice(i, 1);
        continue;
      }
      if ((d.next -= dt) <= 0) this.mill(k, d);
      life.walkTo(d.ped, d.gx, d.gz);
      life.lookAt(d.ped, k.spot.x + k.spot.outX * 6, k.spot.z + k.spot.outZ * 6);
      if (a.stagger <= 0 && rand() < STAGGER_RATE * dt) {
        // A lurch sideways along the pavement.
        const side = rand() < 0.5 ? -1 : 1;
        a.stagger = 0.35;
        a.s.vx = k.spot.alongX * side * 1.4;
        a.s.vz = k.spot.alongZ * side * 1.4;
      } else if (rand() < SING_RATE * dt) d.ped.model.cheer(1.6);
    }
    k.queue.step(dt);
    this.stepTaxi(k, dt);
    this.stepArgument(k, dt);
    if (phase === 'drain' && (k.drainIn -= dt) <= 0) {
      // Home time: one wanders off.
      k.drainIn = DRAIN_EVERY;
      const d = k.drunks.pop();
      if (d) life.giveBack(d.ped);
    }
    if (k.age < k.length) return true;
    // Done once the last of them has gone (or it's run well over).
    return (k.drunks.length > 0 || k.queue.members.length > 0) && k.age < k.length + 20;
  }

  /** Two of them have words; maybe it comes to blows. */
  private stepArgument(k: Kebab, dt: number): void {
    const life = this.life;
    const rand = life.d.rand;
    if (!k.argued && k.age > k.length * KEBAB_ARGUE_AT && k.drunks.length >= 2) {
      k.argued = true;
      const a = k.drunks.pop()!.ped;
      const b = k.drunks.pop()!.ped;
      k.argument = { a, b, timer: 0, length: KEBAB_ARGUE[0] + rand() * (KEBAB_ARGUE[1] - KEBAB_ARGUE[0]), blows: rand() < KEBAB_BLOWS };
      life.emit('kebab', k.spot.x, k.spot.z);
    }
    const g = k.argument;
    if (!g) return;
    g.timer += dt;
    const sa = g.a.agent;
    const sb = g.b.agent;
    const over = !life.present(g.a) || !life.present(g.b) || sa.mode === 'down' || sb.mode === 'down' || sa.mode === 'flee' || sb.mode === 'flee' || sa.mode === 'fight' || sb.mode === 'fight';
    if (over) {
      // Someone else's now (the player waded in, a car went through): let go as they are.
      letGo(life, g.a);
      letGo(life, g.b);
      k.argument = null;
      return;
    }
    // Face to face out front, jabbing fingers: a step in, a step back.
    const s = k.spot;
    const cx = s.x + s.outX * 2;
    const cz = s.z + s.outZ * 2;
    const beat = Math.floor(g.timer / 1.2) % 4;
    const ia = beat === 1 ? 0.45 : 0.95;
    const ib = beat === 3 ? 0.45 : 0.95;
    life.walkTo(g.a, cx - s.alongX * ia, cz - s.alongZ * ia);
    life.walkTo(g.b, cx + s.alongX * ib, cz + s.alongZ * ib);
    life.lookAt(g.a, sb.s.x, sb.s.z);
    life.lookAt(g.b, sa.s.x, sa.s.z);
    if (beat === 1 && g.timer % 1.2 < dt) g.a.model.hail(0.6);
    if (g.timer < g.length) return;
    k.argument = null;
    if (g.blows) {
      // To blows: a scuffle like any other (the shove, fists, a ring watching).
      this.fights.start(g.a, g.b).plan.backsDown = false;
      return;
    }
    // Words only: back to swaying about.
    for (const c of [g.a, g.b]) {
      const d: Drunk = { ped: c, gx: 0, gz: 0, next: 0 };
      this.mill(k, d);
      k.drunks.push(d);
    }
  }

  /** The cabs: one comes for the queue, takes the front one (or two), and off it goes. */
  private stepTaxi(k: Kebab, dt: number): void {
    const life = this.life;
    if (!k.taxi) {
      if (k.queue.members.length === 0 || (k.taxiIn -= dt) > 0) return;
      k.taxi = ServiceRun.call(life, { ...TAXI, paint: trafficPaint('taxi', life.d.rand) }, k.kerb.laneX, k.kerb.laneZ);
      k.taxiIn = TAXI_EVERY[0] + life.d.rand() * (TAXI_EVERY[1] - TAXI_EVERY[0]);
      return;
    }
    const run = k.taxi;
    const phase = run.step(dt);
    if (phase === 'done' || phase === 'failed') {
      k.taxi = null;
      if (k.boarding) this.boarded(k, false);
      return;
    }
    if (phase !== 'onSite') return;
    const v = run.v.sim;
    if (!k.boarding) {
      const front = k.queue.members[0];
      if (!front || run.site > 12) {
        run.leave();
        return;
      }
      k.queue.release(front);
      k.boarding = front;
      k.boardT = 0;
    }
    const c = k.boarding;
    if (!life.present(c) || c.agent.mode === 'down') {
      this.boarded(k, false);
      return;
    }
    // The kerbside back door.
    const door = busDoor(v.x, v.z, v.heading, v.body?.reach ?? 2.3, v.body?.halfWidth ?? 0.95, false, this.door);
    life.walkTo(c, door.x, door.z);
    if (len2(c.agent.s.x - door.x, c.agent.s.z - door.z) < 1.1 || (k.boardT += dt) > BOARD_GIVE_UP) {
      this.boarded(k, true);
      // A second one squeezes in half the time; else it's off.
      if (k.queue.members.length === 0 || life.d.rand() < 0.5) run.leave();
    }
  }

  private boarded(k: Kebab, inCab: boolean): void {
    const c = k.boarding;
    k.boarding = null;
    if (!c) return;
    if (inCab) this.life.removePed(c);
    else handBack(this.life, c);
  }

  /** Over: everyone still out walks off home; the taxi goes back to traffic. */
  private end(k: Kebab): void {
    const life = this.life;
    for (const d of k.drunks) handBack(life, d.ped);
    k.drunks.length = 0;
    k.queue.close();
    if (k.argument) {
      handBack(life, k.argument.a);
      handBack(life, k.argument.b);
      k.argument = null;
    }
    if (k.boarding) this.boarded(k, false);
    k.taxi?.end();
    k.taxi = null;
  }
}
