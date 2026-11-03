/**
 * Seagulls over the docks (systems/gulls.ts), drawn as ONE instanced mesh of
 * a low-poly gull built here: a white body and head, a yellow beak, a short
 * fanned tail, and long wings in two panels, white with black tips. The
 * wings bend at the shoulder and the wrist in the vertex shader from two
 * angles per bird (aWing): held in a shallow gull-wing "M" while gliding,
 * beating in bouts. By day only (they roost at night), with a soft shadow
 * cast down the sun's ray onto the quay and the water. No draw call while
 * none is in view; no shadow pass of their own.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { look as tuned } from './lookLive';
import { gullPose, planGulls, type GullPose, type GullSpec } from '../systems/gulls';
import type { Rect } from '../world/city';
import { uploadRange } from './glowSprites';
import type { Look } from './look';
import { after, useWorldUniforms, worldUniforms } from './shaderLib';

/** Gulls drawn at most at once. */
const CAPACITY = 32;
/** Drawn bigger than life (like the pigeons), so a gull reads from 30 m up. */
const SIZE = 2;
/** Where the wings join the body, and bend at the wrist, m from the middle (model scale). */
const SHOULDER = 0.05;
const WRIST = 0.34;
/** Wing angles while gliding: shoulders up a touch, hands down (a gull's M). */
const GLIDE_IN = 0.16;
const GLIDE_OUT = -0.22;

const WHITE: Rgb = [0.93, 0.93, 0.95];
const PALE: Rgb = [0.82, 0.84, 0.88];
const BLACK: Rgb = [0.06, 0.06, 0.07];
const YELLOW: Rgb = [0.98, 0.76, 0.15];
type Rgb = readonly [number, number, number];
type P = readonly [number, number, number];

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler(0, 0, 0, 'YXZ');
const p = new Vector3();
const s = new Vector3();

export class GullLook {
  readonly mesh: InstancedMesh;
  private readonly wing: InstancedBufferAttribute;
  private readonly gulls: readonly GullSpec[];
  private readonly pose: GullPose = { x: 0, y: 0, z: 0, heading: 0, bank: 0, gliding: true, flap: 0 };

