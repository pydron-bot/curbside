/**
 * A hen or stag do's conga. Late on (CONGA_HOURS) where there's nightlife
 * (the Neon Mile, Cobble Row, Glass Heights: the district's NIGHTLIFE at
 * least 0.3), six to nine in matching tops (the hens in pink, the stags
 * in green: PARTY_OUTFITS, colours only) conga round a block's pavement,
 * a pace apart, the leader walking the corners and the rest on the exact
 * line behind (systems/incidents.ts Trail), a lurch to the side on every
 * fourth beat and the chant (`conga`) as they go.
 *
 * Joining in: start a fight near them (or let one start): a third of the
 * line breaks off and piles in (life.setOn the fighters), rejoining the
 * tail once it's over. Cause mayhem near them (a blast, a big crash, a
 * knockout) and the whole line stops and cheers. Drive through them and
 * those knocked flat drop out. Holds: HOLD below.
 */
import { BUSY, WANTED_PACE, type SceneHold } from '../../systems/cityScenes';
import { cornerPoint } from '../../systems/crowd';
import { CONGA_CHEER, CONGA_CLOCK, CONGA_JOIN, CONGA_PITCH, CONGA_SECONDS, CONGA_SIZE, PARTY_OUTFITS, Trail, congaJoiners, congaTime } from '../../systems/incidents';
import { BLOCKS_PER_SIDE, BLOCK_SIZE } from '../../world/city';
import { NIGHTLIFE } from '../cityMood';
import { districtAt } from '../../world/districts';
import type { CrowdPed } from '../population';
import { watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { secs, type LabelSink } from '../debugLabels';
import type { Fights } from './fights';
import { PEOPLE_CAP, handBack, letGo, roomFor, streetBody } from './people';
import { len2 } from '../../core/len';

/** It piles into fights: busy (the city doesn't stop for you; fewer while you're wanted). */
const HOLD: readonly SceneHold[] = BUSY;
/** It starts round a corner this far from the player (out of view), m. */
const PICK = [28, 85] as const;
/** The leader aims this far ahead (under a sprint's 2.5 m: a walk), m. */
const LEAD = 1.6;
/** One beat, s: a lurch on every fourth. */
const BEAT = 0.42;
/** The chant every this long, s; a cheer at most every this long, s. */
const CHANT_EVERY = 3.4;
const CHEER_GAP = 3;
/** A big crash near them gets a cheer, m/s. */
const CHEER_CRASH = 9;

export interface Conga {
  party: 'hen' | 'stag';
  /** In line, the leader first. */
  dancers: CrowdPed[];
  /** Off piling into a fight. */
  brawlers: CrowdPed[];
  readonly trail: Trail;
  bx: number;
  bz: number;
  corner: number;
  clockwise: boolean;
  age: number;
  length: number;
  beat: number;
  chantIn: number;
  /** Standing cheering this long still, s. */
  cheer: number;
  lastCheer: number;
}

export class Congas implements Scene {
  readonly kind = 'conga';
  readonly list: Conga[] = [];
  private scan = 0;
  private fightScan = 0;
  private readonly p = { x: 0, z: 0 };

  constructor(
    private readonly life: SceneCtx,
    private readonly fights: Fights,
  ) {
    life.clock.define('conga', { ...CONGA_CLOCK, hold: HOLD, pace: WANTED_PACE });
    const bus = life.d.bus;
    bus.on('explosion', (e) => this.mayhem(e.x, e.z));
    bus.on('crash', (e) => {
      if (e.involvesPlayer && e.impact > CHEER_CRASH) this.mayhem(e.x, e.z);
    });
    bus.on('pedDown', (e) => {
      if (e.byPlayer && e.ko) this.mayhem(e.x, e.z);
    });
  }

  get running(): number {
    return this.list.length;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 1.5;
      if (life.due('conga', this.list.length)) this.look();
    }
    const fightScan = (this.fightScan -= dt) <= 0;
    if (fightScan) this.fightScan = 0.5;
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.stepOne(this.list[i], dt, fightScan)) continue;
      this.end(this.list[i]);
      this.list.splice(i, 1);
    }
  }

  reset(): void {
    for (const c of this.list) this.end(c);
    this.list.length = 0;
  }

  describe(out: LabelSink): void {
    for (const c of this.list) {
      const word = c.party === 'hen' ? 'HEN' : 'STAG';
      for (let i = 0; i < c.dancers.length; i++) {
        const d = c.dancers[i];
        if (out.wants(d.agent.s.x, d.agent.s.z)) out.ped(d, i === 0 ? `${word} DO (leading ${secs(c.length - c.age)})` : c.cheer > 0 ? `${word} DO (cheering)` : `${word} DO (conga)`, 'people');
      }
      for (const b of c.brawlers) out.ped(b, `${word} DO (piling in)`, 'people');
    }
  }

  /** The middle of the line. */
  subject(out: Subject): boolean {
    const c = this.list[0];
    if (!c || c.dancers.length === 0) return false;
    const m = c.dancers[c.dancers.length >> 1].agent.s;
    return watch(out, m.x, m.z, m.vx, m.vz);
  }

  /** Debug (TEST menu) and the title's show: a conga at the pavement corner nearest the player, now. */
  force(): boolean {
    if (this.list.length > 0) return false;
    const at = this.life.d.focus();
    let best = Infinity;
    let pick: [number, number, number] | null = null;
    const cbx = Math.floor((at.x + (BLOCKS_PER_SIDE * BLOCK_SIZE) / 2) / BLOCK_SIZE);
    const cbz = Math.floor((at.z + (BLOCKS_PER_SIDE * BLOCK_SIZE) / 2) / BLOCK_SIZE);
    for (let bx = cbx - 1; bx <= cbx + 1; bx++)
      for (let bz = cbz - 1; bz <= cbz + 1; bz++)
        for (let k = 0; k < 4; k++) {
          if (bx < 0 || bz < 0 || bx >= BLOCKS_PER_SIDE || bz >= BLOCKS_PER_SIDE) continue;
          const p = cornerPoint(bx, bz, k, this.p);
          const d = len2(p.x - at.x, p.z - at.z);
          if (d < 10 || d > best) continue;
          best = d;
          pick = [bx, bz, k];
        }
    if (!pick) return false;
    this.start(pick[0], pick[1], pick[2]);
    return true;
  }

  // --- Internals ---

  private look(): void {
    const life = this.life;
    const at = life.d.focus();
    const hour = life.d.hour?.() ?? life.d.mood?.hour ?? 13;
    if (!congaTime(hour, NIGHTLIFE[districtAt(at.x, at.z)]) || !roomFor(life, CONGA_SIZE[0])) {
      life.clock.defer('conga', life.now, 12);
      return;
    }
    // A pavement corner in the ring round the player, out of view, where the nightlife is.
    const rand = life.d.rand;
    const cbx = Math.floor((at.x + (BLOCKS_PER_SIDE * BLOCK_SIZE) / 2) / BLOCK_SIZE);
    const cbz = Math.floor((at.z + (BLOCKS_PER_SIDE * BLOCK_SIZE) / 2) / BLOCK_SIZE);
    let pick: [number, number, number] | null = null;
    let seen = 0;
    for (let bx = cbx - 2; bx <= cbx + 2; bx++)
      for (let bz = cbz - 2; bz <= cbz + 2; bz++)
        for (let k = 0; k < 4; k++) {
          if (bx < 0 || bz < 0 || bx >= BLOCKS_PER_SIDE || bz >= BLOCKS_PER_SIDE) continue;
          const p = cornerPoint(bx, bz, k, this.p);
          const d = life.distance(p.x, p.z);
          if (d < PICK[0] || d > PICK[1] || life.inView(p.x, p.z, 8) || NIGHTLIFE[districtAt(p.x, p.z)] < 0.3) continue;
          if (rand() * ++seen < 1) pick = [bx, bz, k];
        }
    if (!pick) {
      life.clock.defer('conga', life.now, 6);
      return;
    }
    this.start(pick[0], pick[1], pick[2]);
  }

  private start(bx: number, bz: number, corner: number): Conga {
    const life = this.life;
    life.clock.start('conga', life.now);
    const rand = life.d.rand;
    const party = rand() < 0.5 ? 'hen' : 'stag';
    const clockwise = rand() < 0.5;
    // From this corner toward the next: the line strung out behind it, back toward the one before.
    const from = cornerPoint(bx, bz, corner, { x: 0, z: 0 });
    const to = cornerPoint(bx, bz, (corner + (clockwise ? 1 : 3)) & 3, this.p);
    const heading = Math.atan2(to.x - from.x, to.z - from.z);
    // As long a line as there's room for (the shortest regardless: the TEST menu's).
    const n = Math.max(CONGA_SIZE[0], Math.min(CONGA_SIZE[0] + Math.floor(rand() * (CONGA_SIZE[1] - CONGA_SIZE[0] + 1)), PEOPLE_CAP - life.people.length));
    const c: Conga = {
      party,
      dancers: [],
      brawlers: [],
      trail: new Trail(48, 0.4),
      bx,
      bz,
      corner: (corner + (clockwise ? 1 : 3)) & 3,
      clockwise,
      age: 0,
      length: CONGA_SECONDS[0] + rand() * (CONGA_SECONDS[1] - CONGA_SECONDS[0]),
      beat: 0,
      chantIn: 0,
      cheer: 0,
      lastCheer: -1e9,
    };
    // The line laid out behind the corner, along the pavement it came by.
    c.trail.reset(from.x, from.z, heading, n * CONGA_PITCH + 2);
    const outfit = PARTY_OUTFITS[party];
    for (let i = 0; i < n; i++) {
      const p = c.trail.at(from.x, from.z, i * CONGA_PITCH, this.p);
      const ped = life.addPed(p.x, p.z, heading, outfit, streetBody(life, true));
      ped.agent.street = true;
      ped.agent.temper = 'fighter';
      c.dancers.push(ped);
    }
    this.list.push(c);
    life.emit('conga', from.x, from.z);
    return c;
  }

  /** One conga's step; false once it's broken up. */
  private stepOne(c: Conga, dt: number, fightScan: boolean): boolean {
    const life = this.life;
    c.age += dt;
    this.dropOuts(c);
    if (c.dancers.length + c.brawlers.length < 2 || (c.age > c.length && c.brawlers.length === 0)) return false;
    if (c.dancers.length === 0) return true;
    if (fightScan) this.pileIn(c);
    const lead = c.dancers[0];
    const ls = lead.agent.s;
    if (c.cheer > 0) {
      // Stopped to cheer the mayhem.
      c.cheer -= dt;
      for (const d of c.dancers) life.walkTo(d, d.agent.s.x, d.agent.s.z);
      return true;
    }
    // The leader: on round the block, corner to corner.
    const to = cornerPoint(c.bx, c.bz, c.corner, this.p);
    let dx = to.x - ls.x;
    let dz = to.z - ls.z;
    let d = len2(dx, dz);
    if (d < 0.8) {
      c.corner = (c.corner + (c.clockwise ? 1 : 3)) & 3;
      cornerPoint(c.bx, c.bz, c.corner, this.p);
      dx = this.p.x - ls.x;
      dz = this.p.z - ls.z;
      d = len2(dx, dz);
    }
    const k = Math.min(LEAD, d) / (d || 1);
    life.walkTo(lead, ls.x + dx * k, ls.z + dz * k);
    c.trail.push(ls.x, ls.z);
    // The rest on the line behind, a pace apart; a lurch to the side on every fourth beat.
    const was = Math.floor(c.beat / BEAT);
    c.beat += dt;
    const lurch = Math.floor(c.beat / BEAT) !== was && Math.floor(c.beat / BEAT) % 4 === 3;
    const side = Math.floor(c.beat / (BEAT * 4)) % 2 ? 1 : -1;
    for (let i = 1; i < c.dancers.length; i++) {
      const p = c.trail.at(ls.x, ls.z, i * CONGA_PITCH, this.p);
      const dancer = c.dancers[i];
      life.walkTo(dancer, p.x, p.z);
      if (lurch) {
        const s = dancer.agent.s;
        const h = s.heading;
        s.vx += Math.cos(h) * side * 1.3;
        s.vz -= Math.sin(h) * side * 1.3;
      }
    }
    if ((c.chantIn -= dt) <= 0) {
      c.chantIn = CHANT_EVERY;
      life.emit('conga', ls.x, ls.z);
    }
    return true;
  }

  /** Anyone knocked down, run off or gone drops out; a brawler whose fight's over rejoins the tail. */
  private dropOuts(c: Conga): void {
    const life = this.life;
    for (let i = c.dancers.length - 1; i >= 0; i--) {
      const d = c.dancers[i];
      const a = d.agent;
      if (life.present(d) && a.scene && a.mode !== 'down' && a.mode !== 'flee' && a.mode !== 'fight' && a.mode !== 'shoot') continue;
      // Provoked (the player had a go): they're after the player now.
      letGo(life, d);
      c.dancers.splice(i, 1);
    }
    for (let i = c.brawlers.length - 1; i >= 0; i--) {
      const b = c.brawlers[i];
      const a = b.agent;
      if (!life.present(b) || !a.scene || a.mode === 'down' || a.mode === 'flee') {
        handBack(life, b);
        c.brawlers.splice(i, 1);
      } else if (life.opponentOf(b) === null && a.mode !== 'fight') {
        // Fought out: back on the end of the line.
        c.brawlers.splice(i, 1);
        c.dancers.push(b);
      }
    }
  }

  /** A fight going on near the line: a third of it piles in. */
  private pileIn(c: Conga): void {
    const life = this.life;
    if (c.brawlers.length > 0 || c.dancers.length < 3) return;
    const ls = c.dancers[0].agent.s;
    for (const f of this.fights.fights) {
      if (f.phase !== 'fists') continue;
      const s = f.a.agent.s;
      if (len2(s.x - ls.x, s.z - ls.z) > CONGA_JOIN) continue;
      const n = Math.min(congaJoiners(c.dancers.length), c.dancers.length - 1);
      for (let j = 0; j < n; j++) {
        const b = c.dancers.pop()!;
        life.setOn(b, j % 2 ? f.b : f.a, false, 10);
        c.brawlers.push(b);
      }
      life.emit('fight', s.x, s.z);
      return;
    }
  }

  /** Something went off near a conga: they stop and cheer. */
  private mayhem(x: number, z: number): void {
    const life = this.life;
    for (const c of this.list) {
      const lead = c.dancers[0];
      if (!lead || life.now - c.lastCheer < CHEER_GAP) continue;
      if (len2(lead.agent.s.x - x, lead.agent.s.z - z) > CONGA_CHEER) continue;
      c.lastCheer = life.now;
      c.cheer = 2.2;
      for (const d of c.dancers) {
        d.model.cheer(2);
        life.lookAt(d, x, z);
      }
    }
  }

  private end(c: Conga): void {
    for (const d of c.dancers) handBack(this.life, d);
    for (const b of c.brawlers) handBack(this.life, b);
    c.dancers.length = 0;
    c.brawlers.length = 0;
  }
}
