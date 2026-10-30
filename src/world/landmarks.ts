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
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, blockInterior, type City, type Rect } from './city';

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

export function placeSprayShops(city: City): SprayShop[] {
  const shops: SprayShop[] = [];
  const used = new Set<string>();
  for (const [tx, tz] of SHOP_TARGETS) {
    const blocks = [...city.blocks]
      .filter((b) => b.kind !== 'buildings' && !used.has(`${b.bx},${b.bz}`))
      .sort((a, b) => Math.hypot(a.bx - tx, a.bz - tz) - Math.hypot(b.bx - tx, b.bz - tz));
    for (const b of blocks) {
      const shop = bayFor(b.bx, b.bz, city);
      if (!shop) continue;
      used.add(`${b.bx},${b.bz}`);
      shops.push(shop);
      break;
    }
  }
  return shops;
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
      id: `spray-${bx}-${bz}`,
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
  const [tx, tz] = STATION_TARGET;
  let best = city.blocks[0];
  let bestD = Infinity;
  for (const b of city.blocks) {
    if (b.kind !== 'buildings') continue;
    const d = Math.hypot(b.bx - tx, b.bz - tz);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  const x0 = -HALF_EXTENT + best.bx * BLOCK_SIZE;
  const z0 = -HALF_EXTENT + best.bz * BLOCK_SIZE;
  // Between two street lamps (they stand every 16 m along the block side).
  return { x: x0 + BLOCK_SIZE * 0.375, z: z0 + BLOCK_SIZE - WALK_INSET, heading: 0 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

