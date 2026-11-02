/**
 * Scuffles between people, when something happens between them: someone
 * running barges a passer-by (a ped fleeing, or the player sprinting
 * through one into another), a stray round from someone else's gun hits
 * someone with a temper, or a queue-jumper pushes in at a cart or the ice
 * cream van (the queue scenes call queueJump()). It starts with a shove
 * each way; then either the one shoved backs down and walks off, or it's
 * fists for a few seconds (life.setOn both ways, punches through
 * CityLife.punch: no heat, no score). It ends with one walking off beaten
 * and the other raising a fist, or one knocked out cold, who stays down
 * for the ambulance (scenes/medics.ts). Passers-by stop and watch in a
 * ring (a Gathering crowd) until it's over. At most two at once (BUSY:
 * held off by a timed race and the cold open; fewer while you're wanted).
 */
import { BUSY, WANTED_PACE } from '../../systems/cityScenes';
import { scare } from '../../systems/crowd';
import { barges, planFight, type FightPlan } from '../../systems/streetPeople';
import type { CrowdPed } from '../population';
import { watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { labelMembers, type LabelSink } from '../debugLabels';
import { Gathering } from './gathering';
import { handBack, roomFor } from './people';
import { len2 } from '../../core/len';

/** Only near the player (someone should see it), m. */
const SHOW_RANGE = 60;
/** The shove-off before the fists, s. */
const SHOVE_SECONDS = 1.4;
/** A knocked-out loser goes down with this little left, HP (a few punches). */
const KO_HP = 30;
/** Chance a passer-by barged by someone running squares up (else they shrug it off). */
const SQUARE_UP = 0.4;

type Phase = 'shove' | 'fists';

export interface Fight {
  a: CrowdPed;
  b: CrowdPed;
  phase: Phase;
  timer: number;
  plan: FightPlan;
  /** Onlookers. */
  ring: Gathering;
  /** Shoves thrown so far (one each). */
  shoves: number;
  /** Seconds to the next look for onlookers. */
  recruitIn: number;
}

export class Fights implements Scene {
  readonly kind = 'fights';
  readonly fights: Fight[] = [];
  private scan = 0;
  private readonly spare: Gathering[] = [];

  constructor(private readonly life: SceneCtx) {
    life.clock.define('fight', { every: [20, 45], cap: 2, first: 20, range: SHOW_RANGE, hold: BUSY, pace: WANTED_PACE });
    life.d.bus.on('bulletHit', (e) => {
      if (e.target !== 'ped' || e.byPlayer || e.fromX === undefined || e.fromZ === undefined) return;
      this.strayHit(e.x, e.z, e.fromX, e.fromZ);
    });
  }

  get running(): number {
    return this.fights.length;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 0.2;
      if (life.live && life.due('fight', this.fights.length)) this.lookForBarges();
    }
    for (let i = this.fights.length - 1; i >= 0; i--) {
      const f = this.fights[i];
      if (this.stepFight(f, dt)) continue;
      this.end(f);
      this.fights.splice(i, 1);
    }
  }

  reset(): void {
    for (const f of this.fights) this.end(f);
    this.fights.length = 0;
  }

  describe(out: LabelSink): void {
    for (const f of this.fights) {
      const how = f.phase === 'shove' ? 'FIGHTER (shoving)' : 'FIGHTER';
      out.ped(f.a, how, 'people');
      out.ped(f.b, how, 'people');
      labelMembers(out, f.ring.members, 'ONLOOKER', false);
    }
  }

  /** The first scuffle's middle (the in-view meter). */
  subject(out: Subject): boolean {
    const f = this.fights[0];
    if (!f) return false;
    const a = f.a.agent.s;
    const b = f.b.agent.s;
    return watch(out, (a.x + b.x) / 2, (a.z + b.z) / 2);
  }

  /** Is `c` in a scuffle here? */
  fighting(c: CrowdPed): boolean {
    for (const f of this.fights) if (f.a === c || f.b === c) return true;
    return false;
  }

  /** Someone pushed in at a queue: the one they pushed past has words, then a shove (the queue scene has let both go). False if it can't kick off now. */
  queueJump(jumper: CrowdPed, front: CrowdPed): boolean {
    if (!this.life.due('fight', this.fights.length)) return false;
    this.start(front, jumper);
    return true;
  }

  /** Debug (__ub): two passers-by nearest the player square up. */
  force(): boolean {
    const life = this.life;
    let a: CrowdPed | null = null;
    let b: CrowdPed | null = null;
    let da = Infinity;
    let db = Infinity;
    for (const c of life.d.population.crowd) {
      if (!free(c)) continue;
      const d = life.distance(c.agent.s.x, c.agent.s.z);
      if (d < da) {
        b = a;
        db = da;
        a = c;
        da = d;
      } else if (d < db) {
        b = c;
        db = d;
      }
    }
    if (!a || !b) return false;
    // Brought together.
    b.agent.s.x = a.agent.s.x + 1;
    b.agent.s.z = a.agent.s.z;
    // To blows, for the look of it.
    this.start(a, b).plan.backsDown = false;
    return true;
  }

  /** `a` shoves `b`: it's on. */
  start(a: CrowdPed, b: CrowdPed): Fight {
    const life = this.life;
    life.clock.start('fight', life.now);
    life.borrow(a);
    life.borrow(b);
    const ring =
      this.spare.pop() ??
      new Gathering(life, { kind: 'crowd', capacity: 7, draw: 22, joinChance: 0.6, stay: [8, 16], radius: 3.2 });
    const f: Fight = { a, b, phase: 'shove', timer: 0, plan: planFight(life.d.rand, b.agent.temper === 'calm', { backsDown: false, knockout: false, seconds: 0 }), ring, shoves: 0, recruitIn: 0 };
    this.fights.push(f);
    this.face(f);
    life.emit('fight', a.agent.s.x, a.agent.s.z);
    return f;
  }

  /** One fight's step; false when it's over. */
  private stepFight(f: Fight, dt: number): boolean {
    const life = this.life;
    f.timer += dt;
    const a = f.a.agent;
    const b = f.b.agent;
    const aGone = !life.present(f.a) || !a.scene || (a.mode === 'down' && a.ko);
    const bGone = !life.present(f.b) || !b.scene || (b.mode === 'down' && b.ko);
    f.ring.at((a.s.x + b.s.x) / 2, (a.s.z + b.s.z) / 2);
    if ((f.recruitIn -= dt) <= 0) {
      f.recruitIn = 0.8;
      if (roomFor(life, 2)) f.ring.recruit();
    }
    f.ring.step(dt);
    if (aGone || bGone) {
      // Knocked out (or taken away): the one left standing raises a fist.
      if (aGone !== bGone) (aGone ? f.b : f.a).model.cheer(1.5);
      return false;
    }
    if (f.phase === 'shove') {
      this.face(f);
      // A shove each way: the first at once, the reply half way.
      if (f.shoves === 0 || (f.shoves === 1 && f.timer > SHOVE_SECONDS / 2)) {
        const [from, to] = f.shoves === 0 ? [f.a, f.b] : [f.b, f.a];
        from.model.punch(0);
        to.agent.stagger = 0.3;
        const dx = to.agent.s.x - from.agent.s.x;
        const dz = to.agent.s.z - from.agent.s.z;
        const d = len2(dx, dz) || 1;
        to.agent.s.vx = (dx / d) * 2;
        to.agent.s.vz = (dz / d) * 2;
        life.d.bus.emit({ type: 'punch', x: from.agent.s.x, z: from.agent.s.z, hit: true, byPlayer: false });
        f.shoves++;
      }
      if (f.timer < SHOVE_SECONDS) return true;
      if (f.plan.backsDown) {
        // Words, a shove, and the one shoved walks off.
        scare(b, a.s.x, a.s.z, 2.5);
        return false;
      }
      f.phase = 'fists';
      f.timer = 0;
      if (f.plan.knockout) {
        const loser = life.d.rand() < 0.5 ? a : b;
        loser.hp = Math.min(loser.hp, KO_HP);
      }
      life.setOn(f.a, f.b, false, f.plan.seconds + 4);
      life.setOn(f.b, f.a, false, f.plan.seconds + 4);
      return true;
    }
    // Fists until one's knocked out or it's run its time; knocked over, the other stands over them till they're up.
    const down = a.mode === 'down' ? f.a : b.mode === 'down' ? f.b : null;
    if (down) {
      const up = down === f.a ? f.b : f.a;
      life.unfight(up);
      life.walkTo(up, up.agent.s.x, up.agent.s.z);
      life.lookAt(up, down.agent.s.x, down.agent.s.z);
      return true;
    }
    if (f.timer < f.plan.seconds) {
      // Back on their feet (or one gave up for a moment): at it again.
      if (a.mode !== 'fight') life.setOn(f.a, f.b, false, f.plan.seconds - f.timer + 2);
      if (b.mode !== 'fight') life.setOn(f.b, f.a, false, f.plan.seconds - f.timer + 2);
      return true;
    }
    // Time: the one more hurt backs off and walks away.
    const loser = a.hp <= b.hp ? f.a : f.b;
    const winner = loser === f.a ? f.b : f.a;
    life.unfight(loser);
    life.unfight(winner);
    loser.agent.mode = 'walk';
    scare(loser.agent, winner.agent.s.x, winner.agent.s.z, 3);
    winner.model.cheer(1.5);
    return false;
  }

  /** Squaring up: each faces the other, still. */
  private face(f: Fight): void {
    const a = f.a.agent.s;
    const b = f.b.agent.s;
    this.life.walkTo(f.a, a.x, a.z);
    this.life.walkTo(f.b, b.x, b.z);
    this.life.lookAt(f.a, b.x, b.z);
    this.life.lookAt(f.b, a.x, a.z);
  }

  /** Over: both handed back (anyone knocked out stays down for the ambulance), the ring disperses. */
  private end(f: Fight): void {
    handBack(this.life, f.a);
    handBack(this.life, f.b);
    f.ring.close();
    this.spare.push(f.ring);
  }

  /** Someone running barges a passer-by near the player (a ped fleeing, or the player sprinting through). */
  private lookForBarges(): void {
    const life = this.life;
    const crowd = life.d.population.crowd;
    const p = life.d.player;
    const onFoot = !p.driving && p.alive && !p.down;
    for (let j = 0; j < crowd.length; j++) {
      const b = crowd[j];
      if (!free(b) || life.distance(b.agent.s.x, b.agent.s.z) > SHOW_RANGE) continue;
      const bs = b.agent.s;
      // The player barging through: they stumble into whoever's next to them, and it kicks off between those two.
      if (onFoot && barges(p.ped.x, p.ped.z, p.ped.vx, p.ped.vz, bs.x, bs.z)) {
        const c = this.nextTo(b, 1.6);
        if (!c) continue;
        this.stumble(b, p.ped.vx, p.ped.vz);
        if (life.d.rand() < 0.7) this.start(c, b);
        else life.clock.defer('fight', life.now, 4);
        return;
      }
      for (let i = 0; i < crowd.length; i++) {
        const a = crowd[i];
        const as = a.agent.s;
        if (a === b || a.agent.mode !== 'flee' || !a.agent.street || a.agent.role !== 'civilian' || a.agent.scene || a.agent.cower > 0 || a.agent.burning > 0) continue;
        if (!barges(as.x, as.z, as.vx, as.vz, bs.x, bs.z)) continue;
        this.stumble(b, as.vx, as.vz);
        // The one barged goes after them (or shrugs it off).
        if (b.agent.temper !== 'calm' || life.d.rand() < SQUARE_UP) this.start(b, a);
        else life.clock.defer('fight', life.now, 3);
        return;
      }
    }
  }

  /** Knocked off their stride along (vx, vz). */
  private stumble(c: CrowdPed, vx: number, vz: number): void {
    const s = c.agent.s;
    const sp = len2(vx, vz) || 1;
    c.agent.stagger = 0.4;
    s.vx = (vx / sp) * 2.2;
    s.vz = (vz / sp) * 2.2;
  }

  /** A free passer-by within `within` m of `c`. */
  private nextTo(c: CrowdPed, within: number): CrowdPed | null {
    const s = c.agent.s;
    for (const o of this.life.d.population.crowd) {
      if (o === c || !free(o)) continue;
      if (Math.abs(o.agent.s.x - s.x) < within && Math.abs(o.agent.s.z - s.z) < within && len2(o.agent.s.x - s.x, o.agent.s.z - s.z) < within) return o;
    }
    return null;
  }

  /** A stray NPC round hit someone at (x, z): if they've a temper (or one in three), they go for whoever fired it, if that's a passer-by. */
  private strayHit(x: number, z: number, fromX: number, fromZ: number): void {
    const life = this.life;
    if (!life.live || !life.due('fight', this.fights.length)) return;
    let victim: CrowdPed | null = null;
    let shooter: CrowdPed | null = null;
    for (const c of life.d.population.crowd) {
      const s = c.agent.s;
      if (!victim && len2(s.x - x, s.z - z) < 0.8) victim = c;
      else if (!shooter && len2(s.x - fromX, s.z - fromZ) < 1.2) shooter = c;
    }
    if (!victim || !shooter || victim === shooter) return;
    const v = victim.agent;
    const s = shooter.agent;
    if (!v.street || v.scene || v.role !== 'civilian' || v.mode === 'down' || v.injured) return;
    if (!s.street || s.role !== 'civilian' || s.mode === 'down' || s.scene) return;
    if (v.temper === 'calm' && life.d.rand() > 0.33) return;
    if (life.distance(v.s.x, v.s.z) > SHOW_RANGE) return;
    this.start(victim, shooter);
  }
}

/** An ordinary passer-by walking about, free to get into something. */
function free(c: CrowdPed): boolean {
  const a = c.agent;
  return a.street === true && !a.scene && a.role === 'civilian' && a.mode === 'walk' && a.burning <= 0 && !a.injured && a.stagger <= 0;
}
