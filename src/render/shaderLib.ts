/**
 * GLSL shared by the world's materials, injected with onBeforeCompile so
 * three.js lighting, shadows and fog keep working:
 *
 * - `worldUniforms`: one set of uniform objects (time, night, wetness, lamp
 *   colour) shared by reference across every material, so SceneLighting
 *   updates them once per frame with no recompiles.
 * - Integer hashing and value noise (exact on mobile GPUs at any world
 *   coordinate, unlike the classic fract(sin()) hash).
 * - `ubStreetLight(worldPos, normal)`: the street lamps' light, computed
 *   analytically from the lamp layout in world/streetLamps.ts. Ground, walls,
 *   cars and people all pick it up at night with no real lights at all.
 */
import { Color, type IUniform } from 'three';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT } from '../world/city';
import { LAMP_ARM, LAMP_HEIGHT, LAMP_OFFSET, LAMP_SPACING } from '../world/streetLamps';

export const worldUniforms = {
  /** Seconds since start (animated water, blinking lights, neon flicker). */
  uTime: { value: 0 },
  /** 0 by day, 1 at night. */
  uNight: { value: 0 },
  /** 0 dry .. 1 soaked: darker surfaces and puddles (rain hook). */
  uWetness: { value: 0 },
  /** Street lamp colour (linear). */
  uLampColor: { value: new Color('#ffb866') },
  /** Sky colour (linear), for faked reflections in glass and puddles. */
  uSkyTint: { value: new Color('#bcd2ff') },
} satisfies Record<string, IUniform>;

/** Add the shared world uniforms to a shader being compiled. */
export function useWorldUniforms(shader: { uniforms: Record<string, IUniform> }): void {
  Object.assign(shader.uniforms, worldUniforms);
}

const f = (n: number) => n.toFixed(4);

/** Declarations + helpers; include once per shader stage that needs them. */
export const UB_COMMON = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uWetness;
uniform vec3 uLampColor;
uniform vec3 uSkyTint;

const float UB_HALF = ${f(HALF_EXTENT)};
const float UB_BLOCK = ${f(BLOCK_SIZE)};
const float UB_BLOCKS = ${f(BLOCKS_PER_SIDE)};

uint ubPcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
/**
 * Hash of an integer lattice point (pass floor()ed coordinates), 0..1. The
 * coordinates are mixed by odd multipliers and go through one PCG round: half
 * the cost of nesting a round per axis, and noise calls a lot of these.
 */
float ubHash(vec2 p) {
  uvec2 q = uvec2(ivec2(p) + 1048576);
  return float(ubPcg(q.x * 1597334677u ^ q.y * 3812015801u)) * (1.0 / 4294967296.0);
}
float ubHash3(vec3 p) {
  uvec3 q = uvec3(ivec3(p) + 1048576);
  return float(ubPcg(q.x * 1597334677u ^ q.y * 3812015801u ^ q.z * 2798796415u)) * (1.0 / 4294967296.0);
}
/** Smooth value noise, 0..1. */
float ubNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  float a = ubHash(i);
  float b = ubHash(i + vec2(1.0, 0.0));
  float c = ubHash(i + vec2(0.0, 1.0));
  float d = ubHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float ubFbm(vec2 p) {
  return ubNoise(p) * 0.6 + ubNoise(p * 2.13 + 17.0) * 0.28 + ubNoise(p * 4.37 + 41.0) * 0.12;
}
/** 1 inside [a, b], anti-aliased over width w. */
float ubBand(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
}
/** 1 where |x| < r, anti-aliased. */
float ubLine(float x, float r, float w) {
  return 1.0 - smoothstep(r - w, r + w, abs(x));
}
`;

/**
 * Street lighting. Lamp heads hang LAMP_OFFSET - LAMP_ARM from every road
 * centreline (both sides), LAMP_SPACING apart along each block side, at
 * LAMP_HEIGHT. A fragment only looks at the two nearest lamps on each of the
 * four nearest lamp lines (8 in all), skipped entirely by day.
 * Needs UB_COMMON.
 */
export const UB_STREET_LIGHT = /* glsl */ `
const float UB_LAMP_OFF = ${f(LAMP_OFFSET - LAMP_ARM)};
const float UB_LAMP_SPACING = ${f(LAMP_SPACING)};
const float UB_LAMP_H = ${f(LAMP_HEIGHT - 0.25)};
const float UB_LAMP_REACH2 = 132.0;

float ubLampTerm(vec3 wp, vec3 n, vec2 lamp) {
  vec3 L = vec3(lamp.x, UB_LAMP_H, lamp.y) - wp;
  float d2 = dot(L, L);
  float ndl = max(dot(n, L) * inversesqrt(d2), 0.0);
  float reach = max(1.0 - d2 / UB_LAMP_REACH2, 0.0);
  return ndl * reach * reach * (34.0 / (d2 + 7.0));
}

/** Irradiance from nearby street lamps at world position wp with unit normal n (0 by day). */
vec3 ubStreetLight(vec3 wp, vec3 n) {
  if (uNight < 0.01) return vec3(0.0);
  vec2 g = wp.xz + UB_HALF;
  vec2 cell = floor(g / UB_BLOCK);
  vec2 local = g - cell * UB_BLOCK;
  vec2 line = floor(g / UB_BLOCK + 0.5);
  vec2 origin = cell * UB_BLOCK - UB_HALF;
  float sum = 0.0;
  // Lamps beside the north-south roads, spaced along z within this block row.
  if (cell.y >= 0.0 && cell.y < UB_BLOCKS) {
    float za = origin.y + UB_LAMP_SPACING * clamp(floor(local.y / UB_LAMP_SPACING), 1.0, 2.0);
    for (int s = 0; s < 2; s++) {
      float side = s == 0 ? -1.0 : 1.0;
      float col = line.x - (s == 0 ? 1.0 : 0.0);
      if (col < 0.0 || col >= UB_BLOCKS) continue;
      float lx = line.x * UB_BLOCK - UB_HALF + side * UB_LAMP_OFF;
      sum += ubLampTerm(wp, n, vec2(lx, za)) + ubLampTerm(wp, n, vec2(lx, za + UB_LAMP_SPACING));
    }
  }
  // Lamps beside the east-west roads, spaced along x within this block column.
  if (cell.x >= 0.0 && cell.x < UB_BLOCKS) {
    float xa = origin.x + UB_LAMP_SPACING * clamp(floor(local.x / UB_LAMP_SPACING), 1.0, 2.0);
    for (int s = 0; s < 2; s++) {
      float side = s == 0 ? -1.0 : 1.0;
      float row = line.y - (s == 0 ? 1.0 : 0.0);
      if (row < 0.0 || row >= UB_BLOCKS) continue;
      float lz = line.y * UB_BLOCK - UB_HALF + side * UB_LAMP_OFF;
      sum += ubLampTerm(wp, n, vec2(xa, lz)) + ubLampTerm(wp, n, vec2(xa + UB_LAMP_SPACING, lz));
    }
  }
  return uLampColor * (sum * uNight);
}
`;

/** Glue for onBeforeCompile: insert `code` after the first occurrence of `anchor`. */
export function after(source: string, anchor: string, code: string): string {
  if (!source.includes(anchor)) throw new Error(`shader anchor not found: ${anchor}`);
  return source.replace(anchor, `${anchor}\n${code}`);
}

/** Replace the first occurrence of `anchor` (which must exist). */
export function replace(source: string, anchor: string, code: string): string {
  if (!source.includes(anchor)) throw new Error(`shader anchor not found: ${anchor}`);
  return source.replace(anchor, code);
}
