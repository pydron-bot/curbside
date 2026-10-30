import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  Vector4,
  type AnimationClip,
  type IUniform,
  type MeshStandardMaterial,
  type Object3D,
  type Scene,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EventBus } from '../core/events';
import type { Pigeon, PigeonThreat } from '../systems/pigeons';
import { Pigeons } from '../systems/pigeons';
import type { City, Rect } from '../world/city';
import type { StaticGrid } from '../world/collision';
import type { Look } from './look';
import { UB_COMMON, UB_STREET_LIGHT, after, replace, useWorldUniforms } from './shaderLib';

/** Birds drawn at most (three flocks and the stragglers flying off). */
const CAPACITY = 64;
/** Drawn a touch bigger than life, so a flock reads from 25 m up. */
const SIZE = 1.3;
/** The Flap clip sampled at this many beat phases for the shader. */
const FLAP_SAMPLES = 8;
/** What startles them: a shot within, a blast within, a hard crash or a horn within, m. */
const SHOT_REACH = 30;
const BLAST_REACH = 60;
const CRASH_REACH = 16;
const HORN_REACH = 14;
/** Birds this far outside the visible ground are still drawn (one climbing into the frame), m. */
const CULL_MARGIN = 4;
/** Threats further than this from the action aren't worth checking, m. */
const THREAT_RANGE = 70;

interface Mover {
  readonly sim: { readonly x: number; readonly z: number; readonly vx: number; readonly vz: number };
}
interface Walker {
  readonly agent: { readonly s: { readonly x: number; readonly z: number; readonly vx: number; readonly vz: number } };
}
interface PlayerLike {
  readonly driving: unknown;
  readonly ped: { readonly x: number; readonly z: number; readonly vx: number; readonly vz: number };
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler(0, 0, 0, 'YXZ');
const p = new Vector3();
const s = new Vector3();

/**
 * Pigeons on screen: the flocks (systems/pigeons.ts) drawn as ONE instanced
 * mesh, no shadow pass (a soft contact shadow each instead, fading with
 * height). pigeon.glb is one rigid body plus two wing bones; its Flap clip
 * is sampled at load into a few wing rotations that the vertex shader
 * blends by each bird's beat phase and how far its wings are spread, so a
 * whole flock costs one draw call and no per-bird animation on the CPU.
 */
export class PigeonLook {
  readonly flocks: Pigeons;
  readonly mesh: InstancedMesh;
  private readonly flap: InstancedBufferAttribute;
  private readonly uniforms: Record<string, IUniform>;
  private readonly birds: Pigeon[] = [];
  private readonly threats: PigeonThreat[] = [];
  private readonly threatPool: PigeonThreat[] = [];
  private readonly view: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  private loaded = false;

