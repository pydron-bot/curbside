import { describe, expect, it } from 'vitest';
import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BLOOM_INPUT_MAX, BLOOM_SANITIZE, sanitizeBloomInput } from '../src/render/post';

describe('sanitizeBloomInput', () => {
  it('cleans each texel right after the bright pass reads it', () => {
    const bloom = new UnrealBloomPass(new Vector2(64, 32), 0.55, 0.45, 0.9);
    sanitizeBloomInput(bloom);
    const src = bloom.materialHighPassFilter.fragmentShader;
    const read = src.indexOf('vec4 texel = texture2D( tDiffuse, vUv );');
    const clean = src.indexOf(BLOOM_SANITIZE);
    expect(read).toBeGreaterThanOrEqual(0);
    expect(clean).toBeGreaterThan(read);
    // Before the luminance test and the mix that pass it on.
    expect(src.indexOf('luminance( texel.xyz )')).toBeGreaterThan(clean);
  });

  it('catches NaN without isnan and caps the rest', () => {
    expect(BLOOM_SANITIZE).not.toMatch(/isnan|isinf/);
    for (const c of 'rgba') expect(BLOOM_SANITIZE).toContain(`if (!(texel.${c} >= 0.0)) texel.${c} = 0.0;`);
    expect(BLOOM_SANITIZE).toContain(`min(texel, vec4(${BLOOM_INPUT_MAX.toFixed(1)}))`);
  });

  it('refuses a bright pass it does not recognise', () => {
    const bloom = new UnrealBloomPass(new Vector2(64, 32), 0.55, 0.45, 0.9);
    bloom.materialHighPassFilter.fragmentShader = 'void main() { gl_FragColor = vec4(0.0); }';
    expect(() => sanitizeBloomInput(bloom)).toThrow(/sanitizeBloomInput/);
  });
});
