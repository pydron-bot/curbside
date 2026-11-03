/**
 * The map edits the game boots with (W3-D).
 *
 * SHIPPED_MAP is src/world/maps/city.json, bundled (it's small, the boot is
 * synchronous, and an offline PWA has it with the code). Anything malformed
 * in it is dropped; the tests fail on any problem, so a broken file can't
 * reach main.
 *
 * ACTIVE_MAP is what this page plays: the shipped map, unless the page was
 * opened with `?map=local` (the map editor's VIEW IN 3D), when it's the
 * editor's local edits from localStorage (LOCAL_MAP_KEY). Players never see
 * local edits.
 */
import raw from './maps/city.json';
import { parseMapEdits, type MapEdits } from './mapEdits';

const parsed = parseMapEdits(raw);
export const SHIPPED_MAP = parsed.edits;
/** What parseMapEdits dropped from the committed file (tests require none). */
export const SHIPPED_MAP_PROBLEMS: readonly string[] = parsed.problems;

/** Where the map editor keeps its local edits (the file's JSON text). */
export const LOCAL_MAP_KEY = 'curbside.map.local';

/** The editor's local edits, or null if there are none (or storage is unavailable). */
export function loadLocalMap(): MapEdits | null {
  try {
    const text = globalThis.localStorage?.getItem(LOCAL_MAP_KEY);
    return text ? parseMapEdits(JSON.parse(text)).edits : null;
  } catch {
    return null;
  }
}

/** Is this page previewing the editor's local edits (`?map=local`)? */
export function previewingLocalMap(search = globalThis.location?.search ?? ''): boolean {
  try {
    return new URLSearchParams(search).get('map') === 'local';
  } catch {
    return false;
  }
}

export const ACTIVE_MAP: MapEdits = (previewingLocalMap() && loadLocalMap()) || SHIPPED_MAP;
