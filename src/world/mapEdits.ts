/**
 * The owner's map edits (W3-D): an overrides layer on the generated city.
 * The city stays generated from its seed; the committed map file
 * (src/world/maps/city.json, bundled so the game boots with it and the
 * tests read the same file) holds what the editor changed, and the world's
 * builders apply it. Pure data, no three.js.
 *
 * Version 2 has four sections, each written so it stays put in a bigger
 * city (W3-A):
 * - blocks: a block's kind (buildings, park, plaza, car park, empty lot),
 *   district (a repaint), building style (another district's look for its
 *   buildings, the district staying), variant (a reroll of its buildings or
 *   trees) and building height (a scale), in core blocks;
 * - roads: a road between two neighbouring crossings (centred nodes, as
 *   races use) closed to traffic, or one-way from `a` to `b`;
 * - spots: a hand-placed spot (an anchor id from game/mapAnchors.ts: the
 *   safehouse, payphones, frenzy tokens, hangouts, ramps, hidden packages)
 *   moved or removed, or a new ramp, kicker, hangout or package added
 *   (`add`, with a new id: `ramp-<n>`, `<gang>-<n>`, `pkg-<n>`);
 * - props: street furniture added, or a generated one removed, by kind and
 *   place (world metres; the dressing is placed block by block, so a prop's
 *   place is stable).
 * A version 1 file (blocks only) still loads; an unknown version loads as
 * no edits rather than as a wrong city.
 *
 * The file is canonical (serializeMapEdits: each section sorted, one entry
 * per line, keys in a fixed order, positions to 0.1 m) so a commit's diff
 * reads as the edits it made.
 */
import { DISTRICTS, type District } from './districts';
import { FRENZY_GIFTS, FRENZY_GOALS, clampSeconds, clampTarget, frenzySpecProblems, type FrenzySpec } from '../game/modes/frenzyLimits';
import type { PickupKind } from './pickups';

export const MAP_EDITS_VERSION = 2;

/** What a block can be made: 'carpark' is a plaza painted with bays, 'plaza' one without. */
export type BlockEditKind = 'buildings' | 'park' | 'plaza' | 'carpark' | 'lot';
export const BLOCK_EDIT_KINDS: readonly BlockEditKind[] = ['buildings', 'park', 'plaza', 'carpark', 'lot'];
/** Building height scale limits (heights stay capped at districts.ts MAX_HEIGHT). */
export const HEIGHT_SCALE_MIN = 0.4;
export const HEIGHT_SCALE_MAX = 1.6;

export type Node = readonly [number, number];

export interface BlockEdit {
  /** Core block (bx, bz): block (0, 0) is the core's north-west corner. */
  at: readonly [number, number];
  kind?: BlockEditKind;
  district?: District;
  /** Its buildings (and pavement) look like this district's: heights, walls, shopfronts, roofs and signs; the district stays for the game. */
  style?: District;
  /** Rebuild the block's buildings or trees from this stream (any integer; a new number is a new layout). */
  variant?: number;
  /** Scale the block's building heights (HEIGHT_SCALE_MIN..MAX; the footprints stay). */
  height?: number;
}

export interface RoadEdit {
  /** Neighbouring crossings (node (ix, iz) is at world (ix·64, iz·64)); for a one-way road, traffic runs a → b. */
  a: Node;
  b: Node;
  /** No traffic either way (barriers at both ends). */
  closed?: boolean;
  /** Traffic only from a to b. */
  oneWay?: boolean;
  /** Paved over as a pedestrian street: no traffic, bollards across both ends, people walk down it (round 3). */
  pedestrian?: boolean;
  /** Taken out: the road becomes land and the blocks either side one block (world/blockMerge.ts; round 3). */
  removed?: boolean;
}

/** Spots the map can add (game/mapAnchors.ts spotRules: what each is and its id). */
export type AddedSpotKind = 'ramp' | 'kicker' | 'hangout' | 'package' | 'phone' | 'frenzy' | 'pickup';
export const ADDED_SPOT_KINDS: readonly AddedSpotKind[] = ['ramp', 'kicker', 'hangout', 'package', 'phone', 'frenzy', 'pickup'];

/** What an added pickup can be (world/pickups.ts PICKUP_KINDS, which a test keeps equal). */
export const PICKUP_ITEMS: readonly PickupKind[] = ['pistol', 'smg', 'shotgun', 'health', 'armour', 'ammo', 'grenade', 'molotov', 'rocket', 'horn', 'taser', 'stinger', 'smoke'];

