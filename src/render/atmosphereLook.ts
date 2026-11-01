/**
 * The street's mood on screen: umbrellas up over walkers in the rain
 * (game/scenes/streetMood.ts says who) and the stray dogs
 * (game/scenes/strayDogs.ts), both in the props' `things` family
 * (render/critterModels.ts builds the stand-in models): no mesh or program
 * of their own. The dogs swap a standing and a mid-stride pose for their
 * trot, dip their nose to sniff and lie on their side when knocked over.
 * Nothing allocates per frame.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { CityLife } from '../game/cityLife';
import type { Rect } from '../world/city';
import { near, type CityLookPart } from './cityLifeLook';
import type { WorldProps } from './worldProps';

/** Umbrella colours (linear RGB), by StreetMood's colour index. */
const UMBRELLAS: readonly (readonly [number, number, number])[] = [
  [0.02, 0.02, 0.025],
  [0.05, 0.1, 0.32],
  [0.55, 0.04, 0.04],
  [0.8, 0.55, 0.04],
  [0.6, 0.6, 0.64],
  [0.06, 0.26, 0.1],
];
/** Dog coats (linear RGB), by Dog.coat. */
const COATS: readonly (readonly [number, number, number])[] = [
  [0.5, 0.3, 0.13],
  [0.11, 0.09, 0.08],
  [0.2, 0.1, 0.045],
  [0.32, 0.32, 0.33],
  [0.75, 0.62, 0.4],
];
/** Dogs drawn a touch over life size, so they read from the street camera. */
const DOG_SCALE = 1.3;

export function atmosphereLook(life: CityLife): CityLookPart {
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler(0, 0, 0, 'YXZ');
  const p = new Vector3();
  const s = new Vector3(DOG_SCALE, DOG_SCALE, DOG_SCALE);
  return {
    draw(_glows, view: Rect, props: WorldProps) {
      if (!props.loaded) return;
      const things = props.things;
      // Umbrellas over walkers in the rain.
      const mood = life.streetMood;
      for (let i = 0; i < mood.umbrellas.length; i++) {
        const c = mood.umbrellas[i];
        const at = c.model.root.position;
        if (!c.model.root.visible || c.agent.mode === 'down' || !near(view, at.x, at.z, 2)) continue;
        const [r, g, b] = UMBRELLAS[mood.umbrellaColour[i]];
        things.add('umbrella', at.x, 0, at.z, c.agent.s.heading, 1, 1, 1, 0, 0, r, g, b);
      }
      // Stray dogs.
      for (const d of life.dogs.pack.dogs) {
        if (!near(view, d.x, d.z, 2)) continue;
        const moving = d.speed > 0.2;
        const down = d.mode === 'down';
        const kind = moving && d.stride < 0.5 ? 'dog_stride' : 'dog';
        const bob = moving ? Math.abs(Math.sin(d.stride * Math.PI * 2)) * 0.04 : 0;
        e.set(d.mode === 'sniff' ? 0.22 : 0, d.heading, down ? Math.PI / 2 : 0);
        q.setFromEuler(e);
        p.set(d.x, down ? 0.16 : bob, d.z);
        m.compose(p, q, s);
        const [r, g, b] = COATS[d.coat % COATS.length];
        things.addMatrix(kind, m, 0, 0, r, g, b);
      }
    },
  };
}
