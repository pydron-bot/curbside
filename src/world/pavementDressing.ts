/**
 * V3 L7: the daytime pavements dressed, after everything else is placed
 * (so it only fills gaps and moves nothing older): the round-3 props
 * (BLENDER_TODO §17) and more of the round-2 ones, by district and by what
 * the shop is.
 *
 * - At the kerb in front of shops: A-boards (arts, old town most), bike
 *   racks, planters and newspaper boxes; bin bags out on some street sides.
 * - Against shopfronts (only where the pavement leaves a clear path: the
 *   same rule as the café tables, frontages.ts): crate stacks outside
 *   grocers, flower stands, a second café terrace, news stands, and market
 *   stalls where the building stands back far enough. Never across a shop
 *   door (the doors are where the building shader draws them, doorAt).
 * - Scaffolding against some plain street faces set back from the walk
 *   line: four standards solid, the walkway under it open.
 * - Market stalls along the edges of old-town and arts plazas, a news stand
 *   at some downtown plazas.
 * - Leaf piles in the gutters of the leafy districts and beside parks
 *   (drawn only: flat enough to drive over; hidden on the low tier).
 *
 * Kept clear of crossings (kerb items stand within a building's frontage,
 * clear of the corners), bus stops and where the bus pulls in, mission
 * markers, payphones and pickups (`clear`), alleys (only faces on a street)
 * and car parks (none on lots). Each building and block from its own keyed
 * stream, so a map edit elsewhere moves nothing. Pure data.
 */
import { buildingStream, type BuildingPlan, type Side } from './buildingPlans';
import { BLOCK_SIZE, CORE_OFFSET, isCarPark, lotBytes, type Building, type City } from './city';
import type { District } from './districts';
import { KERB_LINE, WALK_LINE, blockSide, sideRemoved, type Placer } from './kerbs';
import { keyedStream } from './random';
import type { StreetPropKind } from './streetProps';
import { len2 } from '../core/len';

/** Points the new things keep clear of (radius, m): bus stops, mission markers. */
export interface ClearPoint {
  x: number;
  z: number;
  r: number;
}

type Odds = Readonly<Record<District, number>>;
/** Per shopfront, by district. */
const A_BOARD: Odds = { arts: 0.36, oldtown: 0.32, downtown: 0.16, residential: 0.12, industrial: 0.04 };
const KERB_EXTRA: Odds = { downtown: 0.35, arts: 0.3, oldtown: 0.22, residential: 0.15, industrial: 0.05 };
const CRATES: Odds = { oldtown: 0.24, arts: 0.12, industrial: 0.22, downtown: 0.06, residential: 0.1 };
const FLOWERS: Odds = { oldtown: 0.12, arts: 0.14, downtown: 0.05, residential: 0.08, industrial: 0 };
const CAFE_MORE: Odds = { oldtown: 0.18, arts: 0.2, downtown: 0.1, residential: 0.06, industrial: 0 };
const NEWS: Odds = { downtown: 0.2, arts: 0.08, oldtown: 0.06, residential: 0.03, industrial: 0 };
const STALL: Odds = { oldtown: 0.35, arts: 0.25, residential: 0.1, downtown: 0.04, industrial: 0 };
/** Per street side of a building. */
const BIN_BAGS: Odds = { residential: 0.16, oldtown: 0.14, industrial: 0.2, arts: 0.12, downtown: 0.08 };
/** Per building (a plain street face, set back). */
const SCAFFOLD: Odds = { oldtown: 0.3, downtown: 0.25, arts: 0.25, residential: 0.2, industrial: 0.12 };
/** Leaf piles per block side, beside buildings; parks get more. */
const LEAVES: Odds = { residential: 1.6, oldtown: 1.4, arts: 0.4, downtown: 0.15, industrial: 0.3 };
/** Plazas with a row of market stalls. */
const PLAZA_MARKET: Odds = { oldtown: 0.7, arts: 0.6, residential: 0.35, downtown: 0, industrial: 0 };

