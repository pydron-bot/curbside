/**
 * The street's mood on screen: umbrellas up over walkers in the rain
 * (game/scenes/streetMood.ts says who), in the props' `things` family
 * (render/critterModels.ts builds the stand-in model): no mesh or program
 * of its own. Nothing allocates per frame.
 */
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

export function atmosphereLook(life: CityLife): CityLookPart {
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
    },
  };
}
