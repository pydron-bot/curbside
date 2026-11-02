/**
 * The sun's shadow map, fitted every frame to what the camera can see, with
 * the static casters cached.
 *
 * The camera looks almost straight down at a patch of ground (~40×20 m on
 * foot, up to ~140×65 m at speed), so one orthographic shadow box over that
 * patch gives sharp shadows with a modest map (render/shadowWindow.ts: sized
 * in coarse steps, its centre snapped to whole texels so edges don't crawl).
 *
 * Buildings, rooftop kit, street furniture, trees and landmarks never move,
 * so they are drawn into a second, larger map (a margin of a quarter of the
 * map each side, same texel grid) only when that stops serving: the view's
 * window leaves the margin or changes size, the sun has moved a 16 m shadow
 * tip a texel, or the static content changed (a prop knocked over, the
 * models arriving, a lost context). Every frame the per-frame map starts as
 * a whole-texel crop of it (a depth blit) and only the moving casters (cars,
 * people, things, rubble...) are drawn on top; the lit shaders sample that
 * one map exactly as before, at the same size, softness and bias.
 *
 * The light keeps the direction the cache was drawn with (it moves in steps
 * of at most a texel at the tip of the tallest shadow). Quality tiers
 * change the map size; turning shadows off at runtime ('low') only fades and
 * stops the shadow pass, because toggling castShadow on the light would
 * recompile every lit material mid-play.
 */
