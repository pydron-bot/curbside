/**
 * The destruction test's facade scars, drawn by the building shader itself
 * (world/cityMesh.ts, everything behind `#ifdef CURBSIDE_BREACH`): no mesh
 * and no draw call of their own, lit like the wall (sun, shadows, street
 * lamps, bloom), wrapping round a corner with no z-fighting. No three.js
 * import, so the slot bookkeeping is unit-tested.
 *
 * Each sim breach slot (systems/breaches.ts) is a shader slot of two vec4s:
 * A = centre on the face plane and radius (0 = not drawn); B = side + 4 when
 * rich, depth, seed, birth time (uTime). The presenter keeps the newest
 * `cap` drawn (a per-style budget); uBreachN bounds the shader's loops.
 */
import { MAX_BREACHES } from '../systems/breaches';

export interface BreachUniforms {
  uBreachA: { value: Float32Array };
  uBreachB: { value: Float32Array };
  uBreachN: { value: number };
}

export function createBreachUniforms(): BreachUniforms {
  return {
    uBreachA: { value: new Float32Array(MAX_BREACHES * 4) },
    uBreachB: { value: new Float32Array(MAX_BREACHES * 4) },
    uBreachN: { value: 0 },
  };
}

/** The building shader's breach uniforms (shared by reference, like worldUniforms). */
export const breachUniforms = createBreachUniforms();

export class BreachScars {
  /** Each slot's radius while hidden by the cap (it comes back if the cap grows). */
  private readonly radius = new Float32Array(MAX_BREACHES);
  /** Write order per slot; 0 = empty. */
  private readonly serial = new Float64Array(MAX_BREACHES);
  private next = 1;
  private cap = MAX_BREACHES;
  private shown = 0;

  constructor(private readonly u: BreachUniforms = breachUniforms) {}

  /** Scars drawn now. */
  get visible(): number {
    return this.shown;
  }

  /** Slot `i` is drawn. */
  isVisible(i: number): boolean {
    return this.u.uBreachA.value[i * 4 + 3] > 0;
  }

  /** A breach (or a merge: the same slot, rewritten in place, its hot rim relit). */
  write(slot: number, x: number, y: number, z: number, radius: number, side: number, depth: number, seed: number, rich: boolean, birth: number): void {
    const a = this.u.uBreachA.value;
    const b = this.u.uBreachB.value;
    const k = slot * 4;
    a[k] = x;
    a[k + 1] = y;
    a[k + 2] = z;
    b[k] = side + (rich ? 4 : 0);
    b[k + 1] = depth;
    b[k + 2] = seed;
    b[k + 3] = birth;
    this.radius[slot] = radius;
    this.serial[slot] = this.next++;
    this.apply();
  }

  /** At most `cap` scars drawn: the oldest hide first; the newest always shows. */
  setCap(cap: number): void {
    const c = Math.max(1, Math.min(MAX_BREACHES, Math.floor(cap)));
    if (c === this.cap) return;
    this.cap = c;
    this.apply();
  }

  /** A style change: every scar takes the rich (desktop) or flat look. */
  restyle(rich: boolean): void {
    const b = this.u.uBreachB.value;
    for (let i = 0; i < MAX_BREACHES; i++) {
      if (this.serial[i] === 0) continue;
      const k = i * 4;
      b[k] = (b[k] >= 4 ? b[k] - 4 : b[k]) + (rich ? 4 : 0);
    }
  }

  clear(): void {
    this.u.uBreachA.value.fill(0);
    this.u.uBreachB.value.fill(0);
    this.radius.fill(0);
    this.serial.fill(0);
    this.next = 1;
    this.apply();
  }