export interface SpotEdit {
  /** An anchor id (game/mapAnchors.ts): 'safehouse', 'phone-docks', 'fz-drift', 'vipers-0', 'ramp-3', 'pkg-12'... */
  id: string;
  /** A new spot of this kind, not one the city generates (it needs x and z; `removed` doesn't apply: drop the entry). */
  add?: AddedSpotKind;
  /** Moved to (world m); both or neither. */
  x?: number;
  z?: number;
  /** Turned to (radians, vehicle convention), where the spot has a facing. */
  heading?: number;
  /** Taken out of the city (only spots the game can do without: mapAnchors decides). */
  removed?: boolean;
  /** A story job's drive route or race step moved: its crossings [ix, iz], in order (as many as it had). */
  nodes?: ReadonlyArray<readonly [number, number]>;
  /** A story job's collect step moved: its points [x, z] (world m), in order. */
  points?: ReadonlyArray<readonly [number, number]>;
  /** An added frenzy token's frenzy (`add: 'frenzy'`): goal, target, seconds and gift (game/modes/frenzyLimits.ts). */
  frenzy?: FrenzySpec;
  /** An added pickup's kind (`add: 'pickup'`). */
  pickup?: PickupKind;
}

/** A story job rung from another payphone (round 3): `phone` is a payphone's anchor id, generated or added. */
export interface JobEdit {
  /** The job's id (systems/missionsData.ts: 's2-noise', 'm3'...). */
  id: string;
  phone: string;
}

/** The landmarks the map moves (round 3), each to another block of the same shape. */
export type LandmarkId = 'docks' | 'hospital' | 'spray-ne' | 'spray-nw' | 'spray-se' | 'spray-sw' | 'station';
/** In file order. The spray bays by the quarter of the city they serve (world/landmarks.ts SPRAY_SLOTS). */
export const LANDMARK_IDS: readonly LandmarkId[] = ['docks', 'hospital', 'spray-ne', 'spray-nw', 'spray-se', 'spray-sw', 'station'];

/**
 * A landmark moved to core block `at`: the docks yard and the spray bays to
 * an open lot's road edge (bayFor), the station and the hospital to a
 * built-up block's pavement, carrying their props and keep-out zones.
 */
export interface LandmarkEdit {
  id: LandmarkId;
  at: readonly [number, number];
}

export interface PropEdit {
  /** A street prop kind (world/streetProps.ts StreetPropKind). */
  kind: string;
  x: number;
  z: number;
  /** Added props: facing (radians, vehicle convention). */
  heading?: number;
  /** Remove the generated prop of this kind standing here (within PROP_MATCH m) instead of adding one. */
  removed?: boolean;
}

/** A removal matches a generated prop of its kind this close, m. */
export const PROP_MATCH = 0.5;

export interface MapEdits {
  version: number;
  /** The city seed the edits were made against. */
  seed: number;
  blocks: readonly BlockEdit[];
  roads: readonly RoadEdit[];
  spots: readonly SpotEdit[];
  props: readonly PropEdit[];
  /** Round 3 (optional, written only when there are some): which payphone a job rings from. */
  jobs?: readonly JobEdit[];
  /** Round 3 (optional, likewise): landmarks moved to another block. */
  landmarks?: readonly LandmarkEdit[];
}

export type MapSection = 'blocks' | 'roads' | 'spots' | 'props' | 'jobs' | 'landmarks';
export const MAP_SECTIONS: readonly MapSection[] = ['blocks', 'roads', 'spots', 'props', 'jobs', 'landmarks'];
/** Sections a file leaves out when empty (so a map from before them writes the same bytes). */
const OPTIONAL_SECTIONS: ReadonlySet<MapSection> = new Set<MapSection>(['jobs', 'landmarks']);

export const NO_EDITS: MapEdits = Object.freeze({
  version: MAP_EDITS_VERSION,
  seed: 1337,
  blocks: Object.freeze([]),
  roads: Object.freeze([]),
  spots: Object.freeze([]),
  props: Object.freeze([]),
});

/** Core blocks reach this far either side of the core (a 32 × 32 city's ring is 8; room to grow). */
const BLOCK_REACH = 64;
/** Crossings reach this far from the centre (a 32 × 32 city's are ±16). */
const NODE_REACH = 64;
/** Positions this far from the centre at most, m. */
const WORLD_REACH = NODE_REACH * 64;

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

/** The road between a and b, either way round: 'ax,az|bx,bz' with the smaller node first. */
export function roadKey(a: Node, b: Node): string {
  const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
  return `${p[0]},${p[1]}|${q[0]},${q[1]}`;
}

/** A prop edit's identity: kind and place to 0.1 m. */
export function propKey(p: { kind: string; x: number; z: number }): string {
  return `${p.kind}@${p.x.toFixed(1)},${p.z.toFixed(1)}`;
}

