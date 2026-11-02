/**
 * The bookkeeping behind PropBatch's vertex pulling (pure, no three.js).
 *
 * A family's models live in one vertex texture, model after model. An
 * instance is drawn as `chunks`: each chunk is one instance of a fixed run
 * of `size` vertices (the family's chunk size) starting partway into its
 * model, so a prop runs only its own model's vertices, rounded up to whole
 * chunks, and the family is still one instanced draw.
 */

/** Vertices per row of a family's vertex texture (two RGBA32UI texels each). */
export const VERTS_PER_ROW = 512;

/**
 * What a chunk costs beyond its vertices, in vertex-equivalents: its 29
 * floats of instance data written and uploaded when the view crosses a cell.
 */
export const CHUNK_OVERHEAD = 24;

/** Chunks a model of `count` vertices takes at chunk size `size`. */
export function chunksOf(count: number, size: number): number {
  return Math.ceil(count / size);
}

/**
 * The chunk size (a whole number of triangles) that costs the least over a
 * family's models, each counted once: the vertices run (padding included)
 * plus CHUNK_OVERHEAD per chunk. A one-model family gets its model whole.
 */
export function chunkSize(counts: readonly number[], overhead = CHUNK_OVERHEAD): number {
  const live = counts.filter((n) => n > 0);
  if (!live.length) return 3;
  const most = Math.ceil(Math.max(...live) / 3) * 3;
  let best = most;
  let bestCost = Infinity;
  for (let size = 24; size <= most; size += 3) {
    let cost = 0;
    for (const n of live) cost += chunksOf(n, size) * (size + overhead);
    if (cost < bestCost) {
      bestCost = cost;
      best = size;
    }
  }
  return Math.min(best, most);
}

/** Every chunk of a model: the first vertex of chunk j (the end is the model's end). */
export function chunkStart(modelStart: number, size: number, j: number): number {
  return modelStart + j * size;
}
