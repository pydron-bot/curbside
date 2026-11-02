/**
 * Muggings. Now and then, near the player and on screen, someone rushes a
 * passer-by, snatches their bag (`mugging`) and sprints off down the
 * pavement, round the block and across the road at the corners; the
 * victim shouts and points after them (waving, facing the thief). The look
 * rings the mugger in red. Chase them down and knock them over and they
 * drop the bag; walk over it to hand it back (`bagReturned`): the victim
 * cheers and the player is a HAVE-A-GO HERO (deps.award) with a small cash
 * reward (deps.reward; cash, not CRED, kept modest: docs/CRED.md).
 * Knocking the mugger down isn't an assault (PedAgent.suspect while they
 * run) nor called in by anyone who saw it (Witnesses asks `isMugger`).
 * Ignore them and they get away; a dropped bag nobody picks up is gone
 * after a while.
 */
import { BUSY, WANTED_PACE } from '../../systems/cityScenes';
import { BLOCKS_PER_SIDE } from '../../world/city';
import { blockAt, cornerPoint, hurtPed } from '../../systems/crowd';
import { nextCorner } from '../../systems/streetPeople';
import type { CrowdPed } from '../population';
import { watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { secs, type LabelSink } from '../debugLabels';
import { handBack, roomFor } from './people';
import { len2 } from '../../core/len';

/** The victim is this far from the player (close enough to see and give chase), m. */
const VICTIM_RING = [10, 40] as const;
/** The mugger comes from this far from the victim, m. */
const MUGGER_FROM = [5, 22] as const;
/** Gives up the approach after, s. */
const APPROACH_SECONDS = 9;
/** Grabs within this, m. */
const GRAB = 1.1;
/** Gets away once this far from the player (after a head start), or after RUN_SECONDS, m / s. */
const ESCAPE = 65;
const RUN_SECONDS = 35;
/** The victim shouts and points this long, s. */
const SHOUT_SECONDS = 5;
/** A dropped bag lies there this long, s; walked over within PICK_UP, m. */
const BAG_SECONDS = 45;
const PICK_UP = 1.2;
/** Handing a bag back pays this, $. */
export const BAG_REWARD = 50;
const BAG_MAX = 2;
/** Chance per corner the runner crosses the road instead of going on round. */
const CROSS = 0.4;

type Phase = 'approach' | 'run';

export interface Mugging {
  mugger: CrowdPed;
  victim: CrowdPed;
  phase: Phase;
  timer: number;
  /** Seconds the victim has been shouting (after the grab). */
  shout: number;
  bx: number;
  bz: number;
  corner: number;
  cw: boolean;
}

export interface Bag {
  x: number;
  z: number;
  /** Sim time it's gone (nobody picked it up); 0: no bag in this slot. */
  until: number;
  /** Whose it is (cheers when it's handed back). */
  owner: CrowdPed | null;
}

export class Muggings implements Scene {
  readonly kind = 'muggings';
  readonly muggings: Mugging[] = [];
  readonly bags: Bag[] = [];
  private scan = 0;
  private readonly corner = { x: 0, z: 0 };
  private readonly next = { bx: 0, bz: 0, corner: 0 };

  constructor(private readonly life: SceneCtx) {
    life.clock.define('mugging', { every: [90, 180], cap: 1, first: 60, range: VICTIM_RING[1], hold: BUSY, pace: WANTED_PACE });
    for (let i = 0; i < BAG_MAX; i++) this.bags.push({ x: 0, z: 0, until: 0, owner: null });
  }

  get running(): number {
    return this.muggings.length;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 1;
      if (life.live && life.due('mugging', this.muggings.length) && roomFor(life, 2)) this.look();
    }
    for (let i = this.muggings.length - 1; i >= 0; i--) {
      const m = this.muggings[i];
      if (this.stepMugging(m, dt)) continue;
      this.end(m);
      this.muggings.splice(i, 1);
    }
    this.stepBags();
  }

  reset(): void {
    for (const m of this.muggings) this.end(m);
    this.muggings.length = 0;
    for (const b of this.bags) {
      b.until = 0;
      b.owner = null;
    }
  }

  describe(out: LabelSink): void {
    for (const m of this.muggings) {
      out.ped(m.mugger, m.phase === 'run' ? 'MUGGER (running)' : 'MUGGER', 'people');
      out.ped(m.victim, m.shout > 0 && m.shout < SHOUT_SECONDS ? 'VICTIM (shouting)' : 'VICTIM', 'people');
    }
    const now = this.life.now;
    for (const b of this.bags) if (b.until > now && out.wants(b.x, b.z)) out.spot(b, `BAG ${secs(b.until - now)}`, 'people');
  }

  /** Is the one knocked down at (x, z) a mugger on the run (nobody calls that in)? */
  isMugger(x: number, z: number): boolean {
    for (const m of this.muggings) {
      const s = m.mugger.agent.s;
      if (m.phase === 'run' && len2(s.x - x, s.z - z) < 2.5) return true;
    }
    return false;
  }

  /** Debug (__ub): the nearest two passers-by: one mugs the other. */
  /** The mugger. */
  subject(out: Subject): boolean {
    const m = this.muggings[0];
    if (!m || !this.life.present(m.mugger)) return false;
    const s = m.mugger.agent.s;
    return watch(out, s.x, s.z, s.vx, s.vz);
  }

  force(): boolean {
    const life = this.life;
    let victim: CrowdPed | null = null;
    for (const c of life.d.population.crowd) if (free(c) && (!victim || life.distance(c.agent.s.x, c.agent.s.z) < life.distance(victim.agent.s.x, victim.agent.s.z))) victim = c;
    if (!victim) return false;
    const mugger = this.muggerFor(victim, 2, 16);
    if (!mugger) return false;
    this.start(mugger, victim);
    return true;
  }

  /** A passer-by in view near the player, and someone near them to do it. */
  private look(): void {
    const life = this.life;
    for (const c of life.d.population.crowd) {
      if (!free(c) || c.agent.temper !== 'calm') continue;
      const s = c.agent.s;
      const d = life.distance(s.x, s.z);
      if (d < VICTIM_RING[0] || d > VICTIM_RING[1] || !life.inView(s.x, s.z, -2)) continue;
      const mugger = this.muggerFor(c, MUGGER_FROM[0], MUGGER_FROM[1]);
      if (!mugger) continue;
      this.start(mugger, c);
      return;
    }
    life.clock.defer('mugging', life.now, 5);
  }

  private muggerFor(victim: CrowdPed, lo: number, hi: number): CrowdPed | null {
    const v = victim.agent.s;
    for (const c of this.life.d.population.crowd) {
      if (c === victim || !free(c)) continue;
      const d = len2(c.agent.s.x - v.x, c.agent.s.z - v.z);
      if (d >= lo && d <= hi) return c;
    }
    return null;
  }

  private start(mugger: CrowdPed, victim: CrowdPed): void {
    const life = this.life;
    life.clock.start('mugging', life.now);
    // The victim walks on, unaware, until the grab.
    life.borrow(mugger);
    // In no mood to stop for anyone (a punch scares them on, rather than turning them on the player).
    mugger.agent.temper = 'calm';
    this.muggings.push({ mugger, victim, phase: 'approach', timer: 0, shout: 0, bx: 0, bz: 0, corner: 0, cw: true });
  }

  /** One step; false when it's over. */
  private stepMugging(m: Mugging, dt: number): boolean {
    const life = this.life;
    m.timer += dt;
    const ma = m.mugger.agent;
    const va = m.victim.agent;
    const muggerHere = life.present(m.mugger) && ma.scene === true;
    if (m.phase === 'approach') {
      // The victim's still just walking (taken by something else, or gone: called off).
      if (!muggerHere || !life.present(m.victim) || !free(m.victim) || ma.mode === 'down' || m.timer > APPROACH_SECONDS) return false;
      life.walkTo(m.mugger, va.s.x, va.s.z);
      if (len2(ma.s.x - va.s.x, ma.s.z - va.s.z) < GRAB) this.grab(m);
      return true;
    }
    const victimHere = life.present(m.victim) && va.scene === true && va.mode !== 'down';
    // The victim shouts after them for a few seconds, then walks on.
    if (victimHere && m.shout < SHOUT_SECONDS) {
      m.shout += dt;
      life.walkTo(m.victim, va.s.x, va.s.z);
      life.lookAt(m.victim, ma.s.x, ma.s.z);
      m.victim.model.hail(0.5);
      if (m.shout >= SHOUT_SECONDS) life.giveBack(m.victim);
    }
    if (!muggerHere) return false;
    if (ma.mode === 'down') {
      // Taken down: the bag's dropped beside them.
      this.drop(ma.s.x, ma.s.z, m.victim);
      return false;
    }
    // Clear away (or long gone): they've got away with it.
    if (m.timer > RUN_SECONDS || (m.timer > 6 && life.distance(ma.s.x, ma.s.z) > ESCAPE)) return false;
    if (ma.mode !== 'arrest') return true;
    // Corner to corner round the blocks, crossing now and then.
    const c = cornerPoint(m.bx, m.bz, m.corner, this.corner);
    if (len2(c.x - ma.s.x, c.z - ma.s.z) < 1.2) {
      const n = nextCorner(m.bx, m.bz, m.corner, m.cw, life.d.rand() < CROSS, BLOCKS_PER_SIDE, this.next);
      m.bx = n.bx;
      m.bz = n.bz;
      m.corner = n.corner;
      cornerPoint(m.bx, m.bz, m.corner, this.corner);
    }
    life.walkTo(m.mugger, this.corner.x, this.corner.z);
    return true;
  }

  /** The snatch: the victim reels, the mugger's off round the block, away from the player. */
  private grab(m: Mugging): void {
    const life = this.life;
    const ma = m.mugger.agent;
    const va = m.victim.agent;
    m.phase = 'run';
    m.timer = 0;
    ma.suspect = true;
    life.borrow(m.victim);
    m.mugger.model.punch(1);
    hurtPed(va, 5, ma.s.x, ma.s.z);
    life.emit('mugging', va.s.x, va.s.z);
    // The corner of this block furthest from the player first.
    const b = blockAt(ma.s.x, ma.s.z);
    m.bx = b.bx;
    m.bz = b.bz;
    let best = -1;
    for (let k = 0; k < 4; k++) {
      const c = cornerPoint(b.bx, b.bz, k, this.corner);
      const d = life.distance(c.x, c.z);
      if (d > best) {
        best = d;
        m.corner = k;
      }
    }
    m.cw = life.d.rand() < 0.5;
  }

  private drop(x: number, z: number, owner: CrowdPed): void {
    let slot = this.bags[0];
    for (const b of this.bags) if (b.until < slot.until) slot = b;
    slot.x = x + 0.6;
    slot.z = z;
    slot.until = this.life.now + BAG_SECONDS;
    slot.owner = owner;
  }

  /** Bags lying about: gone after a while, handed back when the player walks over one. */
  private stepBags(): void {
    const life = this.life;
    const p = life.d.player;
    const now = life.now;
    for (const b of this.bags) {
      if (b.until === 0) continue;
      if (now > b.until) {
        b.until = 0;
        b.owner = null;
        continue;
      }
      if (p.driving || !p.alive || p.arrested || !life.d.playing()) continue;
      if (len2(p.ped.x - b.x, p.ped.z - b.z) > PICK_UP) continue;
      b.until = 0;
      life.emit('bagReturned', b.x, b.z);
      life.emit('haveAGo', b.x, b.z);
      life.d.award?.('haveAGo');
      life.d.reward?.(BAG_REWARD, 'HAVE-A-GO HERO');
      const o = b.owner;
      if (o && life.present(o) && o.agent.mode !== 'down' && life.distance(o.agent.s.x, o.agent.s.z) < 60) o.model.cheer(2);
      b.owner = null;
    }
  }

  /** Over: both handed back (a mugger knocked out stays down for the ambulance; one who got away out of sight is gone). */
  private end(m: Mugging): void {
    const life = this.life;
    const c = m.mugger;
    c.agent.suspect = false;
    if (life.present(c) && c.agent.scene && c.agent.mode !== 'down' && !life.inView(c.agent.s.x, c.agent.s.z, 4)) life.removePed(c);
    else handBack(life, c);
    handBack(life, m.victim);
  }
}

/** An ordinary passer-by walking about. */
function free(c: CrowdPed): boolean {
  const a = c.agent;
  return a.street === true && !a.scene && a.role === 'civilian' && a.mode === 'walk' && a.burning <= 0 && !a.injured;
}