const tenth = (v: number) => Math.round(v * 10) / 10;
const hundredth = (v: number) => Math.round(v * 100) / 100;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNode = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) && Math.abs(v[0]) <= NODE_REACH && Math.abs(v[1]) <= NODE_REACH;

export interface ParsedMapEdits {
  edits: MapEdits;
  /** What was wrong with the file and dropped (empty for a clean file). */
  problems: string[];
}

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
  if (o.version !== 1 && o.version !== MAP_EDITS_VERSION) {
    return { edits: NO_EDITS, problems: [`unknown map version ${JSON.stringify(o.version)} (this build reads 1 and ${MAP_EDITS_VERSION})`] };
  }
  const sections: readonly string[] = o.version === 1 ? ['blocks'] : MAP_SECTIONS;
  for (const k of Object.keys(o)) if (k !== 'version' && k !== 'seed' && !sections.includes(k)) problems.push(`unknown section "${k}" ignored`);
  let seed = NO_EDITS.seed;
  if (o.seed !== undefined) {
    if (isInt(o.seed)) seed = o.seed;
    else problems.push('seed is not an integer; using 1337');
  }
  const list = (name: MapSection): unknown[] => {
    const v = o[name] ?? [];
    if (Array.isArray(v)) return v;
    problems.push(`${name} is not a list`);
    return [];
  };
  /** Fields of entry `e` outside `known` are reported and ignored. */
  const unknownFields = (where: string, e: Record<string, unknown>, known: readonly string[]) => {
    for (const k of Object.keys(e)) if (!known.includes(k)) problems.push(`${where}: unknown field "${k}" ignored`);
  };
  const entries = (name: MapSection, read: (e: Record<string, unknown>, where: string) => { key: string | number; entry: object } | null) => {
    const byKey = new Map<string | number, object>();
    list(name).forEach((v, i) => {
      const where = `${name}[${i}]`;
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return void problems.push(`${where}: not an object`);
      const got = read(v as Record<string, unknown>, where);
      if (!got) return;
      if (byKey.has(got.key)) problems.push(`${where}: ${name === 'blocks' ? 'block' : name.slice(0, -1)} edited twice; the later one wins`);
      byKey.set(got.key, got.entry);
    });
    return [...byKey.values()];
  };

  const blocks = entries('blocks', (e, where) => {
    const at = e.at;
    if (!Array.isArray(at) || at.length !== 2 || !isInt(at[0]) || !isInt(at[1])) return void problems.push(`${where}: "at" must be [bx, bz] integers`), null;
    if (Math.abs(at[0]) >= BLOCK_REACH || Math.abs(at[1]) >= BLOCK_REACH) return void problems.push(`${where}: block ${at[0]},${at[1]} is off any city`), null;
    unknownFields(where, e, ['at', 'kind', 'district', 'style', 'variant', 'height']);
    const edit: { -readonly [K in keyof BlockEdit]: BlockEdit[K] } = { at: [at[0], at[1]] };
    if (e.kind !== undefined) {
      if (BLOCK_EDIT_KINDS.includes(e.kind as BlockEditKind)) edit.kind = e.kind as BlockEditKind;
      else problems.push(`${where}: unknown kind ${JSON.stringify(e.kind)} ignored`);
    }
    if (e.district !== undefined) {
      if (DISTRICTS.includes(e.district as District)) edit.district = e.district as District;
      else problems.push(`${where}: unknown district ${JSON.stringify(e.district)} ignored`);
    }
    if (e.style !== undefined) {
      if (DISTRICTS.includes(e.style as District)) edit.style = e.style as District;
      else problems.push(`${where}: unknown style ${JSON.stringify(e.style)} ignored`);
    }
    if (e.variant !== undefined) {
      if (isInt(e.variant)) edit.variant = e.variant;
      else problems.push(`${where}: variant must be an integer`);
    }
    if (e.height !== undefined) {
      if (isNum(e.height) && e.height >= HEIGHT_SCALE_MIN && e.height <= HEIGHT_SCALE_MAX) edit.height = hundredth(e.height);
      else problems.push(`${where}: height must be a scale from ${HEIGHT_SCALE_MIN} to ${HEIGHT_SCALE_MAX}`);
    }
    if (!blockChanges(edit)) return void problems.push(`${where}: changes nothing`), null;
    return { key: blockEditKey(edit.at[0], edit.at[1]), entry: edit };
  });

  const roads = entries('roads', (e, where) => {
    if (!isNode(e.a) || !isNode(e.b)) return void problems.push(`${where}: "a" and "b" must be crossings [ix, iz]`), null;
    if (Math.abs(e.a[0] - e.b[0]) + Math.abs(e.a[1] - e.b[1]) !== 1) return void problems.push(`${where}: ${e.a} and ${e.b} aren't neighbouring crossings`), null;
    unknownFields(where, e, ['a', 'b', 'closed', 'oneWay', 'pedestrian', 'removed']);
    // Round 3: a pedestrian street or a removed road is one state of its own (removed, then pedestrian, then closed, then one-way wins).
    const street = streetFlag(e, where, problems);
    if (street) {
      const [p, q] = roadKey(e.a, e.b).split('|').map((n) => n.split(',').map(Number) as [number, number]);
      return { key: roadKey(p, q), entry: { a: p, b: q, [street]: true } as RoadEdit };
    }
    const closed = e.closed === true;
    const oneWay = e.oneWay === true && !closed;
    if (e.oneWay === true && closed) problems.push(`${where}: closed and one-way; closed wins`);
    if (!closed && !oneWay) return void problems.push(`${where}: changes nothing`), null;
    // A two-way edit has no direction: written smaller node first.
    const [a, b] = oneWay ? [e.a, e.b] : (roadKey(e.a, e.b).split('|').map((n) => n.split(',').map(Number)) as [[number, number], [number, number]]);
    const edit: RoadEdit = closed ? { a: [a[0], a[1]], b: [b[0], b[1]], closed: true } : { a: [a[0], a[1]], b: [b[0], b[1]], oneWay: true };
    return { key: roadKey(a, b), entry: edit };
  });

  const spots = entries('spots', (e, where) => {
    if (typeof e.id !== 'string' || !/^[a-z0-9][a-z0-9:/._-]*$/i.test(e.id)) return void problems.push(`${where}: "id" must be an anchor id`), null;
    unknownFields(where, e, ['id', 'add', 'x', 'z', 'heading', 'removed', 'nodes', 'points', 'frenzy', 'pickup']);
    const edit: { -readonly [K in keyof SpotEdit]: SpotEdit[K] } = { id: e.id };
    if (e.add !== undefined) {
      if (!ADDED_SPOT_KINDS.includes(e.add as AddedSpotKind)) return void problems.push(`${where}: can't add a spot of kind ${JSON.stringify(e.add)}`), null;
      if (!isNum(e.x) || !isNum(e.z) || Math.abs(e.x) > WORLD_REACH || Math.abs(e.z) > WORLD_REACH) return void problems.push(`${where}: an added spot needs "x" and "z" on the map`), null;
      if (e.removed !== undefined) problems.push(`${where}: an added spot can't be removed (drop its entry); "removed" ignored`);
      edit.add = e.add as AddedSpotKind;
      const extra = addedSpotExtra(edit.add, e, where, problems);
      if (extra === null) return null;
      Object.assign(edit, extra);
    } else if (e.frenzy !== undefined || e.pickup !== undefined) problems.push(`${where}: "frenzy" and "pickup" only go with an added spot; ignored`);
    if (e.removed === true && !edit.add) edit.removed = true;
    else {
      if (e.x !== undefined || e.z !== undefined) {
        if (isNum(e.x) && isNum(e.z) && Math.abs(e.x) <= WORLD_REACH && Math.abs(e.z) <= WORLD_REACH) {
          edit.x = tenth(e.x);
          edit.z = tenth(e.z);
        } else problems.push(`${where}: "x" and "z" must both be on the map`);
      }
      if (e.heading !== undefined) {
        if (isNum(e.heading)) edit.heading = hundredth(e.heading);
        else problems.push(`${where}: heading must be a number`);
      }
      if (e.nodes !== undefined) {
        if (isNodeList(e.nodes)) edit.nodes = e.nodes.map((n) => [n[0], n[1]] as const);
        else problems.push(`${where}: "nodes" must be a list of crossings [ix, iz]`);
      }
      if (e.points !== undefined) {
        if (isPointList(e.points)) edit.points = e.points.map((q) => [tenth(q[0]), tenth(q[1])] as const);
        else problems.push(`${where}: "points" must be a list of [x, z] on the map`);
      }
    }
    if (!edit.removed && edit.x === undefined && edit.heading === undefined && edit.nodes === undefined && edit.points === undefined) return void problems.push(`${where}: changes nothing`), null;
    return { key: edit.id, entry: edit };
  });

  const props = entries('props', (e, where) => {
    if (typeof e.kind !== 'string' || !/^[a-z_]+$/.test(e.kind)) return void problems.push(`${where}: "kind" must be a prop kind`), null;
    if (!isNum(e.x) || !isNum(e.z) || Math.abs(e.x) > WORLD_REACH || Math.abs(e.z) > WORLD_REACH) return void problems.push(`${where}: "x" and "z" must be on the map`), null;
    unknownFields(where, e, ['kind', 'x', 'z', 'heading', 'removed']);
    const edit: { -readonly [K in keyof PropEdit]: PropEdit[K] } = { kind: e.kind, x: tenth(e.x), z: tenth(e.z) };
    if (e.removed === true) edit.removed = true;
    else if (e.heading !== undefined) {
      if (isNum(e.heading)) edit.heading = hundredth(e.heading);
      else problems.push(`${where}: heading must be a number`);
    }
    return { key: propKey(edit), entry: edit };
  });

  const jobs = entries('jobs', (e, where) => {
    if (typeof e.id !== 'string' || !ID.test(e.id)) return void problems.push(`${where}: "id" must be a job's id`), null;
    if (typeof e.phone !== 'string' || !ID.test(e.phone)) return void problems.push(`${where}: "phone" must be a payphone's id`), null;
    unknownFields(where, e, ['id', 'phone']);
    return { key: e.id, entry: { id: e.id, phone: e.phone } };
  });

  const landmarks = entries('landmarks', (e, where) => {
    if (!LANDMARK_IDS.includes(e.id as LandmarkId)) return void problems.push(`${where}: no landmark ${JSON.stringify(e.id)} (one of ${LANDMARK_IDS.join(', ')})`), null;
    const at = e.at;
    if (!Array.isArray(at) || at.length !== 2 || !isInt(at[0]) || !isInt(at[1]) || Math.abs(at[0]) >= BLOCK_REACH || Math.abs(at[1]) >= BLOCK_REACH) return void problems.push(`${where}: "at" must be a block [bx, bz]`), null;
    unknownFields(where, e, ['id', 'at']);
    return { key: e.id as string, entry: { id: e.id as LandmarkId, at: [at[0], at[1]] as const } };
  });

  const out: { -readonly [K in keyof MapEdits]: MapEdits[K] } = { version: MAP_EDITS_VERSION, seed, blocks: blocks as BlockEdit[], roads: roads as RoadEdit[], spots: spots as SpotEdit[], props: props as PropEdit[] };
  if (jobs.length) out.jobs = jobs as JobEdit[];
  if (landmarks.length) out.landmarks = landmarks as LandmarkEdit[];
  return { edits: sortEdits(out), problems };
}

