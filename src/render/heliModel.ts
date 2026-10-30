import { BufferAttribute, Group, Matrix4, Mesh, MeshLambertMaterial, Vector3, type BufferGeometry, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURF, tagged } from './propModels';
import { UB_COMMON, after, replace, useWorldUniforms } from './shaderLib';

/** Rotor speeds, rad/s: the main rotor's blur and the tail rotor's. */
const MAIN_SPIN = 26;
const TAIL_SPIN = 60;
/** Flying height: a share of the camera's height, over the roofs and well under the lens, m. */
const MIN_ALTITUDE = 9;
const MAX_ALTITUDE = 24;
const ALTITUDE_SHARE = 0.35;
/**
 * Drawn under life size: up near the lens, perspective blows it up (by
 * 1 / (1 - ALTITUDE_SHARE)), so on screen it reads about the size of a bus.
 */
const SCALE = 0.55;
/** Nose-down pitch per m/s of speed, and the most, rad. */
const PITCH_PER_SPEED = 0.012;
const MAX_PITCH = 0.28;
/** Bank per rad/s of turn, and the most, rad. */
const BANK_PER_TURN = 0.5;
const MAX_BANK = 0.35;

/** What the model follows each frame (the police helicopter's sim state). */
export interface HeliState {
  active: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
}

/**
 * The 5-star police helicopter as heli.glb's model, flying above the
 * streets: one mesh, one draw call (no shadow-map pass: its shadow on the
 * ground is already faked with the searchlight pool in render/heatLook.ts).
 * At load its parts are merged into one geometry; the two rotors' vertices
 * carry their hub and axis and spin in the vertex shader (main about Y,
 * tail about X), so nothing per frame but a transform and two uniforms.
 * The searchlight glows and the belly strobes flash red and blue (the
 * prop surfaces). It noses down with speed and banks into turns.
 *
 * It flies at a height under the camera (a share of it, clamped), placed on
 * the line from the camera down to its position on the ground: so on screen
 * it's always right over its shadow and searchlight (from a real altitude,
 * perspective would throw it off the edge of a low on-foot view).
 */
export class HeliModel {
  readonly root = new Group();
  private mesh: Mesh | null = null;
  private readonly uniforms = { uMainAngle: { value: 0 }, uTailAngle: { value: 0 } };
  private lastHeading = 0;
  private bank = 0;
  private pitch = 0;
  private altitude = MAX_ALTITUDE;
  /**
   * Frames left to draw it, specks-small under the street, after it loads:
   * the start-up shader warm-up skips hidden things, so this compiles its
   * program and uploads it now rather than at the first 5-star chase.
   */
  private warm = 0;

  constructor(url = '/assets/heli.glb') {
    this.root.name = 'heli';
    this.root.visible = false;
    this.root.rotation.order = 'YXZ';
    new GLTFLoader().loadAsync(url).then(
      (gltf) => this.build(gltf.scene.getObjectByName('heli') ?? gltf.scene.children[0]),
      (err) => console.error(`Failed to load ${url}`, err),
    );
  }

