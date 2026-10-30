import {
  BoxGeometry,
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  MeshLambertMaterial,
  Quaternion,
  RGBADepthPacking,
  Vector3,
  type BufferGeometry,
  type IUniform,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Rect } from '../world/city';
import { SIGNAL_GLSL } from '../world/signals';
import { uploadRange } from './glowSprites';
import type { PropModels } from './propModels';
import { UB_COMMON, UB_STREET_LIGHT, after, replace, useWorldUniforms } from './shaderLib';

/** Floats per static instance: matrix (16), aProp (4), aTint (3). */
const STRIDE = 23;
/** Static instances are bucketed in square cells this size for culling, m. */
const CELL = 32;
/** Static props this far outside the visible ground still draw (their shadows reach in), m. */
const MARGIN = 14;

/** Uniforms every prop family shares (the traffic lights' clock). */
export const propUniforms = {
  /** The traffic signals' clock (TrafficSignals.time), s. */
  uSignalTime: { value: 0 },
} satisfies Record<string, IUniform>;

/**
 * A family of props drawn as ONE instanced mesh: the family's models (a
 * street lamp, or a hydrant, a bench, a bin...) are merged into one
 * geometry with each vertex tagged by which model it belongs to, and every
 * instance says which model it is; the vertex shader drops the vertices of
 * the other models (they collapse outside the view and are never
 * rasterised). So a whole family costs one draw call (and one in the shadow
 * pass) however many kinds are on screen, at the price of running the
 * other models' vertices through a two-line early-out.
 *
 * Static instances (street furniture, rooftop kit) are added once, bucketed
 * in 32 m cells, and copied into the instance buffers only when the view
 * moves into new cells (or one is hidden: a knocked-over bin); dynamic ones
 * (spinning pickups, roadblock barriers) are added every frame after them.
 * Nothing outside the view is drawn, and nothing allocates per frame.
 *
 * Per instance: `aProp` = (kind, phase, road, glow): kind picks the model;
 * phase and road drive animated surfaces (a traffic light's cycle offset and
 * which road it faces, a warning light's blink); glow is extra self-light
 * in the vertex colour (pickups pop at night). `aTint` colours surfaces
 * that take one (debris in the car's paint, a frenzy gem's purple or gold).
 */
export class PropBatch {
  readonly mesh: InstancedMesh;
  readonly kinds: readonly string[];
  private readonly index = new Map<string, number>();
  private readonly prop: InstancedBufferAttribute;
  private readonly tint: InstancedBufferAttribute;
  private readonly matrix = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  // Static instances, struct-of-arrays in one buffer (grown while placing, fixed after).
  private sData = new Float32Array(STRIDE * 256);
  private sX = new Float32Array(256);
  private sZ = new Float32Array(256);
  private sHidden = new Uint8Array(256);
  private sCount = 0;
  private cells: Map<number, number[]> | null = null;
  /** Static instances in the buffers now, and the cell range they came from. */
  private shown = 0;
  private cx0 = 1;
  private cz0 = 1;
  private cx1 = 0;
  private cz1 = 0;
  private dirty = true;
  /** Dynamic instances this frame (after the static ones). */
  private dyn = 0;
  /** Draw even when empty for a couple of frames, so the programs compile and buffers upload up front. */
  private warm = 2;
  private ready = false;

  constructor(
    name: string,
    kinds: readonly string[],
    readonly capacity: number,
    opts: { shadows?: boolean; receiveShadows?: boolean } = {},
  ) {
    this.kinds = kinds;
    kinds.forEach((k, i) => this.index.set(k, i));
    const material = propMaterial();
    this.mesh = new InstancedMesh(placeholderGeometry(), material, capacity);
    this.mesh.name = `props_${name}`;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.prop = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    this.tint = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.mesh.geometry.setAttribute('aProp', this.prop);
    this.mesh.geometry.setAttribute('aTint', this.tint);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // culled per instance by cell
    this.mesh.castShadow = opts.shadows ?? true;
    this.mesh.receiveShadow = opts.receiveShadows ?? true;
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    depth.onBeforeCompile = (shader) => patchDepth(shader);
    depth.customProgramCacheKey = () => 'curbside-propfamily-depth';
    this.mesh.customDepthMaterial = depth;
  }

