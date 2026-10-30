import {
  BufferAttribute,
  CapsuleGeometry,
  Color,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Quaternion,
  RGBADepthPacking,
  RGBAFormat,
  Vector3,
  type AnimationClip,
  type BufferGeometry,
  type ColorRepresentation,
  type IUniform,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BodyKind } from '../game/bodies';
import type { WeaponKind } from '../systems/weapons';
import { ClipBank, Layer, Pose, type ClipData } from './characterAnim';
import type { Rect } from '../world/city';
import type { ContactShadows } from './contactShadows';
import { UB_COMMON, UB_STREET_LIGHT, after, replace, useWorldUniforms } from './shaderLib';

/** Recolour parts by material suffix: player_shirt → "shirt", etc. */
export type Outfit = Partial<Record<OutfitSlot, ColorRepresentation>>;
type OutfitSlot = 'skin' | 'hair' | 'shirt' | 'pants' | 'shoes';
/**
 * Palette slots by material suffix. `badge` is fixed colour (the GLB's own,
 * never an outfit's), for a cop's badge or any other part that must not be
 * recoloured.
 */
type PaletteSlot = OutfitSlot | 'badge';
const SLOTS: readonly PaletteSlot[] = ['skin', 'hair', 'shirt', 'pants', 'shoes', 'badge'];
const SLOT_DEFAULT: Record<PaletteSlot, string> = { skin: '#808080', hair: '#808080', shirt: '#e6c43c', pants: '#808080', shoes: '#808080', badge: '#d9b54a' };

const FLASH_SECONDS = 0.09;
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const fakeQ = new Quaternion();
/** Texels per character row after the bones: the palette colours + 1 misc (flash). */
const EXTRA_TEXELS = SLOTS.length + 1;
/** Rows a body's batch starts with; it doubles when more of that body are on screen. */
const START_CAPACITY = 16;
/**
 * People this far outside the visible ground still get drawn, m: a head
 * leaning into the frame, and a long sun shadow at dusk reaching into it.
 */
const CULL_MARGIN = 8;

/** The skeleton and clips every character of one body shares, built once from its GLB. */
interface Template {
  /** Bone hierarchy only (meshes stripped): cloned per character for its own pose. */
  rig: Object3D;
  /** Bones whose matrices go into the texture (the ones parts hang off). */
  boneNames: string[];
  bank: ClipBank;
  /** Ground speeds the Walk and Run cycles are authored for, m/s. */
  walkSpeed: number;
  runSpeed: number;
  /** GLB outfit colours, for slots an outfit leaves unset. */
  palette: Color[];
  /**
   * Where a weapon sits in the right hand, in the arm.R bone's space: the
   * fist at its origin, barrel along the arm, up toward the arm's front.
   */
  grip: { position: Vector3; quaternion: Quaternion };
}

/** A template as tests hand it in (the GLB path builds the rest). */
type TemplateInput = Omit<Template, 'bank' | 'runSpeed' | 'grip'> & Partial<Pick<Template, 'bank' | 'runSpeed' | 'grip'>> & { clips?: AnimationClip[] };

/**
 * Draws every person of one body (one GLB) as ONE instanced, GPU-skinned
 * mesh: one draw call (plus one in the shadow pass) however many of them
 * are on screen, and none when nobody wearing it is.
 *
 * At load, the GLB's rigid body parts (13–20 meshes hanging off 8 bones)
 * are merged into a single geometry where each vertex carries the index of
 * its bone and of its palette slot. Each character keeps its own little
 * bone hierarchy, posed by hand from the clips (characterAnim.ts); every
 * frame `flush()` packs each visible character's bone matrices and palette
 * into one row of a float texture, which the vertex shader reads by
 * gl_InstanceID.
 *
 * Until the GLB arrives (or if it fails) everyone is a capsule in their
 * shirt colour, so the game never waits.
 */
export class CharacterBatch {
  readonly mesh: InstancedMesh;
  /** Everyone wearing this body. */
  readonly models: CharacterModel[] = [];
  /** The people drawn by the last flush(), in row order (for what they hold). */
  readonly shown: CharacterModel[] = [];
  private template: Template | null = null;
  private boneCount = 1;
  private rowTexels = 4 + EXTRA_TEXELS;
  private capacity: number;
  private data: Float32Array;
  private readonly uniforms: Record<string, IUniform>;
  private readonly m = new Matrix4();
  private warned = false;

  constructor(
    url: string,
    readonly kind: BodyKind = 'player',
    capacity = START_CAPACITY,
    /** Never grows past this (a runaway would only cost memory). */
    private readonly maxCapacity = 128,
  ) {
    this.capacity = capacity;
    this.data = new Float32Array(this.rowTexels * capacity * 4);
    this.uniforms = { uCrowdTex: { value: this.makeTexture() }, uBoneCount: { value: 1 } };
    const capsule = new CapsuleGeometry(0.3, 1.1, 4, 8);
    tagGeometry(capsule, 0, SLOTS.indexOf('shirt'));
    const material = new MeshLambertMaterial();
    material.onBeforeCompile = (shader) => this.patch(shader, true);
    // Every body shares one program (same code, its own texture uniform).
    material.customProgramCacheKey = () => 'curbside-crowd';
    this.mesh = new InstancedMesh(capsule, material, capacity);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false; // people are always near the camera; culled per person in flush()
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    depth.onBeforeCompile = (shader) => this.patch(shader, false);
    depth.customProgramCacheKey = () => 'curbside-crowd-depth';
    this.mesh.customDepthMaterial = depth;
    this.mesh.name = `characters-${kind}`;

    if (url) {
      new GLTFLoader().loadAsync(url).then(
        (gltf) => this.useModel(gltf.scene, gltf.animations),
        (err) => console.error(`Failed to load ${url}`, err),
      );
    }
  }

