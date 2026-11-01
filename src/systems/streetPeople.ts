/**
 * The rules behind the city's people scenes (game/scenes/: buses, the ice
 * cream van, food carts, buskers, scuffles, muggings): where each person
 * stands at a shelter or a cart, how busy a cart is by the hour, walkers
 * stepping round someone standing on the walking line, who shoves whom,
 * how a scuffle goes, and the way a mugger runs. Pure, no three.js, tested
 * in tests/streetPeople.test.ts.
 */
import { len2 } from '../core/len';

/** A spot to stand and the way to face (vehicle convention: toward (sin, cos)). */
export interface Stand {
  x: number;
  z: number;
  heading: number;
}

// --- Bus shelters --------------------------------------------------------------

/** Waiting riders stand this far apart along the shelter, m; a second row this far back. */
const WAIT_PITCH = 1.1;
const WAIT_ROW = 0.7;
/** Riders per row. */
const WAIT_PER_ROW = 3;

/**
 * Where the `i`th rider waits at a shelter: along its front (waitX, waitZ),
 * middle first then either side, a second row a little back (inside the
 * open shelter), all facing the road (`heading`: the shelter's facing).
 */
export function shelterSpot(waitX: number, waitZ: number, heading: number, i: number, out: Stand): Stand {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const row = Math.floor(i / WAIT_PER_ROW);
  const k = i % WAIT_PER_ROW;
  // 0 middle, 1 one side, 2 the other; the back row offset by half a place.
  const along = (k === 0 ? 0 : k === 1 ? 1 : -1) * WAIT_PITCH + (row % 2) * WAIT_PITCH * 0.5;
  out.x = waitX + fz * along - fx * row * WAIT_ROW;
  out.z = waitZ - fx * along - fz * row * WAIT_ROW;
  out.heading = heading;
  return out;
}

/**
 * A bus's kerbside door (the front one, `front`, or the middle one) for a
 * bus at (x, z) heading `heading`, `reach` m from middle to nose, `half` m
 * wide each side: a pace out from its right side (traffic keeps right, so
 * the kerb's on the right).
 */
export function busDoor(x: number, z: number, heading: number, reach: number, half: number, front: boolean, out: { x: number; z: number }): { x: number; z: number } {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const along = front ? reach - 1.6 : 0;
  // Right of a vehicle heading h is (-cos h, sin h).
  out.x = x + fx * along - fz * (half + 0.6);
  out.z = z + fz * along + fx * (half + 0.6);
  return out;
}

// --- Food carts ----------------------------------------------------------------

/** Queue places are this far apart, m. */
const CART_PITCH = 0.9;
/** A kerb cart's queue angles off the walking line toward the shopfronts, this far per place (at most CART_ANGLE_MAX), m. */
const CART_ANGLE = 0.55;
const CART_ANGLE_MAX = 1.1;

/** The parts of a world/streetStops.ts VendorSpot the queue needs. */
export interface CartLine {
  heading: number;
  serveX: number;
  serveZ: number;
  queueX: number;
  queueZ: number;
}

/**
 * Where the `i`th customer stands at a cart: the first at its serving
 * point facing it, the rest along the queue direction, each facing the one
 * ahead. `angled` (a kerb cart, whose serving point is on the walking
 * line): the queue steps off toward the shopfronts so walkers pass the
 * line instead of walking into it.
 */
export function cartSpot(c: CartLine, i: number, angled: boolean, out: Stand): Stand {
  // The serving side faces the customers: toward them is (sin h, cos h).
  const nx = Math.sin(c.heading);
  const nz = Math.cos(c.heading);
  const off = angled ? Math.min(CART_ANGLE_MAX, i * CART_ANGLE) : 0;
  out.x = c.serveX + c.queueX * i * CART_PITCH + nx * off;
  out.z = c.serveZ + c.queueZ * i * CART_PITCH + nz * off;
  if (i === 0) out.heading = Math.atan2(-nx, -nz);
  else {
    // Facing the place ahead.
    const offAhead = angled ? Math.min(CART_ANGLE_MAX, (i - 1) * CART_ANGLE) : 0;
    const ax = c.serveX + c.queueX * (i - 1) * CART_PITCH + nx * offAhead;
    const az = c.serveZ + c.queueZ * (i - 1) * CART_PITCH + nz * offAhead;
    out.heading = Math.atan2(ax - out.x, az - out.z);
  }
  return out;
}

