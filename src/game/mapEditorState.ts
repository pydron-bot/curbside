/**
 * The map editor's logic (W3-D), with no DOM and no three.js: the edited
 * city as a preview (city, street props, anchors, problems), the undo
 * history over MapEdits snapshots, the 2D view's transform, hit-testing,
 * what each tool writes into the edits, the dependency overlay's geometry
 * and the change list's wording. ui/mapEditor.ts draws and wires it.
 *
 * Two seams for the map engine (W3-D's other half): `spotRule` (which
 * spots move and which can go) and `problemsFor` (every check an edit
 * runs). Both are local stand-ins today.
 */
import { checkMapEdits, collectAnchors, blockAt, newSpotId, roadAt, routeNodes, spotRules, type Anchor, type AnchorGroup, type MapPick, type Node } from './mapAnchors';
import { GANGS } from './gangs';
import { BLOCK_SIZE, CORE_OFFSET, HALF_EXTENT, generateCity, isCarPark, lotBytes, type City } from '../world/city';
import type { District } from '../world/districts';
import { dressCity, type Dressing } from '../world/dressing';
import {
  HEIGHT_SCALE_MAX,
  HEIGHT_SCALE_MIN,
  NO_EDITS,
  PROP_MATCH,
  propKey,
  roadKey,
  serializeMapEdits,
  withBlockEdit,
  withPropEdit,
  withRoadEdit,
  withSpotEdit,
  withAddedSpot,
  type AddedSpotKind,
  type BlockEdit,
  type BlockEditKind,
  type MapEditChange,
  type MapEdits,
  type PropEdit,
  type RoadEdit,
  type SpotEdit,
  MAP_EDITS_VERSION,
  parseMapEdits,
} from '../world/mapEdits';
import { MAX_NODE } from '../world/roads';
import { placeCityRamps, type Ramp } from '../world/ramps';
import { installMap } from '../world/city';
import { RoadRules } from '../world/roadRules';
import { removeRoad, restoreRoad } from '../world/blockMerge';
import { withPedestrianRoad } from '../world/mapEdits';
import type { StreetPropKind, StreetProps } from '../world/streetProps';
import { PICKUP_ITEMS, landmarkEdit, withJobPhone, withLandmark, withStorySpotEdit, type JobEdit, type LandmarkEdit, type LandmarkId } from '../world/mapEdits';
import { placePickups, type PickupKind } from '../world/pickups';
import { shopSpots } from '../world/shopSpots';
import { FRENZY_DEFAULTS, clampSeconds, clampTarget, frenzyTitle, type FrenzySpec } from './modes/frenzyLimits';
import { anchorBlock, collectRound3, phoneJobs } from './mapSpots';
import { sceneHosts, type SceneHost } from './sceneHosts';

export type Point = { x: number; z: number };

// --- Seam 1: which spots move and which can go ---

/**
 * May the editor move, turn or remove this spot? The engine's table
 * (mapAnchors spotRules): the safehouse, payphones and frenzy tokens move
 * but stay; gang hangouts and ramps can go too; ramps turn. Anything else
 * (jobs, landmarks, races, bus stops) isn't a spot the file can edit.
 */
export function spotRule(id: string): { movable: boolean; removable: boolean; turnable: boolean } {
  const r = spotRules(id);
  return { movable: r?.movable ?? false, removable: r?.removable ?? false, turnable: r?.turnable ?? false };
}

/** What PLACE can add besides street props: new spots (game/mapAnchors.ts newSpotId gives each its id). */
export const PLACEABLE_SPOTS: ReadonlyArray<{ kind: AddedSpotKind; label: string; gang?: string }> = [
  { kind: 'ramp', label: 'STUNT RAMP' },
  { kind: 'kicker', label: 'KICKER' },
  ...GANGS.map((g) => ({ kind: 'hangout' as const, label: `${g.name} HANGOUT`, gang: g.id })),
  { kind: 'package', label: 'HIDDEN PACKAGE' },
  { kind: 'phone', label: 'PAYPHONE' },
  { kind: 'frenzy', label: 'FRENZY TOKEN' },
];

/** PLACE's pickups, one per kind (`spot:pickup:<kind>`). */
export const PLACEABLE_PICKUPS: ReadonlyArray<{ kind: 'pickup'; label: string; item: PickupKind }> = PICKUP_ITEMS.map((item) => ({ kind: 'pickup', label: `PICKUP: ${item.toUpperCase()}`, item }));

// --- The preview: the edited city and everything on it ---

export interface PreviewInputs {
  pickups: ReadonlyArray<Point>;
  ramps: readonly Ramp[];
}

/** A street prop as the editor shows it: generated, added by the edits, or a generated one the edits removed (a ghost). */
export interface PropRef {
  kind: string;
  x: number;
  z: number;
  heading: number;
  origin: 'generated' | 'added' | 'removed';
}

/** What the unedited city has at each block (to tell an edit from a no-op). */
export interface BlockBase {
  kind: BlockEditKind;
  district: District;
}

export interface Preview {
  edits: MapEdits;
  city: City;
  /** Per city block (city.blocks order): its kind as the editor names it (a plaza is 'plaza' or 'carpark'). */
  kinds: BlockEditKind[];
  /** Street props with the edits' removals as ghosts and additions on top. */
  props: PropRef[];
  /** Every anchor with the spot edits applied (moved; removed ones left out). */
  anchors: Anchor[];
  /** Spots the edits moved (from where they were generated) or removed. */
  moved: Map<string, { from: Point; to: Point }>;
  removed: Anchor[];
  /** The ramps as generated (by id: a turn's base). */
  rawRamps: readonly Ramp[];
  /** The ramps as the edits leave them (an added one's turn base). */
  ramps: readonly Ramp[];
  problems: EditorProblem[];
  /** Round 3: shop doors and road works sites (detail anchors: drawn and picked zoomed in, listed as dependents). */
  extras: Anchor[];
  /** Round 3: what the run-time scenes could pick, by block and road (sceneHosts' hostKey). */
  hosts: Map<string, SceneHost[]>;
  /** How long the build took, ms. */
  ms: number;
  /** The edits' road rules (round 3: picks on a merged block or a removed road read them; the game's stay installed). */
  rules?: RoadRules;
}

