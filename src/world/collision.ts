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

  /** Obstacles whose cells overlap the circle's bounding box (may repeat). */
  near(x: number, z: number, r: number): Rect[] {
    const [x0, z0, x1, z1] = this.range(x - r, z - r, x + r, z + r);
    if (x0 === x1 && z0 === z1) return this.cells.get(cellKey(x0, z0)) ?? [];
    const out = new Set<Rect>();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (const rect of this.cells.get(cellKey(cx, cz)) ?? []) out.add(rect);
      }
    }
    return [...out];
  }

  /**
   * Resolve one circle against all nearby boxes, accumulating push-out.
   * Returns the deepest contact (for velocity response), or null if clear.
   * `pos` is updated in place.
   */
  resolveCircle(pos: { x: number; z: number }, radius: number): Contact | null {
    let deepest: Contact | null = null;
    for (const rect of this.near(pos.x, pos.z, radius)) {
      const c = circleVsRect(pos.x, pos.z, radius, rect);
      if (!c) continue;
      pos.x += c.nx * c.depth;
      pos.z += c.nz * c.depth;
      if (!deepest || c.depth > deepest.depth) deepest = c;
    }
    return deepest;
  }
}

function cellKey(cx: number, cz: number): number {
  // Pack two signed 16-bit ints; the world is far smaller than ±32k cells.
  return ((cx + 32768) << 16) | (cz + 32768);
}

export function circleVsRect(x: number, z: number, r: number, b: Rect): Contact | null {
  const px = Math.max(b.minX, Math.min(x, b.maxX));
  const pz = Math.max(b.minZ, Math.min(z, b.maxZ));
  const dx = x - px;
  const dz = z - pz;
  const d2 = dx * dx + dz * dz;
  if (d2 > 0) {
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, depth: r - d };
  }
  // Centre is inside the box: push out through the nearest face.
  const left = x - b.minX;
  const right = b.maxX - x;
  const top = z - b.minZ;
  const bottom = b.maxZ - z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { nx: -1, nz: 0, depth: left + r };
  if (m === right) return { nx: 1, nz: 0, depth: right + r };
  if (m === top) return { nx: 0, nz: -1, depth: top + r };
  return { nx: 0, nz: 1, depth: bottom + r };
}
