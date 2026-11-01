/**
 * People gathering: the primitive behind every queue and crowd (the ice
 * cream van's queue, people waiting at a bus stop, a stand's line, a
 * busker's audience, onlookers round a wreck).
 *
 *   const g = new Gathering(life, { kind: 'queue', capacity: 5, draw: 30, joinChance: 0.6, serveEvery: 3.2, side: 2.2 });
 *   g.at(van.x, van.z, van.heading);      // where (call again if it moves)
 *   // ~once a second: g.recruit();        // calm passers-by within `draw` come over
 *   // each step:
 *   const served = g.step(dt);            // walks everyone to their place; the one served (queue)
 *                                         // or done watching (crowd) is handed back, walking on
 *   g.close();                            // everyone disperses
 *
 * 'queue': a line at a hatch `side` m to the right of the anchor's
 * heading (the kerb side of a vehicle), back along the pavement a pace
 * apart (world/streetSpots.ts queueSpot); the front one is served every
 * `serveEvery` s once at the hatch (systems/cityScenes.ts ServeQueue).
 * 'crowd': rings `radius` m round the anchor (an `arc` centred on its
 * heading, or all round), facing in (crowdSpot); each stays a random
 * `stay` s. Members are borrowed from the crowd (`scene`) and handed back
 * by the director (they walk on); anyone scared off, knocked down or
 * pulled away by something else drops out. Only ordinary passers-by
 * (`street`, calm, walking) are recruited; add() takes anyone (people a
 * scene put there itself).
 */
import { ServeQueue } from '../../systems/cityScenes';
import { crowdSpot, queueSpot } from '../../world/streetSpots';
import type { CrowdPed } from '../population';
import type { SceneCtx } from '../cityLife';
import { len2 } from '../../core/len';

export interface GatherSpec {
  kind: 'queue' | 'crowd';
  capacity: number;
  /** recruit() brings calm passers-by within this distance of the anchor, m... */
  draw: number;
  /** ...each with this chance (per recruit() call they're seen in). */
  joinChance: number;
  /** queue: one served every this many seconds once at the hatch. */
  serveEvery?: number;
  /** queue: the hatch is this far to the right of the anchor's heading, m. */
  side?: number;
  /** crowd: each stays this long, s (random in the range). */
  stay?: readonly [number, number];
  /** crowd: the first ring's radius, m, and the arc (rad, centred on the heading) it fills. */
  radius?: number;
  arc?: number;
}

/** The front of a queue counts as at the hatch this close, m. */
const AT_HATCH = 0.8;

export class Gathering {
  readonly members: CrowdPed[] = [];
  private readonly queue: ServeQueue<CrowdPed> | null;
  /** crowd: the sim time each member leaves. */
  private readonly until = new Map<CrowdPed, number>();
  private x = 0;
  private z = 0;
  private heading = 0;
  private readonly spot = { x: 0, z: 0, heading: 0 };

  constructor(
    private readonly life: SceneCtx,
    readonly spec: GatherSpec,
  ) {
    this.queue = spec.kind === 'queue' ? new ServeQueue<CrowdPed>(spec.serveEvery ?? 3, spec.capacity) : null;
  }

  /** The anchor: a van's middle and heading, a busker's spot and the way they face. */
  at(x: number, z: number, heading = 0): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
  }

  get full(): boolean {
    return this.members.length >= this.spec.capacity;
  }

  /** Put someone in (borrowed for the scene). False if full or already in. */
  add(c: CrowdPed): boolean {
    if (this.full || this.members.includes(c)) return false;
    if (this.queue && !this.queue.join(c)) return false;
    this.life.borrow(c);
    this.members.push(c);
    if (!this.queue) {
      const [lo, hi] = this.spec.stay ?? [10, 20];
      this.until.set(c, this.life.now + lo + this.life.d.rand() * (hi - lo));
    }
    return true;
  }

  /** Calm passers-by walking within `draw` of the anchor come over (call about once a second). */
  recruit(): void {
    const life = this.life;
    const spec = this.spec;
    for (const c of life.d.population.crowd) {
      if (this.full) return;
      const a = c.agent;
      if (!a.street || a.scene || a.mode !== 'walk' || a.temper !== 'calm' || a.burning > 0 || a.role !== 'civilian') continue;
      if (Math.abs(a.s.x - this.x) > spec.draw || Math.abs(a.s.z - this.z) > spec.draw) continue;
      if (len2(a.s.x - this.x, a.s.z - this.z) > spec.draw || life.d.rand() > spec.joinChance) continue;
      this.add(c);
    }
  }

  /**
   * Each step: drop anyone gone or scared off, walk everyone to their
   * place facing the hatch / the middle, and serve (queue) or let go
   * (crowd) whoever's done. Returns that one (handed back, walking on),
   * or null.
   */
  step(dt: number): CrowdPed | null {
    const life = this.life;
    for (let i = this.members.length - 1; i >= 0; i--) {
      const c = this.members[i];
      const a = c.agent;
      if (!life.present(c) || !a.scene || a.mode === 'down' || a.mode === 'flee' || a.mode === 'fight' || a.mode === 'shoot') {
        this.drop(i);
        if (life.present(c) && a.scene && a.mode !== 'down') life.giveBack(c);
      }
    }
    for (let i = 0; i < this.members.length; i++) {
      const c = this.members[i];
      const p = this.place(i);
      life.walkTo(c, p.x, p.z);
      life.lookAt(c, p.x + Math.sin(p.heading) * 3, p.z + Math.cos(p.heading) * 3);
    }
    let done: CrowdPed | null = null;
    if (this.queue) {
      const front = this.members[0];
      const hatch = this.place(0);
      const ready = front !== undefined && len2(front.agent.s.x - hatch.x, front.agent.s.z - hatch.z) < AT_HATCH;
      done = this.queue.step(dt, ready);
      if (done) this.members.splice(this.members.indexOf(done), 1);
    } else {
      const now = life.now;
      for (let i = 0; i < this.members.length; i++) {
        if ((this.until.get(this.members[i]) ?? 0) > now) continue;
        done = this.members[i];
        this.drop(i);
        break;
      }
    }
    if (done) life.giveBack(done);
    return done;
  }

  /** Everyone walks off. */
  close(): void {
    for (const c of this.members) if (this.life.present(c) && c.agent.scene) this.life.giveBack(c);
    this.members.length = 0;
    this.queue?.clear();
    this.until.clear();
  }

  /** Where the `i`th member stands. */
  private place(i: number): { x: number; z: number; heading: number } {
    const s = this.spec;
    if (this.queue) return queueSpot(this.x, this.z, this.heading, s.side ?? 2, i, this.spot);
    return crowdSpot(this.x, this.z, s.radius ?? 3, i, this.spot, this.heading, s.arc ?? Math.PI * 2);
  }

  private drop(i: number): void {
    const c = this.members[i];
    this.members.splice(i, 1);
    this.queue?.leave(c);
    this.until.delete(c);
  }
}