const editKind = (city: City, bytes: Uint8Array, i: number): BlockEditKind =>
  city.blocks[i].kind === 'plaza' ? (isCarPark(city, bytes, i) ? 'carpark' : 'plaza') : city.blocks[i].kind;

/**
 * Build the edited city and everything the editor draws from it. generateCity
 * installs its district repaints for the whole game (districtOf), so this
 * puts back `gameMap`'s (the map the running game was built with) before it
 * returns: the game never sees the preview's districts.
 */
export function buildPreview(edits: MapEdits, inputs: PreviewInputs, gameMap: MapEdits): Preview {
  const t0 = performance.now();
  try {
    const city = generateCity(edits.seed, edits);
    const bytes = lotBytes(city);
    const kinds = city.blocks.map((_, i) => editKind(city, bytes, i));
    // The edited ramps (the dressing keeps clear of them) and the generated ones (where a moved ramp came from, and a turn's base).
    const ramps = placeCityRamps(edits.seed, edits);
    const rawRamps = placeCityRamps(edits.seed, NO_EDITS);
    // The pickups as the edits leave them (round 3: they move, go and come), else the game's own.
    const pickupEdits = edits.spots.some((sp) => sp.id.startsWith('pickup-'));
    const dressing = dressCity(city, pickupEdits ? placePickups(edits.seed, edits) : inputs.pickups, ramps);
    const street = dressing.street;
    const more = { busStops: street.busStops, vendors: street.vendors, hydrants: street.props.filter((p) => p.kind === 'hydrant') };
    // Placed where the edits put them (what the game plays and the checks read)...
    const anchors = collectAnchors(city, { ...more, ramps, edits });
    // ...and as generated, for where moved spots came from and removed ones stood.
    const { moved, removed } = applySpotEdits(collectAnchors(city, { ...more, ramps: rawRamps, edits: NO_EDITS }), edits);
    // Checked with the preview's districts and road rules installed (districtAt and the router read them).
    const problems = problemsFor(city, edits, anchors, street);
    const rules = new RoadRules(edits.roads, MAX_NODE);
    // Shop doors and road works (thousands; zoomed in only): listed apart from the spots.
    const extras: Anchor[] = [];
    const shops = shopSpots(city);
    collectRound3({ shops, roadworks: street.roadworks }, extras);
    // What the run-time scenes could pick on each block and road (with this city's districts and road rules installed).
    const hosts = sceneHosts(city, shops, more.hydrants);
    return { edits, city, kinds, props: propsOnMap(dressing, edits), anchors, moved, removed, rawRamps, ramps, problems, extras, hosts, ms: performance.now() - t0, rules };
  } finally {
    restoreGameMap(gameMap);
  }
}

/**
 * generateCity installs a map's district repaints and road rules for the
 * whole game: put back the running game's (`gameMap`, what it was built
 * with) so it never plays the editor's draft.
 */
export function restoreGameMap(gameMap: MapEdits): void {
  // Districts, road rules and (round 3) merged blocks, as generateCity installs them.
  installMap(gameMap);
}

/** The unedited city's blocks (kind and district), for telling an edit from a no-op. Restores `gameMap`'s districts. */
export function baseBlocks(seed: number, gameMap: MapEdits): BlockBase[] {
  try {
    const city = generateCity(seed, NO_EDITS);
    const bytes = lotBytes(city);
    return city.blocks.map((b, i) => ({ kind: editKind(city, bytes, i), district: b.district }));
  } finally {
    restoreGameMap(gameMap);
  }
}

/** Index into city.blocks of block (bx, bz) (city indices). */
export function blockIndex(city: City, bx: number, bz: number): number {
  return city.blocks.findIndex((b) => b.bx === bx && b.bz === bz);
}

/** Spot edits applied to the anchors: moved ones take their new place (and keep the old for the map), removed ones drop out. */
export function applySpotEdits(raw: readonly Anchor[], edits: MapEdits): { anchors: Anchor[]; moved: Map<string, { from: Point; to: Point }>; removed: Anchor[] } {
  const byId = new Map<string, SpotEdit>(edits.spots.map((s) => [s.id, s]));
  const anchors: Anchor[] = [];
  const moved = new Map<string, { from: Point; to: Point }>();
  const removed: Anchor[] = [];
  for (const a of raw) {
    const s = byId.get(a.id);
    if (!s) anchors.push(a);
    else if (s.removed) removed.push(a);
    else if (s.x !== undefined && s.z !== undefined && a.points.length === 1) {
      const to = { x: s.x, z: s.z };
      moved.set(a.id, { from: a.points[0], to });
      anchors.push({ ...a, points: [to] });
    } else anchors.push(a);
  }
  return { anchors, moved, removed };
}

/** The street props on the edited map: a removal leaves its generated prop as a ghost, an addition joins them. */
export function propsOnMap(dressing: Pick<Dressing, 'street'>, edits: MapEdits): PropRef[] {
  const removals = edits.props.filter((p) => p.removed);
  const out: PropRef[] = [];
  for (const p of dressing.street.props) {
    const gone = removals.some((r) => r.kind === p.kind && Math.abs(r.x - p.x) <= PROP_MATCH && Math.abs(r.z - p.z) <= PROP_MATCH);
    out.push({ kind: p.kind, x: p.x, z: p.z, heading: p.heading, origin: gone ? 'removed' : 'generated' });
  }
  for (const p of edits.props) {
    if (p.removed) continue;
    // Once the engine places added props in the dressing, they're already in the list.
    const placed = out.find((q) => q.origin === 'generated' && q.kind === p.kind && Math.abs(q.x - p.x) <= PROP_MATCH && Math.abs(q.z - p.z) <= PROP_MATCH);
    if (placed) placed.origin = 'added';
    else out.push({ kind: p.kind, x: p.x, z: p.z, heading: p.heading ?? 0, origin: 'added' });
  }
  return out;
}

// --- Seam 2: what an edit breaks ---

