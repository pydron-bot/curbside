/**
 * Everything in the city that's tied to a place (W3-D): the dependency graph
 * the map editor's overlay draws. Each anchor is a hand-placed spot or route
 * (the safehouse, payphones, frenzy tokens, the docks yard, spray bays, the
 * station and hospital, every story job's spawns, targets and drive routes,
 * gang hangouts, race courses, and optionally ramps and bus stops), with what
 * it relies on worked out from where it stands: the block whose pavement or
 * lot it's on, the road segment or junction it's parked on or drives through.
 *
 * `dependentsOf` answers "what relies on this block / road / junction?"
 * (and `editsOn`, which map edits stand there); `checkAnchors` finds what
 * an edited city breaks (a spot inside a building, a job's district that no
 * longer holds its spot, a route off the roads) and `checkMapEdits` adds
 * what the roads, spots and props sections break. `spotRules` says which
 * spots the map file may move, turn or remove.
 * Pure: no three.js; the tests run the checks against the committed map.
 */
import { placeDocks, placeFrenzyTokens, placePayphones, placeSafehouse } from './modes/places';
import { RACES } from './modes/races';
import { GANGS, placeHangouts } from './gangs';
import { districtCentre, snapOnFoot } from './testSpots';
import { buildMissions } from '../systems/missionsData';
import type { MissionDef } from '../systems/missions';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, core, type City } from '../world/city';
import { DISTRICT_NAMES, districtAt, type District } from '../world/districts';
import { placeSprayShops, placeStation } from '../world/landmarks';
import { NO_EDITS, entryKey, propKey, roadKey, type MapEdits, type MapSection } from '../world/mapEdits';
import { placeCityRamps } from '../world/ramps';
import { RoadRules } from '../world/roadRules';
import { DIRS, DIR_VEC, MAX_NODE, reverse, turnToward, type Dir } from '../world/roads';
import { spotEdit } from '../world/spotEdits';
import { placeHospital } from '../world/streetSpots';
import { fixedStopLanes } from '../world/streetStops';
import type { PropEditProblem } from '../world/streetProps';

export type AnchorGroup =
  | 'safehouse'
  | 'payphone'
  | 'frenzy'
  | 'docks'
  | 'spray'
  | 'station'
  | 'hospital'
  | 'story'
  | 'hangout'
  | 'race'
  | 'ramp'
  | 'busStop'
  | 'vendor'
  | 'hydrant'
  | 'test';

type Point = { x: number; z: number };
export type Node = readonly [number, number];

export interface Anchor {
  /** Unique: the spot's own id where it has one, else group and index or the job's path to it. */
  id: string;
  group: AnchorGroup;
  /** For the overlay's list. */
  label: string;
  /** Where it stands (most have one; a collect step has several). */
  points: readonly Point[];
  /** Crossings it drives through in order, consecutive ones along one road (races, a job's drive route). */
  route?: readonly Node[];
  /** Crossings a job's car steers for in turn, round and round (traffic picks the roads between: missionMode's routeToward). */
  via?: readonly Node[];
  /** The district it's written for (a mayhem step's area): it must still be the district at its point. */
  district?: District;
  /** A bus stop's lane: the bus pulls in travelling `dir` toward crossing (ix, iz). */
  lane?: { ix: number; iz: number; dir: Dir };
  /** Moved by the map edits (a spot edit names it). */
  moved?: boolean;
}

/** Where on the map a pick (and so a dependency) is: block and crossing indices as the road grid numbers them. */
export type MapPick =
  | { kind: 'block'; bx: number; bz: number }
  | { kind: 'segment'; a: Node; b: Node }
  | { kind: 'junction'; ix: number; iz: number };

export interface AnchorInputs {
  /** Stunt ramps and kickers (world/ramps.ts placeCityRamps, with their ids), when the overlay should list them. */
  ramps?: ReadonlyArray<Point & { kind: string; id?: string }>;
  /** Bus stops (world/streetStops.ts, from dressCity), with their lanes. */
  busStops?: ReadonlyArray<Point & { ix?: number; iz?: number; dir?: Dir }>;
  /** Food carts and fruit stands (dressCity's street.vendors): the vendor scenes play at them. */
  vendors?: ReadonlyArray<Point & { kind: string }>;
  /** Hydrants (dressCity's street.props of kind 'hydrant'): any of them can burst. */
  hydrants?: readonly Point[];
  /** The map edits whose spots to place (default: the city's own). */
  edits?: MapEdits;
}

