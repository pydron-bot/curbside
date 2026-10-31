/**
 * Street furniture, decided from the city seed so the same city always has
 * the same streets: the lamps and traffic lights, hydrants, benches, bins,
 * newspaper boxes and mailboxes along the kerbs (the mix by district),
 * bollards along the plazas, dumpsters at the mouths of alleys, and the
 * parks' trees as one of three models by district. Pure data, no three.js:
 * render/worldProps.ts draws it, and the solid parts go into the collision
 * grid (lamp posts, signal poles, bollards, dumpsters). The small things a
 * car can knock flying (hydrants, bins, benches...) are listed separately
 * for systems/knockables.ts.
 *
 * Everything at the kerb stands within a metre of the road edge, clear of
 * the line people walk down the middle of the pavement; benches back onto
 * the building side. Nothing goes within `avoid` points (pickups, payphones,
 * activity markers) or `keepOut` rects (Pay 'n' Spray bays and their mouths:
 * not even a lamp post, whose light pool then stands alone).
 */
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, blockInterior, type Building, type City, type Rect } from './city';
import type { District } from './districts';
import { mulberry32 } from './random';
import { signalPoles } from './signals';
import { generateStreetLamps } from './streetLamps';

export type StreetPropKind =
  | 'streetlamp'
  | 'traffic_light'
  | 'hydrant'
  | 'bench'
  | 'trash_bin'
  | 'bollard'
  | 'newspaper_box'
  | 'mailbox'
  | 'dumpster'
  | 'tree_round'
  | 'tree_tall'
  | 'palm';

export interface StreetProp {
  kind: StreetPropKind;
  x: number;
  z: number;
  /** Facing (vehicle convention: the model's +Z toward (sin, cos)). */
  heading: number;
  scale: number;
  /** Traffic lights: the junction's cycle offset (s) and whether these lenses face east-west traffic. */
  phase: number;
  eastWest: boolean;
}

/** Something a car knocks flying instead of stopping dead at: where, how far it reaches, which prop. */
export interface Knockable {
  /** Index into StreetProps.props. */
  prop: number;
  x: number;
  z: number;
  radius: number;
  /** Half-sizes of its box (benches), which people collide with instead of the radius, m. */
  hx?: number;
  hz?: number;
}

export interface StreetProps {
  props: StreetProp[];
  /** Solid footprints for the collision grid (lamp posts, signal poles, bollards, dumpsters). */
  solids: Rect[];
  knockables: Knockable[];
}

export interface StreetPropOptions {
  /** Points to keep clear (radius in m): pickups, payphones, markers. */
  avoid?: ReadonlyArray<{ x: number; z: number; r: number }>;
  /** Areas to keep clear (spray bays, the docks' bay). */
  keepOut?: readonly Rect[];
}

/** Kerb line (lamps, hydrants, bins): this far from the road centreline, m. */
const KERB_LINE = ROAD_WIDTH / 2 + 0.5;
/** Benches stand back against the building side of the pavement, m from the centreline. */
const BENCH_LINE = ROAD_WIDTH / 2 + SIDEWALK - 0.45;
/** Furniture slots along a block side (m from the block's corner), clear of the lamps at 16, 32, 48. */
const SLOTS = [12, 20.5, 24, 27.5, 36.5, 40, 43.5, 52];
/** Furniture per block side, on average, by district. */
const DENSITY: Readonly<Record<District, number>> = { downtown: 2.6, arts: 2.2, oldtown: 1.9, residential: 1.5, industrial: 1.1 };
const MIX: Readonly<Record<District, ReadonlyArray<readonly [StreetPropKind, number]>>> = {
  downtown: [
    ['trash_bin', 3],
    ['newspaper_box', 2.2],
    ['bench', 1.5],
    ['hydrant', 1.5],
    ['mailbox', 1],
  ],
  oldtown: [
    ['hydrant', 2],
    ['bench', 2],
    ['trash_bin', 2],
    ['mailbox', 1.5],
    ['newspaper_box', 1],
  ],
  arts: [
    ['bench', 2.5],
    ['trash_bin', 2],
    ['newspaper_box', 1.6],
    ['hydrant', 1],
  ],
  industrial: [
    ['hydrant', 2.6],
    ['trash_bin', 1.2],
    ['bollard', 1.4],
  ],
  residential: [
    ['hydrant', 2],
    ['mailbox', 2],
    ['trash_bin', 1.5],
    ['bench', 1],
  ],
};
/** Park trees by district: [round, tall, palm] weights. */
const TREES: Readonly<Record<District, readonly [number, number, number]>> = {
  downtown: [0.6, 0, 0.4],
  arts: [0.5, 0, 0.5],
  oldtown: [0.7, 0.3, 0],
  residential: [0.5, 0.5, 0],
  industrial: [0.2, 0.8, 0],
};
/** Canopy radius of each tree model at scale 1, m. */
const TREE_RADIUS = { tree_round: 1.43, tree_tall: 1.5, palm: 2.6 } as const;

