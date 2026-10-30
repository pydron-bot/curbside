/**
 * Per-building dressing decided from the city seed: roof type, rooftop props
 * (AC units, vents, water tanks, satellite dishes, antennas, chimneys, solar
 * panels; the first five are props.glb models, sized here to their
 * footprints, see docs/BLENDER_TODO.md §3), helipads on the
 * tallest downtown towers, and street-level shopfronts with awnings and neon.
 * Pure data (no three.js); cityMesh.ts turns it into instanced meshes and
 * shader attributes. Deterministic, so the same city always looks the same.
 */
import { BLOCK_SIZE, HALF_EXTENT, blockInterior, type Building, type City, type Rect } from './city';
import { DISTRICT_STYLES, pickWeighted, type District, type RoofType } from './districts';
import { mulberry32 } from './random';

export type PropKind = 'ac' | 'vent' | 'tank' | 'dish' | 'antenna' | 'chimney' | 'solar' | 'housing';

/** A rooftop prop's footprint, in world coordinates; y0 is where it stands. */
export interface RoofProp extends Rect {
  kind: PropKind;
  y0: number;
  height: number;
  /**
   * Which way the model faces (vehicle convention, radians, a whole number
   * of quarter turns): the footprint is the model's width (x) by depth (z),
   * swapped when it's turned an odd number of quarters.
   */
  yaw: number;
}

/** Building faces, by the direction they look: north (−Z), east (+X), south (+Z), west (−X). */
export type Side = 0 | 1 | 2 | 3;

export interface Shopfront {
  side: Side;
  /** Span along the face (world x for N/S faces, world z for E/W faces). */
  from: number;
  to: number;
  /** Awning colour (sRGB hex), or null for a plain shopfront. */
  awning: string | null;
  /** Neon tube colour (sRGB hex) lit at night, or null. */
  neon: string | null;
}

export interface BuildingPlan {
  roof: RoofType;
  /** 0..1 per-building random, for shader variation (stains, lit windows). */
  seed: number;
  props: RoofProp[];
  /** Bit per side (1 << side) that has a ground-floor shop band. */
  shopSides: number;
  shopfronts: Shopfront[];
}

/** Awnings hang this high and stick out this far over the sidewalk, m. */
export const AWNING_HEIGHT = 2.8;
export const AWNING_DEPTH = 1.1;
/** A face within this of the block's sidewalk edge fronts the street. */
const STREET_GAP = 2;
/** Clear band inside the parapet that props keep off, m. */
const PARAPET_CLEAR = 0.9;
const NEON_COLOURS = ['#ff2d95', '#22e4ff', '#b14bff', '#ffd21f', '#ff5a1f', '#3dff8b'];

const PROP_WEIGHTS: Readonly<Record<District, ReadonlyArray<readonly [PropKind, number]>>> = {
  downtown: [
    ['ac', 4],
    ['vent', 2],
    ['tank', 0.4],
    ['solar', 0.8],
    ['dish', 0.8],
    ['antenna', 0.5],
  ],
  oldtown: [
    ['tank', 1.6],
    ['chimney', 2],
    ['vent', 1],
    ['ac', 1],
    ['antenna', 0.6],
  ],
  arts: [
    ['ac', 2],
    ['vent', 2],
    ['tank', 0.8],
    ['solar', 0.6],
    ['dish', 0.8],
  ],
  industrial: [
    ['vent', 3],
    ['ac', 1.2],
    ['tank', 0.4],
    ['antenna', 0.4],
  ],
  residential: [
    ['chimney', 2],
    ['solar', 2],
    ['ac', 0.6],
    ['dish', 1],
  ],
};

/** Props that suit a pitched tile roof. */
const PITCHED_PROPS: ReadonlyArray<readonly [PropKind, number]> = [
  ['chimney', 3],
  ['solar', 2],
];

/** A model's footprint (width x, depth z) and height at scale 1, m (props.glb). */
const model = (w: number, d: number, h: number, lo: number, hi: number) => (r: () => number): [number, number, number] => {
  const s = lo + r() * (hi - lo);
  return [w * s, d * s, h * s];
};

const PROP_SIZE: Readonly<Record<PropKind, (r: () => number) => [w: number, d: number, h: number]>> = {
  ac: model(1.2, 0.92, 0.81, 0.95, 1.35),
  vent: model(0.6, 0.6, 0.89, 0.8, 1.3),
  tank: model(2.4, 2.5, 4.2, 0.85, 1.05),
  dish: model(1.14, 0.8, 1.54, 0.8, 1.15),
  antenna: model(1.2, 0.4, 3.28, 0.8, 1.2),
  chimney: (r) => [0.5 + r() * 0.3, 0.7 + r() * 0.4, 1 + r() * 0.8],
  solar: (r) => [3 + r() * 3, 2 + r() * 2, 0.35],
  housing: () => [0, 0, 0],
};

/** Plan every building in the city, in the same order as city.buildings. */
export function planBuildings(city: City): BuildingPlan[] {
  return city.buildings.map((b, i) => planBuilding(b, i, city.seed));
}

