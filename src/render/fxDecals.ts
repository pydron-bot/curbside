import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { worldUniforms } from './shaderLib';

/** Decal looks, drawn analytically in the shader. */
export const DECAL = {
  /** Tyre rubber: a dark ribbon with tread streaks (uv.x across, uv.y metres along). */
  skid: 0,
  /** Explosion scorch: a ragged black blotch, browner at the edge. */
  scorch: 1,
  /** Bullet strike on the ground: a small dark pock. */
  pock: 2,
  /** Metal scrape: a pale scratch line. */
  scuff: 3,
  /**
   * Rubble spill at the foot of a breached wall: dust and gravel, densest at
   * the wall (uv.y 0.5) and thinning outward (uv.y 1); the half behind the
   * wall is never drawn. Grey concrete.
   */
  spill: 4,
  /** The same in brick: red-brown. */
  spillBrick: 5,
} as const;
export type DecalKind = (typeof DECAL)[keyof typeof DECAL];

/** Skid / scuff / pock quads in the long ring (oldest overwritten first). */
const RIBBON_QUADS = 2400;
/** Scorch marks get their own ring so tyre marks never erase them. */
const SCORCH_QUADS = 32;
/** Rubble spills: their own ring, after the scorches, so the gravel lies on the soot. */
const SPILL_QUADS = 32;
const QUADS = RIBBON_QUADS + SCORCH_QUADS + SPILL_QUADS;
/** Height above the ground (the ground is y = 0; contact shadows sit at 0.03). */
const Y = 0.018;

/**
 * Marks on the ground: tyre skid ribbons, explosion scorches, bullet pocks and
 * scrapes. Every mark is a quad in one ring-buffered geometry (one draw call
 * for all of them); each vertex carries its birth time and lifetime and the
 * shader fades it out, so nothing is touched per frame except new quads
 * (uploaded as a range). Expired quads collapse in the vertex shader.
 *
 * Transparent and drawn before every other transparent (renderOrder -1), so it
 * lands after the ground (an opaque mesh) and under contact shadows and glows.
 */
export class GroundDecals {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  private readonly uv: Float32Array;
  /** Per vertex: birth time, lifetime, opacity, kind. */
  private readonly data: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly uvAttr: BufferAttribute;
  private readonly dataAttr: BufferAttribute;
  private readonly material: ShaderMaterial;
  private ribbonNext = 0;
  private scorchNext = 0;
  private spillNext = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  /** Seconds, advanced by update(); the shader's clock. */
  private time = 0;
  /** When the last mark written so far expires: the layer isn't drawn after that. */
  private until = 0;

  constructor() {
    const v = QUADS * 4;
    this.pos = new Float32Array(v * 3);
    this.uv = new Float32Array(v * 2);
    this.data = new Float32Array(v * 4);
    // Unused quads are born long ago with no life: collapsed.
    for (let i = 0; i < v; i++) this.data[i * 4] = -1e6;
    const index = new Uint16Array(QUADS * 6);
    for (let q = 0; q < QUADS; q++) {
      const b = q * 4;
      index.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
    }
    const geo = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.uvAttr = new BufferAttribute(this.uv, 2).setUsage(DynamicDrawUsage);
    this.dataAttr = new BufferAttribute(this.data, 4).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('uv', this.uvAttr);
    geo.setAttribute('aDecal', this.dataAttr);
    geo.setIndex(new BufferAttribute(index, 1));
    geo.boundingSphere = new Sphere(new Vector3(), 1e5);
    this.material = decalMaterial();
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.visible = false;
    this.mesh.name = 'groundDecals';
  }

  /** Advance the fade clock (game time: frozen while paused). */
  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uDecalTime.value = this.time;
    // No live marks, no draw call; a pending upload is drawn once so it isn't lost.
    this.mesh.visible = this.time < this.until || this.dirtyMax >= 0;
    if (this.dirtyMax < 0) return;
    this.upload(this.posAttr);
    this.upload(this.uvAttr);
    this.upload(this.dataAttr);
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  /** Send just the vertices written since the last frame. */
  private upload(attr: BufferAttribute): void {
    const size = attr.itemSize;
    attr.clearUpdateRanges();
    attr.addUpdateRange(this.dirtyMin * size, (this.dirtyMax - this.dirtyMin + 1) * size);
    attr.needsUpdate = true;
  }

