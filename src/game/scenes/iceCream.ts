/**
 * The ice cream van's stops. An ice cream van near the player (one in
 * traffic, or one that comes round now and then) pulls in at the kerb
 * mid-block every so often, by a park or an open plaza when it's passing
 * one (now and then anywhere), and opens its hatch: the jingle plays (the
 * `iceCream` street event; StreetLife chimes as it tours too), and people
 * walking by cross over and queue at the hatch on the pavement side (a
 * Gathering queue). The one at the front is served every few seconds and
 * walks off pleased (a little cheer, `iceCreamServed`); the rest shuffle
 * up. Now and then someone pushes in and it kicks off (Fights.queueJump).
 * After a while it shuts and drives on.
 */
import type { VehicleControls } from '../../entities/vehicle';
import { IN_PLAY } from '../../systems/cityScenes';
import { blockAt } from '../../systems/crowd';
import type { Obstacle } from '../../systems/traffic';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, ROAD_WIDTH, SIDEWALK, isCarPark, lotBytes } from '../../world/city';
import { dirHeading, type Dir } from '../../world/roads';
import { BUS_PULL_IN, roadPoint, segmentValid } from '../../world/streetSpots';
import type { SceneDriver, Vehicle } from '../population';
import { SCENE_RANGE, watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { secs, labelMembers, type LabelSink } from '../debugLabels';
import type { Fights } from './fights';
import { Gathering } from './gathering';
import { roomFor, streetBody } from './people';
import { holdStill, pullIn, stopped } from './service';

/** Open this long, s (shuts early once nobody's left after OPEN_MIN). */
const OPEN_FOR = 40;
const OPEN_MIN = 16;
/** One served every this many seconds. */
export const SERVE_EVERY = 3.2;
/** Most in the queue. */
export const QUEUE_MAX = 6;
/** Between stops, s. */
const BETWEEN = [30, 60] as const;
/** Only stops this close to the player (someone should see it), m. */
const SHOW_RANGE = 110;
/** Chance it stops beside a block that isn't a park or plaza (once it's due). */
const PLAIN_STOP = 0.25;
/** Chance per second someone pushes in at a queue of three or more. */
const JUMP_CHANCE = 0.02;
const PULL_SPEED = 7;
/** Gives up pulling in (blocked) after, s. */
const PULL_GIVE_UP = 15;
const VAN_PAINTS = ['#f7c6d9', '#bfe8d8', '#f5ead0', '#c9dcf5'];

type Phase = 'drive' | 'pull' | 'open';

interface Van {
  v: Vehicle;
  phase: Phase;
  /** Where it's pulling in to. */
  x: number;
  z: number;
  heading: number;
  timer: number;
  /** Sim time it may stop again. */
  next: number;
  queue: Gathering;
}

export class IceCream implements Scene {
  readonly kind = 'iceCream';
  readonly vans: Van[] = [];
  private scan = 0;
  /** The van force() put down (the title's highlight watches it, not one adopted from traffic). */
  private forced: Van | null = null;
  private readonly left = { m: 0 };
  private readonly p = { x: 0, z: 0 };
  private readonly driver: SceneDriver;
  /** Per block (bx * BLOCKS_PER_SIDE + bz): a park or an open plaza (something to stop by). */
  private readonly nice: Uint8Array;

  constructor(
    private readonly life: SceneCtx,
    private readonly fights: Fights,
  ) {
    life.clock.define('iceCream', { every: [90, 180], cap: 1, first: 45, range: SHOW_RANGE, hold: IN_PLAY });
    this.driver = { drive: (v, obstacles) => this.drive(v, obstacles) };
    const city = life.d.city;
    const bytes = lotBytes(city);
    this.nice = new Uint8Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
    city.blocks.forEach((b, i) => {
      if (b.kind === 'park' || (b.kind === 'plaza' && !isCarPark(city, bytes, i))) this.nice[b.bx * BLOCKS_PER_SIDE + b.bz] = 1;
    });
  }

  get running(): number {
    return this.vans.length;
  }

  step(dt: number): void {
    const life = this.life;
    const scan = (this.scan -= dt) <= 0;
    if (scan) {
      this.scan = 1;
      this.adopt();
    }
    for (let i = this.vans.length - 1; i >= 0; i--) {
      const van = this.vans[i];
      if (life.lost(van.v) || van.v.scene !== this.driver) {
        this.untrack(van);
        this.vans.splice(i, 1);
        continue;
      }
      if (van.phase === 'drive') {
        if (scan) this.maybeStop(van);
        if (life.distance(van.v.sim.x, van.v.sim.z) > SCENE_RANGE + 40) {
          this.untrack(van);
          this.vans.splice(i, 1);
        }
      } else if (van.phase === 'pull' && (van.timer += dt) > PULL_GIVE_UP) van.phase = 'drive';
      else if (van.phase === 'open') this.serve(van, dt, scan);
    }
  }

  reset(): void {
    for (const van of this.vans) this.untrack(van);
    this.vans.length = 0;
    this.forced = null;
  }

  describe(out: LabelSink): void {
    for (const van of this.vans) {
      const v = van.v;
      if (out.wants(v.sim.x, v.sim.z)) out.car(v, van.phase === 'open' ? `ICE CREAM (open ${secs(OPEN_FOR - van.timer)})` : van.phase === 'pull' ? 'ICE CREAM (pulling in)' : 'ICE CREAM', 'traffic');
      labelMembers(out, van.queue.members, 'QUEUE', true);
    }
  }

  /** The van force() put down, while it's open; nothing once it drives on. */
  subject(out: Subject): boolean {
    const van = this.forced;
    if (!van || !this.vans.includes(van) || van.phase === 'drive') return false;
    const s = van.v.sim;
    return watch(out, s.x, s.z, s.vx, s.vz);
  }

  /** Debug (__ub) and the title's highlights: a van put down at the kerb near the player, open, with a few already queueing. */
  force(): boolean {
    const life = this.life;
    const p = life.d.focus();
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    let bh = 0;
    for (let ix = Math.round(p.x / BLOCK_SIZE) - 1; ix <= Math.round(p.x / BLOCK_SIZE) + 1; ix++)
      for (let iz = Math.round(p.z / BLOCK_SIZE) - 1; iz <= Math.round(p.z / BLOCK_SIZE) + 1; iz++)
        for (let dir = 0 as Dir; dir < 4; dir++) {
          if (!segmentValid(ix, iz, dir)) continue;
          const at = roadPoint(ix, iz, dir, 30, BUS_PULL_IN, this.p);
          const d = Math.hypot(at.x - p.x, at.z - p.z);
          if (d < 10 || d > best) continue;
          best = d;
          bx = at.x;
          bz = at.z;
          bh = dirHeading(dir);
        }
    if (best === Infinity) return false;
    const v = life.placeCar('ice_cream_van', VAN_PAINTS[0], bx, bz, bh);
    const van = this.track(v, 0);
    van.x = bx;
    van.z = bz;
    van.heading = bh;
    this.open(van);
    this.forced = van;
    for (let i = 0; i < 3; i++) {
      const c = life.addPed(bx - Math.cos(bh) * 4 + (life.d.rand() - 0.5) * 4, bz + Math.sin(bh) * 4 + (life.d.rand() - 0.5) * 4, 0, undefined, streetBody(life));
      c.agent.street = true;
      van.queue.add(c);
    }
    return true;
  }

  private drive(v: Vehicle, obstacles: Obstacle[]): VehicleControls | null {
    if (v.pursuit || !v.ai) return null;
    const van = this.vanOf(v);
    if (!van || van.phase === 'drive') return null;
    if (van.phase === 'open') return holdStill(v.sim);
    const c = pullIn(v.sim, van.x, van.z, van.heading, PULL_SPEED, obstacles, this.left);
    if (this.left.m < 0.6 && stopped(v.sim, 0.5)) this.open(van);
    else if (this.left.m < -4) van.phase = 'drive';
    return c;
  }

  private vanOf(v: Vehicle): Van | null {
    for (const van of this.vans) if (van.v === v) return van;
    return null;
  }

  private adopt(): void {
    const life = this.life;
    const p = life.d.player;
    for (const v of life.d.vehicles) {
      if (v.archetype !== 'ice_cream_van' || !v.ai || v.scene || v.police || v.pursuit || v === p.driving || life.keeps(v)) continue;
      if (life.distance(v.sim.x, v.sim.z) > SCENE_RANGE) continue;
      this.track(v, life.now + 10);
    }
    if (this.vans.length > 0 || !life.due('iceCream', 0)) return;
    const v = life.spawnCar('ice_cream_van', VAN_PAINTS[Math.floor(life.d.rand() * VAN_PAINTS.length)], 0.7);
    if (!v) {
      life.clock.defer('iceCream', life.now, 4);
      return;
    }
    life.clock.start('iceCream', life.now);
    // Brought in to be seen: it stops soon after it arrives.
    this.track(v, life.now + 6);
  }

  private track(v: Vehicle, next: number): Van {
    v.scene = this.driver;
    const queue = new Gathering(this.life, { kind: 'queue', capacity: QUEUE_MAX, draw: 28, joinChance: 0.45, serveEvery: SERVE_EVERY, side: 2.2 });
    const van: Van = { v, phase: 'drive', x: 0, z: 0, heading: 0, timer: 0, next, queue };
    this.vans.push(van);
    return van;
  }

  private untrack(van: Van): void {
    van.queue.close();
    if (van.v.scene === this.driver) van.v.scene = null;
  }

  /** Mid-block near the player, beside a park or plaza (now and then anywhere), the kerb ahead clear: pull in a little way on. */
  private maybeStop(van: Van): void {
    const life = this.life;
    const v = van.v;
    const ai = v.ai;
    if (!ai || ai.phase !== 'approach' || life.now < van.next) return;
    if (life.distance(v.sim.x, v.sim.z) > SHOW_RANGE) return;
    // How far before the node it's driving to: room to stop mid-block, clear of the junction.
    const along = Math.abs(ai.ix * BLOCK_SIZE - v.sim.x) + Math.abs(ai.iz * BLOCK_SIZE - v.sim.z);
    if (along < 34 || along > 56) return;
    const stopAt = along - 14;
    // The block on the kerb side.
    const side = roadPoint(ai.ix, ai.iz, ai.dir, stopAt, ROAD_WIDTH / 2 + SIDEWALK + 4, this.p);
    const b = blockAt(side.x, side.z);
    if (!this.nice[b.bx * BLOCKS_PER_SIDE + b.bz] && life.d.rand() > PLAIN_STOP) {
      van.next = life.now + 8;
      return;
    }
    const p = roadPoint(ai.ix, ai.iz, ai.dir, stopAt, BUS_PULL_IN, this.p);
    if (life.crowded(p.x, p.z, 4.5)) return;
    van.phase = 'pull';
    van.timer = 0;
    van.x = p.x;
    van.z = p.z;
    // Along the lane, not the van's exact heading.
    van.heading = dirHeading(ai.dir);
  }

  private open(van: Van): void {
    van.phase = 'open';
    van.timer = 0;
    const s = van.v.sim;
    van.queue.at(s.x, s.z, s.heading);
    this.life.emit('iceCream', s.x, s.z);
  }

  private serve(van: Van, dt: number, scan: boolean): void {
    const life = this.life;
    const q = van.queue;
    van.timer += dt;
    // Calm people walking by come over (not in the last few seconds).
    if (scan && van.timer < OPEN_FOR - 6 && life.lively('iceCream') && roomFor(life, 2)) q.recruit();
    const served = q.step(dt);
    if (served) {
      served.model.cheer(1.2);
      life.emit('iceCreamServed', served.agent.s.x, served.agent.s.z);
    }
    // Someone pushes in at the front: words, and maybe more.
    if (q.members.length >= 3 && life.d.rand() < JUMP_CHANCE * dt) {
      const front = q.members[0];
      const jumper = q.members[q.members.length - 1];
      if (jumper.agent.temper !== 'calm' || life.d.rand() < 0.5) {
        q.release(front);
        q.release(jumper);
        if (!this.fights.queueJump(jumper, front)) {
          life.giveBack(front);
          life.giveBack(jumper);
        }
      }
    }
    if (van.timer > OPEN_FOR || (van.timer > OPEN_MIN && q.members.length === 0)) {
      q.close();
      van.phase = 'drive';
      van.next = life.now + BETWEEN[0] + life.d.rand() * (BETWEEN[1] - BETWEEN[0]);
    }
  }
}