export interface EditorProblem {
  /** The anchor's id (or `prop:<key>`, `spot:<id>`). */
  id: string;
  label: string;
  problem: string;
  /** Where to draw it on the map. */
  points: readonly Point[];
  /** Roads to draw red (a course over a closed or one-way road). */
  segments?: ReadonlyArray<readonly [Node, Node]>;
}

/**
 * Everything wrong with the edited city: the engine's checkMapEdits (which
 * includes checkAnchors), with the roads to draw red on a course's
 * problems, plus two the engine leaves to the editor: a spot standing on a
 * closed road (a job's parked car, a payphone) and an added prop inside a
 * building. Call it with the city's district repaints and road rules
 * installed (buildPreview does).
 */
export function problemsFor(city: City, edits: MapEdits, anchors: readonly Anchor[], street?: StreetProps): EditorProblem[] {
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const roads = new Map<string, RoadEdit>(edits.roads.map((r) => [roadKey(r.a, r.b), r]));
  const closed = (a: Node, b: Node) => roads.get(roadKey(a, b))?.closed === true;
  /** Round 3: a pedestrian street or a removed road (no traffic either). */
  const gone = (a: Node, b: Node) => roads.get(roadKey(a, b))?.pedestrian === true || roads.get(roadKey(a, b))?.removed === true;
  const against = (a: Node, b: Node) => {
    const r = roads.get(roadKey(a, b));
    return r?.oneWay === true && r.a[0] === b[0] && r.a[1] === b[1];
  };
  /** A course's legs over closed roads or against one-ways (to draw red). */
  const badLegs = (a: Anchor | undefined): Array<[Node, Node]> => {
    const nodes = a?.route && roads.size > 0 ? routeNodes(a.route) : null;
    const out: Array<[Node, Node]> = [];
    if (nodes) for (let i = 1; i < nodes.length; i++) if (closed(nodes[i - 1], nodes[i]) || gone(nodes[i - 1], nodes[i]) || against(nodes[i - 1], nodes[i])) out.push([nodes[i - 1], nodes[i]]);
    return out;
  };
  const out: EditorProblem[] = checkMapEdits(city, edits, anchors, { street }).map((p) => {
    const a = byId.get(p.id);
    const legs = badLegs(a);
    return { id: p.id, label: p.label, problem: p.problem, points: p.at ? [p.at] : (a?.points ?? []), ...(legs.length ? { segments: legs } : {}) };
  });
  if (roads.size > 0) {
    for (const a of anchors) {
      for (const p of a.points) {
        const r = roadAt(p.x, p.z);
        if (r?.kind === 'segment' && closed(r.a, r.b)) out.push({ id: a.id, label: a.label, problem: 'stands on a closed road', points: [p], segments: [[r.a, r.b]] });
        if (r?.kind === 'segment' && roads.get(roadKey(r.a, r.b))?.pedestrian) out.push({ id: a.id, label: a.label, problem: 'stands on a pedestrian street (bollards keep traffic out)', points: [p], segments: [[r.a, r.b]] });
      }
    }
  }
  for (const p of edits.props) {
    if (p.removed) continue;
    if (city.buildings.some((b) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ)) {
      out.push({ id: `prop:${propKey(p)}`, label: `Added ${p.kind}`, problem: `inside a building at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`, points: [{ x: p.x, z: p.z }] });
    }
  }
  return out;
}

/** The (up to four) roads into crossing n, as neighbouring node pairs on the map. */
export function junctionRoads(n: Node): Array<[Node, Node]> {
  const out: Array<[Node, Node]> = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const m: Node = [n[0] + dx, n[1] + dz];
    if (Math.abs(m[0]) <= MAX_NODE && Math.abs(m[1]) <= MAX_NODE) out.push([n, m]);
  }
  return out;
}

export const nodePoint = (n: Node): Point => ({ x: n[0] * BLOCK_SIZE, z: n[1] * BLOCK_SIZE });

// --- Undo history ---

/** Undo / redo over MapEdits snapshots (the edits are immutable, so a snapshot is just the object). */
export class EditHistory {
  private past: MapEdits[] = [];
  private future: MapEdits[] = [];

  constructor(
    private now: MapEdits,
    private readonly limit = 200,
  ) {}

  get current(): MapEdits {
    return this.now;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Make `next` current (a no-op if it writes the same file); false if nothing changed. */
  apply(next: MapEdits): boolean {
    if (next === this.now || serializeMapEdits(next) === serializeMapEdits(this.now)) return false;
    this.past.push(this.now);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
    this.now = next;
    return true;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.now);
    this.now = prev;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.now);
    this.now = next;
    return true;
  }
}

// --- The view ---

/** The 2D view: centred on (cx, cz) world m, `scale` CSS px per m, over a width × height CSS px canvas (north up: +z down the screen). */
export interface MapView {
  cx: number;
  cz: number;
  scale: number;
  width: number;
  height: number;
}

export const SCALE_MIN = 0.25;
export const SCALE_MAX = 12;
/** Street props (as dots) from this zoom in, px per m. */
export const PROPS_FROM_SCALE = 1.6;
/** Street-level groups (hundreds of hydrants and carts) that draw and pick only from PROPS_FROM_SCALE, like the props. */
export const DETAIL_GROUPS: ReadonlySet<AnchorGroup> = new Set<AnchorGroup>(['hydrant', 'vendor', 'shop', 'roadworks']);

/** Is anchor `a` on the map at this zoom? Detail groups only zoomed in, unless `keep` holds them (a dependent, a problem, the selection). */
export function anchorShown(a: Anchor, scale: number, keep?: ReadonlySet<string>): boolean {
  return scale >= PROPS_FROM_SCALE || !DETAIL_GROUPS.has(a.group) || (keep?.has(a.id) ?? false);
}
/** Anchor labels from this zoom in, px per m. */
export const LABELS_FROM_SCALE = 2.2;

export function toScreen(v: MapView, x: number, z: number): { sx: number; sy: number } {
  return { sx: v.width / 2 + (x - v.cx) * v.scale, sy: v.height / 2 + (z - v.cz) * v.scale };
}

export function toWorld(v: MapView, sx: number, sy: number): Point {
  return { x: v.cx + (sx - v.width / 2) / v.scale, z: v.cz + (sy - v.height / 2) / v.scale };
}

