/**
 * Neon in the wet road (0.23.0): every shopfront tube, rooftop tube and roof
 * sign, mirrored under the ground as the camera sees it and smeared toward
 * the viewer as a streak in its own colour, at night (stronger in the rain).
 * The ground shader does the street lamps (ground.ts gLampGlints); this does
 * the coloured lights, as glow sprites in the shared batch. The sources are
 * listed once at load (pure, tests/neonReflect.test.ts); a frame walks them
 * with a bounds check and allocates nothing.
 */
import { AWNING_DEPTH, AWNING_HEIGHT, type BuildingPlan } from '../world/buildingPlans';
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, type Building, type Rect } from '../world/city';
import { STREET_ROAD, roadRules } from '../world/roadRules';

/** Floats per source: x, z, height, length, r, g, b (linear). */
export const SOURCE_STRIDE = 7;
/** Long roof edges reflect in pieces about this long (one streak each). */
const PIECE = 7;

const OUTWARD = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/** sRGB hex string → linear rgb into out at o. */
function linear(hex: string, out: Float32Array, o: number): void {
  const v = parseInt(hex.slice(1), 16);
  out[o] = (((v >> 16) & 255) / 255) ** 2.2;
  out[o + 1] = (((v >> 8) & 255) / 255) ** 2.2;
  out[o + 2] = ((v & 255) / 255) ** 2.2;
}

/** Every neon light in the city that can shine in the road, packed SOURCE_STRIDE floats each. */
export function neonSources(buildings: readonly Building[], plans: readonly BuildingPlan[]): Float32Array {
  const list: Array<[number, number, number, number, string]> = [];
  buildings.forEach((b, i) => {
    const plan = plans[i];
    const face = (side: number) => (side === 0 ? b.minZ : side === 1 ? b.maxX : side === 2 ? b.maxZ : b.minX);
    for (const s of plan.shopfronts) {
      if (!s.neon) continue;
      const [ox, oz] = OUTWARD[s.side];
      const alongX = s.side === 0 || s.side === 2;
      const mid = (s.from + s.to) / 2;
      const f = face(s.side);
      list.push([alongX ? mid : f + ox * AWNING_DEPTH, alongX ? f + oz * AWNING_DEPTH : mid, AWNING_HEIGHT - 0.4, s.to - s.from, s.neon]);
    }
    const n = plan.roofNeon;
    if (!n) return;
    for (let side = 0; side < 4; side++) {
      if (!(n.edges & (1 << side))) continue;
      const alongX = side === 0 || side === 2;
      const lo = alongX ? b.minX : b.minZ;
      const hi = alongX ? b.maxX : b.maxZ;
      const pieces = Math.max(1, Math.round((hi - lo) / PIECE));
      const step = (hi - lo) / pieces;
      const f = face(side);
      for (let k = 0; k < pieces; k++) {
        const at = lo + step * (k + 0.5);
        list.push([alongX ? at : f, alongX ? f : at, b.height, step, n.colour]);
      }
    }
    if (n.sign) {
      const s = n.sign;
      const alongX = s.side === 0 || s.side === 2;
      const mid = (s.from + s.to) / 2;
      const f = face(s.side);
      list.push([alongX ? mid : f, alongX ? f : mid, b.height + 0.7, s.to - s.from, s.colour]);
    }
  });
  const out = new Float32Array(list.length * SOURCE_STRIDE);
  list.forEach(([x, z, h, len, hex], i) => {
    const o = i * SOURCE_STRIDE;
    out[o] = x;
    out[o + 1] = z;
    out[o + 2] = h;
    out[o + 3] = len;
    linear(hex, out, o + 4);
  });
  return out;
}

/** A light's reflection in the wet ground and the way its streak runs. */
export interface Glint {
  /** Where the mirrored light appears on the ground. */
  x: number;
  z: number;
  /** The streak's heading (toward the viewer's nadir; 0 = +Z), and its length, m. */
  heading: number;
  length: number;
}

/**
 * A light at (x, h, z) mirrored under the ground, seen from the eye: where it
 * lands on the ground (a little toward the eye's nadir) and the streak's
 * heading toward the viewer and length (taller lights smear further).
 */
export function glintOf(x: number, z: number, h: number, ex: number, ey: number, ez: number, out: Glint): Glint {
  const t = ey / (ey + h);
  out.x = ex + (x - ex) * t;
  out.z = ez + (z - ez) * t;
  const dx = ex - out.x;
  const dz = ez - out.z;
  out.heading = dx * dx + dz * dz > 1e-6 ? Math.atan2(dx, dz) : 0;
  out.length = Math.min(8, 2.4 + h * 0.4);
  return out;
}

/** Is (x, z) inside the view (with a margin)? */
export function inView(view: Rect, x: number, z: number, margin: number): boolean {
  return x >= view.minX - margin && x <= view.maxX + margin && z >= view.minZ - margin && z <= view.maxZ + margin;
}

/** Is (x, z) on a road (within half a road's width of a centreline)? Neon streaks only show there: the damp is on the roads. */
export function onRoad(x: number, z: number): boolean {
  const half = ROAD_WIDTH / 2;
  const lx = (((x + HALF_EXTENT) % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE;
  const lz = (((z + HALF_EXTENT) % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE;
  if (!(lx < half || lx > BLOCK_SIZE - half || lz < half || lz > BLOCK_SIZE - half)) return false;
  // A removed road (round 3) is a merged block's land; a pedestrian street's paving isn't damp road either.
  const rules = roadRules();
  if (!rules.streets) return true;
  if (rules.mergeAt(Math.floor(x / BLOCK_SIZE), Math.floor(z / BLOCK_SIZE))) {
    const m = rules.mergeAt(Math.floor(x / BLOCK_SIZE), Math.floor(z / BLOCK_SIZE))!;
    if (x > m.ix * BLOCK_SIZE + half && x < (m.ix + m.w) * BLOCK_SIZE - half && z > m.iz * BLOCK_SIZE + half && z < (m.iz + m.h) * BLOCK_SIZE - half) return false;
  }
  const ix = Math.round(x / BLOCK_SIZE);
  const iz = Math.round(z / BLOCK_SIZE);
  const onNS = Math.abs(x - ix * BLOCK_SIZE) < half;
  const onEW = Math.abs(z - iz * BLOCK_SIZE) < half;
  if (onNS && !onEW) return rules.streetOf(ix, Math.floor(z / BLOCK_SIZE), ix, Math.floor(z / BLOCK_SIZE) + 1) === STREET_ROAD;
  if (onEW && !onNS) return rules.streetOf(Math.floor(x / BLOCK_SIZE), iz, Math.floor(x / BLOCK_SIZE) + 1, iz) === STREET_ROAD;
  return true;
}
