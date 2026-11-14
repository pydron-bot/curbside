import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DataUtils,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Quaternion,
  RGBADepthPacking,
  RGBAIntegerFormat,
  UnsignedIntType,
  Vector3,
  type IUniform,
} from 'three';
import type { Rect } from '../world/city';
import { shaderLookGlsl } from './lookTuning';
import { SIGNAL_GLSL } from '../world/signals';
import { uploadRange } from './glowSprites';
import { VERTS_PER_ROW, chunkSize, chunksOf } from './propChunks';
import { SURF, type PropModels } from './propModels';
import { UB_COMMON, UB_CUTAWAY, UB_LAMP_LIST, UB_STREET_LIGHT, after, lampList, replace, useWorldUniforms, worldUniforms } from './shaderLib';

/** Floats per static prop: matrix (16), aProp (4), aTint (3), aLamps (4). */
const STRIDE = 27;
/** Static instances are bucketed in square cells this size for culling, m. */
const CELL = 32;
/** Static props this far outside the visible ground still draw (their shadows reach in), m. */
const MARGIN = 14;

/** Uniforms every prop family shares (the traffic lights' clock). */
export const propUniforms = {
  /** The traffic signals' clock (TrafficSignals.time), s. */
  uSignalTime: { value: 0 },
  /**
   * The player (x, z) and a radius: a landmark flagged for it (a spray booth,
   * the export garage) drops its roof and the signs on it while the player
   * is within the radius of its middle, so you see your car inside.
   */
  uFocus: { value: new Vector3(0, 0, 0) },
} satisfies Record<string, IUniform>;

/**
 * A family of props drawn as ONE instanced mesh: a street lamp, or the
 * hydrants, benches, bins... of the street. The family's models are packed
 * one after another into a vertex texture, and each prop is drawn as a few
 * `chunks`: instances of a fixed run of vertices (the family's chunk size,
 * worked out from its models: propChunks.ts) that the vertex shader pulls
 * from its own model's stretch of the texture, the run past the model's end
 * dropped. So a prop runs only its own model's vertices (rounded up to whole
 * chunks), not every model in the family, and the whole family is still one
 * draw call (and one in the shadow pass) however many kinds are on screen.
 *
 * Static instances (street furniture, rooftop kit) are added once, bucketed
 * in 32 m cells, and copied into the instance buffers (a copy per chunk)
 * only when the view moves into new cells (or one is hidden: a knocked-over
 * bin); dynamic ones (spinning pickups, roadblock barriers) are added every
 * frame after them. Nothing outside the view is drawn, and nothing
 * allocates per frame.
 *
 * Per instance: `aProp` = (kind, phase, road, glow): phase and road drive
 * animated surfaces (a traffic light's cycle offset and which road it faces,
 * a warning light's blink); glow is extra self-light in the vertex colour
 * (pickups pop at night). `aTint` colours surfaces that take one (debris in
 * the car's paint, a frenzy gem's purple or gold). `aLamps` is the prop's
 * street-lamp short list (shaderLib.ts lampList), so at night most props
 * light from the two lamps in reach instead of walking eight per fragment.
 * Per chunk: `aChunk` = (first vertex, the model's end).
 */
