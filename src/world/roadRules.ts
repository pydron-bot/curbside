/**
 * Road rules from the map edits (W3-D): closed roads and one-way streets.
 * The road graph's single choke point: roads.ts canLeave reads the rules
 * installed here, so every router (traffic's turns, pursuit and job routes,
 * buses, street races, spawns, kerb spots) keeps off a closed road and the
 * wrong way down a one-way. generateCity installs the edits' rules (like
 * paintDistricts: the last city built is the one the game plays). The
 * player isn't bound by them: a closure is barriers, not a wall.
 *
 * A leaf module (no city or roads import) so city.ts can install it. Pure.
 */
import { planMerges, type BlockMerge } from './blockMerge';
import type { RoadEdit } from './mapEdits';

/** What a road is (round 3: streets): a road (open, closed or one-way), a pedestrian street, or removed (land). */
export const STREET_ROAD = 0;
export const STREET_PEDESTRIAN = 1;
export const STREET_REMOVED = 2;
export type StreetKind = typeof STREET_ROAD | typeof STREET_PEDESTRIAN | typeof STREET_REMOVED;
/** The shipped city's outer ring road (roads.ts MAX_NODE for the core; generateCity passes its own). */
const CORE_MAX_NODE = 8;

type Dir = 0 | 1 | 2 | 3;
/** N, E, S, W as roads.ts DIR_VEC. */
const DX = [0, 1, 0, -1] as const;
const DZ = [-1, 0, 1, 0] as const;
/** Crossings the rules can name, either side of the centre (mapEdits' NODE_REACH). */
const REACH = 64;
const SIDE = 2 * REACH + 1;

/** The direction from crossing a to its neighbour b, or -1 if they aren't neighbours. */
export function dirBetween(ax: number, az: number, bx: number, bz: number): Dir | -1 {
  const dx = bx - ax;
  const dz = bz - az;
  for (let d = 0; d < 4; d++) if (DX[d] === dx && DZ[d] === dz) return d as Dir;
  return -1;
}

export class RoadRules {
  /** Roads closed to traffic both ways (with removals that can't apply: blockMerge.ts planMerges). */
  readonly closed: readonly RoadEdit[];
  /** One-way roads (traffic a → b only). */
  readonly oneWay: readonly RoadEdit[];
  /** Pedestrian streets (round 3): shut to traffic both ways, paved, bollards at the ends. */
  readonly pedestrian: readonly RoadEdit[];
  /** Removed roads that apply (inside a merge): shut, and land. */
  readonly removed: readonly RoadEdit[];
  /** The merged blocks the removals make (in crossings). */
  readonly merges: readonly BlockMerge[];
  /** Removals that can't apply (played as closed), with why: the checks show them. */
  readonly refused: ReadonlyArray<{ road: RoadEdit; why: string }>;
  /** The city's outer ring road, in crossings. */
  readonly maxNode: number;
  /** 1 where traffic may not leave crossing (ix, iz) heading d (null: no rules). */
  private readonly shut: Uint8Array | null;
  /** STREET_* per crossing and heading (null: no pedestrian streets or removals). */
  private readonly street: Uint8Array | null;
  /** Per block (by north-west crossing): 1 + its merge's index, 0 for none (null: no merges). */
  private readonly mergeCell: Uint16Array | null;

  constructor(roads: readonly RoadEdit[] = [], maxNode = CORE_MAX_NODE) {
    this.maxNode = maxNode;
    const plan = planMerges(
      roads.filter((r) => r.removed),
      maxNode,
    );
    const refused = new Set(plan.refused.map((x) => x.road));
    this.refused = plan.refused;
    this.merges = plan.merges;
    this.removed = roads.filter((r) => r.removed && !refused.has(r));
    this.pedestrian = roads.filter((r) => r.pedestrian && !r.removed);
    this.closed = [...roads.filter((r) => r.closed && !r.removed && !r.pedestrian), ...refused];
    this.oneWay = roads.filter((r) => !r.closed && r.oneWay && !r.removed && !r.pedestrian);
    const shutBoth = [...this.closed, ...this.pedestrian, ...this.removed];
    this.shut = shutBoth.length + this.oneWay.length > 0 ? new Uint8Array(SIDE * SIDE * 4) : null;
    for (const r of shutBoth) {
      this.shutLane(r.a[0], r.a[1], r.b[0], r.b[1]);
      this.shutLane(r.b[0], r.b[1], r.a[0], r.a[1]);
    }
    for (const r of this.oneWay) this.shutLane(r.b[0], r.b[1], r.a[0], r.a[1]);
    this.street = this.pedestrian.length + this.removed.length > 0 ? new Uint8Array(SIDE * SIDE * 4) : null;
    for (const r of this.pedestrian) this.markStreet(r, STREET_PEDESTRIAN);
    for (const r of this.removed) this.markStreet(r, STREET_REMOVED);
    this.mergeCell = this.merges.length > 0 ? new Uint16Array(SIDE * SIDE) : null;
    this.merges.forEach((m, i) => {
      for (let x = m.ix; x < m.ix + m.w; x++) for (let z = m.iz; z < m.iz + m.h; z++) if (inReach(x, z)) this.mergeCell![cell(x, z)] = i + 1;
    });
  }

