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
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, isCarPark, lotBytes, type City } from './city';
import { DISTRICTS, DISTRICT_STYLES, PAVINGS } from './districts';

/** Ground extends one block past the city on every side (ring road, walls, then the water). */
const GROUND_SIZE = 2 * HALF_EXTENT + 2 * BLOCK_SIZE;
/** Resolution of the baked contact-shadow texture (~1.1 m per texel over the whole ground: 1024 for the core city). */
const AO_SIZE = Math.round((GROUND_SIZE * 1024) / 1152);

/** What a block's lot is drawn as (block data texture, red channel). */
const LOT_KIND = { buildings: 0, park: 1, plaza: 2, parking: 3, lot: 4 } as const;

/**
 * The ground: one big plane whose surface is drawn entirely in the fragment
 * shader from world position — asphalt with grain, cracks, patches and oil,
 * crisp anti-aliased road markings (double centre lines, stop lines, zebra
 * crossings), kerbs with a lip and gutter, district paving, lot interiors
 * (grass parks with paths, plazas with a fountain, car parks with bays, a
 * map edit's waste ground), and
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
      diffuseColor.rgb = groundColour(vGroundXZ, groundGlow) * ubCloudShade(vGroundXZ);
      float groundMist = ubMist(vGroundXZ, 0.0, gMistWeight(vGroundXZ));
      diffuseColor.rgb = mix(diffuseColor.rgb, ubMistColour(), groundMist * 0.42);
      groundGlow += ubMistColour() * groundMist * 0.06;`,
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      `vec3 groundLamp = ubStreetLight(vec3(vGroundXZ.x, 0.0, vGroundXZ.y), vec3(0.0, 1.0, 0.0));
      // Damp road: a glossy share of the lamp light on top of the diffuse (gSheen, groundColour).
      vec3 groundSiren = ubSirenWash(vec3(vGroundXZ.x, 0.0, vGroundXZ.y), vec3(0.0, 1.0, 0.0)) + ubBlastFlash(vec3(vGroundXZ.x, 0.0, vGroundXZ.y), vec3(0.0, 1.0, 0.0));
      totalEmissiveRadiance += groundGlow + diffuseColor.rgb * groundLamp + gSheen * 0.3 * groundLamp + (diffuseColor.rgb + gSheen * 0.25) * groundSiren;
      // Wet-look streaks of the lamp heads (only where the road is damp; rain makes the whole road a mirror).
      if (gSheen > 0.0) totalEmissiveRadiance += uLampColor * (gLampGlints(vGroundXZ) * gSheen * (0.55 + 0.6 * uWetness));`,
    );
  };
  mat.customProgramCacheKey = () => 'curbside-ground';

  const ground = new Mesh(new PlaneGeometry(GROUND_SIZE, GROUND_SIZE), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  // Drawn after the other opaque meshes: its shader is the heaviest and covers
  // the screen, so early depth rejection skips it under roofs and cars.
  ground.renderOrder = 1;
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
  const bytes = lotBytes(city);
  city.blocks.forEach((b, k) => {
    const r = bytes[k];
    let kind: number = LOT_KIND[b.kind];
    if (isCarPark(city, bytes, k)) kind = LOT_KIND.parking;
    const i = (b.bz * n + b.bx) * 4;
    data[i] = kind;
    data[i + 1] = DISTRICTS.indexOf(b.district);
    data[i + 2] = r;
    data[i + 3] = PAVINGS.indexOf(DISTRICT_STYLES[b.style ?? b.district].paving);
  });
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
/** How glossy the road is here at night (damp patches that take the lamps' light): set by groundColour. */
float gSheen = 0.0;
/** The district of the block this fragment is in (DISTRICTS index; -1 outside the city): crossings by district. Set by groundColour. */
float gDistrict = -1.0;

/**
 * One lamp head's reflection in a damp road: the head mirrored under the
 * ground, seen from the camera, lands a little toward the camera's nadir from
 * the lamp; it's smeared along that line (toward the viewer) into a streak.
 */
