import {
  AnimationMixer,
  BufferAttribute,
  CapsuleGeometry,
  Color,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  Group,
  InstancedMesh,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Quaternion,
  RGBADepthPacking,
  RGBAFormat,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type BufferGeometry,
  type ColorRepresentation,
  type IUniform,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ContactShadows } from './contactShadows';
import { UB_COMMON, UB_STREET_LIGHT, after, replace, useWorldUniforms } from './shaderLib';

/** Recolour parts by material suffix: player_shirt → "shirt", etc. */
export type Outfit = Partial<Record<OutfitSlot, ColorRepresentation>>;
type OutfitSlot = 'skin' | 'hair' | 'shirt' | 'pants' | 'shoes';
const SLOTS: readonly OutfitSlot[] = ['skin', 'hair', 'shirt', 'pants', 'shoes'];

const PUNCH_SECONDS = 0.3;
const FLASH_SECONDS = 0.09;
const X_AXIS = new Vector3(1, 0, 0);
const punchQ = new Quaternion();
/** Texels per character row after the bones: 5 palette colours + 1 misc (flash). */
const EXTRA_TEXELS = SLOTS.length + 1;

/** The skeleton and clips every character shares, built once from the GLB. */
interface Template {
  /** Bone hierarchy only (meshes stripped): cloned per character for its own animation. */
  rig: Object3D;
  boneNames: string[];
  clips: AnimationClip[];
  walkSpeed: number;
  /** GLB outfit colours, for slots an outfit leaves unset. */
  palette: Color[];
}

/**
 * Draws every person in the game — the player and the whole crowd — as ONE
 * instanced, GPU-skinned mesh: one draw call (plus one in the shadow pass)
 * however many people are on screen.
 *
 * At load, the GLB's rigid body parts (13 meshes hanging off 8 bones) are
 * merged into a single geometry where each vertex carries the index of its
 * bone and of its outfit slot. Each character keeps its own little bone
 * hierarchy and AnimationMixer (not in the scene); every frame `flush()`
 * packs each visible character's bone matrices and outfit palette into one
 * row of a float texture, which the vertex shader reads by gl_InstanceID.
 *
 * Until the GLB arrives (or if it fails) everyone is a capsule in their shirt
 * colour, so the game never waits.
 */
export class CharacterBatch {
  readonly mesh: InstancedMesh;
  private readonly models: CharacterModel[] = [];
  private template: Template | null = null;
  private boneCount = 1;
  private rowTexels = 4 + EXTRA_TEXELS;
  private data: Float32Array;
  private readonly uniforms: Record<string, IUniform>;
  private readonly m = new Matrix4();
  private warned = false;

  constructor(
    url: string,
    private readonly capacity = 80,
  ) {
    this.data = new Float32Array(this.rowTexels * capacity * 4);
    this.uniforms = { uCrowdTex: { value: this.makeTexture() }, uBoneCount: { value: 1 } };
    const capsule = new CapsuleGeometry(0.3, 1.1, 4, 8);
    tagGeometry(capsule, 0, SLOTS.indexOf('shirt'));
    const material = new MeshLambertMaterial();
    material.onBeforeCompile = (shader) => this.patch(shader, true);
    material.customProgramCacheKey = () => 'curbside-crowd';
    this.mesh = new InstancedMesh(capsule, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // people are always near the camera; culled per person in flush()
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    depth.onBeforeCompile = (shader) => this.patch(shader, false);
    depth.customProgramCacheKey = () => 'curbside-crowd-depth';
    this.mesh.customDepthMaterial = depth;
    this.mesh.name = 'characters';

    new GLTFLoader().loadAsync(url).then(
      (gltf) => this.useModel(gltf.scene, gltf.animations),
      (err) => console.error(`Failed to load ${url}`, err),
    );
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
    return this.template ? out.copy(this.template.palette[slot]) : out.set(slot === 2 ? '#e6c43c' : '#808080');
  }

  /**
   * Write every visible character into the instance buffers (call once per
   * frame before rendering), and give each a contact shadow.
   */
  flush(shadows?: ContactShadows): void {
    let row = 0;
    const data = this.data;
    const rowFloats = this.rowTexels * 4;
    for (const model of this.models) {
      if (!isShown(model.root)) continue;
      if (row >= this.capacity) {
        if (!this.warned) console.warn(`CharacterBatch: more than ${this.capacity} people visible`);
        this.warned = true;
        break;
      }
      model.root.updateWorldMatrix(true, false);
      model.body.updateMatrix();
      this.m.multiplyMatrices(model.root.matrixWorld, model.body.matrix);
      this.mesh.setMatrixAt(row, this.m);
      model.write(data, row * rowFloats, this.boneCount);
      const e = model.root.matrixWorld.elements;
      shadows?.add(e[12], e[14], 0, model.lying ? 0.45 : 0.3, model.lying ? 0.9 : 0.3, 0.25, 0.5);
      row++;
    }
    this.mesh.count = row;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, row * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.uniforms.uCrowdTex.value as DataTexture).needsUpdate = row > 0;
  }

