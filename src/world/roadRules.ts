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
import type { RoadEdit } from './mapEdits';

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
  /** Roads closed to traffic both ways. */
  readonly closed: readonly RoadEdit[];
  /** One-way roads (traffic a → b only). */
  readonly oneWay: readonly RoadEdit[];
  /** 1 where traffic may not leave crossing (ix, iz) heading d (null: no rules). */
  private readonly shut: Uint8Array | null;

  constructor(roads: readonly RoadEdit[] = []) {
    this.closed = roads.filter((r) => r.closed);
    this.oneWay = roads.filter((r) => !r.closed && r.oneWay);
    this.shut = this.closed.length + this.oneWay.length > 0 ? new Uint8Array(SIDE * SIDE * 4) : null;
    for (const r of this.closed) {
      this.shutLane(r.a[0], r.a[1], r.b[0], r.b[1]);
      this.shutLane(r.b[0], r.b[1], r.a[0], r.a[1]);
    }
    for (const r of this.oneWay) this.shutLane(r.b[0], r.b[1], r.a[0], r.a[1]);
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

  private shutLane(ax: number, az: number, bx: number, bz: number): void {
    const d = dirBetween(ax, az, bx, bz);
    if (d < 0 || this.shut === null || Math.abs(ax) > REACH || Math.abs(az) > REACH) return;
    this.shut[((ax + REACH) * SIDE + az + REACH) * 4 + d] = 1;
  }
}

const NONE = new RoadRules();
let active = NONE;

/** Install the edits' road rules for the game (generateCity does this). */
export function setRoadRules(roads: readonly RoadEdit[]): void {
  active = roads.length === 0 ? NONE : new RoadRules(roads);
}

/** The road rules in force (the last city generated). */
export function roadRules(): RoadRules {
  return active;
}
