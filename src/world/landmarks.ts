/**
 * Places the police's fixed points in the city: the station the player is
 * released at after an arrest, and the Pay 'n' Spray bays that lose the
 * police. Derived from the city layout (pure, deterministic per seed), so
 * the radar, the markers and the rules all agree.
 *
 * A spray bay sits at the road edge of an open lot (a plaza or car park,
 * else a park with nothing in the way), so you drive off the street,
 * across the pavement and straight in.
 */
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, CORE_OFFSET, blockInterior, core, type City, type Rect } from './city';
import { len2 } from '../core/len';
import { landmarkEdit, type LandmarkId } from './mapEdits';

export interface SprayShop {
  id: string;
  /** Centre of the bay, m. */
  x: number;
  z: number;
  /** Direction you drive in (vehicle convention: (sin h, cos h)). */
  heading: number;
  /** Half the bay's width (across the way in) and length (along it), m. */
  halfWidth: number;
  halfLength: number;
}

export interface Station {
  /** The front door, on the pavement. */
  x: number;
  z: number;
  /** Facing out to the road. */
  heading: number;
}

/** Bay size: a car (4.6 × 1.9 m) with room to spare. */
const BAY_HALF_WIDTH = 3.6;
const BAY_HALF_LENGTH = 4.6;
/** Bays go near these blocks (one per quarter of the city, a little in from the edges). */
const SHOP_TARGETS: ReadonlyArray<readonly [number, number]> = [
  [4, 4],
  [11, 4],
  [4, 11],
  [11, 11],
];
/** The station goes on the block nearest this one (a short drive from the spawn corner). */
const STATION_TARGET = [6, 9] as const;
/** Pavement path: midway across the sidewalk, from the road centreline. */
const WALK_INSET = ROAD_WIDTH / 2 + SIDEWALK / 2;

/** The spray bays' slots (the map file's landmark ids), in SHOP_TARGETS order: one per quarter. */
export const SPRAY_SLOTS: readonly LandmarkId[] = ['spray-nw', 'spray-ne', 'spray-sw', 'spray-se'];

export function placeSprayShops(city: City): SprayShop[] {
  return sprayShopSlots(city).map((s) => s.shop);
}

/**
 * The spray bays with the slot each fills. A slot the map edits move
 * (round 3) takes its block's bay if that's an open lot with room (else
 * it's placed as generated: the checks say why); the others go near their
 * targets as ever, round the moved ones and a moved docks yard.
 */
export function sprayShopSlots(city: City): Array<{ slot: LandmarkId; shop: SprayShop }> {
  const fixed = new Map<LandmarkId, SprayShop>();
  const used = new Set<string>();
  if (city.edits?.landmarks?.length) {
    for (const id of ['docks' as const, ...SPRAY_SLOTS]) {
      const e = landmarkEdit(city.edits, id);
      const b = e && city.blocks.find((q) => q.bx === core(e.at[0]) && q.bz === core(e.at[1]));
      if (!b || b.kind === 'buildings' || used.has(`${b.bx},${b.bz}`)) continue;
      const bay = bayFor(b.bx, b.bz, city);
      if (!bay) continue;
      used.add(`${b.bx},${b.bz}`);
      if (id !== 'docks') fixed.set(id, bay);
    }
  }
  const out: Array<{ slot: LandmarkId; shop: SprayShop }> = [];
  SHOP_TARGETS.forEach(([cx, cz], i) => {
    const slot = SPRAY_SLOTS[i];
    const moved = fixed.get(slot);
    if (moved) return void out.push({ slot, shop: moved });
    const shop = nearestBay(city, cx, cz, used);
    if (shop) out.push({ slot, shop });
  });
  return out;
}

/** The bay on the open lot nearest core block (cx, cz) not in `used` (which gains it). */
function nearestBay(city: City, cx: number, cz: number, used: Set<string>): SprayShop | null {
  const tx = core(cx);
  const tz = core(cz);
  const blocks = [...city.blocks]
    .filter((b) => b.kind !== 'buildings' && !used.has(`${b.bx},${b.bz}`))
    .sort((a, b) => len2(a.bx - tx, a.bz - tz) - len2(b.bx - tx, b.bz - tz));
  for (const b of blocks) {
    const shop = bayFor(b.bx, b.bz, city);
    if (!shop) continue;
    used.add(`${b.bx},${b.bz}`);
    return shop;
  }
  return null;
}