export class PropBatch {
  readonly mesh: InstancedMesh;
  readonly kinds: readonly string[];
  private readonly index = new Map<string, number>();
  private prop!: InstancedBufferAttribute;
  private tint!: InstancedBufferAttribute;
  private lamps!: InstancedBufferAttribute;
  private chunk!: InstancedBufferAttribute;
  /** Chunks the instance buffers hold. */
  private chunkCap = 1;
  /** The family's vertex texture (two texels a vertex: position and surface; normal and colour as halves). */
  private readonly verts: IUniform<DataTexture> = { value: vertexTexture(new Uint32Array(8), 1, 2) };
  /** Per kind: its first vertex and end in the texture, its chunks, and how far it reaches from its origin (across, and in 3D), m. */
  private readonly kStart: Int32Array;
  private readonly kEnd: Int32Array;
  private readonly kChunks: Int32Array;
  private readonly kRadius: Float32Array;
  private readonly kReach: Float32Array;
  private size = 3;
  /** One instance's data before it's copied out per chunk (STRIDE floats, as static ones are kept). */
  private readonly scratch = new Float32Array(STRIDE);
  private readonly matrix = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  // Static instances, struct-of-arrays in one buffer (grown while placing, fixed after).
  private sData = new Float32Array(STRIDE * 256);
  private sX = new Float32Array(256);
  private sZ = new Float32Array(256);
  /** Largest scale across (for its lamp list once the models are in). */
  private sScale = new Float32Array(256);
  private sHidden = new Uint8Array(256);
  private sCount = 0;
  private cells: Map<number, number[]> | null = null;
  /** Static chunks in the buffers now, and the cell range they came from. */
  private shown = 0;
  private cx0 = 1;
  private cz0 = 1;
  private cx1 = 0;
  private cz1 = 0;
  private dirty = true;
  /** begin() rewrote the static chunks this frame (end() uploads them with the dynamic ones). */
  private refilled = false;
  /** Dynamic chunks this frame (after the static ones). */
  private dyn = 0;
  /** Draw even when empty for a couple of frames, so the programs compile and buffers upload up front. */
  private warm = 2;
  private ready = false;

  constructor(
    name: string,
    kinds: readonly string[],
    /** Props in view at most (the instance buffers hold this many props' worth of chunks). */
    readonly capacity: number,
    opts: { shadows?: boolean; receiveShadows?: boolean; sway?: boolean } = {},
  ) {
    this.kinds = kinds;
    kinds.forEach((k, i) => this.index.set(k, i));
    const n = kinds.length;
    this.kStart = new Int32Array(n);
    this.kEnd = new Int32Array(n);
    this.kChunks = new Int32Array(n);
    this.kRadius = new Float32Array(n);
    this.kReach = new Float32Array(n);
    const sway: IUniform<number> = { value: opts.sway ? 1 : 0 };
    this.mesh = new InstancedMesh(new BufferGeometry(), propMaterial(this.verts, sway), 1);
    this.mesh.name = `props_${name}`;
    this.allocate(1);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // culled per instance by cell
    this.mesh.castShadow = opts.shadows ?? true;
    this.mesh.receiveShadow = opts.receiveShadows ?? true;
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    depth.onBeforeCompile = (shader) => patchDepth(shader, this.verts, sway);
    depth.customProgramCacheKey = () => 'curbside-propfamily-pull-depth';
    this.mesh.customDepthMaterial = depth;
  }