/** Zoom by `factor` keeping the world point under (sx, sy) where it is. */
export function zoomAt(v: MapView, sx: number, sy: number, factor: number): void {
  const before = toWorld(v, sx, sy);
  v.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, v.scale * factor));
  const after = toWorld(v, sx, sy);
  v.cx += before.x - after.x;
  v.cz += before.z - after.z;
}

/** Drag the map by (dx, dy) px, keeping its centre within `extent` m of the origin. */
export function panBy(v: MapView, dx: number, dy: number, extent: number): void {
  v.cx = Math.max(-extent, Math.min(extent, v.cx - dx / v.scale));
  v.cz = Math.max(-extent, Math.min(extent, v.cz - dy / v.scale));
}

/** Fit a square of half-size `extent` m round the origin into the view. */
export function fitView(v: MapView, extent: number): void {
  v.cx = v.cz = 0;
  v.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.min(v.width, v.height) / (2 * extent)));
}

// --- Selection and hit-testing ---

export type Selection =
  | { kind: 'block'; bx: number; bz: number }
  | { kind: 'segment'; a: Node; b: Node }
  | { kind: 'junction'; ix: number; iz: number }
  | { kind: 'anchor'; id: string }
  | { kind: 'prop'; prop: PropRef };

/** A click lands on an anchor or prop this close, px. */
export const HIT_PX = 9;

/**
 * Everything at world point p, nearest first: anchors' icons (a spot the map
 * edits first), then (zoomed in) street props, then the road (junction or
 * segment) or the block under them. `scale` is the view's px per m (hits
 * are in screen px). Clicking again in the same place steps down this
 * list (nextPick), so stacked icons can all be reached.
 */
export function picksAt(p: Point, anchors: readonly Anchor[], props: readonly PropRef[], scale: number, rules?: RoadRules): Selection[] {
  const reach = HIT_PX / scale;
  const out: Selection[] = [];
  const near: Array<{ d: number; i: number; sel: Selection }> = [];
  anchors.forEach((a, i) => {
    // A spot the map can edit wins over a job's spot drawn on top of it (the safehouse's door has a job on it).
    const weight = spotRule(a.id).movable ? 0.25 : 1;
    let d = Infinity;
    for (const q of a.points) d = Math.min(d, ((q.x - p.x) ** 2 + (q.z - p.z) ** 2) * weight);
    if (d < reach * reach + 1e-9) near.push({ d, i, sel: { kind: 'anchor', id: a.id } });
  });
  // Ties go to the first listed: the safehouse before a job's spot at its door.
  near.sort((x, y) => x.d - y.d || x.i - y.i);
  out.push(...near.map((n) => n.sel));
  if (scale >= PROPS_FROM_SCALE) {
    const r2 = Math.min(reach, 2.5) ** 2;
    const hits = props.map((q) => ({ q, d: (q.x - p.x) ** 2 + (q.z - p.z) ** 2 })).filter((h) => h.d <= r2);
    hits.sort((x, y) => x.d - y.d);
    for (const h of hits) out.push({ kind: 'prop', prop: h.q });
  }
  const r = roadAt(p.x, p.z, rules);
  if (r?.kind === 'junction') out.push({ kind: 'junction', ix: r.ix, iz: r.iz });
  else if (r?.kind === 'segment') out.push({ kind: 'segment', a: r.a, b: r.b });
  else {
    const b = blockAt(p.x, p.z, rules);
    if (b) out.push({ kind: 'block', bx: b.bx, bz: b.bz });
  }
  return out;
}

/** What's at world point p: the top of picksAt's list. */
export function pickAt(p: Point, anchors: readonly Anchor[], props: readonly PropRef[], scale: number, rules?: RoadRules): Selection | null {
  return picksAt(p, anchors, props, scale, rules)[0] ?? null;
}

/** A click again where the last one landed: the next thing down the stack after `current` (round to the top), else the top. */
export function nextPick(stack: readonly Selection[], current: Selection | null): Selection | null {
  const i = current ? stack.findIndex((s) => sameSelection(s, current)) : -1;
  return stack.length === 0 ? null : stack[(i + 1) % stack.length];
}

/** The place a selection stands for in dependentsOf (blocks, roads and junctions; an anchor is not a place). */
export function selectionPick(sel: Selection | null): MapPick | null {
  if (!sel) return null;
  if (sel.kind === 'block') return { kind: 'block', bx: sel.bx, bz: sel.bz };
  if (sel.kind === 'segment') return { kind: 'segment', a: sel.a, b: sel.b };
  if (sel.kind === 'junction') return { kind: 'junction', ix: sel.ix, iz: sel.iz };
  return null;
}

/** Where an anchor stands, as a place (its first point's block, road or junction). */
export function anchorPlace(a: Anchor, rules?: RoadRules): MapPick | null {
  const p = a.points[0];
  if (!p) return null;
  const r = roadAt(p.x, p.z, rules);
  if (r) return r;
  const b = blockAt(p.x, p.z, rules);
  return b ? { kind: 'block', bx: b.bx, bz: b.bz } : null;
}

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (!a || !b || a.kind !== b.kind) return a === b;
  return selectionKey(a) === selectionKey(b);
}

export function selectionKey(s: Selection): string {
  switch (s.kind) {
    case 'block':
      return `block:${s.bx},${s.bz}`;
    case 'segment':
      return `road:${roadKey(s.a, s.b)}`;
    case 'junction':
      return `junction:${s.ix},${s.iz}`;
    case 'anchor':
      return `anchor:${s.id}`;
    default:
      return `prop:${propKey(s.prop)}`;
  }
}

// --- Tools: what each control writes ---

/** A block's core coordinates (what the file stores) from its city indices. */
export const coreAt = (bx: number, bz: number): readonly [number, number] => [bx - CORE_OFFSET, bz - CORE_OFFSET];

export function blockEditAt(edits: MapEdits, bx: number, bz: number): BlockEdit | undefined {
  const [cx, cz] = coreAt(bx, bz);
  return edits.blocks.find((e) => e.at[0] === cx && e.at[1] === cz);
}

