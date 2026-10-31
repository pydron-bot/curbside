/**
 * Static collision: axis-aligned boxes in a uniform grid, queried with circles.
 * Everything that moves (cars, peds) is approximated by one or more circles —
 * cheap, stable, and plenty for a top-down arcade game.
 */
import type { Rect } from './city';

export interface Contact {
  /** Push-out vector normal (unit), pointing away from the obstacle. */
  nx: number;
  nz: number;
  /** Penetration depth, m. */
  depth: number;
}

export class StaticGrid {
  private cells = new Map<number, Rect[]>();
  /** Reused result for queries spanning several cells. */
  private readonly scratch: Rect[] = [];
  /** Reused contacts for resolveCircle. */
  private readonly hit: Contact = { nx: 0, nz: 0, depth: 0 };
  private readonly deepest: Contact = { nx: 0, nz: 0, depth: 0 };

  constructor(
    obstacles: Rect[],
    private readonly cellSize = 32,
  ) {
    for (const r of obstacles) {
      const [x0, z0, x1, z1] = this.range(r.minX, r.minZ, r.maxX, r.maxZ);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = cellKey(cx, cz);
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(r);
        }
      }
    }
  }

  private range(minX: number, minZ: number, maxX: number, maxZ: number) {
    const s = this.cellSize;
    return [Math.floor(minX / s), Math.floor(minZ / s), Math.floor(maxX / s), Math.floor(maxZ / s)];
  }

  /**
   * Obstacles whose cells overlap the circle's bounding box, each once. The
   * returned array is shared: read it before the next query, don't keep it.
   */
  near(x: number, z: number, r: number): readonly Rect[] {
    const s = this.cellSize;
    const x0 = Math.floor((x - r) / s);
    const z0 = Math.floor((z - r) / s);
    const x1 = Math.floor((x + r) / s);
    const z1 = Math.floor((z + r) / s);
    if (x0 === x1 && z0 === z1) return this.cells.get(cellKey(x0, z0)) ?? EMPTY;
    const out = this.scratch;
    out.length = 0;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.cells.get(cellKey(cx, cz));
        if (!list) continue;
        for (const rect of list) if (!out.includes(rect)) out.push(rect);
      }
    }
    return out;
  }

  /**
   * Resolve one circle against all nearby boxes, accumulating push-out.
   * Returns the deepest contact (for velocity response), or null if clear.
   * `pos` is updated in place. The contact is shared (this runs for every
   * body circle every step): read it before the next call, don't keep it.
   */
  resolveCircle(pos: { x: number; z: number }, radius: number): Contact | null {
    const c = this.hit;
    const deepest = this.deepest;
    let found = false;
    for (const rect of this.near(pos.x, pos.z, radius)) {
      if (!circleVsRectInto(pos.x, pos.z, radius, rect, c)) continue;
      pos.x += c.nx * c.depth;
      pos.z += c.nz * c.depth;
      if (!found || c.depth > deepest.depth) {
        deepest.nx = c.nx;
        deepest.nz = c.nz;
        deepest.depth = c.depth;
        found = true;
      }
    }
    return found ? deepest : null;
  }
}

const EMPTY: readonly Rect[] = [];

function cellKey(cx: number, cz: number): number {
  // Pack two signed 16-bit ints; the world is far smaller than ±32k cells.
  return ((cx + 32768) << 16) | (cz + 32768);
}

/** The contact of a circle with a box, or null if clear (allocates; see circleVsRectInto). */
export function circleVsRect(x: number, z: number, r: number, b: Rect): Contact | null {
  const out: Contact = { nx: 0, nz: 0, depth: 0 };
  return circleVsRectInto(x, z, r, b, out) ? out : null;
}

/** circleVsRect into `out`, allocation-free; false (out untouched) if clear. */
export function circleVsRectInto(x: number, z: number, r: number, b: Rect, out: Contact): boolean {
  const px = Math.max(b.minX, Math.min(x, b.maxX));
  const pz = Math.max(b.minZ, Math.min(z, b.maxZ));
  const dx = x - px;
  const dz = z - pz;
  const d2 = dx * dx + dz * dz;
  if (d2 > 0) {
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    return set(out, dx / d, dz / d, r - d);
  }
  // Centre is inside the box: push out through the nearest face.
  const left = x - b.minX;
  const right = b.maxX - x;
  const top = z - b.minZ;
  const bottom = b.maxZ - z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return set(out, -1, 0, left + r);
  if (m === right) return set(out, 1, 0, right + r);
  if (m === top) return set(out, 0, -1, top + r);
  return set(out, 0, 1, bottom + r);
}

function set(out: Contact, nx: number, nz: number, depth: number): true {
  out.nx = nx;
  out.nz = nz;
  out.depth = depth;
  return true;
}
