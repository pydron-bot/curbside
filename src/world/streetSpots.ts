/**
 * Fixed and picked places for the city's everyday life (game/cityLife.ts):
 * the hospital the ambulances drive to, kerbside parking spots and the
 * bays of the car parks, and where people stand in a queue or a crowd (the
 * bus shelters and food carts are world/streetStops.ts). Derived from the
 * road grid and the city layout (pure, deterministic per seed), so the
 * scenes, the markers and the radar agree.
 *
 * Roads run between nodes (ix, iz) on the BLOCK_SIZE grid; traffic keeps
 * right, so a car heading `dir` toward node (ix, iz) has its kerb on the
 * right. Parked cars stand against that kerb mid-block (clear of the
 * junctions, their crossings and the lane traffic drives in).
 */
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, core, lotBytes, mergedAway, type Block, type City } from './city';
import { DIR_VEC, canLeave, dirHeading, nodeValid, type Dir } from './roads';
import { len2 } from '../core/len';
import { builtBlockAt } from './landmarks';

/** A parked car's middle from the road centreline, m (a sedan is 1.9 m across: 1 m clear of the lane, 0.15 m off the kerb). */
export const PARK_OFFSET = ROAD_WIDTH / 2 - 1.1;
/** Parked cars stand this far from the arriving node at most / least, m (clear of junctions and their crossings). */
export const PARK_ALONG = [14, 50] as const;
/** One car length and a gap, m. */
export const PARK_PITCH = 6;
/** A van pulls in to the kerb this far from the centreline (half a lane toward the kerb), m. */
export const BUS_PULL_IN = ROAD_WIDTH / 4 + 1.6;

/** A point on the road network: on the segment arriving at node (ix, iz) heading `dir`, `along` m before the node. */
export interface RoadSpot {
  ix: number;
  iz: number;
  dir: Dir;
  /** Metres before the node (positive). */
  along: number;
  x: number;
  z: number;
  /** Vehicle heading (nose along (sin h, cos h)). */
  heading: number;
}

export interface Hospital {
  /** The doors, on the pavement. */
  x: number;
  z: number;
  /** Where an ambulance pulls up (on the road, kerbside). */
  bayX: number;
  bayZ: number;
  heading: number;
}

/** Somewhere to keep clear of (landmarks, pickups, ramps), with a radius, m. */
export interface Avoid {
  x: number;
  z: number;
  r: number;
}

/** A point `offset` m right of the centreline of the segment arriving at (ix, iz) heading `dir`, `along` m before it. */
export function roadPoint(ix: number, iz: number, dir: Dir, along: number, offset: number, out = { x: 0, z: 0 }): { x: number; z: number } {
  const v = DIR_VEC[dir];
  // Right of travel is (-v.z, v.x).
  out.x = ix * BLOCK_SIZE - v.x * along - v.z * offset;
  out.z = iz * BLOCK_SIZE - v.z * along + v.x * offset;
  return out;
}

/** Does the segment arriving at (ix, iz) heading `dir` exist (both its ends on the map)? */
export function segmentValid(ix: number, iz: number, dir: Dir): boolean {
  const v = DIR_VEC[dir];
  return nodeValid(ix, iz) && nodeValid(ix - v.x, iz - v.z) && canLeave(ix - v.x, iz - v.z, dir);
}

function clear(x: number, z: number, avoid: readonly Avoid[]): boolean {
  for (const a of avoid) if (len2(a.x - x, a.z - z) < a.r) return false;
  return true;
}

/** The hospital goes on a built-up block near here (east of the spawn, away from the police station). */
const HOSPITAL_TARGET = [10, 7] as const;
const WALK_INSET = ROAD_WIDTH / 2 + SIDEWALK / 2;

/**
 * The hospital: the pavement outside the middle of a built-up block near
 * HOSPITAL_TARGET, on its north side; ambulances pull up at the kerb there.
 */
