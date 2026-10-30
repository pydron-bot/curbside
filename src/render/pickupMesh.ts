import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import type { Rect } from '../world/city';
import type { Pickup, PickupKind } from '../world/pickups';
import { GLOW, type GlowSprites } from './glowSprites';
import { after } from './shaderLib';
import type { WorldProps } from './worldProps';

const COLORS: Record<PickupKind, string> = {
  pistol: '#4fa3ff',
  smg: '#ffa040',
  shotgun: '#ff4d4d',
  grenade: '#8fd14f',
  molotov: '#ff7a1a',
  rocket: '#d94dff',
  health: '#5be36a',
  armour: '#3fd2ff',
  ammo: '#ffd23f',
};

/**
 * The crates' material: lit, self-lit in each instance's colour, with a pale
 * frame on every face. Shared (same program, no extra compile) by anything
 * else drawn the same way: the progression props (render/progressLook.ts).
 */
export function createPickupMaterial(): MeshLambertMaterial {
  const material = new MeshLambertMaterial();
  // Self-lit in its own colour, with a light frame on every face.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      `vec2 pickupUv = abs(vPickupUv - 0.5);
        float pickupFrame = step(0.36, max(pickupUv.x, pickupUv.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), pickupFrame * 0.8);
        totalEmissiveRadiance += vColor.rgb * (0.55 + 0.35 * pickupFrame);`,
    );
    shader.fragmentShader = after(shader.fragmentShader, '#include <common>', 'varying vec2 vPickupUv;');
    shader.vertexShader = after(shader.vertexShader, '#include <common>', 'varying vec2 vPickupUv;');
    shader.vertexShader = after(shader.vertexShader, '#include <uv_vertex>', 'vPickupUv = uv;');
  };
  material.customProgramCacheKey = () => 'curbside-pickups';
  return material;
}

/** Pickups this far outside the view still get their glow (it reaches in), m. */
const GLOW_MARGIN = 4;

/** The pickups.glb model for each kind (docs/BLENDER_TODO.md §4, §8). */
export const PICKUP_MODELS: Readonly<Record<PickupKind, string>> = {
  pistol: 'crate_pistol',
  smg: 'crate_smg',
  shotgun: 'crate_shotgun',
  grenade: 'crate_grenade',
  molotov: 'crate_molotov',
  rocket: 'crate_rocket',
  health: 'health_kit',
  armour: 'armour',
  ammo: 'ammo_box',
};
/** The models are life-size (a crate is 0.7 m): shown bigger so they read from 20–60 m up. */
const MODEL_SCALE = 1.7;
/** Self-light in their own colours, so they pop against the street (more at night). */
const MODEL_GLOW = 0.3;

/**
 * Weapon, ammo, armour and health crates, spinning and bobbing, each
 * standing in a pulsing light ring with a soft shaft of light so they read
 * from 20–60 m up (the ring and shaft are GlowSprites quads, drawn with
 * every other glow). Drawn as their pickups.glb models in the world props'
 * `things` family once it's loaded (only those near the view); until then,
 * or without it, as glowing colour-coded boxes (one instanced draw call).
 */
export class PickupMesh {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  private readonly colours: Color[];

  constructor(
    private readonly pickups: Pickup[],
    private readonly props: WorldProps | null = null,
  ) {
    const material = createPickupMaterial();
    this.mesh = new InstancedMesh(new BoxGeometry(0.75, 0.75, 0.75), material, pickups.length);
    this.colours = pickups.map((p) => new Color(COLORS[p.kind]));
    this.colours.forEach((c, i) => this.mesh.setColorAt(i, c));
    this.mesh.frustumCulled = false; // spread over the whole city; one cheap draw call
    this.mesh.castShadow = true;
    this.mesh.name = 'pickups';
  }

  /** Spin and bob the crates; add rings and light shafts for those near `view`. */
  update(time: number, glows?: GlowSprites, view?: Rect): void {
    const things = this.props?.loaded ? this.props.things : null;
    // With the models in, the boxes stand down (the mesh stays hidden).
    this.mesh.visible = things === null;
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      const s = p.respawnAt === 0 ? 1 : 0;
      const bob = Math.sin(time * 3 + i) * 0.15;
      if (!things) {
        this.q.setFromAxisAngle(this.up, time * 2 + i);
        this.pos.set(p.x, 0.8 + bob, p.z);
        this.m.compose(this.pos, this.q, this.scale.set(s, s, s));
        this.mesh.setMatrixAt(i, this.m);
      }
      if (!s || !glows || !view) continue;
      if (p.x < view.minX - GLOW_MARGIN || p.x > view.maxX + GLOW_MARGIN) continue;
      if (p.z < view.minZ - GLOW_MARGIN || p.z > view.maxZ + GLOW_MARGIN) continue;
      if (things) things.add(PICKUP_MODELS[p.kind], p.x, 0.35 + bob, p.z, time * 2 + i, MODEL_SCALE, MODEL_SCALE, MODEL_SCALE, 0, MODEL_GLOW);
      const c = this.colours[i];
      const pulse = 0.5 + 0.5 * Math.sin(time * 4 + i * 1.7);
      const ring = 2.1 + pulse * 0.5;
      const k = 0.8 + 0.5 * pulse;
      glows.addFlat(p.x, 0.05, p.z, time * 0.8, ring, ring, c.r * k, c.g * k, c.b * k, GLOW.ring);
      glows.addFlat(p.x, 0.04, p.z, 0, 3.2, 3.2, c.r * 0.35, c.g * 0.35, c.b * 0.35, GLOW.disc);
      // Two crossed upright quads make the shaft read from any angle.
      const yaw = 0.6 + time * 0.3;
      glows.addUpright(p.x, 0, p.z, yaw, 0.9, 4.5, c.r * 0.5, c.g * 0.5, c.b * 0.5, GLOW.beam);
      glows.addUpright(p.x, 0, p.z, yaw + Math.PI / 2, 0.9, 4.5, c.r * 0.5, c.g * 0.5, c.b * 0.5, GLOW.beam);
    }
    if (!things) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
