/**
 * The landmarks as props.glb models: a spray-booth shell over each Pay 'n'
 * Spray bay and the export garage over the docks' bay (both open toward the
 * road, walls solid), the POLICE sign on the station's wall, the roller door
 * over the safehouse, a payphone at each mission phone, a chequered gantry
 * over every race's first straight with jersey barriers and cones beside it,
 * and the ramp and kicker models on the stunt ramps. Pure data, derived from
 * the same placements the rules use (world/landmarks.ts, game/modes/places.ts,
 * game/modes/races.ts, world/ramps.ts), so model, glow and rule agree.
 */
import { BLOCK_SIZE, ROAD_WIDTH, SIDEWALK, type City, type Rect } from './city';
import type { SprayShop, Station } from './landmarks';
import type { Ramp } from './ramps';
import type { Knockable } from './streetProps';

export interface LandmarkProp {
  kind: string;
  x: number;
  z: number;
  y: number;
  heading: number;
  /** Scale across (model x), up, along (model z). */
  sx: number;
  sy: number;
  sz: number;
}

export interface Landmarks {
  props: LandmarkProp[];
  solids: Rect[];
  /** Cones a car scatters (prop = index into props). */
  knockables: Knockable[];
  /** Places the street furniture keeps clear of. */
  avoid: Array<{ x: number; z: number; r: number }>;
}

export interface LandmarkInput {
  city: City;
  shops: readonly SprayShop[];
  docks: SprayShop;
  station: Station;
  safehouse: { x: number; z: number };
  payphones: ReadonlyArray<{ x: number; z: number }>;
  /** Each race's start crossing and the heading of its first leg. */
  raceStarts: ReadonlyArray<{ x: number; z: number; heading: number }>;
  ramps: readonly Ramp[];
}

/** The spray booth's walls in its own frame (mouth at -z), thickened so nothing fast slips through, m. */
const BOOTH_WALLS: readonly Rect[] = [
  { minX: -3.15, minZ: -4.5, maxX: -2.7, maxZ: 4.65 },
  { minX: 2.7, minZ: -4.5, maxX: 3.15, maxZ: 4.65 },
  { minX: -3.15, minZ: 4.2, maxX: 3.15, maxZ: 4.65 },
];
const EXPORT_WALLS: readonly Rect[] = [
  { minX: -3.65, minZ: -5, maxX: -3.15, maxZ: 5.15 },
  { minX: 3.15, minZ: -5, maxX: 3.65, maxZ: 5.15 },
  { minX: -3.65, minZ: 4.65, maxX: 3.65, maxZ: 5.15 },
];
/** The gantry spans the road: its pillars stand on the kerb lines either side, m from the middle. */
const GANTRY_HALF_SPAN = ROAD_WIDTH / 2 + 0.6;
/** The model's pillars are 6.25 m from its middle. */
const GANTRY_MODEL_HALF = 6.25;
/** Down the race's first leg from the start crossing, clear of the junction, its signals and lamps, m. */
const GANTRY_ALONG = 21;

