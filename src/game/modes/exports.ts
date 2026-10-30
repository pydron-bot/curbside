/**
 * HOT-CAR EXPORTS: a buyer at the docks wants eight particular cars ("a
 * yellow sports", "a taxi", "a police car"). Deliver a match to the garage
 * with at least half its health and it pays its base price scaled by the
 * health left; tick off the whole list for a bonus and a fresh list. Which
 * car you steal, and keeping it in one piece, finally matter. Pure logic,
 * unit-tested.
 */
import type { ColorRepresentation } from 'three';
import type { VehicleArchetype } from '../../entities/vehicle';
import { mulberry32 } from '../../world/random';

export interface ExportOrder {
  /** Unique within its list: archetype plus colour ('sports-yellow', 'van-any'). */
  id: string;
  archetype: VehicleArchetype;
  /** A colour name from COLOURS, or null for any colour. */
  colour: string | null;
  label: string;
}

export const ORDERS_PER_LIST = 8;
/** Below this share of its health a car isn't worth taking. */
export const EXPORT_MIN_HEALTH = 0.5;
export const LIST_BONUS = 5000;
export const EXPORT_BASE: Readonly<Record<VehicleArchetype, number>> = {
  compact: 300,
  sedan: 400,
  van: 500,
  pickup: 500,
  taxi: 600,
  sports: 900,
  police: 1500,
};
/** A colour-specific order pays this much more. */
const COLOUR_PREMIUM = 1.25;

/** Paint names, by the traffic and respray palettes' colours (sRGB). */
export const COLOURS: ReadonlyArray<readonly [string, number, number, number]> = [
  ['RED', 200, 52, 43],
  ['BLUE', 47, 111, 192],
  ['WHITE', 222, 220, 212],
  ['YELLOW', 232, 185, 35],
  ['GREEN', 61, 122, 74],
  ['BLACK', 31, 35, 40],
  ['SILVER', 138, 143, 150],
  ['PURPLE', 122, 47, 90],
  ['ORANGE', 200, 106, 43],
  ['TEAL', 47, 181, 168],
  ['PINK', 217, 79, 138],
];

const NAMES: Readonly<Record<VehicleArchetype, string>> = {
  compact: 'COMPACT',
  sedan: 'SEDAN',
  van: 'VAN',
  pickup: 'PICKUP',
  taxi: 'TAXI',
  sports: 'SPORTS',
  police: 'POLICE CAR',
};

/** The nearest named colour to a paint ('#e8b923' → 'YELLOW'). */
export function colourName(paint: ColorRepresentation): string {
  let rgb: [number, number, number];
  if (typeof paint === 'number') rgb = [(paint >> 16) & 255, (paint >> 8) & 255, paint & 255];
  else if (typeof paint === 'string' && /^#[0-9a-f]{6}$/i.test(paint)) {
    const n = parseInt(paint.slice(1), 16);
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else return 'WHITE';
  let best = COLOURS[0][0];
  let bestD = Infinity;
  for (const [name, r, g, b] of COLOURS) {
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/** What the buyer might ask for: archetype and colour (null = any), weighted. */
const POOL: ReadonlyArray<readonly [VehicleArchetype, string | null, number]> = [
  ['sedan', null, 3],
  ['sedan', 'BLACK', 1],
  ['sedan', 'RED', 1],
  ['compact', null, 2],
  ['compact', 'BLUE', 1],
  ['compact', 'RED', 1],
  ['van', null, 2],
  ['van', 'WHITE', 1],
  ['pickup', null, 2],
  ['taxi', null, 2],
  ['sports', null, 1],
  ['sports', 'YELLOW', 1],
  ['police', null, 1],
];

function order(archetype: VehicleArchetype, colour: string | null): ExportOrder {
  return {
    id: `${archetype}-${colour ? colour.toLowerCase() : 'any'}`,
    archetype,
    colour,
    label: colour ? `${colour} ${NAMES[archetype]}` : archetype === 'police' || archetype === 'taxi' ? `A ${NAMES[archetype]}` : `ANY ${NAMES[archetype]}`,
  };
}

/**
 * The buyer's list number `n` (0 is the first ever): eight different
 * orders, always including a taxi, a sports car and a police car on the
 * first list so it reads as a shopping list with a showpiece.
 */
export function exportList(n: number): ExportOrder[] {
  const out: ExportOrder[] = [];
  const has = (o: ExportOrder) => out.some((x) => x.id === o.id || (x.archetype === o.archetype && (x.colour === null || o.colour === null)));
  if (n === 0) out.push(order('sports', 'YELLOW'), order('taxi', null), order('police', null));
  const rand = mulberry32(0x5eed + n * 7919);
  const total = POOL.reduce((s, p) => s + p[2], 0);
  for (let tries = 0; out.length < ORDERS_PER_LIST && tries < 500; tries++) {
    let r = rand() * total;
    let pick = POOL[0];
    for (const p of POOL) if ((r -= p[2]) < 0) {
      pick = p;
      break;
    }
    const o = order(pick[0], pick[1]);
    if (!has(o)) out.push(o);
  }
  // A pool too small for a full list of distinct cars can't happen with the
  // data above, but keep the list valid if it's ever trimmed.
  for (const [a, c] of POOL) if (out.length < ORDERS_PER_LIST && !out.some((x) => x.id === order(a, c).id)) out.push(order(a, c));
  return out;
}

export function matchesOrder(o: ExportOrder, archetype: VehicleArchetype, paint: ColorRepresentation, police = false): boolean {
  const kind: VehicleArchetype = police ? 'police' : archetype;
  if (kind !== o.archetype) return false;
  return o.colour === null || colourName(paint) === o.colour;
}

/** The first open order (not in `done`) the car fills, if any. */
export function openOrderFor(
  list: readonly ExportOrder[],
  done: readonly string[],
  archetype: VehicleArchetype,
  paint: ColorRepresentation,
  police = false,
): ExportOrder | null {
  // Colour-specific orders first: a yellow sports fills "YELLOW SPORTS" before "ANY SPORTS".
  let any: ExportOrder | null = null;
  for (const o of list) {
    if (done.includes(o.id) || !matchesOrder(o, archetype, paint, police)) continue;
    if (o.colour) return o;
    any ??= o;
  }
  return any;
}

/** What a delivery pays: the base, scaled by health (0..1); nothing under the minimum. */
export function exportPayout(o: ExportOrder, health: number): number {
  if (health < EXPORT_MIN_HEALTH) return 0;
  const base = EXPORT_BASE[o.archetype] * (o.colour ? COLOUR_PREMIUM : 1);
  return Math.round((base * Math.min(1, health)) / 10) * 10;
}