float gGlint(vec2 wp, vec2 lamp) {
  float t = cameraPosition.y / (cameraPosition.y + UB_LAMP_H);
  vec2 at = cameraPosition.xz + (lamp - cameraPosition.xz) * t;
  vec2 toward = cameraPosition.xz - at;
  float len = length(toward);
  vec2 u = len > 0.01 ? toward / len : vec2(0.0, 1.0);
  vec2 d = wp - at;
  float along = dot(d, u);
  float across = d.x * u.y - d.y * u.x;
  // Longer toward the viewer than away, thin across.
  float a = along > 0.0 ? along / 3.6 : along / 1.3;
  return exp(-a * a - (across * across) / 0.16);
}

/**
 * The lamp heads' streaks on the damp road at wp: the lamps along the
 * nearest north-south and east-west roads, both sides, the three nearest
 * wp along each. Picked by where wp is along the road, not by its block cell:
 * cell edges run down the road centrelines, and switching lamps there cut
 * the streaks off in straight lines across every junction.
 */
float gLampGlints(vec2 wp) {
  vec2 g = wp + UB_HALF;
  vec2 line = floor(g / UB_BLOCK + 0.5);
  // Lamp n along a road stands at n × spacing (from the city's corner); every
  // fourth n is a junction, where there's none.
  vec2 near = floor(g / UB_LAMP_SPACING + 0.5);
  float per = UB_BLOCK / UB_LAMP_SPACING;
  float sum = 0.0;
  for (int s = 0; s < 2; s++) {
    float side = s == 0 ? -1.0 : 1.0;
    float col = line.x - (s == 0 ? 1.0 : 0.0);
    float row = line.y - (s == 0 ? 1.0 : 0.0);
    float lx = line.x * UB_BLOCK - UB_HALF + side * UB_LAMP_OFF;
    float lz = line.y * UB_BLOCK - UB_HALF + side * UB_LAMP_OFF;
    for (int k = -1; k <= 1; k++) {
      // Beside the north-south road: lamps along z.
      float nz = near.y + float(k);
      float bz = floor(nz / per);
      if (col >= 0.0 && col < UB_BLOCKS && bz >= 0.0 && bz < UB_BLOCKS && nz - bz * per > 0.5) {
        sum += gGlint(wp, vec2(lx, nz * UB_LAMP_SPACING - UB_HALF));
      }
      // Beside the east-west road: lamps along x.
      float nx = near.x + float(k);
      float bx = floor(nx / per);
      if (row >= 0.0 && row < UB_BLOCKS && bx >= 0.0 && bx < UB_BLOCKS && nx - bx * per > 0.5) {
        sum += gGlint(wp, vec2(nx * UB_LAMP_SPACING - UB_HALF, lz));
      }
    }
  }
  return sum;
}

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
    c = mix(c, srgb(0.27, 0.27, 0.28) * (1.0 - 0.2 * grooves), cover);
    c *= 1.0 - rim * 0.35;
  }
  // Cracks: hairlines along a noise contour, in a few clustered patches,
  // gone by the time a line would be thinner than a pixel (no scribble when zoomed out).
  float crackMask = smoothstep(0.7, 0.9, ubNoise(w * 0.05 + 3.0)) * (1.0 - smoothstep(0.025, 0.055, px));
  float n = ubNoise(w * 0.42 + 31.0) - 0.5;
  float crack = 1.0 - smoothstep(0.0, 0.008 + px * 0.5, abs(n));
  c *= 1.0 - crack * crackMask * 0.25;
  return c;
}