/** Kerb extras by district. */
const KERB_MIX: Readonly<Record<District, readonly StreetPropKind[]>> = {
  downtown: ['newspaper_box', 'bike_rack', 'planter', 'newspaper_box'],
  arts: ['bike_rack', 'planter', 'bike_rack', 'newspaper_box'],
  oldtown: ['planter', 'bike_rack', 'planter'],
  residential: ['planter', 'bike_rack'],
  industrial: ['bike_rack'],
};

/** Shop signs, crates and stall stripes: `paint` colours (sRGB). */
const SIGN_COLOURS = ['#1f3a5c', '#7a1f2b', '#2b5c3a', '#2a2a2e', '#6b3a1f', '#1f5a5c'];
const CRATE_COLOURS = ['#2f7ac8', '#c8402f', '#3a9a4a', '#e0a020'];
const STALL_COLOURS = ['#c8302a', '#2f7a46', '#2a5ab8', '#d07a1a'];

/** How far out from the wall each wall-line thing stands (its middle), its half-width along the wall and half-depth, m. */
const WALL: Partial<Record<StreetPropKind, readonly [out: number, halfW: number, halfD: number]>> = {
  crate_stack: [0.4, 0.4, 0.3],
  flower_stand: [0.45, 0.7, 0.4],
  cafe_table: [0.7, 0.85, 0.4],
  news_stand: [0.65, 0.9, 0.6],
  market_stall: [0.75, 1.3, 0.7],
};
/** Room each takes for later placements, m. */
const ROOM: Partial<Record<StreetPropKind, number>> = {
  a_board: 0.45,
  crate_stack: 0.5,
  bin_bags: 0.55,
  flower_stand: 0.8,
  cafe_table: 0.9,
  news_stand: 1.1,
  market_stall: 1.5,
  bike_rack: 0.95,
  planter: 0.65,
  newspaper_box: 0.4,
};
/** Scaffold: its middle this far out from the wall; its outer standards reach 1.35 m out. */
const SCAFFOLD_OUT = 0.7;
const SCAFFOLD_REACH = 1.36;
/** The leaf piles lie this far from the road centreline: in the gutter, m. */
const LEAF_LINE = 7.45;
/** A face this far from its road centreline is on a street (an alley's face is further in), m. */
const STREET_FACE = 12.6;

/** Heading out of each face: north (−Z), east, south, west. */
const FACING: Readonly<Record<Side, number>> = { 0: Math.PI, 1: Math.PI / 2, 2: 0, 3: -Math.PI / 2 };