  /**
   * A ribbon segment: from edge (ax, az)–(bx, bz) at the start to
   * (cx, cz)–(dx, dz) at the end (a = start left, b = start right, c = end
   * right, d = end left). v0/v1 are the distance along the ribbon (m) at each
   * end, for the tread pattern.
   */
  segment(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    dx: number,
    dz: number,
    v0: number,
    v1: number,
    opacity: number,
    life: number,
    kind: DecalKind = DECAL.skid,
  ): void {
    const q = this.ribbonNext;
    this.ribbonNext = (this.ribbonNext + 1) % RIBBON_QUADS;
    this.writeQuad(q, ax, az, bx, bz, cx, cz, dx, dz, 0, v0, 1, v0, 1, v1, 0, v1, opacity, life, kind);
  }

  /** A square mark of half-size r centred at (x, z), turned by `angle`. */
  stamp(x: number, z: number, r: number, angle: number, opacity: number, life: number, kind: DecalKind): void {
    let q: number;
    if (kind === DECAL.scorch) {
      q = RIBBON_QUADS + this.scorchNext;
      this.scorchNext = (this.scorchNext + 1) % SCORCH_QUADS;
    } else if (kind === DECAL.spill || kind === DECAL.spillBrick) {
      q = RIBBON_QUADS + SCORCH_QUADS + this.spillNext;
      this.spillNext = (this.spillNext + 1) % SPILL_QUADS;
    } else {
      q = this.ribbonNext;
      this.ribbonNext = (this.ribbonNext + 1) % RIBBON_QUADS;
    }
    const c = Math.cos(angle) * r;
    const s = Math.sin(angle) * r;
    // Corners (-1,-1), (1,-1), (1,1), (-1,1) rotated.
    this.writeQuad(q, x - c + s, z - s - c, x + c + s, z + s - c, x + c - s, z + s + c, x - c - s, z - s + c, 0, 0, 1, 0, 1, 1, 0, 1, opacity, life, kind);
  }

  /** Remove every mark (e.g. a fresh run). */
  clear(): void {
    for (let i = 0; i < QUADS * 4; i++) this.data[i * 4] = -1e6;
    this.until = 0;
    this.dirtyMin = 0;
    this.dirtyMax = QUADS * 4 - 1;
  }

  private writeQuad(
    q: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    x3: number,
    z3: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    u2: number,
    v2: number,
    u3: number,
    v3: number,
    opacity: number,
    life: number,
    kind: number,
  ): void {
    const b = q * 4;
    const p = this.pos;
    const o = b * 3;
    p[o] = x0;
    p[o + 1] = Y;
    p[o + 2] = z0;
    p[o + 3] = x1;
    p[o + 4] = Y;
    p[o + 5] = z1;
    p[o + 6] = x2;
    p[o + 7] = Y;
    p[o + 8] = z2;
    p[o + 9] = x3;
    p[o + 10] = Y;
    p[o + 11] = z3;
    const t = this.uv;
    const u = b * 2;
    t[u] = u0;
    t[u + 1] = v0;
    t[u + 2] = u1;
    t[u + 3] = v1;
    t[u + 4] = u2;
    t[u + 5] = v2;
    t[u + 6] = u3;
    t[u + 7] = v3;
    const d = this.data;
    for (let k = 0; k < 4; k++) {
      const i = (b + k) * 4;
      d[i] = this.time;
      d[i + 1] = life;
      d[i + 2] = opacity;
      d[i + 3] = kind;
    }
    this.dirtyMin = Math.min(this.dirtyMin, b);
    this.dirtyMax = Math.max(this.dirtyMax, b + 3);
    this.until = Math.max(this.until, this.time + life);
  }
}

function decalMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uDecalTime: { value: 0 }, uNight: worldUniforms.uNight },
    vertexShader: /* glsl */ `
      attribute vec4 aDecal;
      uniform float uDecalTime;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vKind;
      varying vec2 vWorld;
      void main() {
        float age = uDecalTime - aDecal.x;
        float life = aDecal.y;
        vUv = uv;
        vKind = aDecal.w;
        vWorld = position.xz;
        // Fade over the last 40% of life; the first moments of a scorch are hot and dark.
        vAlpha = aDecal.z * (1.0 - smoothstep(life * 0.6, life, age));
        if (age < 0.0 || age > life) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // expired: off screen, no fragments
          return;
        }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vKind;
      varying vec2 vWorld;
      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        float a;
        vec3 col;
        if (vKind < 0.5) {
          // Tyre ribbon: soft edges, tread grooves across, patchy along.
          float x = vUv.x;
          float edge = smoothstep(0.0, 0.18, x) * smoothstep(1.0, 0.82, x);
          float tread = 0.72 + 0.28 * sin(x * 31.4);
          float wear = 0.65 + 0.35 * noise(vec2(x * 3.0, vUv.y * 1.7));
          a = edge * tread * wear;
          col = vec3(0.012, 0.011, 0.01);
        } else if (vKind < 1.5) {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          float ragged = noise(p * 3.2 + 7.0) * 0.45 + noise(p * 7.0) * 0.2;
          a = 1.0 - smoothstep(0.35, 0.95, r + ragged - 0.25);
          float soot = smoothstep(0.75, 0.1, r);
          col = mix(vec3(0.05, 0.035, 0.025), vec3(0.008, 0.007, 0.006), soot);
          a *= 0.55 + 0.45 * soot;
        } else if (vKind < 2.5) {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          a = 1.0 - smoothstep(0.25, 1.0, r);
          col = vec3(0.02);
        } else if (vKind < 3.5) {
          float x = vUv.x;
          a = smoothstep(0.0, 0.35, x) * smoothstep(1.0, 0.65, x) * (0.6 + 0.4 * noise(vec2(x * 4.0, vUv.y * 6.0)));
          // Bare metal catches the daylight; unlit at night it would glow on the dark road.
          col = vec3(0.62, 0.6, 0.56) * (1.0 - 0.75 * uNight);
        } else {
          // Rubble spill: x along the wall, y out from it (behind it: nothing).
          vec2 p = vUv * 2.0 - 1.0;
          float d = length(vec2(p.x, max(p.y, 0.0) / 0.7));
          float ragged = noise(vWorld * 1.4) * 0.35 + noise(vWorld * 4.5) * 0.15;
          float body = (1.0 - smoothstep(0.35, 0.9, d + ragged - 0.2)) * smoothstep(-0.02, 0.05, p.y);
          vec3 dust = vKind < 4.5 ? vec3(0.42, 0.405, 0.38) : vec3(0.42, 0.24, 0.18);
          // Gravel: at most one stone per 20 cm cell, denser near the wall; each
          // lit on its sun side and shadowed on the other, so it reads as a bump.
          vec2 g = vWorld * 5.0;
          vec2 cell = floor(g);
          vec2 f = fract(g) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.4;
          float size = 0.16 + 0.22 * hash(cell + 1.7);
          float on = step(hash(cell), body * (1.05 - 0.75 * d));
          // Angular, not round: a turned blend of a square and a diamond, stretched.
          float t = hash(cell + 9.2) * 6.283;
          mat2 turn = mat2(cos(t), -sin(t), sin(t), cos(t));
          vec2 stretch = vec2(1.0, 1.25 + 0.5 * hash(cell + 2.4));
          float sq = hash(cell + 4.6);
          vec2 r = turn * f * stretch;
          float poly = mix(max(abs(r.x), abs(r.y)), (abs(r.x) + abs(r.y)) * 0.75, sq);
          float stone = on * (1.0 - smoothstep(size * 0.8, size * 0.9, poly));
          // Its shadow: the same shape a little way off in world space.
          vec2 rs = turn * (f - vec2(0.06, 0.07)) * stretch;
          float spoly = mix(max(abs(rs.x), abs(rs.y)), (abs(rs.x) + abs(rs.y)) * 0.75, sq);
          float shadow = on * (1.0 - smoothstep(size * 0.8, size * 1.0, spoly)) * (1.0 - stone);
          float tone = 0.55 + 0.45 * hash(cell + 5.3);
          float lit = 0.95 - 0.5 * (f.x + f.y) / max(size, 0.01);
          col = mix(dust * 0.75, dust * tone * lit, stone);
          col = mix(col, vec3(0.03), shadow * 0.8);
          a = max(body * 0.65 * (1.0 - 0.5 * d), max(stone, shadow * 0.7));
          col *= 1.0 - 0.7 * uNight;
        }
        a *= vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
}
