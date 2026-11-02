/**
 * Street performers. Now and then a busker sets up at the edge of an open
 * plaza or a park near the player, facing the pavement, and performs: a
 * looping dance (the Cheer clip, broken up with a wave). Passers-by stop
 * to watch in an arc in front (a Gathering crowd), stay a while and walk
 * on; now and then one tips (a coin flicks into the hat: the look draws a
 * glint from `tips`). After a minute or two the busker packs up and walks
 * off, and the crowd goes with them.
 */
import type { SceneHold } from '../../systems/cityScenes';
import { BLOCK_SIZE, isCarPark, lotBytes } from '../../world/city';
import { blockSide } from '../../world/kerbs';
import type { CrowdPed } from '../population';
import { watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { secs, labelMembers, type LabelSink } from '../debugLabels';
import { Gathering } from './gathering';
import { roomFor, streetBody } from './people';
import { len2 } from '../../core/len';

/** Buskers stand this far in from the road's centreline (on the plaza, clear of the pavement), m. */
const SPOT_INSET = 15;
/** They start this far from the player, m (out of view). */
const START_RING = [25, 90] as const;
/** A set lasts this long, s. */
const SET_SECONDS = [70, 110] as const;
/** Each watcher tips about once in this many seconds. */
const TIP_EVERY = 12;
/** A tip's coin is in the air this long, s. */
export const TIP_FLIGHT = 0.6;
const TIP_MAX = 6;
const OUTFITS = [
  { shirt: '#e8c23a', pants: '#2b2b6b' },
  { shirt: '#c43b8e', pants: '#1d1d1d' },
  { shirt: '#3bb5c4', pants: '#5a3b1d' },
];
const HOLD: readonly SceneHold[] = ['title', 'wanted'];

export interface BuskSpot {
  x: number;
  z: number;
  /** Facing the pavement. */
  heading: number;
}

export interface Tip {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** Seconds since thrown; >= TIP_FLIGHT once landed (the slot's free). */
  age: number;
}

export interface Busker {
  ped: CrowdPed;
  spot: BuskSpot;
  crowd: Gathering;
  until: number;
  /** Seconds into the routine (cheer, then a wave). */
  beat: number;
}

export class Buskers implements Scene {
  readonly kind = 'buskers';
  readonly spots: BuskSpot[] = [];
  readonly buskers: Busker[] = [];
  /** Coins in the air (a fixed pool). */
  readonly tips: Tip[] = [];
  private scan = 0;

  constructor(private readonly life: SceneCtx) {
    life.clock.define('busker', { every: [50, 100], cap: 1, first: 35, range: START_RING[1], hold: HOLD });
    for (let i = 0; i < TIP_MAX; i++) this.tips.push({ fromX: 0, fromZ: 0, toX: 0, toZ: 0, age: TIP_FLIGHT });
    const city = life.d.city;
    const bytes = lotBytes(city);
    city.blocks.forEach((b, i) => {
      if (b.kind === 'buildings' || isCarPark(city, bytes, i)) return;
      for (let side = 0; side < 4; side++) {
        const s = blockSide(b, side);
        for (const t of [BLOCK_SIZE * 0.3, BLOCK_SIZE * 0.7]) {
          const p = s.at(t, SPOT_INSET);
          if (city.trees.some((tr) => len2(tr.x - p.x, tr.z - p.z) < tr.radius + 2)) continue;
          if (life.d.vendors.some((v) => len2(v.x - p.x, v.z - p.z) < 7)) continue;
          this.spots.push({ x: p.x, z: p.z, heading: s.toRoad });
        }
      }
    });
  }

  get running(): number {
    return this.buskers.length;
  }

  step(dt: number): void {
    const life = this.life;
    for (const t of this.tips) if (t.age < TIP_FLIGHT) t.age += dt;
    const tick = (this.scan -= dt) <= 0;
    if (tick) {
      this.scan = 1;
      if (life.due('busker', this.buskers.length) && roomFor(life, 5)) this.findSpot();
    }
    for (let i = this.buskers.length - 1; i >= 0; i--) {
      const b = this.buskers[i];
      if (this.perform(b, dt, tick)) continue;
      this.end(b);
      this.buskers.splice(i, 1);
    }
  }

  reset(): void {
    for (const b of this.buskers) this.end(b);
    this.buskers.length = 0;
    for (const t of this.tips) t.age = TIP_FLIGHT;
  }

  describe(out: LabelSink): void {
    for (const b of this.buskers) {
      const s = b.ped.agent.s;
      if (out.wants(s.x, s.z)) out.ped(b.ped, `BUSKER ${secs(b.until - this.life.now)}`, 'people');
      labelMembers(out, b.crowd.members, 'WATCHING', false);
    }
  }

  /** The busker. */
  subject(out: Subject): boolean {
    const b = this.buskers[0];
    return b !== undefined && watch(out, b.ped.agent.s.x, b.ped.agent.s.z);
  }

  /** Debug (__ub): a busker at the spot nearest the player, with a few watching already. */
  force(): boolean {
    const life = this.life;
    let best: BuskSpot | null = null;
    for (const s of this.spots) if (!best || life.distance(s.x, s.z) < life.distance(best.x, best.z)) best = s;
    if (!best) return false;
    const b = this.start(best);
    for (let i = 0; i < 4; i++) {
      const c = life.addPed(best.x + Math.sin(best.heading) * 4 + i, best.z + Math.cos(best.heading) * 4, 0, undefined, streetBody(life));
      c.agent.street = true;
      b.crowd.add(c);
    }
    return true;
  }

  private findSpot(): void {
    const life = this.life;
    const rand = life.d.rand;
    // Reservoir pick among the spots in the ring, out of view.
    let pick: BuskSpot | null = null;
    let seen = 0;
    for (const s of this.spots) {
      const d = life.distance(s.x, s.z);
      if (d < START_RING[0] || d > START_RING[1] || life.inView(s.x, s.z, 4)) continue;
      if (rand() * ++seen < 1) pick = s;
    }
    if (!pick) {
      life.clock.defer('busker', life.now, 6);
      return;
    }
    this.start(pick);
  }

  private start(s: BuskSpot): Busker {
    const life = this.life;
    life.clock.start('busker', life.now);
    const rand = life.d.rand;
    const ped = life.addPed(s.x, s.z, s.heading, OUTFITS[Math.floor(rand() * OUTFITS.length)], streetBody(life));
    const crowd = new Gathering(life, { kind: 'crowd', capacity: 7, draw: 24, joinChance: 0.5, stay: [12, 28], radius: 2.6, arc: 2.4 });
    crowd.at(s.x, s.z, s.heading);
    const b: Busker = { ped, spot: s, crowd, until: life.now + SET_SECONDS[0] + rand() * (SET_SECONDS[1] - SET_SECONDS[0]), beat: 0 };
    this.buskers.push(b);
    life.emit('busker', s.x, s.z);
    return b;
  }

  /** One step of the set; false when it's over (time's up, or the busker's been knocked down or run off). */
  private perform(b: Busker, dt: number, tick: boolean): boolean {
    const life = this.life;
    const a = b.ped.agent;
    if (!life.present(b.ped) || !a.scene || a.mode === 'down' || a.mode === 'flee' || a.mode === 'fight') return false;
    if (life.now > b.until) return false;
    const s = b.spot;
    life.walkTo(b.ped, s.x, s.z);
    life.lookAt(b.ped, s.x + Math.sin(s.heading) * 4, s.z + Math.cos(s.heading) * 4);
    // The routine: dance (Cheer) a few beats, a wave, round again.
    const was = b.beat;
    b.beat = (b.beat + dt) % 6;
    if (b.beat < was || was === 0) b.ped.model.cheer(4.2);
    if (b.beat >= 4.3 && was < 4.3) b.ped.model.hail(1.5);
    b.crowd.step(dt);
    if (tick && life.lively('busker')) {
      if (roomFor(life, 2)) b.crowd.recruit();
      // Tips: each watcher now and then.
      const rand = life.d.rand;
      for (const c of b.crowd.members) if (rand() < 1 / TIP_EVERY) this.tip(c, b);
    }
    return true;
  }

  /** A coin from `c` into the hat at the busker's feet. */
  private tip(c: CrowdPed, b: Busker): void {
    for (const t of this.tips) {
      if (t.age < TIP_FLIGHT) continue;
      t.fromX = c.agent.s.x;
      t.fromZ = c.agent.s.z;
      t.toX = b.spot.x + Math.sin(b.spot.heading) * 0.7;
      t.toZ = b.spot.z + Math.cos(b.spot.heading) * 0.7;
      t.age = 0;
      return;
    }
  }

  /** Packs up: walks off as a passer-by; the crowd moves on. */
  private end(b: Busker): void {
    b.crowd.close();
    const c = b.ped;
    if (this.life.present(c) && c.agent.scene) {
      c.agent.street = true;
      this.life.giveBack(c);
    }
  }
}
