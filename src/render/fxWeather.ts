import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector4,
  AddEquation,
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Color,
} from 'three';
import type { Rect } from '../world/city';

/**
 * Rain spells: a slow pure state machine (dry for a few minutes, then a
 * shower of a minute or two) that eases the rain in and out and lets the
 * roads get wet behind it and dry off slowly after. The game reads `rain`
 * (0..1, how hard it's falling) and `wetness` (0..1, for worldUniforms.uWetness).
 */
export class WeatherCycle {
  /** How hard it's raining right now, 0..1 (eased). */
  rain = 0;
  /** How wet the streets are, 0..1: lags the rain, dries slowly. */
  wetness = 0;
  private target = 0;
  private raining = false;
  private timer: number;

  constructor(
    private readonly rand: () => number = Math.random,
    readonly opts = {
      /** Seconds before the first shower (a new session starts dry). */
      firstDry: [110, 210] as const,
      dry: [170, 340] as const,
      wet: [55, 115] as const,
      /** Seconds to reach full rain / to stop. */
      rampIn: 7,
      rampOut: 12,
      /** Wetting time constant (s) and drying rate (per s). */
      wetTime: 9,
      dryRate: 1 / 70,
    },
  ) {
    this.timer = this.between(opts.firstDry);
  }

  /** True during a shower (including its ramp in). */
  get isRaining(): boolean {
    return this.raining;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) this.set(!this.raining);
    const o = this.opts;
    const d = this.target - this.rain;
    this.rain += d > 0 ? Math.min(d, dt / o.rampIn) : Math.max(d, -dt / o.rampOut);
    if (this.rain > 0.05) {
      const want = Math.min(1, this.rain * 1.25);
      if (want > this.wetness) this.wetness += (want - this.wetness) * (1 - Math.exp(-dt / o.wetTime));
    } else {
      this.wetness = Math.max(0, this.wetness - dt * o.dryRate);
    }
  }

  /** Start (or stop) a shower now; `seconds` overrides how long it lasts. */
  set(raining: boolean, seconds?: number): void {
    this.raining = raining;
    this.target = raining ? 0.55 + this.rand() * 0.45 : 0;
    this.timer = seconds ?? this.between(raining ? this.opts.wet : this.opts.dry);
  }

  private between([lo, hi]: readonly [number, number]): number {
    return lo + this.rand() * (hi - lo);
  }
}

/** Most drops (streaks and splashes) drawn at full rain. */
const DROPS = 900;
/** Share of the instances that are splash rings on the ground. */
const SPLASH_SHARE = 0.2;
const FALL_SPEED = 26;

/**
 * Rain as one instanced draw call, animated entirely in the vertex shader
 * (no per-frame CPU work beyond a few uniforms): streaks falling through a
 * box that follows the visible ground (world-anchored, so they don't swim as
 * the camera moves), drawn as thin screen-space lines from each drop's head
 * to where it was a moment ago (perspective makes them fan out from the
 * centre of the view, as rain does seen from above), plus little splash
 * rings popping on the ground. Hidden when dry.
 */
export class Rain {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly geo: InstancedBufferGeometry;
  private time = 0;