export function dressPavements(city: City, plans: readonly BuildingPlan[], placer: Placer, keep: readonly ClearPoint[]): void {
  const away = (x: number, z: number, r: number) => !keep.some((k) => len2(k.x - x, k.z - z) < k.r + r);
  const ok = (x: number, z: number, r: number) => away(x, z, r) && placer.clear(x, z, r);
  const pick = <T>(list: readonly T[], r: number) => list[Math.floor(r * list.length) % list.length];

  city.buildings.forEach((b, i) => {
    const plan = plans[i];
    const rand = buildingStream(b, city.seed, 0xd2e5);
    const d = b.district;
    // Shopfronts: the kerb in front, then the wall.
    for (const shop of plan.shopfronts) {
      const face = faceLine(b, shop.side);
      const centre = Math.round(face / BLOCK_SIZE) * BLOCK_SIZE;
      const out = Math.abs(face - centre);
      if (out > STREET_FACE) continue;
      const mid = (shop.from + shop.to) / 2;
      const width = shop.to - shop.from;
      const kerbAt = (u: number) => onLine(shop.side, u, centre + Math.sign(face - centre) * KERB_LINE);
      const tint = pick(SIGN_COLOURS, rand());
      if (rand() < A_BOARD[d]) {
        const p = kerbAt(mid + (rand() - 0.5) * Math.max(0, width - 2));
        if (ok(p.x, p.z, ROOM.a_board!)) placer.put('a_board', p.x, p.z, FACING[shop.side] + Math.PI, 1, 0, tint);
      }
      if (rand() < KERB_EXTRA[d] && width >= 4) {
        const kind = pick(KERB_MIX[d], rand());
        const p = kerbAt(shop.from + 1.2 + rand() * (width - 2.4));
        const heading = kind === 'newspaper_box' ? FACING[shop.side] + Math.PI : FACING[shop.side];
        if (ok(p.x, p.z, ROOM[kind] ?? 0.5)) placer.put(kind, p.x, p.z, heading);
      }
      const wall = (kind: StreetPropKind, u: number, tintHex?: string) => {
        const [o, hw, hd] = WALL[kind]!;
        // A clear path: off the walk line by more than a person's width (as the café tables).
        if (out - o - hd < WALK_LINE + 0.4) return;
        if (shop.awning !== null && kind !== 'crate_stack') return; // hidden under it from above
        if (u - hw < shop.from || u + hw > shop.to || doorIn(b, plan, shop.side, u - hw - 0.3, u + hw + 0.3)) return;
        const p = onLine(shop.side, u, face + outward(face, centre) * o);
        if (ok(p.x, p.z, ROOM[kind] ?? 0.6)) placer.put(kind, p.x, p.z, FACING[shop.side], 1, 0, tintHex);
      };
      const at = () => shop.from + 0.5 + rand() * Math.max(0, width - 1);
      if (rand() < CRATES[d]) wall('crate_stack', at(), pick(CRATE_COLOURS, rand()));
      if (rand() < FLOWERS[d]) wall('flower_stand', at());
      if (rand() < CAFE_MORE[d]) wall('cafe_table', at(), '#b8322e');
      if (rand() < NEWS[d]) wall('news_stand', at());
      if (rand() < STALL[d]) wall('market_stall', mid, pick(STALL_COLOURS, rand()));
    }
    // Every street side: bin bags at the kerb. Then maybe scaffolding against one plain street face set back from the walk line.
    const plain: Array<{ side: Side; face: number; centre: number; lo: number; hi: number }> = [];
    for (let side = 0 as Side; side < 4; side = (side + 1) as Side) {
      const face = faceLine(b, side);
      const centre = Math.round(face / BLOCK_SIZE) * BLOCK_SIZE;
      const out = Math.abs(face - centre);
      if (out > STREET_FACE) continue;
      const [lo, hi] = faceSpan(b, side);
      if (rand() < BIN_BAGS[d] && hi - lo > 4) {
        const p = onLine(side, lo + 1.5 + rand() * (hi - lo - 3), centre + Math.sign(face - centre) * KERB_LINE);
        if (ok(p.x, p.z, ROOM.bin_bags!)) placer.put('bin_bags', p.x, p.z, rand() * Math.PI * 2);
      }
      if (!((plan.shopSides >> side) & 1) && out - SCAFFOLD_REACH >= WALK_LINE + 0.4 && hi - lo >= 6) plain.push({ side, face, centre, lo, hi });
    }
    if (plain.length && b.height >= 7 && rand() < SCAFFOLD[d]) {
      const f = plain[Math.floor(rand() * plain.length)];
      const u = f.lo + 2.4 + rand() * (f.hi - f.lo - 4.8);
      const p = onLine(f.side, u, f.face + outward(f.face, f.centre) * SCAFFOLD_OUT);
      if (ok(p.x, p.z, 2.1)) placer.put('scaffold', p.x, p.z, FACING[f.side]);
    }
  });

  const bytes = lotBytes(city);
  city.blocks.forEach((b, bi) => {
    const rand = keyedStream(city.seed, 0x1eaf, b.bx - CORE_OFFSET, b.bz - CORE_OFFSET);
    // Leaves in the gutters beside buildings and parks (not car parks, plazas or waste ground: their entrances).
    if (b.kind === 'buildings' || b.kind === 'park') {
      const odds = b.kind === 'park' ? 2.2 : LEAVES[b.district];
      for (let side = 0; side < 4; side++) {
        const s = blockSide(b, side);
        if (sideRemoved(s)) continue;
        let n = Math.floor(odds * (0.4 + rand()));
        for (let k = 0; k < n && k < 3; k++) {
          const t = 15 + rand() * 34;
          const p = s.at(t, LEAF_LINE);
          if (ok(p.x, p.z, 0.6) && placer.clearRoad(p.x, p.z, 0.6)) placer.put('leaf_pile', p.x, p.z, s.toRoad + Math.PI / 2 + (rand() - 0.5) * 0.6, 0.8 + rand() * 0.4);
          else n--;
        }
      }
    }
    // A row of market stalls along one edge of a plaza (customers inside it), or a news stand at one corner downtown.
    if (b.kind === 'plaza' && !b.merge && !isCarPark(city, bytes, bi)) {
      const side = Math.floor(rand() * 4);
      const s = blockSide(b, side);
      if (rand() < PLAZA_MARKET[b.district] && !sideRemoved(s)) {
        const tint = pick(STALL_COLOURS, rand());
        for (const t of [17.5, 21.2, 42.8, 46.5]) {
          if (rand() < 0.2) continue;
          const p = s.at(t, 14);
          if (ok(p.x, p.z, 1.5)) placer.put('market_stall', p.x, p.z, s.toRoad + Math.PI, 1, 0, tint);
        }
      } else if (b.district === 'downtown' && rand() < 0.5) {
        const p = s.at(rand() < 0.5 ? 16 : 48, 13.5);
        if (ok(p.x, p.z, 1.2)) placer.put('news_stand', p.x, p.z, s.toRoad);
      }
    }
  });
}