/**
 * Change one block (fields set to undefined are cleared), merging with its
 * edit: a kind or district back to what the city generates, or a height of
 * 1, clears that field, so a block set back is no edit at all.
 */
export function editBlock(edits: MapEdits, bx: number, bz: number, patch: Partial<Omit<BlockEdit, 'at'>>, base: BlockBase): MapEdits {
  const old = blockEditAt(edits, bx, bz);
  const next: { -readonly [K in keyof Omit<BlockEdit, 'at'>]: BlockEdit[K] } = { kind: old?.kind, district: old?.district, style: old?.style, variant: old?.variant, height: old?.height };
  for (const k of Object.keys(patch) as Array<keyof typeof patch>) (next as Record<string, unknown>)[k] = patch[k];
  if (next.kind === base.kind) next.kind = undefined;
  if (next.district === base.district) next.district = undefined;
  // A style the block's own district already has is no style at all.
  if (next.style === (next.district ?? base.district)) next.style = undefined;
  if (next.height !== undefined) {
    next.height = Math.round(Math.min(HEIGHT_SCALE_MAX, Math.max(HEIGHT_SCALE_MIN, next.height)) * 100) / 100;
    if (Math.abs(next.height - 1) < 0.005) next.height = undefined;
  }
  const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as Omit<BlockEdit, 'at'>;
  return withBlockEdit(edits, coreAt(bx, bz), clean);
}

/** A new layout for the block's buildings or trees. */
export function rerollBlock(edits: MapEdits, bx: number, bz: number, base: BlockBase): MapEdits {
  const v = blockEditAt(edits, bx, bz)?.variant;
  return editBlock(edits, bx, bz, { variant: v === undefined ? 1 : v + 1 }, base);
}

export type RoadMode = 'open' | 'closed' | 'oneWay' | 'oneWayBack' | 'pedestrian' | 'removed';

/** The road's state in the edits: open, closed, or one-way (with `forward` true if traffic runs a → b as given). */
export function roadState(edits: MapEdits, a: Node, b: Node): { mode: 'open' | 'closed' | 'oneWay' | 'pedestrian' | 'removed'; from?: Node; to?: Node } {
  const r = edits.roads.find((e) => roadKey(e.a, e.b) === roadKey(a, b));
  if (!r) return { mode: 'open' };
  if (r.removed) return { mode: 'removed' };
  if (r.pedestrian) return { mode: 'pedestrian' };
  if (r.closed) return { mode: 'closed' };
  return { mode: 'oneWay', from: r.a, to: r.b };
}

/** Open, close, or make one-way (a → b, or `oneWayBack` b → a). */
export function setRoad(edits: MapEdits, a: Node, b: Node, mode: RoadMode): MapEdits {
  // Round 3: removing merges the blocks either side (refused: no change; removeRefusal says why); a removed road put back cuts its merge along the line.
  if (mode === 'removed') {
    const r = removeRoad(edits, a, b, MAX_NODE);
    return 'edits' in r ? r.edits : edits;
  }
  if (roadState(edits, a, b).mode === 'removed') return setRoad(restoreRoad(edits, a, b, MAX_NODE), a, b, mode);
  if (mode === 'pedestrian') return withPedestrianRoad(edits, a, b);
  if (mode === 'closed') return withRoadEdit(edits, a, b, { closed: true });
  if (mode === 'oneWay') return withRoadEdit(edits, a, b, { oneWay: true });
  if (mode === 'oneWayBack') return withRoadEdit(edits, b, a, { oneWay: true });
  return withRoadEdit(edits, a, b);
}

/** One-way the other way round (a two-way road is left alone). */
export function flipRoad(edits: MapEdits, a: Node, b: Node): MapEdits {
  const s = roadState(edits, a, b);
  return s.mode === 'oneWay' ? withRoadEdit(edits, s.to!, s.from!, { oneWay: true }) : edits;
}

/** Which way a road runs on the map, for its buttons: 'east', 'west', 'north' or 'south' going a → b. */
export function compass(a: Node, b: Node): 'east' | 'west' | 'north' | 'south' {
  if (b[0] > a[0]) return 'east';
  if (b[0] < a[0]) return 'west';
  return b[1] < a[1] ? 'north' : 'south';
}

function spotEditOf(edits: MapEdits, id: string): SpotEdit | undefined {
  return edits.spots.find((s) => s.id === id);
}

/** Move a spot to (x, z); back within 0.1 m of where it was generated clears the move (a turn stays). An added spot just moves. */
export function moveSpot(edits: MapEdits, id: string, x: number, z: number, generated: Point): MapEdits {
  const old = spotEditOf(edits, id);
  if (old?.add) return withAddedSpot(edits, id, { add: old.add, x, z, heading: old.heading, frenzy: old.frenzy, pickup: old.pickup });
  const home = Math.abs(x - generated.x) < 0.1 && Math.abs(z - generated.z) < 0.1;
  return withSpotEdit(edits, id, { ...(home ? {} : { x, z }), ...(old?.heading !== undefined ? { heading: old.heading } : {}) });
}

/** Turn a spot by `delta` radians from `base` (its generated heading) plus any turn already made; a full turn clears it. */
export function turnSpot(edits: MapEdits, id: string, delta: number, base: number): MapEdits {
  const old = spotEditOf(edits, id);
  let h = (old?.heading ?? base) + delta;
  h = Math.atan2(Math.sin(h), Math.cos(h));
  if (old?.add) return withAddedSpot(edits, id, { add: old.add, x: old.x!, z: old.z!, heading: h, frenzy: old.frenzy, pickup: old.pickup });
  const same = Math.abs(Math.atan2(Math.sin(h - base), Math.cos(h - base))) < 0.01;
  return withSpotEdit(edits, id, { ...(old?.x !== undefined ? { x: old.x, z: old.z } : {}), ...(same ? {} : { heading: h }) });
}

/** Remove a spot: a generated one is marked removed, an added one is dropped from the edits. */
export function removeSpot(edits: MapEdits, id: string): MapEdits {
  if (spotEditOf(edits, id)?.add) return withAddedSpot(edits, id);
  return spotRule(id).removable ? withSpotEdit(edits, id, { removed: true }) : edits;
}