/** Footprints (half-sizes, m) for collision and knocking; a prop not listed is neither. */
const SOLID_HALF: Partial<Record<StreetPropKind, readonly [number, number]>> = {
  streetlamp: [0.2, 0.2],
  traffic_light: [0.2, 0.2],
  bollard: [0.14, 0.14],
  dumpster: [1.02, 0.68],
};
const KNOCK_RADIUS: Partial<Record<StreetPropKind, number>> = {
  hydrant: 0.25,
  trash_bin: 0.32,
  newspaper_box: 0.32,
  mailbox: 0.32,
  bench: 0.95,
};
/** Long furniture people walk around as a box (half-sizes, m), clear of the walk line. */
const KNOCK_BOX: Partial<Record<StreetPropKind, readonly [number, number]>> = {
  bench: [0.9, 0.3],
};

export function placeStreetProps(city: City, opts: StreetPropOptions = {}): StreetProps {
  const props: StreetProp[] = [];
  const solids: Rect[] = [];
  const knockables: Knockable[] = [];
  const avoid = opts.avoid ?? [];
  const keepOut = opts.keepOut ?? [];
  const outside = (x: number, z: number, r: number) => !keepOut.some((k) => x > k.minX - r && x < k.maxX + r && z > k.minZ - r && z < k.maxZ + r);
  const clear = (x: number, z: number, r: number) => outside(x, z, r) && !avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r + r);

  const put = (kind: StreetPropKind, x: number, z: number, heading: number, scale = 1, phase = 0, eastWest = false) => {
    const i = props.push({ kind, x, z, heading, scale, phase, eastWest }) - 1;
    // Turned a quarter, a footprint swaps.
    const turned = Math.abs(Math.sin(heading)) > 0.5;
    const half = SOLID_HALF[kind];
    if (half) {
      const hx = (turned ? half[1] : half[0]) * scale;
      const hz = (turned ? half[0] : half[1]) * scale;
      solids.push({ minX: x - hx, minZ: z - hz, maxX: x + hx, maxZ: z + hz });
    }
    const r = KNOCK_RADIUS[kind];
    const box = KNOCK_BOX[kind];
    if (r && box) knockables.push({ prop: i, x, z, radius: r * scale, hx: (turned ? box[1] : box[0]) * scale, hz: (turned ? box[0] : box[1]) * scale });
    else if (r) knockables.push({ prop: i, x, z, radius: r * scale });
  };

  // Lamps: every one the shaders light, except where one would stand in a
  // bay's mouth (its pool of light stays; better than a post in the way).
  for (const l of generateStreetLamps()) if (outside(l.x, l.z, 0.3)) put('streetlamp', l.x, l.z, Math.atan2(l.dx, l.dz));
  // Traffic lights at the signalled junctions.
  for (const p of signalPoles()) if (outside(p.x, p.z, 0.3)) put('traffic_light', p.x, p.z, p.heading, 1, p.offset, p.eastWest);

  const rand = mulberry32((city.seed * 2654435761) ^ 0x7e11);
  for (const b of city.blocks) {
    const x0 = -HALF_EXTENT + b.bx * BLOCK_SIZE;
    const z0 = -HALF_EXTENT + b.bz * BLOCK_SIZE;
    // Sides: [outward toward the road (x, z)], run along x for north/south sides.
    for (let side = 0; side < 4; side++) {
      const ox = side === 1 ? 1 : side === 3 ? -1 : 0;
      const oz = side === 0 ? -1 : side === 2 ? 1 : 0;
      const alongX = oz !== 0;
      const at = (t: number, inset: number) => ({
        x: alongX ? x0 + t : ox < 0 ? x0 + inset : x0 + BLOCK_SIZE - inset,
        z: alongX ? (oz < 0 ? z0 + inset : z0 + BLOCK_SIZE - inset) : z0 + t,
      });
      const toRoad = Math.atan2(ox, oz);
      if (b.kind === 'plaza') {
        // A row of bollards along the kerb, keeping the plaza's middle open to the street.
        for (let t = 16; t <= 48; t += 2.4) {
          const p = at(t, KERB_LINE);
          if (Math.abs(t - 32) < 4.5 || !clear(p.x, p.z, 0.4)) continue;
          put('bollard', p.x, p.z, toRoad);
        }
        continue;
      }
      const n = Math.floor(DENSITY[b.district] * (0.5 + rand()));
      const slots = SLOTS.slice();
      for (let k = 0; k < n && slots.length; k++) {
        const t = slots.splice(Math.floor(rand() * slots.length), 1)[0];
        const kind = pick(MIX[b.district], rand());
        const bench = kind === 'bench';
        const p = at(t + (rand() - 0.5) * 1.5, bench ? BENCH_LINE : KERB_LINE + (kind === 'hydrant' ? -0.05 : 0.1));
        if (!clear(p.x, p.z, bench ? 1.2 : 0.6)) continue;
        // Benches and hydrants face the road; boxes face the people walking by.
        const facing = bench || kind === 'hydrant' || kind === 'bollard' ? toRoad : toRoad + Math.PI;
        put(kind, p.x, p.z, facing);
      }
    }
    if (b.kind === 'park') plantTrees(city, b.bx, b.bz, b.district, put);
  }
  placeDumpsters(city, rand, clear, put);
  return { props, solids, knockables };
}

