import {
  AdditiveBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

/**
 * Shapes a glow quad can take, drawn analytically in the shader (crisp at
 * any size, no texture).
 */
/** Where a headlight cone's two lamps sit, as a fraction of its half-width (vehicleBatch sizes the cone to put them on the model's). */
export const BEAM_LAMP = 0.16;

export const GLOW = {
  /** Soft round blob: lamp halos, light flares, siren wash. */
  disc: 0,
  /** Headlight beam: two lamps at the near edge (v = 0) spreading forward to v = 1. */
  cone: 1,
  /** Thin soft ring. */
  ring: 2,
  /** Arrowhead pointing to +v. */
  chevron: 3,
  /** Soft rounded bar: tail-light strips. */
  bar: 4,
  /** Vertical light shaft: bright at the bottom (v = 0), fading up. */
  beam: 5,
  /** One soft cone from a point at v = 0 widening to the far end: a searchlight's beam. */
  search: 6,
} as const;
export type GlowShape = (typeof GLOW)[keyof typeof GLOW];

/**
 * Faked light as additive quads: headlight beams, tail and brake lights,
 * siren wash, the player marker, pickup rings. All of them in one instanced
 * mesh — one draw call — refilled each frame: begin(), add…(), end().
 * Adding light this way costs no real lights, so the lit materials never
 * recompile and the per-pixel lighting cost stays flat.
 */
export class GlowSprites {
  readonly mesh: InstancedMesh;
  private readonly colour: InstancedBufferAttribute;
  private readonly shape: InstancedBufferAttribute;
  private readonly m = new Matrix4();
  private count = 0;
  /** Quad area added this frame, m² (the fill estimate). */
  private areaNow = 0;

  /** The camera's position this frame (Look.render sets it before the sources run): for reflections. */
  readonly eye = { x: 0, y: 30, z: 0 };

  constructor(private readonly capacity = 640) {
    const geo = new PlaneGeometry(1, 1);
    this.colour = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.shape = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
    geo.setAttribute('aGlowColor', this.colour);
    geo.setAttribute('aShape', this.shape);
    this.mesh = new InstancedMesh(geo, material(), capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'glows';
  }

  begin(): void {
    this.count = 0;
    this.areaNow = 0;
  }

  /** Glows in the current (or, between frames, the last) frame. */
  get drawn(): number {
    return this.count;
  }

  /** Their quad area, m². */
  get area(): number {
    return this.areaNow;
  }

  /**
   * A quad lying flat at height y, centred at (x, z), `length` along the
   * heading (nose along (sin h, cos h); the shape's +v points that way) and
   * `width` across it. Colour is linear and may exceed 1 (it's added).
   */
  addFlat(
    x: number,
    y: number,
    z: number,
    heading: number,
    width: number,
    length: number,
    r: number,
    g: number,
    b: number,
    shape: GlowShape,
  ): void {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    // Plane's local +Y (v) → the heading direction on the ground, local +X → across
    // (to the left, keeping the face up), local +Z → world up.
    this.m.set(-c * width, s * length, 0, x, 0, 0, 1, y, s * width, c * length, 0, z, 0, 0, 0, 1);
    if (this.push(r, g, b, shape)) this.areaNow += Math.abs(width * length);
  }

  /** A quad standing upright at (x, y, z), facing `yaw`, `width` wide and `height` tall above y. */
  addUpright(x: number, y: number, z: number, yaw: number, width: number, height: number, r: number, g: number, b: number, shape: GlowShape): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.m.set(c * width, 0, s, x, 0, height, 0, y + height / 2, -s * width, 0, c, z, 0, 0, 0, 1);
    if (this.push(r, g, b, shape)) this.areaNow += Math.abs(width * height);
  }

  end(): void {
    const n = this.count;
    this.mesh.count = n;
    uploadRange(this.mesh.instanceMatrix, n);
    uploadRange(this.colour, n);
    uploadRange(this.shape, n);
  }

  private push(r: number, g: number, b: number, shape: GlowShape): boolean {
    if (this.count >= this.capacity) return false;
    const i = this.count++;
    this.mesh.setMatrixAt(i, this.m);
    this.colour.setXYZ(i, r, g, b);
    this.shape.setX(i, shape);
    return true;
  }
}

/** Below this a whole-buffer upload is cheaper than three's update ranges, which allocate per upload. */
export const WHOLE_UPLOAD_BYTES = 8192;

/** Upload the first `count` instances of an instanced attribute (small buffers go up whole). */
export function uploadRange(a: InstancedBufferAttribute, count: number): void {
  a.clearUpdateRanges();
  if ((a.array as Float32Array).byteLength > WHOLE_UPLOAD_BYTES) a.addUpdateRange(0, count * a.itemSize);
  a.needsUpdate = true;
}

function material(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aGlowColor;
      attribute float aShape;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vShape;
      void main() {
        vUv = uv;
        vColor = aGlowColor;
        vShape = aShape;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vShape;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float a;
        if (vShape < 0.5) {
          float d = length(p);
          a = max(1.0 - d, 0.0);
          a *= a;
        } else if (vShape < 1.5) {
          // Beam: v runs 0 (lamps) .. 1 (far end). One cone from each lamp (at
          // ±BEAM_LAMP of the half-width, which the caller sizes to the model),
          // spreading and merging ahead, plus a hot spot at each lamp.
          // Clamped: interpolation lands a hair past 1 along the far edge, and
          // pow() of the negative base is NaN on real GPUs — a black line across the road.
          float v = clamp(vUv.y, 0.0, 1.0);
          float ax = abs(p.x);
          float cx = ${BEAM_LAMP.toFixed(3)} + 0.12 * v;
          float w = 0.05 + 0.42 * v;
          float beam = 1.0 - smoothstep(0.35, 1.0, abs(ax - cx) / w);
          // The two cones overlap in the middle; don't let the overlap double up.
          beam = max(beam, 0.8 * (1.0 - smoothstep(0.0, cx + w * 0.6, ax)) * step(0.25, v));
          float hot = 1.0 - smoothstep(0.0, 0.1, abs(ax - ${BEAM_LAMP.toFixed(3)}) + v * 0.9);
          a = beam * pow(1.0 - v, 1.4) * smoothstep(0.0, 0.05, v) + hot * 0.7;
        } else if (vShape < 2.5) {
          float d = length(p);
          a = 1.0 - smoothstep(0.0, 0.12, abs(d - 0.82));
        } else if (vShape < 3.5) {
          // Chevron pointing to +v.
          vec2 q = vec2(abs(p.x), p.y);
          float d = abs(q.y + q.x * 0.9 - 0.35) ;
          a = (1.0 - smoothstep(0.08, 0.2, d)) * step(q.x, 0.75) * smoothstep(-0.8, -0.4, p.y);
        } else if (vShape < 4.5) {
          vec2 q = abs(p) - vec2(0.55, 0.0);
          float d = length(max(q, 0.0));
          a = max(1.0 - d / 0.45, 0.0);
          a *= a;
        } else if (vShape < 5.5) {
          a = (1.0 - vUv.y) * (1.0 - vUv.y) * (1.0 - smoothstep(0.2, 1.0, abs(p.x)));
        } else {
          // Searchlight: a cone from the lamp, soft-edged, fading with distance.
          float v = clamp(vUv.y, 0.0, 1.0);
          float x = abs(p.x) / (0.06 + 0.94 * v);
          a = (1.0 - smoothstep(0.3, 1.0, x)) * pow(1.0 - v, 1.2) * smoothstep(0.0, 0.03, v);
        }
        gl_FragColor = vec4(vColor * a, 1.0);
      }`,
    blending: AdditiveBlending,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  });
}
