/**
 * Where the sun's shadow maps sit, as plain geometry (no renderer): the
 * per-frame window fitted to the view, and the larger window the static
 * casters are cached in (render/sunShadow.ts).
 *
 * Both live on one texel grid in the light's view, so the per-frame map is
 * an exact whole-texel crop of the cached one and its depth can be copied
 * across; both share the cached map's depth range for the same reason.
 */
import { Vector3 } from 'three';
import type { Rect } from '../world/city';

/** Tallest thing that casts or receives a shadow (12 m roofs + rooftop tanks), m. */
export const SHADOW_MAX_HEIGHT = 16;
/** Extra ground around the view, m (shadows of things just off-screen). */
const VIEW_MARGIN = 3;
/** Box half-sizes grow in steps of this, m. */
const SIZE_STEP = 6;
/** Room above the highest receiver for casters further up the light ray, m. */
const CASTER_REACH = 60;
/** Near plane of the light's camera, m. */
const NEAR = 1;
/**
 * The cached map is re-centred this far ahead of the way the view was
 * heading when it ran off (a share of the margin), so driving on in a
 * straight line gets nearly twice the margin before the next re-render.
 */
const LEAD = 0.75;

/** The light's camera axes, as three.js builds them for a DirectionalLight (lookAt with +Y up). */
export interface LightAxes {
  /** Right and up in the shadow map, and toward the light. */
  ax: Vector3;
  ay: Vector3;
  az: Vector3;
}

export function createLightAxes(): LightAxes {
  return { ax: new Vector3(1, 0, 0), ay: new Vector3(0, 1, 0), az: new Vector3(0, 0, 1) };
}

const UP = new Vector3(0, 1, 0);

/** Axes for a light shining from `toLight` (toward the light; needn't be unit length). */
export function lightAxes(toLight: Vector3, out: LightAxes): LightAxes {
  out.az.copy(toLight).normalize();
  out.ax.crossVectors(UP, out.az);
  if (out.ax.lengthSq() < 1e-8) out.ax.set(1, 0, 0); // light straight overhead
  out.ax.normalize();
  out.ay.crossVectors(out.az, out.ax);
  return out;
}

/** The per-frame shadow window: a box on the light's texel grid. */
export interface ShadowWindow {
  /** Half-sizes, m (in steps of SIZE_STEP, so zooming doesn't resize it every frame). */
  halfWidth: number;
  halfHeight: number;
  /** One texel, m. */
  texelX: number;
  texelY: number;
  /** Centre, in whole texels along ax and ay. */
  ix: number;
  iy: number;
  /** Depth (along az) of the lowest and highest receiver under it, m. */
  zLo: number;
  zHi: number;
  /** Fits in a row a smaller size would have done (see `settle`). */
  smallerFor: number;
}

export function createShadowWindow(): ShadowWindow {
  return { halfWidth: 0, halfHeight: 0, texelX: 1, texelY: 1, ix: 0, iy: 0, zLo: 0, zHi: 0, smallerFor: 0 };
}

const p = new Vector3();

/**
 * Fit the window over the ground rectangle `view` (plus a margin) and
 * everything up to SHADOW_MAX_HEIGHT on it, for a `mapSize`² map. The centre
 * snaps to whole texels, so shadow edges stay still instead of crawling as
 * the camera moves. With `settle` > 0 the window (refitted each frame in
 * `out`) grows at once but shrinks only after that many fits in a row that a
 * smaller size would have done: the camera eases its zoom in and out with
 * speed, and every size change re-snaps all the shadows (and redraws the
 * cached map).
 */
