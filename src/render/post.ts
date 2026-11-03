import {
  ACESFilmicToneMapping,
  CustomToneMapping,
  HalfFloatType,
  ShaderChunk,
  PCFShadowMap,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type Camera,
  type Scene,
} from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { getDevice, getQuality, onQualityChange } from './quality';
import './look.css';

/**
 * The game's tone curve: ACES Filmic, then the Curbside grade, after the
 * title's neon: more saturation in mid-tones and highlights (ACES greys out
 * saturated paint and neon) but a little less in the darks (night reads
 * violet-blue, not as glowing red roofs), violet-indigo shadows, rose-warm
 * highlights and a touch of the logo's pink in the upper mids (fading out
 * before white, so daylight stays daylight). Installed as three's CustomToneMapping, so it
 * runs inside the materials on phones and in the output pass on desktops:
 * no extra full-screen pass anywhere. Must be patched before anything compiles.
 *
 * The grade's numbers are uniforms (the LOOK panel tunes them live), carried
 * in three's own `toneMappingExposure`, made a vec4[4] (GRADE_UNIFORM): the
 * renderer already sets that on every tone-mapped program, the output pass
 * included, so no material needs touching and nothing recompiles.
 * [0].x exposure; [1] dark saturation, bright saturation, pink mids, contrast;
 * [2].rgb shadow tint; [3].rgb highlight tint.
 */
const GRADE = /* glsl */ `vec3 CustomToneMapping( vec3 color ) {
	vec3 c = ACESFilmicToneMapping( color );
	vec4 g = toneMappingExposure[ 1 ];
	c = 0.18 * pow( c * ( 1.0 / 0.18 ), vec3( g.w ) );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = max( mix( vec3( l ), c, mix( g.x, g.y, smoothstep( 0.015, 0.12, l ) ) ), 0.0 );
	c *= mix( toneMappingExposure[ 2 ].rgb, toneMappingExposure[ 3 ].rgb, smoothstep( 0.03, 0.5, l ) );
	c += vec3( 0.02, -0.006, 0.014 ) * g.z * smoothstep( 0.08, 0.3, l ) * ( 1.0 - smoothstep( 0.55, 0.9, l ) );
	return saturate( c );
}`;
const CUSTOM_STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
const EXPOSURE_DECL = 'uniform float toneMappingExposure;';
const graded = ShaderChunk.tonemapping_pars_fragment.includes(CUSTOM_STUB) && ShaderChunk.tonemapping_pars_fragment.includes(EXPOSURE_DECL);
if (graded)
  ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment
    .replaceAll('toneMappingExposure', 'ubExposure')
    .replace('uniform float ubExposure;', 'uniform vec4 toneMappingExposure[ 4 ];\n#define ubExposure ( toneMappingExposure[ 0 ].x )')
    .replace(CUSTOM_STUB, GRADE);

/** The grade's shipped numbers (the LOOK panel's 100%). */
export const GRADE_BASE = {
  darkSat: 0.9,
  brightSat: 1.24,
  shadowTint: [0.97, 0.92, 1.12],
  highTint: [1.04, 0.99, 0.95],
} as const;

/** The grade's sliders (render/lookTuning.ts): 1 is the shipped grade. */
export interface GradeTuning {
  saturation: number;
  darkSaturation: number;
  violetShadows: number;
  roseHighlights: number;
  pinkMids: number;
  contrast: number;
}

/**
 * The tone mapping's uniform: exposure and the grade (see GRADE). Handed to
 * the renderer as its `toneMappingExposure`, so write exposure with
 * setExposure, never `renderer.toneMappingExposure = n`.
 */
export const GRADE_UNIFORM = new Float32Array(16);

/** Fill the grade's part of `out` from the sliders (pure; exposure untouched). */
export function writeGrade(t: GradeTuning, out: Float32Array = GRADE_UNIFORM): Float32Array {
  out[4] = GRADE_BASE.darkSat * t.darkSaturation * t.saturation;
  out[5] = GRADE_BASE.brightSat * t.saturation;
  out[6] = t.pinkMids;
  out[7] = t.contrast;
  for (let i = 0; i < 3; i++) {
    out[8 + i] = 1 + (GRADE_BASE.shadowTint[i] - 1) * t.violetShadows;
    out[12 + i] = 1 + (GRADE_BASE.highTint[i] - 1) * t.roseHighlights;
  }
  return out;
}
writeGrade({ saturation: 1, darkSaturation: 1, violetShadows: 1, roseHighlights: 1, pinkMids: 1, contrast: 1 });
GRADE_UNIFORM[0] = 1;

/** A renderer left on a plain float exposure (three's chunk changed, so no grade). */
let plainExposure: WebGLRenderer | null = null;

/** The tone mapping's exposure (the sky sets it every frame). */
export function setExposure(v: number): void {
  GRADE_UNIFORM[0] = v;
  if (plainExposure) plainExposure.toneMappingExposure = v;
}

export function getExposure(): number {
  return GRADE_UNIFORM[0];
}

/** Renderers created with a half-float output buffer (tone mapping + effects after the scene pass). */
const hdrRenderers = new WeakSet<WebGLRenderer>();

/**
 * The game's renderer. Tone mapping is ACES Filmic plus a light grade (see
 * GRADE): it keeps car paint and neon saturated where Neutral/AgX washed them
 * out, and rolls highlights (fire, headlights, lit windows) off smoothly
 * instead of clipping.
 *
 * Desktops render into a half-float buffer so the 'high' tier can bloom
 * (three r186's setEffects pipeline; tone mapping runs once at the end).
 * Phones render straight to the canvas with tone mapping inside each
 * material: no full-screen passes at all, glow comes from additive sprites.
 * The choice is made once at start-up, so materials never recompile for it.
 */
