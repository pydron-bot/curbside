/**
 * The owner's map edits (W3-D): an overrides layer on the generated city.
 * The city stays generated from its seed; the committed map file
 * (src/world/maps/city.json, bundled so the game boots with it and the
 * tests read the same file) holds what the editor changed, and
 * generateCity applies it. Pure data, no three.js.
 *
 * Version 1 holds block edits: a block's kind (buildings, park, plaza, car
 * park), its district (a repaint) and a variant (a reroll of its buildings
 * or trees). Blocks are written in core blocks, like every hand-placed spot,
 * so an edit stays put in a bigger city (the ring's blocks are negative or
 * ≥ 16). Roads, props and spots come in later versions; an unknown version
 * loads as no edits rather than as a wrong city.
 *
 * The file is canonical (serializeMapEdits: blocks sorted, one per line,
 * keys in a fixed order) so a commit's diff reads as the edits it made.
 */
import { DISTRICTS, type District } from './districts';

export const MAP_EDITS_VERSION = 1;

/** What a block can be made: 'carpark' is a plaza painted with bays, 'plaza' one without. */
export type BlockEditKind = 'buildings' | 'park' | 'plaza' | 'carpark';
export const BLOCK_EDIT_KINDS: readonly BlockEditKind[] = ['buildings', 'park', 'plaza', 'carpark'];

export interface BlockEdit {
  /** Core block (bx, bz): block (0, 0) is the core's north-west corner. */
  at: readonly [number, number];
  kind?: BlockEditKind;
  district?: District;
  /** Rebuild the block's buildings or trees from this stream (any integer; a new number is a new layout). */
  variant?: number;
}

export interface MapEdits {
  version: number;
  /** The city seed the edits were made against. */
  seed: number;
  blocks: readonly BlockEdit[];
}

export const NO_EDITS: MapEdits = Object.freeze({ version: MAP_EDITS_VERSION, seed: 1337, blocks: Object.freeze([]) });

/** Core blocks reach this far either side of the core (a 32 × 32 city's ring is 8; room to grow). */
const BLOCK_REACH = 64;

/** A number for core block (bx, bz), for maps keyed by block. */
export function blockEditKey(bx: number, bz: number): number {
  return (bx + BLOCK_REACH) * (4 * BLOCK_REACH) + (bz + BLOCK_REACH);
}

/** The seed of an edited block's own stream: the city's seed, the block and its variant mixed (so neighbours differ). */
export function blockSeed(seed: number, bx: number, bz: number, variant: number): number {
  let h = Math.imul(seed ^ 0x51ed27, 0x9e3779b1);
  h = Math.imul(h ^ (bx + BLOCK_REACH), 0x85ebca6b);
  h = Math.imul(h ^ (bz + BLOCK_REACH), 0xc2b2ae35);
  h = Math.imul(h ^ variant, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

export interface ParsedMapEdits {
  edits: MapEdits;
  /** What was wrong with the file and dropped (empty for a clean file). */
  problems: string[];
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Read a map file (the parsed JSON). Never throws: anything malformed is
 * dropped and reported, so a bad local edit can't stop the game booting.
 */
export function parseMapEdits(raw: unknown): ParsedMapEdits {
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { edits: NO_EDITS, problems: ['not a map file (expected an object)'] };
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== MAP_EDITS_VERSION) {
    return { edits: NO_EDITS, problems: [`unknown map version ${JSON.stringify(o.version)} (this build reads ${MAP_EDITS_VERSION})`] };
  }
  for (const k of Object.keys(o)) if (k !== 'version' && k !== 'seed' && k !== 'blocks') problems.push(`unknown section "${k}" ignored`);
  let seed = NO_EDITS.seed;
  if (o.seed !== undefined) {
    if (isInt(o.seed)) seed = o.seed;
    else problems.push('seed is not an integer; using 1337');
  }

  const byKey = new Map<number, BlockEdit>();
  const list = o.blocks ?? [];
  if (!Array.isArray(list)) problems.push('blocks is not a list');
  else
    list.forEach((b: unknown, i) => {
      const where = `blocks[${i}]`;
      if (typeof b !== 'object' || b === null) return void problems.push(`${where}: not an object`);
      const e = b as Record<string, unknown>;
      const at = e.at;
      if (!Array.isArray(at) || at.length !== 2 || !isInt(at[0]) || !isInt(at[1])) return void problems.push(`${where}: "at" must be [bx, bz] integers`);
      if (Math.abs(at[0]) >= BLOCK_REACH || Math.abs(at[1]) >= BLOCK_REACH) return void problems.push(`${where}: block ${at[0]},${at[1]} is off any city`);
      const edit: { at: [number, number]; kind?: BlockEditKind; district?: District; variant?: number } = { at: [at[0], at[1]] };
      for (const k of Object.keys(e)) if (!['at', 'kind', 'district', 'variant'].includes(k)) problems.push(`${where}: unknown field "${k}" ignored`);
      if (e.kind !== undefined) {
        if (BLOCK_EDIT_KINDS.includes(e.kind as BlockEditKind)) edit.kind = e.kind as BlockEditKind;
        else problems.push(`${where}: unknown kind ${JSON.stringify(e.kind)} ignored`);
      }
      if (e.district !== undefined) {
        if (DISTRICTS.includes(e.district as District)) edit.district = e.district as District;
        else problems.push(`${where}: unknown district ${JSON.stringify(e.district)} ignored`);
      }
      if (e.variant !== undefined) {
        if (isInt(e.variant)) edit.variant = e.variant;
        else problems.push(`${where}: variant must be an integer`);
      }
      if (edit.kind === undefined && edit.district === undefined && edit.variant === undefined) return void problems.push(`${where}: changes nothing`);
      const key = blockEditKey(edit.at[0], edit.at[1]);
      if (byKey.has(key)) problems.push(`${where}: block ${edit.at[0]},${edit.at[1]} edited twice; the later one wins`);
      byKey.set(key, edit);
    });
  return { edits: { version: MAP_EDITS_VERSION, seed, blocks: sortBlocks([...byKey.values()]) }, problems };
}

/** North to south, then west to east (the order the file lists them). */
function sortBlocks(blocks: BlockEdit[]): BlockEdit[] {
  return blocks.sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]);
}

