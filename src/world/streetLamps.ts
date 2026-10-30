/**
 * Street lamps: posts along every sidewalk, on a fixed pattern so the
 * renderer can both place the posts and light the ground, walls, cars and
 * people under them analytically in shaders (no real lights: see
 * render/shaderLib.ts `ubStreetLight`, which uses these same constants).
 * Pure data, no three.js.
 */
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH } from './city';

/**
 * Posts stand this far from the road centreline: 0.5 m in from the kerb, so
 * people (who walk the middle of the 3 m sidewalk) pass beside them.
 */
export const LAMP_OFFSET = ROAD_WIDTH / 2 + 0.5;
/** Spacing along a block side; the posts sit at 1, 2 and 3 × this from the block's corner. */
export const LAMP_SPACING = 16;
/** Height of the lamp head's underside, m (props.glb `streetlamp`: the `lamp` face at 5.87 m). */
export const LAMP_HEIGHT = 5.87;
/** How far the arm reaches out over the road, m (the model's head is 1.85 m out from the pole). */
export const LAMP_ARM = 1.85;

export interface StreetLamp {
  /** Post position. */
  x: number;
  z: number;
  /** Unit vector from the post toward the road: the way the arm points. */
  dx: number;
  dz: number;
}

/** Every lamp in the city: three per block side, all four sides of every block. */
export function generateStreetLamps(): StreetLamp[] {
  const out: StreetLamp[] = [];
  for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
    for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
      const x0 = -HALF_EXTENT + bx * BLOCK_SIZE;
      const z0 = -HALF_EXTENT + bz * BLOCK_SIZE;
      for (let k = 1; k * LAMP_SPACING < BLOCK_SIZE; k++) {
        const a = k * LAMP_SPACING;
        out.push({ x: x0 + LAMP_OFFSET, z: z0 + a, dx: -1, dz: 0 }); // west side
        out.push({ x: x0 + BLOCK_SIZE - LAMP_OFFSET, z: z0 + a, dx: 1, dz: 0 }); // east side
        out.push({ x: x0 + a, z: z0 + LAMP_OFFSET, dx: 0, dz: -1 }); // north side
        out.push({ x: x0 + a, z: z0 + BLOCK_SIZE - LAMP_OFFSET, dx: 0, dz: 1 }); // south side
      }
    }
  }
  return out;
}
