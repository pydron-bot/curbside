/**
 * Procedural city layout. Pure data (no three.js) so it's testable and the
 * renderer, collision and later AI all read the same description.
 *
 * Layout: a square grid of BLOCK_SIZE blocks. Road centrelines run along the
 * block edges (multiples of BLOCK_SIZE from the origin), so (0,0) is an
 * intersection. Each block is a road band, a sidewalk ring, then a buildable
 * interior that becomes buildings, a park or a plaza.
 *
 * Size (W3-A): the shipped city is the 16 × 16 core. A bigger one (`?city=24`
 * in the URL, CURBSIDE_CITY=24 under Node) adds a ring of blocks round it and
 * leaves the core exactly as it was, block for block: the core is generated
 * first from the same stream, the ring after from its own. Hand-placed spots
 * are written in core blocks (`core()`) so they stay put.
 */
import { MAX_HEIGHT, buildingHeight, districtOf, paintDistricts, type District } from './districts';
import { NO_EDITS, blockEditKey, blockSeed, type BlockEdit, type MapEdits } from './mapEdits';
import { mulberry32 } from './random';
import { setRoadRules } from './roadRules';
import { len2 } from '../core/len';

export const BLOCK_SIZE = 64;
export const ROAD_WIDTH = 16;
export const SIDEWALK = 3;
/** Today's city, kept in the middle of any bigger one. */
export const CORE_BLOCKS = 16;
/** Sizes the city can be built at: the core plus whole 256 m chunks (4 blocks) of ring. */
export const CITY_SIZES: readonly number[] = [16, 24, 32];
export const BLOCKS_PER_SIDE = chosenSize();
/** Ring blocks on each side of the core (0 for the shipped city). */
export const CORE_OFFSET = (BLOCKS_PER_SIDE - CORE_BLOCKS) / 2;
/** Block index of core block `b`: hand-placed spots are written in core blocks. */
export const core = (b: number): number => b + CORE_OFFSET;
/** Is block (bx, bz) part of the core? */
export const inCoreBlock = (bx: number, bz: number): boolean =>
  bx >= CORE_OFFSET && bz >= CORE_OFFSET && bx < CORE_OFFSET + CORE_BLOCKS && bz < CORE_OFFSET + CORE_BLOCKS;

/** The size asked for: `?city=N` in the page's URL, or CURBSIDE_CITY under Node (tests, tools); else the core. */
function chosenSize(): number {
  let asked: string | null | undefined;
  try {
    asked = new URLSearchParams(globalThis.location?.search ?? '').get('city');
  } catch {
    asked = null;
  }
  asked ??= (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CURBSIDE_CITY;
  const n = Number(asked);
  return CITY_SIZES.includes(n) ? n : CORE_BLOCKS;
}
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
  district: District;
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
  district: District;
  /** Buildable interior (inside the sidewalk). */
  interior: Rect;
  /** A plaza the map edits made a car park (true) or an open plaza (false); else the lot byte decides (lotBytes). */
  carPark?: boolean;
}

export interface City {
  seed: number;
  blocks: Block[];
  buildings: Building[];
  trees: Tree[];
  /** Static obstacles for collision: buildings, tree trunks, boundary walls. */
  obstacles: Rect[];
  /** The map edits it was built with (W3-D): the dressing, the radar and the checks read their roads, spots and props. */
  edits?: MapEdits;
}

/**
 * A random byte per block (in city.blocks order) for the ground's variety
 * (world/ground.ts); a plaza whose byte is under 128 is drawn as a car park.
 */
export function lotBytes(city: City): Uint8Array {
  const rand = mulberry32(city.seed ^ 0x9e3779b9);
  // An edited plaza keeps its byte's look and moves it across the 128 line.
  return Uint8Array.from(city.blocks, (b) => {
    const byte = Math.floor(rand() * 256);
    return b.carPark === undefined ? byte : b.carPark ? byte & 0x7f : byte | 0x80;
  });
}

/** Is the block (index into city.blocks) a car park rather than an open plaza? */
export function isCarPark(city: City, bytes: Uint8Array, i: number): boolean {
  return city.blocks[i].kind === 'plaza' && bytes[i] < 128;
}

/** Interior of block (bx, bz), bx/bz in 0..BLOCKS_PER_SIDE-1. */
export function blockInterior(bx: number, bz: number): Rect {
  const inset = ROAD_WIDTH / 2 + SIDEWALK;
  const x0 = -HALF_EXTENT + bx * BLOCK_SIZE;
  const z0 = -HALF_EXTENT + bz * BLOCK_SIZE;
  return { minX: x0 + inset, minZ: z0 + inset, maxX: x0 + BLOCK_SIZE - inset, maxZ: z0 + BLOCK_SIZE - inset };
}