  /** Draw the newest `cap` (by write order) and point uBreachN past the highest drawn slot. */
  private apply(): void {
    const a = this.u.uBreachA.value;
    let top = 0;
    let shown = 0;
    for (let i = 0; i < MAX_BREACHES; i++) {
      const s = this.serial[i];
      let newer = 0;
      if (s > 0) for (let j = 0; j < MAX_BREACHES; j++) if (this.serial[j] > s) newer++;
      const draw = s > 0 && newer < this.cap;
      a[i * 4 + 3] = draw ? this.radius[i] : 0;
      if (draw) {
        shown++;
        top = i + 1;
      }
    }
    this.u.uBreachN.value = top;
    this.shown = shown;
  }
}

/** Declarations and the per-building mask, in the building shader's vertex stage (after <common>). */
export const BREACH_VERTEX_GLSL = /* glsl */ `
#ifdef CURBSIDE_BREACH
uniform vec4 uBreachA[${MAX_BREACHES}];
uniform float uBreachN;
flat varying highp uint vBreachMask;
/**
 * The breach slots that can touch the building box base ± size (its crater
 * and the soot above it), one bit each. The same for every vertex of an
 * instance, so the fragment stage loops only over these.
 */
uint breachMask(vec3 base, vec3 size) {
  vec3 lo = base - vec3(size.x * 0.5, 0.0, size.z * 0.5);
  vec3 hi = base + vec3(size.x * 0.5, size.y, size.z * 0.5);
  uint m = 0u;
  for (int i = 0; i < ${MAX_BREACHES}; i++) {
    if (float(i) >= uBreachN) break;
    vec4 a = uBreachA[i];
    if (a.w <= 0.0) continue;
    float h = a.w * 3.2 + 0.3;
    vec3 bLo = vec3(a.x - h, a.y - a.w * 1.5, a.z - h);
    vec3 bHi = vec3(a.x + h, a.y + a.w + 7.5, a.z + h);
    if (all(lessThanEqual(lo, bHi)) && all(lessThanEqual(bLo, hi))) m |= 1u << uint(i);
  }
  return m;
}
#endif
`;

/**
 * The craters in the building shader's fragment stage (after <common>, needs
 * UB_COMMON, vInfo and uDistWin). Called for wall fragments with the wall's
 * colour, glow and normal already worked out.
 */
