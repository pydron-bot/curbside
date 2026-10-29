/**
 * Procedural city layout. Pure data (no three.js) so it's testable and the
 * renderer, collision and later AI all read the same description.
 *
 * Layout: a square grid of BLOCK_SIZE blocks. Road centrelines run along the
 * block edges (multiples of BLOCK_SIZE from the origin), so (0,0) is an
 * intersection. Each block is a road band, a sidewalk ring, then a buildable
 * interior that becomes buildings, a park or a plaza.
 */
import { mulberry32 } from './random';

export const BLOCK_SIZE = 64;
export const ROAD_WIDTH = 16;
export const SIDEWALK = 3;
export const BLOCKS_PER_SIDE = 16;
/** Half the city's extent; roads at ±HALF_EXTENT are the outer ring road. */
export const HALF_EXTENT = (BLOCKS_PER_SIDE * BLOCK_SIZE) / 2;
/** Boundary walls sit just outside the outer ring road. */
export const WORLD_LIMIT = HALF_EXTENT + ROAD_WIDTH / 2 + 1;

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Building extends Rect {
  height: number;
  /** 0..1, used to pick a colour. */
  tint: number;
  /** Optional rooftop box (AC unit / stairwell), in world coords. */
  roofBox?: Rect & { height: number };
}

export interface Tree {
  x: number;
  z: number;
  /** Canopy radius, m. */
  radius: number;
}

export type BlockKind = 'buildings' | 'park' | 'plaza';

export interface Block {
  bx: number;
  bz: number;
  kind: BlockKind;
  /** Buildable interior (inside the sidewalk). */
  interior: Rect;
}

export interface City {
  seed: number;
  blocks: Block[];
  buildings: Building[];
  trees: Tree[];
  /** Static obstacles for collision: buildings, tree trunks, boundary walls. */
  obstacles: Rect[];
}

/** Interior of block (bx, bz), bx/bz in 0..BLOCKS_PER_SIDE-1. */
export function blockInterior(bx: number, bz: number): Rect {
  const inset = ROAD_WIDTH / 2 + SIDEWALK;
  const x0 = -HALF_EXTENT + bx * BLOCK_SIZE;
  const z0 = -HALF_EXTENT + bz * BLOCK_SIZE;
  return { minX: x0 + inset, minZ: z0 + inset, maxX: x0 + BLOCK_SIZE - inset, maxZ: z0 + BLOCK_SIZE - inset };
}

export function generateCity(seed = 1337): City {
  const rand = mulberry32(seed);
  const blocks: Block[] = [];
  const buildings: Building[] = [];
  const trees: Tree[] = [];

  for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
    for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
      const interior = blockInterior(bx, bz);
      const cx = (interior.minX + interior.maxX) / 2;
      const cz = (interior.minZ + interior.maxZ) / 2;
      // 0 at the centre of town, 1 at the edge: drives height and density.
      const fromCentre = Math.min(1, Math.hypot(cx, cz) / HALF_EXTENT);

      const roll = rand();
      const kind: BlockKind = roll < 0.1 ? 'park' : roll < 0.16 ? 'plaza' : 'buildings';
      blocks.push({ bx, bz, kind, interior });

      if (kind === 'buildings') {
        for (const lot of subdivide(interior, rand, 0)) {
          buildings.push(makeBuilding(lot, fromCentre, rand));
        }
      } else if (kind === 'park') {
        plantTrees(interior, rand, trees);
      }
    }
  }

  const obstacles: Rect[] = [
    ...buildings,
    ...trees.map((t) => ({ minX: t.x - 0.4, minZ: t.z - 0.4, maxX: t.x + 0.4, maxZ: t.z + 0.4 })),
    ...boundaryWalls(),
  ];
  return { seed, blocks, buildings, trees, obstacles };
}

/** Split a lot recursively into building plots, sometimes leaving an alley. */
function subdivide(r: Rect, rand: () => number, depth: number): Rect[] {
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  const longest = Math.max(w, d);
  const shouldSplit = longest > 34 || (longest > 16 && rand() < 0.75 - depth * 0.15);
  if (!shouldSplit) return [r];

  const alley = rand() < 0.35 ? 3 : 0;
  const t = 0.35 + rand() * 0.3;
  if (w >= d) {
    const cut = r.minX + w * t;
    return [
      ...subdivide({ ...r, maxX: cut - alley / 2 }, rand, depth + 1),
      ...subdivide({ ...r, minX: cut + alley / 2 }, rand, depth + 1),
    ];
  }
  const cut = r.minZ + d * t;
  return [
    ...subdivide({ ...r, maxZ: cut - alley / 2 }, rand, depth + 1),
    ...subdivide({ ...r, minZ: cut + alley / 2 }, rand, depth + 1),
  ];
}

function makeBuilding(lot: Rect, fromCentre: number, rand: () => number): Building {
  // Small random setback so street walls aren't perfectly flush.
  const inset = rand() < 0.5 ? 0 : rand() * 1.5;
  const b: Building = {
    minX: lot.minX + inset,
    minZ: lot.minZ + inset,
    maxX: lot.maxX - inset,
    maxZ: lot.maxZ - inset,
    // Max 12 m: kept well under the on-foot camera (20 m) so roofs never
    // reach the near plane or swallow the screen; downtown gets the tallest.
    height: 3.5 + rand() * 3.5 + (1 - fromCentre) ** 2 * rand() * 5,
    tint: rand(),
  };
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  if (w > 8 && d > 8 && rand() < 0.6) {
    const bw = 2 + rand() * 3;
    const bd = 2 + rand() * 3;
    const ox = b.minX + 1 + rand() * (w - bw - 2);
    const oz = b.minZ + 1 + rand() * (d - bd - 2);
    b.roofBox = { minX: ox, minZ: oz, maxX: ox + bw, maxZ: oz + bd, height: 0.8 + rand() * 1.4 };
  }
  return b;
}

function plantTrees(r: Rect, rand: () => number, out: Tree[]): void {
  const count = 6 + Math.floor(rand() * 8);
  const placed: Tree[] = [];
  for (let attempt = 0; attempt < count * 6 && placed.length < count; attempt++) {
    const radius = 1.6 + rand() * 1.4;
    const x = r.minX + radius + rand() * (r.maxX - r.minX - 2 * radius);
    const z = r.minZ + radius + rand() * (r.maxZ - r.minZ - 2 * radius);
    if (placed.every((t) => Math.hypot(t.x - x, t.z - z) > t.radius + radius)) {
      placed.push({ x, z, radius });
    }
  }
  out.push(...placed);
}

function boundaryWalls(): Rect[] {
  const L = WORLD_LIMIT;
  const T = 2; // wall thickness
  return [
    { minX: -L - T, minZ: -L - T, maxX: L + T, maxZ: -L },
    { minX: -L - T, minZ: L, maxX: L + T, maxZ: L + T },
    { minX: -L - T, minZ: -L, maxX: -L, maxZ: L },
    { minX: L, minZ: -L, maxX: L + T, maxZ: L },
  ];
}
