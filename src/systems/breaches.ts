/**
 * The destruction test's simulation side (pure, no three.js): a combat blast
 * near a building blows a shallow crater out of the nearest facade. Where
 * and how big is decided here from the blast kind, its position, the city
 * and earlier breaches only (no randomness, no device or tier input), so it
 * is the same on every device; the rubble that flies out is presentation
 * (render/destruction.ts). Building collision is unchanged: a breach is a
 * scar, not a hole to drive into.
 *
 * Only + − × ÷, Math.sqrt, comparisons, Math.round and Math.imul are used,
 * which every JS engine computes bit-identically (Math.pow / Math.hypot need
 * not be correctly rounded).
 */
import type { EventBus } from '../core/events';
import { AWNING_HEIGHT, type Side } from '../world/buildingPlans';
import type { Building, Rect } from '../world/city';
import type { BlastKind } from './damage';

/** Scar slots (bits of the building shader's per-instance mask). */
export const MAX_BREACHES = 32;

export interface BreachSpec {
  /** A building face within this of the blast is breached, m. */
  reach: number;
  /** Crater radius along the face at the edge of reach and at the face, m. */
  minRadius: number;
  maxRadius: number;
  /** Depth into the wall at full strength, m. */
  depth: number;
  /**
   * Crater centre height, m: a car's body, a grenade on the ground, a rocket
   * in flight, each raised 0.6 m to clear the shop windows. Under an awning
   * it goes higher still (see AWNING_CLEAR).
   */
  centreY: number;
}

/** A shopfront awning on a face: its side and span along the face (buildingPlans' Shopfront has these). */
export interface AwningSpan {
  side: Side;
  from: number;
  to: number;
}

/**
 * The near-overhead camera can't see a wall under an awning (it hangs 2.8 m
 * up, 1.1 m out): a crater there sits at least this many radii above it.
 */
export const AWNING_CLEAR = 0.5;

/** The breach kind of an explosion's source (a car going up when there is none). */
export function blastKindOf(source: string | undefined): BlastKind {
  return source === 'grenade' || source === 'rocket' ? source : 'car';
}

/** Reach well inside each blast's damage radius (systems/damage.ts BLASTS). */
export const BREACH: Readonly<Record<BlastKind, BreachSpec>> = {
  car: { reach: 5, minRadius: 0.6, maxRadius: 1.5, depth: 0.55, centreY: 1.6 },
  grenade: { reach: 4, minRadius: 0.5, maxRadius: 1.1, depth: 0.4, centreY: 1.3 },
  rocket: { reach: 3.5, minRadius: 0.8, maxRadius: 1.8, depth: 0.75, centreY: 1.8 },
};

/** Repeated hits grow a crater to at most this radius and depth, m. */
export const BREACH_RADIUS_CAP = 2.4;
export const BREACH_DEPTH_CAP = 1;
/** Weaker than this (0..1) and the wall shrugs it off. */
export const MIN_STRENGTH = 0.12;

/** A face of a building: its side, the point on it nearest the query, its outward normal, the distance. */
export interface BreachFace {
  side: Side;
  px: number;
  pz: number;
  nx: number;
  nz: number;
  dist: number;
}

const NORMAL_X = [0, 1, 0, -1] as const;
const NORMAL_Z = [-1, 0, 1, 0] as const;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function setFace(out: BreachFace, side: Side, px: number, pz: number, dist: number): BreachFace {
  out.side = side;
  out.px = px;
  out.pz = pz;
  out.nx = NORMAL_X[side];
  out.nz = NORMAL_Z[side];
  out.dist = dist;
  return out;
}

/**
 * The face of `b` nearest (x, z). Outside, it is the face the clamped point
 * lies on (in a corner region the axis with the larger gap; an exact tie
 * goes to the z face). A point inside (a rocket ends up to ~0.43 m in) gets
 * the least-penetration face, as collision's circleVsRect pushes out, at
 * distance 0.
 */
export function nearestFace(b: Rect, x: number, z: number, out: BreachFace): BreachFace {
  const px = clamp(x, b.minX, b.maxX);
  const pz = clamp(z, b.minZ, b.maxZ);
  const dx = x - px;
  const dz = z - pz;
  if (dx === 0 && dz === 0) {
    const left = x - b.minX;
    const right = b.maxX - x;
    const top = z - b.minZ;
    const bottom = b.maxZ - z;
    const m = Math.min(left, right, top, bottom);
    if (m === left) return setFace(out, 3, b.minX, z, 0);
    if (m === right) return setFace(out, 1, b.maxX, z, 0);
    if (m === top) return setFace(out, 0, x, b.minZ, 0);
    return setFace(out, 2, x, b.maxZ, 0);
  }
  const dist = Math.sqrt(dx * dx + dz * dz);
  const ax = dx < 0 ? -dx : dx;
  const az = dz < 0 ? -dz : dz;
  if (ax > az) return setFace(out, dx < 0 ? 3 : 1, px, pz, dist);
  return setFace(out, dz < 0 ? 0 : 2, px, pz, dist);
}