/**
 * The city from its seed, with the owner's map edits (W3-D, world/mapEdits.ts)
 * on top. An edited block is rebuilt from a stream of its own, after its
 * generated content has been drawn and thrown away, so every other block
 * comes out exactly as it would unedited. District repaints are installed
 * for districtOf (and so districtAt everywhere), and closed and one-way
 * roads for canLeave (world/roadRules.ts), as a side effect: the last city
 * generated is the one the game plays.
 */
export function generateCity(seed = 1337, edits: MapEdits = NO_EDITS): City {
  paintDistricts(edits.blocks);
  setRoadRules(edits.roads);
  const byBlock = new Map<number, BlockEdit>();
  for (const e of edits.blocks) byBlock.set(blockEditKey(e.at[0], e.at[1]), e);
  const blocks: Block[] = [];
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const scrapBuildings: Building[] = [];
  const scrapTrees: Tree[] = [];
  const addBlock = (bx: number, bz: number, rand: () => number) => {
    const interior = blockInterior(bx, bz);
    const district = districtOf(bx, bz);

    const roll = rand();
    const generated: BlockKind = roll < 0.1 ? 'park' : roll < 0.16 ? 'plaza' : 'buildings';
    const edit = byBlock.get(blockEditKey(bx - CORE_OFFSET, bz - CORE_OFFSET));
    const kind = edit?.kind === undefined ? generated : edit.kind === 'carpark' ? 'plaza' : edit.kind;
    const block: Block = { bx, bz, kind, district, interior };
    if (edit?.kind === 'carpark' || edit?.kind === 'plaza') block.carPark = edit.kind === 'carpark';
    blocks.push(block);

    const first = buildings.length;
    if (kind === generated && edit?.variant === undefined) {
      // As generated (a repaint keeps the footprints and takes the new district's heights and colours).
      fillBlock(interior, kind, district, rand, buildings, trees);
    } else {
      fillBlock(interior, generated, district, rand, scrapBuildings, scrapTrees);
      fillBlock(interior, kind, district, mulberry32(blockSeed(seed, bx - CORE_OFFSET, bz - CORE_OFFSET, edit?.variant ?? 0)), buildings, trees);
    }
    // A height edit scales the block's buildings (footprints and roof kit as they were).
    if (edit?.height !== undefined) for (let i = first; i < buildings.length; i++) buildings[i].height = Math.min(MAX_HEIGHT, buildings[i].height * edit.height);
  };

  // The core first, from the seed's own stream (so it's the same at any size),
  // then the ring from its own.
  const rand = mulberry32(seed);
  for (let bx = 0; bx < CORE_BLOCKS; bx++) {
    for (let bz = 0; bz < CORE_BLOCKS; bz++) addBlock(core(bx), core(bz), rand);
  }
  const ringRand = mulberry32(seed ^ 0x7e1a9);
  for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
    for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) if (!inCoreBlock(bx, bz)) addBlock(bx, bz, ringRand);
  }

  const obstacles: Rect[] = [
    ...buildings,
    ...trees.map((t) => ({ minX: t.x - 0.4, minZ: t.z - 0.4, maxX: t.x + 0.4, maxZ: t.z + 0.4 })),
    ...boundaryWalls(),
  ];
  return { seed, blocks, buildings, trees, obstacles, edits };
}

/** A block's buildings or trees (a plaza has neither). */
function fillBlock(interior: Rect, kind: BlockKind, district: District, rand: () => number, buildings: Building[], trees: Tree[]): void {
  if (kind === 'buildings') {
    for (const lot of subdivide(interior, rand, 0)) buildings.push(makeBuilding(lot, district, rand));
  } else if (kind === 'park') {
    plantTrees(interior, rand, trees);
  }
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

function makeBuilding(lot: Rect, district: District, rand: () => number): Building {
  // Small random setback so street walls aren't perfectly flush.
  const inset = rand() < 0.5 ? 0 : rand() * 1.5;
  // Max 12 m: kept well under the on-foot camera (20 m) so roofs never
  // reach the near plane or swallow the screen; downtown gets the tallest.
  const r1 = rand();
  const r2 = rand();
  const b: Building = {
    minX: lot.minX + inset,
    minZ: lot.minZ + inset,
    maxX: lot.maxX - inset,
    maxZ: lot.maxZ - inset,
    height: buildingHeight(district, r1, r2),
    tint: rand(),
    district,
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
    if (placed.every((t) => len2(t.x - x, t.z - z) > t.radius + radius)) {
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