export function planBuilding(b: Building, index: number, citySeed: number): BuildingPlan {
  const rand = mulberry32((citySeed * 7919 + index * 104729) >>> 0);
  const style = DISTRICT_STYLES[b.district];
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const helipad = b.district === 'downtown' && b.height >= 10.4 && Math.min(w, d) >= 13;
  let roof: RoofType = helipad ? 'helipad' : pickWeighted(style.roofs, rand());
  // Pitched-tile look only suits small houses; big footprints get gravel.
  if (roof === 'terracotta' && w * d > 420) roof = 'gravel';
  const seed = rand();

  const props: RoofProp[] = [];
  // Pitched tile roofs carry no stair bulkheads or plant boxes, just chimneys and solar panels.
  const pitched = roof === 'terracotta';
  if (b.roofBox && !helipad && !pitched) props.push({ ...b.roofBox, kind: 'housing', y0: b.height, yaw: 0 });
  if (!helipad) placeProps(b, roof, rand, props);

  const { shopSides, shopfronts } = planShops(b, rand);
  return { roof, seed, props, shopSides, shopfronts };
}

function placeProps(b: Building, roof: RoofType, rand: () => number, out: RoofProp[]): void {
  const inner: Rect = {
    minX: b.minX + PARAPET_CLEAR,
    minZ: b.minZ + PARAPET_CLEAR,
    maxX: b.maxX - PARAPET_CLEAR,
    maxZ: b.maxZ - PARAPET_CLEAR,
  };
  const iw = inner.maxX - inner.minX;
  const id = inner.maxZ - inner.minZ;
  if (iw < 1.5 || id < 1.5) return;
  const gardenFactor = roof === 'garden' ? 0.4 : 1;
  const wanted = Math.min(9, Math.floor(((iw * id) / 34) * gardenFactor * (0.6 + rand() * 0.8)));
  const weights = roof === 'terracotta' ? PITCHED_PROPS : PROP_WEIGHTS[b.district];
  for (let attempt = 0, placed = 0; attempt < wanted * 6 && placed < wanted; attempt++) {
    const kind = pickWeighted(weights, rand());
    let [pw, pd, ph] = PROP_SIZE[kind](rand);
    // Any of four ways round: an odd quarter turn swaps the footprint.
    const yaw = Math.floor(rand() * 4);
    if (yaw % 2) [pw, pd] = [pd, pw];
    if (pw > iw || pd > id) continue;
    const x = inner.minX + rand() * (iw - pw);
    const z = inner.minZ + rand() * (id - pd);
    const p: RoofProp = { kind, minX: x, minZ: z, maxX: x + pw, maxZ: z + pd, y0: b.height, height: ph, yaw: (yaw * Math.PI) / 2 };
    if (out.some((o) => overlaps(o, p, 0.5))) continue;
    out.push(p);
    placed++;
  }
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.minX < b.maxX + gap && b.minX < a.maxX + gap && a.minZ < b.maxZ + gap && b.minZ < a.maxZ + gap;
}

/** Block interior containing (x, z). */
function interiorAt(x: number, z: number): Rect {
  const bx = Math.floor((x + HALF_EXTENT) / BLOCK_SIZE);
  const bz = Math.floor((z + HALF_EXTENT) / BLOCK_SIZE);
  return blockInterior(bx, bz);
}

/**
 * Street-facing faces get a shop band (by district odds); some shops get an
 * awning, and in nightlife districts a neon tube along it.
 */
function planShops(b: Building, rand: () => number): { shopSides: number; shopfronts: Shopfront[] } {
  const style = DISTRICT_STYLES[b.district];
  const interior = interiorAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
  const street: boolean[] = [
    b.minZ - interior.minZ < STREET_GAP,
    interior.maxX - b.maxX < STREET_GAP,
    interior.maxZ - b.maxZ < STREET_GAP,
    b.minX - interior.minX < STREET_GAP,
  ];
  let shopSides = 0;
  const shopfronts: Shopfront[] = [];
  if (rand() >= style.shops) return { shopSides, shopfronts };
  for (let side = 0 as Side; side < 4; side = (side + 1) as Side) {
    if (!street[side]) continue;
    shopSides |= 1 << side;
    const alongX = side === 0 || side === 2;
    const lo = alongX ? b.minX : b.minZ;
    const hi = alongX ? b.maxX : b.maxZ;
    // Split the face into shops 4–7 m wide, with small gaps between awnings.
    let at = lo + 0.4;
    while (hi - 0.4 - at >= 2.5) {
      const width = Math.min(hi - 0.4 - at, 4 + rand() * 3);
      const hasAwning = rand() < 0.65;
      const neon = hasAwning && rand() < style.neon ? NEON_COLOURS[Math.floor(rand() * NEON_COLOURS.length)] : null;
      shopfronts.push({
        side,
        from: at,
        to: at + width,
        awning: hasAwning ? style.awnings[Math.floor(rand() * style.awnings.length)] : null,
        neon,
      });
      at += width + 0.5;
    }
  }
  return { shopSides, shopfronts };
}
