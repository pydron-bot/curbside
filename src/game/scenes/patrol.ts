/**
 * A patrol sent to the player's mess (V2-10: an adopted crash, shots called
 * in). A ServiceRun police car, lights on, then an officer out to do what
 * the scene asks (walkTo / lookAt on `officer`), back in and away.
 *
 * Heat: the car and officer are the scene's, not the police force's, so
 * they never see, chase or bust the player. On arrival (systems/mess.ts
 * patrolArrives) a player who's wanted and still within STILL_THERE is
 * handed the car for their pursuit (CityLifeDeps.adopt → heat.adopt: a unit
 * from then on, under the usual rules); one who's gone gets nothing, and
 * the officer takes a statement.
 */
import { COP_OUTFIT } from '../../systems/police';
import { patrolArrives } from '../../systems/mess';
import type { CrowdPed, Vehicle } from '../population';
import type { SceneCtx } from '../cityLife';
import { ServiceRun, type ServiceSpec } from './service';
import { len2 } from '../../core/len';

export const PATROL_CALL: ServiceSpec = {
  archetype: 'police',
  paint: '#f2f2f2',
  claimRange: 140,
  emergency: true,
  cruise: 17,
  top: 26,
  arrive: 16,
  timeout: 60,
  aheadShare: 0.4,
};

/** Walking back to the car: given up (they get in where they are) after this long, s. */
const BACK_FOR = 12;

/** On the way, there, handed to the player's pursuit, or gone (left, lost, timed out). */
export type PatrolStep = 'coming' | 'onSite' | 'joined' | 'gone';

export class Patrol {
  officer: CrowdPed | null = null;
  private leaving = false;
  private arrived = false;
  private back = 0;
  /** The car's door, for the walk back (the car's standing still). */
  private door = { x: 0, z: 0 };

  private constructor(
    private readonly life: SceneCtx,
    private run: ServiceRun | null,
  ) {}

  /** A patrol car to (x, z), or null if there's none to send. */
  static call(life: SceneCtx, x: number, z: number): Patrol | null {
    const run = ServiceRun.call(life, PATROL_CALL, x, z);
    return run ? new Patrol(life, run) : null;
  }

  /** The car while it's the scene's. */
  get v(): Vehicle | null {
    return this.run?.v ?? null;
  }

  step(dt: number): PatrolStep {
    const run = this.run;
    if (!run) return 'gone';
    const life = this.life;
    if (this.leaving) {
      const o = this.officer;
      this.back += dt;
      if (o && life.present(o)) {
        life.walkTo(o, this.door.x, this.door.z);
        const up = o.agent.mode !== 'down';
        if (up && len2(o.agent.s.x - this.door.x, o.agent.s.z - this.door.z) > 1.6 && this.back < BACK_FOR) return 'onSite';
        // In the car (or picked up off the road by their partner, as the accidents' officers are).
        life.removePed(o);
      }
      this.officer = null;
      run.leave();
      run.step(0);
      this.run = null;
      return 'gone';
    }
    const phase = run.step(dt);
    if (phase === 'done' || phase === 'failed') {
      this.end();
      return 'gone';
    }
    if (phase !== 'onSite') return 'coming';
    if (!this.arrived) {
      this.arrived = true;
      const at = life.d.player.position;
      const stars = life.d.playing() ? life.d.stars() : 0;
      const d = len2(at.x - run.v.sim.x, at.z - run.v.sim.z);
      if (patrolArrives(stars, d) === 'joinPursuit' && life.d.adopt?.(run.v, 1)) {
        // The police own it now: off the director's list (it would retire it once far off).
        const i = life.owned.indexOf(run.v);
        if (i >= 0) life.owned.splice(i, 1);
        this.run = null;
        return 'joined';
      }
    }
    return 'onSite';
  }

  /** The officer, out of the car's door once it's on site (null before, or once gone). */
  out(): CrowdPed | null {
    const run = this.run;
    if (!run || !this.arrived || this.leaving) return null;
    if (!this.officer) {
      const door = this.life.doorOf(run.v.sim);
      this.officer = this.life.addPed(door.x, door.z, run.v.sim.heading, COP_OUTFIT, 'cop');
      this.officer.agent.role = 'cop';
    }
    return this.officer;
  }

  /** Done here: the officer back in and the car away. */
  leave(): void {
    if (!this.run || this.leaving) return;
    this.leaving = true;
    this.door = this.life.doorOf(this.run.v.sim);
  }

  /** Stop now (a fresh run, the scene dropped): the officer off the street, the car back to traffic. */
  end(): void {
    const o = this.officer;
    if (o && this.life.present(o)) this.life.removePed(o);
    this.officer = null;
    this.run?.end();
    this.run = null;
  }
}