  /** A new character (its root goes in the scene, positioned by the game). */
  create(outfit: Outfit = {}): CharacterModel {
    const model = new CharacterModel(this, outfit);
    if (this.template) model.attach(this.template);
    this.models.push(model);
    return model;
  }

  /** @internal */
  forget(model: CharacterModel): void {
    const i = this.models.indexOf(model);
    if (i >= 0) this.models.splice(i, 1);
  }

  /** @internal Default colour for a slot (the GLB's, or a neutral before it loads). */
  defaultColour(slot: number, out: Color): Color {
    return this.template ? out.copy(this.template.palette[slot]) : out.set(SLOT_DEFAULT[SLOTS[slot]]);
  }

  /**
   * Write every visible character into the instance buffers (call once per
   * frame before rendering), and give each a contact shadow. With `view`
   * (the ground the camera sees), people well outside it are left out: the
   * crowd mostly walks just off-screen, and a body nobody on screen wears
   * then costs no draw call at all (the batch hides when empty).
   */
  flush(shadows?: ContactShadows, view?: Rect): void {
    let row = 0;
    const shown = this.shown;
    shown.length = 0;
    for (const model of this.models) {
      if (!isShown(model.root)) continue;
      model.root.updateWorldMatrix(true, false);
      const w = model.root.matrixWorld.elements;
      if (view && (w[12] < view.minX - CULL_MARGIN || w[12] > view.maxX + CULL_MARGIN || w[14] < view.minZ - CULL_MARGIN || w[14] > view.maxZ + CULL_MARGIN)) continue;
      if (row >= this.capacity && !this.grow()) {
        if (!this.warned) console.warn(`CharacterBatch ${this.kind}: more than ${this.capacity} people visible`);
        this.warned = true;
        break;
      }
      model.body.updateMatrix();
      this.m.multiplyMatrices(model.root.matrixWorld, model.body.matrix);
      model.instanceMatrix.copy(this.m);
      this.mesh.setMatrixAt(row, this.m);
      model.write(this.data, row * this.rowTexels * 4, this.boneCount);
      const e = this.m.elements;
      if (model.lying) {
        // Knocked down: flat on the back, head ~1.7 m behind the feet.
        shadows?.add(e[12] - e[8] * 0.8, e[14] - e[10] * 0.8, Math.atan2(e[8], e[10]), 0.4, 0.9, 0.25, 0.45);
      } else if (model.kneeling) {
        // Kneeling (busted, cowering): the legs lie back along the ground.
        shadows?.add(e[12] - e[8] * 0.35, e[14] - e[10] * 0.35, Math.atan2(e[8], e[10]), 0.35, 0.6, 0.25, 0.5);
      } else {
        shadows?.add(e[12], e[14], 0, 0.3, 0.3, 0.25, 0.5);
      }
      shown.push(model);
      row++;
    }
    this.mesh.count = row;
    this.mesh.visible = row > 0;
    if (row === 0) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, row * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.uniforms.uCrowdTex.value as DataTexture).needsUpdate = true;
  }

  private makeTexture(): DataTexture {
    const tex = new DataTexture(this.data, this.rowTexels, this.capacity, RGBAFormat, FloatType);
    tex.minFilter = tex.magFilter = NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /** Twice the rows (texture and instance buffer), keeping what's written. False at the cap. */
  private grow(): boolean {
    if (this.capacity >= this.maxCapacity) return false;
    this.resize(Math.min(this.maxCapacity, this.capacity * 2), this.rowTexels);
    return true;
  }

  /** New buffers for `capacity` rows of `rowTexels` (old contents carried over where they fit). */
  private resize(capacity: number, rowTexels: number): void {
    const old = this.data;
    this.data = new Float32Array(rowTexels * capacity * 4);
    if (rowTexels === this.rowTexels) this.data.set(old.subarray(0, Math.min(old.length, this.data.length)));
    this.capacity = capacity;
    this.rowTexels = rowTexels;
    const oldTex = this.uniforms.uCrowdTex.value as DataTexture;
    this.uniforms.uCrowdTex.value = this.makeTexture();
    oldTex.dispose();
    const matrices = new InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
    matrices.setUsage(DynamicDrawUsage);
    matrices.array.set(this.mesh.instanceMatrix.array.subarray(0, Math.min(this.mesh.instanceMatrix.array.length, capacity * 16)));
    this.mesh.instanceMatrix = matrices;
  }

  /** The GLB arrived: merge its parts into one skinned geometry and rig everyone. */
  private useModel(scene: Object3D, clips: AnimationClip[]): void {
    scene.updateMatrixWorld(true);
    const bones: Object3D[] = [];
    const palette = SLOTS.map((s) => new Color(SLOT_DEFAULT[s]));
    const parts: BufferGeometry[] = [];
    const meshes: Mesh[] = [];
    scene.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    const local = new Matrix4();
    let hand: Vector3 | null = null;
    for (const mesh of meshes) {
      const bone = mesh.parent ?? scene;
      let b = bones.indexOf(bone);
      if (b < 0) b = bones.push(bone) - 1;
      const mat = mesh.material as MeshStandardMaterial;
      const slot = Math.max(0, SLOTS.indexOf(mat.name.split('_').pop() as PaletteSlot));
      palette[slot].copy(mat.color);
      const geo = (mesh.geometry as BufferGeometry).clone();
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
      // Vertices relative to the bone they ride on.
      geo.applyMatrix4(local.copy(bone.matrixWorld).invert().multiply(mesh.matrixWorld));
      // The right fist: where a weapon goes ("player_hand.R" arrives as "player_handR").
      if (/hand\.?R$/.test(mesh.name) && bone.name === 'armR') {
        geo.computeBoundingBox();
        hand = geo.boundingBox!.getCenter(new Vector3());
      }
      tagGeometry(geo, b, slot);
      parts.push(geo);
    }
    const allIndexed = parts.every((g) => g.index);
    const merged = mergeGeometries(allIndexed ? parts : parts.map((g) => (g.index ? g.toNonIndexed() : g)));
    if (!merged) {
      console.error(`CharacterBatch ${this.kind}: could not merge the character model`);
      return;
    }
    for (const mesh of meshes) mesh.removeFromParent();
    const extras = scene.children[0]?.userData ?? {};
    const walkSpeed = typeof extras.walkSpeed === 'number' ? extras.walkSpeed : 1.6;
    const runSpeed = typeof extras.runSpeed === 'number' ? extras.runSpeed : 5.5;
    this.template = {
      rig: scene,
      boneNames: bones.map((b) => b.name),
      bank: new ClipBank(scene, clips),
      walkSpeed,
      runSpeed,
      palette,
      grip: gripFrame(scene, hand),
    };

    this.boneCount = bones.length;
    this.resize(this.capacity, this.boneCount * 4 + EXTRA_TEXELS);
    this.uniforms.uBoneCount.value = this.boneCount;
    const placeholder = this.mesh.geometry;
    this.mesh.geometry = merged;
    placeholder.dispose();
    for (const model of this.models) model.attach(this.template);
  }

  /** Skin by bone texture: shared by the lit material (`lit`) and the shadow-depth material. */
  private patch(shader: { uniforms: Record<string, IUniform>; vertexShader: string; fragmentShader: string }, lit: boolean) {
    Object.assign(shader.uniforms, this.uniforms);
    const fetch = `
      int crowdRow = gl_InstanceID;
      int crowdBone = int(aBone + 0.5) * 4;
      mat4 crowdM = mat4(
        texelFetch(uCrowdTex, ivec2(crowdBone, crowdRow), 0),
        texelFetch(uCrowdTex, ivec2(crowdBone + 1, crowdRow), 0),
        texelFetch(uCrowdTex, ivec2(crowdBone + 2, crowdRow), 0),
        texelFetch(uCrowdTex, ivec2(crowdBone + 3, crowdRow), 0));`;
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <common>',
      `uniform highp sampler2D uCrowdTex;
      uniform int uBoneCount;
      attribute float aBone;
      attribute float aSlot;
      ${lit ? 'varying vec3 vPartColor;\nvarying float vFlash;\nvarying vec3 vCrowdWorld;\nvarying vec3 vCrowdNormal;' : ''}`,
    );
    if (lit) {
      shader.vertexShader = replace(
        shader.vertexShader,
        '#include <beginnormal_vertex>',
        `${fetch}
        int crowdExtra = uBoneCount * 4;
        vPartColor = texelFetch(uCrowdTex, ivec2(crowdExtra + int(aSlot + 0.5), crowdRow), 0).rgb;
        vFlash = texelFetch(uCrowdTex, ivec2(crowdExtra + ${SLOTS.length}, crowdRow), 0).r;
        #include <beginnormal_vertex>
        objectNormal = mat3(crowdM) * objectNormal;`,
      );
      shader.vertexShader = after(
        shader.vertexShader,
        '#include <begin_vertex>',
        'transformed = (crowdM * vec4(transformed, 1.0)).xyz;',
      );
      shader.vertexShader = after(
        shader.vertexShader,
        '#include <project_vertex>',
        `vCrowdWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vCrowdNormal = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`,
      );
      useWorldUniforms(shader);
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <common>',
        `varying vec3 vPartColor;\nvarying float vFlash;\nvarying vec3 vCrowdWorld;\nvarying vec3 vCrowdNormal;\n${UB_COMMON}\n${UB_STREET_LIGHT}`,
      );
      shader.fragmentShader = replace(shader.fragmentShader, '#include <color_fragment>', 'diffuseColor.rgb *= vPartColor;');
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <emissivemap_fragment>',
        'totalEmissiveRadiance += vec3(vFlash) + diffuseColor.rgb * ubStreetLight(vCrowdWorld, normalize(vCrowdNormal));',
      );
    } else {
      shader.vertexShader = replace(
        shader.vertexShader,
        '#include <begin_vertex>',
        `${fetch}
        #include <begin_vertex>
        transformed = (crowdM * vec4(transformed, 1.0)).xyz;`,
      );
    }
  }
}