  constructor() {
    const plane = new PlaneGeometry(1, 1);
    const geo = (this.geo = new InstancedBufferGeometry());
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('uv', plane.getAttribute('uv'));
    const seeds = new Float32Array(DROPS * 4);
    for (let i = 0; i < DROPS; i++) {
      seeds[i * 4] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random();
      // Spread the visibility thresholds evenly so intensity scales the count smoothly.
      seeds[i * 4 + 3] = (i + 0.5) / DROPS;
    }
    geo.setAttribute('iSeed', new InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = DROPS;
    this.material = new ShaderMaterial({
      uniforms: {
        uRainTime: { value: 0 },
        uBox: { value: new Vector4(0, 0, 100, 100) },
        uTop: { value: 18 },
        uIntensity: { value: 0 },
        uWind: { value: new Vector2(3.5, 2) },
        uRes: { value: new Vector2(1280, 720) },
        uRainColor: { value: new Color(0.7, 0.76, 0.86) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 iSeed;
        uniform float uRainTime;
        uniform vec4 uBox;
        uniform float uTop;
        uniform float uIntensity;
        uniform vec2 uWind;
        uniform vec2 uRes;
        varying vec2 vUv;
        varying float vSplash;
        varying float vFade;
        float h(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          vUv = uv;
          vSplash = 0.0;
          vFade = 1.0;
          // Drops beyond the current intensity aren't drawn.
          if (iSeed.w > uIntensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          bool splash = fract(iSeed.w * 7.31) < ${SPLASH_SHARE.toFixed(2)};
          if (splash) {
            // A ring that pops somewhere new every cycle.
            float period = 0.32 + iSeed.z * 0.25;
            float t = uRainTime / period + iSeed.x * 17.0;
            float cycle = mod(floor(t), 997.0); // keeps the hash's argument small (mobile precision)
            float k = fract(t);
            float sx = h(cycle * 12.9898 + iSeed.y * 78.233);
            float sz = h(cycle * 39.3468 + iSeed.x * 11.135);
            vec3 c = vec3(uBox.x + sx * uBox.z, 0.06, uBox.y + sz * uBox.w);
            float r = 0.12 + k * 0.42;
            vec3 p = c + vec3(position.x * 2.0 * r, 0.0, -position.y * 2.0 * r);
            vSplash = 1.0;
            vFade = 1.0 - k;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
            return;
          }
          float fall = uTop / ${FALL_SPEED.toFixed(1)} * (0.85 + iSeed.z * 0.3);
          float phase = fract(uRainTime / fall + iSeed.z * 9.7);
          float air = phase * fall;
          // World-anchored column, wrapped into the box around the view.
          float wx = iSeed.x * uBox.z + uWind.x * air;
          float wz = iSeed.y * uBox.w + uWind.y * air;
          float x = uBox.x + mod(wx - uBox.x, uBox.z);
          float z = uBox.y + mod(wz - uBox.y, uBox.w);
          vec3 head = vec3(x, uTop * (1.0 - phase), z);
          vec3 tail = head - vec3(uWind.x, -${FALL_SPEED.toFixed(1)}, uWind.y) * 0.05;
          vec4 hc = projectionMatrix * viewMatrix * vec4(head, 1.0);
          vec4 tc = projectionMatrix * viewMatrix * vec4(tail, 1.0);
          vec2 hs = hc.xy / hc.w;
          vec2 ts = tc.xy / tc.w;
          vec2 d = (hs - ts) * uRes * 0.5;
          float len = length(d);
          vec2 dir = len > 1e-3 ? d / len : vec2(0.0, 1.0);
          // At least a few pixels long even straight under the camera.
          if (len < 7.0) ts = hs - dir * 7.0 / (uRes * 0.5);
          vec2 across = vec2(-dir.y, dir.x) * (1.1 / (uRes * 0.5)) * (1.0 + iSeed.x);
          float along = position.y + 0.5;
          vec2 p = mix(ts, hs, along) + across * position.x * 2.0;
          float z01 = mix(tc.z / tc.w, hc.z / hc.w, along);
          vFade = smoothstep(0.0, 0.08, phase) * (0.55 + 0.45 * iSeed.y);
          gl_Position = vec4(p, z01, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uRainColor;
        varying vec2 vUv;
        varying float vSplash;
        varying float vFade;
        void main() {
          float a;
          if (vSplash > 0.5) {
            float r = length(vUv * 2.0 - 1.0);
            a = exp(-pow((r - 0.75) * 9.0, 2.0)) * vFade * 0.55;
          } else {
            float across = abs(vUv.x * 2.0 - 1.0);
            a = (1.0 - across) * vUv.y * vFade * 0.5;
          }
          if (a < 0.004) discard;
          gl_FragColor = vec4(uRainColor * a, a * 0.7);
        }`,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.mesh.name = 'rain';
  }

  /**
   * Per frame: `intensity` 0..1 (times the tier's particle scale), the visible
   * ground, the camera height (drops start below it), drawing-buffer size and
   * how dark it is (rain catches the lamps at night).
   */
  update(dt: number, intensity: number, view: Rect, cameraHeight: number, width: number, height: number, night: number): void {
    const u = this.material.uniforms;
    this.time += dt;
    u.uRainTime.value = this.time;
    u.uIntensity.value = intensity;
    this.mesh.visible = intensity > 0.01;
    if (!this.mesh.visible) return;
    const margin = 6;
    (u.uBox.value as Vector4).set(view.minX - margin, view.minZ - margin, view.maxX - view.minX + margin * 2, view.maxZ - view.minZ + margin * 2);
    u.uTop.value = Math.max(6, Math.min(26, cameraHeight - 4));
    (u.uRes.value as Vector2).set(width, height);
    const k = 0.62 - 0.3 * night;
    (u.uRainColor.value as Color).setRGB(k, k * 1.06, k * 1.18);
    // Fewer instances when light: the shader drops the rest anyway.
    this.geo.instanceCount = Math.min(DROPS, Math.ceil(intensity * DROPS));
  }
}