/** Everything tied to a place in `city`, where the map edits put it (removed spots aren't listed). */
export function collectAnchors(city: City, inputs: AnchorInputs = {}): Anchor[] {
  const edits = inputs.edits ?? city.edits ?? NO_EDITS;
  const out: Anchor[] = [];
  const spot = (id: string, group: AnchorGroup, label: string, p: Point) => {
    const a: Anchor = { id, group, label, points: [{ x: p.x, z: p.z }] };
    if (spotRules(id) && spotEdit(edits, id)) a.moved = true;
    out.push(a);
  };

  const safehouse = placeSafehouse(edits);
  spot('safehouse', 'safehouse', 'Safehouse', safehouse);
  for (const p of placePayphones(edits)) spot(p.id, 'payphone', `Payphone ${p.id.slice(6)}`, p);
  for (const p of placeFrenzyTokens(edits)) spot(p.id, 'frenzy', `Frenzy token ${p.id.slice(3)}`, p);
  const docks = placeDocks(city);
  spot('docks', 'docks', 'Docks yard', docks);
  for (const s of placeSprayShops(city)) spot(s.id, 'spray', "Pay 'n' Spray", s);
  spot('station', 'station', 'Police station', placeStation(city));
  const hospital = placeHospital(city);
  spot('hospital', 'hospital', 'Hospital doors', hospital);
  spot('hospital-bay', 'hospital', 'Ambulance bay', { x: hospital.bayX, z: hospital.bayZ });
  for (const h of placeHangouts(GANGS, edits)) spot(h.id, 'hangout', `${h.gang.name} hangout`, h);
  for (const r of RACES) out.push({ id: r.id, group: 'race', label: `Race: ${r.name}`, points: [nodePoint(r.nodes[0])], route: r.nodes });
  for (const m of buildMissions(docks, safehouse)) storyAnchors(m, out);
  inputs.ramps?.forEach((r, i) => spot(r.id ?? `ramp-${i}`, 'ramp', r.kind === 'kicker' ? 'Kicker' : 'Stunt ramp', r));
  inputs.busStops?.forEach((s, i) => {
    spot(`bus-${i}`, 'busStop', 'Bus stop', s);
    if (s.ix !== undefined && s.iz !== undefined && s.dir !== undefined) out[out.length - 1].lane = { ix: s.ix, iz: s.iz, dir: s.dir };
  });
  inputs.vendors?.forEach((v, i) => spot(`vendor-${i}`, 'vendor', v.kind === 'fruit_stand' ? 'Fruit stand' : 'Food cart', v));
  inputs.hydrants?.forEach((h, i) => spot(`hydrant-${i}`, 'hydrant', 'Hydrant', h));
  // The TEST menu's quick teleports: the safehouse, hospital and docks are listed above; the Neon Mile's is the middle of its blocks, snapped out to the pavement.
  const neon = districtCentre(city, 'arts');
  spot('test-neon', 'test', `TEST teleport: ${DISTRICT_NAMES.arts}`, snapOnFoot(neon.x, neon.z, () => true) ?? neon);
  return out;
}

const nodePoint = (n: Node): Point => ({ x: n[0] * BLOCK_SIZE, z: n[1] * BLOCK_SIZE });
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNodeList = (v: unknown): v is Node[] => Array.isArray(v) && v.length > 0 && v.every((n) => Array.isArray(n) && n.length === 2 && isNum(n[0]) && isNum(n[1]));

/**
 * A job's spots, found by walking its definition: anything with x and z (spawns,
 * targets, scene actions, mayhem areas), drive routes and race steps (crossings)
 * and collect steps (points). Walking rather than listing means a new job's
 * spots join the overlay with no change here.
 */
