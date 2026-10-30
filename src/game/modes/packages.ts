/**
 * HIDDEN PACKAGES: 40 spinning green parcels tucked down alleys, in park
 * interiors and in plaza corners, the same places every game (seeded from
 * the city). Each pays $100; every tenth unlocks a permanent perk. They
 * don't show on the radar unless the scanner has been bought at the shop.
 * Pure logic, unit-tested.
 */
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, type City, type Rect } from '../../world/city';
import { mulberry32 } from '../../world/random';

export interface HiddenPackage {
  index: number;
  x: number;
  z: number;
  where: 'alley' | 'park' | 'plaza';
}

export const PACKAGE_COUNT = 40;
export const PACKAGE_PAY = 100;
/** Reach to pick one up, m: on foot, and from a car. */
export const PACKAGE_REACH_FOOT = 1.5;
export const PACKAGE_REACH_CAR = 2.6;

/** Perks for every tenth package: [packages needed, unlock id, what the feed says]. */
export const PACKAGE_PERKS: ReadonlyArray<readonly [number, string, string]> = [
  [10, 'perk-pistol', 'EVERY LIFE STARTS WITH A PISTOL'],
  [20, 'perk-banker', 'BANKED CHAINS PAY 25% MORE'],
  [30, 'perk-smg', 'EVERY LIFE STARTS WITH AN SMG'],
  [40, 'perk-firstaid', 'HEALTH REFILLS WHEN YOU LIE LOW'],
];

/** The perk unlocked by finding the `found`-th package, if any. */
export function perkFor(found: number): (typeof PACKAGE_PERKS)[number] | null {
  return PACKAGE_PERKS.find((p) => p[0] === found) ?? null;
}

/** Keep packages apart, m. */
const MIN_SPACING = 70;
/** Clearance from walls and trunks, m (a person fits; you have to look). */
const CLEARANCE = 0.9;
/** Alley packages sit at least this deep into the block, out of sight of the street, m. */
const ALLEY_DEPTH = 5;
const INSET = ROAD_WIDTH / 2 + SIDEWALK;

const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** Place the packages for `city` (deterministic per seed). */
export function generatePackages(city: City, count = PACKAGE_COUNT, seed = 0x9ac4e): HiddenPackage[] {
  const rand = mulberry32(city.seed ^ seed);
  // Obstacles bucketed by block, so each test only looks at its neighbours.
  const byBlock = new Map<number, Rect[]>();
  const key = (bx: number, bz: number) => bx * 64 + bz;
  for (const o of city.obstacles) {
    const bx = Math.floor((o.minX + o.maxX) / 2 / BLOCK_SIZE + HALF_EXTENT / BLOCK_SIZE);
    const bz = Math.floor((o.minZ + o.maxZ) / 2 / BLOCK_SIZE + HALF_EXTENT / BLOCK_SIZE);
    const k = key(bx, bz);
    const list = byBlock.get(k);
    if (list) list.push(o);
    else byBlock.set(k, [o]);
  }

  const candidates: HiddenPackage[] = [];
  const blocks = [...city.blocks];
  // Shuffle so the spacing rule doesn't favour one corner of the map.
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  for (const b of blocks) {
    const obstacles = byBlock.get(key(b.bx, b.bz)) ?? [];
    const spot =
      b.kind === 'buildings' ? alleySpot(b.interior, obstacles, rand) : b.kind === 'park' ? parkSpot(b.interior, obstacles, rand) : plazaSpot(b.interior, rand);
    if (!spot) continue;
    candidates.push({ index: 0, x: spot.x, z: spot.z, where: b.kind === 'buildings' ? 'alley' : b.kind });
  }

  // Spread them out, about half in alleys (the classic hiding place) and a
  // quarter each in parks and plazas; later passes relax the spacing and the
  // mix until there are enough.
  const quota = { alley: count / 2, park: count / 4, plaza: count / 4 };
  const taken = { alley: 0, park: 0, plaza: 0 };
  const out: HiddenPackage[] = [];
  for (let pass = 0; out.length < count && pass < 8; pass++) {
    const spacing = Math.max(20, MIN_SPACING - pass * 10);
    for (const c of candidates) {
      if (out.length >= count) break;
      if (out.includes(c) || (pass < 2 && taken[c.where] >= quota[c.where])) continue;
      if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < spacing)) continue;
      out.push(c);
      taken[c.where]++;
    }
  }
  out.forEach((p, i) => (p.index = i));
  return out;
}

/** A clear spot deep in a gap between buildings with a straight way out to the street. */
function alleySpot(r: Rect, obstacles: Rect[], rand: () => number): { x: number; z: number } | null {
  for (let i = 0; i < 160; i++) {
    const x = r.minX + ALLEY_DEPTH + rand() * (r.maxX - r.minX - 2 * ALLEY_DEPTH);
    const z = r.minZ + ALLEY_DEPTH + rand() * (r.maxZ - r.minZ - 2 * ALLEY_DEPTH);
    const box = { minX: x - CLEARANCE, minZ: z - CLEARANCE, maxX: x + CLEARANCE, maxZ: z + CLEARANCE };
    if (obstacles.some((o) => overlaps(o, box))) continue;
    if (!wayOut(x, z, r, obstacles)) continue;
    return { x, z };
  }
  return null;
}

/** Is there a straight, person-wide corridor from (x, z) to the edge of the block interior? */
export function wayOut(x: number, z: number, r: Rect, obstacles: readonly Rect[], half = 0.55): boolean {
  const corridors: Rect[] = [
    { minX: r.minX - 0.1, maxX: x, minZ: z - half, maxZ: z + half },
    { minX: x, maxX: r.maxX + 0.1, minZ: z - half, maxZ: z + half },
    { minX: x - half, maxX: x + half, minZ: r.minZ - 0.1, maxZ: z },
    { minX: x - half, maxX: x + half, minZ: z, maxZ: r.maxZ + 0.1 },
  ];
  return corridors.some((c) => !obstacles.some((o) => overlaps(o, c)));
}

function parkSpot(r: Rect, obstacles: Rect[], rand: () => number): { x: number; z: number } | null {
  for (let i = 0; i < 80; i++) {
    const x = r.minX + 6 + rand() * (r.maxX - r.minX - 12);
    const z = r.minZ + 6 + rand() * (r.maxZ - r.minZ - 12);
    // Trunks are 0.8 m boxes; keep well clear of them (under a canopy is fine).
    if (obstacles.some((o) => x > o.minX - 1.6 && x < o.maxX + 1.6 && z > o.minZ - 1.6 && z < o.maxZ + 1.6)) continue;
    return { x, z };
  }
  return null;
}

function plazaSpot(r: Rect, rand: () => number): { x: number; z: number } {
  const corner = Math.floor(rand() * 4);
  const inset = 2.5;
  return {
    x: corner === 0 || corner === 3 ? r.minX + inset : r.maxX - inset,
    z: corner < 2 ? r.minZ + inset : r.maxZ - inset,
  };
}

/** Exported for tests: the interior a package's block would have. */
export function interiorAround(x: number, z: number): Rect {
  const bx = Math.floor((x + HALF_EXTENT) / BLOCK_SIZE);
  const bz = Math.floor((z + HALF_EXTENT) / BLOCK_SIZE);
  const x0 = -HALF_EXTENT + bx * BLOCK_SIZE;
  const z0 = -HALF_EXTENT + bz * BLOCK_SIZE;
  return { minX: x0 + INSET, minZ: z0 + INSET, maxX: x0 + BLOCK_SIZE - INSET, maxZ: z0 + BLOCK_SIZE - INSET };
}
