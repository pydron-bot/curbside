/**
 * The map edits that ship in the game (W3-D): src/world/maps/city.json,
 * bundled (it's small, the boot is synchronous, and an offline PWA has it
 * with the code). Anything malformed in it is dropped; the tests fail on
 * any problem, so a broken file can't reach main.
 */
import raw from './maps/city.json';
import { parseMapEdits } from './mapEdits';

const parsed = parseMapEdits(raw);
export const SHIPPED_MAP = parsed.edits;
/** What parseMapEdits dropped from the committed file (tests require none). */
export const SHIPPED_MAP_PROBLEMS: readonly string[] = parsed.problems;