function storyAnchors(m: MissionDef, out: Anchor[]): void {
  const walk = (v: unknown, path: string, key: string) => {
    if (Array.isArray(v)) return v.forEach((c, i) => walk(c, `${path}.${i}`, key));
    if (typeof v !== 'object' || v === null) return;
    const o = v as Record<string, unknown>;
    const what = String(o.tag ?? o.do ?? o.kind ?? key);
    if (isNum(o.x) && isNum(o.z)) {
      const a: Anchor = { id: `story:${m.id}/${path}`, group: 'story', label: `${m.title}: ${what}`, points: [{ x: o.x, z: o.z }] };
      if (typeof o.district === 'string') a.district = o.district as District;
      out.push(a);
    }
    if (isNodeList(o.route)) {
      out.push({ id: `story:${m.id}/${path}.route`, group: 'story', label: `${m.title}: ${what} route`, points: [nodePoint(o.route[0])], via: o.route });
    }
    if (o.kind === 'race' && isNodeList(o.nodes)) {
      out.push({ id: `story:${m.id}/${path}.nodes`, group: 'story', label: `${m.title}: race`, points: [nodePoint(o.nodes[0])], route: o.nodes });
    }
    if (o.kind === 'collect' && isNodeList(o.points)) {
      out.push({ id: `story:${m.id}/${path}.points`, group: 'story', label: `${m.title}: collect`, points: o.points.map(([x, z]) => ({ x, z })) });
    }
    for (const [k, c] of Object.entries(o)) {
      if (k === 'intro' || k === 'outro' || k === 'route' || k === 'nodes' || k === 'points') continue;
      walk(c, `${path}.${k}`, k);
    }
  };
  walk(m.steps, 'steps', 'step');
}

// --- Where a point is ---

/** Half the carriageway: a point this close to a road's centreline is on the road. */
const ROAD_HALF = ROAD_WIDTH / 2;

/** The block (indices as city.blocks number them) whose pavement or lot holds (x, z); null on a road or off the map. */
export function blockAt(x: number, z: number): { bx: number; bz: number } | null {
  const bx = Math.floor((x + HALF_EXTENT) / BLOCK_SIZE);
  const bz = Math.floor((z + HALF_EXTENT) / BLOCK_SIZE);
  if (bx < 0 || bz < 0 || bx >= BLOCKS_PER_SIDE || bz >= BLOCKS_PER_SIDE) return null;
  const lx = x + HALF_EXTENT - bx * BLOCK_SIZE;
  const lz = z + HALF_EXTENT - bz * BLOCK_SIZE;
  if (lx < ROAD_HALF || lz < ROAD_HALF || lx > BLOCK_SIZE - ROAD_HALF || lz > BLOCK_SIZE - ROAD_HALF) return null;
  return { bx, bz };
}

/** The block districtAt reads for (x, z) (a road goes with the block to its south-east): a district claim relies on it. */
export function districtBlockAt(x: number, z: number): { bx: number; bz: number } {
  const clamp = (v: number) => Math.max(0, Math.min(BLOCKS_PER_SIDE - 1, v));
  return { bx: clamp(Math.floor((x + HALF_EXTENT) / BLOCK_SIZE)), bz: clamp(Math.floor((z + HALF_EXTENT) / BLOCK_SIZE)) };
}

/** The road (x, z) is on: a junction's box, a segment between two crossings, or null off the carriageway. */
export function roadAt(x: number, z: number): MapPick | null {
  const ix = Math.round(x / BLOCK_SIZE);
  const iz = Math.round(z / BLOCK_SIZE);
  const onNS = Math.abs(x - ix * BLOCK_SIZE) <= ROAD_HALF && Math.abs(ix) <= MAX_NODE;
  const onEW = Math.abs(z - iz * BLOCK_SIZE) <= ROAD_HALF && Math.abs(iz) <= MAX_NODE;
  if (onNS && onEW) return { kind: 'junction', ix, iz };
  if (onNS) {
    const z0 = Math.floor(z / BLOCK_SIZE);
    return Math.abs(z0) <= MAX_NODE && Math.abs(z0 + 1) <= MAX_NODE ? { kind: 'segment', a: [ix, z0], b: [ix, z0 + 1] } : null;
  }
  if (onEW) {
    const x0 = Math.floor(x / BLOCK_SIZE);
    return Math.abs(x0) <= MAX_NODE && Math.abs(x0 + 1) <= MAX_NODE ? { kind: 'segment', a: [x0, iz], b: [x0 + 1, iz] } : null;
  }
  return null;
}