  /** The models arrived: merge the family's geometry (kinds missing from the files draw nothing). */
  setModels(models: PropModels): void {
    const parts: BufferGeometry[] = [];
    this.kinds.forEach((kind, k) => {
      const g = models.geometry(kind);
      if (!g) return;
      const geo = g.clone();
      geo.setAttribute('aKind', new BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(k), 1));
      parts.push(geo);
    });
    if (!parts.length) return;
    const merged = mergeGeometries(parts);
    if (!merged) return;
    merged.setAttribute('aProp', this.prop);
    merged.setAttribute('aTint', this.tint);
    const old = this.mesh.geometry;
    this.mesh.geometry = merged;
    old.dispose();
    this.ready = true;
    this.warm = 2;
    this.dirty = true;
  }

  /** Has the GLB arrived (until then the city's stand-ins show)? */
  get loaded(): boolean {
    return this.ready;
  }

  /** Index of a kind in this family (-1 if it isn't one of them). */
  kindOf(kind: string): number {
    return this.index.get(kind) ?? -1;
  }

  /**
   * A prop that never moves. Returns its handle (for hide()). Scale is per
   * axis in the model's frame; yaw turns its +Z toward (sin, cos).
   */
  addStatic(kind: string, x: number, y: number, z: number, yaw: number, sx = 1, sy = sx, sz = sx, phase = 0, road = 0, glow = 0, r = 1, g = 1, b = 1): number {
    const k = this.kindOf(kind);
    if (k < 0) return -1;
    const i = this.sCount++;
    if (i >= this.sX.length) this.grow();
    this.compose(x, y, z, yaw, sx, sy, sz);
    const o = i * STRIDE;
    this.sData.set(this.matrix.elements, o);
    this.sData[o + 16] = k;
    this.sData[o + 17] = phase;
    this.sData[o + 18] = road;
    this.sData[o + 19] = glow;
    this.sData[o + 20] = r;
    this.sData[o + 21] = g;
    this.sData[o + 22] = b;
    this.sX[i] = x;
    this.sZ[i] = z;
    this.cells = null;
    this.dirty = true;
    return i;
  }

  /** Hide (knocked over) or show a static prop again. */
  setHidden(handle: number, hidden: boolean): void {
    if (handle < 0 || handle >= this.sCount) return;
    const v = hidden ? 1 : 0;
    if (this.sHidden[handle] === v) return;
    this.sHidden[handle] = v;
    this.dirty = true;
  }

  /** Start a frame: bring the static instances in view into the buffers (only if the view changed cells). */
  begin(view: Rect): void {
    this.dyn = 0;
    if (!this.cells) this.bucket();
    const cx0 = Math.floor((view.minX - MARGIN) / CELL);
    const cz0 = Math.floor((view.minZ - MARGIN) / CELL);
    const cx1 = Math.floor((view.maxX + MARGIN) / CELL);
    const cz1 = Math.floor((view.maxZ + MARGIN) / CELL);
    if (!this.dirty && cx0 === this.cx0 && cz0 === this.cz0 && cx1 === this.cx1 && cz1 === this.cz1) return;
    this.dirty = false;
    this.cx0 = cx0;
    this.cz0 = cz0;
    this.cx1 = cx1;
    this.cz1 = cz1;
    const cap = this.capacity;
    const mat = this.mesh.instanceMatrix.array as Float32Array;
    const prop = this.prop.array as Float32Array;
    const tint = this.tint.array as Float32Array;
    const data = this.sData;
    let n = 0;
    for (let cx = cx0; cx <= cx1 && n < cap; cx++) {
      for (let cz = cz0; cz <= cz1 && n < cap; cz++) {
        const list = this.cells!.get(cellKey(cx, cz));
        if (!list) continue;
        for (let j = 0; j < list.length && n < cap; j++) {
          const i = list[j];
          if (this.sHidden[i]) continue;
          const o = i * STRIDE;
          for (let e = 0; e < 16; e++) mat[n * 16 + e] = data[o + e];
          prop[n * 4] = data[o + 16];
          prop[n * 4 + 1] = data[o + 17];
          prop[n * 4 + 2] = data[o + 18];
          prop[n * 4 + 3] = data[o + 19];
          tint[n * 3] = data[o + 20];
          tint[n * 3 + 1] = data[o + 21];
          tint[n * 3 + 2] = data[o + 22];
          n++;
        }
      }
    }
    this.shown = n;
    uploadRange(this.mesh.instanceMatrix, n);
    uploadRange(this.prop, n);
    uploadRange(this.tint, n);
  }

  /** A prop for this frame only (after begin()). */
  add(kind: string, x: number, y: number, z: number, yaw: number, sx = 1, sy = sx, sz = sx, phase = 0, glow = 0, r = 1, g = 1, b = 1): void {
    const k = this.kindOf(kind);
    const i = this.shown + this.dyn;
    if (k < 0 || i >= this.capacity) return;
    this.compose(x, y, z, yaw, sx, sy, sz);
    this.writeDynamic(i, k, phase, glow, r, g, b);
  }

  /** A prop for this frame with a full transform (tumbling debris). */
  addMatrix(kind: string, m: Matrix4, phase = 0, glow = 0, r = 1, g = 1, b = 1): void {
    const k = this.kindOf(kind);
    const i = this.shown + this.dyn;
    if (k < 0 || i >= this.capacity) return;
    this.matrix.copy(m);
    this.writeDynamic(i, k, phase, glow, r, g, b);
  }

  /** Finish the frame: upload what was added and set the draw count. */
  end(): void {
    const n = this.shown + this.dyn;
    const mesh = this.mesh;
    mesh.count = n;
    mesh.visible = (this.ready && n > 0) || this.warm > 0;
    if (this.warm > 0) this.warm--;
    if (this.dyn > 0) {
      const m = mesh.instanceMatrix;
      m.addUpdateRange(this.shown * 16, this.dyn * 16);
      m.needsUpdate = true;
      this.prop.addUpdateRange(this.shown * 4, this.dyn * 4);
      this.prop.needsUpdate = true;
      this.tint.addUpdateRange(this.shown * 3, this.dyn * 3);
      this.tint.needsUpdate = true;
    }
  }

  /** Forget every static prop (they're re-added by their owner). */
  clearStatic(): void {
    this.sCount = 0;
    this.sHidden.fill(0);
    this.cells = null;
    this.dirty = true;
  }

  private writeDynamic(i: number, k: number, phase: number, glow: number, r: number, g: number, b: number): void {
    (this.mesh.instanceMatrix.array as Float32Array).set(this.matrix.elements, i * 16);
    const prop = this.prop.array as Float32Array;
    prop[i * 4] = k;
    prop[i * 4 + 1] = phase;
    prop[i * 4 + 2] = 0;
    prop[i * 4 + 3] = glow;
    const tint = this.tint.array as Float32Array;
    tint[i * 3] = r;
    tint[i * 3 + 1] = g;
    tint[i * 3 + 2] = b;
    this.dyn++;
  }

  private compose(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number): void {
    this.q.setFromAxisAngle(this.up, yaw);
    this.matrix.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz));
  }

  private grow(): void {
    const n = this.sX.length * 2;
    const data = new Float32Array(n * STRIDE);
    data.set(this.sData);
    this.sData = data;
    const x = new Float32Array(n);
    x.set(this.sX);
    this.sX = x;
    const z = new Float32Array(n);
    z.set(this.sZ);
    this.sZ = z;
    const h = new Uint8Array(n);
    h.set(this.sHidden);
    this.sHidden = h;
  }

  private bucket(): void {
    const cells = new Map<number, number[]>();
    for (let i = 0; i < this.sCount; i++) {
      const key = cellKey(Math.floor(this.sX[i] / CELL), Math.floor(this.sZ[i] / CELL));
      let list = cells.get(key);
      if (!list) cells.set(key, (list = []));
      list.push(i);
    }
    this.cells = cells;
  }
}