/** Back where (and as) it was generated (an added spot has nowhere to go back to: it stays). */
export function resetSpot(edits: MapEdits, id: string): MapEdits {
  return spotEditOf(edits, id)?.add ? edits : withSpotEdit(edits, id);
}

/** Add a new spot of `kind` at (x, z) (a hangout for `gang`); returns the edits and the new spot's id. */
export function placeSpot(edits: MapEdits, kind: AddedSpotKind, x: number, z: number, gang?: string): { edits: MapEdits; id: string } {
  const id = newSpotId(edits, kind, gang);
  // Round 3: a new frenzy starts as a knock-down (the panel sets it); a pickup's kind comes from PLACE (`gang` carries it).
  const extra = kind === 'frenzy' ? { frenzy: { goal: 'knockdown' as const, ...FRENZY_DEFAULTS.knockdown } } : kind === 'pickup' ? { pickup: (PICKUP_ITEMS.includes(gang as PickupKind) ? gang : 'health') as PickupKind } : {};
  return { edits: withAddedSpot(edits, id, { add: kind, x, z, ...extra }), id };
}

export function spotEdited(edits: MapEdits, id: string): SpotEdit | undefined {
  return spotEditOf(edits, id);
}

/** Remove a prop: a generated one is marked removed, an added one is dropped from the edits. */
export function removeProp(edits: MapEdits, p: PropRef): MapEdits {
  if (p.origin === 'added') return withPropEdit(edits, { kind: p.kind, x: p.x, z: p.z }, true);
  if (p.origin === 'removed') return edits;
  return withPropEdit(edits, { kind: p.kind, x: p.x, z: p.z, removed: true });
}

/** Put a removed generated prop back. */
export function restoreProp(edits: MapEdits, p: PropRef): MapEdits {
  const r = edits.props.find((e) => e.removed && e.kind === p.kind && Math.abs(e.x - p.x) <= PROP_MATCH && Math.abs(e.z - p.z) <= PROP_MATCH);
  return r ? withPropEdit(edits, r, true) : edits;
}

export function placeProp(edits: MapEdits, kind: StreetPropKind, x: number, z: number, heading = 0): MapEdits {
  return withPropEdit(edits, { kind, x, z, ...(heading ? { heading } : {}) });
}

/** An added prop moved and / or turned. */
export function moveAddedProp(edits: MapEdits, p: PropRef, x: number, z: number, heading = p.heading): MapEdits {
  const without = withPropEdit(edits, { kind: p.kind, x: p.x, z: p.z }, true);
  const h = Math.round(Math.atan2(Math.sin(heading), Math.cos(heading)) * 100) / 100;
  return withPropEdit(without, { kind: p.kind, x, z, ...(h ? { heading: h } : {}) });
}

/** Street props the PLACE palette offers (kerb furniture; road works and carts are placed by their own rules). */
export const PLACEABLE_PROPS: readonly StreetPropKind[] = [
  'bench',
  'trash_bin',
  'recycling_bin',
  'bollard',
  'hydrant',
  'mailbox',
  'newspaper_box',
  'parking_meter',
  'bike_rack',
  'planter',
  'streetlamp',
  'tree_round',
  'tree_tall',
  'palm',
  'dumpster',
  'vending_machine',
  'atm',
  'bus_shelter',
  'traffic_cone',
  'traffic_barrel',
  'work_barrier',
];

// --- The overlay's geometry ---

/** The polyline a route draws (a course through every crossing it passes; a drive route through the crossings it steers for), world m. */
export function routeLine(a: Anchor): { points: Point[]; fixed: boolean } | null {
  if (a.route) {
    const nodes = routeNodes(a.route) ?? [...a.route];
    return { points: nodes.map(nodePoint), fixed: true };
  }
  if (a.via) return { points: [...a.via, a.via[0]].map(nodePoint), fixed: false };
  return null;
}

/** A road segment's ends, world m. */
export function segmentLine(a: Node, b: Node): [Point, Point] {
  return [nodePoint(a), nodePoint(b)];
}

/** Map icon letter and colour per anchor group. */
export const GROUP_STYLE: Readonly<Record<AnchorGroup, { letter: string; color: string; name: string }>> = {
  safehouse: { letter: 'H', color: '#ffd23f', name: 'Safehouse' },
  payphone: { letter: 'P', color: '#4fd8ff', name: 'Payphones' },
  frenzy: { letter: 'F', color: '#ff4fd8', name: 'Frenzy tokens' },
  docks: { letter: 'D', color: '#8fa8ff', name: 'Docks' },
  spray: { letter: 'S', color: '#5fe36a', name: "Pay 'n' Spray" },
  station: { letter: 'C', color: '#3b8bff', name: 'Police' },
  hospital: { letter: '+', color: '#ff6a6a', name: 'Hospital' },
  story: { letter: 'J', color: '#ffb13c', name: 'Story jobs' },
  hangout: { letter: 'G', color: '#c86bff', name: 'Gang hangouts' },
  race: { letter: 'R', color: '#2ee6ff', name: 'Races' },
  ramp: { letter: '/', color: '#e8e8e8', name: 'Ramps' },
  busStop: { letter: 'B', color: '#9aa3b5', name: 'Bus stops' },
  vendor: { letter: 'V', color: '#ff9f5a', name: 'Food carts' },
  hydrant: { letter: 'W', color: '#5aa8ff', name: 'Hydrants' },
  package: { letter: '?', color: '#6dff5a', name: 'Hidden packages' },
  test: { letter: 'T', color: '#b0b0b0', name: 'Test teleports' },
  pickup: { letter: 'I', color: '#ffe08a', name: 'Pickups' },
  shop: { letter: 'K', color: '#e07ab8', name: 'Shop doors' },
  roadworks: { letter: 'X', color: '#ff9a2e', name: 'Road works' },
};

// --- Wording ---

const nodeText = (n: Node) => `${n[0]},${n[1]}`;

