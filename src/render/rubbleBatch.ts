import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
} from 'three';
import { propMaterial } from '../world/cityMesh';
import { mulberry32 } from '../world/random';
import { RUBBLE_CAPACITY } from './destructionStyle';

/** A crumbling chunk settles this far into the pavement before it shrinks, m. */
const SETTLE = 0.04;

/**
 * A broken lump of masonry: a truncated cube cut unevenly at each corner
 * (0.08–0.42 of an edge), every point pulled in by up to 30%, sheared to
 * one side, each face broken round a point raised or dented off its middle,
 * then rescaled so its bounding box is exactly the unit cube. Scaled by
 * 2 × a chunk's half-extents it fills the chunk's Rapier cuboid, so chunks
 * neither float nor sink (one may rest on a raised point, as a rock does).
 * Built by hand on the truncated cube's fixed topology (8 corner triangles,
 * 6 octagons fanned round their middle points; winding decided on the even,
 * convex shape), not with ConvexGeometry, whose hull code went into every
 * player's download. Face normals per triangle, each tilted a little, give
 * a faceted look without flatShading (which would be another program): the
 * face the camera sees is several facets lit differently, not one pale
 * square (the instanced colour is per chunk, so shading is the only
 * per-face variation the shared program allows).
 */
export function chunkGeometry(): BufferGeometry {
  const rand = mulberry32(7);
  // Point c * 3 + a: corner c (bits: +x, +y, +z) moved in along axis a.
  const ideal: number[] = [];
  const pts: number[] = [];
  // Sheared: x leans with y.
  const push = (x: number, y: number, z: number) => pts.push(x + y * 0.18, y, z);
  for (let c = 0; c < 8; c++) {
    const corner = [c & 1 ? 0.5 : -0.5, c & 2 ? 0.5 : -0.5, c & 4 ? 0.5 : -0.5];
    for (let a = 0; a < 3; a++) {
      const q = corner.slice();
      q[a] *= 0.64;
      ideal.push(q[0], q[1], q[2]);
      const p = corner.slice();
      p[a] *= 1 - 2 * (0.08 + 0.34 * rand());
      const k = 1 - 0.3 * rand();
      push(p[0] * k, p[1] * k, p[2] * k);
    }
  }
  // Point 24 + a * 2 + sign: the middle of that face, off-centre and raised or dented.
  for (let a = 0; a < 3; a++) {
    for (const sign of [0, 1]) {
      const q = [0, 0, 0];
      q[a] = sign ? 0.5 : -0.5;
      ideal.push(q[0], q[1], q[2]);
      const p = [(rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3];
      p[a] = (sign ? 1 : -1) * (0.38 + 0.28 * rand());
      push(p[0], p[1], p[2]);
    }
  }
  const tris: number[] = [];
  for (let c = 0; c < 8; c++) tris.push(c * 3, c * 3 + 1, c * 3 + 2);
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const d = (a + 2) % 3;
    for (const sign of [0, 1]) {
      // The octagon on this face: each of its four corners' points moved along the face, fanned round its middle.
      const ring: number[] = [];
      for (let c = 0; c < 8; c++) if (((c >> a) & 1) === sign) ring.push(c * 3 + b, c * 3 + d);
      ring.sort((i, j) => Math.atan2(ideal[i * 3 + d], ideal[i * 3 + b]) - Math.atan2(ideal[j * 3 + d], ideal[j * 3 + b]));
      const mid = 24 + a * 2 + sign;
      for (let k = 0; k < ring.length; k++) tris.push(mid, ring[k], ring[(k + 1) % ring.length]);
    }
  }
  // Outward winding, judged on the convex shape: the normal points away from the centre.
  const at = (i: number, axis: number) => ideal[i * 3 + axis];
  for (let t = 0; t < tris.length; t += 3) {
    const i = tris[t];
    const j = tris[t + 1];
    const k = tris[t + 2];
    let out = 0;
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3;
      const d = (a + 2) % 3;
      // Axis a of (j − i) × (k − i), times the centroid's.
      const n = (at(j, b) - at(i, b)) * (at(k, d) - at(i, d)) - (at(j, d) - at(i, d)) * (at(k, b) - at(i, b));
      out += n * (at(i, a) + at(j, a) + at(k, a));
    }
    if (out < 0) {
      tris[t + 1] = k;
      tris[t + 2] = j;
    }
  }
  // Into the unit box.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], pts[i]);
    hi[i % 3] = Math.max(hi[i % 3], pts[i]);
  }
  const pos = new Float32Array(tris.length * 3);
  for (let t = 0; t < tris.length; t++) {
    for (let k = 0; k < 3; k++) pos[t * 3 + k] = (pts[tris[t] * 3 + k] - (lo[k] + hi[k]) / 2) / (hi[k] - lo[k]);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // Each facet's normal tilted up to ~15°: neighbouring facets at similar slopes still shade apart.
  const nrm = geo.getAttribute('normal');
  for (let t = 0; t < nrm.count; t += 3) {
    let x = nrm.getX(t) + (rand() - 0.5) * 0.5;
    let y = nrm.getY(t) + (rand() - 0.5) * 0.5;
    let z = nrm.getZ(t) + (rand() - 0.5) * 0.5;
    const l = Math.hypot(x, y, z);
    x /= l;
    y /= l;
    z /= l;
    for (let v = t; v < t + 3; v++) nrm.setXYZ(v, x, y, z);
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Where `add` reads chunk i from: the presenter's per-slot arrays (the pose array changes with the world). */
export interface RubbleSource {
  /** x y z qx qy qz qw per slot. */
  pose: Float32Array;
  /** Full extents (sx sy sz) per slot. */
  size: Float32Array;
  /** Linear rgb per slot. */
  colour: Float32Array;
  /** 0 whole .. 1 gone: at the end of its life a chunk settles and darkens, then flattens and shrinks onto the pavement. */
  fade: Float32Array;
}

/**
 * Every rubble chunk in one InstancedMesh (plus its shadow pass on desktop
 * style), on the city's prop material: lit by sun, shadows, sky and street
 * lamps like the walls it came from, and sharing the city's programs, so it
 * adds none, and its shadow pass reuses the city chunks' depth variant.
 * Built and added to the scene at boot whatever the setting, drawn visible at
 * count 0 for two frames so its buffers go up behind the title: switching
 * the test on mid-session then compiles and uploads nothing new.
 * begin / add / end each rendered frame something changed (hold when
 * nothing did); both buffers go up whole (three's update ranges allocate).
 */
export class RubbleBatch {
  readonly mesh: InstancedMesh;
  private n = 0;
  private warm = 2;

  constructor(readonly capacity = RUBBLE_CAPACITY) {
    const geo = chunkGeometry();
    // propMaterial's emission reads aGlow; rubble never glows.
    geo.setAttribute('aGlow', new InstancedBufferAttribute(new Float32Array(capacity), 1));
    this.mesh = new InstancedMesh(geo, propMaterial(), capacity);
    // Create the colour attribute now so the program is compiled with it at warm-up.
    this.mesh.setColorAt(0, new Color(0.5, 0.5, 0.5));
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor!.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.mesh.name = 'rubble';
  }

  /** Rubble casts sun shadows (desktop style): one more draw call. Safe to flip: the depth program is the city's. */
  set shadows(on: boolean) {
    this.mesh.castShadow = on;
  }

  get shadows(): boolean {
    return this.mesh.castShadow;
  }

  /** Instances drawn this frame. */
  get count(): number {
    return this.mesh.count;
  }

  begin(): void {
    this.n = 0;
  }

  /**
   * Chunk `i` of `src`. It takes the slot, not the numbers: V8 boxes each
   * double passed to a call it doesn't inline (13 of them came to ~156 B per
   * chunk per frame), so the arrays are read here. The matrix is composed
   * inline (no Matrix4).
   */
  add(src: RubbleSource, i: number): void {
    if (this.n >= this.capacity) return;
    const pose = src.pose;
    const size = src.size;
    const colour = src.colour;
    const f = src.fade[i];
    const p = i * 7;
    const k = i * 3;
    const qx = pose[p + 3];
    const qy = pose[p + 4];
    const qz = pose[p + 5];
    const qw = pose[p + 6];
    const sx = size[k];
    const sy = size[k + 1];
    const sz = size[k + 2];
    const x2 = qx + qx;
    const y2 = qy + qy;
    const z2 = qz + qz;
    const xx = qx * x2;
    const xy = qx * y2;
    const xz = qx * z2;
    const yy = qy * y2;
    const yz = qy * z2;
    const zz = qz * z2;
    const wx = qw * x2;
    const wy = qw * y2;
    const wz = qw * z2;
    const m10 = (xy + wz) * sx;
    const m11 = (1 - (xx + zz)) * sy;
    const m12 = (yz - wx) * sz;
    // Fading (it crumbles): over the first half it settles a few cm and
    // darkens; over the second it flattens (world y faster than x and z)
    // and shrinks, its lowest point kept on the ground.
    const g = f > 0.5 ? (f - 0.5) * 2 : 0;
    const kxz = 1 - g;
    const ky = kxz * kxz;
    const drop = (1 - ky) * 0.5 * (Math.abs(m10) + Math.abs(m11) + Math.abs(m12)) + SETTLE * (f < 0.5 ? f * 2 : 1);
    const e = this.mesh.instanceMatrix.array as Float32Array;
    const o = this.n * 16;
    e[o] = (1 - (yy + zz)) * sx * kxz;
    e[o + 1] = m10 * ky;
    e[o + 2] = (xz - wy) * sx * kxz;
    e[o + 3] = 0;
    e[o + 4] = (xy - wz) * sy * kxz;
    e[o + 5] = m11 * ky;
    e[o + 6] = (yz + wx) * sy * kxz;
    e[o + 7] = 0;
    e[o + 8] = (xz + wy) * sz * kxz;
    e[o + 9] = m12 * ky;
    e[o + 10] = (1 - (xx + yy)) * sz * kxz;
    e[o + 11] = 0;
    e[o + 12] = pose[p];
    e[o + 13] = pose[p + 1] - drop;
    e[o + 14] = pose[p + 2];
    e[o + 15] = 1;
    const dark = 1 - 0.55 * (f < 0.5 ? f * 2 : 1);
    const c = this.mesh.instanceColor!.array as Float32Array;
    const ci = this.n * 3;
    c[ci] = colour[k] * dark;
    c[ci + 1] = colour[k + 1] * dark;
    c[ci + 2] = colour[k + 2] * dark;
    this.n++;
  }

  end(): void {
    const mesh = this.mesh;
    const n = this.n;
    mesh.count = n;
    mesh.visible = n > 0 || this.warm > 0;
    if (this.warm > 0) this.warm--;
    if (n === 0) return;
    // Whole buffers (up to 19 KB): three's update ranges allocate per upload.
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.clearUpdateRanges();
    mesh.instanceColor!.needsUpdate = true;
  }

  /** Nothing drawn changed since the last end() (a settled pile, the same chunks in view): draw it again, upload nothing. */
  hold(): void {
    this.mesh.visible = this.mesh.count > 0 || this.warm > 0;
    if (this.warm > 0) this.warm--;
  }
}