const ID = /^[a-z0-9][a-z0-9:/._-]*$/i;
const isNodeList = (v: unknown): v is Array<[number, number]> => Array.isArray(v) && v.length >= 2 && v.every(isNode);
const isPointList = (v: unknown): v is Array<[number, number]> =>
  Array.isArray(v) && v.length >= 1 && v.every((q) => Array.isArray(q) && q.length === 2 && isNum(q[0]) && isNum(q[1]) && Math.abs(q[0]) <= WORLD_REACH && Math.abs(q[1]) <= WORLD_REACH);

/**
 * An added frenzy's spec (clamped into its goal's limits, reported) or an
 * added pickup's kind; null drops the entry (no goal, an unknown kind).
 */
function addedSpotExtra(add: AddedSpotKind, e: Record<string, unknown>, where: string, problems: string[]): Pick<SpotEdit, 'frenzy' | 'pickup'> | null {
  if (add === 'pickup') {
    if (PICKUP_ITEMS.includes(e.pickup as PickupKind)) return { pickup: e.pickup as PickupKind };
    problems.push(`${where}: an added pickup needs "pickup", one of ${PICKUP_ITEMS.join(', ')}`);
    return null;
  }
  if (add !== 'frenzy') {
    if (e.frenzy !== undefined || e.pickup !== undefined) problems.push(`${where}: "frenzy" and "pickup" don't go with an added ${add}; ignored`);
    return {};
  }
  const f = e.frenzy;
  if (typeof f !== 'object' || f === null || Array.isArray(f)) return void problems.push(`${where}: an added frenzy needs "frenzy" { goal, target, seconds }`), null;
  const o = f as Record<string, unknown>;
  if (!FRENZY_GOALS.includes(o.goal as FrenzySpec['goal'])) return void problems.push(`${where}: unknown frenzy goal ${JSON.stringify(o.goal)}`), null;
  for (const k of Object.keys(o)) if (!['goal', 'target', 'seconds', 'gift'].includes(k)) problems.push(`${where}: frenzy: unknown field "${k}" ignored`);
  const goal = o.goal as FrenzySpec['goal'];
  for (const p of frenzySpecProblems(o)) problems.push(`${where}: ${p}; ${p.includes('gift') ? 'dropped' : 'clamped'}`);
  const spec: FrenzySpec = { goal, target: clampTarget(goal, isNum(o.target) ? o.target : 0), seconds: clampSeconds(goal, isNum(o.seconds) ? o.seconds : 0) };
  if (FRENZY_GIFTS.includes(o.gift as NonNullable<FrenzySpec['gift']>)) spec.gift = o.gift as FrenzySpec['gift'];
  return { frenzy: spec };
}