/** How hard a `kind` blast `dist` m from a face hits it: 1 at the face, 0 at its reach. */
export function breachStrength(kind: BlastKind, dist: number): number {
  const reach = BREACH[kind].reach;
  if (dist >= reach) return 0;
  return Math.sqrt(1 - (dist > 0 ? dist : 0) / reach);
}

/** Face extents of `b` for `side`: along the face and through the building, m. */
function faceWidth(b: Rect, side: Side): number {
  return side === 0 || side === 2 ? b.maxX - b.minX : b.maxZ - b.minZ;
}
function faceThickness(b: Rect, side: Side): number {
  return side === 0 || side === 2 ? b.maxZ - b.minZ : b.maxX - b.minX;
}

/** One murmur3 round: mix the int `k` into the hash `h`. */
function mix(h: number, k: number): number {
  let v = Math.imul(k | 0, 0xcc9e2d51);
  v = (v << 15) | (v >>> 17);
  h ^= Math.imul(v, 0x1b873593);
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/** Deterministic 32-bit hash of five ints. */
function hash5(a: number, b: number, c: number, d: number, e: number): number {
  let h = mix(mix(mix(mix(mix(0x9e3779b9, a), b), c), d), e);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface Breach {
  slot: number;
  /** Index into city.buildings. */
  building: number;
  side: Side;
  /** Crater centre on the facade plane, m. */
  x: number;
  y: number;
  z: number;
  /** Outward face normal (axis-aligned). */
  nx: number;
  nz: number;
  radius: number;
  depth: number;
  /** The latest blast's share, 0..1. */
  strength: number;
  /** 0..1 from building, side, position and hit count. */
  seed: number;
  kind: BlastKind;
  hits: number;
  /** Ever-increasing stamp of the latest hit: the oldest is replaced when every slot is taken. */
  serial: number;
}

export type BreachResult = Breach & { merged: boolean };

function emptyBreach(slot: number): Breach {
  return { slot, building: -1, side: 0, x: 0, y: 0, z: 0, nx: 0, nz: 0, radius: 0, depth: 0, strength: 0, seed: 0, kind: 'car', hits: 0, serial: 0 };
}

/** A first crater for a hit: radius, depth, centre along the face and height, and the building's caps. */
interface FreshCrater {
  radius: number;
  depth: number;
  u: number;
  y: number;
  sizeCap: number;
  depthCap: number;
}

/** What `find` picked: the building, its face, and the blast's strength there. */
interface Hit {
  building: number;
  face: BreachFace;
  strength: number;
}

/**
 * The run's craters: up to MAX_BREACHES slots. A blast on a face near an
 * existing crater grows it (three rockets on one spot make one big crater,
 * capped) instead of taking another slot; with every slot taken the oldest
 * goes.
 */
export class Breaches {
  private readonly pool: Breach[] = [];
  private readonly live: Array<Breach | null> = [];
  private readonly result: BreachResult = { ...emptyBreach(0), merged: false };
  private readonly face: BreachFace = { side: 0, px: 0, pz: 0, nx: 0, nz: 0, dist: 0 };
  private readonly best: BreachFace = { side: 0, px: 0, pz: 0, nx: 0, nz: 0, dist: 0 };
  private readonly hit: Hit = { building: -1, face: this.best, strength: 0 };
  private serial = 0;

  /** What a fresh crater would be, written by place(). */
  private readonly fresh: FreshCrater = { radius: 0, depth: 0, u: 0, y: 0, sizeCap: 0, depthCap: 0 };

  /**
   * `grid` is the static collision grid (its near() result is shared scratch);
   * `index` maps a building's Rect to its index in `buildings`, which tells
   * buildings apart from trees, dressing and the boundary walls. `awnings`
   * are each building's shopfront awnings (from planBuildings, deterministic).
   */
  constructor(
    readonly buildings: readonly Building[],
    readonly grid: { near(x: number, z: number, r: number): readonly Rect[] },
    readonly index: ReadonlyMap<Rect, number>,
    private readonly awnings: ReadonlyArray<readonly AwningSpan[]> = [],
  ) {
    for (let i = 0; i < MAX_BREACHES; i++) {
      this.pool.push(emptyBreach(i));
      this.live.push(null);
    }
  }

  /** Live breaches by slot (null = free). */
  get slots(): ReadonlyArray<Breach | null> {
    return this.live;
  }

  get count(): number {
    let n = 0;
    for (const b of this.live) if (b) n++;
    return n;
  }

  reset(): void {
    for (let i = 0; i < MAX_BREACHES; i++) this.live[i] = null;
  }

  /**
   * The building face a `kind` blast at (x, z) would breach, how hard, and
   * the crater it would make there if it were the first (centre x, y, z on
   * the face and radius; a merge would move and grow it), without changing
   * anything; null when no face is in reach. Allocates (a button press or
   * an explosion, not a frame).
   */
  probe(kind: BlastKind, x: number, z: number): { building: number; side: Side; strength: number; x: number; y: number; z: number; radius: number } | null {
    const h = this.find(kind, x, z);
    if (!h) return null;
    const c = this.place(kind, h);
    const along = h.face.side === 0 || h.face.side === 2;
    return {
      building: h.building,
      side: h.face.side,
      strength: h.strength,
      x: along ? c.u : h.face.px,
      y: c.y,
      z: along ? h.face.pz : c.u,
      radius: c.radius,
    };
  }

  /** A crater `radius` either side of `u` along `building`'s `side` overlaps an awning (so it goes above it). */
  underAwning(building: number, side: Side, u: number, radius: number): boolean {
    const list = this.awnings[building];
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.side === side && a.from < u + radius && a.to > u - radius) return true;
    }
    return false;
  }

  /**
   * The crater a `kind` blast at (x, z) makes (a new one or an existing one
   * grown), or null when no building face is in reach. Returns the same
   * object every call: read it before the next.
   */
  blast(kind: BlastKind, x: number, z: number): BreachResult | null {
    const h = this.find(kind, x, z);
    if (!h) return null;
    const b = this.buildings[h.building];
    const f = h.face;
    const s = h.strength;
    const side = f.side;
    const along = side === 0 || side === 2;
    const c = this.place(kind, h);
    const sizeCap = c.sizeCap;
    const depthCap = c.depthCap;
    let radius = c.radius;
    let depth = c.depth;
    let u = c.u;
    let y = c.y;

    // Grow the nearest crater on this face that the new one overlaps.
    let merge: Breach | null = null;
    let mergeD2 = Infinity;
    for (const o of this.live) {
      if (!o || o.building !== h.building || o.side !== side) continue;
      const ou = along ? o.x : o.z;
      const reach = 0.6 * (o.radius + radius);
      const du = ou - u;
      const dy = o.y - y;
      if ((du < 0 ? -du : du) >= reach || (dy < 0 ? -dy : dy) >= reach) continue;
      const d2 = du * du + dy * dy;
      if (d2 < mergeD2) {
        merge = o;
        mergeD2 = d2;
      }
    }

    let slot: Breach;
    if (merge) {
      slot = merge;
      const r1 = merge.radius;
      const w = (radius * radius) / (r1 * r1 + radius * radius);
      const ou = along ? merge.x : merge.z;
      const grown = Math.min(BREACH_RADIUS_CAP, sizeCap, Math.sqrt(r1 * r1 + radius * radius));
      u = this.placeU(b, side, ou + (u - ou) * w, grown);
      y = this.placeY(h.building, side, u, merge.y + (y - merge.y) * w, grown);
      radius = grown;
      depth = Math.min(depthCap, (merge.depth > depth ? merge.depth : depth) + 0.15 * s);
      slot.hits++;
    } else {
      slot = this.freeSlot();
      slot.hits = 1;
    }
    this.live[slot.slot] = slot;
    slot.building = h.building;
    slot.side = side;
    slot.x = along ? u : f.px;
    slot.z = along ? f.pz : u;
    slot.y = y;
    slot.nx = f.nx;
    slot.nz = f.nz;
    slot.radius = radius;
    slot.depth = depth;
    slot.strength = s;
    slot.kind = kind;
    slot.serial = ++this.serial;
    slot.seed = hash5(h.building, side, Math.round(u * 4), Math.round(y * 4), slot.hits) / 4294967296;
    Object.assign(this.result, slot);
    this.result.merged = merge !== null;
    return this.result;
  }

  /** Nearest building face in reach of a `kind` blast at (x, z); ties go to the lower building index. */
  private find(kind: BlastKind, x: number, z: number): Hit | null {
    const reach = BREACH[kind].reach;
    const near = this.grid.near(x, z, reach);
    const best = this.best;
    let bestI = -1;
    for (let k = 0; k < near.length; k++) {
      const r = near[k];
      const i = this.index.get(r);
      if (i === undefined) continue; // trees, dressing, boundary walls
      const f = nearestFace(r, x, z, this.face);
      if (f.dist >= reach) continue;
      if (bestI < 0 || f.dist < best.dist || (f.dist === best.dist && i < bestI)) {
        bestI = i;
        setFace(best, f.side, f.px, f.pz, f.dist);
      }
    }
    if (bestI < 0) return null;
    const s = breachStrength(kind, best.dist);
    if (s < MIN_STRENGTH) return null;
    this.hit.building = bestI;
    this.hit.strength = s;
    return this.hit;
  }

  /** A fresh crater for hit `h`: size and depth by kind and strength (capped), centre along the face and up. */
  private place(kind: BlastKind, h: Hit): FreshCrater {
    const spec = BREACH[kind];
    const b = this.buildings[h.building];
    const f = h.face;
    const s = h.strength;
    const side = f.side;
    const c = this.fresh;
    c.sizeCap = 0.45 * Math.min(b.height, faceWidth(b, side));
    c.depthCap = Math.min(BREACH_DEPTH_CAP, 0.3 * faceThickness(b, side));
    c.radius = Math.min(c.sizeCap, spec.minRadius + (spec.maxRadius - spec.minRadius) * s);
    c.depth = Math.min(c.depthCap, spec.depth * (0.6 + 0.4 * s));
    c.u = this.placeU(b, side, side === 0 || side === 2 ? f.px : f.pz, c.radius);
    c.y = this.placeY(h.building, side, c.u, spec.centreY, c.radius);
    return c;
  }

  /** Along-face centre: kept 0.6 r clear of the corners. */
  private placeU(b: Rect, side: Side, u: number, r: number): number {
    const lo = side === 0 || side === 2 ? b.minX : b.minZ;
    const hi = side === 0 || side === 2 ? b.maxX : b.maxZ;
    // Only a guard: the size cap (0.45 of the face) keeps 1.2 r under any face's width.
    if (hi - lo < 1.2 * r) return (lo + hi) / 2;
    return clamp(u, lo + 0.6 * r, hi - 0.6 * r);
  }

  /** Centre height: above any awning it would hide behind, off the ground and under the roof line. */
  private placeY(building: number, side: Side, u: number, y: number, r: number): number {
    if (this.underAwning(building, side, u, r)) {
      const over = AWNING_HEIGHT + AWNING_CLEAR * r;
      if (y < over) y = over;
    }
    return clamp(y, 0.35 * r, this.buildings[building].height - 0.6 * r);
  }

  /** A free slot, else the one hit longest ago. */
  private freeSlot(): Breach {
    let oldest = 0;
    for (let i = 0; i < MAX_BREACHES; i++) {
      const o = this.live[i];
      if (!o) return this.pool[i];
      if (o.serial < this.live[oldest]!.serial) oldest = i;
    }
    return this.pool[oldest];
  }
}

