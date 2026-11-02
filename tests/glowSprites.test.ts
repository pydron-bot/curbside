import { describe, expect, it } from 'vitest';
import type { ShaderMaterial } from 'three';
import { GlowSprites } from '../src/render/glowSprites';

describe('GlowSprites shader', () => {
  it('never takes pow() of a base that can go negative', () => {
    // vUv.y overshoots 1 by a rounding error along a quad's far edge; pow(1 - v)
    // of that is NaN on GPUs, a black line where a headlight beam ends.
    const src = (new GlowSprites(4).mesh.material as ShaderMaterial).fragmentShader;
    expect(src).toContain('float v = clamp(vUv.y, 0.0, 1.0);');
    for (const call of src.match(/pow\([^,()]+,/g) ?? []) expect(call).toBe('pow(1.0 - v,');
  });
});