/** The world coordinate of a face's plane: z for N/S faces, x for E/W. */
function faceLine(b: Building, side: Side): number {
  return side === 0 ? b.minZ : side === 1 ? b.maxX : side === 2 ? b.maxZ : b.minX;
}

/** The face's span along it (world x for N/S, z for E/W). */
function faceSpan(b: Building, side: Side): [number, number] {
  return side === 0 || side === 2 ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
}

/** +1 or −1: away from the building, toward the road. */
function outward(face: number, centre: number): number {
  return Math.sign(centre - face);
}

/** A point `u` along a face's direction at `line` across it (the face's plane coordinate). */
function onLine(side: Side, u: number, line: number): { x: number; z: number } {
  return side === 0 || side === 2 ? { x: u, z: line } : { x: line, z: u };
}

/**
 * Is any shop door on this face within [u0, u1] (world, along the face)?
 * Mirrors the building shader (cityMesh wallSurface): bays of W / floor(W /
 * 2.6), a door where fract(bay × 0.37 + seed × 3.1) ≤ 0.28, across the
 * bay's middle 44%. A little margin on the hash for the GPU's floats.
 */
export function doorIn(b: Building, plan: BuildingPlan, side: Side, u0: number, u1: number): boolean {
  if (!((plan.shopSides >> side) & 1)) return false;
  const [lo, hi] = faceSpan(b, side);
  const w = hi - lo;
  const nb = Math.max(1, Math.floor(w / 2.6));
  const bw = w / nb;
  for (let bi = Math.max(0, Math.floor((u0 - lo) / bw)); bi <= Math.min(nb - 1, Math.floor((u1 - lo) / bw)); bi++) {
    const h = bi * 0.37 + plan.seed * 3.1;
    if (h - Math.floor(h) > 0.3) continue;
    const d0 = lo + (bi + 0.28) * bw;
    const d1 = lo + (bi + 0.72) * bw;
    if (d0 < u1 && d1 > u0) return true;
  }
  return false;
}