/**
 * How a character holds a weapon up: not at all, one-handed (pistol: Aim),
 * two-handed (SMG, shotgun: AimBoth) or on the shoulder (launcher: AimRocket).
 */
export type ArmedPose = false | 'one' | 'two' | 'rocket';

/** The aim pose for a weapon in hand (throwables are held low, ready to throw). */
export function poseFor(weapon: WeaponKind | null): ArmedPose {
  switch (weapon) {
    case 'pistol':
      return 'one';
    case 'smg':
    case 'shotgun':
      return 'two';
    case 'rocket':
      return 'rocket';
    default:
      return false;
  }
}

const AIM_CLIP = { one: 'Aim', two: 'AimBoth', rocket: 'AimRocket' } as const;
const SHOOT_CLIP = { one: 'Shoot', two: 'ShootBoth', rocket: 'ShootRocket' } as const;
/** The combo: jab, left hook, uppercut. */
const PUNCH_CLIP = ['Punch', 'Punch2', 'Uppercut'] as const;

/** What the whole body is doing over (or instead of) walking. */
type FullState = 'none' | 'fall' | 'down' | 'getup' | 'arrested' | 'cower' | 'cheer' | 'enter' | 'ride' | 'stagger';
/** Per state: its clip, whether it loops, and the crossfade into it (s). */
const FULL: Record<Exclude<FullState, 'none'>, { clip: string; loop: boolean; fade: number }> = {
  fall: { clip: 'Fall', loop: false, fade: 0.06 },
  down: { clip: 'Down', loop: true, fade: 0.15 },
  getup: { clip: 'GetUp', loop: false, fade: 0.1 },
  arrested: { clip: 'Arrested', loop: true, fade: 0.2 },
  cower: { clip: 'Cower', loop: true, fade: 0.2 },
  cheer: { clip: 'Cheer', loop: true, fade: 0.2 },
  enter: { clip: 'EnterCar', loop: false, fade: 0.06 },
  ride: { clip: 'Ride', loop: true, fade: 0.15 },
  stagger: { clip: 'Stagger', loop: false, fade: 0.04 },
};
/** States the legs don't walk through (the locomotion base still runs under them, unseen). */
const OUT_OF_PLAY = new Set<FullState>(['fall', 'down', 'getup', 'arrested', 'cower', 'enter', 'ride']);

