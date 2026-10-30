import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  SRGBColorSpace,
  Vector3,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { worldUniforms } from './shaderLib';
import { createSkyState, sampleSky, type SkyState } from './timeOfDay';

/**
 * The scene's lights, fog and exposure, driven by the time of day. One sun
 * (moon at night) DirectionalLight, one hemisphere fill and a faint ambient —
 * created once and never added or removed, so lit materials never recompile;
 * everything else that glows is faked (see shaderLib, GlowSprites).
 */
export class SceneLighting {
  readonly sun = new DirectionalLight('#ffffff', 2);
  readonly hemi = new HemisphereLight('#bcd2ff', '#6b5a48', 0.9);
  private readonly ambient = new AmbientLight('#8090b0', 0.12);
  readonly fog = new Fog('#9fb4cc', 120, 340);
  readonly sky: SkyState = createSkyState();
  /** Unit vector toward the light, for the shadow fit. */
  readonly toLight = new Vector3(0, 1, 0);
  private readonly background = new Color();

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
  ) {
    scene.add(this.sun, this.sun.target, this.hemi, this.ambient);
    scene.fog = this.fog;
    scene.background = this.background;
  }

  /** Apply the sky at `hour`. */
  apply(hour: number): SkyState {
    const s = sampleSky(hour, this.sky);
    this.toLight.set(s.lightDir[0], s.lightDir[1], s.lightDir[2]);
    this.sun.color.setRGB(s.lightColor[0], s.lightColor[1], s.lightColor[2], SRGBColorSpace);
    this.sun.intensity = s.lightIntensity;
    this.hemi.color.setRGB(s.skyColor[0], s.skyColor[1], s.skyColor[2], SRGBColorSpace);
    this.hemi.groundColor.setRGB(s.groundColor[0], s.groundColor[1], s.groundColor[2], SRGBColorSpace);
    this.hemi.intensity = s.hemiIntensity;
    this.fog.color.setRGB(s.fogColor[0], s.fogColor[1], s.fogColor[2], SRGBColorSpace);
    this.fog.near = s.fogNear;
    this.fog.far = s.fogFar;
    this.background.copy(this.fog.color);
    this.renderer.toneMappingExposure = s.exposure;
    worldUniforms.uNight.value = s.night;
    worldUniforms.uSkyTint.value.setRGB(s.skyColor[0], s.skyColor[1], s.skyColor[2], SRGBColorSpace);
    return s;
  }
}