/** A road entry's round-3 state ('removed' or 'pedestrian'), reporting what it overrides. */
function streetFlag(e: Record<string, unknown>, where: string, problems: string[]): 'removed' | 'pedestrian' | null {
  const flag = e.removed === true ? 'removed' : e.pedestrian === true ? 'pedestrian' : null;
  if (!flag) return null;
  const also = (['pedestrian', 'closed', 'oneWay'] as const).filter((k) => k !== flag && e[k] === true);
  if (also.length) problems.push(`${where}: ${flag} and ${also.join(' and ')}; ${flag} wins`);
  return flag;
}

const blockChanges = (e: Omit<BlockEdit, 'at'>) => e.kind !== undefined || e.district !== undefined || e.style !== undefined || e.variant !== undefined || e.height !== undefined;

const byNode = (p: Node, q: Node) => p[1] - q[1] || p[0] - q[0];

/** Each section's order in the file: blocks and roads north to south then west to east, spots by id, props by kind then place. */
const COMPARE: { [S in MapSection]: (a: NonNullable<MapEdits[S]>[number], b: NonNullable<MapEdits[S]>[number]) => number } = {
  blocks: (a, b) => byNode(a.at, b.at),
  roads: (a, b) => byNode(a.a, b.a) || byNode(a.b, b.b),
  spots: (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  props: (a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.z - b.z || a.x - b.x),
  jobs: (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  landmarks: (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
};
const compare = (section: MapSection) => COMPARE[section] as (a: object, b: object) => number;

function sortEdits(e: MapEdits): MapEdits {
  return {
    ...e,
    blocks: [...e.blocks].sort(COMPARE.blocks),
    roads: [...e.roads].sort(COMPARE.roads),
    spots: [...e.spots].sort(COMPARE.spots),
    props: [...e.props].sort(COMPARE.props),
    ...(e.jobs ? { jobs: [...e.jobs].sort(COMPARE.jobs) } : {}),
    ...(e.landmarks ? { landmarks: [...e.landmarks].sort(COMPARE.landmarks) } : {}),
  };
}

/** A value as one line of JSON with spaces after separators: `{ "at": [5, 6], "kind": "park" }`. */
function oneLine(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(oneLine).join(', ')}]`;
  if (typeof v === 'object' && v !== null) {
    const parts = Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${oneLine(x)}`);
    return `{ ${parts.join(', ')} }`;
  }
  return JSON.stringify(v);
}