  private makeTexture(): DataTexture {
    const tex = new DataTexture(this.data, this.rowTexels, this.capacity, RGBAFormat, FloatType);
    tex.minFilter = tex.magFilter = NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /** The GLB arrived: merge its parts into one skinned geometry and rig everyone. */
  private useModel(scene: Object3D, clips: AnimationClip[]): void {
    scene.updateMatrixWorld(true);
    const bones: Object3D[] = [];
    const palette = SLOTS.map((s) => new Color(s === 'shirt' ? '#e6c43c' : '#808080'));
    const parts: BufferGeometry[] = [];
    const meshes: Mesh[] = [];
    scene.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    const local = new Matrix4();
    for (const mesh of meshes) {
      const bone = mesh.parent ?? scene;
      let b = bones.indexOf(bone);
      if (b < 0) b = bones.push(bone) - 1;
      const mat = mesh.material as MeshStandardMaterial;
      const slot = Math.max(0, SLOTS.indexOf(mat.name.split('_').pop() as OutfitSlot));
      palette[slot].copy(mat.color);
      const geo = (mesh.geometry as BufferGeometry).clone();
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
      // Vertices relative to the bone they ride on.
      geo.applyMatrix4(local.copy(bone.matrixWorld).invert().multiply(mesh.matrixWorld));
      tagGeometry(geo, b, slot);
      parts.push(geo.index ? geo : geo);
    }
    const allIndexed = parts.every((g) => g.index);
    const merged = mergeGeometries(allIndexed ? parts : parts.map((g) => (g.index ? g.toNonIndexed() : g)));
    if (!merged) {
      console.error('CharacterBatch: could not merge the character model');
      return;
    }
    for (const mesh of meshes) mesh.removeFromParent();
    const walkSpeed = scene.children[0]?.userData?.walkSpeed;
    this.template = {
      rig: scene,
      boneNames: bones.map((b) => b.name),
      clips,
      walkSpeed: typeof walkSpeed === 'number' ? walkSpeed : 1.6,
      palette,
    };

    this.boneCount = bones.length;
    this.rowTexels = this.boneCount * 4 + EXTRA_TEXELS;
    this.data = new Float32Array(this.rowTexels * this.capacity * 4);
    const old = this.uniforms.uCrowdTex.value as DataTexture;
    this.uniforms.uCrowdTex.value = this.makeTexture();
    old.dispose();
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
 * One person: `root` is placed by the game (position, heading, visibility),
 * like any Object3D, and may carry children; the body itself is drawn by the
 * CharacterBatch that made it.
 */
export class CharacterModel {
  readonly root = new Group();
  /** Tipped over when knocked down (drawn as part of the instance transform). */
  readonly body = new Group();
  private rig: Object3D | null = null;
  private bones: Object3D[] = [];
  private mixer: AnimationMixer | null = null;
  private idle: AnimationAction | null = null;
  private walk: AnimationAction | null = null;
  private current: AnimationAction | null = null;
  private walkSpeed = 1.6;
  private punchArm: Object3D | null = null;
  private punchTime = 0;
  private flashTime = 0;
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

  /** True while lying on the ground (knocked down). */
  get lying(): boolean {
    return this.body.rotation.x < -0.7;
  }

  /** Change clothes/skin (slots left out keep the model's own colours). */
  setOutfit(outfit: Outfit): void {
    Object.assign(this.outfit, outfit);
    SLOTS.forEach((slot, i) => {
      const c = this.outfit[slot];
      if (c === undefined) this.batch.defaultColour(i, this.palette[i]);
      else this.palette[i].set(c);
    });
  }

  /** @internal The GLB is in: build this character's own rig and animation. */
  attach(t: Template): void {
    this.rig = t.rig.clone(true);
    this.bones = t.boneNames.map((name) => this.rig!.getObjectByName(name) ?? this.rig!);
    this.walkSpeed = t.walkSpeed;
    // GLTFLoader sanitises "arm.R" to "armR".
    this.punchArm = this.rig.getObjectByName('armR') ?? null;
    this.mixer = new AnimationMixer(this.rig);
    const clip = (name: string) => t.clips.find((a) => a.name === name);
    const idleClip = clip('Idle');
    const walkClip = clip('Walk');
    if (idleClip) this.idle = this.mixer.clipAction(idleClip).setLoop(LoopRepeat, Infinity);
    if (walkClip) this.walk = this.mixer.clipAction(walkClip).setLoop(LoopRepeat, Infinity);
    // Desynchronise crowds so they don't all step in unison.
    if (this.idle) {
      this.idle.play();
      this.idle.time = Math.random() * 2;
      this.current = this.idle;
    }
    this.setOutfit({});
    this.rig.updateMatrixWorld(true);
  }

  /** Advance animation; picks Idle or Walk and matches stride to ground speed. */
  update(dt: number, groundSpeed: number, down = false): void {
    // Knocked down: lie flat on the back, feet toward where we were facing.
    const target = down ? -Math.PI / 2 : 0;
    this.body.rotation.x += (target - this.body.rotation.x) * Math.min(1, dt * 12);
    this.body.position.y = down ? 0.15 : 0;
    this.flashTime = Math.max(0, this.flashTime - dt);
    if (!this.mixer || !this.rig) return;
    if (!down && groundSpeed > 0.2 && this.walk) {
      this.play(this.walk);
      this.walk.timeScale = groundSpeed / this.walkSpeed;
    } else {
      this.play(this.idle);
    }
    this.mixer.update(dt);
    if (this.punchTime > 0 && this.punchArm) {
      this.punchTime = Math.max(0, this.punchTime - dt);
      // Fast out, slower back: 0 → 1 → 0 over the punch.
      const t = 1 - this.punchTime / PUNCH_SECONDS;
      const reach = t < 0.3 ? t / 0.3 : (1 - t) / 0.7;
      punchQ.setFromAxisAngle(X_AXIS, -1.5 * reach); // swing the arm forward
      this.punchArm.quaternion.multiply(punchQ);
    }
    this.rig.updateMatrixWorld(true);
  }

  /** Throw a right jab (layered on top of whatever clip is playing). */
  punch(): void {
    this.punchTime = PUNCH_SECONDS;
  }

  /** Flash white for a moment (e.g. when hit). */
  flash(seconds = FLASH_SECONDS): void {
    this.flashTime = Math.max(this.flashTime, seconds);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.mixer?.stopAllAction();
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

  private play(action: AnimationAction | null): void {
    if (!action || action === this.current) return;
    action.reset().play();
    if (this.current) action.crossFadeFrom(this.current, 0.15, false);
    this.current = action;
  }
}

/** Mark every vertex of `geo` with its bone and outfit slot. */
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
