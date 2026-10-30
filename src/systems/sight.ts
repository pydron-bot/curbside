/**
 * Who can see whom: line of sight across the city's buildings and trees,
 * for the police watching the player. Allocation-free (it runs several
 * times a second per unit).
 */
import type { StaticGrid } from '../world/collision';

/**
 * Can someone at (ax, az) see (bx, bz)? Always within `near`; within `far`
 * if no building (or tree) blocks the straight line between them.
 */
export function sees(grid: StaticGrid, ax: number, az: number, bx: number, bz: number, near: number, far: number): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  if (d < near) return true;
  if (d > far) return false;
  return lineOfSight(grid, ax, az, bx, bz);
}

/** No obstacle crosses the segment from (ax, az) to (bx, bz). Allocation-free slab tests. */
export function lineOfSight(grid: StaticGrid, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const rects = grid.near((ax + bx) / 2, (az + bz) / 2, len / 2 + 1);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    // Segment vs box: parametric t in [0, 1] along (dx, dz).
    let t0 = 0;
    let t1 = 1;
    if (Math.abs(dx) < 1e-9) {
      if (ax < r.minX || ax > r.maxX) continue;
    } else {
      const ta = (r.minX - ax) / dx;
      const tb = (r.maxX - ax) / dx;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (az < r.minZ || az > r.maxZ) continue;
    } else {
      const ta = (r.minZ - az) / dz;
      const tb = (r.maxZ - az) / dz;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
      if (t0 > t1) continue;
    }
    return false;
  }
  return true;
}