/** Every crossing a route passes, one block at a time (null if a leg isn't along one road). */
export function routeNodes(route: readonly Node[]): Node[] | null {
  const out: Node[] = [route[0]];
  for (let i = 1; i < route.length; i++) {
    const [ax, az] = route[i - 1];
    const [bx, bz] = route[i];
    if (ax !== bx && az !== bz) return null;
    const steps = Math.abs(bx - ax) + Math.abs(bz - az);
    for (let s = 1; s <= steps; s++) out.push([ax + Math.sign(bx - ax) * s, az + Math.sign(bz - az) * s]);
  }
  return out;
}

const sameSegment = (a1: Node, b1: Node, a2: Node, b2: Node) =>
  (a1[0] === a2[0] && a1[1] === a2[1] && b1[0] === b2[0] && b1[1] === b2[1]) || (a1[0] === b2[0] && a1[1] === b2[1] && b1[0] === a2[0] && b1[1] === a2[1]);

function pointOn(p: Point, pick: MapPick): boolean {
  if (pick.kind === 'block') {
    const b = blockAt(p.x, p.z);
    return b !== null && b.bx === pick.bx && b.bz === pick.bz;
  }
  const r = roadAt(p.x, p.z);
  if (!r) return false;
  if (pick.kind === 'junction') return r.kind === 'junction' && r.ix === pick.ix && r.iz === pick.iz;
  return r.kind === 'segment' && sameSegment(r.a, r.b, pick.a, pick.b);
}

function routeUses(a: Anchor, pick: MapPick): boolean {
  if (pick.kind === 'junction' && a.via?.some(([x, z]) => x === pick.ix && z === pick.iz)) return true;
  if (!a.route || pick.kind === 'block') return false;
  const nodes = routeNodes(a.route);
  if (!nodes) return false;
  if (pick.kind === 'junction') return nodes.some(([x, z]) => x === pick.ix && z === pick.iz);
  for (let i = 1; i < nodes.length; i++) if (sameSegment(nodes[i - 1], nodes[i], pick.a, pick.b)) return true;
  return false;
}

/** Does `a` rely on the picked block, road segment or junction? */
export function dependsOn(a: Anchor, pick: MapPick): boolean {
  if (a.points.some((p) => pointOn(p, pick)) || routeUses(a, pick)) return true;
  if (!a.district || pick.kind !== 'block' || a.points.length === 0) return false;
  const d = districtBlockAt(a.points[0].x, a.points[0].z);
  return d.bx === pick.bx && d.bz === pick.bz;
}

/** Everything that relies on the pick: what the overlay draws and lists. */
export function dependentsOf(anchors: readonly Anchor[], pick: MapPick): Anchor[] {
  return anchors.filter((a) => dependsOn(a, pick));
}

// --- What an edit breaks ---

export interface AnchorProblem {
  id: string;
  label: string;
  problem: string;
}

/** What's broken in `city` for these anchors (none for the shipped city; the tests check the committed map). */
export function checkAnchors(city: City, anchors: readonly Anchor[]): AnchorProblem[] {
  const out: AnchorProblem[] = [];
  const flag = (a: Anchor, problem: string) => out.push({ id: a.id, label: a.label, problem });
  const seen = new Set<string>();
  const limit = HALF_EXTENT + ROAD_HALF;
  for (const a of anchors) {
    if (seen.has(a.id)) flag(a, 'id used twice');
    seen.add(a.id);
    for (const p of a.points) {
      if (Math.abs(p.x) > limit || Math.abs(p.z) > limit) flag(a, `off the map at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      else if (city.buildings.some((b) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ)) {
        flag(a, `inside a building at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      }
    }
    if (a.district && a.points.length > 0) {
      const d = districtAt(a.points[0].x, a.points[0].z);
      if (d !== a.district) flag(a, `written for ${a.district}, but its spot is in ${d}`);
    }
    if (a.route) {
      const nodes = routeNodes(a.route);
      if (!nodes) flag(a, 'a leg of its route turns off the road');
      else if (nodes.some(([x, z]) => Math.abs(x) > MAX_NODE || Math.abs(z) > MAX_NODE)) flag(a, 'its route leaves the map');
    }
    if (a.via?.some(([x, z]) => Math.abs(x) > MAX_NODE || Math.abs(z) > MAX_NODE)) flag(a, 'its route heads for a crossing off the map');
  }
  return out;
}

// --- Spots the map edits may move or remove ---