/**
 * BLOW A WALL sets its blast off this far out from the face, m: far enough
 * that the wall doesn't cut the fireball's sprites off flat, near enough
 * that a rocket still hits at strength ~0.77 (its reach is 3.5 m).
 */
export const WALL_BLAST_OUT = 1.4;

/** BLOW A WALL's target: a building face and the point WALL_BLAST_OUT outside it to set the blast off at. */
export interface WallAhead {
  building: number;
  side: Side;
  x: number;
  z: number;
  /** From the player to the face, m. */
  dist: number;
  /** No camera-facing face in view: the nearest face in range was used instead. */
  offScreen: boolean;
}

/** Faces this close to the player are candidates in view; this far as the fallback, m. */
const WALL_RANGE = 25;
const WALL_FALLBACK = 40;
/** The blast point keeps this far from a face's ends, m. */
const WALL_END_MARGIN = 1.5;
/** cos 60°: a face point within 60° of the heading is "in front". */
const AHEAD_COS = 0.5;

interface WallCandidate {
  building: number;
  side: Side;
  px: number;
  pz: number;
  dist: number;
  ahead: boolean;
  inView: boolean;
}

/**
 * BLOW A WALL (the Diagnostics test button): a building face the camera can
 * see, in front of the player if possible. Candidates are faces in `view`
 * turned toward the camera within 25 m, those within 60° of `heading`
 * (facing (sin h, cos h)) first, then the nearest. The point is
 * WALL_BLAST_OUT off the face's nearest point to the player, 1.5 m clear of
 * its ends, and must pass a dry run of the breach rule (a rocket there
 * breaches this face, not a nearer one); with
 * `onScreen`, the top of the crater it would make must pass that too (on a
 * phone a wall 6 m ahead puts it under the HUD). Failing all that, the
 * nearest face within 40 m (`offScreen`). Null when there is none.
 * Allocates (a button press, not a frame).
 */
