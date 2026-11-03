/**
 * Applying the map edits' spot section (W3-D) to the game's hand-placed
 * spots: the placement functions (game/modes/places.ts, game/gangs.ts,
 * world/ramps.ts) run their spots through here, so markers, the radar, the
 * rules and the dressing's keep-clear lists all see the edited places.
 * Which spots may be moved or removed is game/mapAnchors.ts spotRules; the
 * spots the edits add (`add`) are listed by addedSpots. Pure.
 */
import type { AddedSpotKind, MapEdits, SpotEdit } from './mapEdits';

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
  // An added spot reusing this id is a map problem (mapAnchors' checks), not an edit of this one.
  if (!e || e.add) return s;
  if (e.removed) return removable ? null : s;
  return e.x !== undefined && e.z !== undefined ? { ...s, x: e.x, z: e.z } : s;
}

const addedBy = new WeakMap<MapEdits, ReadonlyMap<AddedSpotKind, readonly SpotEdit[]>>();

/** The spots of `kind` the edits add (in the file's order: by id). */
export function addedSpots(edits: MapEdits, kind: AddedSpotKind): readonly SpotEdit[] {
  if (edits.spots.length === 0) return [];
  let m = addedBy.get(edits);
  if (!m) {
    const by = new Map<AddedSpotKind, SpotEdit[]>();
    for (const s of edits.spots) if (s.add && s.x !== undefined && s.z !== undefined) by.set(s.add, [...(by.get(s.add) ?? []), s]);
    addedBy.set(edits, (m = by));
  }
  return m.get(kind) ?? [];
}

/** The numeric part of an id `<prefix>-<n>`, or null. */
export function idNumber(id: string, prefix: string): number | null {
  if (!id.startsWith(`${prefix}-`)) return null;
  const rest = id.slice(prefix.length + 1);
  return /^\d+$/.test(rest) ? Number(rest) : null;
}