/**
 * How busy the carts are at `hour` (0–24), 0..1: a lunch peak (12–14), an
 * evening one (17–20), quiet mid-morning and afternoon, all but dead in the
 * small hours.
 */
export function cartBusyness(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const peak = (centre: number, width: number) => Math.exp(-(((h - centre) / width) ** 2));
  const base = h >= 7 && h < 23 ? 0.25 : 0.05;
  return Math.min(1, base + 0.75 * Math.max(peak(13, 1.2), peak(18.5, 1.4)) + 0.15 * peak(8, 0.8));
}

// --- Walkers stepping round people standing -------------------------------------

/**
 * A walker at (wx, wz) heading along (vx, vz) and someone standing at (ox,
 * oz): if they're closer than `clear`, the walker steps aside (across their
 * way, away from the other), at most `maxStep` m this step. Writes the
 * walker's new place into `out`; false (out untouched) when they're clear.
 */
export function sidestep(wx: number, wz: number, vx: number, vz: number, ox: number, oz: number, clear: number, maxStep: number, out: { x: number; z: number }): boolean {
  const dx = wx - ox;
  const dz = wz - oz;
  if (Math.abs(dx) > clear || Math.abs(dz) > clear) return false;
  const d = len2(dx, dz);
  if (d >= clear) return false;
  const sp = len2(vx, vz);
  // Across their way (or straight out, standing still), on the side they already are.
  let px: number;
  let pz: number;
  if (sp > 0.2) {
    px = -vz / sp;
    pz = vx / sp;
    if (px * dx + pz * dz < 0) {
      px = -px;
      pz = -pz;
    }
  } else if (d > 1e-4) {
    px = dx / d;
    pz = dz / d;
  } else {
    px = 1;
    pz = 0;
  }
  const step = Math.min(maxStep, clear - d);
  out.x = wx + px * step;
  out.z = wz + pz * step;
  return true;
}

// --- Scuffles ------------------------------------------------------------------

/** Someone running this fast barges whoever they brush past, m/s. */
export const SHOVE_SPEED = 3.6;
/** Brushing past: this close, m. */
export const SHOVE_REACH = 0.7;

/** Does someone at (ax, az) moving (avx, avz) barge into someone at (bx, bz)? Running, close, and heading their way. */
export function barges(ax: number, az: number, avx: number, avz: number, bx: number, bz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.abs(dx) > SHOVE_REACH || Math.abs(dz) > SHOVE_REACH) return false;
  const sp = len2(avx, avz);
  if (sp < SHOVE_SPEED) return false;
  const d = len2(dx, dz);
  return d < SHOVE_REACH && (d < 0.2 || (avx * dx + avz * dz) / (sp * d) > 0.2);
}

/** How a scuffle goes: the shove-off, then either fists or one backing down; perhaps a knockout. */
export interface FightPlan {
  /** The one shoved backs down (walks off) after the shove-off instead of fighting. */
  backsDown: boolean;
  /** The loser is knocked out cold (and the ambulance comes) rather than walking off. */
  knockout: boolean;
  /** Seconds of fists. */
  seconds: number;
}

/** Roll a scuffle: `temper` of the one shoved ('calm' back down more often). */
export function planFight(rand: () => number, calm: boolean, out: FightPlan): FightPlan {
  out.backsDown = rand() < (calm ? 0.35 : 0.1);
  out.knockout = rand() < 0.3;
  out.seconds = 6 + rand() * 4;
  return out;
}

// --- Muggings ------------------------------------------------------------------

/**
 * A block's sidewalk corner in the order crowd.ts walks them (0 NW, 1 NE,
 * 2 SE, 3 SW): the next one a runner heads for from `corner` (going round
 * `cw` or not), or across to the neighbouring block now and then. Writes
 * the new block and corner into `out`.
 */
export function nextCorner(bx: number, bz: number, corner: number, cw: boolean, cross: boolean, blocks: number, out: { bx: number; bz: number; corner: number }): { bx: number; bz: number; corner: number } {
  out.bx = bx;
  out.bz = bz;
  if (cross) {
    // Across the road to the mirrored corner of the block next door (east/west for 1/2, else north/south).
    const east = corner === 1 || corner === 2;
    const nbx = bx + (east ? 1 : -1);
    if (nbx >= 0 && nbx < blocks) {
      out.bx = nbx;
      out.corner = [1, 0, 3, 2][corner & 3];
      return out;
    }
  }
  out.corner = (corner + (cw ? 1 : 3)) & 3;
  return out;
}