export interface SpotRule {
  group: AnchorGroup;
  label: string;
  /** The editor may drag it (a spot edit's x, z). */
  movable: boolean;
  /** The editor may delete it (a spot edit's `removed`). */
  removable: boolean;
  /** It has a facing to turn (a spot edit's heading; ramps, to the nearest quarter). */
  turnable: boolean;
  /** Why it can't be removed, for the editor's tooltip. */
  why?: string;
}

/**
 * The spot section's rules, by anchor id: the safehouse, payphones and
 * frenzy tokens move but stay (the shop and three jobs' drop-offs are the
 * safehouse, jobs ring the payphones, the frenzies count toward 100%);
 * gang hangouts and ramps move or go (checkMapEdits minds a gang left with
 * no hangout). Null: not a spot the map file edits.
 */
export function spotRules(id: string, seed = 1337): SpotRule | null {
  const ids = spotIds(seed);
  const group = ids.get(id);
  if (!group) return null;
  switch (group) {
    case 'safehouse':
      return { group, label: 'Safehouse', movable: true, removable: false, turnable: false, why: 'the shop, and jobs drop off at it' };
    case 'payphone':
      return { group, label: `Payphone ${id.slice(6)}`, movable: true, removable: false, turnable: false, why: 'story jobs ring it' };
    case 'frenzy':
      return { group, label: `Frenzy token ${id.slice(3)}`, movable: true, removable: false, turnable: false, why: 'its frenzy counts toward 100%' };
    case 'hangout':
      return { group, label: `${GANGS.find((g) => id.startsWith(`${g.id}-`))?.name ?? 'Gang'} hangout`, movable: true, removable: true, turnable: false };
    default:
      return { group, label: 'Ramp', movable: true, removable: true, turnable: true };
  }
}

const idsBySeed = new Map<number, ReadonlyMap<string, AnchorGroup>>();
/** Every editable spot's id as generated (whatever the edits), and its group. */
function spotIds(seed: number): ReadonlyMap<string, AnchorGroup> {
  let m = idsBySeed.get(seed);
  if (m) return m;
  const ids = new Map<string, AnchorGroup>([['safehouse', 'safehouse']]);
  for (const p of placePayphones(NO_EDITS)) ids.set(p.id, 'payphone');
  for (const p of placeFrenzyTokens(NO_EDITS)) ids.set(p.id, 'frenzy');
  for (const h of placeHangouts(GANGS, NO_EDITS)) ids.set(h.id, 'hangout');
  for (const r of placeCityRamps(seed, NO_EDITS)) ids.set(r.id!, 'ramp');
  idsBySeed.set(seed, (m = ids));
  return m;
}

// --- Edits on a pick ---

export interface EditRef {
  section: MapSection;
  /** entryKey of the edit. */
  key: string;
  label: string;
}

/** The map edits standing on the pick (a road edit on its segment or at its junction, a moved spot or an edited prop on it): the overlay lists them with the dependents. */
export function editsOn(edits: MapEdits, pick: MapPick): EditRef[] {
  const out: EditRef[] = [];
  if (pick.kind === 'block') {
    for (const b of edits.blocks) {
      if (core(b.at[0]) === pick.bx && core(b.at[1]) === pick.bz) out.push({ section: 'blocks', key: entryKey('blocks', b), label: 'Block edit' });
    }
  }
  for (const r of edits.roads) {
    const on = pick.kind === 'segment' ? sameSegment(r.a, r.b, pick.a, pick.b) : pick.kind === 'junction' && [r.a, r.b].some(([x, z]) => x === pick.ix && z === pick.iz);
    if (on) out.push({ section: 'roads', key: roadKey(r.a, r.b), label: r.closed ? 'Road closed' : 'One-way' });
  }
  for (const s of edits.spots) {
    if (s.x !== undefined && s.z !== undefined && pointOn({ x: s.x, z: s.z }, pick)) out.push({ section: 'spots', key: s.id, label: `${spotRules(s.id, edits.seed)?.label ?? s.id} moved here` });
  }
  for (const p of edits.props) {
    if (pointOn(p, pick)) out.push({ section: 'props', key: propKey(p), label: `${p.kind.replace(/_/g, ' ')} ${p.removed ? 'removed' : 'added'}` });
  }
  return out;
}

// --- What the map edits break ---