/**
 * A bay in block (bx, bz) on the side facing the city centre (more traffic
 * goes past), or any side whose bay is clear of obstacles; null if none is.
 * (Also places the docks' export garage, src/game/modes/places.ts.)
 */
export function bayFor(bx: number, bz: number, city: City): SprayShop | null {
  const r = blockInterior(bx, bz);
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  // Sides as [outward x, outward z]; try the one facing the centre first.
  const sides: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  sides.sort((a, b) => a[0] * cx + a[1] * cz - (b[0] * cx + b[1] * cz));
  for (const [ox, oz] of sides) {
    // Bay centre just inside the lot edge on that side; you drive in against the outward normal.
    const halfSpan = ox !== 0 ? (r.maxX - r.minX) / 2 : (r.maxZ - r.minZ) / 2;
    const x = cx + ox * (halfSpan - BAY_HALF_LENGTH - 0.4);
    const z = cz + oz * (halfSpan - BAY_HALF_LENGTH - 0.4);
    const shop: SprayShop = {
      id: `spray-${bx - CORE_OFFSET}-${bz - CORE_OFFSET}`, // core blocks: the same id at any city size
      x,
      z,
      heading: Math.atan2(-ox, -oz),
      halfWidth: BAY_HALF_WIDTH,
      halfLength: BAY_HALF_LENGTH,
    };
    const box = shopRect(shop, 1);
    if (city.obstacles.some((o) => overlaps(o, box))) continue;
    return shop;
  }
  return null;
}

/** Is (x, z) inside the bay (grown by `margin`)? */
export function inShop(shop: SprayShop, x: number, z: number, margin = 0): boolean {
  const fx = Math.sin(shop.heading);
  const fz = Math.cos(shop.heading);
  const rx = x - shop.x;
  const rz = z - shop.z;
  const along = rx * fx + rz * fz;
  const across = rx * fz - rz * fx;
  return Math.abs(along) < shop.halfLength + margin && Math.abs(across) < shop.halfWidth + margin;
}

/** The bay's axis-aligned footprint (bays face along an axis), grown by `margin`. */
export function shopRect(shop: SprayShop, margin = 0): Rect {
  const alongX = Math.abs(Math.sin(shop.heading)) > 0.5;
  const hx = (alongX ? shop.halfLength : shop.halfWidth) + margin;
  const hz = (alongX ? shop.halfWidth : shop.halfLength) + margin;
  return { minX: shop.x - hx, minZ: shop.z - hz, maxX: shop.x + hx, maxZ: shop.z + hz };
}

/**
 * The police station: the pavement outside the middle of a built-up block
 * near STATION_TARGET, on its south side, facing the road.
 */
export function placeStation(city: City): Station {
  const tx = core(STATION_TARGET[0]);
  const tz = core(STATION_TARGET[1]);
  let best = city.blocks[0];
  let bestD = Infinity;
  // Moved by the map edits (round 3): onto that block if it's built up.
  const moved = builtBlockAt(city, 'station');
  for (const b of moved ? [] : city.blocks) {
    if (b.kind !== 'buildings') continue;
    const d = len2(b.bx - tx, b.bz - tz);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (moved) best = moved;
  const x0 = -HALF_EXTENT + best.bx * BLOCK_SIZE;
  const z0 = -HALF_EXTENT + best.bz * BLOCK_SIZE;
  // Between two street lamps (they stand every 16 m along the block side).
  return { x: x0 + BLOCK_SIZE * 0.375, z: z0 + BLOCK_SIZE - WALK_INSET, heading: 0 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}


/** The built-up block the map edits move landmark `id` (the station, the hospital) to, or null (no edit, or not built up there). */
export function builtBlockAt(city: City, id: LandmarkId): City['blocks'][number] | null {
  const e = landmarkEdit(city.edits, id);
  if (!e) return null;
  return city.blocks.find((b) => b.bx === core(e.at[0]) && b.bz === core(e.at[1]) && b.kind === 'buildings') ?? null;
}