/** Locomotion: walk below RUN_FROM m/s, run above RUN_TO, blended between. */
const RUN_FROM = 3;
const RUN_TO = 4.5;
/** Back to walking from a whole-body clip over this long, s. */
const FULL_FADE_OUT = 0.14;
/**
 * Lying down, GetUp starts this long before they're back on their feet
 * (at up to GETUP_RUSH × speed), so they're up when the game lets them move.
 */
const GETUP_LEAD = 0.7;
const GETUP_RUSH = 2.2;
/** Punches start this far in (s) and play this much faster: the fist lands ~0.1 s after the press. */
const PUNCH_FROM = 0.04;
const PUNCH_SPEED = 1.25;
/**
 * Throw: start this far in, at this speed, so the release (55%, 0.229 s)
 * comes ~0.08 s after the press; the projectile leaves at once (the sim
 * throws on the press), so the one in the hand is hidden from the start.
 */
const THROW_FROM = 0.1;
const THROW_SPEED = 1.6;
/** Fakes (no clip): punch and shot timings, the stagger lean. */
const PUNCH_SECONDS = 0.3;
const SHOOT_SECONDS = 0.12;
const THROW_SECONDS = 0.3;
const STAGGER_SECONDS = 0.3;
const STAGGER_LEAN = -0.32;

/**
 * One person: `root` is placed by the game (position, heading, visibility),
 * like any Object3D, and may carry children; the body itself is drawn by the
 * CharacterBatch that made it.
 *
 * Animation (clips by name, docs/BLENDER_TODO.md; every missing one falls
 * back to a procedural fake, so a GLB without them still works):
 * - Legs: Idle → Walk → Run blended by ground speed on one shared gait
 *   phase, each cycle played at the speed it was authored for.
 * - Whole body, crossfaded over the legs: knocked down (Fall, then Down,
 *   then GetUp, timed to end as they're allowed up), Arrested (BUSTED),
 *   Cower, Cheer, EnterCar, Ride and a hit's Stagger. These move the root
 *   bone themselves, so the instance transform (`body`) is never tipped
 *   while they play — only the fakes tip it.
 * - Upper body (arms, chest, head) over whatever the legs do: the aim for
 *   the weapon held (Aim / AimBoth / AimRocket), one-shots on top (Shoot*,
 *   the Punch → Punch2 → Uppercut combo, Throw) and Hail.
 * All of it only moves bones, so everyone of a body stays one draw call.
 */
export class CharacterModel {
  readonly root = new Group();
  /** Tipped over by the fakes only (drawn as part of the instance transform). */
  readonly body = new Group();
  /** The aim pose (set by the game before update): raises the arms / plays Aim*. */
  armed: ArmedPose = false;
  /** The weapon in the right hand (drawn by HeldWeapons), or null. */
  weapon: WeaponKind | null = null;
  /** Busted: kneeling, hands behind the head. */
  arrested = false;
  /** Crouched with arms over the head (a panicking bystander). */
  cowering = false;
  /** Seated on a two-wheeler (Ride): put the root at the seat minus 0.75 m. */
  riding = false;
  /** root × body, as drawn last frame (for what this person holds). */
  readonly instanceMatrix = new Matrix4();
  private template: Template | null = null;
  private rig: Object3D | null = null;
  /** Bones written to the texture, in the batch's order. */
  private bones: Object3D[] = [];
  private bank: ClipBank | null = null;
  private pose: Pose | null = null;
  /** The bank's slots' bones in this character's rig. */
  private animBones: Array<Object3D | null> = [];
  /** Bones a fake touches that no clip poses: reset to rest each frame. */
  private readonly fakeRest: Array<{ bone: Object3D; q: Quaternion }> = [];
  private readonly full = new Layer();
  private readonly aim = new Layer();
  private readonly act = new Layer();
  private fullState: FullState = 'none';
  private downPhase: 'none' | 'fall' | 'down' | 'getup' = 'none';
  private aimPose: ArmedPose = false;
  private actKind: 'none' | 'shoot' | 'punch' | 'throw' | 'hail' = 'none';
  private gait = Math.random();
  private idleTime = Math.random() * 2;
  private walkSpeed = 1.6;
  private runSpeed = 5.5;
  private armR: Object3D | null = null;
  private armL: Object3D | null = null;
  private chest: Object3D | null = null;
  private punchTime = 0;
  private punchStep = 0;
  private shootTime = 0;
  private throwTime = 0;
  private flashTime = 0;
  /** The aim's weight when there's no Aim clip (the arms raised by hand). */
  private fakeAim = 0;
  private staggerTime = 0;
  private restagger = false;
  private hailTime = 0;
  private cheerTime = 0;
  private enterTime = 0;
  /** Seconds the weapon stays hidden (just thrown). */
  private hideWeapon = 0;
  private wasDown = false;
  private readonly palette = SLOTS.map(() => new Color());
  private readonly outfit: Outfit = {};
  private readonly placeholder = new Matrix4().makeTranslation(0, 0.85, 0);

