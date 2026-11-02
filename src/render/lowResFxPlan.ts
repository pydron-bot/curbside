/**
 * The pure half of lowResFx.ts (no three.js): how big the offscreen target
 * is, where on screen the soft particles are and how much they fill, and
 * whether drawing them offscreen pays this frame.
 */

export interface TargetSize {
  width: number;
  height: number;
}

/** The offscreen target for a `width`×`height` drawing buffer at `scale` (rounded up, at least 1×1). */
export function lowResSize(width: number, height: number, scale: number, out: TargetSize): TargetSize {
  // The epsilon keeps 1278 × 0.5 at 639, not 640, after float error.
  out.width = Math.max(1, Math.ceil(width * scale - 1e-6));
  out.height = Math.max(1, Math.ceil(height * scale - 1e-6));
  return out;
}

/** The composite's tile grid over the screen (16 × 8: tiles ~80 px wide on a phone). */
export const TILES_X = 16;
export const TILES_Y = 8;

/** Where on screen the particles are (by tile) and how much they fill. */
export interface ScreenCover {
  /** 1 per tile (row by row from the bottom left, as NDC) a particle's bounds overlap. */
  readonly tiles: Uint8Array;
  /** How many. */
  covered: number;
  /** Their quads' area over the screen's: screens of overdraw at full resolution. */
  fill: number;
}

export function emptyCover(): ScreenCover {
  return { tiles: new Uint8Array(TILES_X * TILES_Y), covered: 0, fill: 0 };
}

/** The covered tiles' share of the screen. */
export function coverShare(c: ScreenCover): number {
  return c.covered / (TILES_X * TILES_Y);
}

/** Nearer the camera than this (clip w, m) a particle is taken to cover the whole screen. */
const NEAR_W = 0.5;

/**
 * The tiles and fill of `count` camera-facing particle quads (fxParticles'
 * InstanceBuffer: pos x, y, z, size; axis x, y, z = the stretch along the
 * velocity). `viewProj` is projection × view, column-major; `px`, `py` the
 * projection's x and y scales (elements 0 and 5). Conservative: a quad
 * counts as the square round the disc through its corners.
 */
export function particleCover(
  pos: ArrayLike<number>,
  axis: ArrayLike<number>,
  count: number,
  viewProj: ArrayLike<number>,
  px: number,
  py: number,
  out: ScreenCover,
): ScreenCover {
  const m = viewProj;
  const tiles = out.tiles;
  tiles.fill(0);
  let fill = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const x = pos[o];
    const y = pos[o + 1];
    const z = pos[o + 2];
    const size = pos[o + 3];
    const len = Math.sqrt(axis[o] * axis[o] + axis[o + 1] * axis[o + 1] + axis[o + 2] * axis[o + 2]);
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w < NEAR_W) {
      // Right at (or behind) the camera: it may cover anything.
      tiles.fill(1);
      fill += 1;
      continue;
    }
    const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    // The shader offsets the corners by ±½ (len + size) along the stretch and
    // ±½ size across it: the disc through the corners, whatever the turn.
    const r = 0.5 * Math.sqrt((len + size) * (len + size) + size * size);
    const rx = (r * px) / w;
    const ry = (r * py) / w;
    if (cx + rx < -1 || cx - rx > 1 || cy + ry < -1 || cy - ry > 1) continue; // off screen
    const x0 = tile(cx - rx, TILES_X);
    const x1 = tile(cx + rx, TILES_X);
    const y0 = tile(cy - ry, TILES_Y);
    const y1 = tile(cy + ry, TILES_Y);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) tiles[ty * TILES_X + tx] = 1;
    // The quad's NDC area (size × (size + len) on the view plane) over the screen's 2 × 2.
    fill += (size * (size + len) * px * py) / (w * w) / 4;
  }
  let covered = 0;
  for (let i = 0; i < tiles.length; i++) covered += tiles[i];
  out.covered = covered;
  out.fill = fill;
  return out;
}

/** The tile an NDC coordinate falls in, clamped to the grid. */
function tile(ndc: number, n: number): number {
  const t = Math.floor(((ndc + 1) / 2) * n);
  return t < 0 ? 0 : t >= n ? n - 1 : t;
}

/**
 * Relative fragment cost of the offscreen path's extra work, per pixel,
 * against a smoke fragment at full resolution: the second (weighted depth)
 * output blended alongside the colour, and the composite (two reads, drawn
 * over the covered tiles at full resolution with MSAA blending; taken at
 * par, to be safe).
 */
export const DEPTH_OUTPUT_COST = 0.25;
export const COMPOSITE_COST = 1;
/** Switch to offscreen when it costs at most this share of drawing at full resolution; back above 1 (hysteresis). */
export const SWITCH_ON = 0.75;

/** The offscreen path's fragment cost, in full-resolution screens of smoke. */
export function lowResCost(fill: number, share: number, scale: number): number {
  return fill * scale * scale * (1 + DEPTH_OUTPUT_COST) + share * COMPOSITE_COST;
}

/**
 * Whether to draw the soft particles offscreen this frame: `fill` screens of
 * them over tiles making a `share` of the screen, at `scale`; `wasOn` last
 * frame's answer. Thin smoke spread wide (a tyre-smoke trail) stays at full
 * resolution, where the composite would cost more than it saves.
 */
export function lowResPays(fill: number, share: number, scale: number, wasOn: boolean): boolean {
  if (scale >= 1 || fill <= 0) return false;
  return lowResCost(fill, share, scale) < fill * (wasOn ? 1 : SWITCH_ON);
}
