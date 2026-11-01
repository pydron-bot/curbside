/**
 * Walkers step round people standing in their way: a scene's people held
 * standing on the pavement (a cart's first customer on the walking line,
 * the ice cream queue, onlookers, a busker's crowd, someone on the phone).
 * People don't otherwise collide with each other, so without this a walker
 * would walk straight through a queue. Each step, any walker closer than
 * CLEAR to someone a scene holds standing is eased sideways across their
 * way (systems/streetPeople.ts sidestep), so they pass round and carry on
 * to their corner; static collision runs after, so nobody's pushed into a
 * wall. Nothing is started, nothing held: no clock of its own.
 */
import { sidestep } from '../../systems/streetPeople';
import type { Scene, SceneCtx } from '../cityLife';

/** Walkers keep this far from someone standing, m. */
const CLEAR = 0.75;
/** At most this sideways per second, m/s. */
const STEP_SPEED = 2.4;
/** A scene's person moving slower than this counts as standing, m/s. */
const STANDING = 0.4;

export class Pavement implements Scene {
  readonly kind = 'pavement';
  readonly running = 0;
  private readonly out = { x: 0, z: 0 };

  constructor(private readonly life: SceneCtx) {}

  step(dt: number): void {
    const people = this.life.people;
    if (people.length === 0) return;
    const crowd = this.life.d.population.crowd;
    const max = STEP_SPEED * dt;
    for (let i = 0; i < crowd.length; i++) {
      const a = crowd[i].agent;
      if (a.mode !== 'walk' || a.scene) continue;
      const s = a.s;
      for (let j = 0; j < people.length; j++) {
        const o = people[j].agent;
        if (o.mode === 'down' || o.s.vx * o.s.vx + o.s.vz * o.s.vz > STANDING * STANDING) continue;
        if (sidestep(s.x, s.z, s.vx, s.vz, o.s.x, o.s.z, CLEAR, max, this.out)) {
          s.x = this.out.x;
          s.z = this.out.z;
        }
      }
    }
  }

  reset(): void {}
}