  constructor(
    private readonly batch: CharacterBatch,
    outfit: Outfit,
  ) {
    this.root.add(this.body);
    this.setOutfit(outfit);
  }

  /** Which body (GLB) this person is drawn with. */
  get bodyKind(): BodyKind {
    return this.batch.kind;
  }

  /** True while lying on the ground (knocked down). */
  get lying(): boolean {
    if (!this.bank || !this.clipFor('fall')) return this.body.rotation.x < -0.7;
    if (this.full.weight < 0.5) return false;
    const p = this.full.progress;
    return (this.fullState === 'fall' && p > 0.6) || this.fullState === 'down' || (this.fullState === 'getup' && p < 0.4);
  }

  /** Kneeling (Arrested, Cower), for the shadow. */
  get kneeling(): boolean {
    return (this.fullState === 'arrested' || this.fullState === 'cower') && this.full.weight > 0.5;
  }

  /** How far the weapon is raised into the aim, 0..1 (its hold turns from along the arm to straight ahead). */
  get aimAmount(): number {
    return this.bank && this.aimClip(this.armed) ? this.aim.weight * (1 - this.full.weight) : this.fakeAim;
  }

  /** The weapon in hand is drawn: not while down, kneeling, getting in a car, riding, or just thrown. */
  get showsWeapon(): boolean {
    if (this.weapon === null || this.hideWeapon > 0) return false;
    if (this.body.rotation.x < -0.7) return false;
    return !OUT_OF_PLAY.has(this.fullState) || this.full.weight < 0.5;
  }

  /** The GLB this person is drawn with has a clip by this name. */
  hasClip(name: string): boolean {
    return this.bank?.has(name) ?? false;
  }

  /** Change clothes/skin (slots left out keep the model's own colours). */
  setOutfit(outfit: Outfit): void {
    Object.assign(this.outfit, outfit);
    SLOTS.forEach((slot, i) => {
      const c = slot === 'badge' ? undefined : this.outfit[slot];
      if (c === undefined) this.batch.defaultColour(i, this.palette[i]);
      else this.palette[i].set(c);
    });
  }

  /** Hold `weapon` (null: empty-handed), raised into its aim pose or not. */
  hold(weapon: WeaponKind | null, aiming = true): void {
    this.weapon = weapon;
    this.armed = aiming ? poseFor(weapon) : false;
  }

  /** @internal The GLB is in: build this character's own rig and pose. */
  attach(input: TemplateInput): void {
    const t = this.template = completeTemplate(input);
    this.rig = t.rig.clone(true);
    this.bones = t.boneNames.map((name) => this.rig!.getObjectByName(name) ?? this.rig!);
    this.walkSpeed = t.walkSpeed;
    this.runSpeed = t.runSpeed;
    this.bank = t.bank;
    this.pose = new Pose(t.bank);
    this.animBones = t.bank.bones.map((n) => this.rig!.getObjectByName(n) ?? null);
    // GLTFLoader sanitises "arm.R" to "armR".
    this.armR = this.rig.getObjectByName('armR') ?? null;
    this.armL = this.rig.getObjectByName('armL') ?? null;
    this.chest = this.rig.getObjectByName('chest') ?? null;
    this.fakeRest.length = 0;
    for (const bone of [this.armR, this.armL, this.chest]) {
      if (bone && !t.bank.bones.includes(bone.name)) this.fakeRest.push({ bone, q: bone.quaternion.clone() });
    }
    this.full.clear();
    this.aim.clear();
    this.act.clear();
    this.fullState = 'none';
    this.downPhase = 'none';
    this.aimPose = false;
    this.actKind = 'none';
    this.setOutfit({});
    this.rig.updateMatrixWorld(true);
  }