/** One line for a change in the CHANGES list. */
export function describeChange(c: MapEditChange): string {
  const e = c.after ?? c.before;
  const back = c.after === undefined ? ' (back to generated)' : '';
  switch (c.section) {
    case 'blocks': {
      const b = e as BlockEdit;
      return `Block ${b.at[0]},${b.at[1]}: ${c.after ? describeBlock(c.after as BlockEdit) : 'as generated'}`;
    }
    case 'roads': {
      const r = e as RoadEdit;
      if (!c.after) return `Road ${nodeText(r.a)}–${nodeText(r.b)}: open${back}`;
      const a = c.after as RoadEdit;
      if (a.removed) return `Road ${nodeText(a.a)}–${nodeText(a.b)}: removed (blocks merged)`;
      if (a.pedestrian) return `Road ${nodeText(a.a)}–${nodeText(a.b)}: pedestrian street`;
      return a.closed ? `Road ${nodeText(a.a)}–${nodeText(a.b)}: closed` : `Road ${nodeText(a.a)}→${nodeText(a.b)}: one-way ${compass(a.a, a.b)}`;
    }
    case 'spots': {
      const s = (c.after ?? c.before) as SpotEdit;
      if (!c.after) return s.add ? `Spot ${s.id}: no longer added` : `Spot ${s.id}: back where generated`;
      const a = c.after as SpotEdit;
      if (a.removed) return `Spot ${a.id}: removed`;
      if (a.add === 'frenzy' && a.frenzy) return `Spot ${a.id}: frenzy added, ${frenzyTitle(a.frenzy.goal, a.frenzy.target)} in ${a.frenzy.seconds} s${a.frenzy.gift ? ` with a ${a.frenzy.gift}` : ''}`;
      if (a.add === 'pickup') return `Spot ${a.id}: ${a.pickup ?? 'pickup'} pickup added at ${a.x!.toFixed(0)}, ${a.z!.toFixed(0)}`;
      if (a.nodes || a.points) return `Spot ${a.id}: ${a.nodes ? 'crossings' : 'points'} moved`;
      if (a.add) return `Spot ${a.id}: ${a.add} added at ${a.x!.toFixed(0)}, ${a.z!.toFixed(0)}`;
      const bits = [a.x !== undefined ? `moved to ${a.x.toFixed(0)}, ${a.z!.toFixed(0)}` : '', a.heading !== undefined ? 'turned' : ''].filter(Boolean);
      return `Spot ${a.id}: ${bits.join(', ')}`;
    }
    case 'jobs': {
      const j = e as JobEdit;
      return c.after ? `Job ${j.id}: rings from ${j.phone}` : `Job ${j.id}: rings from its own phone${back}`;
    }
    case 'landmarks': {
      const l = e as LandmarkEdit;
      return c.after ? `Landmark ${l.id}: moved to block ${l.at[0]},${l.at[1]}` : `Landmark ${l.id}: where the city puts it${back}`;
    }
    default: {
      const p = e as PropEdit;
      const what = !c.after ? (p.removed ? 'put back' : 'no longer added') : (c.after as PropEdit).removed ? 'removed' : 'added';
      return `Prop ${p.kind.replace(/_/g, ' ')} at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}: ${what}`;
    }
  }
}

export function describeBlock(b: Omit<BlockEdit, 'at'>): string {
  const parts: string[] = [];
  if (b.kind) parts.push(b.kind === 'carpark' ? 'car park' : b.kind === 'lot' ? 'empty lot' : b.kind);
  if (b.district) parts.push(`district ${b.district}`);
  if (b.style) parts.push(`${b.style} style`);
  if (b.variant !== undefined) parts.push(`layout ${b.variant}`);
  if (b.height !== undefined) parts.push(`height ×${b.height}`);
  return parts.join(', ') || 'as generated';
}

// --- VIEW IN 3D ---

/** The `look=x,z` URL parameter VIEW IN 3D adds: the game boots into observe mode over it. */
export function lookParam(p: Point): string {
  return `${Math.round(p.x)},${Math.round(p.z)}`;
}

/** Where `?map=local&look=x,z` asks the camera to start, or null. */
export function editorLookAt(search: string): Point | null {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch {
    return null;
  }
  if (q.get('map') !== 'local') return null;
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(q.get('look') ?? '');
  if (!m) return null;
  const x = Number(m[1]);
  const z = Number(m[2]);
  return Math.abs(x) < 4096 && Math.abs(z) < 4096 ? { x, z } : null;
}

/** The centre of a selection, world m (what VIEW IN 3D looks at). */
export function selectionCentre(sel: Selection, anchors: readonly Anchor[]): Point | null {
  switch (sel.kind) {
    case 'block':
      return { x: -HALF_EXTENT + (sel.bx + 0.5) * BLOCK_SIZE, z: -HALF_EXTENT + (sel.bz + 0.5) * BLOCK_SIZE };
    case 'segment':
      return { x: ((sel.a[0] + sel.b[0]) / 2) * BLOCK_SIZE, z: ((sel.a[1] + sel.b[1]) / 2) * BLOCK_SIZE };
    case 'junction':
      return nodePoint([sel.ix, sel.iz]);
    case 'anchor': {
      const a = anchors.find((x) => x.id === sel.id);
      return a?.points[0] ?? null;
    }
    default:
      return { x: sel.prop.x, z: sel.prop.z };
  }
}

// --- Round 3: phones and jobs, frenzies, pickups, story spots, landmarks ---

/** Ring job `id` from `phone`; its own phone clears the edit. */
export function setJobPhone(edits: MapEdits, id: string, phone: string): MapEdits {
  const job = phoneJobs(NO_EDITS).find((j) => j.id === id);
  if (!job) return edits;
  return withJobPhone(edits, id, phone === job.written ? undefined : phone);
}