  /** The models arrived: pack the family's vertices (kinds missing from the files draw nothing). */
  setModels(models: PropModels): void {
    const kinds = this.kinds;
    const counts = kinds.map((kind) => models.geometry(kind)?.getAttribute('position').count ?? 0);
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return;
    const size = chunkSize(counts);
    const rows = Math.ceil(total / VERTS_PER_ROW);
    const data = new Uint32Array(rows * VERTS_PER_ROW * 8);
    const fdata = new Float32Array(data.buffer);
    const half = DataUtils.toHalfFloat;
    let v = 0;
    let chunks = 0;
    let live = 0;
    kinds.forEach((kind, k) => {
      this.kStart[k] = v;
      const g = models.geometry(kind);
      if (g) {
        const pos = g.getAttribute('position');
        const nor = g.getAttribute('normal');
        const col = g.getAttribute('aColor');
        const surf = g.getAttribute('aSurf');
        for (let i = 0; i < pos.count; i++, v++) {
          const o = v * 8;
          fdata[o] = pos.getX(i);
          fdata[o + 1] = pos.getY(i);
          fdata[o + 2] = pos.getZ(i);
          data[o + 3] = surf ? Math.round(surf.getX(i)) : 0;
          const nx = nor ? nor.getX(i) : 0;
          const ny = nor ? nor.getY(i) : 1;
          const nz = nor ? nor.getZ(i) : 0;
          const r = col ? col.getX(i) : 1;
          const gg = col ? col.getY(i) : 1;
          const b = col ? col.getZ(i) : 1;
          // unpackHalf2x16 reads x from the low half.
          data[o + 4] = (half(nx) | (half(ny) << 16)) >>> 0;
          data[o + 5] = (half(nz) | (half(r) << 16)) >>> 0;
          data[o + 6] = (half(gg) | (half(b) << 16)) >>> 0;
        }
        const d = models.dims(kind);
        if (d) {
          const ax = Math.max(-d.min.x, d.max.x);
          const az = Math.max(-d.min.z, d.max.z);
          const ay = Math.max(-d.min.y, d.max.y);
          this.kRadius[k] = Math.hypot(ax, az);
          this.kReach[k] = Math.hypot(ax, ay, az);
        }
      }
      this.kEnd[k] = v;
      this.kChunks[k] = chunksOf(v - this.kStart[k], size);
      if (this.kChunks[k]) {
        chunks += this.kChunks[k];
        live++;
      }
    });
    this.size = size;
    const old = this.verts.value;
    this.verts.value = vertexTexture(data, rows);
    old.dispose();
    // Room for `capacity` props of the family's average chunk count.
    this.allocate(this.capacity * Math.ceil(chunks / Math.max(1, live)));
    // Statics placed before the models came in get their lamp lists now.
    for (let i = 0; i < this.sCount; i++) {
      const o = i * STRIDE;
      lampList(this.sX[i], this.sZ[i], this.kRadius[this.sData[o + 16]] * this.sScale[i], this.sData, o + 23);
    }
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

  /** Chunk size and buffer room, and the vertices one prop of `kind` runs (tests and the perf notes). */
  stats(kind?: string): { chunkSize: number; chunkCapacity: number; vertices: number } {
    const k = kind === undefined ? -1 : this.kindOf(kind);
    return { chunkSize: this.size, chunkCapacity: this.chunkCap, vertices: k < 0 ? 0 : this.kChunks[k] * this.size };
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
    const across = Math.max(Math.abs(sx), Math.abs(sz));
    lampList(x, z, this.kRadius[k] * across, this.sData, o + 23);
    this.sX[i] = x;
    this.sZ[i] = z;
    this.sScale[i] = across;
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
    const cap = this.chunkCap;
    const data = this.sData;
    let n = 0;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.cells!.get(cellKey(cx, cz));
        if (!list) continue;
        for (let j = 0; j < list.length; j++) {
          const i = list[j];
          if (this.sHidden[i]) continue;
          const o = i * STRIDE;
          if (n + this.kChunks[data[o + 16]] > cap) continue;
          n = this.write(n, data, o);
        }
      }
    }
    this.shown = n;
    this.refilled = true;
  }

  /** A prop for this frame only (after begin()). */
  add(kind: string, x: number, y: number, z: number, yaw: number, sx = 1, sy = sx, sz = sx, phase = 0, glow = 0, r = 1, g = 1, b = 1): void {
    const k = this.kindOf(kind);
    if (k < 0) return;
    this.compose(x, y, z, yaw, sx, sy, sz);
    this.addDynamic(k, this.kRadius[k] * Math.max(Math.abs(sx), Math.abs(sz)), phase, glow, r, g, b);
  }

  /** A prop for this frame with a full transform (tumbling debris). */
  addMatrix(kind: string, m: Matrix4, phase = 0, glow = 0, r = 1, g = 1, b = 1): void {
    const k = this.kindOf(kind);
    if (k < 0) return;
    this.matrix.copy(m);
    const e = m.elements;
    const scale = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
    this.addDynamic(k, this.kReach[k] * scale, phase, glow, r, g, b);
  }

  /** Finish the frame: upload what was added and set the draw count. */
  end(): void {
    const n = this.shown + this.dyn;
    const mesh = this.mesh;
    mesh.count = n;
    mesh.visible = (this.ready && n > 0) || this.warm > 0;
    if (this.warm > 0) this.warm--;
    if (this.refilled) {
      // The view crossed a cell: everything from the start (static and dynamic) goes up.
      this.refilled = false;
      uploadRange(mesh.instanceMatrix, n);
      uploadRange(this.prop, n);
      uploadRange(this.tint, n);
      uploadRange(this.lamps, n);
      uploadRange(this.chunk, n);
    } else if (this.dyn > 0) {
      const from = this.shown;
      const count = this.dyn;
      dynamicRange(mesh.instanceMatrix, from, count);
      dynamicRange(this.prop, from, count);
      dynamicRange(this.tint, from, count);
      dynamicRange(this.lamps, from, count);
      dynamicRange(this.chunk, from, count);
    }
  }

  /** Forget every static prop (they're re-added by their owner). */
  clearStatic(): void {
    this.sCount = 0;
    this.sHidden.fill(0);
    this.cells = null;
    this.dirty = true;
  }

  /** The prop in this.matrix as kind k, reaching `radius` from its origin, after the static chunks. */
  private addDynamic(k: number, radius: number, phase: number, glow: number, r: number, g: number, b: number): void {
    const i = this.shown + this.dyn;
    if (i + this.kChunks[k] > this.chunkCap) return;
    const s = this.scratch;
    const e = this.matrix.elements;
    s.set(e);
    s[16] = k;
    s[17] = phase;
    s[18] = 0;
    s[19] = glow;
    s[20] = r;
    s[21] = g;
    s[22] = b;
    lampList(e[12], e[14], radius, s, 23);
    this.dyn = this.write(i, s, 0) - this.shown;
  }

  /** One prop (STRIDE floats of `src` at `o`) into the instance buffers as its chunks from slot n; returns the next free slot. */
  private write(n: number, src: Float32Array, o: number): number {
    const k = src[o + 16];
    const first = this.kStart[k];
    const end = this.kEnd[k];
    const chunks = this.kChunks[k];
    const mat = this.mesh.instanceMatrix.array as Float32Array;
    const prop = this.prop.array as Float32Array;
    const tint = this.tint.array as Float32Array;
    const lamps = this.lamps.array as Float32Array;
    const chunk = this.chunk.array as Float32Array;
    for (let j = 0; j < chunks; j++, n++) {
      for (let e = 0; e < 16; e++) mat[n * 16 + e] = src[o + e];
      for (let e = 0; e < 4; e++) prop[n * 4 + e] = src[o + 16 + e];
      for (let e = 0; e < 3; e++) tint[n * 3 + e] = src[o + 20 + e];
      for (let e = 0; e < 4; e++) lamps[n * 4 + e] = src[o + 23 + e];
      chunk[n * 2] = first + j * this.size;
      chunk[n * 2 + 1] = end;
    }
    return n;
  }

  /** Fresh instance buffers for `chunks` chunks, and a geometry of one chunk's vertices (the shader pulls the real ones). */
  private allocate(chunks: number): void {
    this.chunkCap = chunks;
    const attr = (size: number) => new InstancedBufferAttribute(new Float32Array(chunks * size), size).setUsage(DynamicDrawUsage);
    this.prop = attr(4);
    this.tint = attr(3);
    this.lamps = attr(4);
    this.chunk = attr(2);
    const geo = new BufferGeometry();
    // Only its count is read (the draw's vertex count): the shader takes the vertex from the texture.
    geo.setAttribute('position', new BufferAttribute(new Float32Array(this.size * 3), 3));
    geo.setAttribute('aProp', this.prop);
    geo.setAttribute('aTint', this.tint);
    geo.setAttribute('aLamps', this.lamps);
    geo.setAttribute('aChunk', this.chunk);
    const old = this.mesh.geometry;
    this.mesh.geometry = geo;
    old.dispose();
    this.mesh.instanceMatrix = new InstancedBufferAttribute(new Float32Array(chunks * 16), 16).setUsage(DynamicDrawUsage);
    this.shown = 0;
    this.dyn = 0;
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
    const s = new Float32Array(n);
    s.set(this.sScale);
    this.sScale = s;
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

/** Upload chunks [from, from + count) of an instanced attribute (this frame's dynamic ones; three clears the ranges once uploaded). */
function dynamicRange(a: InstancedBufferAttribute, from: number, count: number): void {
  a.addUpdateRange(from * a.itemSize, count * a.itemSize);
  a.needsUpdate = true;
}

/** A family's vertices as an RGBA32UI texture, VERTS_PER_ROW to a row (read with texelFetch; a one-vertex placeholder until the models come). */
function vertexTexture(data: Uint32Array, rows: number, width = VERTS_PER_ROW * 2): DataTexture {
  const t = new DataTexture(data, width, rows, RGBAIntegerFormat, UnsignedIntType);
  t.internalFormat = 'RGBA32UI';
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Declarations for the vertex pull (both passes). */
const PULL_DECLS = /* glsl */ `
uniform highp usampler2D uPropVerts;
attribute vec2 aChunk;
attribute vec4 aProp;
vec3 pPos;
float pSurf;`;

/**
 * This chunk's vertex from the texture; past its model's end it collapses out
 * of view (chunk runs end on whole triangles, so no triangle is half dropped).
 */
const PULL = /* glsl */ `void main() {
  int pv = int(aChunk.x) + gl_VertexID;
  if (pv >= int(aChunk.y)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  ivec2 pt = ivec2((pv % ${VERTS_PER_ROW}) * 2, pv / ${VERTS_PER_ROW});
  uvec4 t0 = texelFetch(uPropVerts, pt, 0);
  pPos = uintBitsToFloat(t0.xyz);
  pSurf = float(t0.w);`;

/** The lit pass also needs the normal and colour (the second texel: halves). */
const PULL_LIT = /* glsl */ `
  uvec4 t1 = texelFetch(uPropVerts, pt + ivec2(1, 0), 0);
  vec2 h0 = unpackHalf2x16(t1.x);
  vec2 h1 = unpackHalf2x16(t1.y);
  vec2 h2 = unpackHalf2x16(t1.z);
  pNormal = vec3(h0, h1.x);
  pColor = vec3(h1.y, h2);`;

/**
 * The lit pass also cuts away a flagged landmark's roof (aProp.z > 1.5 is
 * the height above which its signs go too) while the player is under it.
 * The shadow pass keeps it: the inside stays shaded like a garage.
 */
const ROOF_CUT = /* glsl */ `
  if (aProp.z > 1.5 && (abs(pSurf - ${SURF.roof}.0) < 0.5 || (abs(pSurf - ${SURF.sign}.0) < 0.5 && pPos.y > aProp.z))
      && distance(instanceMatrix[3].xz, uFocus.xy) < uFocus.z) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }`;

/**
 * Trees in the wind (a family made with `sway`; uniform 0 elsewhere, so one
 * program still serves every family): the whole model bends downwind, more
 * the higher a vertex is (quadratic, so trunks curve and canopies swing),
 * in gusts that roll across the city; leaves (green vertices) flutter on top.
 * The wind blows the same way in the world whichever way a tree is turned.
 */
const SWAY_DECLS = /* glsl */ `
uniform float uSway;
uniform float uTime;
uniform float uWetness;
${shaderLookGlsl()}`;
const SWAY = /* glsl */ `
  if (uSway > 0.5) {
    vec2 tp = instanceMatrix[3].xz;
    float ph = tp.x * 0.045 + tp.y * 0.03;
    float gust = 0.55 + 0.45 * sin(uTime * 0.21 - ph * 0.35) * sin(uTime * 0.13 + ph * 0.2);
    float bend = (0.35 + 0.65 * sin(uTime * 1.25 + ph) * 0.8 + 0.2 * sin(uTime * 2.7 + ph * 1.9)) * gust * (1.0 + 0.7 * uWetness);
    float hgt = max(pPos.y - 1.0, 0.0);
    vec3 windL = normalize(transpose(mat3(instanceMatrix)) * vec3(0.8, 0.0, 0.6));
    bend *= LK_SWAY;
    transformed += windL * (hgt * hgt * 0.011 * bend);
    transformed.y -= hgt * hgt * 0.0012 * abs(bend);
    if (pLeaf > 0.5) transformed += vec3(sin(uTime * 6.3 + pPos.x * 3.1 + ph), 0.0, cos(uTime * 5.7 + pPos.z * 2.9 + ph)) * 0.035 * gust * LK_SWAY;
  }`;

/** Leaves: the models' green vertices (canopies and fronds; trunks are brown). */
const LEAF = /* glsl */ `
  uvec4 tl = texelFetch(uPropVerts, pt + ivec2(1, 0), 0);
  vec2 lc0 = unpackHalf2x16(tl.y);
  vec2 lc1 = unpackHalf2x16(tl.z);
  float pLeaf = step(lc0.y * 1.08, lc1.x) * step(0.02, lc1.x);`;

/**
 * Dappled shade: sun flecks in the canopies' shadow (sun or moon). The ground
 * is cut into 0.6 m cells, some holding a round hole that shimmers; each
 * leaf fragment is followed down the light's ray to the ground, so the holes
 * line up through every layer of a canopy. Flecks, not a threshold on a
 * smooth noise (which ate the shadow away in blobs and, past 100%, whole):
 * the shadow keeps its outline and at least ~2/3 of its area at 200%.
 * Hoskins' sin-free hash: sin() of world-sized arguments bands on phone GPUs.
 */
const DAPPLE = /* glsl */ `vec3 dapHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
void main() {
  if (uSway > 0.5 && vDapLeaf > 0.5 && LK_DAPPLE > 0.0) {
    vec2 dg = (vDapWorld.xz - uSunDir.xz / max(uSunDir.y, 0.25) * vDapWorld.y) / 0.6;
    vec2 dc = floor(dg);
    vec3 dh = dapHash(dc);
    // Share of cells with a fleck and its radius (cell widths) grow with the slider: ~14% of the shadow lit at 100%, ~1/3 at 200%.
    if (dh.z < min(0.8, 0.55 * LK_DAPPLE)) {
      float dr = min(0.45, 0.23 + 0.1 * LK_DAPPLE) * (0.7 + 0.3 * fract(dh.z * 7.31)) * (0.88 + 0.12 * sin(uTime * (1.7 + 2.3 * dh.x) + dh.y * 40.0));
      vec2 dp = dc + 0.5 + (dh.xy - 0.5) * (1.0 - 2.0 * dr);
      if (dot(dg - dp, dg - dp) < dr * dr) discard;
    }
  }`;

function patchDepth(
  shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, IUniform> },
  verts: IUniform<DataTexture>,
  sway: IUniform<number>,
): void {
  shader.uniforms.uPropVerts = verts;
  shader.uniforms.uSway = sway;
  shader.uniforms.uTime = worldUniforms.uTime;
  shader.uniforms.uWetness = worldUniforms.uWetness;
  shader.uniforms.uLook = worldUniforms.uLook;
  shader.vertexShader = after(shader.vertexShader, '#include <common>', `${PULL_DECLS}${SWAY_DECLS}
    varying vec3 vDapWorld;
    varying float vDapLeaf;`);
  shader.vertexShader = replace(shader.vertexShader, 'void main() {', PULL + LEAF);
  shader.vertexShader = replace(
    shader.vertexShader,
    '#include <begin_vertex>',
    `vec3 transformed = pPos;${SWAY}
    vDapWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
    vDapLeaf = pLeaf;`,
  );
  shader.uniforms.uSunDir = worldUniforms.uSunDir;
  shader.fragmentShader = after(shader.fragmentShader, '#include <common>', `uniform float uSway;
    uniform float uTime;
    uniform vec3 uSunDir;
    ${shaderLookGlsl()}
    varying vec3 vDapWorld;
    varying float vDapLeaf;`);
  shader.fragmentShader = replace(shader.fragmentShader, 'void main() {', DAPPLE);
}

/**
 * Lit like the rest of the city (Lambert, sun shadows, the street lamps'
 * analytic light, from the prop's lamp list), coloured per vertex, with the
 * animated surfaces worked out per vertex: lamps and signs glowing at night,
 * traffic-light lenses following the signal cycle, warning lights blinking,
 * strobes flashing, a ramp deck painted with chevrons. One program for
 * every family (each its own vertex texture).
 */
function propMaterial(verts: IUniform<DataTexture>, sway: IUniform<number>): MeshLambertMaterial {
  const mat = new MeshLambertMaterial();
  mat.onBeforeCompile = (shader) => {
    useWorldUniforms(shader);
    shader.uniforms.uSway = sway;
    shader.uniforms.uSignalTime = propUniforms.uSignalTime;
    shader.uniforms.uFocus = propUniforms.uFocus;
    shader.uniforms.uPropVerts = verts;
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <common>',
      `${PULL_DECLS}
      vec3 pNormal;
      vec3 pColor;
      attribute vec3 aTint;
      attribute vec4 aLamps;
      uniform float uSway;
      uniform float uWetness;
      uniform float uTime;
      uniform float uNight;
      ${shaderLookGlsl()}
      uniform float uSignalTime;
      uniform vec3 uFocus;
      varying vec3 vPropColor;
      varying vec3 vPropGlow;
      varying vec3 vPropWorld;
      varying vec3 vPropNormal;
      varying vec3 vPropLocal;
      varying float vPropSurf;
      flat varying vec4 vPropLamps;
      ${SIGNAL_GLSL}`,
    );
    shader.vertexShader = replace(shader.vertexShader, 'void main() {', PULL + PULL_LIT + LEAF + ROOF_CUT);
    shader.vertexShader = replace(shader.vertexShader, '#include <beginnormal_vertex>', 'vec3 objectNormal = pNormal;');
    shader.vertexShader = replace(shader.vertexShader, '#include <begin_vertex>', `vec3 transformed = pPos;${SWAY}`);
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <project_vertex>',
      `int surf = int(pSurf + 0.5);
      vec3 col = pColor;
      vec3 glow = vec3(0.0);
      if (surf == 1) col = aTint;
      else if (surf == 2) glow = pColor * (0.06 + 2.4 * uNight);
      else if (surf >= 3 && surf <= 5) {
        int state = ubSignal(aProp.z, uSignalTime + aProp.y);
        bool on = (surf == 3 && state == 0) || (surf == 4 && state == 1) || (surf == 5 && state == 2);
        col = on ? pColor : pColor * 0.18;
        glow = on ? pColor * (1.6 + 1.8 * uNight) : vec3(0.0);
      }
      else if (surf == 6) glow = pColor * (0.25 + 2.6 * uNight) * (0.8 + 0.2 * sin(uTime * 2.6));
      else if (surf == 7) glow = pColor * (0.3 + 1.1 * uNight);
      else if (surf == 8) glow = pColor * (0.03 + 0.28 * uNight);
      else if (surf == 10) glow = pColor * step(0.6, fract(uTime * 0.7 + aProp.y)) * (0.8 + 2.2 * uNight);
      else if (surf == 11) glow = pColor * (1.2 + 2.6 * uNight);
      else if (surf == 12) glow = vec3(1.0, 0.08, 0.05) * step(0.5, fract(uTime * 1.7 + aProp.y)) * 4.0;
      else if (surf == 13) glow = vec3(0.1, 0.32, 1.0) * (1.0 - step(0.5, fract(uTime * 1.7 + aProp.y))) * 4.0;
      else if (surf == 14) { col = aTint; glow = aTint * (0.45 + 0.7 * uNight); }
      vPropColor = col;
      vPropGlow = glow + col * aProp.w * (0.6 + 0.8 * uNight);
      vPropSurf = pSurf;
      vPropLocal = pPos;
      vPropLamps = aLamps;
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
      flat varying vec4 vPropLamps;
      ${UB_COMMON}
      ${UB_CUTAWAY}
      ${UB_STREET_LIGHT}
      ${UB_LAMP_LIST}`,
    );
    shader.fragmentShader = replace(
      shader.fragmentShader,
      '#include <color_fragment>',
      `// Rooftop kit and canopies go with the building cut away in front of the player (camera trial).
      if (vPropWorld.y > 1.5 && ubCutaway(vPropWorld)) discard;
      diffuseColor.rgb = vPropColor * ubCloudShade(vPropWorld.xz);
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
      'totalEmissiveRadiance += propGlow + diffuseColor.rgb * ubListedLight(vPropWorld, normalize(vPropNormal));',
    );
  };
  mat.customProgramCacheKey = () => 'curbside-propfamily-pull';
  return mat;
}
