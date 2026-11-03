import {
  type BufferGeometry,
  AddEquation,
  BoxGeometry,
  Color,
  CustomBlending,
  DynamicDrawUsage,
  Group,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LessEqualDepth,
  LinearFilter,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { TILES_X, TILES_Y, coverShare, emptyCover, lowResPays, lowResSize, occluderChunks, particleCover, type TargetSize } from './lowResFxPlan';
import type { Rect } from '../world/city';
import { isHdr } from './post';
import { getQuality } from './quality';

/** What Effects hands over: its soft particles, two meshes on one geometry. */
export interface LowResSource {
  /** In the scene: drawn at full resolution when the offscreen path doesn't pay. */
  readonly main: Mesh;
  /** The offscreen pass: colour plus weighted depth (two outputs). */
  readonly offscreen: Mesh;
  /** This frame's instances (fxParticles' InstanceBuffer). */
  readonly instances: { readonly pos: Float32Array; readonly axis: Float32Array; readonly count: number };
}

/** For the perf overlay and the mayhem harness. */
export interface LowResStats {
  /** Drawn offscreen this frame. */
  active: boolean;
  /** The tier's scale (1 where the browser can't render the depth target). */
  scale: number;
  /** The soft particles' fill at full resolution, screens. */
  fill: number;
  /** The share of the screen the composite covers (its tiles). */
  share: number;
  width: number;
  height: number;
}

/** Testing and screenshots: 'auto' decides per frame (lowResPays); 'off' and 'on' force a path. */
export type LowResMode = 'auto' | 'off' | 'on';

/**
 * Smoke and dust at half (or quarter) resolution. On a phone heavy mayhem is
 * fill-bound: big translucent smoke quads stacked several screens deep, each
 * fragment tone-mapped and blended into 4× MSAA. When it pays (lowResPays),
 * the soft particles are drawn before the scene into a small target with no
 * MSAA, with the same premultiplied "over" blending, and a composite over just
 * the screen tiles they touch lays the result over the scene as its last
 * transparent (where the smoke was drawn before, over the fire).
 *
 * Buildings still hide smoke behind them, puff by puff: the offscreen pass
 * first lays down the depth of every building as a plain box (one instanced
 * draw, depth only) and the particles are depth-tested against it as they
 * were against the scene. That low-resolution edge would bleed a texel of
 * smoke onto a building's silhouette, so a second output gathers the
 * smoke's view depth weighted as its colour is, and the composite, at full
 * resolution, writes that average depth and is depth-tested against the
 * real scene (biased toward the camera, so only something a storey high
 * cuts it): the cut follows the scene's own antialiased edges, no halo.
 *
 * The colour target holds what the canvas would: on phones (tone mapping
 * inside the materials) the particles are tone-mapped and encoded into it
 * exactly as onto the canvas (the three.js XR-target rule below) and blend in
 * display space as before; with the desktop HDR pipeline it is linear half
 * float like the scene's buffer. Nothing compiles mid-play: precompile()
 * builds the offscreen program up front, whatever the tier.
 */
export class LowResFx {
  /** Lays the offscreen particles over the scene (in the scene, renderOrder 4). */
  readonly composite: Mesh;
  readonly stats: LowResStats = { active: false, scale: 1, fill: 0, share: 0, width: 0, height: 0 };
  mode: LowResMode = 'auto';
  private readonly scene = new Scene();
  private readonly hdr: boolean;
  /** Half-float colour targets render here (the depth output needs them). */
  private readonly supported: boolean;
  private source: LowResSource | null = null;
  private target: WebGLRenderTarget | null = null;
  private wasOn = false;
  private readonly cover = emptyCover();
  /** The covered tiles' indices, the composite's instances. */
  private readonly tileAttr: InstancedBufferAttribute;
  private readonly size: TargetSize = { width: 0, height: 0 };
  private readonly drawing = new Vector2();
  private readonly viewProj = new Matrix4();
  private readonly clearColour = new Color();
  private readonly uniforms = {
    tColor: { value: null as unknown },
    tDepth: { value: null as unknown },
    uTileSize: { value: new Vector2(2 / TILES_X, 2 / TILES_Y) },
    uInvFull: { value: new Vector2(1, 1) },
    uProj: { value: new Vector2(-1, -2) },
  };

  private occluders: Group;

  /** The map editor's live rebuild: new occluders for new buildings (the same box and material). */
  setBuildings(buildings: ReadonlyArray<Rect & { height: number }>): void {
    const old = this.occluders;
    const first = old.children[0] as InstancedMesh | undefined;
    this.occluders = buildingBoxes(buildings, first?.geometry, first?.material as ShaderMaterial | undefined);
    for (const m of old.children as InstancedMesh[]) m.dispose();
    old.removeFromParent();
    this.scene.add(this.occluders);
  }

  /** `buildings`: boxes from the ground up to `height`, the occluders the offscreen pass knows. */
  constructor(
    private readonly renderer: WebGLRenderer,
    buildings: ReadonlyArray<Rect & { height: number }>,
  ) {
    this.hdr = isHdr(renderer);
    this.occluders = buildingBoxes(buildings);
    this.scene.add(this.occluders);
    const ext = renderer.extensions;
    this.supported = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    const plane = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    this.tileAttr = new InstancedBufferAttribute(new Float32Array(TILES_X * TILES_Y * 2), 2).setUsage(DynamicDrawUsage);
    geo.setAttribute('aTile', this.tileAttr);
    geo.instanceCount = 0;
    this.composite = new Mesh(geo, compositeMaterial(this.uniforms));
    this.composite.frustumCulled = false;
    this.composite.visible = false;
    this.composite.renderOrder = 4;
    this.composite.name = 'fxComposite';
  }

  /** Take over Effects' soft particles. */
  attach(source: LowResSource): void {
    this.source = source;
    this.scene.add(source.offscreen);
  }

  /**
   * Before the scene pass: decide, and if it pays draw the soft particles
   * offscreen and switch the scene from them to the composite.
   */
  render(camera: Camera): void {
    const src = this.source;
    const st = this.stats;
    st.active = false;
    if (!src) return;
    const n = src.instances.count;
    const scale = this.supported && this.mode !== 'off' ? getQuality().fxScale : 1;
    st.scale = scale;
    st.fill = 0;
    st.share = 0;
    let on = false;
    if (n > 0 && scale < 1) {
      camera.updateMatrixWorld();
      this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const p = camera.projectionMatrix.elements;
      const c = particleCover(src.instances.pos, src.instances.axis, n, this.viewProj.elements, p[0], p[5], this.cover);
      st.fill = c.fill;
      st.share = coverShare(c);
      on = c.covered > 0 && (this.mode === 'on' || lowResPays(c.fill, st.share, scale, this.wasOn));
    }
    this.wasOn = on;
    src.main.visible = n > 0 && !on;
    src.offscreen.visible = on;
    this.composite.visible = on;
    if (!on) return;

    const target = this.fit(scale);
    const r = this.renderer;
    const previous = r.getRenderTarget();
    const autoClear = r.autoClear;
    r.getClearColor(this.clearColour);
    const clearAlpha = r.getClearAlpha();
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.autoClear = false;
    // Buildings' depth first (opaque), then the particles.
    r.render(this.scene, camera);
    r.autoClear = autoClear;
    r.setClearColor(this.clearColour, clearAlpha);
    r.setRenderTarget(previous);

    // The composite: one instance per covered tile.
    const tiles = this.cover.tiles;
    const a = this.tileAttr.array as Float32Array;
    let k = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (!tiles[i]) continue;
      a[k * 2] = i % TILES_X;
      a[k * 2 + 1] = Math.floor(i / TILES_X);
      k++;
    }
    (this.composite.geometry as InstancedBufferGeometry).instanceCount = k;
    this.tileAttr.needsUpdate = true;
    const p = camera.projectionMatrix.elements;
    this.uniforms.uProj.value.set(p[10], p[14]);
    this.uniforms.uInvFull.value.set(1 / this.drawing.x, 1 / this.drawing.y);
    st.active = true;
  }

  /**
   * Compile the offscreen program against the real target (the composite is
   * in the scene, so the scene's precompile covers it). Run with the scene's:
   * at boot and after a lost context, whatever the tier, since
   * DynamicResolution can step down to an offscreen tier mid-play.
   */
  precompile(camera: Camera): void {
    if (!this.source || !this.supported) return;
    const target = this.fit(Math.min(0.5, getQuality().fxScale));
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.compile(this.scene, camera);
    this.renderer.setRenderTarget(previous);
  }

  /** The target at `scale` of the drawing buffer now (created once, resized with DynamicResolution). */
  private fit(scale: number): WebGLRenderTarget {
    this.renderer.getDrawingBufferSize(this.drawing);
    const s = lowResSize(this.drawing.x, this.drawing.y, scale, this.size);
    let t = this.target;
    if (!t) {
      t = this.createTarget(s.width, s.height);
      this.target = t;
      this.uniforms.tColor.value = t.textures[0];
      this.uniforms.tDepth.value = t.textures[1];
    } else if (t.width !== s.width || t.height !== s.height) {
      t.setSize(s.width, s.height);
    }
    this.stats.width = s.width;
    this.stats.height = s.height;
    return t;
  }

  /** Colour (as the scene's buffer holds it) and weighted depth (half float: a·w, a). */
  private createTarget(width: number, height: number): WebGLRenderTarget {
    const t = new WebGLRenderTarget(width, height, {
      count: 2,
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
    });
    if (!this.hdr) {
      // three.js tone-maps and sRGB-encodes in the materials only when
      // drawing to the canvas, or to an XR target (in that target's colour
      // space). Marking ours as one keeps the particles' look exactly the
      // canvas's, blending in display space. 8 bits like the canvas, RGBA8
      // rather than SRGB8_ALPHA8 so the hardware doesn't encode twice.
      const colour = t.textures[0];
      colour.type = UnsignedByteType;
      colour.colorSpace = SRGBColorSpace;
      colour.internalFormat = 'RGBA8';
      (t as WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    }
    return t;
  }
}

/** The composite's depth test treats the smoke as this much nearer, m (taller than a car, lower than a storey). */
const COMPOSITE_BIAS = 3;

/**
 * Every building as a box, depth only: what hides smoke in the offscreen
 * pass. One batch per 256 m chunk, culled whole, so a bigger city (W3-A)
 * draws only the boxes round the camera.
 */
function buildingBoxes(buildings: ReadonlyArray<Rect & { height: number }>, box?: BufferGeometry, mat?: ShaderMaterial): Group {
  const geo = box ?? new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const material = mat ?? new ShaderMaterial({
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      void main() {
        gl_FragColor = vec4(0.0);
      }`,
    colorWrite: false,
  });
  const group = new Group();
  group.name = 'fxOccluders';
  const m = new Matrix4();
  for (const chunk of occluderChunks(buildings)) {
    const mesh = new InstancedMesh(geo, material, chunk.length);
    chunk.forEach((b, i) => {
      m.makeScale(b.maxX - b.minX, b.height, b.maxZ - b.minZ);
      m.setPosition((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
      mesh.setMatrixAt(i, m);
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

/**
 * The composite: a quad per covered tile (one instanced draw) that lays the
 * offscreen colour (premultiplied, bilinear) over the scene at the smoke's
 * average depth, so the scene's depth test hides it behind buildings. Raw
 * output: the target already holds display (or linear HDR) values like the
 * buffer it lands in.
 */
function compositeMaterial(uniforms: Record<string, { value: unknown }>): ShaderMaterial {
  return new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec2 aTile;
      uniform vec2 uTileSize;
      void main() {
        gl_Position = vec4((aTile + position.xy + 0.5) * uTileSize - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform vec2 uInvFull;
      uniform vec2 uProj;
      void main() {
        vec2 uv = gl_FragCoord.xy * uInvFull;
        vec4 c = texture2D(tColor, uv);
        vec4 d = texture2D(tDepth, uv);
        if (d.a < 0.002 && max(c.r, max(c.g, c.b)) < 0.002) discard;
        // The smoke's view depth (its weighted mean), brought COMPOSITE_BIAS nearer, to
        // window depth as the projection maps it. The offscreen pass already hid
        // the smoke behind buildings puff by puff; this only stops a texel of it
        // bleeding onto their silhouettes, and the bias keeps cars and people
        // from notching smoke that drifts over them.
        float w = max(d.r / max(d.a, 1e-4) - ${COMPOSITE_BIAS.toFixed(1)}, 0.1);
        gl_FragDepth = clamp((uProj.y / w - uProj.x) * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = c;
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: LessEqualDepth,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
}
