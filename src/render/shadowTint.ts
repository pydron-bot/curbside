/**
 * Sun shadows coloured by the sky (V3 L5): where the sun is shadowed, a share
 * of its light comes back tinted the hemisphere's sky colour (pushed toward
 * violet-blue), the way a real shadow is lit by the blue sky above it,
 * instead of falling to near-black grey.
 *
 * Patched into three's `lights_fragment_begin` before anything compiles, so
 * every lit material (built-in or ours) gets it with no new program or
 * uniform: the tint rides in the sun shadow's own `shadowIntensity` uniform,
 * packed with the darkness (`packShadow`): the whole part is twice the tint
 * step (0..SHADOW_TINT_STEPS), the fraction the darkness 0..1. three's own
 * getShadow is then called at full intensity and the darkness applied here.
 * With the tint at 0 the result is exactly three's (mix(1, shadow, darkness)).
 */
import { ShaderChunk } from 'three';

/** Tint resolution: the packed tint is a whole number of these steps. */
export const SHADOW_TINT_STEPS = 100;
/** At tint 1 this share of the sun comes back into full shadow, sky-coloured. */
export const SHADOW_TINT_LIFT = 0.32;

/** The shadow intensity uniform for `darkness` (0..1) and `tint` (0..2). Pure. */
export function packShadow(darkness: number, tint: number): number {
  const d = Math.min(1, Math.max(0, darkness));
  const t = Math.round(Math.min(2, Math.max(0, tint)) * (SHADOW_TINT_STEPS / 2));
  return d + 2 * t;
}

/** Back to [darkness, tint] (what the shader does). Pure. */
export function unpackShadow(packed: number): [number, number] {
  const t = Math.floor(packed / 2);
  return [packed - 2 * t, (t * 2) / SHADOW_TINT_STEPS];
}

/** What shadowed sunlight is multiplied by, for a shadow factor `lit` (0 in full shadow): one channel, sky colour `sky` (luminance-normalised). Pure, mirrors the GLSL. */
export function shadowedLight(lit: number, darkness: number, tint: number, sky: number): number {
  return lit + (1 - lit) * (1 - darkness + tint * SHADOW_TINT_LIFT * sky);
}

const CALL = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';

const TINTED = `{
			float ubPacked = directionalLightShadow.shadowIntensity;
			float ubTintStep = floor( ubPacked * 0.5 );
			float ubDark = ubPacked - 2.0 * ubTintStep;
			float ubTint = ubTintStep * ${(2 / SHADOW_TINT_STEPS).toFixed(4)};
			float ubLit = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, 1.0, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
			vec3 ubSky = vec3( 0.72, 0.8, 1.3 );
			#if NUM_HEMI_LIGHTS > 0
			vec3 ubHemi = hemisphereLights[ 0 ].skyColor;
			ubSky = mix( ubSky, ubHemi / max( dot( ubHemi, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-3 ), 0.5 );
			#endif
			directLight.color *= mix( vec3( 1.0 - ubDark ) + ubTint * ${SHADOW_TINT_LIFT.toFixed(3)} * ubSky, vec3( 1.0 ), ubLit );
		}`;

/** Did the patch go in (three's chunk as expected)? Otherwise shadows stay three's own. */
export const shadowTintInstalled = ShaderChunk.lights_fragment_begin.includes(CALL);
if (shadowTintInstalled) ShaderChunk.lights_fragment_begin = ShaderChunk.lights_fragment_begin.replace(CALL, TINTED);
