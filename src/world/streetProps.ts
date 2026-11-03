/**
 * Street furniture, decided from the city seed so the same city always has
 * the same streets: the lamps and traffic lights, hydrants, benches, bins,
 * newspaper boxes, mailboxes, parking meters, planters, bike racks and
 * recycling bins along the kerbs (the mix by district), bollards along the
 * plazas, dumpsters at the mouths of alleys, and the parks' trees as one of
 * three models by district; and, from their own modules, road-works sites
 * at the kerb (roadworks.ts), bus shelters and food carts (streetStops.ts)
 * and café tables, vending machines and ATMs against shopfronts
 * (frontages.ts). Pure data, no three.js: render/worldProps.ts draws it, and
 * the solid parts go into the collision grid (lamp posts, signal poles,
 * bollards, dumpsters, planters, carts, shelters...). The small things a
 * car can knock flying (hydrants, bins, benches, cones...) are listed
 * separately for systems/knockables.ts.
 *
 * Everything at the kerb stands within a metre of the road edge, clear of
 * the line people walk down the middle of the pavement; benches and
 * shelters back onto the building side. Nothing goes within `avoid` points
 * (pickups, payphones, activity markers) or `keepOut` rects (Pay 'n' Spray
 * bays and their mouths: not even a lamp post, whose light pool then stands
 * alone), nor on top of anything placed before it.
 */
import { planBuildings, type BuildingPlan } from './buildingPlans';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, CORE_OFFSET, HALF_EXTENT, blockInterior, inCoreBlock, type Block, type Building, type City, type Rect } from './city';
import type { District } from './districts';
import { placeFrontages } from './frontages';
import { keyedStream, mulberry32 } from './random';
import { placeRoadworks, type Roadworks } from './roadworks';
import { signalPoles } from './signals';
import { BENCH_LINE, KERB_LINE, blockSide, type Placer } from './kerbs';
import { generateStreetLamps } from './streetLamps';
import { placeBusStops, placeVendors, type BusStop, type VendorSpot } from './streetStops';
import { len2 } from '../core/len';
import { PROP_MATCH, type PropEdit, type RoadEdit } from './mapEdits';

export const STREET_PROP_KINDS = [
  'streetlamp',
  'traffic_light',
  'hydrant',
  'bench',
  'trash_bin',
  'bollard',
  'newspaper_box',
  'mailbox',
  'dumpster',
  'tree_round',
  'tree_tall',
  'palm',
  'parking_meter',
  'planter',
  'bike_rack',
  'recycling_bin',
  'shopping_cart',
  'cafe_table',
  'vending_machine',
  'atm',
  'bus_shelter',
  'food_cart_hotdog',
  'food_cart_coffee',
  'fruit_stand',
  'traffic_cone',
  'traffic_barrel',
  'work_barrier',
  'roadwork_sign',
  'steel_plate',
  'work_trench',
  'skip',
  'mini_digger',
  'portable_toilet',
] as const;
export type StreetPropKind = (typeof STREET_PROP_KINDS)[number];

/**
 * Can the map edits (W3-D) add or remove this kind? Not lamps or traffic
 * lights: the lamps' light and the signals come from the city's own plans
 * (streetLamps.ts, signals.ts), so a post can't move without them.
 */
export function propEditable(kind: string): kind is StreetPropKind {
  return (STREET_PROP_KINDS as readonly string[]).includes(kind) && kind !== 'streetlamp' && kind !== 'traffic_light';
}

export interface StreetProp {
  kind: StreetPropKind;
  x: number;
  z: number;
  /** Facing (vehicle convention: the model's +Z toward (sin, cos)). */
  heading: number;
  scale: number;
  /** Traffic lights: the junction's cycle offset (s) and whether these lenses face east-west traffic. Others: a blink phase. */
  phase: number;
  eastWest: boolean;
  /** Colour (sRGB hex) for the model's `paint` surfaces (a vending machine's body). */
  tint?: string;
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
  /** Solid footprints for the collision grid (lamp posts, signal poles, bollards, dumpsters...). */
  solids: Rect[];
  knockables: Knockable[];
  /** Road-works sites at the kerb (roadworks.ts): traffic keeps to its lane past them. */
  roadworks: Roadworks[];
  /** Food carts and fruit stands, with where their customers stand (streetStops.ts). */
  vendors: VendorSpot[];
  /** Bus shelters, with where people wait and where a bus pulls in (streetStops.ts). */
  busStops: BusStop[];
  /** Prop edits that couldn't be applied: a removal that matched nothing, a kind that can't be edited (the map checks show them). */
  propEditProblems: PropEditProblem[];
}