export function fitShadowWindow(view: Rect, axes: LightAxes, mapSize: number, out: ShadowWindow, settle = 0): ShadowWindow {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < 8; i++) {
    p.set(
      i & 1 ? view.maxX + VIEW_MARGIN : view.minX - VIEW_MARGIN,
      i & 4 ? SHADOW_MAX_HEIGHT : 0,
      i & 2 ? view.maxZ + VIEW_MARGIN : view.minZ - VIEW_MARGIN,
    );
    const x = p.dot(axes.ax);
    const y = p.dot(axes.ay);
    const z = p.dot(axes.az);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const halfWidth = Math.ceil((maxX - minX) / 2 / SIZE_STEP) * SIZE_STEP;
  const halfHeight = Math.ceil((maxY - minY) / 2 / SIZE_STEP) * SIZE_STEP;
  if (settle <= 0) {
    out.halfWidth = halfWidth;
    out.halfHeight = halfHeight;
  } else {
    out.smallerFor = halfWidth < out.halfWidth || halfHeight < out.halfHeight ? out.smallerFor + 1 : 0;
    if (out.smallerFor > settle) {
      out.halfWidth = halfWidth;
      out.halfHeight = halfHeight;
      out.smallerFor = 0;
    } else {
      out.halfWidth = Math.max(out.halfWidth, halfWidth);
      out.halfHeight = Math.max(out.halfHeight, halfHeight);
    }
  }
  out.texelX = (2 * out.halfWidth) / mapSize;
  out.texelY = (2 * out.halfHeight) / mapSize;
  out.ix = Math.round((minX + maxX) / 2 / out.texelX);
  out.iy = Math.round((minY + maxY) / 2 / out.texelY);
  out.zLo = minZ;
  out.zHi = maxZ;
  return out;
}

/** Depth range a light camera needs over receivers from zLo to zHi (far − near), m. */
export function depthRange(zLo: number, zHi: number): number {
  return zHi - zLo + CASTER_REACH + 2 - NEAR;
}

/** The cached static map's window: the per-frame grid, `margin` texels wider on every side. */
export interface StaticWindow {
  /** Per-frame map size and half-sizes it was planned for (the grid: a change means a new plan). */
  mapSize: number;
  halfWidth: number;
  halfHeight: number;
  texelX: number;
  texelY: number;
  /** Extra texels on each side; the map is mapSize + 2 * margin square. */
  margin: number;
  ix: number;
  iy: number;
  zLo: number;
  zHi: number;
  /** Ground under it (every view it can serve lies on it: its static props are drawn), m. */
  ground: Rect;
}

export function createStaticWindow(): StaticWindow {
  return {
    mapSize: 0,
    halfWidth: 0,
    halfHeight: 0,
    texelX: 1,
    texelY: 1,
    margin: 0,
    ix: 0,
    iy: 0,
    zLo: 0,
    zHi: 0,
    ground: { minX: 0, minZ: 0, maxX: 0, maxZ: 0 },
  };
}

/** Why the static map must be drawn again (null: the cached one still serves). */
export type StaticReason = 'size' | 'moved' | 'depth' | null;

/** Does the cached window still hold the per-frame window `w` (same grid, inside its margin and depth range)? */
export function staticCovers(s: StaticWindow, w: ShadowWindow, mapSize: number): StaticReason {
  if (s.mapSize !== mapSize || s.halfWidth !== w.halfWidth || s.halfHeight !== w.halfHeight) return 'size';
  if (Math.abs(w.ix - s.ix) > s.margin || Math.abs(w.iy - s.iy) > s.margin) return 'moved';
  if (w.zLo < s.zLo || w.zHi > s.zHi) return 'depth';
  return null;
}

/**
 * Plan the cached window around the per-frame window `w`. If the previous
 * plan was on the same grid, lead toward where the view has been going
 * (its offset from the old centre), keeping `w` inside the margin.
 */