export const BREACH_FRAGMENT_GLSL = /* glsl */ `
#ifdef CURBSIDE_BREACH
uniform vec4 uBreachA[${MAX_BREACHES}];
uniform vec4 uBreachB[${MAX_BREACHES}];
flat varying highp uint vBreachMask;

/** What the wall is made of under its face, by district (linear). */
vec3 breachCore(int d) {
  if (d == 0) return vec3(0.29, 0.285, 0.27);  // downtown: concrete
  if (d == 2) return vec3(0.42, 0.39, 0.34);   // arts: render over block
  if (d == 3) return vec3(0.14, 0.145, 0.15);  // industrial: block and steel
  return vec3(0.3, 0.1, 0.06);                 // oldtown, residential: brick
}

/**
 * Each crater is half an ellipsoid (radii r along the face, 0.85 r up, depth
 * into the wall) with a ragged rim. Inside: the broken wall, its normal
 * leaning in; the lower half, which faces up toward the overhead camera and
 * the sky, stays the core's colour and only the upper back goes dark (an
 * all-dark bowl read as a scorch mark at dusk). Rich (desktop) looks into
 * the cavity instead: the view ray's far hit gives the cavity's normal and
 * depth, cut floor slabs, rebar, a faint room light deep inside at full
 * night only, a rim that glows hot for a few seconds and embers along it
 * that outlast the dust; the cavity is shaded darker than the wall round it.
 * Round it: pale chipped wall in broken bits with a chunky lower lip (rich:
 * wider), and soot stretched up the wall (rich: wider, darker). The overhead
 * camera squashes a crater to ~4:1, so the rich extras are the ones that
 * survive that: colour, light and big shapes.
 */
void breachSurface(inout vec3 col, inout vec3 glow, inout vec3 nW, vec3 wp, float px) {
  uint m = vBreachMask;
  int dist = int(vInfo.w + 0.5);
  float floorH = uDistWin[dist].x;
  vec3 core = breachCore(dist);
  float soot = 0.0;
  float holes = 0.0;
  vec3 embers = vec3(0.0);
  for (int i = 0; i < ${MAX_BREACHES}; i++) {
    uint bits = m >> uint(i);
    if (bits == 0u) break;
    if ((bits & 1u) == 0u) continue;
    vec4 a = uBreachA[i];
    vec4 b = uBreachB[i];
    bool rich = b.x > 3.5;
    float side = rich ? b.x - 4.0 : b.x;
    vec3 n = side < 0.5 ? vec3(0.0, 0.0, -1.0) : (side < 1.5 ? vec3(1.0, 0.0, 0.0) : (side < 2.5 ? vec3(0.0, 0.0, 1.0) : vec3(-1.0, 0.0, 0.0)));
    vec3 t = vec3(-n.z, 0.0, n.x);
    float r = a.w;
    float depth = b.y;
    float seed = b.z;
    // Face space: along the face, up, into the wall.
    vec3 dv = wp - a.xyz;
    vec3 f = vec3(dot(dv, t), dv.y, -dot(dv, n));
    if (f.z < -0.05) continue; // a neighbour's face across an alley
    vec3 axes = vec3(r, r * 0.85, depth);
    vec3 q = f / axes;
    vec2 dir = normalize(q.xy + vec2(1e-4, 0.0));
    float rim = 1.0 + 0.3 * (ubNoise(dir * 2.2 + seed * 61.0) - 0.5) + 0.14 * (ubNoise(dir * 7.0 + seed * 23.0) - 0.5);
    float e = length(q);
    float aa = px / r + 0.004;

    // Soot from the blast's smoke: round the crater and stretched up the wall.
    vec2 sq = vec2(f.x / (r * (rich ? 2.6 : 1.6)), f.y > 0.0 ? f.y / (r + (rich ? 7.0 : 4.4)) : f.y / (r * (rich ? 1.5 : 1.25)));
    float sn = ubNoise(vec2(f.x * 1.1, f.y * 0.45) + seed * 37.0);
    soot = max(soot, (1.0 - smoothstep(0.3, 1.0, length(sq) + 0.4 * (sn - 0.5))) * step(f.z, 0.3) * (rich ? 1.0 : 0.85));
    if (e > rim + 0.6) continue;

    float hole = 1.0 - smoothstep(rim - aa, rim + aa, e);
    float grit = ubNoise(f.xy * 4.0 + seed * 11.0);
    // The broken edge in bits, not a ring (a continuous band read as a sticker's outline), chunky along the lower lip.
    float lower = 1.0 - smoothstep(-0.6, 0.1, q.y);
    float lipW = (0.18 + (rich ? 0.34 : 0.2) * lower) / r;
    float lip = ubBand(e, rim, rim + lipW * (0.6 + 0.8 * ubNoise(dir * 11.0 + seed * 7.0)), aa) * (1.0 - hole);
    lip *= smoothstep(0.4, 0.6, 0.6 * ubNoise(dir * 5.0 + seed * 3.0) + 0.5 * grit);

    // The flat bowl: the lower half faces up (lit, and toward the camera), the upper back is in shadow.
    float d01 = clamp(1.0 - e / rim, 0.0, 1.0);
    vec3 off = t * q.x + vec3(0.0, q.y / 0.85, 0.0);
    vec3 cn = normalize(n * (0.35 + 0.9 * d01) - off * 0.9);
    float back = smoothstep(-0.1, 0.7, q.y);
    vec3 ic = core * mix(mix(0.9, 0.78, d01), mix(0.62, 0.2, d01), back) * (0.8 + 0.4 * grit);
    vec3 ig = vec3(0.0);
    if (rich) {
      // Into the cavity: the far root of the view ray through q in the ellipsoid, with the rim's broad shape
      // only (its fine notches made the cavity's shading a sunburst).
      float rimC = 1.0 + 0.3 * (ubNoise(dir * 2.2 + seed * 61.0) - 0.5);
      vec3 vd = normalize(wp - cameraPosition);
      vec3 D = vec3(dot(vd, t), vd.y, -dot(vd, n)) / axes;
      float A = dot(D, D);
      float B = dot(q, D);
      float C = dot(q, q) - rimC * rimC;
      float s = (-B + sqrt(max(B * B - A * C, 0.0))) / A;
      vec3 h = q + D * s;
      vec3 hm = h * axes;
      vec3 g = -h / axes;
      // Half way back to the wall's normal: the bowl's own slope, without radial streaks.
      cn = normalize(mix(n, normalize(t * g.x + vec3(0.0, g.y, 0.0) - n * g.z), 0.55));
      float hd = clamp(hm.z / depth, 0.0, 1.0);
      // Floor slabs cut through, the rooms between them dark; rebar ends near the edge.
      float hy = a.y + hm.y;
      float fy = mod(hy + 0.15, floorH);
      float slab = (1.0 - smoothstep(0.24, 0.34, min(fy, floorH - fy))) * step(0.6, hy);
      float rebar = step(0.86, ubHash(floor(vec2(hm.x, hy) * 7.0) + seed * 97.0)) * (1.0 - hd) * (1.0 - slab);
      float hg = ubNoise(hm.xy * 5.0 + seed * 13.0);
      ic = mix(core * 0.55, core * 1.25, slab) * mix(1.0, 0.3, hd * (1.0 - slab)) * (0.75 + 0.5 * hg);
      ic = mix(ic, vec3(0.16, 0.07, 0.035), rebar);
      // Occluded: a hole is darker than the wall round it, most at its middle.
      ic *= mix(0.5, 0.9, 1.0 - d01);
      // A faint room light deep in the middle, at full night only (uNight is ~0.4 by dusk: lighting the whole
      // cavity then made it a glowing mound); the broken edges glow hot for a few seconds.
      ig = vec3(1.0, 0.55, 0.25) * 0.12 * smoothstep(0.8, 1.0, uNight) * smoothstep(0.7, 0.9, hd) * smoothstep(0.4, 0.8, d01) * (1.0 - slab) * (0.7 + 0.6 * hg);
      float age = uTime - b.w;
      float hot = 1.0 - smoothstep(0.0, 3.0, age);
      ig += vec3(1.0, 0.35, 0.08) * hot * hot * (2.2 * (1.0 - smoothstep(0.0, 0.35, d01)) + 0.6 * hd) * (0.6 + 0.8 * hg);
      // Embers in a few patches along the edge (mostly the lower lip), flickering, until well after the dust has gone (~7 s).
      float ember = (1.0 - smoothstep(1.5, 7.5, age)) * ubBand(e, rim - 0.15, rim + lipW, aa);
      ember *= smoothstep(0.5, 0.72, ubNoise(dir * 2.5 + seed * 17.0)) * (0.3 + 0.7 * lower);
      if (ember > 0.0) {
        vec2 cell = floor(f.xy * 8.0);
        float spark = step(0.75, ubHash(cell + seed * 53.0));
        embers += vec3(1.0, 0.38, 0.08) * 3.0 * ember * spark * (0.65 + 0.35 * sin(uTime * 9.0 + ubHash(cell + 7.0) * 40.0));
      }
    }
    col = mix(col, ic, hole);
    glow = glow * (1.0 - hole) + ig * hole;
    nW = normalize(mix(nW, cn, hole));
    holes = max(holes, hole);
    // The broken edge: pale chipped wall material just outside the hole.
    col = mix(col, core * (1.6 + 0.6 * grit + 0.6 * lower), lip * 0.9);
    glow *= 1.0 - lip;
  }
  // Soot is on the wall's face: barely inside the hole (it took half the light out of the bowl, a black splat at night).
  soot *= 1.0 - 0.85 * holes;
  col *= 1.0 - 0.9 * soot;
  glow = glow * (1.0 - 0.9 * soot) + embers;
}
#endif
`;