  /**
   * Advance animation for this frame at `groundSpeed` m/s. `down` while
   * knocked over, with `downLeft` seconds until they're allowed up
   * (Infinity: not known, e.g. dead), so GetUp can finish just as they rise.
   */
  update(dt: number, groundSpeed: number, down = false, downLeft = Infinity): void {
    // Clips and crossfades only ever run forward.
    if (!(dt > 0)) dt = 0;
    this.flashTime = Math.max(0, this.flashTime - dt);
    this.staggerTime = Math.max(0, this.staggerTime - dt);
    this.hailTime = Math.max(0, this.hailTime - dt);
    this.cheerTime = Math.max(0, this.cheerTime - dt);
    this.enterTime = Math.max(0, this.enterTime - dt);
    this.hideWeapon = Math.max(0, this.hideWeapon - dt);
    this.punchTime = Math.max(0, this.punchTime - dt);
    this.shootTime = Math.max(0, this.shootTime - dt);
    this.throwTime = Math.max(0, this.throwTime - dt);
    // Busted kneels (Arrested) rather than lying down, or lies down like before without the clip.
    const kneels = this.arrested && this.has('Arrested');
    const lyingDown = kneels ? false : down || this.arrested;
    const clipFall = this.has('Fall') || this.has('Down');

    // --- Procedural fall and lean (only for what has no clip) ---
    const lyingFake = lyingDown && !clipFall;
    const leanTarget = lyingFake ? -Math.PI / 2 : lyingDown ? 0 : this.leanFor(groundSpeed);
    this.body.rotation.x += (leanTarget - this.body.rotation.x) * Math.min(1, dt * (lyingFake || this.staggerTime > 0 ? 12 : 8));
    this.body.position.y = lyingFake ? 0.15 : 0;
    const bank = this.bank;
    const pose = this.pose;
    if (!bank || !pose || !this.rig) {
      this.wasDown = lyingDown;
      return;
    }

    // --- Whole body ---
    this.stepDown(lyingDown, downLeft);
    const want = this.wantFull(groundSpeed);
    const full = this.full;
    if (want !== this.fullState || (want === 'stagger' && this.restagger)) {
      this.restagger = false;
      this.fullState = want;
      if (want === 'none') {
        full.target = 0;
        full.rate = 1 / FULL_FADE_OUT;
      } else {
        const spec = FULL[want];
        const speed = want === 'getup' ? this.getUpSpeed(lyingDown, downLeft) : 1;
        full.play(this.clipFor(want)!, spec.loop, 0, speed, spec.fade);
        full.target = 1;
        full.rate = 1 / spec.fade;
      }
    }
    full.step(dt);

    // --- Legs: Idle / Walk / Run on one gait phase ---
    const walk = bank.get('Walk');
    const run = bank.get('Run');
    const idle = bank.get('Idle');
    const moving = clamp01((groundSpeed - 0.15) / 0.5);
    const runW = run ? clamp01((groundSpeed - RUN_FROM) / (RUN_TO - RUN_FROM)) : 0;
    const walkStride = this.walkSpeed * (walk?.duration ?? 1);
    const runStride = this.runSpeed * (run?.duration ?? 0.625);
    const stride = walkStride + (runStride - walkStride) * runW;
    this.gait = (this.gait + (dt * groundSpeed) / Math.max(0.1, stride)) % 1;
    this.idleTime += dt;
    pose.rest();
    const all = bank.all;
    const wIdle = walk ? 1 - moving : 1;
    const wWalk = walk ? moving * (1 - runW) : 0;
    const wRun = moving * runW;
    let acc = 0;
    if (idle && wIdle > 0) pose.overlay(idle, this.idleTime % idle.duration, wIdle / (acc += wIdle), all);
    if (walk && wWalk > 0) pose.overlay(walk, this.gait * walk.duration, wWalk / (acc += wWalk), all);
    if (run && wRun > 0) pose.overlay(run, this.gait * run.duration, wRun / (acc += wRun), all);
    full.apply(pose, all);

    // --- Upper body: aim, then one-shots and the hail over it ---
    const block = 1 - full.weight;
    const armed = OUT_OF_PLAY.has(this.fullState) ? false : this.armed;
    const aimClip = this.aimClip(armed);
    const aim = this.aim;
    if (aimClip) {
      if (armed !== this.aimPose || aim.cur.clip !== aimClip) aim.play(aimClip, true, aim.cur.time, 1, 0.12);
      this.aimPose = armed;
      aim.target = 1;
    } else aim.target = 0;
    aim.rate = 12;
    aim.step(dt);
    aim.apply(pose, bank.upper, block);
    this.stepAct(dt);
    this.act.apply(pose, bank.upper, block);
    pose.apply(this.animBones);

    // --- Fakes for whatever has no clip ---
    for (const r of this.fakeRest) r.bone.quaternion.copy(r.q);
    const fakeArmed = armed !== false && !aimClip;
    this.fakeAim += ((fakeArmed ? 1 : 0) - this.fakeAim) * Math.min(1, dt * 12);
    if (this.fakeAim > 0.01) {
      this.swing(this.armR, -1.35 * this.fakeAim);
      if (armed === 'two' || armed === 'rocket' || (!fakeArmed && this.fakeAim > 0)) this.swing(this.armL, -1.2 * this.fakeAim);
    }
    if (this.shootTime > 0) this.swing(this.armR, -0.35 * (this.shootTime / SHOOT_SECONDS));
    if (this.punchTime > 0) this.fakePunch();
    if (this.throwTime > 0) {
      const k = 1 - this.throwTime / THROW_SECONDS;
      this.swing(this.armR, k < 0.4 ? -2.6 * (k / 0.4) : -2.6 + 1.8 * ((k - 0.4) / 0.6));
    }
    if (this.hailTime > 0 && !this.has('Hail')) this.swing(this.armR, -2.7 + 0.25 * Math.sin(this.idleTime * 12));
    if (this.cheerTime > 0 && !this.has('Cheer') && groundSpeed < 0.8) {
      this.swing(this.armR, -2.8);
      this.swing(this.armL, -2.8);
    }
    // A hit with no Stagger clip: the chest snaps back.
    if (this.staggerTime > 0 && !this.has('Stagger') && this.chest) {
      fakeQ.setFromAxisAngle(X_AXIS, STAGGER_LEAN * (this.staggerTime / STAGGER_SECONDS));
      this.chest.quaternion.multiply(fakeQ);
    }
    this.wasDown = lyingDown;
    this.rig.updateMatrixWorld(true);
  }

  /** Throw a punch (over whatever the legs do): 0 the jab, 1 the left hook, 2 the uppercut. */
  punch(step = 0): void {
    const clip = this.bank?.get(PUNCH_CLIP[((step % 3) + 3) % 3]);
    if (clip) {
      this.startAct('punch', clip, false, PUNCH_FROM, PUNCH_SPEED, 0.05);
      return;
    }
    this.punchTime = PUNCH_SECONDS * (step === 2 ? 1.4 : 1);
    this.punchStep = step;
  }

  /** A shot: the kick of the weapon held (Shoot / ShootBoth / ShootRocket over its aim). */
  shoot(): void {
    const pose = this.armed === false ? 'one' : this.armed;
    const clip = this.bank?.get(SHOOT_CLIP[pose]);
    if (clip && this.aimClip(pose)) this.startAct('shoot', clip, false, 0, 1, 0.03);
    else this.shootTime = SHOOT_SECONDS;
  }