export function wallToBlow(
  b: Breaches,
  x: number,
  z: number,
  heading: number,
  camX: number,
  camZ: number,
  view: Rect,
  out: WallAhead,
  onScreen?: (x: number, y: number, z: number) => boolean,
): WallAhead | null {
  const hx = Math.sin(heading);
  const hz = Math.cos(heading);
  const near = b.grid.near(x, z, WALL_FALLBACK);
  const seen = new Set<number>();
  const list: WallCandidate[] = [];
  for (const r of near) {
    const i = b.index.get(r);
    if (i === undefined || seen.has(i)) continue;
    seen.add(i);
    for (let side = 0 as Side; side < 4; side = (side + 1) as Side) {
      const along = side === 0 || side === 2;
      const lo = along ? r.minX : r.minZ;
      const hi = along ? r.maxX : r.maxZ;
      const q = along ? x : z;
      const u = hi - lo < 2 * WALL_END_MARGIN ? (lo + hi) / 2 : clamp(q, lo + WALL_END_MARGIN, hi - WALL_END_MARGIN);
      const px = along ? u : side === 1 ? r.maxX : r.minX;
      const pz = along ? (side === 2 ? r.maxZ : r.minZ) : u;
      const nx = NORMAL_X[side];
      const nz = NORMAL_Z[side];
      // The player must be on the outside of the face, or it is the far side of the building.
      if ((x - px) * nx + (z - pz) * nz <= 0) continue;
      const dx = px - x;
      const dz = pz - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > WALL_FALLBACK) continue;
      const facing = (camX - px) * nx + (camZ - pz) * nz > 0;
      const inView = facing && dist <= WALL_RANGE && px >= view.minX && px <= view.maxX && pz >= view.minZ && pz <= view.maxZ;
      const ahead = dist > 0 && (dx * hx + dz * hz) / dist >= AHEAD_COS;
      list.push({ building: i, side, px, pz, dist, ahead, inView });
    }
  }
  const rank = (c: WallCandidate) => (c.inView ? (c.ahead ? 0 : 1) : 2);
  list.sort((a, c) => rank(a) - rank(c) || a.dist - c.dist || a.building - c.building || a.side - c.side);
  // In view first; then the nearest of the rest (and of those whose crater would be hidden).
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) list.sort((a, c) => a.dist - c.dist || a.building - c.building || a.side - c.side);
    for (const c of list) {
      if (pass === 0 && !c.inView) break;
      const bx = c.px + NORMAL_X[c.side] * WALL_BLAST_OUT;
      const bz = c.pz + NORMAL_Z[c.side] * WALL_BLAST_OUT;
      const p = b.probe('rocket', bx, bz);
      if (!p || p.building !== c.building || p.side !== c.side) continue;
      if (pass === 0 && onScreen && !onScreen(p.x, p.y + 0.85 * p.radius, p.z)) continue;
      out.building = c.building;
      out.side = c.side;
      out.x = bx;
      out.z = bz;
      out.dist = c.dist;
      out.offScreen = pass === 1;
      return out;
    }
  }
  return null;
}

/**
 * Turns combat blasts into breaches: every `explosion` (a car going up, a
 * grenade, a rocket; molotovs only ignite) within reach of a building face
 * makes one `breach` event, while the test is on and a run is being played
 * (never behind the title). Emitted from inside the explosion's dispatch;
 * nothing else is re-emitted.
 */
export class BreachSystem {
  constructor(
    bus: EventBus,
    breaches: Breaches,
    d: { enabled(): boolean; playing(): boolean },
  ) {
    bus.on('explosion', (e) => {
      if (!d.enabled() || !d.playing()) return;
      const kind = blastKindOf(e.source);
      const r = breaches.blast(kind, e.x, e.z);
      if (!r) return;
      bus.emit({
        type: 'breach',
        slot: r.slot,
        merged: r.merged,
        x: r.x,
        y: r.y,
        z: r.z,
        nx: r.nx,
        nz: r.nz,
        side: r.side,
        radius: r.radius,
        depth: r.depth,
        strength: r.strength,
        kind,
        building: r.building,
        seed: r.seed,
        byPlayer: e.byPlayer,
        distance: e.distance,
      });
    });
  }
}