/** One block edit as a line of JSON, keys in a fixed order. */
function blockLine(e: BlockEdit): string {
  const o: Record<string, unknown> = { at: [e.at[0], e.at[1]] };
  if (e.kind !== undefined) o.kind = e.kind;
  if (e.district !== undefined) o.district = e.district;
  if (e.variant !== undefined) o.variant = e.variant;
  return JSON.stringify(o).replace(/^\{"at":\[(-?\d+),(-?\d+)\]/, '{ "at": [$1, $2]').replace(/,"(\w+)":/g, ', "$1": ').replace(/\}$/, ' }');
}

/** The map file's text: canonical, so the same edits always write the same bytes. */
export function serializeMapEdits(edits: MapEdits): string {
  const blocks = sortBlocks([...edits.blocks]);
  const body = blocks.length === 0 ? '[]' : `[\n${blocks.map((b) => `    ${blockLine(b)}`).join(',\n')}\n  ]`;
  return `{\n  "version": ${MAP_EDITS_VERSION},\n  "seed": ${edits.seed},\n  "blocks": ${body}\n}\n`;
}

export interface BlockEditChange {
  at: readonly [number, number];
  /** In the base (the committed file); undefined if the block was unedited there. */
  before?: BlockEdit;
  /** In the local edits; undefined if the block was reverted. */
  after?: BlockEdit;
}

const sameEdit = (a: BlockEdit, b: BlockEdit) => a.kind === b.kind && a.district === b.district && a.variant === b.variant;

/** What local edits change against the committed file, block by block (what the editor's diff lists and can revert). */
export function diffMapEdits(base: MapEdits, local: MapEdits): BlockEditChange[] {
  const before = new Map(base.blocks.map((b) => [blockEditKey(b.at[0], b.at[1]), b]));
  const after = new Map(local.blocks.map((b) => [blockEditKey(b.at[0], b.at[1]), b]));
  const out: BlockEditChange[] = [];
  for (const [k, a] of after) {
    const b = before.get(k);
    if (!b || !sameEdit(a, b)) out.push({ at: a.at, before: b, after: a });
  }
  for (const [k, b] of before) if (!after.has(k)) out.push({ at: b.at, before: b });
  return out.sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]);
}

/** Set (or with `edit` undefined, clear) one block's edit, returning new edits (the editor's undo keeps the old ones). */
export function withBlockEdit(edits: MapEdits, at: readonly [number, number], edit?: Omit<BlockEdit, 'at'>): MapEdits {
  const key = blockEditKey(at[0], at[1]);
  const blocks = edits.blocks.filter((b) => blockEditKey(b.at[0], b.at[1]) !== key);
  if (edit && (edit.kind !== undefined || edit.district !== undefined || edit.variant !== undefined)) blocks.push({ ...edit, at: [at[0], at[1]] });
  return { ...edits, blocks: sortBlocks(blocks) };
}