export function placeLandmarkProps(input: LandmarkInput): Landmarks {
  const props: LandmarkProp[] = [];
  const solids: Rect[] = [];
  const knockables: Knockable[] = [];
  const avoid: Array<{ x: number; z: number; r: number }> = [];
  const put = (kind: string, x: number, z: number, heading: number, sx = 1, sy = 1, sz = 1, y = 0) =>
    props.push({ kind, x, z, y, heading, sx, sy, sz }) - 1;
  /** A rect in a prop's own frame (x across, z along its heading), turned into the world (headings are quarter turns). */
  const solid = (x: number, z: number, heading: number, r: Rect) => {
    const s = Math.round(Math.sin(heading));
    const c = Math.round(Math.cos(heading));
    // Local (lx, lz) → world (x + lx·c + lz·s, z - lx·s + lz·c).
    const ax = x + r.minX * c + r.minZ * s;
    const az = z - r.minX * s + r.minZ * c;
    const bx = x + r.maxX * c + r.maxZ * s;
    const bz = z - r.maxX * s + r.maxZ * c;
    solids.push({ minX: Math.min(ax, bx), minZ: Math.min(az, bz), maxX: Math.max(ax, bx), maxZ: Math.max(az, bz) });
  };

  for (const shop of input.shops) {
    put('spray_booth', shop.x, shop.z, shop.heading);
    for (const w of BOOTH_WALLS) solid(shop.x, shop.z, shop.heading, w);
  }
  const d = input.docks;
  put('export_bay', d.x, d.z, d.heading);
  for (const w of EXPORT_WALLS) solid(d.x, d.z, d.heading, w);

  // The station's sign and the safehouse's door hang on the wall behind the pavement spot.
  const st = input.station;
  const signWall = wallBehind(input.city, st.x, st.z, st.heading);
  put('police_sign', st.x, signWall.z, st.heading, 1, 1, 1, 0);
  const home = input.safehouse;
  const doorWall = wallBehind(input.city, home.x, home.z, Math.PI);
  put('safehouse_door', home.x, doorWall.z, Math.PI);

  // Payphones a step back from the pavement path, facing the road (people walk past in front).
  for (const p of input.payphones) {
    const { inX, inZ, heading } = inward(p.x, p.z);
    const x = p.x + inX * 1.1;
    const z = p.z + inZ * 1.1;
    put('payphone', x, z, heading);
    solid(x, z, heading, { minX: -0.3, minZ: -0.22, maxX: 0.3, maxZ: 0.2 });
    avoid.push({ x, z, r: 1.6 });
  }

  for (const r of input.raceStarts) {
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    const ax = fz; // across the road (the gantry's own x)
    const az = -fx;
    const gx = r.x + fx * GANTRY_ALONG;
    const gz = r.z + fz * GANTRY_ALONG;
    put('start_gantry', gx, gz, r.heading, GANTRY_HALF_SPAN / GANTRY_MODEL_HALF);
    for (let side = -1; side <= 1; side += 2) {
      const px = gx + ax * GANTRY_HALF_SPAN * side;
      const pz = gz + az * GANTRY_HALF_SPAN * side;
      solid(px, pz, 0, { minX: -0.3, minZ: -0.3, maxX: 0.3, maxZ: 0.3 });
      avoid.push({ x: px, z: pz, r: 2.5 });
      // A jersey barrier on the pavement just past each pillar, along the road.
      const off = ROAD_WIDTH / 2 + SIDEWALK - 0.6;
      const bx = r.x + fx * (GANTRY_ALONG + 4) + ax * off * side;
      const bz = r.z + fz * (GANTRY_ALONG + 4) + az * off * side;
      put('road_barrier_long', bx, bz, r.heading + Math.PI / 2);
      solid(bx, bz, r.heading + Math.PI / 2, { minX: -2, minZ: -0.3, maxX: 2, maxZ: 0.3 });
      avoid.push({ x: bx, z: bz, r: 2.6 });
      // Cones along the kerb before the gantry.
      for (let k = 0; k < 3; k++) {
        const along = GANTRY_ALONG - 3 - k * 2.2;
        const cx = r.x + fx * along + ax * (ROAD_WIDTH / 2 - 0.4) * side;
        const cz = r.z + fz * along + az * (ROAD_WIDTH / 2 - 0.4) * side;
        const i = put('traffic_cone', cx, cz, 0);
        knockables.push({ prop: i, x: cx, z: cz, radius: 0.3 });
      }
    }
  }

  for (const r of input.ramps) put(r.kind, r.x, r.z, r.heading);
  return { props, solids, knockables, avoid };
}

/**
 * The building wall behind a pavement spot facing `heading` (out to the
 * road): the face of the building whose side there is nearest the pavement,
 * or the lot's edge if no building stands flush. Only the z face is needed
 * (the station and the safehouse face north or south).
 */
function wallBehind(city: City, x: number, z: number, heading: number): { z: number } {
  const facingSouth = Math.cos(heading) > 0;
  let best: number | null = null;
  for (const b of city.buildings) {
    if (x < b.minX + 0.5 || x > b.maxX - 0.5) continue;
    const face = facingSouth ? b.maxZ : b.minZ;
    const gap = facingSouth ? z - face : face - z;
    if (gap < 0 || gap > SIDEWALK + 2) continue;
    if (best === null || Math.abs(z - face) < Math.abs(z - best)) best = face;
  }
  // No building there: the edge of the lot behind the pavement.
  return { z: best ?? z + (facingSouth ? -1 : 1) * (SIDEWALK / 2) };
}

/** From a pavement spot: the unit step toward the building side, and the heading that faces the road. */
function inward(x: number, z: number): { inX: number; inZ: number; heading: number } {
  const dx = x - Math.round(x / BLOCK_SIZE) * BLOCK_SIZE;
  const dz = z - Math.round(z / BLOCK_SIZE) * BLOCK_SIZE;
  if (Math.abs(dx) < Math.abs(dz)) {
    const s = Math.sign(dx) || 1;
    return { inX: s, inZ: 0, heading: Math.atan2(-s, 0) };
  }
  const s = Math.sign(dz) || 1;
  return { inX: 0, inZ: s, heading: Math.atan2(0, -s) };
}