/** Entries with their keys in the file's fixed order. */
const ORDER: Readonly<Record<MapSection, readonly string[]>> = {
  blocks: ['at', 'kind', 'district', 'style', 'variant', 'height'],
  roads: ['a', 'b', 'closed', 'oneWay', 'pedestrian', 'removed'],
  spots: ['id', 'add', 'x', 'z', 'heading', 'removed', 'nodes', 'points', 'pickup', 'frenzy'],
  props: ['kind', 'x', 'z', 'heading', 'removed'],
  jobs: ['id', 'phone'],
  landmarks: ['id', 'at'],
};
const ordered = (section: MapSection, e: object): Record<string, unknown> =>
  Object.fromEntries(ORDER[section].map((k) => [k, (e as Record<string, unknown>)[k]]).filter(([, v]) => v !== undefined));

/** The map file's text: canonical, so the same edits always write the same bytes. */
export function serializeMapEdits(edits: MapEdits): string {
  const e = sortEdits(edits);
  const section = (name: MapSection) => {
    const list = (e[name] ?? []) as readonly object[];
    return list.length === 0 ? '[]' : `[\n${list.map((x) => `    ${oneLine(ordered(name, x))}`).join(',\n')}\n  ]`;
  };
  const body = MAP_SECTIONS.filter((s) => !OPTIONAL_SECTIONS.has(s) || (e[s]?.length ?? 0) > 0)
    .map((s) => `  "${s}": ${section(s)}`)
    .join(',\n');
  return `{\n  "version": ${MAP_EDITS_VERSION},\n  "seed": ${edits.seed},\n${body}\n}\n`;
}

// --- Changes, for the editor (diff, revert, undo) ---

