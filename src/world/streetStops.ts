/**
 * Places people stop at: bus shelters and food carts. Pure data from the
 * city seed (via streetProps.ts, which puts their models down), and a small
 * API for whoever brings them to life (people queueing at a cart, waiting
 * at a stop, a bus pulling in): `dressing.street.vendors` and
 * `dressing.street.busStops`, the same every game.
 *
 * - Food carts (hot dog, coffee) and fruit stands: on the kerb line, serving
 *   the pavement, busiest downtown (a few in the arts quarter and old town);
 *   and just inside the parks and the open plazas (not the car parks),
 *   serving the pavement beside them.
 * - Bus shelters: against the building side of the pavement, open to the
 *   road, beside a lane with no road works; most downtown and in the
 *   suburbs. One stands where Deacon Pike waits in Maple Flats
 *   (systems/missionsData.ts: pikeStop).
 */
import { core, isCarPark, lotBytes, type City } from './city';
import { KERB_LINE, WALK_LINE, blockSide, type BlockSide, type Placer } from './kerbs';
import { dirHeading, laneKey, type Dir } from './roads';
import type { Roadworks } from './roadworks';
import { len2 } from '../core/len';
import type { District } from './districts';

export type VendorKind = 'food_cart_hotdog' | 'food_cart_coffee' | 'fruit_stand';

/**
 * A food cart or stand. Customers stand at (serveX, serveZ) facing it; a
 * queue grows from there in steps of (queueX, queueZ) (a unit vector, along
 * the pavement, away from the vendor); the vendor stands at (vendorX,
 * vendorZ), at the cart's end. All in world metres, on open pavement or lot.
 */
export interface VendorSpot {
  kind: VendorKind;
  /** The cart's middle. */
  x: number;
  z: number;
  /** The way its serving side faces (vehicle convention: toward (sin, cos)). */
  heading: number;
  serveX: number;
  serveZ: number;
  queueX: number;
  queueZ: number;
  vendorX: number;
  vendorZ: number;
  /** Where it stands: on a downtown kerb, in a park, or on a plaza. */
  setting: 'kerb' | 'park' | 'plaza';
}

/**
 * A bus stop: the shelter (facing the road), where people wait (in front
 * of it, under the roof's edge, clear of the walking line), and where a bus
 * pulls in (beside it, near the kerb, nose along `dir`: the lane travelling
 * `dir` toward junction (ix, iz), roads.ts).
 */
export interface BusStop {
  x: number;
  z: number;
  heading: number;
  waitX: number;
  waitZ: number;
  stopX: number;
  stopZ: number;
  /** The bus's heading at the stop. */
  stopHeading: number;
  dir: Dir;
  ix: number;
  iz: number;
}

/** Shelters stand this far from the road's centreline (their back 0.45 m behind, short of any building), m. */
const SHELTER_LINE = 10.5;
/** People wait this far out (under the front of the roof), and a bus stops this far, m. */
const WAIT_LINE = 10.0;
const BUS_LINE = 6.3;
/** Chance of a shelter per block side, by district. */
const STOP_CHANCE: Readonly<Record<District, number>> = { downtown: 0.2, residential: 0.12, oldtown: 0.1, arts: 0.1, industrial: 0.05 };
/** Pike's stop (missionsData.ts pikeStop: block (3, 11), east side, half way along). */
const FIXED_STOPS: ReadonlyArray<readonly [bx: number, bz: number, side: number, t: number]> = [[3, 11, 1, 32]];

/** Chance of a kerb cart per block side, by district. */
const CART_CHANCE: Readonly<Record<District, number>> = { downtown: 0.3, arts: 0.1, oldtown: 0.1, residential: 0.03, industrial: 0.02 };
const KERB_MIX: Readonly<Record<District, readonly VendorKind[]>> = {
  downtown: ['food_cart_hotdog', 'food_cart_hotdog', 'food_cart_coffee', 'food_cart_coffee', 'fruit_stand'],
  arts: ['food_cart_coffee', 'fruit_stand', 'food_cart_hotdog'],
  oldtown: ['fruit_stand', 'fruit_stand', 'food_cart_coffee', 'food_cart_hotdog'],
  residential: ['fruit_stand', 'food_cart_hotdog'],
  industrial: ['food_cart_hotdog'],
};
const LOT_MIX: readonly VendorKind[] = ['food_cart_hotdog', 'food_cart_hotdog', 'food_cart_coffee', 'fruit_stand'];
/** Half-length and half-depth of each (along and across its facing), m. */
const SIZE: Readonly<Record<VendorKind, readonly [number, number]>> = {
  food_cart_hotdog: [0.8, 0.4],
  food_cart_coffee: [0.75, 0.4],
  fruit_stand: [1.0, 0.5],
};
/** In a park or plaza, carts stand this far inside the lot's edge (from the road's centreline), m. */
const LOT_LINE = 12.4;

