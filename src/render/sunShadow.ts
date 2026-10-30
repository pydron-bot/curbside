/**
 * The sun's shadow map, fitted every frame to what the camera can see.
 *
 * The camera looks almost straight down at a patch of ground (~40×20 m on
 * foot, up to ~140×65 m at speed), so one orthographic shadow box over that
 * patch gives sharp shadows with a modest map. The box is sized in coarse
 * steps (so zooming doesn't resize it every frame) and its centre is snapped
 * to whole shadow texels, so shadow edges stay still instead of crawling as
 * the camera moves.
 *
 * Quality tiers change the map size; turning shadows off at runtime ('low')
 * only fades and stops the shadow pass, because toggling castShadow would
 * recompile every lit material mid-play.
 */
import { Vector3, type DirectionalLight, type WebGLRenderer } from 'three';
import type { Rect } from '../world/city';
import { getQuality, onQualityChange } from './quality';

/** Tallest thing that casts or receives a shadow (12 m roofs + rooftop tanks), m. */
export const SHADOW_MAX_HEIGHT = 16;
/** Extra ground around the view, m (shadows of things just off-screen). */
const VIEW_MARGIN = 3;
/** Box half-sizes grow in steps of this, m. */
const SIZE_STEP = 6;
/** Room above the highest receiver for casters further up the light ray, m. */
const CASTER_REACH = 60;

export interface ShadowBox {
  /** Where the light looks (the box centre) and where the light sits. */
  target: Vector3;
  position: Vector3;
  halfWidth: number;
  halfHeight: number;
  near: number;
  far: number;
  /** World-space size of one shadow texel, m (x, y of the light's view). */
  texelX: number;
  texelY: number;
}

export function createShadowBox(): ShadowBox {
  return { target: new Vector3(), position: new Vector3(), halfWidth: 1, halfHeight: 1, near: 1, far: 100, texelX: 1, texelY: 1 };
}

const UP = new Vector3(0, 1, 0);
const ax = new Vector3();
const ay = new Vector3();
const az = new Vector3();
const p = new Vector3();

/**
 * Fit an orthographic shadow box over the ground rectangle `view` for a light
 * shining from direction `toLight` (unit vector toward the light), with a
 * `mapSize`² shadow map. The box's light-space axes match what three.js uses
 * for a DirectionalLight (camera.lookAt with +Y up), so snapping lines up
 * with the real shadow texels.
 */
export function fitShadowBox(view: Rect, toLight: Vector3, mapSize: number, out: ShadowBox): ShadowBox {
  az.copy(toLight).normalize();
  ax.crossVectors(UP, az);
  if (ax.lengthSq() < 1e-8) ax.set(1, 0, 0); // light straight overhead
  ax.normalize();
  ay.crossVectors(az, ax);

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
    const x = p.dot(ax);
    const y = p.dot(ay);
    const z = p.dot(az);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const halfWidth = Math.ceil((maxX - minX) / 2 / SIZE_STEP) * SIZE_STEP;
  const halfHeight = Math.ceil((maxY - minY) / 2 / SIZE_STEP) * SIZE_STEP;
  const texelX = (2 * halfWidth) / mapSize;
  const texelY = (2 * halfHeight) / mapSize;
  const cx = Math.round((minX + maxX) / 2 / texelX) * texelX;
  const cy = Math.round((minY + maxY) / 2 / texelY) * texelY;
  const cz = (minZ + maxZ) / 2;

  out.target.copy(ax).multiplyScalar(cx).addScaledVector(ay, cy).addScaledVector(az, cz);
  const lift = maxZ - cz + CASTER_REACH;
  out.position.copy(out.target).addScaledVector(az, lift);
  out.halfWidth = halfWidth;
  out.halfHeight = halfHeight;
  out.near = 1;
  out.far = lift + (cz - minZ) + 2;
  out.texelX = texelX;
  out.texelY = texelY;
  return out;
}

/** Drives a DirectionalLight's shadow: fit, map size per quality tier, strength. */
export class SunShadow {
  private readonly box = createShadowBox();
  private readonly dir = new Vector3();
  /** Strength asked for by the time of day (0..1). */
  private strength = 1;
  private active: boolean;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly light: DirectionalLight,
  ) {
    const size = getQuality().shadowMapSize;
    // Decided once: a game started on 'low' never compiles shadow code. Later
    // tier changes only resize or idle the map (see the module comment).
    this.active = size > 0;
    renderer.shadowMap.enabled = this.active;
    light.castShadow = this.active;
    const s = light.shadow;
    s.mapSize.set(size || 512, size || 512);
    s.bias = -0.0004;
    s.normalBias = 0.04;
    s.radius = 2.5;
    onQualityChange(() => this.applyTier());
    this.applyTier();
  }

  /** Shadow darkness from the time of day (fades out as the light does). */
  setStrength(strength: number): void {
    this.strength = strength;
    this.applyStrength();
  }

  /** Refit the shadow box to the visible ground; call once per frame before rendering. */
  update(view: Rect, toLight: Vector3): void {
    if (!this.active) return;
    const s = this.light.shadow;
    fitShadowBox(view, this.dir.copy(toLight), s.mapSize.x, this.box);
    this.light.target.position.copy(this.box.target);
    this.light.position.copy(this.box.position);
    this.light.target.updateMatrixWorld();
    const cam = s.camera;
    if (
      cam.right !== this.box.halfWidth ||
      cam.top !== this.box.halfHeight ||
      cam.far !== this.box.far ||
      cam.near !== this.box.near
    ) {
      cam.left = -this.box.halfWidth;
      cam.right = this.box.halfWidth;
      cam.bottom = -this.box.halfHeight;
      cam.top = this.box.halfHeight;
      cam.near = this.box.near;
      cam.far = this.box.far;
      cam.updateProjectionMatrix();
    }
  }

  private applyTier(): void {
    if (!this.active) return;
    const size = getQuality().shadowMapSize;
    const on = size > 0;
    this.renderer.shadowMap.autoUpdate = on;
    if (on) this.light.shadow.mapSize.set(size, size);
    else {
      // Shrink the map with one last pass, then leave it idle (and unseen: intensity 0).
      this.light.shadow.mapSize.set(256, 256);
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.applyStrength();
  }

  private applyStrength(): void {
    this.light.shadow.intensity = this.active && getQuality().shadowMapSize > 0 ? this.strength : 0;
  }
}