/** An entry's key within its section. */
export function entryKey(section: MapSection, e: object): string {
  switch (section) {
    case 'blocks': {
      const b = e as BlockEdit;
      return `${b.at[0]},${b.at[1]}`;
    }
    case 'roads': {
      const r = e as RoadEdit;
      return roadKey(r.a, r.b);
    }
    case 'spots':
    case 'jobs':
    case 'landmarks':
      return (e as { id: string }).id;
    default:
      return propKey(e as PropEdit);
  }
}

export interface MapEditChange {
  section: MapSection;
  /** entryKey of the entry. */
  key: string;
  /** In the base (the committed file); undefined if it wasn't edited there. */
  before?: MapEntry;
  /** In the local edits; undefined if it was reverted. */
  after?: MapEntry;
}

const sameEntry = (section: MapSection, a: object, b: object) => oneLine(ordered(section, a)) === oneLine(ordered(section, b));

/** What local edits change against the committed file, entry by entry, in the file's order (what the editor's diff lists and can revert). */
export function diffMapEdits(base: MapEdits, local: MapEdits): MapEditChange[] {
  const out: MapEditChange[] = [];
  const b = sortEdits(base);
  const l = sortEdits(local);
  for (const section of MAP_SECTIONS) {
    const before = new Map(((b[section] ?? []) as readonly object[]).map((e) => [entryKey(section, e), e]));
    const after = new Map(((l[section] ?? []) as readonly object[]).map((e) => [entryKey(section, e), e]));
    // Every key once, in the file's order (by whichever side holds it).
    const entries = new Map<string, object>([...before, ...after]);
    const keys = [...entries.keys()].sort((x, y) => compare(section)(entries.get(x)!, entries.get(y)!));
    for (const k of keys) {
      const x = before.get(k) as MapEditChange['before'];
      const y = after.get(k) as MapEditChange['after'];
      if (x && y && sameEntry(section, x, y)) continue;
      out.push({ section, key: k, before: x, after: y });
    }
  }
  return out;
}

/** Put `entry` in `section` in place of any entry with the same key (none: just remove it), returning new edits. */
export function withEntry(edits: MapEdits, section: MapSection, key: string, entry?: MapEntry): MapEdits {
  const list = ((edits[section] ?? []) as readonly object[]).filter((e) => entryKey(section, e) !== key);
  if (entry) list.push(entry);
  const next: Record<string, unknown> = { ...edits, [section]: list };
  // An emptied optional section goes, so the edits equal ones that never had it.
  if (OPTIONAL_SECTIONS.has(section) && list.length === 0) delete next[section];
  return sortEdits(next as unknown as MapEdits);
}

/** An entry of any section. */
export type MapEntry = BlockEdit | RoadEdit | SpotEdit | PropEdit | JobEdit | LandmarkEdit;

/** Undo one change of a diff: the entry goes back to what the base had. */
export function revertChange(local: MapEdits, change: MapEditChange): MapEdits {
  return withEntry(local, change.section, change.key, change.before);
}

/** Set (or with `edit` undefined or changing nothing, clear) one block's edit, returning new edits (the editor's undo keeps the old ones). */
export function withBlockEdit(edits: MapEdits, at: readonly [number, number], edit?: Omit<BlockEdit, 'at'>): MapEdits {
  const entry = edit && blockChanges(edit) ? { ...edit, at: [at[0], at[1]] as const } : undefined;
  return withEntry(edits, 'blocks', `${at[0]},${at[1]}`, entry);
}

/** Close a road, make it one-way a → b, or (neither) open it as generated. */
export function withRoadEdit(edits: MapEdits, a: Node, b: Node, edit?: { closed?: boolean; oneWay?: boolean }): MapEdits {
  const key = roadKey(a, b);
  if (edit?.closed) {
    const [p, q] = key.split('|').map((n) => n.split(',').map(Number) as [number, number]);
    return withEntry(edits, 'roads', key, { a: p, b: q, closed: true });
  }
  if (edit?.oneWay) return withEntry(edits, 'roads', key, { a: [a[0], a[1]], b: [b[0], b[1]], oneWay: true });
  return withEntry(edits, 'roads', key);
}

/** Move, turn or remove a spot; with no edit, put it back where it was generated. */
export function withSpotEdit(edits: MapEdits, id: string, edit?: Omit<SpotEdit, 'id'>): MapEdits {
  const moved = edit && (edit.removed || edit.x !== undefined || edit.heading !== undefined);
  const entry: SpotEdit | undefined = !moved
    ? undefined
    : edit.removed
      ? { id, removed: true }
      : { id, ...(edit.x !== undefined && edit.z !== undefined ? { x: tenth(edit.x), z: tenth(edit.z) } : {}), ...(edit.heading !== undefined ? { heading: hundredth(edit.heading) } : {}) };
  return withEntry(edits, 'spots', id, entry);
}

