/**
 * HIDDEN PACKAGES: 40 spinning green parcels tucked down alleys, in park
 * interiors and in plaza corners, the same places every game. Each pays
 * $100; every tenth unlocks a permanent perk. They don't show on the radar
 * unless the scanner has been bought at the shop. Pure logic, unit-tested.
 *
 * Where they are is a fixed list (PACKAGE_SPOTS, worked out once by
 * generatePackages from the unedited core city), so editing a block never
 * moves them, and the save, which keeps found packages by index, stays
 * right. The map edits (W3-D) can move or remove any (`pkg-<index>`) and
 * add new ones (`pkg-<n>`, n from 40 up, which is its index); the map
 * checks want 40 in all, the number the perks and 100% count.
 */
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, type City, type Rect } from '../../world/city';
import type { MapEdits } from '../../world/mapEdits';
import { mulberry32 } from '../../world/random';
import { ACTIVE_MAP, SHIPPED_MAP } from '../../world/shippedMap';
import { addedSpots, editSpot, idNumber } from '../../world/spotEdits';
import { len2 } from '../../core/len';

export interface HiddenPackage {
  /** Its place in the save's list (and its id, `pkg-<index>`). */
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

/** Where the packages are, by index: generatePackages for the unedited core city (seed 1337), fixed so map edits don't move them (a test checks it still matches). */
export const PACKAGE_SPOTS: ReadonlyArray<readonly [number, number, HiddenPackage['where']]> = [
  [-422.89, -286.15, 'alley'],
  [-370.5, 333.5, 'plaza'],
  [40.3, -226.52, 'alley'],
  [406.61, 482.72, 'alley'],
  [228.18, 285.08, 'alley'],
  [33.19, 419.49, 'alley'],
  [-50.5, 13.5, 'plaza'],
  [34.27, -404.1, 'alley'],
  [-434.5, 498.5, 'plaza'],
  [-174.83, 342.23, 'alley'],
  [-299, -226.01, 'alley'],
  [-220.73, -281.13, 'alley'],
  [-210.35, 167.74, 'park'],
  [-18.65, 339.37, 'alley'],
  [168.57, -163.26, 'alley'],
  [-361.02, 93.05, 'alley'],
  [-35.72, -81.6, 'alley'],
  [-484.93, 154.09, 'alley'],
  [77.5, -77.5, 'plaza'],
  [493.64, -22.77, 'alley'],
  [-237.22, -40.43, 'park'],
  [-92.27, 410.36, 'alley'],
  [295.73, 354.16, 'alley'],
  [296.72, 426.15, 'park'],
  [-110.1, -211.63, 'alley'],
  [-224.24, -473.31, 'alley'],
  [44.68, -476.45, 'alley'],
  [-397.5, -461.5, 'plaza'],
  [471.13, -145.63, 'park'],
  [178.5, -333.5, 'plaza'],
  [370.5, -434.5, 'plaza'],
  [306.5, 141.5, 'plaza'],
  [434.5, -205.5, 'plaza'],
  [295.23, 220.87, 'park'],
  [-230.62, -165.78, 'park'],
  [306.5, -370.5, 'plaza'],
  [283.35, -84.46, 'park'],
  [-151.52, 492.97, 'park'],
  [-478.21, -30.61, 'park'],
  [-37.68, -217.88, 'park']
];

/** A package's map id. */
export const packageId = (index: number): string => `pkg-${index}`;

/** The packages as the map edits leave them: moved, removed, and any added (indexed by their id). */
export function placePackages(edits: MapEdits = ACTIVE_MAP): HiddenPackage[] {
  const out: HiddenPackage[] = [];
  PACKAGE_SPOTS.forEach(([x, z, where], index) => {
    const p = editSpot({ id: packageId(index), x, z }, edits, true);
    if (p) out.push({ index, x: p.x, z: p.z, where });
  });
  const taken = new Set(out.map((p) => p.index));
  for (const s of addedSpots(edits, 'package')) {
    const index = idNumber(s.id, 'pkg');
    // A new package's index must be new (the map checks say so; here it's skipped).
    if (index === null || index < PACKAGE_SPOTS.length || taken.has(index)) continue;
    taken.add(index);
    out.push({ index, x: s.x!, z: s.z!, where: 'plaza' });
  }
  return out;
}

/**
 * Package indices a save may keep: the shipped map's and this page's (a
 * VIEW IN 3D preview of local edits shares the save, so a package the edits
 * remove isn't pruned from it).
 */
export function knownPackageIndices(): number[] {
  return [...new Set([...placePackages(SHIPPED_MAP), ...placePackages(ACTIVE_MAP)].map((p) => p.index))];
}

/** Keep packages apart, m. */
const MIN_SPACING = 70;
/** Clearance from walls and trunks, m (a person fits; you have to look). */
const CLEARANCE = 0.9;
/** Alley packages sit at least this deep into the block, out of sight of the street, m. */
const ALLEY_DEPTH = 5;
const INSET = ROAD_WIDTH / 2 + SIDEWALK;

const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** Place the packages for `city` (deterministic per seed): how PACKAGE_SPOTS was made. */
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
      if (out.some((o) => len2(o.x - c.x, o.z - c.z) < spacing)) continue;
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