import {
  DepthTexture,
  DirectionalLight,
  NearestFilter,
  Object3D,
  RedFormat,
  UnsignedByteType,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Light,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { Rect } from '../world/city';
import type { PropBatch } from './propBatch';
import { getQuality, onQualityChange } from './quality';
import {
  createLightAxes,
  createLightCamera,
  createShadowWindow,
  createStaticWindow,
  depthRange,
  fitShadowWindow,
  lightAxes,
  lightCamera,
  planStaticWindow,
  staticCovers,
  sunShift,
} from './shadowWindow';

export { SHADOW_MAX_HEIGHT } from './shadowWindow';

/** The cached map's margin on each side, as a share of the per-frame map. */
const MARGIN_SHARE = 0.25;
/**
 * The cache redraws once the sun has moved the shadow of a point 16 m up
 * (the top of the tallest rooftop kit) this many texels: the 12 m roofs'
 * shadows move three quarters of it, about what an edge's texel staircase
 * shifts by anyway, and PCF spreads every edge over ~5 texels.
 */
const SUN_TOLERANCE = 1;
/** The window shrinks after a smaller one would have done for this many frames in a row (it grows at once). */
const SETTLE_FRAMES = 45;
/** Depth bias in the units of a map fitted to the view alone (the cached range is deeper: scaled to the same metres). */
const BIAS = -0.0004;

export type StaticRedrawReason = 'content' | 'sun' | 'size' | 'moved' | 'depth';

/** How often the static casters were drawn again, and why (debug, harnesses). */
export interface ShadowStats {
  staticRenders: number;
  reasons: Record<StaticRedrawReason, number>;
}

type ShadowMapRender = WebGLRenderer['shadowMap']['render'];

/** Drives a DirectionalLight's shadow: fit, static cache, map size per quality tier, strength. */
export class SunShadow {
  readonly stats: ShadowStats = { staticRenders: 0, reasons: { content: 0, sun: 0, size: 0, moved: 0, depth: 0 } };
  private readonly axes = createLightAxes();
  private readonly win = createShadowWindow();
  private readonly cache = createStaticWindow();
  private readonly cam = createLightCamera();
  /** The light direction the cache was drawn with (and the light uses). */
  private readonly dir = new Vector3(0, 1, 0);
  private hasDir = false;
  /** Strength asked for by the time of day (0..1). */
  private strength = 1;
  private active: boolean;
  /** Per-frame map size in force (0: shadows off on this tier). */
  private size = 0;
  /** The cache must be drawn again (content changed, context restored, tier). */
  private dirty = true;
  /** A new cache plan waits to be drawn in this frame's shadow pass. */
  private pending = false;
  /** The cached map holds the current plan. */
  private drawn = false;
  /** Shadows went off: one last pass shrinks the map. */
  private shrink = false;
  private familyVersion = -1;
  private ox = 0;
  private oy = 0;
  private readonly statics: Object3D[] = [];
  private readonly families: PropBatch[] = [];
  private readonly hidden: Object3D[] = [];
  /** What the static pass walks: the static casters and the families' cache meshes, by reference (never their parent). */
  private readonly staticRoot = new Object3D();
  /** What the per-frame pass walks: the scene and the families' moving-prop meshes, by reference. */
  private readonly dynamicRoot = new Object3D();
  /** Draws the cached map; never in the scene, so no material sees a second light. */
  private readonly staticLight = new DirectionalLight();
  private readonly staticLights: Light[] = [this.staticLight];
  private staticTarget: WebGLRenderTarget | null = null;
  private baseRender!: ShadowMapRender;
  /** The shadow map whose render is hooked (three.js makes a new one on a restored context). */
  private hookedMap: WebGLRenderer['shadowMap'] | null = null;
  private readonly hooked: ShadowMapRender = (lights, scene, camera) => this.renderShadows(lights, scene, camera);
  private readonly baseClear: WebGLRenderer['clear'];
  /** Stands in for renderer.clear during the per-frame pass: the cached depth instead of a cleared one. */
  private readonly clearFromCache = (): void => {
    this.baseClear.call(this.renderer, true, false, false);
    if (!this.blit()) this.baseClear.call(this.renderer, false, true, false);
  };

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
    s.bias = BIAS;
    s.normalBias = 0.04;
    s.radius = 2.5;
    this.baseClear = renderer.clear;
    this.hook();
    // three.js makes a new shadow map on a restored context: hook that one
    // (update() checks too); and whatever was rendered into a target is gone.
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.hook();
      this.invalidate();
    });
    onQualityChange(() => this.applyTier());
    this.applyTier();
  }

  /** Every shadow pass goes through renderShadows (three.js calls it from render()). */
  private hook(): void {
    const sm = this.renderer.shadowMap;
    if (sm === this.hookedMap) return;
    this.hookedMap = sm;
    this.baseRender = sm.render;
    sm.render = this.hooked;
  }

  /** Casters that never move (the city mesh): drawn into the cache only. */
  addStatic(object: Object3D): void {
    this.statics.push(object);
    this.dirty = true;
  }

  /** A prop family whose static props go into the cache (its per-frame props, if any, draw every frame on their own). */
  addStaticFamily(family: PropBatch): void {
    this.families.push(family);
    this.dirty = true;
  }

  /** The static casters changed (e.g. stand-ins removed): draw the cache again. */
  invalidate(): void {
    this.dirty = true;
    this.drawn = false;
  }

  /** Shadow darkness from the time of day (fades out as the light does). */
  setStrength(strength: number): void {
    this.strength = strength;
    this.applyStrength();
  }

  /** Refit the shadow window to the visible ground; call once per frame before rendering. */
  update(view: Rect, toLight: Vector3): void {
    if (!this.active) return;
    this.hook();
    if (this.size === 0) return;
    const n = this.size;
    if (!this.hasDir) {
      this.hasDir = true;
      lightAxes(this.dir.copy(toLight), this.axes);
    }
    let version = 0;
    for (let i = 0; i < this.families.length; i++) version += this.families[i].staticVersion;
    const w = fitShadowWindow(view, this.axes, n, this.win, SETTLE_FRAMES);
    let reason: StaticRedrawReason | null = null;
    if (this.dirty || version !== this.familyVersion) reason = 'content';
    else if (sunShift(this.dir, toLight) > SUN_TOLERANCE * Math.min(w.texelX, w.texelY)) reason = 'sun';
    else reason = staticCovers(this.cache, w, n);
    if (reason) {
      this.stats.staticRenders++;
      this.stats.reasons[reason]++;
      if (!this.dir.equals(toLight)) {
        lightAxes(this.dir.copy(toLight), this.axes);
        fitShadowWindow(view, this.axes, n, w, SETTLE_FRAMES);
      }
      this.planCache(n);
      this.dirty = false;
      this.familyVersion = version;
    }

    const c = this.cache;
    const cam = lightCamera(c, w.ix, w.iy, this.axes, this.cam);
    this.light.position.copy(cam.position);
    this.light.target.position.copy(cam.target);
    this.light.target.updateMatrixWorld();
    const s = this.light.shadow;
    fitCamera(s.camera, w.halfWidth, w.halfHeight, cam.near, cam.far);
    // Same bias in metres as a map fitted to this view alone.
    s.bias = (BIAS * depthRange(w.zLo, w.zHi)) / depthRange(c.zLo, c.zHi);
    this.ox = w.ix - c.ix + c.margin;
    this.oy = w.iy - c.iy + c.margin;
  }

  /** Plan the cache around this frame's window and set up its pass. */
  private planCache(n: number): void {
    const margin = Math.round(n * MARGIN_SHARE);
    const c = planStaticWindow(this.win, n, margin, this.axes, this.cache);
    const size = n + 2 * margin;
    let t = this.staticTarget;
    if (!t) {
      // Depth is all it's for: a one-byte colour buffer (the pass needs one) keeps it small.
      t = new WebGLRenderTarget(size, size, {
        format: RedFormat,
        type: UnsignedByteType,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        generateMipmaps: false,
        stencilBuffer: false,
      });
      // The per-frame map's depth format (DEPTH_COMPONENT24), so the blit can copy it.
      t.depthTexture = new DepthTexture(size, size, UnsignedIntType);
      t.texture.name = 'sun.staticShadowMap';
      this.staticTarget = t;
      this.staticLight.shadow.map = t;
    } else if (t.width !== size) t.setSize(size, size);
    this.staticLight.shadow.mapSize.set(size, size);
    const cam = lightCamera(c, c.ix, c.iy, this.axes, this.cam);
    this.staticLight.position.copy(cam.position);
    this.staticLight.target.position.copy(cam.target);
    this.staticLight.updateMatrixWorld();
    this.staticLight.target.updateMatrixWorld();
    fitCamera(this.staticLight.shadow.camera, (n / 2 + margin) * c.texelX, (n / 2 + margin) * c.texelY, cam.near, cam.far);
    const casters = this.staticRoot.children;
    casters.length = 0;
    for (let i = 0; i < this.statics.length; i++) casters.push(this.statics[i]);
    for (let i = 0; i < this.families.length; i++) this.families[i].fillShadowStatics(c.ground, casters);
    this.pending = true;
  }

  /** In place of three.js's shadow pass (same signature): the cache when due, then the per-frame map. */
  private renderShadows(lights: Light[], scene: Scene, camera: Camera): void {
    const sm = this.renderer.shadowMap;
    if (!this.active || lights.length !== 1 || lights[0] !== this.light) {
      this.baseRender.call(sm, lights, scene, camera);
      return;
    }
    if (this.size === 0) {
      if (!this.shrink) return;
      this.shrink = false;
      sm.needsUpdate = true;
      this.baseRender.call(sm, lights, scene, camera);
      return;
    }
    if (this.pending && this.staticTarget) {
      this.pending = false;
      sm.needsUpdate = true;
      this.baseRender.call(sm, this.staticLights, this.staticRoot as Scene, camera);
      this.drawn = true;
    }
    sm.needsUpdate = true;
    if (!this.drawn || !this.framebuffer(this.staticTarget)) {
      // No cache to start from: every caster, as before caching.
      this.baseRender.call(sm, lights, scene, camera);
      return;
    }
    const hidden = this.hidden;
    for (let i = 0; i < this.statics.length; i++) {
      const o = this.statics[i];
      if (!o.visible) continue;
      o.visible = false;
      hidden.push(o);
    }
    // The scene, and the static families' props for this frame only (which are not in it).
    const casters = this.dynamicRoot.children;
    casters.length = 0;
    casters.push(scene);
    for (let i = 0; i < this.families.length; i++) {
      const f = this.families[i];
      const moving = f.movingShadow();
      if (moving) casters.push(moving);
      if (!f.mesh.visible) continue;
      f.mesh.visible = false;
      hidden.push(f.mesh);
    }
    this.renderer.clear = this.clearFromCache;
    try {
      this.baseRender.call(sm, lights, this.dynamicRoot as Scene, camera);
    } finally {
      this.renderer.clear = this.baseClear;
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
      hidden.length = 0;
    }
  }

  /** Copy this frame's crop of the cached depth into the per-frame map (bound now). False if either isn't on the GPU. */
  private blit(): boolean {
    const src = this.framebuffer(this.staticTarget);
    const dst = this.framebuffer(this.light.shadow.map);
    if (!src || !dst) return false;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const n = this.size;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
    gl.blitFramebuffer(this.ox, this.oy, this.ox + n, this.oy + n, 0, 0, n, n, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    // Back to reading what is drawn to, as three.js left it (it binds both at once).
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, dst);
    return true;
  }

  private framebuffer(target: object | null): WebGLFramebuffer | undefined {
    if (!target) return undefined;
    return (this.renderer.properties.get(target) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer;
  }

  private applyTier(): void {
    if (!this.active) return;
    const size = getQuality().shadowMapSize;
    // renderShadows asks for every pass itself.
    this.renderer.shadowMap.autoUpdate = false;
    if (size > 0) {
      this.light.shadow.mapSize.set(size, size);
      this.size = size;
    } else {
      // Shrink the map with one last pass, then leave it idle (and unseen:
      // intensity 0), and free the cache.
      this.light.shadow.mapSize.set(256, 256);
      this.size = 0;
      this.shrink = true;
      this.staticTarget?.dispose();
      this.staticTarget?.depthTexture?.dispose();
    }
    this.invalidate();
    this.applyStrength();
  }

  private applyStrength(): void {
    this.light.shadow.intensity = this.active && getQuality().shadowMapSize > 0 ? this.strength : 0;
  }
}

/** Set an orthographic light camera's box, recomputing its projection only on a change. */
function fitCamera(
  cam: { left: number; right: number; top: number; bottom: number; near: number; far: number; updateProjectionMatrix(): void },
  halfWidth: number,
  halfHeight: number,
  near: number,
  far: number,
): void {
  if (cam.right === halfWidth && cam.top === halfHeight && cam.near === near && cam.far === far) return;
  cam.left = -halfWidth;
  cam.right = halfWidth;
  cam.bottom = -halfHeight;
  cam.top = halfHeight;
  cam.near = near;
  cam.far = far;
  cam.updateProjectionMatrix();
}