function pick<T>(list: ReadonlyArray<readonly [T, number]>, r: number): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [v, w] of list) if ((x -= w) <= 0) return v;
  return list[list.length - 1][0];
}

type Put = (kind: StreetPropKind, x: number, z: number, heading: number, scale?: number) => void;

/** The park's trees (city.trees, already colliding) as models: the kind by district, sized to the canopy. */
function plantTrees(city: City, bx: number, bz: number, district: District, put: Put): void {
  const r = blockInterior(bx, bz);
  const [round, tall] = TREES[district];
  for (const t of city.trees) {
    if (t.x < r.minX || t.x > r.maxX || t.z < r.minZ || t.z > r.maxZ) continue;
    const h = hash2(t.x, t.z);
    const kind: StreetPropKind = h < round ? 'tree_round' : h < round + tall ? 'tree_tall' : 'palm';
    const scale = Math.max(0.75, Math.min(1.6, (t.radius / TREE_RADIUS[kind]) * 1.15));
    put(kind, t.x, t.z, hash2(t.z, t.x) * Math.PI * 2, scale);
  }
}

/** Deterministic 0..1 from a position (stable per tree). */
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Dumpsters in alleys: where two buildings in a block stand 2.5–6 m apart
 * along a shared stretch, about a third of those gaps get one against a
 * wall a few metres in from the pavement, long side along the alley.
 */
function placeDumpsters(city: City, rand: () => number, clear: (x: number, z: number, r: number) => boolean, put: Put): void {
  const byBlock = new Map<number, Building[]>();
  for (const b of city.buildings) {
    const bx = Math.floor(((b.minX + b.maxX) / 2 + HALF_EXTENT) / BLOCK_SIZE);
    const bz = Math.floor(((b.minZ + b.maxZ) / 2 + HALF_EXTENT) / BLOCK_SIZE);
    const key = bx * BLOCKS_PER_SIDE + bz;
    let list = byBlock.get(key);
    if (!list) byBlock.set(key, (list = []));
    list.push(b);
  }
  for (const [key, list] of byBlock) {
    const r = blockInterior(Math.floor(key / BLOCKS_PER_SIDE), key % BLOCKS_PER_SIDE);
    for (const a of list) {
      for (const b of list) {
        if (a === b) continue;
        // An alley running along z: b to the east of a.
        const gapX = b.minX - a.maxX;
        const overZ0 = Math.max(a.minZ, b.minZ);
        const overZ1 = Math.min(a.maxZ, b.maxZ);
        if (gapX >= 2.5 && gapX <= 6 && overZ1 - overZ0 > 8 && rand() < 0.35) {
          // At whichever end opens onto the pavement.
          const north = overZ0 - r.minZ < 2.5;
          const south = r.maxZ - overZ1 < 2.5;
          if (north || south) {
            const z = north ? overZ0 + 3.5 : overZ1 - 3.5;
            const x = a.maxX + 0.7;
            if (clear(x, z, 1.4)) put('dumpster', x, z, Math.PI / 2);
          }
        }
        // An alley running along x: b to the south of a.
        const gapZ = b.minZ - a.maxZ;
        const overX0 = Math.max(a.minX, b.minX);
        const overX1 = Math.min(a.maxX, b.maxX);
        if (gapZ >= 2.5 && gapZ <= 6 && overX1 - overX0 > 8 && rand() < 0.35) {
          const west = overX0 - r.minX < 2.5;
          const east = r.maxX - overX1 < 2.5;
          if (west || east) {
            const x = west ? overX0 + 3.5 : overX1 - 3.5;
            const z = a.maxZ + 0.7;
            if (clear(x, z, 1.4)) put('dumpster', x, z, 0);
          }
        }
      }
    }
  }
}
