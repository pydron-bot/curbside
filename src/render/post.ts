import {
  ACESFilmicToneMapping,
  CustomToneMapping,
  HalfFloatType,
  ShaderChunk,
  PCFShadowMap,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
} from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { getDevice, getQuality, onQualityChange } from './quality';
import './look.css';

/**
 * The game's tone curve: ACES Filmic, then a light grade — a little more
 * saturation in mid-tones and highlights (ACES greys out saturated paint and
 * neon) but a little less in the darks (night reads blue-grey, not as
 * glowing red roofs), slightly cool shadows and warm highlights. Installed as three's CustomToneMapping, so it
 * runs inside the materials on phones and in the output pass on desktops:
 * no extra full-screen pass anywhere. Must be patched before anything compiles.
 */
const GRADE = /* glsl */ `vec3 CustomToneMapping( vec3 color ) {
	vec3 c = ACESFilmicToneMapping( color );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = max( mix( vec3( l ), c, mix( 0.88, 1.16, smoothstep( 0.015, 0.12, l ) ) ), 0.0 );
	c *= mix( vec3( 0.95, 0.99, 1.06 ), vec3( 1.03, 1.0, 0.95 ), smoothstep( 0.02, 0.45, l ) );
	return saturate( c );
}`;
const CUSTOM_STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
const graded = ShaderChunk.tonemapping_pars_fragment.includes(CUSTOM_STUB);
if (graded) ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(CUSTOM_STUB, GRADE);

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
  renderer.shadowMap.type = PCFShadowMap;
  if (hdr) hdrRenderers.add(renderer);
  return renderer;
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

/** A soft dark vignette over the game view: a CSS layer, free on the GPU. */
export function mountVignette(parent: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'look-vignette';
  parent.append(el);
  return el;
}