/** An added frenzy's goal, target, time or gift (`gift: null` takes it away); a new goal starts from its defaults. Clamped to the goal's limits. */
export function setFrenzy(edits: MapEdits, id: string, patch: { goal?: FrenzySpec['goal']; target?: number; seconds?: number; gift?: FrenzySpec['gift'] | null }): MapEdits {
  const old = spotEditOf(edits, id);
  if (old?.add !== 'frenzy') return edits;
  const was = old.frenzy ?? { goal: 'knockdown' as const, ...FRENZY_DEFAULTS.knockdown };
  const goal = patch.goal ?? was.goal;
  const base = goal !== was.goal ? { goal, ...FRENZY_DEFAULTS[goal], gift: was.gift } : was;
  const gift = patch.gift === null ? undefined : (patch.gift ?? base.gift);
  const frenzy: FrenzySpec = { goal, target: clampTarget(goal, patch.target ?? base.target), seconds: clampSeconds(goal, patch.seconds ?? base.seconds), ...(gift ? { gift } : {}) };
  return withAddedSpot(edits, id, { add: 'frenzy', x: old.x!, z: old.z!, heading: old.heading, frenzy });
}

/** An added pickup's kind. */
export function setPickupKind(edits: MapEdits, id: string, kind: PickupKind): MapEdits {
  const old = spotEditOf(edits, id);
  if (old?.add !== 'pickup' || !PICKUP_ITEMS.includes(kind)) return edits;
  return withAddedSpot(edits, id, { add: 'pickup', x: old.x!, z: old.z!, pickup: kind });
}

/** The crossing nearest world point p. */
export function nearestNode(p: Point): Node {
  const clamp = (v: number) => Math.max(-MAX_NODE, Math.min(MAX_NODE, v));
  return [clamp(Math.round(p.x / BLOCK_SIZE)), clamp(Math.round(p.z / BLOCK_SIZE))];
}

/**
 * The handles a story list spot drags by (world m): a drive route's
 * crossings, a race step's checkpoints, a collect step's points. Null for
 * anything else (a point drags as a whole).
 */
export function storyHandles(a: Anchor): Point[] | null {
  if (a.group !== 'story') return null;
  if (a.via) return a.via.map(nodePoint);
  if (a.route) return a.route.map(nodePoint);
  return a.points.length > 1 || a.id.endsWith('.points') ? [...a.points] : null;
}

/**
 * Handle `index` of story list spot `a` dragged to p: a crossing snaps to
 * the nearest one, a collect point goes where it's dropped. The list back
 * as written (`written`) clears the edit.
 */
export function moveStoryHandle(edits: MapEdits, a: Anchor, index: number, p: Point, written: ReadonlyArray<readonly [number, number]>): MapEdits {
  const crossings = a.via ?? a.route;
  const now: Array<readonly [number, number]> = crossings ? crossings.map((n) => [n[0], n[1]] as const) : a.points.map((q) => [q.x, q.z] as const);
  if (index < 0 || index >= now.length) return edits;
  now[index] = crossings ? nearestNode(p) : [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10];
  const same = now.length === written.length && now.every((q, i) => Math.abs(q[0] - written[i][0]) < 0.05 && Math.abs(q[1] - written[i][1]) < 0.05);
  if (same) return withStorySpotEdit(edits, a.id);
  return withStorySpotEdit(edits, a.id, crossings ? { nodes: now } : { points: now });
}

/** Move landmark `id` to core block `at`; back to `generated` (where the city puts it) clears the edit. */
export function moveLandmark(edits: MapEdits, id: LandmarkId, at: readonly [number, number], generated: readonly [number, number] | null): MapEdits {
  const home = generated !== null && generated[0] === at[0] && generated[1] === at[1];
  if (home && !landmarkEdit(edits, id)) return edits;
  return withLandmark(edits, id, home ? undefined : at);
}

/** Where the city puts each landmark with no landmark edits (core blocks), for a move back home. */
export function landmarkHomes(anchors: readonly Anchor[]): Map<LandmarkId, readonly [number, number]> {
  const out = new Map<LandmarkId, readonly [number, number]>();
  for (const a of anchors) if (a.landmark && !out.has(a.landmark)) out.set(a.landmark, anchorBlock(a)!);
  return out;
}

/**
 * The removed roads inside a merged block (`merge` in city blocks, as
 * Block.merge), west to east then north to south: what its panel offers
 * to PUT BACK (each one cuts the merge along its whole line, restoreRoad).
 */
export function roadsInsideMerge(edits: MapEdits, merge: { bx: number; bz: number; w: number; h: number }): Array<{ a: Node; b: Node }> {
  const x0 = -HALF_EXTENT + merge.bx * BLOCK_SIZE;
  const z0 = -HALF_EXTENT + merge.bz * BLOCK_SIZE;
  const x1 = x0 + merge.w * BLOCK_SIZE;
  const z1 = z0 + merge.h * BLOCK_SIZE;
  return edits.roads
    .filter((r) => {
      if (!r.removed) return false;
      const mx = ((r.a[0] + r.b[0]) / 2) * BLOCK_SIZE;
      const mz = ((r.a[1] + r.b[1]) / 2) * BLOCK_SIZE;
      return mx > x0 && mx < x1 && mz > z0 && mz < z1;
    })
    .map((r) => ({ a: r.a, b: r.b }));
}

/** Why REMOVE can't apply to road a–b (round 3: the outer ring road, or an L-shaped merge), or null if it can. */
export function removeRefusal(edits: MapEdits, a: Node, b: Node): string | null {
  const r = removeRoad(edits, a, b, MAX_NODE);
  return 'refused' in r ? r.refused : null;
}

/** The merged block (round 3) holding city block (bx, bz): its north-west block and size, or null. */
export function mergeOf(city: City, bx: number, bz: number): { bx: number; bz: number; w: number; h: number } | null {
  return city.blocks.find((b) => b.bx === bx && b.bz === bz)?.merge ?? null;
}

/**
 * A map file loaded into the editor (IMPORT, or a file dropped on it): its
 * edits as parseMapEdits reads them (anything it can't read is dropped,
 * with the reasons in `skipped`), or why it isn't a map file at all.
 */
export function importMapText(text: string): { edits: MapEdits; skipped: readonly string[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "it isn't JSON" };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !('version' in raw)) return { error: 'it has no "version": not a map file' };
  const version = (raw as { version: unknown }).version;
  if (version !== 1 && version !== MAP_EDITS_VERSION) return { error: `it's version ${JSON.stringify(version)}, and this game reads versions 1 and ${MAP_EDITS_VERSION}` };
  const { edits, problems } = parseMapEdits(raw);
  return { edits, skipped: problems };
}