export function planStaticWindow(w: ShadowWindow, mapSize: number, margin: number, axes: LightAxes, s: StaticWindow): StaticWindow {
  let leadX = 0;
  let leadY = 0;
  if (s.mapSize === mapSize && s.halfWidth === w.halfWidth && s.halfHeight === w.halfHeight && s.margin === margin) {
    const most = Math.floor(LEAD * margin);
    leadX = Math.max(-most, Math.min(most, Math.round(LEAD * (w.ix - s.ix))));
    leadY = Math.max(-most, Math.min(most, Math.round(LEAD * (w.iy - s.iy))));
  }
  s.mapSize = mapSize;
  s.halfWidth = w.halfWidth;
  s.halfHeight = w.halfHeight;
  s.texelX = w.texelX;
  s.texelY = w.texelY;
  s.margin = margin;
  s.ix = w.ix + leadX;
  s.iy = w.iy + leadY;
  // Ground under the window: each corner traced back along the light to the
  // ground (where every view it can serve lies) and to SHADOW_MAX_HEIGHT
  // (everything it holds, for the depth range).
  const hx = (mapSize / 2 + margin) * w.texelX;
  const hy = (mapSize / 2 + margin) * w.texelY;
  const cx = s.ix * w.texelX;
  const cy = s.iy * w.texelY;
  const { ax, ay, az } = axes;
  const det = ax.x * ay.z - ax.z * ay.x;
  const g = s.ground;
  g.minX = g.minZ = Infinity;
  g.maxX = g.maxZ = -Infinity;
  let zLo = Infinity;
  let zHi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const X = i & 1 ? cx + hx : cx - hx;
    const h = i & 4 ? SHADOW_MAX_HEIGHT : 0;
    const Y = (i & 2 ? cy + hy : cy - hy) - h * ay.y;
    // Solve gx*ax.x + gz*ax.z = X and gx*ay.x + gz*ay.z = Y (ax is level).
    const gx = (X * ay.z - Y * ax.z) / det;
    const gz = (Y * ax.x - X * ay.x) / det;
    if (h === 0) {
      g.minX = Math.min(g.minX, gx);
      g.maxX = Math.max(g.maxX, gx);
      g.minZ = Math.min(g.minZ, gz);
      g.maxZ = Math.max(g.maxZ, gz);
    }
    // Both heights at this ground point: the box over the window's ground.
    for (let j = 0; j < 2; j++) {
      const z = p.set(gx, j * SHADOW_MAX_HEIGHT, gz).dot(az);
      zLo = Math.min(zLo, z);
      zHi = Math.max(zHi, z);
    }
  }
  s.zLo = Math.min(zLo, w.zLo);
  s.zHi = Math.max(zHi, w.zHi);
  return s;
}

/** A light camera: where it looks from and to, and its depth range. */
export interface LightCamera {
  position: Vector3;
  target: Vector3;
  near: number;
  far: number;
}

export function createLightCamera(): LightCamera {
  return { position: new Vector3(), target: new Vector3(), near: NEAR, far: 100 };
}

/**
 * The camera for a window centred on texel (ix, iy) of `s`'s grid, with
 * `s`'s depth range: the cached and the per-frame camera differ only by a
 * whole-texel slide across the light's view, so depths match exactly.
 */
export function lightCamera(s: StaticWindow, ix: number, iy: number, axes: LightAxes, out: LightCamera): LightCamera {
  const cz = (s.zLo + s.zHi) / 2;
  out.target
    .copy(axes.ax)
    .multiplyScalar(ix * s.texelX)
    .addScaledVector(axes.ay, iy * s.texelY)
    .addScaledVector(axes.az, cz);
  const lift = s.zHi - cz + CASTER_REACH;
  out.position.copy(out.target).addScaledVector(axes.az, lift);
  out.near = NEAR;
  out.far = lift + (cz - s.zLo) + 2;
  return out;
}

/**
 * How far the shadow of a point SHADOW_MAX_HEIGHT up moves on the ground
 * between light directions `a` and `b` (toward the light), m: the most any
 * cached shadow is off when the sun has moved from `a` to `b`.
 */
export function sunShift(a: Vector3, b: Vector3): number {
  const ay = Math.max(1e-3, a.y);
  const by = Math.max(1e-3, b.y);
  return SHADOW_MAX_HEIGHT * Math.hypot(a.x / ay - b.x / by, a.z / ay - b.z / by);
}