  constructor(
    scene: Scene,
    look: Look,
    city: City,
    grid: StaticGrid,
    bus: EventBus,
    rand: () => number,
    url = '/assets/pigeon.glb',
  ) {
    const kinds = new Map(city.blocks.map((b) => [b.bx * 1000 + b.bz, b.kind]));
    this.flocks = new Pigeons(
      {
        kindAt: (bx, bz) => kinds.get(bx * 1000 + bz) ?? 'buildings',
        blocked: (x, z, r) => grid.near(x, z, r).some((o) => x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r),
      },
      rand,
    );
    this.uniforms = {
      uWingQ: { value: Array.from({ length: FLAP_SAMPLES * 2 }, () => new Vector4(0, 0, 0, 1)) },
      uRestQ: { value: [new Vector4(0, 0, 0, 1), new Vector4(0, 0, 0, 1)] },
      uHinge: { value: [new Vector3(), new Vector3()] },
    };
    const material = new MeshLambertMaterial({ vertexColors: true });
    material.onBeforeCompile = (shader) => this.patch(shader);
    material.customProgramCacheKey = () => 'curbside-pigeons';
    const geometry = new BufferGeometry();
    this.flap = new InstancedBufferAttribute(new Float32Array(CAPACITY * 2), 2);
    this.flap.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aFlap', this.flap);
    this.mesh = new InstancedMesh(geometry, material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'pigeons';
    scene.add(this.mesh);
    // Drawn with the frame's glows and contact shadows (no extra pass of its own).
    look.addGlowSource((_glows, view) => this.flush(look, view));

    bus.on('shot', (ev) => this.flocks.startle(ev.x, ev.z, SHOT_REACH));
    bus.on('explosion', (ev) => this.flocks.startle(ev.x, ev.z, BLAST_REACH));
    bus.on('crash', (ev) => ev.impact > 8 && this.flocks.startle(ev.x, ev.z, CRASH_REACH));
    bus.on('horn', (ev) => this.flocks.startle(ev.x, ev.z, HORN_REACH));
    bus.on('ignite', (ev) => this.flocks.startle(ev.x, ev.z, CRASH_REACH));

    if (url) {
      new GLTFLoader().loadAsync(url).then(
        (gltf) => this.useModel(gltf.scene, gltf.animations),
        (err) => console.error(`Failed to load ${url}`, err),
      );
    }
  }

  /**
   * Step the flocks around (x, z), the centre of the action, with what
   * might spook them: traffic, anyone running, the player walking up.
   */
  update(
    dt: number,
    x: number,
    z: number,
    rig: { visibleGround(out: Rect): Rect },
    vehicles: readonly Mover[],
    crowd: readonly Walker[],
    player: PlayerLike | null,
  ): void {
    if (!(dt > 0)) return;
    const threats = this.threats;
    threats.length = 0;
    const r2 = THREAT_RANGE * THREAT_RANGE;
    for (const v of vehicles) {
      const sp = Math.hypot(v.sim.vx, v.sim.vz);
      if (sp > 2 && (v.sim.x - x) ** 2 + (v.sim.z - z) ** 2 < r2) this.threat(v.sim.x, v.sim.z, sp, true, false);
    }
    for (const c of crowd) {
      const a = c.agent.s;
      const sp = Math.hypot(a.vx, a.vz);
      if (sp > 3 && (a.x - x) ** 2 + (a.z - z) ** 2 < r2) this.threat(a.x, a.z, sp, false, false);
    }
    if (player && !player.driving) this.threat(player.ped.x, player.ped.z, Math.hypot(player.ped.vx, player.ped.vz), false, true);
    this.flocks.step(dt, { view: rig.visibleGround(this.view), x, z, threats });
  }

  private threat(x: number, z: number, speed: number, car: boolean, player: boolean): void {
    const i = this.threats.length;
    const t = this.threatPool[i] ?? (this.threatPool[i] = { x: 0, z: 0, speed: 0, car: false, player: false });
    t.x = x;
    t.z = z;
    t.speed = speed;
    t.car = car;
    t.player = player;
    this.threats.push(t);
  }

  /**
   * Write every bird on screen into the instance buffers, with a contact
   * shadow each (flocks settle out of view: no draw call until one's in it).
   */
  private flush(look: Look, view: Rect): void {
    const birds = this.flocks.collect(this.birds);
    let n = 0;
    if (this.loaded) {
      const shadows = look.contactShadows;
      for (const b of birds) {
        if (n >= CAPACITY) break;
        if (b.scale <= 0.01) continue;
        if (b.x < view.minX - CULL_MARGIN || b.x > view.maxX + CULL_MARGIN || b.z < view.minZ - CULL_MARGIN || b.z > view.maxZ + CULL_MARGIN) continue;
        e.set(b.pitch, b.heading, 0);
        q.setFromEuler(e);
        p.set(b.x, b.y, b.z);
        s.setScalar(SIZE * b.scale);
        this.mesh.setMatrixAt(n, m4.compose(p, q, s));
        this.flap.array[n * 2] = b.flap;
        this.flap.array[n * 2 + 1] = b.spread;
        // The shadow softens and fades as it climbs away.
        const lift = Math.max(0, 1 - b.y / 9);
        if (lift > 0.05) shadows.add(b.x, b.z, b.heading, 0.12 + 0.25 * b.spread, 0.2, 0.3, 0.45 * lift * b.scale);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flap.clearUpdateRanges();
    this.flap.addUpdateRange(0, n * 2);
    this.flap.needsUpdate = true;
  }

  /** pigeon.glb arrived: body and wings into one geometry, the Flap clip into the shader's wing poses. */
  private useModel(scene: Object3D, clips: AnimationClip[]): void {
    scene.updateMatrixWorld(true);
    const wings = ['wingL', 'wingR'].map((n) => scene.getObjectByName(n) ?? null);
    const parts: BufferGeometry[] = [];
    const colour = new Color();
    const local = new Matrix4();
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const wing = wings.indexOf(o.parent);
      const geo = (o.geometry as BufferGeometry).clone();
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
      // Wing vertices relative to their bone (the shader turns them about it); the body in model space.
      geo.applyMatrix4(wing >= 0 ? local.copy(wings[wing]!.matrixWorld).invert().multiply(o.matrixWorld) : o.matrixWorld);
      const count = geo.getAttribute('position').count;
      colour.copy((o.material as MeshStandardMaterial).color);
      const rgb = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        rgb[i * 3] = colour.r;
        rgb[i * 3 + 1] = colour.g;
        rgb[i * 3 + 2] = colour.b;
      }
      geo.setAttribute('color', new BufferAttribute(rgb, 3));
      geo.setAttribute('aPart', new BufferAttribute(new Float32Array(count).fill(wing + 1), 1));
      parts.push(geo.index ? geo.toNonIndexed() : geo);
    });
    const merged = parts.length ? mergeGeometries(parts) : null;
    if (!merged) {
      console.error('PigeonLook: nothing to draw in pigeon.glb');
      return;
    }
    const restQ = this.uniforms.uRestQ.value as Vector4[];
    const hinge = this.uniforms.uHinge.value as Vector3[];
    const wingQ = this.uniforms.uWingQ.value as Vector4[];
    const flap = clips.find((c) => c.name === 'Flap');
    wings.forEach((bone, w) => {
      if (!bone) return;
      restQ[w].set(bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w);
      hinge[w].copy(bone.position);
      const track = flap?.tracks.find((t) => t.name === `${bone.name}.quaternion`);
      const sampler = track ? (track as unknown as { createInterpolant(): { evaluate(t: number): ArrayLike<number> } }).createInterpolant() : null;
      for (let k = 0; k < FLAP_SAMPLES; k++) {
        // No clip: the wings stay folded (they still glide off).
        const v = sampler ? sampler.evaluate((k / FLAP_SAMPLES) * flap!.duration) : [restQ[w].x, restQ[w].y, restQ[w].z, restQ[w].w];
        wingQ[w * FLAP_SAMPLES + k].set(v[0], v[1], v[2], v[3]);
      }
    });
    merged.setAttribute('aFlap', this.flap);
    const old = this.mesh.geometry;
    this.mesh.geometry = merged;
    old.dispose();
    this.loaded = true;
  }