  /** Any pedestrian streets or removed roads (the ground, signals, crowd and dressing only look further when there are). */
  get streets(): boolean {
    return this.street !== null;
  }

  /** What the road leaving crossing (ix, iz) heading d is: STREET_ROAD, STREET_PEDESTRIAN or STREET_REMOVED. */
  streetAt(ix: number, iz: number, d: Dir): StreetKind {
    const s = this.street;
    if (s === null || !inReach(ix, iz)) return STREET_ROAD;
    return s[cell(ix, iz) * 4 + d] as StreetKind;
  }

  /** What the road between neighbouring crossings a and b is. */
  streetOf(ax: number, az: number, bx: number, bz: number): StreetKind {
    const d = dirBetween(ax, az, bx, bz);
    return d < 0 ? STREET_ROAD : this.streetAt(ax, az, d as Dir);
  }

  /** Is crossing (ix, iz) still a crossing for traffic: at least one road (open, closed or one-way) on the map leaves it? */
  crossingStands(ix: number, iz: number): boolean {
    if (this.street === null) return true;
    for (let d = 0; d < 4; d++) {
      const nx = ix + DX[d];
      const nz = iz + DZ[d];
      if (Math.abs(nx) <= this.maxNode && Math.abs(nz) <= this.maxNode && this.streetAt(ix, iz, d as Dir) === STREET_ROAD) return true;
    }
    return false;
  }

  /** The merge block (ix, iz) (by its north-west crossing) is part of, or null. */
  mergeAt(ix: number, iz: number): BlockMerge | null {
    const m = this.mergeCell;
    if (m === null || !inReach(ix, iz)) return null;
    const k = m[cell(ix, iz)];
    return k === 0 ? null : this.merges[k - 1];
  }

  /** The road along side `side` (0 N, 1 E, 2 S, 3 W) of block (ix, iz) (by its north-west crossing). */
  sideStreet(ix: number, iz: number, side: number): StreetKind {
    if (this.street === null) return STREET_ROAD;
    // Each side as a crossing and the heading along it: N from the NW corner east, E from the NE corner south...
    switch (side) {
      case 0:
        return this.streetAt(ix, iz, 1);
      case 1:
        return this.streetAt(ix + 1, iz, 2);
      case 2:
        return this.streetAt(ix, iz + 1, 1);
      default:
        return this.streetAt(ix, iz, 2);
    }
  }

  /** No closures and no one-ways. */
  get empty(): boolean {
    return this.shut === null;
  }

  /** May traffic leave crossing (ix, iz) heading d (the rules only: roads.ts canLeave also checks the map's edge)? */
  allows(ix: number, iz: number, d: Dir): boolean {
    const s = this.shut;
    if (s === null || ix < -REACH || ix > REACH || iz < -REACH || iz > REACH) return true;
    return s[((ix + REACH) * SIDE + iz + REACH) * 4 + d] === 0;
  }

  /** Is the road between neighbouring crossings a and b closed? */
  isClosed(ax: number, az: number, bx: number, bz: number): boolean {
    const d = dirBetween(ax, az, bx, bz);
    return d >= 0 && !this.allows(ax, az, d as Dir) && !this.allows(bx, bz, ((d + 2) % 4) as Dir);
  }

  private markStreet(r: RoadEdit, kind: StreetKind): void {
    const d = dirBetween(r.a[0], r.a[1], r.b[0], r.b[1]);
    if (d < 0 || this.street === null) return;
    if (inReach(r.a[0], r.a[1])) this.street[cell(r.a[0], r.a[1]) * 4 + d] = kind;
    if (inReach(r.b[0], r.b[1])) this.street[cell(r.b[0], r.b[1]) * 4 + ((d + 2) % 4)] = kind;
  }

  private shutLane(ax: number, az: number, bx: number, bz: number): void {
    const d = dirBetween(ax, az, bx, bz);
    if (d < 0 || this.shut === null || Math.abs(ax) > REACH || Math.abs(az) > REACH) return;
    this.shut[((ax + REACH) * SIDE + az + REACH) * 4 + d] = 1;
  }
}

const inReach = (ix: number, iz: number) => ix >= -REACH && ix <= REACH && iz >= -REACH && iz <= REACH;
const cell = (ix: number, iz: number) => (ix + REACH) * SIDE + iz + REACH;

const NONE = new RoadRules();
let active = NONE;

/** Install the edits' road rules for the game (generateCity does this; `maxNode`: its outer ring road). */
export function setRoadRules(roads: readonly RoadEdit[], maxNode = CORE_MAX_NODE): void {
  active = roads.length === 0 ? NONE : new RoadRules(roads, maxNode);
}

/** The road rules in force (the last city generated). */
export function roadRules(): RoadRules {
  return active;
}