export function createRenderer(): WebGLRenderer {
  const hdr = !getDevice().handheld && canRenderHalfFloat();
  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    outputBufferType: hdr ? HalfFloatType : UnsignedByteType,
  });
  // Plain ACES if a future three.js changes the chunk the grade patches.
  renderer.toneMapping = graded ? CustomToneMapping : ACESFilmicToneMapping;
  // Exposure and the grade in one uniform (see GRADE): three uploads it as it is.
  if (graded) (renderer as unknown as { toneMappingExposure: Float32Array }).toneMappingExposure = GRADE_UNIFORM;
  else plainExposure = renderer;
  renderer.shadowMap.type = PCFShadowMap;
  if (hdr) hdrRenderers.add(renderer);
  return renderer;
}

/** Does `renderer` draw into the half-float pipeline (linear HDR, tone mapping in the output pass)? */
export function isHdr(renderer: WebGLRenderer): boolean {
  return hdrRenderers.has(renderer);
}

/**
 * Compile every material in `scene` for the pass it is really drawn in. With
 * the half-float pipeline the scene renders into a linear HDR target (tone
 * mapping comes later, in the output pass), so compiling against the canvas
 * would build sRGB/tone-mapped programs that are never used and leave the
 * real ones to compile mid-play (e.g. the night-only glows at the first dusk).
 */
export function precompile(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
  if (!hdrRenderers.has(renderer)) {
    renderer.compile(scene, camera);
    return;
  }
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.compile(scene, camera);
  renderer.setRenderTarget(previous);
  target.dispose();
}

/** Does this browser render to half-float targets? (Probed on a throwaway context.) */
function canRenderHalfFloat(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const ok = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Bloom on the 'high' tier (desktop only): bright emissive things — windows,
 * neon, headlights, explosions — bleed light. Switched by quality tier with
 * setEffects, which never touches the scene's materials.
 */
export class PostEffects {
  private readonly bloom: UnrealBloomPass | null;

  constructor(private readonly renderer: WebGLRenderer) {
    if (!hdrRenderers.has(renderer)) {
      this.bloom = null;
      return;
    }
    const size = renderer.getDrawingBufferSize(new Vector2());
    this.bloom = new UnrealBloomPass(size, 0.55, 0.45, 0.9);
    sanitizeBloomInput(this.bloom);
    onQualityChange(() => this.apply());
    this.apply();
  }

  /**
   * Follow the time of day. Bloom picks out light above a radiance
   * threshold; by day sunlit white paint and pale roofs reach ~2.5, so the
   * threshold sits above them and only real glows (fire, blinking beacons)
   * bleed. At night the threshold drops so windows, neon, lamps and
   * headlights glow.
   */
  setNight(night: number): void {
    if (!this.bloom) return;
    this.bloom.threshold = 3.2 + (0.8 - 3.2) * night;
    this.bloom.strength = 0.35 + 0.35 * night;
  }

  /** True when the half-float pipeline (and so bloom) is available. */
  get available(): boolean {
    return this.bloom !== null;
  }

  private apply(): void {
    if (!this.bloom) return;
    this.renderer.setEffects(getQuality().bloom ? [this.bloom] : []);
  }
}

/** Brightest radiance the bloom takes in: well above any glow's (~3–20), far below half float's 65504. */
export const BLOOM_INPUT_MAX = 64;

/**
 * Bloom's bright pass, made safe. One NaN or infinite pixel in the HDR buffer
 * (a half-float overflow where additive glows stack, or a bad shader value on
 * some GPUs) is a single dead pixel on its own, but the bloom blurs it through
 * five mip levels and adds it back, and NaN poisons every pixel it touches:
 * big blocky black slabs that stay while the source is on screen (seen on
 * desktop Chrome, 'high' only). The bright pass drops non-finite texels and
 * caps the rest before anything is blurred.
 */
export function sanitizeBloomInput(bloom: UnrealBloomPass): void {
  const material = bloom.materialHighPassFilter;
  const read = 'vec4 texel = texture2D( tDiffuse, vUv );';
  if (!material.fragmentShader.includes(read)) throw new Error('UnrealBloomPass high pass changed: update sanitizeBloomInput');
  material.fragmentShader = material.fragmentShader.replace(read, `${read}\n${BLOOM_SANITIZE}`);
  material.needsUpdate = true;
}

/**
 * GLSL: zero NaN (and negative) channels, then cap, which also turns +Inf
 * into the cap. A comparison with NaN is false, so `!(x >= 0.0)` catches it
 * without isnan, which some drivers optimise away.
 */
export const BLOOM_SANITIZE = /* glsl */ `
  if (!(texel.r >= 0.0)) texel.r = 0.0;
  if (!(texel.g >= 0.0)) texel.g = 0.0;
  if (!(texel.b >= 0.0)) texel.b = 0.0;
  if (!(texel.a >= 0.0)) texel.a = 0.0;
  texel = min(texel, vec4(${BLOOM_INPUT_MAX.toFixed(1)}));`;

/**
 * The title screen's look over the game, for Settings → Neon filter: pink
 * light at the bottom, cyan at the top and faint scanlines. A CSS layer like
 * the vignette (no GPU pass), hidden unless the setting is on.
 */
export function mountNeonFilter(parent: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'look-neon';
  el.hidden = true;
  parent.append(el);
  return el;
}

/** A soft dark vignette over the game view: a CSS layer, free on the GPU. */
export function mountVignette(parent: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'look-vignette';
  parent.append(el);
  return el;
}
