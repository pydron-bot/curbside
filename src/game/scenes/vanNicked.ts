/**
 * VAN NICKED (V2-12): the queue at an ice cream van the player drives off
 * in comes after them on foot. The city's van (scenes/iceCream.ts) hands
 * its queue over when the player takes it open; the player's own chime
 * queue (scenes/serviceTools.ts) when they drive off from it. They stare
 * until the van goes, then run after the player (in the van or out of
 * it), waving their arms, and give up after a while or once left behind;
 * one who reaches the van parked with its chime on joins the chime queue.
 * Rules pure in systems/vanNicked.ts. Nothing here is heat: they're held
 * by this scene (no witness calls), and hitting one is an assault as ever.
 * The city van's theft pays VAN NICKED (deps.award; the stamp reads the
 * award): once, as a van the player's left has nobody to open it again. One chase at a time; nothing allocates per step.
 */
import { speed } from '../../entities/vehicle';
import {
  CHASE_FOR,
  GLARE,
  NICK_WAIT,
  QUEUE_REACH,
  SURROUND_CAR,
  SURROUND_FOOT,
  chaserVerdict,
  nickPays,
  nickStarts,
  surroundSpot,
} from '../../systems/vanNicked';
import { len2 } from '../../core/len';
import type { CrowdPed, Vehicle } from '../population';
import type { Scene, SceneCtx } from '../cityLife';
import type { LabelSink } from '../debugLabels';
import type { Gathering } from './gathering';

/** Each chaser waves their arms this often, s. */
const WAVE_EVERY = 1.8;

interface Chaser {
  c: CrowdPed;
  /** Seconds since the chase began (or since they glared). */
  age: number;
  /** When they give up, s. */
  limit: number;
  glaring: boolean;
  wave: number;
}

export class VanNicked implements Scene {
  readonly kind = 'vanNicked';
  readonly chasers: Chaser[] = [];
  /** The van they're after. */
  van: Vehicle | null = null;
  /** Off after it (else still standing where it stood). */
  chasing = false;
  /** The player's own chime queue (pays nothing). */
  own = false;
  /** Seconds standing, waiting for the van to go. */
  private waited = 0;
  private x0 = 0;
  private z0 = 0;
  private queued = 0;
  private readonly spot = { x: 0, z: 0 };
  /** How many have started a chase, by whose queue (diagnostics, tests). */
  readonly counts = { city: 0, own: 0, paid: 0, gaveUp: 0, queued: 0 };

  constructor(private readonly life: SceneCtx) {}

  get running(): number {
    return this.chasers.length > 0 ? 1 : 0;
  }

  /**
   * The queue at `van` (`from`, drained) is after it now: `own` the
   * player's chime queue, `moving` already gone (else they wait for it to
   * go). Any chase already on is called off. Returns how many came.
   */
  take(van: Vehicle, from: Gathering, own: boolean, moving: boolean): number {
    const life = this.life;
    this.reset();
    const m = from.members;
    while (m.length > 0) {
      const c = m[m.length - 1];
      from.release(c);
      if (!life.present(c) || c.agent.mode === 'down') continue;
      life.borrow(c);
      this.chasers.push({ c, age: 0, limit: CHASE_FOR[0] + life.d.rand() * (CHASE_FOR[1] - CHASE_FOR[0]), glaring: false, wave: life.d.rand() * WAVE_EVERY });
    }
    from.close();
    if (this.chasers.length === 0) return 0;
    this.van = van;
    this.own = own;
    this.queued = this.chasers.length;
    this.x0 = van.sim.x;
    this.z0 = van.sim.z;
    this.waited = 0;
    this.chasing = false;
    if (moving) this.go();
    return this.chasers.length;
  }

  step(dt: number): void {
    const van = this.van;
    if (!van) return;
    const life = this.life;
    const p = life.d.player;
    const s = van.sim;
    if (!this.chasing) {
      if (nickStarts(this.x0, this.z0, s.x, s.z)) this.go();
      else if ((this.waited += dt) > NICK_WAIT || !van.mesh.root.visible) {
        this.reset();
        return;
      }
    }
    // After the player (in the van or out of it); with the player gone (wasted, nicked), it's over.
    const on = p.alive && !p.arrested;
    const at = p.position;
    const tx = this.chasing ? at.x : s.x;
    const tz = this.chasing ? at.z : s.z;
    const radius = p.driving ? (p.driving.sim.body?.halfWidth ?? 1) + SURROUND_CAR : SURROUND_FOOT;
    const tools = life.tools;
    const chime = tools.truck === van && tools.chime.on && tools.chime.anchored && speed(s) < 0.8;
    for (let i = this.chasers.length - 1; i >= 0; i--) {
      const ch = this.chasers[i];
      const c = ch.c;
      const a = c.agent;
      if (!life.present(c) || !a.scene || a.mode === 'down' || a.mode === 'flee' || a.mode === 'fight' || a.mode === 'shoot') {
        // Knocked down, scared off, set on someone: theirs again (the ambulance can come for them).
        this.chasers.splice(i, 1);
        if (life.present(c) && a.scene) life.giveBack(c);
        continue;
      }
      if (!this.chasing) {
        // Stood where they were queueing, staring at it.
        life.walkTo(c, a.s.x, a.s.z);
        life.lookAt(c, s.x, s.z);
        continue;
      }
      ch.age += dt;
      if (ch.glaring) {
        life.walkTo(c, a.s.x, a.s.z);
        life.lookAt(c, tx, tz);
        if (ch.age >= GLARE) {
          this.chasers.splice(i, 1);
          life.giveBack(c);
        }
        continue;
      }
      // The van parked with its chime on: ice cream after all.
      if (chime && len2(a.s.x - s.x, a.s.z - s.z) < QUEUE_REACH + (s.body?.reach ?? 2.4) && tools.queue.add(c)) {
        this.chasers.splice(i, 1);
        this.counts.queued++;
        continue;
      }
      const gap = len2(a.s.x - tx, a.s.z - tz);
      if (!on || chaserVerdict(ch.age, ch.limit, gap) === 'giveUp') {
        ch.glaring = true;
        ch.age = 0;
        c.model.hail(GLARE);
        this.counts.gaveUp++;
        continue;
      }
      const at2 = surroundSpot(tx, tz, i, this.chasers.length, radius, this.spot);
      life.walkTo(c, at2.x, at2.z);
      life.lookAt(c, tx, tz);
      if ((ch.wave -= dt) <= 0) {
        ch.wave = WAVE_EVERY;
        c.model.hail(0.9);
      }
    }
    if (this.chasers.length === 0) this.van = null;
  }

  reset(): void {
    const life = this.life;
    for (const ch of this.chasers) if (life.present(ch.c) && ch.c.agent.scene) life.giveBack(ch.c);
    this.chasers.length = 0;
    this.van = null;
    this.chasing = false;
  }

  describe(out: LabelSink): void {
    for (const ch of this.chasers) out.ped(ch.c, ch.glaring ? 'NICKED (gave up)' : this.chasing ? (this.own ? 'NICKED (own queue)' : 'NICKED (chasing)') : 'NICKED (staring)', 'people');
  }

  /** The van's gone: after it. The city's van pays once. */
  private go(): void {
    const van = this.van!;
    this.chasing = true;
    for (const ch of this.chasers) {
      ch.age = 0;
      ch.c.model.hail(1.2);
    }
    this.life.emit('vanNicked', van.sim.x, van.sim.z);
    if (this.own) this.counts.own++;
    else this.counts.city++;
    if (nickPays(this.own, this.queued)) {
      this.counts.paid++;
      this.life.d.award?.('vanNicked');
    }
  }
}