export function placeHospital(city: City): Hospital {
  const tx = core(HOSPITAL_TARGET[0]);
  const tz = core(HOSPITAL_TARGET[1]);
  let best = city.blocks[0];
  let bestD = Infinity;
  // Moved by the map edits (round 3): onto that block if it's built up.
  const moved = builtBlockAt(city, 'hospital');
  for (const b of moved ? [] : city.blocks) {
    // A merged block by its north-west block, whose north side is on a road (round 3).
    if (b.kind !== 'buildings' || mergedAway(b)) continue;
    const d = len2(b.bx - tx, b.bz - tz);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (moved) best = moved;
  const x0 = -HALF_EXTENT + best.bx * BLOCK_SIZE;
  const z0 = -HALF_EXTENT + best.bz * BLOCK_SIZE;
  // Between two street lamps (every 16 m along the side). Eastbound traffic has this kerb on its right.
  const x = x0 + BLOCK_SIZE * 0.625;
  return { x, z: z0 + WALK_INSET, bayX: x, bayZ: z0 + PARK_OFFSET, heading: dirHeading(1) };
}

/**
 * A kerbside parking spot near (x, z): a random segment within `lo`..`hi`
 * m (by its node), a random bay along it. Null if the pick lands off the
 * map or too close to something in `avoid`; callers just try again.
 */
export function pickParkingSpot(x: number, z: number, lo: number, hi: number, rand: () => number, avoid: readonly Avoid[], out: RoadSpot): RoadSpot | null {
  const a = rand() * Math.PI * 2;
  const r = lo + rand() * (hi - lo);
  const ix = Math.round((x + Math.cos(a) * r) / BLOCK_SIZE);
  const iz = Math.round((z + Math.sin(a) * r) / BLOCK_SIZE);
  const dir = Math.floor(rand() * 4) as Dir;
  if (!segmentValid(ix, iz, dir)) return null;
  const bays = Math.floor((PARK_ALONG[1] - PARK_ALONG[0]) / PARK_PITCH) + 1;
  const along = PARK_ALONG[0] + Math.floor(rand() * bays) * PARK_PITCH;
  roadPoint(ix, iz, dir, along, PARK_OFFSET, out);
  if (!clear(out.x, out.z, avoid)) return null;
  const d = len2(out.x - x, out.z - z);
  if (d < lo || d > hi) return null;
  out.ix = ix;
  out.iz = iz;
  out.dir = dir;
  out.along = along;
  out.heading = dirHeading(dir);
  return out;
}

/**
 * Where the `i`th person in a queue stands: at a serving hatch on the
 * kerb side of something at (x, z) facing `heading` (`side` m to its
 * right), then back along the pavement a pace apart, each facing the
 * hatch. Written into `out`.
 */
export function queueSpot(x: number, z: number, heading: number, side: number, i: number, out: { x: number; z: number; heading: number }): { x: number; z: number; heading: number } {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  // Right of a vehicle heading h is (-cos h, sin h).
  const rx = -fz;
  const rz = fx;
  const back = i * 0.95;
  out.x = x + rx * side - fx * back;
  out.z = z + rz * side - fz * back;
  // The first faces the hatch; the rest the back of the one before.
  out.heading = i === 0 ? Math.atan2(-rx, -rz) : heading;
  return out;
}

/**
 * One random byte per block (in `city.blocks` order) from the ground's own
 * stream: world/ground.ts paints a plaza as a car park when its byte is
 * under 128 (and uses the byte for its look). Shared so the bays the cars
 * park in are the ones painted on the ground.
 */
/** One random byte per block, the same the ground paints car parks from (world/city.ts lotBytes). */
export function lotRolls(city: City): Uint8Array {
  return lotBytes(city);
}

/** Is this block a car park (a plaza the ground paints with bays)? `roll`: its lotRolls byte. */
export function isCarPark(block: Block, roll: number): boolean {
  return block.kind === 'plaza' && roll < 128;
}

/** A car park's bays: 2.6 m wide, 5 m deep, in double rows either side of 6 m aisles (as world/ground.ts paints them). */
const BAY_PITCH = 2.6;
const BAY_ROWS = 16;
/** The painted area reaches this far from the block's centre, m (the ground's G_LOT - 1.5). */
const BAY_SPAN = BLOCK_SIZE / 2 - (ROAD_WIDTH / 2 + SIDEWALK) - 1.5;

export interface Bay {
  x: number;
  z: number;
  /** Nose-in, toward the aisle. */
  heading: number;
}

/**
 * Every bay of every car park, its middle and the way a car parked
 * nose-in faces. Rows that the painted area cuts short are left out.
 */
export function carParkBays(city: City): Bay[] {
  const rolls = lotRolls(city);
  const out: Bay[] = [];
  city.blocks.forEach((b, i) => {
    if (!isCarPark(b, rolls[i])) return;
    const cx = -HALF_EXTENT + (b.bx + 0.5) * BLOCK_SIZE;
    const cz = -HALF_EXTENT + (b.bz + 0.5) * BLOCK_SIZE;
    for (let row = 0; row * BAY_ROWS < 2 * BAY_SPAN; row++) {
      // [bays 5][aisle 6][bays 5] from the span's edge; cars face the aisle.
      for (const [from, heading] of [
        [2.5, 0],
        [13.5, Math.PI],
      ] as const) {
        const v = row * BAY_ROWS + from;
        if (v + 2.5 > 2 * BAY_SPAN) continue;
        for (let k = 0; (k + 1) * BAY_PITCH <= 2 * BAY_SPAN; k++) {
          out.push({ x: cx - BAY_SPAN + (k + 0.5) * BAY_PITCH, z: cz - BAY_SPAN + v, heading });
        }
      }
    }
  });
  return out;
}

/**
 * A bay near (x, z), `lo`..`hi` m away, clear of `avoid`: one picked at
 * random among those that qualify (the caller checks it isn't taken).
 * Null if there are none.
 */
export function pickBay(bays: readonly Bay[], x: number, z: number, lo: number, hi: number, rand: () => number, avoid: readonly Avoid[]): Bay | null {
  let pick: Bay | null = null;
  let seen = 0;
  for (const b of bays) {
    if (Math.abs(b.x - x) > hi || Math.abs(b.z - z) > hi) continue;
    const d = len2(b.x - x, b.z - z);
    if (d < lo || d > hi || !clear(b.x, b.z, avoid)) continue;
    // Reservoir sampling: each qualifying bay equally likely, nothing allocated.
    if (rand() * ++seen < 1) pick = b;
  }
  return pick;
}

/**
 * Where the `i`th of a crowd stands round something at (x, z) (a busker,
 * a fight, a wreck): on rings `radius` m out and a pace further for each
 * ring after, spread round the circle (an arc of `arc` rad centred on
 * `facing`, if given), each facing the middle. Written into `out`.
 */
export function crowdSpot(x: number, z: number, radius: number, i: number, out: { x: number; z: number; heading: number }, facing = 0, arc = Math.PI * 2): { x: number; z: number; heading: number } {
  const perRing = Math.max(3, Math.floor((arc * radius) / 1.1));
  const ring = Math.floor(i / perRing);
  const k = i % perRing;
  const r = radius + ring * 0.9;
  // Fill from the middle of the arc outward, alternating sides; offset each ring by half a place.
  const step = arc / perRing;
  const side = k % 2 === 0 ? 1 : -1;
  const a = facing + side * Math.ceil(k / 2) * step + (ring % 2) * step * 0.5;
  out.x = x + Math.sin(a) * r;
  out.z = z + Math.cos(a) * r;
  out.heading = Math.atan2(x - out.x, z - out.z);
  return out;
}