/** Add a new spot (or with `entry` undefined, drop the added spot `id`). */
export function withAddedSpot(edits: MapEdits, id: string, entry?: { add: AddedSpotKind; x: number; z: number; heading?: number; frenzy?: FrenzySpec; pickup?: PickupKind }): MapEdits {
  const e: SpotEdit | undefined = entry && {
    id,
    add: entry.add,
    x: tenth(entry.x),
    z: tenth(entry.z),
    ...(entry.heading !== undefined ? { heading: hundredth(entry.heading) } : {}),
    ...(entry.pickup !== undefined ? { pickup: entry.pickup } : {}),
    ...(entry.frenzy !== undefined ? { frenzy: frenzySpec(entry.frenzy) } : {}),
  };
  return withEntry(edits, 'spots', id, e);
}

/** Add a prop, or mark a generated one removed; `undo` drops the edit at that kind and place instead. */
export function withPropEdit(edits: MapEdits, prop: PropEdit, undo = false): MapEdits {
  const entry: PropEdit = prop.removed
    ? { kind: prop.kind, x: tenth(prop.x), z: tenth(prop.z), removed: true }
    : { kind: prop.kind, x: tenth(prop.x), z: tenth(prop.z), ...(prop.heading !== undefined ? { heading: hundredth(prop.heading) } : {}) };
  return withEntry(edits, 'props', propKey(entry), undo ? undefined : entry);
}

// --- Round 3: story spots, jobs' phones, landmarks ---

/** A frenzy spec with its keys in the file's order (goal, target, seconds, gift). */
function frenzySpec(f: FrenzySpec): FrenzySpec {
  return { goal: f.goal, target: f.target, seconds: f.seconds, ...(f.gift ? { gift: f.gift } : {}) };
}

/**
 * A story job's spot edit (round 3): a point moved (x, z, and a turn for a
 * parked car), or a route's crossings or a collect step's points replaced.
 * With nothing in `edit`, the spot is back as the job was written.
 */
export function withStorySpotEdit(edits: MapEdits, id: string, edit: Pick<SpotEdit, 'x' | 'z' | 'heading' | 'nodes' | 'points'> = {}): MapEdits {
  const entry: SpotEdit = {
    id,
    ...(edit.x !== undefined && edit.z !== undefined ? { x: tenth(edit.x), z: tenth(edit.z) } : {}),
    ...(edit.heading !== undefined ? { heading: hundredth(edit.heading) } : {}),
    ...(edit.nodes ? { nodes: edit.nodes.map((n) => [n[0], n[1]] as const) } : {}),
    ...(edit.points ? { points: edit.points.map((q) => [tenth(q[0]), tenth(q[1])] as const) } : {}),
  };
  const changes = entry.x !== undefined || entry.heading !== undefined || entry.nodes !== undefined || entry.points !== undefined;
  return withEntry(edits, 'spots', id, changes ? entry : undefined);
}

/** Ring job `id` from payphone `phone` (undefined: the phone it was written for). */
export function withJobPhone(edits: MapEdits, id: string, phone?: string): MapEdits {
  return withEntry(edits, 'jobs', id, phone ? { id, phone } : undefined);
}

/** Move landmark `id` to core block `at` (undefined: where the city puts it). */
export function withLandmark(edits: MapEdits, id: LandmarkId, at?: readonly [number, number]): MapEdits {
  return withEntry(edits, 'landmarks', id, at ? { id, at: [at[0], at[1]] } : undefined);
}

/** The block landmark `id` is moved to, if the edits move it. */
export function landmarkEdit(edits: MapEdits | undefined, id: LandmarkId): LandmarkEdit | undefined {
  return edits?.landmarks?.find((l) => l.id === id);
}

/** The phone the edits ring job `id` from, if they move it. */
export function jobPhone(edits: MapEdits | undefined, id: string): string | undefined {
  return edits?.jobs?.find((j) => j.id === id)?.phone;
}

/** Pave a road over as a pedestrian street (round 3); with `on` false, open it as generated. Removing a road merges blocks: world/blockMerge.ts removeRoad. */
export function withPedestrianRoad(edits: MapEdits, a: Node, b: Node, on = true): MapEdits {
  const key = roadKey(a, b);
  if (!on) return withEntry(edits, 'roads', key);
  const [p, q] = key.split('|').map((n) => n.split(',').map(Number) as [number, number]);
  return withEntry(edits, 'roads', key, { a: p, b: q, pedestrian: true });
}