  /** An overhand throw (grenade, molotov); the one in the hand is hidden until the arm is back. */
  throw(): void {
    const clip = this.bank?.get('Throw');
    if (clip) {
      this.startAct('throw', clip, false, THROW_FROM, THROW_SPEED, 0.04);
      this.hideWeapon = (clip.duration - THROW_FROM) / THROW_SPEED;
    } else {
      this.throwTime = THROW_SECONDS;
      this.hideWeapon = THROW_SECONDS;
    }
  }

  /** Reel from a hit for `seconds` (a fresh hit restarts the Stagger). */
  stagger(seconds = STAGGER_SECONDS): void {
    if (seconds > this.staggerTime + 0.05) this.restagger = this.staggerTime > 0;
    this.staggerTime = Math.max(this.staggerTime, seconds);
  }

  /** Wave down a cab (or wave someone over) for the next `seconds`; call again to keep waving. */
  hail(seconds = 1): void {
    this.hailTime = Math.max(this.hailTime, seconds);
  }

  /** Cheer for `seconds` (while standing still). */
  cheer(seconds = 2.5): void {
    this.cheerTime = Math.max(this.cheerTime, seconds);
  }

  /** Reach for a car door and duck in. Returns how long that takes (0: no clip, hide now). */
  enterCar(): number {
    const clip = this.bank?.get('EnterCar');
    if (!clip) return 0;
    this.enterTime = clip.duration;
    return clip.duration;
  }

  /** Flash white for a moment (e.g. when hit). */
  flash(seconds = FLASH_SECONDS): void {
    this.flashTime = Math.max(this.flashTime, seconds);
  }

  /**
   * The right hand's grip frame in rig space: the fist, barrel along the arm
   * when lowered, straight ahead (+Z) when aimed. False before the GLB loads.
   */
  gripMatrix(out: Matrix4): boolean {
    const g = this.template?.grip;
    const arm = this.armR;
    if (!g || !arm) return false;
    // The arm's rotation in rig space: its chain of local rotations.
    gripQ.identity();
    for (let o: Object3D | null = arm; o && o !== this.rig; o = o.parent) gripQ.premultiply(o.quaternion);
    gripQ.multiply(g.quaternion);
    gripQ.slerp(IDENTITY_Q, clamp01(this.aimAmount));
    gripP.copy(g.position).applyMatrix4(arm.matrixWorld);
    out.compose(gripP, gripQ, ONE);
    return true;
  }

  /**
   * Straight back to standing, nothing playing (a pooled person put back on
   * the street, the player respawned): no GetUp, no leftover one-shot.
   */
  reset(): void {
    this.full.clear();
    this.aim.clear();
    this.act.clear();
    this.fullState = 'none';
    this.downPhase = 'none';
    this.actKind = 'none';
    this.aimPose = false;
    this.wasDown = false;
    this.restagger = false;
    this.arrested = this.cowering = this.riding = false;
    this.weapon = null;
    this.armed = false;
    this.fakeAim = 0;
    this.punchTime = this.shootTime = this.throwTime = this.staggerTime = 0;
    this.hailTime = this.cheerTime = this.enterTime = this.hideWeapon = 0;
    this.body.rotation.x = 0;
    this.body.position.y = 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.batch.forget(this);
  }

  /** @internal Pack bone matrices, palette and flash into the batch's texture row at `at`. */
  write(data: Float32Array, at: number, boneCount: number): void {
    if (this.rig) for (let b = 0; b < boneCount; b++) data.set(this.bones[b].matrixWorld.elements, at + b * 16);
    else data.set(this.placeholder.elements, at);
    let o = at + boneCount * 16;
    for (const c of this.palette) {
      data[o] = c.r;
      data[o + 1] = c.g;
      data[o + 2] = c.b;
      o += 4;
    }
    data[o] = this.flashTime > 0 ? 0.9 : 0;
  }

  private has(name: string): boolean {
    return this.bank?.has(name) ?? false;
  }

  private clipFor(state: Exclude<FullState, 'none'>): ClipData | null {
    return this.bank?.get(FULL[state].clip) ?? null;
  }

  private aimClip(pose: ArmedPose): ClipData | null {
    return pose === false ? null : (this.bank?.get(AIM_CLIP[pose]) ?? null);
  }

  /** Knocked down → Fall → Down → GetUp (timed to finish as they're let up). */
  private stepDown(lyingDown: boolean, downLeft: number): void {
    const hasGetUp = this.has('GetUp');
    if (lyingDown !== this.wasDown) {
      if (lyingDown) this.downPhase = this.has('Fall') ? 'fall' : this.has('Down') ? 'down' : 'none';
      else if (this.downPhase === 'fall' || this.downPhase === 'down') this.downPhase = hasGetUp ? 'getup' : 'none';
    }
    switch (this.downPhase) {
      case 'fall':
        if (this.fullState === 'fall' && this.full.finished) this.downPhase = this.has('Down') ? 'down' : 'fall';
        if (lyingDown && hasGetUp && downLeft < GETUP_LEAD && this.full.progress > 0.5) this.downPhase = 'getup';
        break;
      case 'down':
        if (lyingDown && hasGetUp && downLeft < GETUP_LEAD) this.downPhase = 'getup';
        break;
      case 'getup':
        // Knocked down again before they were up: back on the ground.
        if (lyingDown && downLeft > GETUP_LEAD + 0.3) this.downPhase = this.has('Down') ? 'down' : 'none';
        else if (!lyingDown && this.fullState === 'getup' && this.full.finished) this.downPhase = 'none';
        break;
    }
  }

  /** The whole-body state wanted now (only states whose clip this body has). */
  private wantFull(speed: number): FullState {
    if (this.arrested && this.has('Arrested')) return 'arrested';
    if (this.downPhase !== 'none') return this.clipFor(this.downPhase) ? this.downPhase : 'none';
    if (this.riding && this.has('Ride')) return 'ride';
    if (this.enterTime > 0) return this.has('EnterCar') ? 'enter' : 'none';
    if (this.cowering && this.has('Cower')) return 'cower';
    if (this.cheerTime > 0 && speed < 0.8 && this.has('Cheer')) return 'cheer';
    if (this.staggerTime > 0 && this.has('Stagger')) return 'stagger';
    return 'none';
  }