export function placeBusStops(city: City, rand: () => number, placer: Placer, works: readonly Roadworks[]): BusStop[] {
  const closed = new Set(works.map((w) => laneKey(w.ix, w.iz, w.dir)));
  const stops: BusStop[] = [];
  const tryStop = (s: BlockSide, t: number): boolean => {
    if (closed.has(laneKey(s.ix, s.iz, s.dir))) return false;
    const along = (d: number) => s.at(t + d, SHELTER_LINE);
    const ends = [along(-1.3), along(0), along(1.3)];
    if (!ends.every((p) => placer.clear(p.x, p.z, 0.7))) return false;
    const bus = s.at(t, BUS_LINE);
    if (!placer.clearRoad(bus.x, bus.z, 1)) return false;
    const p = ends[1];
    placer.put('bus_shelter', p.x, p.z, s.toRoad);
    placer.claim(ends[0].x, ends[0].z, 0.9);
    placer.claim(ends[2].x, ends[2].z, 0.9);
    const wait = s.at(t, WAIT_LINE);
    stops.push({ x: p.x, z: p.z, heading: s.toRoad, waitX: wait.x, waitZ: wait.z, stopX: bus.x, stopZ: bus.z, stopHeading: dirHeading(s.dir), dir: s.dir, ix: s.ix, iz: s.iz });
    return true;
  };
  for (const [bx, bz, side, t] of FIXED_STOPS) {
    const b = city.blocks.find((k) => k.bx === core(bx) && k.bz === core(bz));
    if (b) tryStop(blockSide(b, side), t);
  }
  for (const b of city.blocks) {
    if (b.kind === 'plaza') continue;
    for (let side = 0; side < 4; side++) {
      const chance = rand() < STOP_CHANCE[b.district];
      const t = 26 + rand() * 12;
      if (chance) tryStop(blockSide(b, side), t);
    }
  }
  return stops;
}

export function placeVendors(city: City, rand: () => number, placer: Placer): VendorSpot[] {
  const spots: VendorSpot[] = [];
  const bytes = lotBytes(city);
  /**
   * A cart on side `s` at `t`, standing `inset` from the centreline, its
   * serving side toward the pavement's walking line; false if no room.
   */
  const tryCart = (s: BlockSide, t: number, inset: number, kind: VendorKind, setting: VendorSpot['setting']): boolean => {
    const [half, depth] = SIZE[kind];
    const towardRoad = inset > WALK_LINE;
    const heading = towardRoad ? s.toRoad : s.toRoad + Math.PI;
    const p = s.at(t, inset);
    // The first customer stands just off the serving side; the queue runs along the kerb toward the block's middle.
    const serveInset = towardRoad ? inset - depth - 0.75 : inset + depth + 0.45;
    const way = t < 32 ? 1 : -1;
    const serve = s.at(t, serveInset);
    const next = s.at(t + way, serveInset);
    const vendor = s.at(t - way * (half + 0.55), inset);
    if (!placer.clear(p.x, p.z, half + 0.2) || !placer.clear(serve.x, serve.z, 0.4) || !placer.clear(vendor.x, vendor.z, 0.35)) return false;
    placer.put(kind, p.x, p.z, heading);
    placer.claim(serve.x, serve.z, 0.4);
    placer.claim(vendor.x, vendor.z, 0.35);
    spots.push({ kind, x: p.x, z: p.z, heading, serveX: serve.x, serveZ: serve.z, queueX: next.x - serve.x, queueZ: next.z - serve.z, vendorX: vendor.x, vendorZ: vendor.z, setting });
    return true;
  };
  city.blocks.forEach((b, i) => {
    if (b.kind === 'buildings') {
      for (let side = 0; side < 4; side++) {
        const chance = rand() < CART_CHANCE[b.district];
        const mix = KERB_MIX[b.district];
        const kind = mix[Math.floor(rand() * mix.length)];
        const t = 21 + rand() * 22;
        if (chance) tryCart(blockSide(b, side), t, KERB_LINE + 0.05, kind, 'kerb');
      }
      return;
    }
    if (isCarPark(city, bytes, i)) return;
    // Parks get one or two, open plazas two, on sides of their own and clear of the trees' canopies.
    const n = b.kind === 'plaza' ? 2 : 1 + (rand() < 0.6 ? 1 : 0);
    const first = Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const side = (first + k * 2 + (k > 1 ? 1 : 0)) % 4;
      const kind = LOT_MIX[Math.floor(rand() * LOT_MIX.length)];
      const s = blockSide(b, side);
      for (let attempt = 0; attempt < 4; attempt++) {
        const t = 20 + rand() * 24;
        const p = s.at(t, LOT_LINE);
        if (city.trees.some((tr) => len2(tr.x - p.x, tr.z - p.z) < tr.radius + 1.3)) continue;
        if (tryCart(s, t, LOT_LINE, kind, b.kind === 'plaza' ? 'plaza' : 'park')) break;
      }
    }
  });
  return spots;
}
