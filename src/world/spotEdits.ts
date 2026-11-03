/**
 * Applying the map edits' spot section (W3-D) to the game's hand-placed
 * spots: the placement functions (game/modes/places.ts, game/gangs.ts,
 * world/ramps.ts) run their spots through here, so markers, the radar, the
 * rules and the dressing's keep-clear lists all see the edited places.
 * Which spots may be moved or removed is game/mapAnchors.ts spotRules. Pure.
 */
import type { MapEdits, SpotEdit } from './mapEdits';

const byEdits = new WeakMap<MapEdits, ReadonlyMap<string, SpotEdit>>();

/** The edit for spot `id`, if the map has one. */
export function spotEdit(edits: MapEdits, id: string): SpotEdit | undefined {
  if (edits.spots.length === 0) return undefined;
  let m = byEdits.get(edits);
  if (!m) byEdits.set(edits, (m = new Map(edits.spots.map((s) => [s.id, s]))));
  return m.get(id);
}

/**
 * Spot `s` as the edits leave it: moved to the edit's (x, z) (a new object;
 * unedited, the same one), or null if removed and `removable`.
 */
export function editSpot<T extends { id: string; x: number; z: number }>(s: T, edits: MapEdits, removable: boolean): T | null {
  const e = spotEdit(edits, s.id);
  if (!e) return s;
  if (e.removed) return removable ? null : s;
  return e.x !== undefined && e.z !== undefined ? { ...s, x: e.x, z: e.z } : s;
}