/** A check's finding: what (the anchor's or the edit's id), where, and the edit at fault when there's one (the editor turns it red). */
export interface MapProblem extends AnchorProblem {
  /** The edit to blame (section and entryKey), when one is. */
  edit?: { section: MapSection; key: string };
  /** Where to show it. */
  at?: Point;
}

export interface MapCheckInputs {
  /** dressCity's street props (`propEditProblems`: removals that matched nothing); without it, prop removals go unchecked. */
  street?: { propEditProblems: readonly PropEditProblem[] };
}

/**
 * Everything the edits break (empty for the committed map: tested): the
 * anchors' own checks (checkAnchors: spots inside buildings or off the map,
 * districts, routes), then the roads (a course over a closed road or the
 * wrong way down a one-way; a job's drive route that can't get round; a
 * bus stop the buses can't reach; crossings cut off from the rest), the
 * spots (an unknown id, a removal the game can't do without, a spot moved
 * into the road or a ramp off it, a gang left with no hangout) and the
 * props (a kind that can't be edited, a removal that matches nothing).
 * `anchors` must be collectAnchors' for this city and these edits.
 */
export function checkMapEdits(city: City, edits: MapEdits, anchors: readonly Anchor[], inputs: MapCheckInputs = {}): MapProblem[] {
  const out: MapProblem[] = [];
  const rules = new RoadRules(edits.roads);
  const leave = (ix: number, iz: number, d: Dir) => {
    const v = DIR_VEC[d];
    return Math.abs(ix + v.x) <= MAX_NODE && Math.abs(iz + v.z) <= MAX_NODE && rules.allows(ix, iz, d);
  };
  const n = (p: Node) => `${p[0]}, ${p[1]}`;

  for (const p of checkAnchors(city, anchors)) {
    const a = anchors.find((x) => x.id === p.id);
    out.push(a?.moved ? { ...p, edit: { section: 'spots', key: p.id }, at: a.points[0] } : { ...p, at: a?.points[0] });
  }

  // Roads: on the map, and what the closures and one-ways cut.
  for (const r of edits.roads) {
    if ([r.a, r.b].some(([x, z]) => Math.abs(x) > MAX_NODE || Math.abs(z) > MAX_NODE)) {
      out.push({ id: `road:${roadKey(r.a, r.b)}`, label: 'Road edit', problem: `crossing ${n(r.a)} or ${n(r.b)} is off the map`, edit: { section: 'roads', key: roadKey(r.a, r.b) } });
    }
  }
  if (!rules.empty) {
    const roadEdit = (a: Node, b: Node) => ({ section: 'roads' as const, key: roadKey(a, b) });
    for (const a of anchors) {
      if (a.route) {
        const nodes = routeNodes(a.route);
        for (let i = 1; nodes && i < nodes.length; i++) {
          const [p, q] = [nodes[i - 1], nodes[i]];
          const d = dirOf(p, q);
          if (rules.isClosed(p[0], p[1], q[0], q[1])) out.push({ id: a.id, label: a.label, problem: `its course runs down the closed road ${n(p)} – ${n(q)}`, edit: roadEdit(p, q), at: mid(p, q) });
          else if (!rules.allows(p[0], p[1], d)) out.push({ id: a.id, label: a.label, problem: `its course runs the wrong way down the one-way ${n(p)} – ${n(q)}`, edit: roadEdit(p, q), at: mid(p, q) });
        }
      }
      if (a.via && a.via.length > 1) {
        const broken = viaProblem(a.via, leave);
        if (broken) out.push({ id: a.id, label: a.label, problem: broken.problem, at: nodePoint(broken.from) });
      }
    }
    const net = network(leave);
    for (const a of anchors) {
      if (!a.lane) continue;
      const { ix, iz, dir } = a.lane;
      const v = DIR_VEC[dir];
      const from: Node = [ix - v.x, iz - v.z];
      if (!leave(from[0], from[1], dir)) {
        out.push({ id: a.id, label: a.label, problem: rules.isClosed(from[0], from[1], ix, iz) ? 'its road is closed: no bus comes' : 'its lane runs against the one-way: no bus comes', edit: roadEdit(from, [ix, iz]), at: a.points[0] });
      } else if (!net.main.has(nodeKey(from[0], from[1]))) out.push({ id: a.id, label: a.label, problem: `buses can't get to it (crossing ${n(from)} is cut off)`, at: a.points[0] });
    }
    for (const s of fixedStopLanes(city)) {
      if (!leave(s.fromX, s.fromZ, s.dir)) out.push({ id: 'bus-pike', label: "Pike's bus stop", problem: 'its lane is closed or runs against a one-way, so the shelter goes (his job is at it)', edit: roadEdit([s.fromX, s.fromZ], [s.ix, s.iz]), at: s });
    }
    if (net.cut.length > 0) {
      const list = (ns: readonly Node[]) => ns.slice(0, 6).map((p) => `(${n(p)})`).join(', ') + (ns.length > 6 ? ` and ${ns.length - 6} more` : '');
      const stuck = net.cut.filter((p) => net.reach.has(nodeKey(p[0], p[1])));
      const shut = net.cut.filter((p) => !net.reach.has(nodeKey(p[0], p[1])));
      if (stuck.length) out.push({ id: 'roads', label: 'Road network', problem: `traffic that gets to ${list(stuck)} can't get back`, at: nodePoint(stuck[0]) });
      if (shut.length) out.push({ id: 'roads', label: 'Road network', problem: `traffic can't get to ${list(shut)}`, at: nodePoint(shut[0]) });
    }
  }

  // Spots.
  const ids = new Set(anchors.map((a) => a.id));
  for (const e of edits.spots) {
    const rule = spotRules(e.id, edits.seed);
    const edit = { section: 'spots' as const, key: e.id };
    if (!rule) {
      out.push({ id: e.id, label: e.id, problem: ids.has(e.id) ? "isn't a spot the map file moves or removes" : `no spot has the id "${e.id}"`, edit });
      continue;
    }
    if (e.removed && !rule.removable) out.push({ id: e.id, label: rule.label, problem: `can't be removed (${rule.why})`, edit });
    if (e.heading !== undefined && !rule.turnable) out.push({ id: e.id, label: rule.label, problem: 'has no facing to turn', edit });
    if (e.x === undefined || e.z === undefined) continue;
    const at = { x: e.x, z: e.z };
    const road = roadAt(e.x, e.z);
    if (rule.group === 'ramp' && !road) out.push({ id: e.id, label: rule.label, problem: 'a ramp must stand on a road', edit, at });
    else if (rule.group !== 'ramp' && road) out.push({ id: e.id, label: rule.label, problem: `stands in the road at ${e.x.toFixed(1)}, ${e.z.toFixed(1)} (it belongs on a pavement)`, edit, at });
  }
  for (const g of GANGS) {
    if (g.hangouts.length > 0 && !anchors.some((a) => a.group === 'hangout' && a.id.startsWith(`${g.id}-`))) {
      out.push({ id: g.id, label: `${g.name} hangouts`, problem: 'every hangout is removed: the gang never shows up', edit: { section: 'spots', key: `${g.id}-0` } });
    }
  }

  // Props.
  for (const p of inputs.street?.propEditProblems ?? []) {
    out.push({ id: `prop:${propKey(p.edit)}`, label: `Prop ${p.edit.kind.replace(/_/g, ' ')}`, problem: p.problem, edit: { section: 'props', key: propKey(p.edit) }, at: { x: p.edit.x, z: p.edit.z } });
  }
  return out;
}

