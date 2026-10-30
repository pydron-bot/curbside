import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  PlaneGeometry,
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import { UB_COMMON, UB_STREET_LIGHT, after, replace, useWorldUniforms } from '../render/shaderLib';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, type City } from './city';
import { DISTRICTS, DISTRICT_STYLES, PAVINGS } from './districts';
import { mulberry32 } from './random';

/** Ground extends one block past the city on every side (ring road, walls, then the water). */
const GROUND_SIZE = 2 * HALF_EXTENT + 2 * BLOCK_SIZE;
/** Resolution of the baked contact-shadow texture (~1.1 m per texel over the whole ground). */
const AO_SIZE = 1024;

/** What a block's lot is drawn as (block data texture, red channel). */
const LOT_KIND = { buildings: 0, park: 1, plaza: 2, parking: 3 } as const;

/**
 * The ground: one big plane whose surface is drawn entirely in the fragment
 * shader from world position — asphalt with grain, cracks, patches and oil,
 * crisp anti-aliased road markings (double centre lines, stop lines, zebra
 * crossings), kerbs with a lip and gutter, district paving, lot interiors
 * (grass parks with paths, plazas with a fountain, car parks with bays), and
 * water beyond the city walls. It's a MeshLambertMaterial underneath, so sun
 * light, shadows and fog work as usual; street lamps add their pools at night.
 *
 * Layout comes from the same constants as the city generator (BLOCK_SIZE,
 * ROAD_WIDTH, SIDEWALK), and per-block facts (lot kind, district) from a
 * 16×16 data texture, so markings always match the roads cars drive on.
 */
export function createGround(city: City): Mesh {
  const blocks = blockTexture(city);
  const ao = contactShadowTexture(city);
  const mat = new MeshLambertMaterial({ color: '#ffffff' });
  mat.onBeforeCompile = (shader) => {
    useWorldUniforms(shader);
    shader.uniforms.uBlocks = { value: blocks };
    shader.uniforms.uAo = { value: ao };
    shader.vertexShader = after(shader.vertexShader, '#include <common>', 'varying vec2 vGroundXZ;');
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <project_vertex>',
      'vGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <common>',
      `varying vec2 vGroundXZ;
      uniform sampler2D uBlocks;
      uniform sampler2D uAo;
      ${UB_COMMON}
      ${UB_STREET_LIGHT}
      ${GROUND_GLSL}`,
    );
    shader.fragmentShader = replace(
      shader.fragmentShader,
      '#include <color_fragment>',
      `vec3 groundGlow = vec3(0.0);
      diffuseColor.rgb = groundColour(vGroundXZ, groundGlow);`,
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      `totalEmissiveRadiance += groundGlow + diffuseColor.rgb * ubStreetLight(vec3(vGroundXZ.x, 0.0, vGroundXZ.y), vec3(0.0, 1.0, 0.0));`,
    );
  };
  mat.customProgramCacheKey = () => 'curbside-ground';

  const ground = new Mesh(new PlaneGeometry(GROUND_SIZE, GROUND_SIZE), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  return ground;
}

/**
 * 16×16 RGBA: R lot kind, G district, B a random byte, A paving style.
 * Half the plazas become car parks.
 */
