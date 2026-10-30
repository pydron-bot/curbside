/**
 * A rough route along the road grid for the radar's waypoint line: onto the
 * nearest road, along it to the target's cross street, along that, then in.
 * Not pathfinding — the grid is regular, so an L along the roads reads right.
 * Pure.
 */
import { BLOCK_SIZE, HALF_EXTENT } from '../world/city';

const snap = (v: number) => Math.max(-HALF_EXTENT, Math.min(HALF_EXTENT, Math.round(v / BLOCK_SIZE) * BLOCK_SIZE));

/**
 * Write the route from (px, pz) to (tx, tz) into `out` as x0, z0, x1, z1, …
 * (reused, no allocation once it has grown) and return the number of points.
 */
export function roadRoute(px: number, pz: number, tx: number, tz: number, out: number[]): number {
  let n = put(out, 0, px, pz);
  const rx = snap(px);
  const rz = snap(pz);
  if (Math.abs(px - rx) <= Math.abs(pz - rz)) {
    // On (or nearest) a north-south road: along it to the target's cross street.
    const cz = snap(tz);
    n = put(out, n, rx, pz);
    n = put(out, n, rx, cz);
    n = put(out, n, tx, cz);
  } else {
    const cx = snap(tx);
    n = put(out, n, px, rz);
    n = put(out, n, cx, rz);
    n = put(out, n, cx, tz);
  }
  return put(out, n, tx, tz);
}

/** Append point n (unless it repeats the last one); returns the new count. */
function put(out: number[], n: number, x: number, z: number): number {
  if (n > 0 && Math.abs(out[2 * n - 2] - x) < 0.5 && Math.abs(out[2 * n - 1] - z) < 0.5) return n;
  out[2 * n] = x;
  out[2 * n + 1] = z;
  return n + 1;
}
