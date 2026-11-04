/**
 * Where the free-roam activities live: the safehouse (the shop) by the spawn
 * corner, the docks' export garage, the payphones that ring with story
 * missions and the frenzy tokens. Fixed points derived from the city layout
 * (pure and deterministic, like world/landmarks.ts), so the markers, the
 * radar and the rules agree. Everything stands on a pavement path or an
 * open lot, away from the spray bays and the police station. The map
 * edits (W3-D) can move the safehouse, payphones and frenzy tokens (not
 * remove them: jobs ring the phones, the shop is the safehouse, and the
 * frenzies count toward 100%); `edits` defaults to the map this page plays.
 */
import { cornerPoint } from '../../systems/crowd';
import { core, type City } from '../../world/city';
import { bayFor, placeSprayShops, type SprayShop } from '../../world/landmarks';
import { len2 } from '../../core/len';
import { landmarkEdit, type MapEdits } from '../../world/mapEdits';
import { ACTIVE_MAP } from '../../world/shippedMap';
import { addedSpots, editSpot } from '../../world/spotEdits';

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

/** `pavement` round core block (bx, bz): hand-placed spots use these, so they stay put in a bigger city. */
export function corePavement(bx: number, bz: number, edge: number, t: number): { x: number; z: number } {
  return pavement(core(bx), core(bz), edge, t);
}

/** The safehouse door: on the pavement 16 m east of the spawn corner, in view as you start (or where the map edits moved it). */
export function placeSafehouse(edits: MapEdits = ACTIVE_MAP): Spot {
  return editSpot({ id: 'safehouse', ...corePavement(8, 8, 0, 16.5 / 45) }, edits, false)!;
}

/** The safehouse door in the map this page plays. */
export const SAFEHOUSE: Spot = placeSafehouse();

/** Payphones (one per quarter of the city), as [core block x, core block z, edge, t]. */
const PHONE_SPOTS: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ['phone-oldtown', 5, 6, 2, 0.32],
  ['phone-arts', 10, 4, 3, 0.62],
  ['phone-suburbs', 4, 10, 0, 0.6],
  ['phone-docks', 10, 12, 2, 0.5],
];

export function placePayphones(edits: MapEdits = ACTIVE_MAP): Spot[] {
  const phones = PHONE_SPOTS.map(([id, bx, bz, edge, t]) => editSpot({ id, ...corePavement(bx, bz, edge, t) }, edits, false)!);
  // Round 3: payphones the map adds (`phone-<n>`), after the city's own.
  for (const s of addedSpots(edits, 'phone')) phones.push({ id: s.id, x: s.x!, z: s.z! });
  return phones;
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

export function placeFrenzyTokens(edits: MapEdits = ACTIVE_MAP): Spot[] {
  const tokens = FRENZY_SPOTS.map(([id, bx, bz, edge, t]) => editSpot({ id, ...corePavement(bx, bz, edge, t) }, edits, false)!);
  // Round 3: the map's own frenzies (`fz-<n>`, frenzies.ts frenzyList), after the shipped eight.
  for (const s of addedSpots(edits, 'frenzy')) tokens.push({ id: s.id, x: s.x!, z: s.z! });
  return tokens;
}

/** The docks: an open lot in the industrial quarter (south-east), not a spray bay's (core blocks). */
const DOCKS_TARGET = [13, 12] as const;

/**
 * The export garage: a drive-in bay at the road edge of an open lot near the
 * docks (the same shape as a spray bay, see landmarks.ts).
 */
export function placeDocks(city: City): SprayShop {
  const taken = new Set(placeSprayShops(city).map((s) => s.id));
  // Moved by the map edits (round 3): that block's bay, if it's an open lot with room and no spray bay.
  const moved = docksAt(city, taken);
  if (moved) return moved;
  const tx = core(DOCKS_TARGET[0]);
  const tz = core(DOCKS_TARGET[1]);
  const blocks = city.blocks
    .filter((b) => b.kind !== 'buildings')
    .sort((a, b) => len2(a.bx - tx, a.bz - tz) - len2(b.bx - tx, b.bz - tz));
  for (const b of blocks) {
    const bay = bayFor(b.bx, b.bz, city);
    if (bay && !taken.has(bay.id)) return { ...bay, id: 'docks' };
  }
  // No open lot anywhere (not with the shipped seed): a pavement spot instead.
  const p = corePavement(13, 12, 0, 0.5);
  return { id: 'docks', x: p.x, z: p.z, heading: 0, halfWidth: 3.6, halfLength: 4.6 };
}

/** The docks' bay on the block the map edits move it to, or null (no edit, or it doesn't fit there: the checks say why). */
function docksAt(city: City, taken: ReadonlySet<string>): SprayShop | null {
  const e = landmarkEdit(city.edits, 'docks');
  if (!e) return null;
  const b = city.blocks.find((q) => q.bx === core(e.at[0]) && q.bz === core(e.at[1]));
  if (!b || b.kind === 'buildings') return null;
  const bay = bayFor(b.bx, b.bz, city);
  return bay && !taken.has(bay.id) ? { ...bay, id: 'docks' } : null;
}
