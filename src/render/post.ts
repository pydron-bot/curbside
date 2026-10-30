import {
  ACESFilmicToneMapping,
  HalfFloatType,
  PCFShadowMap,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
} from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { getDevice, getQuality, onQualityChange } from './quality';
import './look.css';

/** Renderers created with a half-float output buffer (tone mapping + effects after the scene pass). */
const hdrRenderers = new WeakSet<WebGLRenderer>();

/**
 * The game's renderer. Tone mapping is ACES Filmic: it keeps car paint and
 * neon saturated where Neutral/AgX washed them out, and rolls highlights
 * (fire, headlights, lit windows) off smoothly instead of clipping.
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
  renderer.toneMapping = ACESFilmicToneMapping;
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
