/**
 * Shots fired (V2-10, Your Mess, Their Problem). The player's gunfire with
 * nobody after them yet sets off a chain: a parked car's alarm beside the
 * shots (SceneStarter via CityLifeDeps.follow), a passer-by who heard it
 * calls it in once the shooting stops (Witnesses.heard: the phone pose, no
 * crime on the call: the gunfire's heat landed already), and a patrol comes
 * (scenes/patrol.ts), lights on, the officer has a look round where it
 * happened and they leave. Each link is the next of the chain the shots
 * began (CityLife.chain, rooted in the player): DOMINO ×2..×4.
 *
 * LOUD: not behind the title, in a quiet activity or the cold open, and not
 * while wanted (the real police are on their way already). One at a time,
 * every 90–150 s at most. The patrol never busts: Patrol's rules (a player
 * still there and wanted by then gets it in their pursuit).
 */
import { LOUD } from '../../systems/cityScenes';
import { CALL_LATEST, HEAR_RANGE, LOOK_ROUND, callDue, type Cause } from '../../systems/mess';
import type { Scene, SceneCtx, Subject } from '../cityLife';
import { watch } from '../cityLife';
import type { Report } from './witnesses';
import { Patrol } from './patrol';
import { len2 } from '../../core/len';
import { secs, type LabelSink } from '../debugLabels';

/** Shots this close to the first are the same volley, m. */
const SAME_SHOTS = 40;
/** The officer gives up walking over and looks round from where they are after this long, s. */
const WALK_FOR = 10;

type Phase = 'shots' | 'calling' | 'coming' | 'looking';

interface Call {
  phase: Phase;
  x: number;
  z: number;
  /** Sim time of the first and the last shot. */
  first: number;
  last: number;
  cause: Cause;
  report: Report | null;
  patrol: Patrol | null;
  /** Seconds in this phase. */
  timer: number;
  /** Seconds looking round on the spot. */
  look: number;
}

export class ShotsFired implements Scene {
  readonly kind = 'shotsFired';
  call: Call | null = null;
  /** Chains started, calls through, patrols arrived (tests, __ub). */
  readonly counts = { started: 0, called: 0, arrived: 0 };

  constructor(private readonly life: SceneCtx) {
    life.clock.define('shotsFired', { every: [90, 150], cap: 1, first: 0, hold: LOUD });
    life.d.bus.on('shot', (e) => {
      if (e.byPlayer) this.shot(e.x, e.z);
    });
  }

  get running(): number {
    return this.call ? 1 : 0;
  }

  /** The player fired at (x, z): a new chain if one may start, else the volley goes on. */
  shot(x: number, z: number): void {
    const life = this.life;
    const now = life.now;
    const c = this.call;
    if (c) {
      if (c.phase === 'shots' && len2(c.x - x, c.z - z) < SAME_SHOTS) c.last = now;
      return;
    }
    if (!life.d.playing() || !life.due('shotsFired', 0)) return;
    life.clock.start('shotsFired', now);
    this.counts.started++;
    let cause = life.chain(null, 'shots', x, z, 'player');
    // A parked car beside the shots goes off: the next link (none parked near: the chain goes on without).
    cause = life.d.follow?.('alarm', x, z, cause) ?? cause;
    this.call = { phase: 'shots', x, z, first: now, last: now, cause, report: null, patrol: null, timer: 0, look: 0 };
  }

  step(dt: number): void {
    const c = this.call;
    if (!c) return;
    const life = this.life;
    c.timer += dt;
    switch (c.phase) {
      case 'shots': {
        if (!callDue(life.now - c.first, life.now - c.last)) return;
        c.report = life.witnesses.heard(c.x, c.z, HEAR_RANGE);
        if (!c.report) return this.end();
        this.phase(c, 'calling');
        return;
      }
      case 'calling': {
        const r = c.report!;
        if (r.through) {
          this.counts.called++;
          c.cause = life.chain(c.cause, 'call', c.x, c.z);
          life.emit('shotsFired', c.x, c.z);
          c.patrol = Patrol.call(life, c.x, c.z);
          if (!c.patrol) return this.end();
          this.phase(c, 'coming');
        } else if (r.calling === 0 || c.timer > CALL_LATEST * 3) this.end();
        return;
      }
      case 'coming':
      case 'looking':
        return this.stepPatrol(c, dt);
    }
  }

  reset(): void {
    this.call?.patrol?.end();
    this.call = null;
  }

  describe(out: LabelSink): void {
    const c = this.call;
    if (!c) return;
    const v = c.patrol?.v;
    if (v) out.car(v, c.phase === 'coming' ? 'POLICE (shots fired)' : 'POLICE (looking round)', 'police');
    const o = c.patrol?.officer;
    if (o) out.ped(o, `COP (shots fired ${secs(c.look)})`, 'police');
  }

  /** Where the shots were (the patrol's car on its way). */
  subject(out: Subject): boolean {
    const c = this.call;
    if (!c) return false;
    const v = c.patrol?.v;
    if (c.phase === 'coming' && v) return watch(out, v.sim.x, v.sim.z, v.sim.vx, v.sim.vz);
    return watch(out, c.x, c.z);
  }

  private stepPatrol(c: Call, dt: number): void {
    const life = this.life;
    const p = c.patrol!;
    const at = p.step(dt);
    if (at === 'gone') return this.end();
    if (at === 'joined') {
      this.counts.arrived++;
      c.cause = life.chain(c.cause, 'patrol', c.x, c.z);
      return this.end();
    }
    if (at === 'coming') return;
    if (c.phase === 'coming') {
      this.counts.arrived++;
      c.cause = life.chain(c.cause, 'patrol', c.x, c.z);
      this.phase(c, 'looking');
    }
    const o = p.out();
    if (!o) return;
    const s = o.agent.s;
    // Over to where it happened, then a slow look round (a quarter turn every 1.5 s).
    if (c.look === 0 && len2(s.x - c.x, s.z - c.z) > 2.5 && c.timer < WALK_FOR) {
      life.walkTo(o, c.x, c.z);
      life.lookAt(o, c.x, c.z);
      return;
    }
    c.look += dt;
    life.walkTo(o, s.x, s.z);
    const a = Math.floor(c.look / 1.5) * (Math.PI / 2);
    life.lookAt(o, s.x + Math.sin(a) * 5, s.z + Math.cos(a) * 5);
    if (c.look >= LOOK_ROUND) p.leave();
  }

  private phase(c: Call, phase: Phase): void {
    c.phase = phase;
    c.timer = 0;
  }

  /** Over: whatever's left goes back (a patrol already leaving finishes by itself through end()). */
  private end(): void {
    const c = this.call;
    if (!c) return;
    // A patrol on its way out keeps going as traffic; one still coming is stood down.
    c.patrol?.end();
    this.call = null;
  }
}