function cellKey(cx: number, cz: number): number {
  return ((cx + 32768) << 16) | (cz + 32768);
}

/** Until the GLB arrives: a tiny box tagged as kind 0 (never drawn: the mesh stays hidden). */
function placeholderGeometry(): BufferGeometry {
  const g = new BoxGeometry(0.01, 0.01, 0.01).toNonIndexed();
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  g.setAttribute('aColor', new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('aSurf', new BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aKind', new BufferAttribute(new Float32Array(n), 1));
  return g;
}

/** Vertices of the other models in the family collapse out of view (and skip the rest of the shader). */
const FAMILY_SELECT = /* glsl */ `void main() {
  if (abs(aKind - aProp.x) > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }`;

function patchDepth(shader: { vertexShader: string }): void {
  shader.vertexShader = after(shader.vertexShader, '#include <common>', 'attribute float aKind;\nattribute vec4 aProp;');
  shader.vertexShader = replace(shader.vertexShader, 'void main() {', FAMILY_SELECT);
}

/**
 * Lit like the rest of the city (Lambert, sun shadows, the street lamps'
 * analytic light), coloured per vertex, with the animated surfaces worked
 * out per vertex: lamps and signs glowing at night, traffic-light lenses
 * following the signal cycle, warning lights blinking, strobes flashing,
 * a ramp deck painted with chevrons. One program for every family.
 */
function propMaterial(): MeshLambertMaterial {
  const mat = new MeshLambertMaterial();
  mat.onBeforeCompile = (shader) => {
    useWorldUniforms(shader);
    shader.uniforms.uSignalTime = propUniforms.uSignalTime;
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <common>',
      `attribute vec3 aColor;
      attribute float aSurf;
      attribute float aKind;
      attribute vec4 aProp;
      attribute vec3 aTint;
      uniform float uTime;
      uniform float uNight;
      uniform float uSignalTime;
      varying vec3 vPropColor;
      varying vec3 vPropGlow;
      varying vec3 vPropWorld;
      varying vec3 vPropNormal;
      varying vec3 vPropLocal;
      varying float vPropSurf;
      ${SIGNAL_GLSL}`,
    );
    shader.vertexShader = replace(shader.vertexShader, 'void main() {', FAMILY_SELECT);
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <project_vertex>',
      `int surf = int(aSurf + 0.5);
      vec3 col = aColor;
      vec3 glow = vec3(0.0);
      if (surf == 1) col = aTint;
      else if (surf == 2) glow = aColor * (0.06 + 2.4 * uNight);
      else if (surf >= 3 && surf <= 5) {
        int state = ubSignal(aProp.z, uSignalTime + aProp.y);
        bool on = (surf == 3 && state == 0) || (surf == 4 && state == 1) || (surf == 5 && state == 2);
        col = on ? aColor : aColor * 0.18;
        glow = on ? aColor * (1.6 + 1.8 * uNight) : vec3(0.0);
      }
      else if (surf == 6) glow = aColor * (0.25 + 2.6 * uNight) * (0.8 + 0.2 * sin(uTime * 2.6));
      else if (surf == 7) glow = aColor * (0.3 + 1.1 * uNight);
      else if (surf == 8) glow = aColor * (0.03 + 0.28 * uNight);
      else if (surf == 10) glow = aColor * step(0.6, fract(uTime * 0.7 + aProp.y)) * (0.8 + 2.2 * uNight);
      else if (surf == 11) glow = aColor * (1.2 + 2.6 * uNight);
      else if (surf == 12) glow = vec3(1.0, 0.08, 0.05) * step(0.5, fract(uTime * 1.7 + aProp.y)) * 4.0;
      else if (surf == 13) glow = vec3(0.1, 0.32, 1.0) * (1.0 - step(0.5, fract(uTime * 1.7 + aProp.y))) * 4.0;
      else if (surf == 14) { col = aTint; glow = aTint * (0.45 + 0.7 * uNight); }
      vPropColor = col;
      vPropGlow = glow + col * aProp.w * (0.6 + 0.8 * uNight);
      vPropSurf = aSurf;
      vPropLocal = position;
      mat4 propModel = modelMatrix * instanceMatrix;
      vPropWorld = (propModel * vec4(transformed, 1.0)).xyz;
      vPropNormal = normalize(mat3(propModel) * objectNormal);`,
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <common>',
      `varying vec3 vPropColor;
      varying vec3 vPropGlow;
      varying vec3 vPropWorld;
      varying vec3 vPropNormal;
      varying vec3 vPropLocal;
      varying float vPropSurf;
      ${UB_COMMON}
      ${UB_STREET_LIGHT}`,
    );
    shader.fragmentShader = replace(
      shader.fragmentShader,
      '#include <color_fragment>',
      `diffuseColor.rgb = vPropColor;
      vec3 propGlow = vPropGlow;
      if (abs(vPropSurf - 9.0) < 0.5) {
        // Ramp deck: yellow-and-black chevrons pointing up the slope (+Z), bright edges.
        float chev = step(0.5, fract(vPropLocal.z * 0.55 + abs(vPropLocal.x) * 0.5));
        diffuseColor.rgb = mix(vec3(0.07, 0.07, 0.08), vec3(1.0, 0.72, 0.06), chev);
        propGlow = diffuseColor.rgb * chev * (0.1 + 0.35 * uNight);
      }`,
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      'totalEmissiveRadiance += propGlow + diffuseColor.rgb * ubStreetLight(vPropWorld, normalize(vPropNormal));',
    );
  };
  mat.customProgramCacheKey = () => 'curbside-propfamily';
  return mat;
}