export interface PropEditProblem {
  edit: PropEdit;
  problem: string;
}

export interface StreetPropOptions {
  /** Points to keep clear (radius in m): pickups, payphones, markers. */
  avoid?: ReadonlyArray<{ x: number; z: number; r: number }>;
  /** Areas to keep clear (spray bays, the docks' bay). */
  keepOut?: readonly Rect[];
  /** Points that things in the road keep clear of (mission cars at the kerb, ramps and their run-ups, the spawn corner). */
  reserve?: ReadonlyArray<{ x: number; z: number; r: number }>;
  /** Roads (roads.ts segmentKey) that get no road works (race legs). */
  quietRoads?: ReadonlySet<number>;
  /** The building plans (for the shopfronts), if already made. */
  plans?: readonly BuildingPlan[];
  /** Map edits (W3-D): roads closed to traffic (barriers across both ends). */
  closedRoads?: readonly RoadEdit[];
  /** Map edits: props added, and generated ones removed (by kind, within PROP_MATCH). */
  propEdits?: readonly PropEdit[];
}

/** Furniture slots along a block side (m from the block's corner), 3 m apart and clear of the lamps at 16, 32, 48. */
const SLOTS = [12, 19.5, 22.5, 25.5, 28.5, 35.5, 38.5, 41.5, 44.5, 52];
/** Furniture per block side, on average, by district. */
const DENSITY: Readonly<Record<District, number>> = { downtown: 3.8, arts: 3.0, oldtown: 2.7, residential: 2.1, industrial: 1.6 };
const MIX: Readonly<Record<District, ReadonlyArray<readonly [StreetPropKind, number]>>> = {
  downtown: [
    ['trash_bin', 3],
    ['newspaper_box', 2.2],
    ['parking_meter', 2.2],
    ['bench', 1.5],
    ['hydrant', 1.5],
    ['planter', 1.2],
    ['mailbox', 1],
    ['bike_rack', 0.8],
    ['recycling_bin', 0.6],
  ],
  oldtown: [
    ['hydrant', 2],
    ['bench', 2],
    ['trash_bin', 2],
    ['mailbox', 1.5],
    ['parking_meter', 1.5],
    ['newspaper_box', 1],
    ['planter', 1],
  ],
  arts: [
    ['bench', 2.5],
    ['trash_bin', 2],
    ['newspaper_box', 1.6],
    ['bike_rack', 1.6],
    ['hydrant', 1],
    ['planter', 1],
    ['recycling_bin', 0.8],
    ['parking_meter', 0.6],
  ],
  industrial: [
    ['hydrant', 2.6],
    ['trash_bin', 1.2],
    ['bollard', 1.4],
    ['traffic_barrel', 0.5],
    ['shopping_cart', 0.3],
  ],
  residential: [
    ['hydrant', 2],
    ['mailbox', 2],
    ['recycling_bin', 1.6],
    ['trash_bin', 1.5],
    ['bench', 1],
    ['bike_rack', 0.4],
    ['shopping_cart', 0.3],
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

/**
 * Footprints for collision and knocking, in the model's frame (x across,
 * z along its facing): solid boxes as half-sizes, or rects for things made
 * of several walls (a bus shelter's back and ends, open at the front).
 * A prop not listed is neither (lying flat: plates, a trench).
 */
const SOLID_HALF: Partial<Record<StreetPropKind, readonly [number, number]>> = {
  streetlamp: [0.2, 0.2],
  traffic_light: [0.2, 0.2],
  bollard: [0.14, 0.14],
  dumpster: [1.02, 0.68],
  planter: [0.6, 0.35],
  vending_machine: [0.5, 0.4],
  atm: [0.4, 0.3],
  food_cart_hotdog: [0.8, 0.4],
  food_cart_coffee: [0.75, 0.4],
  fruit_stand: [1.0, 0.5],
  skip: [0.8, 1.3],
  portable_toilet: [0.55, 0.55],
};
const SOLID_RECTS: Partial<Record<StreetPropKind, readonly Rect[]>> = {
  bus_shelter: [
    { minX: -1.72, minZ: -0.45, maxX: 1.72, maxZ: -0.33 },
    { minX: -1.72, minZ: -0.45, maxX: -1.6, maxZ: 0.33 },
    { minX: 1.6, minZ: -0.45, maxX: 1.72, maxZ: 0.33 },
  ],
  mini_digger: [{ minX: -0.75, minZ: -1.3, maxX: 0.75, maxZ: 1.45 }],
};
const KNOCK_RADIUS: Partial<Record<StreetPropKind, number>> = {
  hydrant: 0.25,
  trash_bin: 0.32,
  newspaper_box: 0.32,
  mailbox: 0.32,
  bench: 0.95,
  parking_meter: 0.18,
  recycling_bin: 0.34,
  bike_rack: 0.92,
  shopping_cart: 0.45,
  cafe_table: 0.85,
  traffic_cone: 0.3,
  traffic_barrel: 0.3,
  work_barrier: 0.92,
  roadwork_sign: 0.58,
};
/** Long furniture people (and cars) meet as a box (half-sizes, m), clear of the walk line or the lane. */
const KNOCK_BOX: Partial<Record<StreetPropKind, readonly [number, number]>> = {
  bench: [0.9, 0.3],
  bike_rack: [0.9, 0.25],
  cafe_table: [0.8, 0.4],
  work_barrier: [0.9, 0.12],
  roadwork_sign: [0.55, 0.3],
};
/** How much room a prop takes for later placements (radius, m); 0.4 if not listed, trees take none. */
const ROOM: Partial<Record<StreetPropKind, number>> = {
  streetlamp: 0.3,
  traffic_light: 0.3,
  bollard: 0.2,
  hydrant: 0.3,
  parking_meter: 0.2,
  bench: 0.95,
  bike_rack: 0.95,
  planter: 0.65,
  cafe_table: 0.9,
  dumpster: 1.2,
  bus_shelter: 1.0,
  food_cart_hotdog: 1.0,
  food_cart_coffee: 0.95,
  fruit_stand: 1.15,
  vending_machine: 0.6,
  atm: 0.5,
  traffic_cone: 0.3,
  traffic_barrel: 0.3,
  work_barrier: 0.9,
  roadwork_sign: 0.6,
  steel_plate: 1.3,
  work_trench: 1.8,
  skip: 1.4,
  mini_digger: 1.4,
  portable_toilet: 0.7,
};
const NO_ROOM: ReadonlySet<StreetPropKind> = new Set(['tree_round', 'tree_tall', 'palm']);
/** Bucket size for the taken-room lookup, m. */
const ROOM_CELL = 4;

export function placeStreetProps(city: City, opts: StreetPropOptions = {}): StreetProps {
  const props: StreetProp[] = [];
  const solids: Rect[] = [];
  const knockables: Knockable[] = [];
  const avoid = opts.avoid ?? [];
  const keepOut = opts.keepOut ?? [];
  const reserve = opts.reserve ?? [];
  // Room taken by what's placed so far, bucketed: [x, z, r] triples per cell.
  const taken = new Map<number, number[]>();
  const roomKey = (cx: number, cz: number) => (cx + 4096) * 8192 + cz + 4096;
  const free = (x: number, z: number, r: number) => {
    const reach = Math.ceil((r + 2) / ROOM_CELL);
    const cx = Math.floor(x / ROOM_CELL);
    const cz = Math.floor(z / ROOM_CELL);
    for (let i = cx - reach; i <= cx + reach; i++) {
      for (let j = cz - reach; j <= cz + reach; j++) {
        const list = taken.get(roomKey(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 3) if (len2(list[k] - x, list[k + 1] - z) < list[k + 2] + r) return false;
      }
    }
    return true;
  };
  const outside = (x: number, z: number, r: number) => !keepOut.some((k) => x > k.minX - r && x < k.maxX + r && z > k.minZ - r && z < k.maxZ + r);
  const clear = (x: number, z: number, r: number) => outside(x, z, r) && !avoid.some((a) => len2(a.x - x, a.z - z) < a.r + r) && free(x, z, r);
  const clearRoad = (x: number, z: number, r: number) => clear(x, z, r) && !reserve.some((a) => len2(a.x - x, a.z - z) < a.r + r);

  const claim = (x: number, z: number, r: number) => {
    const key = roomKey(Math.floor(x / ROOM_CELL), Math.floor(z / ROOM_CELL));
    let list = taken.get(key);
    if (!list) taken.set(key, (list = []));
    list.push(x, z, r);
  };
  // Removals (map edits) waiting for the generated prop they name; added props come last.
  const removals = (opts.propEdits ?? []).filter((e) => e.removed && propEditable(e.kind)).map((edit) => ({ edit, used: false }));
  const removed = (kind: StreetPropKind, x: number, z: number) => {
    for (const r of removals) {
      if (r.used || r.edit.kind !== kind || len2(r.edit.x - x, r.edit.z - z) > PROP_MATCH) continue;
      return (r.used = true);
    }
    return false;
  };
  const put = (kind: StreetPropKind, x: number, z: number, heading: number, scale = 1, phase = 0, eastWest = false, tint?: string) => {
    // A removed prop still takes its room, so nothing else moves in (the edit stays local).
    if (removals.length > 0 && removed(kind, x, z)) {
      if (!NO_ROOM.has(kind)) claim(x, z, (ROOM[kind] ?? 0.4) * scale);
      return -1;
    }
    const i = props.push(tint ? { kind, x, z, heading, scale, phase, eastWest, tint } : { kind, x, z, heading, scale, phase, eastWest }) - 1;
    // Turned a quarter, a footprint swaps.
    const turned = Math.abs(Math.sin(heading)) > 0.5;
    const half = SOLID_HALF[kind];
    if (half) {
      const hx = (turned ? half[1] : half[0]) * scale;
      const hz = (turned ? half[0] : half[1]) * scale;
      solids.push({ minX: x - hx, minZ: z - hz, maxX: x + hx, maxZ: z + hz });
    }
    for (const r of SOLID_RECTS[kind] ?? []) solids.push(turnRect(x, z, heading, r));
    const r = KNOCK_RADIUS[kind];
    const box = KNOCK_BOX[kind];
    if (r && box) knockables.push({ prop: i, x, z, radius: r * scale, hx: (turned ? box[1] : box[0]) * scale, hz: (turned ? box[0] : box[1]) * scale });
    else if (r) knockables.push({ prop: i, x, z, radius: r * scale });
    if (!NO_ROOM.has(kind)) claim(x, z, (ROOM[kind] ?? 0.4) * scale);
    return i;
  };
  const placer: Placer = { clear, clearRoad, claim, put: (kind, x, z, heading, scale, phase, tint) => put(kind, x, z, heading, scale, phase, false, tint) };

  // Lamps: every one the shaders light, except where one would stand in a
  // bay's mouth (its pool of light stays; better than a post in the way).
  for (const l of generateStreetLamps()) if (outside(l.x, l.z, 0.3)) put('streetlamp', l.x, l.z, Math.atan2(l.dx, l.dz));
  // Traffic lights at the signalled junctions.
  for (const p of signalPoles()) if (outside(p.x, p.z, 0.3)) put('traffic_light', p.x, p.z, p.heading, 1, p.offset, p.eastWest);

  // The bigger things first, each from its own stream, so they get their pick of the kerbs.
  const roadworks = placeRoadworks(city, mulberry32((city.seed * 2654435761) ^ 0x60ad), placer, opts.quietRoads ?? new Set());
  // Road works pick from every kerb but don't read block kinds, so a map edit
  // leaves them be; everything after is placed block by block (or building by
  // building), each from a stream of its own keyed by core block (W3-D), so an
  // edited block moves nothing in any other and the core's furniture stays put
  // at any city size (W3-A).
  const busStops = placeBusStops(city, placer, roadworks);
  const vendors = placeVendors(city, placer);
  placeFrontages(city, opts.plans ?? planBuildings(city), placer);

  // The core city's kerbs and alleys, then a bigger city's ring.
  for (const ring of [false, true]) {
    const blocks = city.blocks.filter((b) => inCoreBlock(b.bx, b.bz) !== ring);
    dressBlocks(city, blocks, clear, put);
    placeDumpsters(city, city.buildings.filter((b) => inCoreBlock(...blockOf(b)) !== ring), clear, put);
  }

  // Map edits (W3-D), after everything generated: barriers across closed roads, then added props.
  const propEditProblems: PropEditProblem[] = removals.filter((r) => !r.used).map((r) => ({ edit: r.edit, problem: `no ${r.edit.kind} within ${PROP_MATCH} m to remove` }));
  removals.length = 0;
  for (const r of opts.closedRoads ?? []) {
    closeRoadEnd(r.a[0], r.a[1], r.b[0], r.b[1], put);
    closeRoadEnd(r.b[0], r.b[1], r.a[0], r.a[1], put);
  }
  for (const e of opts.propEdits ?? []) {
    if (!propEditable(e.kind)) {
      const known = (STREET_PROP_KINDS as readonly string[]).includes(e.kind);
      propEditProblems.push({ edit: e, problem: known ? `a ${e.kind} can't be ${e.removed ? 'removed' : 'added'} (the city's lighting and signals plan them)` : `unknown prop kind "${e.kind}"` });
    } else if (!e.removed) put(e.kind, e.x, e.z, e.heading ?? 0);
  }
  return { props, solids, knockables, roadworks, vendors, busStops, propEditProblems };
}

/** Closed-road barriers stand this far into the road from its crossing's centre: past the stop line and the people's crossing, m. */
const CLOSURE_ALONG = 12;
/** Barriers across the carriageway (offsets from the centreline, m), and a blinking barrel at each kerb. */
const CLOSURE_BARRIERS = [-5.5, -3.3, -1.1, 1.1, 3.3, 5.5];
const CLOSURE_BARRELS = [-7.2, 7.2];

/** A line of road-works barriers across the road from crossing (ix, iz) toward its neighbour (tx, tz), knockable like a site's. */
function closeRoadEnd(ix: number, iz: number, tx: number, tz: number, put: (kind: StreetPropKind, x: number, z: number, heading: number, scale?: number, phase?: number) => number): void {
  const vx = Math.sign(tx - ix);
  const vz = Math.sign(tz - iz);
  const cx = ix * BLOCK_SIZE + vx * CLOSURE_ALONG;
  const cz = iz * BLOCK_SIZE + vz * CLOSURE_ALONG;
  // Across the road is (-vz, vx); a barrier's long side is across its heading.
  const heading = Math.atan2(vx, vz);
  CLOSURE_BARRIERS.forEach((o, k) => put('work_barrier', cx - vz * o, cz + vx * o, heading, 1, k * 0.17));
  for (const o of CLOSURE_BARRELS) put('traffic_barrel', cx - vz * o, cz + vx * o, heading, 1, 0.5);
}

/** Block (bx, bz) a building stands in. */
const blockOf = (b: Rect): [number, number] => [Math.floor(((b.minX + b.maxX) / 2 + HALF_EXTENT) / BLOCK_SIZE), Math.floor(((b.minZ + b.maxZ) / 2 + HALF_EXTENT) / BLOCK_SIZE)];

/** A waste lot's junk, by weight: what gets dumped on an empty plot. */
const LOT_JUNK: ReadonlyArray<readonly [StreetPropKind, number]> = [
  ['dumpster', 1],
  ['traffic_barrel', 2],
  ['shopping_cart', 1.5],
  ['traffic_cone', 1.5],
  ['trash_bin', 0.6],
];

/** Kerbside furniture round each block, bollards round plazas (a broken line round a waste lot, its junk inside), trees in parks. */
function dressBlocks(city: City, blocks: readonly Block[], clear: (x: number, z: number, r: number) => boolean, put: Put): void {
  for (const b of blocks) {
    const rand = keyedStream(city.seed, 0x7e11, b.bx - CORE_OFFSET, b.bz - CORE_OFFSET);
    for (let side = 0; side < 4; side++) {
      const s = blockSide(b, side);
      const { at, toRoad } = s;
      if (b.kind === 'plaza') {
        // A row of bollards along the kerb, keeping the plaza's middle open to the street.
        for (let t = 16; t <= 48; t += 2.4) {
          const p = at(t, KERB_LINE);
          if (Math.abs(t - 32) < 4.5 || !clear(p.x, p.z, 0.4)) continue;
          put('bollard', p.x, p.z, toRoad);
        }
        continue;
      }
      if (b.kind === 'lot') {
        // What's left of a row of bollards, with a gap where the trucks drive in.
        for (let t = 10; t <= 54; t += 3) {
          const p = at(t, KERB_LINE);
          if (rand() < 0.35 || Math.abs(t - 32) < 5 || !clear(p.x, p.z, 0.4)) continue;
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
        const p = at(t + (rand() - 0.5), bench ? BENCH_LINE : KERB_LINE + (kind === 'hydrant' ? -0.05 : 0.1));
        // Carts get left at any angle; the rest face the road (benches, hydrants, racks, meters) or the people walking by.
        const facing =
          kind === 'shopping_cart'
            ? rand() * Math.PI * 2
            : bench || kind === 'hydrant' || kind === 'bollard' || kind === 'bike_rack' || kind === 'parking_meter' || kind === 'planter'
              ? toRoad
              : toRoad + Math.PI;
        if (!clear(p.x, p.z, ROOM[kind] ?? 0.4)) continue;
        put(kind, p.x, p.z, facing);
      }
    }
    if (b.kind === 'park') plantTrees(city, b.bx, b.bz, b.district, put);
    if (b.kind === 'lot') {
      const r = b.interior;
      const n = 4 + Math.floor(rand() * 5);
      for (let k = 0; k < n; k++) {
        const x = r.minX + 4 + rand() * (r.maxX - r.minX - 8);
        const z = r.minZ + 4 + rand() * (r.maxZ - r.minZ - 8);
        const kind = pick(LOT_JUNK, rand());
        const heading = rand() * Math.PI * 2;
        // Solid things (dumpsters) to a quarter turn: the collision boxes are axis-aligned.
        if (clear(x, z, ROOM[kind] ?? 0.6)) put(kind, x, z, SOLID_HALF[kind] ? Math.round(heading / (Math.PI / 2)) * (Math.PI / 2) : heading);
      }
    }
  }
}

/** A rect in a prop's own frame (x across, z along its facing), turned by a whole number of quarters into the world. */
export function turnRect(x: number, z: number, heading: number, r: Rect): Rect {
  const s = Math.round(Math.sin(heading));
  const c = Math.round(Math.cos(heading));
  // Local (lx, lz) → world (x + lx·c + lz·s, z - lx·s + lz·c).
  const ax = x + r.minX * c + r.minZ * s;
  const az = z - r.minX * s + r.minZ * c;
  const bx = x + r.maxX * c + r.maxZ * s;
  const bz = z - r.maxX * s + r.maxZ * c;
  return { minX: Math.min(ax, bx), minZ: Math.min(az, bz), maxX: Math.max(ax, bx), maxZ: Math.max(az, bz) };
}

function pick<T>(list: ReadonlyArray<readonly [T, number]>, r: number): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [v, w] of list) if ((x -= w) <= 0) return v;
  return list[list.length - 1][0];
}

type Put = (kind: StreetPropKind, x: number, z: number, heading: number, scale?: number) => number;

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
function placeDumpsters(city: City, buildings: readonly Building[], clear: (x: number, z: number, r: number) => boolean, put: Put): void {
  const byBlock = new Map<number, Building[]>();
  for (const b of buildings) {
    const [bx, bz] = blockOf(b);
    const key = bx * BLOCKS_PER_SIDE + bz;
    let list = byBlock.get(key);
    if (!list) byBlock.set(key, (list = []));
    list.push(b);
  }
  for (const [key, list] of byBlock) {
    const bx = Math.floor(key / BLOCKS_PER_SIDE);
    const bz = key % BLOCKS_PER_SIDE;
    const r = blockInterior(bx, bz);
    const rand = keyedStream(city.seed, 0xd0b5, bx - CORE_OFFSET, bz - CORE_OFFSET);
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