  /** Follow the helicopter for this frame, seen from a camera at (cx, cy, cz). */
  update(h: HeliState, dt: number, cx: number, cy: number, cz: number): void {
    const show = h.active && this.mesh !== null;
    this.root.visible = show;
    if (!show) {
      if (this.warm > 0 && this.mesh) {
        this.warm--;
        this.root.visible = true;
        this.root.position.set(cx, -20, cz);
        this.root.scale.setScalar(1e-4);
      }
      return;
    }
    this.uniforms.uMainAngle.value = (this.uniforms.uMainAngle.value + MAIN_SPIN * dt) % (Math.PI * 2);
    this.uniforms.uTailAngle.value = (this.uniforms.uTailAngle.value + TAIL_SPIN * dt) % (Math.PI * 2);
    const want = Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, cy * ALTITUDE_SHARE));
    this.altitude += (want - this.altitude) * Math.min(1, dt * 1.5);
    // On the camera's ray through (h.x, 0, h.z), at the altitude.
    const t = cy > this.altitude + 1 ? this.altitude / cy : 0;
    const speed = Math.hypot(h.vx, h.vz);
    let turn = h.heading - this.lastHeading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.lastHeading = h.heading;
    const yawRate = dt > 0 ? turn / dt : 0;
    const k = Math.min(1, dt * 3);
    this.pitch += (Math.min(MAX_PITCH, speed * PITCH_PER_SPEED) - this.pitch) * k;
    this.bank += (Math.max(-MAX_BANK, Math.min(MAX_BANK, -yawRate * BANK_PER_TURN)) - this.bank) * k;
    this.root.position.set(h.x + (cx - h.x) * t, this.altitude, h.z + (cz - h.z) * t);
    this.root.rotation.set(this.pitch, h.heading, this.bank);
    this.root.scale.setScalar(SCALE);
  }

  /** Merge the parts into one geometry; rotor vertices carry their hub and spin axis (1 main, 2 tail). */
  private build(heli: Object3D | undefined): void {
    if (!heli) return;
    heli.position.set(0, 0, 0);
    heli.updateMatrixWorld(true);
    const inverse = new Matrix4().copy(heli.matrixWorld).invert();
    const toRoot = new Matrix4();
    const hub = new Vector3();
    const parts: BufferGeometry[] = [];
    heli.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      toRoot.multiplyMatrices(inverse, o.matrixWorld);
      const geo = tagged(o, toRoot, 'heli');
      // A rotor blade's own node (or its parent) names the rotor.
      const rotor = rotorOf(o);
      const n = geo.getAttribute('position').count;
      const spin = new Float32Array(n * 4);
      if (rotor) {
        hub.setFromMatrixPosition(new Matrix4().multiplyMatrices(inverse, rotor.node.matrixWorld));
        for (let i = 0; i < n; i++) spin.set([hub.x, hub.y, hub.z, rotor.kind], i * 4);
      }
      geo.setAttribute('aSpin', new BufferAttribute(spin, 4));
      parts.push(geo);
    });
    const merged = parts.length ? mergeGeometries(parts) : null;
    if (!merged) return;
    const mesh = new Mesh(merged, this.material());
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false; // follows the player: always near the view
    mesh.name = 'heli-model';
    this.mesh = mesh;
    this.root.add(mesh);
    this.warm = 2;
  }

  private material(): MeshLambertMaterial {
    const mat = new MeshLambertMaterial();
    mat.onBeforeCompile = (shader) => {
      useWorldUniforms(shader);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = after(
        shader.vertexShader,
        '#include <common>',
        `attribute vec3 aColor;
        attribute float aSurf;
        attribute vec4 aSpin;
        uniform float uMainAngle;
        uniform float uTailAngle;
        varying vec3 vHeliColor;
        varying vec3 vHeliGlow;
        ${UB_COMMON}
        vec3 heliSpin(vec3 p, vec4 s) {
          if (s.w < 0.5) return p;
          vec3 d = p - s.xyz;
          if (s.w < 1.5) {
            float c = cos(uMainAngle), n = sin(uMainAngle);
            d = vec3(c * d.x + n * d.z, d.y, -n * d.x + c * d.z);
          } else {
            float c = cos(uTailAngle), n = sin(uTailAngle);
            d = vec3(d.x, c * d.y - n * d.z, n * d.y + c * d.z);
          }
          return s.xyz + d;
        }`,
      );
      shader.vertexShader = after(
        shader.vertexShader,
        '#include <beginnormal_vertex>',
        'objectNormal = heliSpin(objectNormal + aSpin.xyz, aSpin) - aSpin.xyz;',
      );
      shader.vertexShader = after(
        shader.vertexShader,
        '#include <begin_vertex>',
        `transformed = heliSpin(transformed, aSpin);
        int surf = int(aSurf + 0.5);
        vHeliColor = aColor;
        vHeliGlow = vec3(0.0);
        if (surf == ${SURF.searchlight}) vHeliGlow = aColor * (1.2 + 2.6 * uNight);
        else if (surf == ${SURF.strobeRed}) vHeliGlow = vec3(1.0, 0.08, 0.05) * step(0.82, fract(uTime * 1.3)) * 5.0;
        else if (surf == ${SURF.strobeBlue}) vHeliGlow = vec3(0.1, 0.32, 1.0) * step(0.82, fract(uTime * 1.3 + 0.5)) * 5.0;`,
      );
      shader.fragmentShader = after(shader.fragmentShader, '#include <common>', 'varying vec3 vHeliColor;\nvarying vec3 vHeliGlow;');
      shader.fragmentShader = replace(shader.fragmentShader, '#include <color_fragment>', 'diffuseColor.rgb = vHeliColor;');
      shader.fragmentShader = after(shader.fragmentShader, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += vHeliGlow;');
    };
    mat.customProgramCacheKey = () => 'curbside-heli';
    return mat;
  }
}

/** The rotor a mesh belongs to: itself or an ancestor named heli_rotor_main / heli_rotor_tail. */
function rotorOf(o: Object3D): { node: Object3D; kind: number } | null {
  for (let p: Object3D | null = o; p; p = p.parent) {
    if (p.name === 'heli_rotor_main') return { node: p, kind: 1 };
    if (p.name === 'heli_rotor_tail') return { node: p, kind: 2 };
  }
  return null;
}
