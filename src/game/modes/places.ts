/**
 * Where the free-roam activities live: the safehouse (the shop) by the spawn
 * corner, the docks' export garage, the payphones that ring with story
 * missions and the frenzy tokens. Fixed points derived from the city layout
 * (pure and deterministic, like world/landmarks.ts), so the markers, the
 * radar and the rules agree. Everything stands on a pavement path or an
 * open lot, away from the spray bays and the police station.
 */
import { cornerPoint } from '../../systems/crowd';
import { BLOCKS_PER_SIDE, type City } from '../../world/city';
import { bayFor, placeSprayShops, type SprayShop } from '../../world/landmarks';

export interface Spot {
  id: string;
  x: number;
  z: number;
}

/**
 * A point on the pavement path round block (bx, bz): along edge `edge`
 * (0 north, 1 east, 2 south, 3 west, clockwise from the NW corner), `t` of
 * the way from its start corner.
 */
export function pavement(bx: number, bz: number, edge: number, t: number): { x: number; z: number } {
  const a = cornerPoint(bx, bz, edge);
  const b = cornerPoint(bx, bz, edge + 1);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** The safehouse door: on the pavement 16 m east of the spawn corner, in view as you start. */
export const SAFEHOUSE: Spot = { id: 'safehouse', ...pavement(8, 8, 0, 16.5 / 45) };

/** Payphones (one per quarter of the city), as [block x, block z, edge, t]. */
const PHONE_SPOTS: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ['phone-oldtown', 5, 6, 2, 0.32],
  ['phone-arts', 10, 4, 3, 0.62],
  ['phone-suburbs', 4, 10, 0, 0.6],
  ['phone-docks', 10, 12, 2, 0.5],
];

export function placePayphones(): Spot[] {
  return PHONE_SPOTS.map(([id, bx, bz, edge, t]) => ({ id, ...pavement(bx, bz, edge, t) }));
}

/** Frenzy tokens, spread round the city (ids match FRENZIES). */
const FRENZY_SPOTS: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ['fz-brawl', 7, 6, 1, 0.5],
  ['fz-nearmiss', 9, 2, 2, 0.5],
  ['fz-carjack', 3, 4, 1, 0.45],
  ['fz-drift', 13, 5, 3, 0.5],
  ['fz-wreck', 2, 12, 0, 0.5],
  ['fz-hitrun', 7, 13, 2, 0.4],
  ['fz-smash', 13, 9, 3, 0.55],
  ['fz-combo', 10, 8, 0, 0.5],
];

export function placeFrenzyTokens(): Spot[] {
  return FRENZY_SPOTS.map(([id, bx, bz, edge, t]) => ({ id, ...pavement(bx, bz, edge, t) }));
}

/** The docks: an open lot in the industrial quarter (south-east), not a spray bay's. */
const DOCKS_TARGET = [13, 12] as const;

/**
 * The export garage: a drive-in bay at the road edge of an open lot near the
 * docks (the same shape as a spray bay, see landmarks.ts).
 */
export function placeDocks(city: City): SprayShop {
  const taken = new Set(placeSprayShops(city).map((s) => s.id));
  const blocks = city.blocks
    .filter((b) => b.kind !== 'buildings')
    .sort((a, b) => Math.hypot(a.bx - DOCKS_TARGET[0], a.bz - DOCKS_TARGET[1]) - Math.hypot(b.bx - DOCKS_TARGET[0], b.bz - DOCKS_TARGET[1]));
  for (const b of blocks) {
    const bay = bayFor(b.bx, b.bz, city);
    if (bay && !taken.has(bay.id)) return { ...bay, id: 'docks' };
  }
  // No open lot anywhere (not with the shipped seed): a pavement spot instead.
  const p = pavement(BLOCKS_PER_SIDE - 3, BLOCKS_PER_SIDE - 4, 0, 0.5);
  return { id: 'docks', x: p.x, z: p.z, heading: 0, halfWidth: 3.6, halfLength: 4.6 };
}