/** Road paint (rgb, coverage) on a road segment. a along the road, b across it. */
vec4 roadPaint(vec2 w, float a, float b, bool horizontal, float px, float segId) {
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
  float inBox = ubBand(aa, 8.8, 11.3, px) * ubBand(abs(b), 0.0, 7.6, px);
  // About one crossing in four is painted in its part of town's style, faded
  // (0.26.0: every crossing at full strength was too much); the rest stay white.
  bool styled = ubHash(vec2(segId, sign(a) * 3.0 + 17.0)) < 0.26;
  if (styled && gDistrict >= 0.0 && inBox > 0.0 && stop < 0.5 && yellowCover < 0.5) {
    float k = floor((b + 7.6) / 1.2);
    float fade = min(0.62 * wear * LK_ART, 1.0);
    vec3 col;
    float cover = zebra;
    if (abs(gDistrict - ${DISTRICTS.indexOf('arts')}.0) < 0.5) {
      // Arts quarter: rainbow stripes.
      float m = mod(k, 6.0);
      col = m < 0.5 ? srgb(0.95, 0.22, 0.45) : m < 1.5 ? srgb(1.0, 0.55, 0.15) : m < 2.5 ? srgb(1.0, 0.85, 0.2)
        : m < 3.5 ? srgb(0.3, 0.8, 0.4) : m < 4.5 ? srgb(0.2, 0.7, 0.95) : srgb(0.6, 0.35, 0.9);
    } else if (abs(gDistrict - ${DISTRICTS.indexOf('industrial')}.0) < 0.5) {
      // The docks: yellow and white bars.
      col = mod(k, 2.0) < 0.5 ? srgb(0.95, 0.75, 0.1) : white;
    } else if (abs(gDistrict - ${DISTRICTS.indexOf('oldtown')}.0) < 0.5) {
      // Old town: cream bars on a brick-red band.
      col = mix(srgb(0.6, 0.22, 0.16), srgb(0.9, 0.84, 0.7), zebra);
      cover = inBox;
    } else if (abs(gDistrict - ${DISTRICTS.indexOf('downtown')}.0) < 0.5) {
      // Downtown: white and cyan bars in turn.
      col = mod(k, 2.0) < 0.5 ? white : srgb(0.2, 0.85, 0.95);
    } else {
      // Residential: pastel blue and white bars.
      col = mod(k, 2.0) < 0.5 ? white : srgb(0.55, 0.75, 0.95);
    }
    // Weathered toward the white the rest of the city's crossings are.
    return vec4(mix(col, white, 0.3), cover * fade);
  }
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
    if (h > 0.965) c = h > 0.988 ? srgb(0.66, 0.3, 0.36) : (h > 0.976 ? srgb(0.24, 0.5, 0.52) : srgb(0.74, 0.6, 0.28));
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
    c = mix(c, gravel, ubBand(bed, 5.0, 5.6, px));
    if (fract(seed * 7.13) < 0.22) {
      // A basketball court across one half of the park: blue apron, terracotta court, white lines.
      vec2 cp = vec2(lp.x, lp.y - (fract(seed * 3.31) < 0.5 ? 15.0 : -15.0));
      vec2 cq = abs(cp);
      float apron = ubLine(cq.x, 13.0, px) * ubLine(cq.y, 8.0, px);
      float court = ubLine(cq.x, 11.4, px) * ubLine(cq.y, 6.6, px);
      vec3 surf = mix(srgb(0.24, 0.34, 0.5), srgb(0.62, 0.38, 0.28), court);
      float lw = 0.06;
      float lines = ubLine(abs(cq.x - 11.4), lw, px) * step(cq.y, 6.66) + ubLine(abs(cq.y - 6.6), lw, px) * step(cq.x, 11.46)
        + ubLine(cp.x, lw, px) * step(cq.y, 6.6) + ubLine(abs(length(cp) - 1.8), lw, px)
        + ubLine(abs(cq.y - 2.45), lw, px) * step(11.4 - 5.8, cq.x) * step(cq.x, 11.4)
        + ubLine(abs(cq.x - (11.4 - 5.8)), lw, px) * step(cq.y, 2.45)
        + ubLine(abs(length(vec2(cq.x - 10.2, cp.y)) - 6.75), lw, px) * step(cq.x, 10.2) * step(cq.y, 6.6);
      surf = mix(surf, srgb(0.86, 0.86, 0.82), min(1.0, lines) * court);
      c = mix(c, surf, apron * min(LK_ART, 1.0));
    }
    return c;
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
    // A faint rainbow in the spray by day (render/waterLook.ts), on the side
    // away from the sun, red outside; gone under a cloud or in the rain.
    float day = 1.0 - uNight;
    if (day > 0.05 && rr < 4.6) {
      float side = smoothstep(0.15, 0.8, dot(lp / max(rr, 0.001), -normalize(uSunDir.xz + vec2(0.0001))));
      float bt = (rr - 1.6) / 2.8;
      float band = smoothstep(0.0, 0.15, bt) * (1.0 - smoothstep(0.9, 1.0, bt));
      vec3 bow = clamp(abs(fract(max(0.78 * (1.0 - bt * 1.15), 0.0) + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
      float shimmer = 0.75 + 0.25 * sin(uTime * 1.7 + rr * 3.0);
      glow += bow * band * side * shimmer * day * (1.0 - uWetness) * 0.26 * LK_RAINBOW * smoothstep(0.8, 0.97, ubCloudShade(w));
    }
    return c;
  }
  if (kind > 3.5) {
    // Waste ground (an empty lot): packed dirt and gravel, scrubby weeds, a
    // rutted track in from the street, old slab edges and the odd puddle.
    float n1 = ubFbm(w * 0.18);
    float n2 = ubNoise(w * 1.3 + seed * 17.0);
    vec3 dirt = mix(srgb(0.36, 0.3, 0.23), srgb(0.47, 0.41, 0.33), n1);
    vec3 gravel = srgb(0.52, 0.5, 0.46) * (0.85 + 0.25 * ubHash(floor(w * 4.0)));
    vec3 c = mix(dirt, gravel, smoothstep(0.55, 0.75, ubFbm(w * 0.09 + 3.0)));
    float weeds = smoothstep(0.5, 0.72, ubFbm(w * 0.33 + seed * 5.0)) * (0.55 + 0.45 * n2);
    c = mix(c, srgb(0.27, 0.34, 0.15) * (0.8 + 0.3 * n2), weeds * 0.85);
    // A slab or two of the building that stood here.
    vec2 sp = lp - vec2(fract(seed * 5.7) - 0.5, fract(seed * 9.1) - 0.5) * 18.0;
    float slab = ubLine(abs(sp.x), 9.0, px) * ubLine(abs(sp.y), 6.0, px) * step(0.35, fract(seed * 2.3));
    c = mix(c, srgb(0.5, 0.49, 0.46) * (0.85 + 0.2 * ubNoise(w * 0.7)), slab * (0.75 - 0.4 * weeds));
    // Tyre ruts from the gap in the bollards (the south side's middle) to the middle.
    float track = (ubLine(abs(lp.x) - 1.1, 0.35, px) * step(0.0, lp.y)) * (0.6 + 0.4 * ubNoise(w * 0.9));
    c = mix(c, srgb(0.3, 0.26, 0.2), track * 0.6);
    float puddle = smoothstep(0.78, 0.82, ubNoise(w * 0.12 + seed * 3.0)) * (1.0 - weeds);
    c = mix(c, srgb(0.16, 0.17, 0.18), puddle * 0.7);
    glow += puddle * uSkyTint * 0.04 * (1.0 - uNight);
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

/**
 * How much morning mist this part of town gets (1 in the old town and the
 * residential streets, a fifth elsewhere), blended between the four nearest
 * blocks' middles so it fades across district lines instead of stopping at
 * a road's centreline.
 */
float gMistWeight(vec2 w) {
  if (uMist < 0.01) return 0.0;
  vec2 g = (w + UB_HALF) / UB_BLOCK - 0.5;
  vec2 c0 = floor(g);
  vec2 f = smoothstep(0.0, 1.0, g - c0);
  float m[4];
  for (int k = 0; k < 4; k++) {
    vec2 c = clamp(c0 + vec2(float(k & 1), float(k >> 1)), vec2(0.0), vec2(UB_BLOCKS - 1.0));
    float d = texelFetch(uBlocks, ivec2(c), 0).g * 255.0;
    m[k] = (abs(d - ${DISTRICTS.indexOf('oldtown')}.0) < 0.5 || abs(d - ${DISTRICTS.indexOf('residential')}.0) < 0.5) ? 1.0 : min(0.2 * LK_MIST_SPREAD, 1.0);
  }
  return mix(mix(m[0], m[1], f.x), mix(m[2], m[3], f.x), f.y);
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
  gDistrict = inCity ? blk.g : -1.0;
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
      vec4 paint = roadPaint(w, a, b, hz, px, segId);
      c = mix(c, paint.rgb, paint.a);
    }
    // Gutter: a darker, grimier strip along the kerb.
    c *= 0.72 + 0.28 * smoothstep(0.0, 0.45, kerb);
    // Night damp: a slightly darker road with glossy patches (most along the
    // gutters) that pick up the lamps, the neon-noir street even when dry.
    // The rain's own puddles take over as it gets wet.
    if (uNight > 0.01) {
      float damp = smoothstep(0.42, 0.78, ubFbm(w * 0.22 + 7.0));
      float gutterBias = 1.0 - 0.5 * smoothstep(0.8, 4.0, kerb);
      gSheen = uNight * (0.3 + 0.7 * damp) * gutterBias * LK_WET;
      c *= 1.0 - 0.2 * uNight;
    }
  } else if (max(q.x, q.y) > G_LOT) {
    c = paving(w, p, blk.a, kerb, px);
    // Kerb lip: a lighter edge with a thin shadow line at the drop.
    c = mix(c, srgb(0.74, 0.73, 0.7), ubBand(kerb, -0.3, -0.02, px));
    c *= 1.0 - 0.45 * ubBand(kerb, -0.02, 0.0, px);
  } else {
    c = lot(w, lp, blk.r, blk.b / 255.0, px, glow);
  }

  c *= mix(0.5, 1.0, ao);
  // Wet: everything darker; puddles (~3 m, mostly along the gutters, few on
  // pavements and lots) darker still with a faint sheen: the sky's by day, a
  // cool lamp-lit one at night (full sky tint read as pale-blue camo blotches).
  if (uWetness > 0.0) {
    float gutter = kerb > 0.0 ? mix(0.45, 1.0, 1.0 - smoothstep(0.6, 3.0, kerb)) : 0.2;
    float puddle = smoothstep(0.74 - 0.12 * uWetness, 0.82 - 0.12 * uWetness, ubFbm(w * 0.35 + 20.0)) * uWetness * gutter;
    c *= 1.0 - 0.35 * uWetness - 0.45 * puddle;
    glow += puddle * (uSkyTint * 0.02 * (1.0 - uNight) + vec3(0.1, 0.12, 0.16) * 0.06 * uNight);
    // Raindrops ringing out across the puddles: one ripple per 0.9 m cell, each on its own beat.
    if (uRain > 0.02 && puddle > 0.01) {
      vec2 cell = floor(w / 0.9);
      vec2 at = (cell + 0.25 + 0.5 * vec2(ubHash(cell), ubHash(cell + 7.0))) * 0.9;
      float t = fract(uTime * 0.9 + ubHash(cell + 3.0));
      float ring = 1.0 - smoothstep(0.0, 0.035, abs(length(w - at) - t * 0.42));
      float ripple = ring * (1.0 - t) * step(ubHash(cell + 11.0), uRain);
      glow += puddle * ripple * (uSkyTint * 0.06 * (1.0 - uNight) + (vec3(0.25, 0.3, 0.4) * 0.2 + uLampColor * 0.08) * uNight);
    }
  }
  return c;
}
`;
