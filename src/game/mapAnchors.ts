/**
 * Everything in the city that's tied to a place (W3-D): the dependency graph
 * the map editor's overlay draws. Each anchor is a hand-placed spot or route
 * (the safehouse, payphones, frenzy tokens, the docks yard, spray bays, the
 * station and hospital, every story job's spawns, targets and drive routes,
 * gang hangouts, race courses, and optionally ramps and bus stops), with what
 * it relies on worked out from where it stands: the block whose pavement or
 * lot it's on, the road segment or junction it's parked on or drives through.
 *
 * `dependentsOf` answers "what relies on this block / road / junction?";
 * `checkAnchors` finds what an edited city breaks (a spot inside a building,
 * a job's district that no longer holds its spot, a route off the roads).
 * Pure: no three.js; the tests run the checks against the committed map.
 */
import { SAFEHOUSE, placeDocks, placeFrenzyTokens, placePayphones } from './modes/places';
import { RACES } from './modes/races';
import { placeHangouts } from './gangs';
import { buildMissions } from '../systems/missionsData';
import type { MissionDef } from '../systems/missions';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, type City } from '../world/city';
import { districtAt, type District } from '../world/districts';
import { placeSprayShops, placeStation } from '../world/landmarks';
import { placeHospital } from '../world/streetSpots';
import { MAX_NODE } from '../world/roads';

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
  | 'busStop';

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
}

/** Where on the map a pick (and so a dependency) is: block and crossing indices as the road grid numbers them. */
export type MapPick =
  | { kind: 'block'; bx: number; bz: number }
  | { kind: 'segment'; a: Node; b: Node }
  | { kind: 'junction'; ix: number; iz: number };

export interface AnchorInputs {
  /** Stunt ramps and kickers (world/ramps.ts), when the overlay should list them. */
  ramps?: ReadonlyArray<Point & { kind: string }>;
  /** Bus stops (world/streetStops.ts, from dressCity). */
  busStops?: readonly Point[];
}

/** Everything tied to a place in `city`. */
export function collectAnchors(city: City, inputs: AnchorInputs = {}): Anchor[] {
  const out: Anchor[] = [];
  const spot = (id: string, group: AnchorGroup, label: string, p: Point) => out.push({ id, group, label, points: [{ x: p.x, z: p.z }] });

  spot('safehouse', 'safehouse', 'Safehouse', SAFEHOUSE);
  for (const p of placePayphones()) spot(p.id, 'payphone', `Payphone ${p.id.slice(6)}`, p);
  for (const p of placeFrenzyTokens()) spot(p.id, 'frenzy', `Frenzy token ${p.id.slice(3)}`, p);
  const docks = placeDocks(city);
  spot('docks', 'docks', 'Docks yard', docks);
  for (const s of placeSprayShops(city)) spot(s.id, 'spray', "Pay 'n' Spray", s);
  spot('station', 'station', 'Police station', placeStation(city));
  const hospital = placeHospital(city);
  spot('hospital', 'hospital', 'Hospital doors', hospital);
  spot('hospital-bay', 'hospital', 'Ambulance bay', { x: hospital.bayX, z: hospital.bayZ });
  for (const h of placeHangouts()) spot(h.id, 'hangout', `${h.gang.name} hangout`, h);
  for (const r of RACES) out.push({ id: r.id, group: 'race', label: `Race: ${r.name}`, points: [nodePoint(r.nodes[0])], route: r.nodes });
  for (const m of buildMissions(docks, SAFEHOUSE)) storyAnchors(m, out);
  inputs.ramps?.forEach((r, i) => spot(`ramp-${i}`, 'ramp', r.kind === 'kicker' ? 'Kicker' : 'Stunt ramp', r));
  inputs.busStops?.forEach((s, i) => spot(`bus-${i}`, 'busStop', 'Bus stop', s));
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