const nodeKey = (ix: number, iz: number) => (ix + 1024) * 2048 + iz + 1024;
const mid = (p: Node, q: Node): Point => ({ x: ((p[0] + q[0]) / 2) * BLOCK_SIZE, z: ((p[1] + q[1]) / 2) * BLOCK_SIZE });
const dirOf = (p: Node, q: Node): Dir => (q[0] > p[0] ? 1 : q[0] < p[0] ? 3 : q[1] > p[1] ? 2 : 0);

/**
 * The crossings and which are cut off: `main` is the biggest set where
 * traffic can get from any one to any other, `reach` what traffic leaving
 * it can get to, `cut` every crossing outside it.
 */
function network(leave: (ix: number, iz: number, d: Dir) => boolean): { main: Set<number>; reach: Set<number>; cut: Node[] } {
  const all: Node[] = [];
  for (let ix = -MAX_NODE; ix <= MAX_NODE; ix++) for (let iz = -MAX_NODE; iz <= MAX_NODE; iz++) all.push([ix, iz]);
  const walk = (start: Node, back: boolean): Set<number> => {
    const seen = new Set<number>([nodeKey(start[0], start[1])]);
    const todo: Node[] = [start];
    while (todo.length) {
      const [x, z] = todo.pop()!;
      for (const d of DIRS) {
        const v = DIR_VEC[d];
        const [nx, nz] = [x + v.x, z + v.z];
        // Forward: may traffic leave here toward it; back: may it come from there to here.
        if (!(back ? Math.abs(nx) <= MAX_NODE && Math.abs(nz) <= MAX_NODE && leave(nx, nz, reverse(d)) : leave(x, z, d))) continue;
        const k = nodeKey(nx, nz);
        if (seen.has(k)) continue;
        seen.add(k);
        todo.push([nx, nz]);
      }
    }
    return seen;
  };
  // Grow the main part from the crossing whose part is biggest (the centre's, unless the map cut it off).
  let best = { main: new Set<number>(), reach: new Set<number>() };
  const tried = new Set<number>();
  for (const s of all) {
    if (tried.has(nodeKey(s[0], s[1]))) continue;
    const fwd = walk(s, false);
    const bwd = walk(s, true);
    const main = new Set([...fwd].filter((k) => bwd.has(k)));
    for (const k of main) tried.add(k);
    if (main.size > best.main.size) best = { main, reach: fwd };
    if (best.main.size * 2 > all.length) break;
  }
  return { ...best, cut: all.filter(([x, z]) => !best.main.has(nodeKey(x, z))) };
}