  constructor(scene: Scene, look: Look, seed: number) {
    this.gulls = planGulls(seed);
    const geometry = gullGeometry();
    this.wing = new InstancedBufferAttribute(new Float32Array(CAPACITY * 2), 2);
    this.wing.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aWing', this.wing);
    // Flat shading takes each face's normal from the screen, so the bent wings light right without turning normals.
    const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
    material.onBeforeCompile = (shader) => {
      useWorldUniforms(shader);
      shader.vertexShader = after(
        shader.vertexShader,
        '#include <common>',
        `attribute float aSpan;
        attribute vec2 aWing;
        // A wing vertex out from its shoulder: along the arm by the first angle, past the wrist by both.
        vec3 gullBend(vec3 v, float a1, float a2) {
          float side = sign(v.x);
          float d1 = clamp(aSpan, ${SHOULDER}, ${WRIST}) - ${SHOULDER};
          float d2 = max(aSpan - ${WRIST}, 0.0);
          float rest = v.y;
          return vec3(side * (${SHOULDER} + d1 * cos(a1) + d2 * cos(a1 + a2)), rest + d1 * sin(a1) + d2 * sin(a1 + a2), v.z);
        }`,
      );
      shader.vertexShader = after(shader.vertexShader, '#include <begin_vertex>', `if (aSpan > ${SHOULDER}) transformed = gullBend(transformed, aWing.x, aWing.y);`);
    };
    material.customProgramCacheKey = () => 'curbside-gulls';
    this.mesh = new InstancedMesh(geometry, material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'gulls';
    scene.add(this.mesh);
    look.addGlowSource((_glows, view) => this.flush(look, view));
  }

  /** The gulls in view this frame, and their shadows. */
  private flush(look: Look, view: Rect): void {
    let n = 0;
    const day = 1 - worldUniforms.uNight.value;
    if (day >= 0.3) {
      const t = worldUniforms.uTime.value;
      const sun = worldUniforms.uSunDir.value;
      const lean = 1 / Math.max(sun.y, 0.35);
      const g = this.pose;
      const m = 6;
      const size = tuned.gullSize;
      for (const spec of this.gulls) {
        if (n >= CAPACITY) break;
        gullPose(spec, t, g);
        // The shadow can be in view while the bird isn't, and the other way round.
        const sx = g.x - sun.x * lean * g.y;
        const sz = g.z - sun.z * lean * g.y;
        if (sx > view.minX - m && sx < view.maxX + m && sz > view.minZ - m && sz < view.maxZ + m) {
          look.contactShadows.add(sx, sz, g.heading, 1.3 * size, 0.35 * size, 0.5, 0.3 * day);
        }
        if (g.x < view.minX - m || g.x > view.maxX + m || g.z < view.minZ - m || g.z > view.maxZ + m) continue;
        e.set(0, g.heading, g.bank);
        q.setFromEuler(e);
        this.mesh.setMatrixAt(n, m4.compose(p.set(g.x, g.y, g.z), q, s.setScalar(SIZE * size)));
        const beat = Math.sin(g.flap * Math.PI * 2);
        this.wing.array[n * 2] = g.gliding ? GLIDE_IN : 0.12 + 0.6 * beat;
        this.wing.array[n * 2 + 1] = g.gliding ? GLIDE_OUT : -0.1 + 0.35 * Math.sin(g.flap * Math.PI * 2 - 0.7);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    uploadRange(this.mesh.instanceMatrix, n);
    uploadRange(this.wing, n);
  }
}

/**
 * The gull, nose to +Z, up +Y, metres before SIZE: flat-shaded triangles,
 * each vertex carrying its colour and its span (|x| for wing vertices, 0
 * for the body), which the shader bends the wings by.
 */
export function gullGeometry(): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const span: number[] = [];
  const tri = (a: P, b: P, c: P, rgb: Rgb, wing: boolean) => {
    for (const v of [a, b, c]) {
      pos.push(v[0], v[1], v[2]);
      col.push(rgb[0], rgb[1], rgb[2]);
      span.push(wing ? Math.abs(v[0]) : 0);
    }
  };
  const quad = (a: P, b: P, c: P, d: P, rgb: Rgb, wing = false) => {
    tri(a, b, c, rgb, wing);
    tri(a, c, d, rgb, wing);
  };
  // A tapered box between two cross-sections (half width w, half height h, centred at y) at z0 and z1.
  const section = (z0: number, w0: number, h0: number, y0: number, z1: number, w1: number, h1: number, y1: number, rgb: Rgb, under: Rgb = rgb, xo = 0) => {
    const a: P[] = [[xo - w0, y0 - h0, z0], [xo + w0, y0 - h0, z0], [xo + w0, y0 + h0, z0], [xo - w0, y0 + h0, z0]];
    const b: P[] = [[xo - w1, y1 - h1, z1], [xo + w1, y1 - h1, z1], [xo + w1, y1 + h1, z1], [xo - w1, y1 + h1, z1]];
    quad(a[3], a[2], b[2], b[3], rgb); // top
    quad(a[1], a[0], b[0], b[1], under); // bottom
    quad(a[2], a[1], b[1], b[2], rgb); // +x side
    quad(a[0], a[3], b[3], b[0], rgb); // -x side
    quad(a[0], a[1], a[2], a[3], rgb); // back cap
    quad(b[3], b[2], b[1], b[0], rgb); // front cap
  };
  // Tail fan, body, chest, head, beak.
  section(-0.4, 0.07, 0.008, 0.01, -0.26, 0.035, 0.012, 0.0, WHITE, PALE);
  section(-0.26, 0.035, 0.03, 0.0, -0.06, 0.065, 0.055, 0.0, WHITE, PALE);
  section(-0.06, 0.065, 0.055, 0.0, 0.12, 0.055, 0.05, 0.01, WHITE);
  section(0.12, 0.045, 0.045, 0.03, 0.22, 0.032, 0.035, 0.04, WHITE);
  section(0.22, 0.012, 0.012, 0.035, 0.32, 0.003, 0.004, 0.025, YELLOW);
  // A dark eye each side of the head.
  for (const sx of [-1, 1]) section(0.16, 0.006, 0.009, 0.05, 0.18, 0.006, 0.009, 0.05, BLACK, BLACK, sx * 0.036);
  // Wings: an arm panel, a hand panel swept back, and a black tip, a thin slab each.
  for (const sx of [-1, 1]) {
    const x = (v: number) => sx * v;
    const t = 0.008;
    const slab = (a: P, b: P, c: P, d: P, rgb: Rgb) => {
      // a,b along the leading edge (inboard, outboard), c,d the trailing edge (outboard, inboard).
      const up = (v: P): P => [v[0], v[1] + t, v[2]];
      const dn = (v: P): P => [v[0], v[1] - t, v[2]];
      const top = sx > 0 ? [up(a), up(b), up(c), up(d)] : [up(b), up(a), up(d), up(c)];
      quad(top[0], top[1], top[2], top[3], rgb, true);
      const bot = sx > 0 ? [dn(d), dn(c), dn(b), dn(a)] : [dn(c), dn(d), dn(a), dn(b)];
      quad(bot[0], bot[1], bot[2], bot[3], rgb === BLACK ? BLACK : PALE, true);
      quad(up(a), dn(a), dn(b), up(b), rgb, true);
      quad(up(c), dn(c), dn(d), up(d), rgb, true);
    };
    slab([x(SHOULDER), 0.02, 0.09], [x(WRIST), 0.02, 0.07], [x(WRIST), 0.02, -0.1], [x(SHOULDER), 0.02, -0.11], WHITE);
    slab([x(WRIST), 0.02, 0.07], [x(0.58), 0.02, 0.0], [x(0.56), 0.02, -0.1], [x(WRIST), 0.02, -0.1], WHITE);
    slab([x(0.58), 0.02, 0.0], [x(0.74), 0.02, -0.08], [x(0.72), 0.02, -0.12], [x(0.56), 0.02, -0.1], BLACK);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aSpan', new BufferAttribute(new Float32Array(span), 1));
  g.computeVertexNormals();
  return g;
}
