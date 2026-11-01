/**
 * Shared by the people scenes (buses, carts, the ice cream van, buskers,
 * scuffles, muggings, witnesses): a cap on how many people the scenes hold
 * at once (they come on top of the crowd's own count, so each costs a
 * body to pose and draw), and letting go of someone borrowed.
 */
import type { BodyKind } from '../bodies';
import type { CrowdPed } from '../population';
import type { SceneCtx } from '../cityLife';

/** The scenes hold at most this many people; past it, nobody new is drawn in (queues and crowds wait). */
export const PEOPLE_CAP = 24;

/** Room for another person in a scene? */
export function roomFor(life: SceneCtx, n = 1): boolean {
  return life.people.length + n <= PEOPLE_CAP;
}

/**
 * A body for someone a scene puts on the street (a vendor, a busker, a
 * rider): the body of a passer-by already out, so no body the street isn't
 * already drawing comes in (each body is its own batch: a draw call and a
 * shadow pass). Undefined (any crowd body) if nobody's about.
 */
export function streetBody(life: SceneCtx): BodyKind | undefined {
  const crowd = life.d.population.crowd;
  // From a random place in the list, so the bodies stay as mixed as the street's.
  const from = Math.floor(life.d.rand() * crowd.length);
  for (let k = 0; k < crowd.length; k++) {
    const c = crowd[(from + k) % crowd.length];
    if (c.agent.street && c.agent.role === 'civilian') return c.model.bodyKind;
  }
  return undefined;
}

/**
 * Hand someone back to walk on, or, if they're lying there, leave them
 * lying (the knocked out stay down for the ambulance, scenes/medics.ts,
 * which only takes people no scene holds).
 */
export function handBack(life: SceneCtx, c: CrowdPed): void {
  c.phone = false;
  if (!life.present(c) || !c.agent.scene) return;
  if (c.agent.mode !== 'down') {
    life.giveBack(c);
    return;
  }
  life.unfight(c);
  c.agent.scene = false;
  const i = life.people.indexOf(c);
  if (i >= 0) life.people.splice(i, 1);
}