  /** GetUp's playback rate: rushed to fit the time left down, or brisk once they're already up. */
  private getUpSpeed(lyingDown: boolean, downLeft: number): number {
    const d = this.clipFor('getup')?.duration ?? 1;
    if (!lyingDown) return 1.6;
    return Math.min(GETUP_RUSH, Math.max(1, d / Math.max(0.05, downLeft)));
  }

  private startAct(kind: CharacterModel['actKind'], clip: ClipData, loop: boolean, from: number, speed: number, fade: number): void {
    this.act.play(clip, loop, from, speed, fade);
    this.act.target = 1;
    this.act.rate = 1 / fade;
    this.actKind = kind;
  }

  /** The upper-body one-shot layer: hold while a one-shot plays (or a hail lasts), then ease off. */
  private stepAct(dt: number): void {
    const act = this.act;
    const hail = this.hailTime > 0 ? this.bank?.get('Hail') : null;
    if (this.actKind === 'hail' && !hail) {
      this.actKind = 'none';
    } else if (hail && (this.actKind === 'none' || (this.actKind !== 'hail' && act.finished))) {
      this.startAct('hail', hail, true, 0, 1, 0.15);
    }
    if (this.actKind !== 'none' && this.actKind !== 'hail' && act.finished) this.actKind = 'none';
    if (this.actKind === 'none' && act.target !== 0) {
      act.target = 0;
      act.rate = 8;
    }
    act.step(dt);
  }

  /** Forward lean: running (when there's no Run clip to do it) and reeling back from a hit (no Stagger clip). */
  private leanFor(speed: number): number {
    if (this.staggerTime > 0 && !this.has('Stagger')) return STAGGER_LEAN * 0.6;
    if (this.has('Run')) return 0;
    return Math.min(0.14, Math.max(0, (speed - RUN_FROM) * 0.06));
  }

  /** Rotate a bone forward (negative) or back about its X axis, on top of its pose. */
  private swing(bone: Object3D | null, angle: number): void {
    if (!bone) return;
    fakeQ.setFromAxisAngle(X_AXIS, angle);
    bone.quaternion.multiply(fakeQ);
  }

  /** The procedural jab / left / hook: fast out, slower back. */
  private fakePunch(): void {
    const dur = PUNCH_SECONDS * (this.punchStep === 2 ? 1.4 : 1);
    const t = 1 - this.punchTime / dur;
    const reach = t < 0.3 ? t / 0.3 : (1 - t) / 0.7;
    const arm = this.punchStep === 1 ? this.armL : this.armR;
    this.swing(arm, (this.punchStep === 2 ? -1.8 : -1.5) * reach);
    if (this.punchStep === 2 && this.chest) {
      // The hook turns the shoulders into it.
      fakeQ.setFromAxisAngle(Y_AXIS, -0.5 * reach);
      this.chest.quaternion.multiply(fakeQ);
    }
  }
}

const gripQ = new Quaternion();
const gripP = new Vector3();
const IDENTITY_Q = new Quaternion();
const ONE = new Vector3(1, 1, 1);

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fill in what a hand-built template (tests) leaves out. */
function completeTemplate(t: TemplateInput): Template {
  if (t.bank && t.grip && t.runSpeed !== undefined) return t as Template;
  return {
    ...t,
    bank: t.bank ?? new ClipBank(t.rig, t.clips ?? []),
    runSpeed: t.runSpeed ?? 5.5,
    grip: t.grip ?? gripFrame(t.rig, null),
  };
}

/**
 * The weapon's frame in the arm.R bone's space: origin at the fist; barrel
 * (+Z) down the arm toward the hand; up (+Y) toward the arm's front (the
 * character's forward at rest), so a raised arm holds the gun upright.
 */
function gripFrame(rig: Object3D, hand: Vector3 | null): { position: Vector3; quaternion: Quaternion } {
  const arm = rig.getObjectByName('armR');
  const position = hand ? hand.clone() : new Vector3(0, 0.58, 0);
  if (!arm) return { position, quaternion: new Quaternion() };
  rig.updateMatrixWorld(true);
  // The bone's rest rotation in rig space, to express the character's forward in bone space.
  const rest = new Quaternion();
  for (let o: Object3D | null = arm; o && o !== rig; o = o.parent) rest.premultiply(o.quaternion);
  const forward = new Vector3(0, 0, 1).applyQuaternion(rest.clone().invert());
  const barrel = position.lengthSq() > 1e-6 ? position.clone().normalize() : new Vector3(0, 1, 0);
  const up = forward.sub(barrel.clone().multiplyScalar(forward.dot(barrel))).normalize();
  const side = new Vector3().crossVectors(up, barrel);
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(side, up, barrel));
  return { position, quaternion };
}

/** Mark every vertex of `geo` with its bone and palette slot. */
function tagGeometry(geo: BufferGeometry, bone: number, slot: number): void {
  const n = geo.getAttribute('position').count;
  geo.setAttribute('aBone', new BufferAttribute(new Float32Array(n).fill(bone), 1));
  geo.setAttribute('aSlot', new BufferAttribute(new Float32Array(n).fill(slot), 1));
}

/** Visible and in the scene (an ancestor hidden hides it too). */
function isShown(o: Object3D): boolean {
  let p: Object3D | null = o;
  while (p) {
    if (!p.visible) return false;
    if (!p.parent) return (p as { isScene?: boolean }).isScene === true;
    p = p.parent;
  }
  return false;
}
