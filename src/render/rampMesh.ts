/**
 * Stunt ramps: every ramp in the city as one instanced wedge (one draw call,
 * one more in the shadow pass when in view). The slope is painted in the
 * shader with yellow-and-black chevrons pointing up it and a white lip, the
 * sides with hazard stripes, so a ramp reads from 60 m up at speed; a glow
 * chevron on the road in front points the way in (shared glow mesh).
 */
import {
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Rect } from '../world/city';
import { RAMP_HEIGHT, RAMP_LENGTH, RAMP_WIDTH, type Ramp } from '../world/ramps';
import { GLOW, type GlowSprites } from './glowSprites';
import type { Look } from './look';
import { after, useWorldUniforms } from './shaderLib';

/** A unit wedge: footprint 1×1 centred on the origin, rising from 0 at z = -0.5 to 1 at z = +0.5. */
function wedge(): BufferGeometry {
  // Per face: 0 slope, 1 sides, 2 back. uv: across (u) and up the face (v).
  const pos: number[] = [];
  const uv: number[] = [];
  const face: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], f: number) => {
    // a-b-c-d counter-clockwise seen from outside; uv (0,0) (1,0) (1,1) (0,1).
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    for (let i = 0; i < 6; i++) face.push(f);
  };
  const tri = (a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[], f: number) => {
    pos.push(...a, ...b, ...c);
    uv.push(...ua, ...ub, ...uc);
    for (let i = 0; i < 3; i++) face.push(f);
  };
  const h = 0.5;
  // Slope: low edge at z = -h, lip at z = +h, y = 1.
  quad([h, 0, -h], [-h, 0, -h], [-h, 1, h], [h, 1, h], 0);
  // Back (the drop), facing +z.
  quad([-h, 0, h], [h, 0, h], [h, 1, h], [-h, 1, h], 2);
  // Sides.
  tri([h, 0, -h], [h, 1, h], [h, 0, h], [0, 0], [1, 1], [1, 0], 1);
  tri([-h, 0, -h], [-h, 0, h], [-h, 1, h], [0, 0], [1, 0], [1, 1], 1);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aFace', new BufferAttribute(new Float32Array(face), 1));
  g.computeVertexNormals();
  return g;
}

export class RampMesh {
  readonly mesh: InstancedMesh;

  constructor(
    private readonly ramps: readonly Ramp[],
    look: Look,
  ) {
    const material = new MeshLambertMaterial({ color: '#ffffff' });
    material.onBeforeCompile = (shader) => {
      useWorldUniforms(shader);
      shader.vertexShader = after(shader.vertexShader, '#include <common>', 'attribute float aFace;\nvarying float vFace;\nvarying vec2 vRampUv;');
      shader.vertexShader = after(shader.vertexShader, '#include <uv_vertex>', 'vFace = aFace;\nvRampUv = uv;');
      shader.fragmentShader = after(shader.fragmentShader, '#include <common>', 'varying float vFace;\nvarying vec2 vRampUv;\nuniform float uNight;');
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <color_fragment>',
        `vec3 rampYellow = vec3(1.0, 0.72, 0.06);
        vec3 rampDark = vec3(0.07, 0.07, 0.08);
        float rampMark = 0.0;
        if (vFace < 0.5) {
          // Chevrons pointing up the slope, a white lip at the top.
          float c = fract(vRampUv.y * 3.0 - abs(vRampUv.x - 0.5) * 1.6);
          rampMark = step(0.5, c);
          float edge = step(0.9, vRampUv.y) + step(vRampUv.x, 0.06) + step(0.94, vRampUv.x);
          diffuseColor.rgb = mix(mix(rampDark, rampYellow, rampMark), vec3(0.95), clamp(edge, 0.0, 1.0));
        } else if (vFace < 1.5) {
          // Hazard stripes down the sides.
          rampMark = step(0.5, fract((vRampUv.x + vRampUv.y) * 4.0));
          diffuseColor.rgb = mix(rampDark, rampYellow, rampMark);
        } else {
          diffuseColor.rgb = vec3(0.16, 0.16, 0.18);
        }`,
      );
      // The yellow glows a little at night, so a ramp still reads in the dark.
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <emissivemap_fragment>',
        'totalEmissiveRadiance += diffuseColor.rgb * rampMark * (0.12 + 0.35 * uNight);',
      );
    };
    material.customProgramCacheKey = () => 'curbside-ramps';
    this.mesh = new InstancedMesh(wedge(), material, Math.max(1, ramps.length));
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const scale = new Vector3(RAMP_WIDTH, RAMP_HEIGHT, RAMP_LENGTH);
    ramps.forEach((r, i) => {
      q.setFromAxisAngle(up, r.heading);
      m.compose(new Vector3(r.x, 0, r.z), q, scale);
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.count = ramps.length;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'ramps';
    this.mesh.computeBoundingSphere();
    look.addGlowSource((glows, view) => this.drawGlows(glows, view));
  }

  /** Approach chevrons on the road in front of each ramp in view, pulsing toward it. */
  private drawGlows(glows: GlowSprites, view: Rect): void {
    const t = performance.now() / 1000;
    for (const r of this.ramps) {
      if (r.x < view.minX - 20 || r.x > view.maxX + 20 || r.z < view.minZ - 20 || r.z > view.maxZ + 20) continue;
      const fx = Math.sin(r.heading);
      const fz = Math.cos(r.heading);
      for (let k = 0; k < 3; k++) {
        const back = RAMP_LENGTH / 2 + 3 + k * 2.6;
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 5 - k * 1.1));
        glows.addFlat(r.x - fx * back, 0.06, r.z - fz * back, r.heading, 2.2, 1.6, 1.3 * a, 0.85 * a, 0.12 * a, GLOW.chevron);
      }
    }
  }
}
