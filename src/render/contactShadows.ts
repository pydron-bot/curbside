import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

/**
 * Soft contact shadows under every car and person: one instanced quad mesh
 * (one draw call for all of them), each quad a rounded rectangle drawn
 * analytically in the shader and turned to its owner's heading. With the sun
 * shadow map on they are tight ambient-occlusion pools that seat things on
 * the ground; on the 'low' tier (no shadow map) they are the only shadows.
 *
 * Fill it each frame: begin(), add() per object, end().
 */
export class ContactShadows {
  readonly mesh: InstancedMesh;
  private readonly shape: InstancedBufferAttribute;
  private readonly m = new Matrix4();
  private count = 0;
  /** Multiplier on every shadow's darkness (raised when there's no sun shadow map). */
  strength = 1;

  constructor(private readonly capacity = 160) {
    const geo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shape = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    geo.setAttribute('aShape', this.shape);
    this.mesh = new InstancedMesh(geo, material(), capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'contactShadows';
  }

  begin(): void {
    this.count = 0;
  }

  /**
   * A shadow centred at (x, z), its length along `heading` (the game's
   * heading: nose along (sin h, cos h)). Half-sizes in metres; `soft` is the
   * width of the fuzzy edge.
   */
  add(x: number, z: number, heading: number, halfWidth: number, halfLength: number, soft: number, opacity: number): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const sx = 2 * (halfWidth + soft);
    const sz = 2 * (halfLength + soft);
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    // Rotation about Y by `heading`, scaled, at (x, 0.03, z).
    this.m.set(c * sx, 0, s * sz, x, 0, 1, 0, 0.03, -s * sx, 0, c * sz, z, 0, 0, 0, 1);
    this.mesh.setMatrixAt(i, this.m);
    this.shape.setXYZW(i, halfWidth, halfLength, soft, Math.min(1, opacity * this.strength));
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shape.clearUpdateRanges();
    this.shape.addUpdateRange(0, this.count * 4);
    this.shape.needsUpdate = true;
  }
}

function material(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec4 aShape;
      varying vec2 vP;
      varying vec4 vShape;
      void main() {
        vShape = aShape;
        // Metres from the centre of the quad.
        vP = (uv - 0.5) * 2.0 * (aShape.xy + aShape.z);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      varying vec4 vShape;
      void main() {
        vec2 h = vShape.xy;
        float r = min(h.x, h.y) * 0.7;
        vec2 q = abs(vP) - (h - r);
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        float a = 1.0 - smoothstep(-vShape.z * 0.7, vShape.z, d);
        gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * vShape.w);
      }`,
    transparent: true,
    depthWrite: false,
  });
}