  /** Wings: turn each wing vertex about its hinge, from folded to the Flap pose at this bird's beat. */
  private patch(shader: { uniforms: Record<string, IUniform>; vertexShader: string; fragmentShader: string }): void {
    Object.assign(shader.uniforms, this.uniforms);
    useWorldUniforms(shader);
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <common>',
      `uniform vec4 uWingQ[${FLAP_SAMPLES * 2}];
      uniform vec4 uRestQ[2];
      uniform vec3 uHinge[2];
      attribute float aPart;
      attribute vec2 aFlap;
      varying vec3 vPigWorld;
      varying vec3 vPigNormal;
      vec3 pigRot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
      vec4 pigMix(vec4 a, vec4 b, float t) { return normalize(mix(a, dot(a, b) < 0.0 ? -b : b, t)); }`,
    );
    shader.vertexShader = replace(
      shader.vertexShader,
      '#include <beginnormal_vertex>',
      `vec4 pigQ = vec4(0.0, 0.0, 0.0, 1.0);
      vec3 pigHinge = vec3(0.0);
      if (aPart > 0.5) {
        int w = int(aPart + 0.5) - 1;
        float f = fract(aFlap.x) * ${FLAP_SAMPLES}.0;
        int k0 = int(floor(f));
        int k1 = k0 + 1 >= ${FLAP_SAMPLES} ? 0 : k0 + 1;
        vec4 beat = pigMix(uWingQ[w * ${FLAP_SAMPLES} + k0], uWingQ[w * ${FLAP_SAMPLES} + k1], fract(f));
        pigQ = pigMix(uRestQ[w], beat, aFlap.y);
        pigHinge = uHinge[w];
      }
      #include <beginnormal_vertex>
      objectNormal = pigRot(pigQ, objectNormal);`,
    );
    shader.vertexShader = after(shader.vertexShader, '#include <begin_vertex>', 'if (aPart > 0.5) transformed = pigHinge + pigRot(pigQ, transformed);');
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <project_vertex>',
      `vPigWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      vPigNormal = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`,
    );
    // Lit by the street lamps at night, like the people.
    shader.fragmentShader = after(shader.fragmentShader, '#include <common>', `varying vec3 vPigWorld;\nvarying vec3 vPigNormal;\n${UB_COMMON}\n${UB_STREET_LIGHT}`);
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      'totalEmissiveRadiance += diffuseColor.rgb * ubStreetLight(vPigWorld, normalize(vPigNormal));',
    );
  }
}
