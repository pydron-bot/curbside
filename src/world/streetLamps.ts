/**
 * Street lamps: posts along every sidewalk, on a fixed pattern so the
 * renderer can both place the posts and light the ground, walls, cars and
 * people under them analytically in shaders (no real lights: see
 * render/shaderLib.ts `ubStreetLight`, which uses these same constants).
 * Pure data, no three.js.
 */
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH } from './city';
import { STREET_REMOVED, roadRules } from './roadRules';

/**
 * Posts stand this far from the road centreline: 0.5 m in from the kerb, so
 * people (who walk the middle of the 3 m sidewalk) pass beside them.
 */
export const LAMP_OFFSET = ROAD_WIDTH / 2 + 0.5;
/** Spacing along a block side; the posts sit at 1, 2 and 3 × this from the block's corner. */
export const LAMP_SPACING = 16;
/** Merged blocks (round 3) whose lamps the shaders put out (render/shaderLib.ts uDarkLamps); past this many, the rest keep a pool of light with no post. */
export const DARK_LAMP_SLOTS = 8;
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

/** Is there no road along side `side` (0 N, 1 E, 2 S, 3 W) of block (bx, bz) any more (round 3: removed, so its lamps went with it)? */
function sideGone(bx: number, bz: number, side: number): boolean {
  const rules = roadRules();
  return rules.merges.length > 0 && rules.sideStreet(bx - BLOCKS_PER_SIDE / 2, bz - BLOCKS_PER_SIDE / 2, side) === STREET_REMOVED;
}

/** Every lamp in the city: three per block side, all four sides of every block (but along a removed road). */
export function generateStreetLamps(): StreetLamp[] {
  const out: StreetLamp[] = [];
  for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
    for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
      const x0 = -HALF_EXTENT + bx * BLOCK_SIZE;
      const z0 = -HALF_EXTENT + bz * BLOCK_SIZE;
      const [n, e, s, w] = [0, 1, 2, 3].map((side) => !sideGone(bx, bz, side));
      for (let k = 1; k * LAMP_SPACING < BLOCK_SIZE; k++) {
        const a = k * LAMP_SPACING;
        if (w) out.push({ x: x0 + LAMP_OFFSET, z: z0 + a, dx: -1, dz: 0 }); // west side
        if (e) out.push({ x: x0 + BLOCK_SIZE - LAMP_OFFSET, z: z0 + a, dx: 1, dz: 0 }); // east side
        if (n) out.push({ x: x0 + a, z: z0 + LAMP_OFFSET, dx: 0, dz: -1 }); // north side
        if (s) out.push({ x: x0 + a, z: z0 + BLOCK_SIZE - LAMP_OFFSET, dx: 0, dz: 1 }); // south side
      }
    }
  }
  return out;
}

/**
 * The lamps' light reaches this far (squared, m², from the head): the shaders'
 * falloff (render/shaderLib.ts `ubLampTerm`) is zero beyond it.
 */
export const LAMP_REACH2 = 132;
/** A head hangs this far from its road's centreline (the post's offset less the arm). */
const HEAD_OFFSET = LAMP_OFFSET - LAMP_ARM;
const REACH = Math.sqrt(LAMP_REACH2);

/**
 * The lamp heads whose light can reach anything within `radius` of (x, z)
 * (horizontally: the reach is in 3D, so this errs wide). Writes the first
 * `max` as x, z pairs into `out` from `o` and returns how many there are in
 * all (more than `max`: the caller can't use the short list). The same
 * layout as generateStreetLamps, the heads `LAMP_ARM` out over the road; it
 * only looks beside the two road lines either side of the point, so a radius
 * past half a block would miss lamps. Allocates nothing.
 */
export function lampsNear(x: number, z: number, radius: number, out: Float32Array, o: number, max: number): number {
  const r = REACH + radius;
  const r2 = r * r;
  let n = 0;
  // dir 0: lamps beside the north-south roads (u = x across them, v = z along); dir 1: east-west.
  for (let dir = 0; dir < 2; dir++) {
    const u = dir === 0 ? x : z;
    const v = dir === 0 ? z : x;
    const first = Math.floor((u + HALF_EXTENT) / BLOCK_SIZE);
    for (let line = first; line <= first + 1; line++) {
      if (line < 0 || line > BLOCKS_PER_SIDE) continue;
      for (let side = -1; side <= 1; side += 2) {
        // A road's lamps stand on the blocks either side of it (none beyond the city's edge).
        const block = side < 0 ? line - 1 : line;
        if (block < 0 || block >= BLOCKS_PER_SIDE) continue;
        const du = line * BLOCK_SIZE - HALF_EXTENT + side * HEAD_OFFSET - u;
        if (du * du >= r2) continue;
        const b0 = Math.max(0, Math.floor((v - r + HALF_EXTENT) / BLOCK_SIZE));
        const b1 = Math.min(BLOCKS_PER_SIDE - 1, Math.floor((v + r + HALF_EXTENT) / BLOCK_SIZE));
        for (let b = b0; b <= b1; b++) {
          if (dir === 0 ? sideGone(block, b, side < 0 ? 1 : 3) : sideGone(b, block, side < 0 ? 2 : 0)) continue;
          for (let k = 1; k * LAMP_SPACING < BLOCK_SIZE; k++) {
            const dv = b * BLOCK_SIZE - HALF_EXTENT + k * LAMP_SPACING - v;
            if (du * du + dv * dv >= r2) continue;
            if (n < max) {
              out[o + n * 2] = dir === 0 ? u + du : v + dv;
              out[o + n * 2 + 1] = dir === 0 ? v + dv : u + du;
            }
            n++;
          }
        }
      }
    }
  }
  return n;
}