function blockTexture(city: City): DataTexture {
  const n = BLOCKS_PER_SIDE;
  const data = new Uint8Array(n * n * 4);
  const rand = mulberry32(city.seed ^ 0x9e3779b9);
  for (const b of city.blocks) {
    const r = Math.floor(rand() * 256);
    let kind: number = LOT_KIND[b.kind];
    if (b.kind === 'plaza' && r < 128) kind = LOT_KIND.parking;
    const i = (b.bz * n + b.bx) * 4;
    data[i] = kind;
    data[i + 1] = DISTRICTS.indexOf(b.district);
    data[i + 2] = r;
    data[i + 3] = PAVINGS.indexOf(DISTRICT_STYLES[b.district].paving);
  }
  const tex = new DataTexture(data, n, n, RGBAFormat, UnsignedByteType);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Soft darkening around building footprints (contact shadow / alley gloom),
 * baked once: footprints rasterised into a grid and box-blurred three times
 * (≈ a Gaussian of ~1.5 m). Independent of the sun, so it works at night and
 * on the 'low' tier with no shadow map.
 */
export function contactShadowTexture(city: City): DataTexture {
  const n = AO_SIZE;
  const scale = n / GROUND_SIZE;
  const half = GROUND_SIZE / 2;
  const a = new Float32Array(n * n).fill(1);
  for (const b of city.buildings) {
    const x0 = Math.max(0, Math.round((b.minX + half) * scale));
    const x1 = Math.min(n, Math.round((b.maxX + half) * scale));
    const z0 = Math.max(0, Math.round((b.minZ + half) * scale));
    const z1 = Math.min(n, Math.round((b.maxZ + half) * scale));
    for (let z = z0; z < z1; z++) a.fill(0, z * n + x0, z * n + x1);
  }
  const tmp = new Float32Array(n * n);
  for (let pass = 0; pass < 3; pass++) {
    boxBlur(a, tmp, n, 1, n); // rows
    boxBlur(tmp, a, n, n, 1); // columns
  }
  const data = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) data[i] = Math.round(a[i] * 255);
  const tex = new DataTexture(data, n, n, RedFormat, UnsignedByteType);
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Radius-1 box blur along one axis: `step` between neighbours, `lineStep` between lines. */
function boxBlur(src: Float32Array, dst: Float32Array, n: number, step: number, lineStep: number): void {
  for (let line = 0; line < n; line++) {
    const base = line * lineStep;
    for (let i = 0; i < n; i++) {
      const at = base + i * step;
      const l = i > 0 ? src[at - step] : src[at];
      const r = i < n - 1 ? src[at + step] : src[at];
      dst[at] = (l + src[at] + r) / 3;
    }
  }
}

const f = (v: number) => v.toFixed(3);
const HALF_ROAD = ROAD_WIDTH / 2;
/** Lot interior starts this far from a road centreline. */
const LOT_EDGE = HALF_ROAD + SIDEWALK;

/**
 * groundColour(world xz) → linear albedo, plus `glow` (emissive, e.g. lit
 * water). Coordinates: g = world + HALF (0 at the city's corner), p = position
 * inside the block (0..64), lp = p − 32 (from the block centre), q = |lp|,
 * r = offset from the nearest road centrelines (−32..32).
 */
const GROUND_GLSL = /* glsl */ `
const float G_HALF_ROAD = ${f(HALF_ROAD)};
const float G_LOT = ${f(BLOCK_SIZE / 2 - LOT_EDGE)};
const float G_KERB = ${f(BLOCK_SIZE / 2 - HALF_ROAD)};
const float G_CORNER = 2.6;
const float G_GROUND = ${f(GROUND_SIZE / 2)};

vec3 srgb(float r, float g, float b) { return pow(vec3(r, g, b), vec3(2.2)); }

/** Road surface: asphalt with grain, wear, patches, cracks and oil. a = along the road, b = across it. */
vec3 asphalt(vec2 w, float a, float b, float roadAxis, bool horizontal, float px, float segId) {
  float big = ubNoise(w * 0.09);
  float mid = ubNoise(w * 0.7 + 13.0);
  float fine = ubHash(floor(w * 9.0)) - 0.5;
  float fineFade = 1.0 - smoothstep(0.03, 0.09, px);
  vec3 c = srgb(0.30, 0.31, 0.33) * (0.9 + 0.16 * big + 0.08 * mid + 0.09 * fine * fineFade);
  if (roadAxis > 0.5) {
    // Repaved patch: one per segment at a hashed spot (some segments have none).
    float h = ubHash(vec2(segId, 3.0));
    float lane = sign(ubHash(vec2(segId, 5.0)) - 0.5) * 4.0;
    float pa = abs(a) - (14.0 + h * 12.0);
    vec2 pd = abs(vec2(pa, b - lane)) - vec2(1.8 + h * 2.0, 1.4);
    float edge = max(pd.x, pd.y);
    float has = step(h, 0.7);
    float repair = (1.0 - smoothstep(-px, px, edge)) * has;
    float seam = (1.0 - smoothstep(0.0, 0.03 + px, abs(edge))) * has;
    c = mix(c, c * (h > 0.35 ? 0.88 : 1.09), repair);
    c *= 1.0 - seam * 0.16;
    // Tyre wear: polished darker bands along the wheel paths.
    float wheel = ubLine(abs(abs(b) - 4.0) - 0.82, 0.32, 0.25);
    c *= 1.0 - 0.07 * wheel;
    // Oil drips where cars wait at the stop line.
    float incoming = horizontal ? step(a * b, 0.0) : step(0.0, a * b);
    float wait = smoothstep(24.0, 13.0, abs(a)) * ubLine(abs(b) - 4.0, 0.55, 0.4) * incoming;
    float drip = smoothstep(0.66, 0.9, ubNoise(vec2(a * 0.9, b * 2.2) + 7.0)) * wait;
    c *= 1.0 - 0.3 * drip;
    // Manhole on one lane per segment.
    vec2 mh = vec2(abs(a) - (18.0 + ubHash(vec2(segId, 11.0)) * 10.0), b + (h > 0.5 ? 4.0 : -4.0));
    float md = length(mh);
    float cover = 1.0 - smoothstep(0.36 - px, 0.36 + px, md);
    float rim = ubLine(md - 0.36, 0.04, px);
    float grooves = ubLine(fract(md * 9.0) - 0.5, 0.18, 0.2) * fineFade;
    c = mix(c, srgb(0.22, 0.22, 0.23) * (1.0 - 0.25 * grooves), cover);
    c *= 1.0 - rim * 0.5;
  }
  // Cracks: thin lines along a noise contour, clustered by a slow noise.
  float crackMask = smoothstep(0.55, 0.8, ubNoise(w * 0.05 + 3.0));
  float n = ubNoise(w * 0.42 + 31.0) - 0.5;
  float crack = 1.0 - smoothstep(0.0, 0.012 + px * 0.5, abs(n));
  c *= 1.0 - crack * crackMask * 0.45;
  return c;
}

/** Road paint (rgb, coverage) on a road segment. a along the road, b across it. */
vec4 roadPaint(vec2 w, float a, float b, bool horizontal, float px) {
  float aa = abs(a);
  float wear = 0.72 + 0.28 * ubNoise(w * 2.3 + 5.0);
  vec3 white = srgb(0.86, 0.85, 0.80);
  vec3 yellow = srgb(0.88, 0.66, 0.16);
  // Double yellow centre line, starting past the stop lines.
  float centre = (ubLine(b - 0.13, 0.065, px) + ubLine(b + 0.13, 0.065, px)) * step(12.4, aa);
  // Stop line across the incoming lane (traffic drives on the right).
  float incoming = horizontal ? step(a * b, 0.0) : step(0.0, a * b);
  float stop = ubBand(aa, 11.7, 12.1, px) * ubBand(abs(b), 0.35, 7.6, px) * incoming;
  // Zebra crossing just outside the junction.
  float zebra = ubBand(aa, 8.8, 11.3, px) * ubBand(abs(b), 0.0, 7.6, px) * ubLine(fract((b + 7.6) / 1.2) - 0.27, 0.27, px / 1.2);
  float whiteCover = max(stop, zebra) * wear;
  float yellowCover = centre * wear;
  return vec4(whiteCover >= yellowCover ? white : yellow, max(whiteCover, yellowCover));
}

/** Sidewalk paving by district style; d = signed distance to the kerb (negative on the sidewalk). */
vec3 paving(vec2 w, vec2 p, float style, float d, float px) {
  float jointFade = 1.0 - smoothstep(0.025, 0.08, px);
  vec3 c;
  if (style < 0.5) {
    // Granite slabs.
    vec2 cell = floor(p / vec2(1.8, 0.9));
    vec2 fr = fract(p / vec2(1.8, 0.9));
    float slab = ubLine(fr.x - 0.5, 0.49, px / 1.8) * ubLine(fr.y - 0.5, 0.48, px / 0.9);
    c = srgb(0.62, 0.61, 0.58) * (0.93 + 0.1 * ubHash(cell));
    c *= 1.0 - (1.0 - slab) * 0.32 * jointFade;
  } else if (style < 1.5) {
    // Brick pavers in running bond.
    vec2 bp = p / vec2(0.42, 0.21);
    bp.x += 0.5 * mod(floor(bp.y), 2.0);
    vec2 fr = fract(bp);
    float brick = ubLine(fr.x - 0.5, 0.45, px / 0.42) * ubLine(fr.y - 0.5, 0.42, px / 0.21);
    c = srgb(0.55, 0.32, 0.25) * (0.86 + 0.24 * ubHash(floor(bp)));
    c = mix(srgb(0.5, 0.37, 0.31), c, brick * jointFade + (1.0 - jointFade) * 0.85);
  } else if (style < 2.5) {
    // Square tiles in two tones with the odd coloured accent.
    vec2 cell = floor(p);
    vec2 fr = fract(p);
    float tile = ubLine(fr.x - 0.5, 0.47, px) * ubLine(fr.y - 0.5, 0.47, px);
    float h = ubHash(cell + 7.0);
    c = mod(cell.x + cell.y, 2.0) < 0.5 ? srgb(0.68, 0.66, 0.62) : srgb(0.56, 0.54, 0.52);
    if (h > 0.9) c = h > 0.97 ? srgb(0.78, 0.25, 0.36) : (h > 0.935 ? srgb(0.16, 0.56, 0.58) : srgb(0.86, 0.66, 0.2));
    c *= 1.0 - (1.0 - tile) * 0.3 * jointFade;
  } else if (style < 3.5) {
    // Poured concrete with expansion joints.
    vec2 fr = fract(p / 3.0);
    float slab = ubLine(fr.x - 0.5, 0.495, px / 3.0) * ubLine(fr.y - 0.5, 0.495, px / 3.0);
    c = srgb(0.55, 0.54, 0.51) * (0.92 + 0.12 * ubNoise(w * 0.6));
    c *= 1.0 - (1.0 - slab) * 0.35 * jointFade;
  } else {
    // Suburban: a grass verge by the kerb, a concrete path behind it.
    vec2 fr = fract(p / 1.5);
    float slab = ubLine(fr.x - 0.5, 0.49, px / 1.5) * ubLine(fr.y - 0.5, 0.49, px / 1.5);
    c = srgb(0.62, 0.61, 0.57) * (0.95 + 0.06 * ubHash(floor(p / 1.5)));
    c *= 1.0 - (1.0 - slab) * 0.25 * jointFade;
    float verge = ubBand(-d, 0.32, 1.3, px);
    vec3 grass = srgb(0.28, 0.42, 0.17) * (0.8 + 0.35 * ubNoise(w * 1.7));
    c = mix(c, grass, verge);
  }
  // Grime and wear.
  return c * (0.92 + 0.12 * ubNoise(w * 0.35 + 9.0));
}

/** Block interior by lot kind; lp = position from the block centre. */
vec3 lot(vec2 w, vec2 lp, float kind, float seed, float px, inout vec3 glow) {
  vec2 q = abs(lp);
  if (kind < 0.5) {
    // Between buildings: grubby concrete yard with joints.
    vec2 fr = fract(w / 4.0);
    float slab = ubLine(fr.x - 0.5, 0.496, px / 4.0) * ubLine(fr.y - 0.5, 0.496, px / 4.0);
    vec3 c = srgb(0.46, 0.45, 0.43) * (0.85 + 0.2 * ubFbm(w * 0.3));
    return c * (1.0 - (1.0 - slab) * 0.3);
  }
  if (kind < 1.5) {
    // Park: two-tone mown grass, gravel paths (a ring and the diagonals), a flower bed.
    float stripe = step(0.5, fract(lp.x / 5.0));
    vec3 c = srgb(0.30, 0.46, 0.18) * (0.82 + 0.3 * ubFbm(w * 0.25)) * (0.95 + 0.07 * stripe);
    float ring = ubBand(max(q.x, q.y), G_LOT - 3.4, G_LOT - 1.8, px);
    float diag = ubLine(abs(lp.x) - abs(lp.y), 1.1, px) * step(max(q.x, q.y), G_LOT - 2.0);
    float path = max(ring, diag) * step(5.6, length(lp));
    vec3 gravel = srgb(0.66, 0.6, 0.48) * (0.9 + 0.15 * ubNoise(w * 3.0));
    c = mix(c, gravel, path);
    float bed = length(lp);
    vec3 bloom = mix(srgb(0.85, 0.2, 0.3), srgb(0.95, 0.75, 0.2), step(0.5, ubHash(floor(w * 2.0))));
    bloom = mix(srgb(0.25, 0.36, 0.14), bloom, step(0.55, ubHash(floor(w * 2.6) + 3.0)));
    c = mix(c, bloom, ubBand(bed, 2.2, 5.0, px));
    return mix(c, gravel, ubBand(bed, 5.0, 5.6, px));
  }
  if (kind < 2.5) {
    // Plaza: big two-tone paving, a darker border, a fountain in the middle.
    vec2 cell = floor(lp / 2.0);
    vec2 fr = fract(lp / 2.0);
    float slab = ubLine(fr.x - 0.5, 0.485, px / 2.0) * ubLine(fr.y - 0.5, 0.485, px / 2.0);
    vec3 c = mod(cell.x + cell.y, 2.0) < 0.5 ? srgb(0.72, 0.68, 0.6) : srgb(0.6, 0.56, 0.5);
    c *= (0.95 + 0.08 * ubHash(cell)) * (1.0 - (1.0 - slab) * 0.25);
    c = mix(c, srgb(0.42, 0.4, 0.38), ubBand(max(q.x, q.y), G_LOT - 1.2, G_LOT + 1.0, px));
    float rr = length(lp);
    float spokes = 0.6 + 0.4 * step(0.5, fract(atan(lp.y, lp.x) * 3.8197));
    c = mix(c, srgb(0.5, 0.5, 0.52), ubBand(rr, 6.0, 8.0, px) * spokes);
    float water = 1.0 - smoothstep(4.4 - px, 4.4 + px, rr);
    float ripple = 0.5 + 0.5 * sin(rr * 5.0 - uTime * 2.2);
    c = mix(c, srgb(0.78, 0.76, 0.72), ubBand(rr, 4.4, 5.0, px));
    c = mix(c, srgb(0.12, 0.3, 0.38) * (0.85 + 0.25 * ripple), water);
    glow += water * (uSkyTint * 0.05 * (1.0 - uNight) + vec3(0.1, 0.35, 0.45) * 0.25 * uNight) * (0.7 + 0.3 * ripple);
    return c;
  }
  // Car park: asphalt with white bays in double rows either side of aisles.
  vec3 c = srgb(0.32, 0.33, 0.35) * (0.9 + 0.15 * ubFbm(w * 0.2));
  float span = G_LOT - 1.5;
  float inside = step(max(q.x, q.y), span);
  float rowCoord = mod(lp.y + span, 16.0); // [bays 5][aisle 6][bays 5]
  float inBays = ubBand(rowCoord, 0.0, 5.0, px) + ubBand(rowCoord, 11.0, 16.0, px);
  float sep = ubLine(fract((lp.x + span) / 2.6) - 0.5, 0.48, px / 2.6);
  float ends = ubLine(rowCoord - 5.0, 0.06, px) + ubLine(rowCoord - 11.0, 0.06, px);
  float paint = clamp((1.0 - sep) * inBays + ends, 0.0, 1.0) * inside * (0.75 + 0.25 * ubNoise(w * 3.0));
  // Cars park nose-in: the engine (and its drip) sits 1.3 m in from the aisle end of the bay.
  float bayU = (fract((lp.x + span) / 2.6) - 0.5) * 2.6;
  float bayV = rowCoord < 8.0 ? rowCoord - 3.7 : rowCoord - 12.3;
  vec2 bay = vec2(floor((lp.x + span) / 2.6), floor((lp.y + span) / 8.0));
  float stain = 1.0 - smoothstep(0.3, 1.0, length(vec2(bayU / 0.55, bayV / 0.8)) + 0.2 * ubNoise(w * 3.0));
  stain *= step(ubHash(bay + seed * 61.0), 0.55) * inBays * inside;
  c *= 1.0 - 0.2 * stain;
  return mix(c, srgb(0.86, 0.85, 0.8), paint);
}

/** Outside the walls: a grass verge, a rocky shore, then the sea. */
vec3 shore(vec2 w, float ring, float px, inout vec3 glow) {
  float beyond = ring - (UB_HALF + G_HALF_ROAD);
  vec3 grass = srgb(0.3, 0.4, 0.2) * (0.8 + 0.3 * ubFbm(w * 0.2));
  vec3 rock = srgb(0.45, 0.43, 0.4) * (0.7 + 0.5 * ubNoise(w * 1.5));
  float edge = 16.0 + 3.0 * ubNoise(w * 0.08);
  vec3 c = mix(grass, rock, smoothstep(edge - 4.0, edge - 2.0, beyond));
  float sea = smoothstep(edge - px, edge + px, beyond);
  float waves = ubNoise(w * 0.35 + vec2(uTime * 0.25, uTime * 0.1)) * 0.6 + ubNoise(w * 1.1 - uTime * 0.4) * 0.4;
  vec3 water = mix(srgb(0.05, 0.16, 0.22), srgb(0.1, 0.3, 0.36), waves);
  float foam = (1.0 - smoothstep(0.0, 1.4, beyond - edge)) * smoothstep(0.45, 0.7, waves);
  water = mix(water, srgb(0.8, 0.85, 0.85), foam * 0.7);
  glow += sea * uSkyTint * (0.03 + 0.05 * waves) * (1.0 - uNight * 0.8);
  return mix(c, water, sea);
}

vec3 groundColour(vec2 w, inout vec3 glow) {
  // Derivatives first, outside any branch.
  vec2 dw = fwidth(w);
  float px = max(dw.x, dw.y);
  vec2 g = w + UB_HALF;
  vec2 cell = floor(g / UB_BLOCK);
  vec2 p = g - cell * UB_BLOCK;
  vec2 lp = p - UB_BLOCK * 0.5;
  vec2 q = abs(lp);
  vec2 r = g - UB_BLOCK * floor(g / UB_BLOCK + 0.5);
  float ring = max(abs(w.x), abs(w.y));
  bool inCity = cell.x >= 0.0 && cell.y >= 0.0 && cell.x < UB_BLOCKS && cell.y < UB_BLOCKS;
  float ao = texture(uAo, (w + G_GROUND) / (2.0 * G_GROUND)).r;

  if (ring > UB_HALF + G_HALF_ROAD) return shore(w, ring, px, glow) * mix(0.6, 1.0, ao);

  // Signed distance to the kerb line (rounded at the corners): > 0 on the road.
  vec2 k = q - vec2(G_KERB - G_CORNER);
  float kerb = inCity ? length(max(k, 0.0)) + min(max(k.x, k.y), 0.0) - G_CORNER : 1.0;
  vec4 blk = inCity ? texelFetch(uBlocks, ivec2(cell), 0) * 255.0 : vec4(0.0);
  vec3 c;

  if (kerb > 0.0) {
    bool hz = abs(r.y) < G_HALF_ROAD && abs(r.x) >= G_HALF_ROAD;
    bool vt = abs(r.x) < G_HALF_ROAD && abs(r.y) >= G_HALF_ROAD;
    float a = hz ? r.x : r.y;
    float b = hz ? r.y : r.x;
    float roadAxis = (hz || vt) ? 1.0 : 0.0;
    float segId = hz
      ? floor(g.x / UB_BLOCK) * 31.0 + floor(g.y / UB_BLOCK + 0.5)
      : floor(g.y / UB_BLOCK) * 37.0 + floor(g.x / UB_BLOCK + 0.5) + 900.0;
    c = asphalt(w, a, b, roadAxis, hz, px, segId);
    if (roadAxis > 0.5) {
      vec4 paint = roadPaint(w, a, b, hz, px);
      c = mix(c, paint.rgb, paint.a);
    }
    // Gutter: a darker, grimier strip along the kerb.
    c *= 0.72 + 0.28 * smoothstep(0.0, 0.45, kerb);
  } else if (max(q.x, q.y) > G_LOT) {
    c = paving(w, p, blk.a, kerb, px);
    // Kerb lip: a lighter edge with a thin shadow line at the drop.
    c = mix(c, srgb(0.74, 0.73, 0.7), ubBand(kerb, -0.3, -0.02, px));
    c *= 1.0 - 0.45 * ubBand(kerb, -0.02, 0.0, px);
  } else {
    c = lot(w, lp, blk.r, blk.b / 255.0, px, glow);
  }

  c *= mix(0.5, 1.0, ao);
  // Wet: everything darker, puddles reflect the sky.
  if (uWetness > 0.0) {
    float puddle = smoothstep(0.62 - 0.12 * uWetness, 0.7 - 0.12 * uWetness, ubFbm(w * 0.12 + 20.0)) * uWetness;
    c *= 1.0 - 0.35 * uWetness - 0.3 * puddle;
    glow += puddle * uSkyTint * 0.08;
  }
  return c;
}
`;