/**
 * Can a job's car drive its route round and round? First whether each leg
 * can be driven at all, then the way the game steers (turnToward at each
 * crossing, never a U-turn but at a dead end), which can circle a closure
 * it never finds the way round.
 */
function viaProblem(via: readonly Node[], leave: (ix: number, iz: number, d: Dir) => boolean): { problem: string; from: Node } | null {
  const legs = via.length;
  for (let i = 0; i < legs; i++) {
    const a = via[i];
    const b = via[(i + 1) % legs];
    if (!reachable(a, b, leave)) return { problem: `its car can't get from ${a[0]}, ${a[1]} to ${b[0]}, ${b[1]} (closures or one-ways cut it off)`, from: a };
  }
  // Arriving at the first crossing any legal way, twice round.
  const start = via[0];
  const arrive = DIRS.find((d) => {
    const v = DIR_VEC[d];
    return Math.abs(start[0] - v.x) <= MAX_NODE && Math.abs(start[1] - v.z) <= MAX_NODE && leave(start[0] - v.x, start[1] - v.z, d);
  });
  if (arrive === undefined) return null;
  let [x, z] = start;
  let dir: Dir = arrive;
  for (let lap = 0; lap < 2 * legs; lap++) {
    const b = via[(lap + 1) % legs];
    const budget = 4 * (Math.abs(b[0] - x) + Math.abs(b[1] - z)) + 24;
    let steps = 0;
    while ((x !== b[0] || z !== b[1]) && steps++ < budget) {
      dir = turnToward(x, z, dir, b[0] * BLOCK_SIZE, b[1] * BLOCK_SIZE, leave);
      x += DIR_VEC[dir].x;
      z += DIR_VEC[dir].z;
    }
    if (x !== b[0] || z !== b[1]) {
      const a = via[lap % legs];
      return { problem: `its car circles without finding its way from ${a[0]}, ${a[1]} to ${b[0]}, ${b[1]} (a closure or one-way it can't see round)`, from: a };
    }
  }
  return null;
}

/** Can traffic get from crossing a to b? */
function reachable(a: Node, b: Node, leave: (ix: number, iz: number, d: Dir) => boolean): boolean {
  const seen = new Set<number>([nodeKey(a[0], a[1])]);
  const todo: Node[] = [a];
  while (todo.length) {
    const [x, z] = todo.pop()!;
    if (x === b[0] && z === b[1]) return true;
    for (const d of DIRS) {
      if (!leave(x, z, d)) continue;
      const next: Node = [x + DIR_VEC[d].x, z + DIR_VEC[d].z];
      const k = nodeKey(next[0], next[1]);
      if (seen.has(k)) continue;
      seen.add(k);
      todo.push(next);
    }
  }
  return false;
}
