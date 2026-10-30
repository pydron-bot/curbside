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
  LoopOnce,
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
  type Interpolant,
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
const SHOOT_SECONDS = 0.12;
const STAGGER_SECONDS = 0.3;
const FLASH_SECONDS = 0.09;
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
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
      if (model.lying) {
        // Knocked down: flat on the back, head ~1.7 m behind the feet.
        shadows?.add(e[12] - e[8] * 0.8, e[14] - e[10] * 0.8, Math.atan2(e[8], e[10]), 0.4, 0.9, 0.25, 0.45);
      } else {
        shadows?.add(e[12], e[14], 0, 0.3, 0.3, 0.25, 0.5);
      }
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

/** How a character holds a weapon: not at all, one-handed (pistol), two-handed (the rest). */
export type ArmedPose = false | 'one' | 'two';

/** Optional clips, played by name when the GLB has them (docs/BLENDER_TODO.md). */
const CLIP_NAMES = ['Idle', 'Walk', 'Run', 'Punch', 'Aim', 'Shoot', 'Fall', 'Down', 'GetUp', 'Ride'] as const;
type ClipName = (typeof CLIP_NAMES)[number];
/** Bones the upper-body layer (Aim, Shoot, Punch) drives, as GLTFLoader names them. */
const UPPER_BONES = ['armR', 'armL', 'chest', 'head'];
/** The Run clip's stride is matched to this ground speed, m/s. */
const RUN_SPEED = 5.5;
/** Locomotion: walk below RUN_FROM m/s, run above RUN_TO, blended between. */
const RUN_FROM = 3;
const RUN_TO = 4.5;
const FALL_SECONDS = 0.5;
const GETUP_SECONDS = 0.9;
const STAGGER_LEAN = -0.32;
const tmpQ = new Quaternion();

/**
 * One person: `root` is placed by the game (position, heading, visibility),
 * like any Object3D, and may carry children; the body itself is drawn by the
 * CharacterBatch that made it.
 *
 * Animation: the GLB's clips are looked up by name, and each one that's
 * missing falls back to a procedural fake, so new clips can land in any
 * order. Locomotion blends Idle → Walk → Run by ground speed (no Run: Walk
 * sped up, leaning in). An upper-body layer on the arms, chest and head
 * holds Aim while armed and plays Shoot (recoil) and Punch one-shots over
 * whatever the legs do (fakes: arms raised forward, a kick, a jab, a left,
 * a hook). Knocked down: Fall, then Down, and GetUp when they rise (fake:
 * the whole body tips over and back). A hit staggers: a lurch back. All of
 * it only moves bones, so everyone stays one instanced draw call.
 */
export class CharacterModel {
  readonly root = new Group();
  /** Tipped over when knocked down (drawn as part of the instance transform). */
  readonly body = new Group();
  /** Weapon held (set by the game before update): raises the arms / plays Aim. */
  armed: ArmedPose = false;
  /** Seated on a bike (set by the game): plays Ride instead of the legs' locomotion. */
  riding = false;
  private rig: Object3D | null = null;
  private bones: Object3D[] = [];
  private mixer: AnimationMixer | null = null;
  /** Legs and whole-body clips (Idle, Walk, Run, Fall, Down, GetUp), played by the mixer. */
  private readonly actions: Partial<Record<ClipName, AnimationAction>> = {};
  /** Upper-body clips (Aim, Shoot, Punch), sampled by hand over the mixer's pose. */
  private readonly upper: Partial<Record<'Aim' | 'Shoot' | 'Punch', UpperClip>> = {};
  private upperBones: Object3D[] = [];
  /**
   * The mixer's own pose of the upper bones last frame. Restored before each
   * mixer update: the mixer only writes a bone when its value changes, so
   * the layers and fakes drawn on top would otherwise pile up frame to frame.
   */
  private readonly upperBase: Quaternion[] = [];
  private aimTime = 0;
  private walkSpeed = 1.6;
  private armR: Object3D | null = null;
  private armL: Object3D | null = null;
  private chest: Object3D | null = null;
  private punchTime = 0;
  private punchStep = 0;
  private shootTime = 0;
  private flashTime = 0;
  private aimWeight = 0;
  private staggerTime = 0;
  /** Seconds into the current fall (while down) or get-up (after). */
  private downTime = 0;
  private getUpTime = 0;
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

  /** True while lying on the ground (knocked down). */
  get lying(): boolean {
    if (this.actions.Fall || this.actions.Down) return this.wasDown && this.downTime > FALL_SECONDS * 0.6;
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
    this.armR = this.rig.getObjectByName('armR') ?? null;
    this.armL = this.rig.getObjectByName('armL') ?? null;
    this.chest = this.rig.getObjectByName('chest') ?? null;
    this.mixer = new AnimationMixer(this.rig);
    this.upperBones = UPPER_BONES.map((n) => this.rig!.getObjectByName(n)).filter((b): b is Object3D => b !== undefined);
    this.upperBase.length = 0;
    for (const b of this.upperBones) this.upperBase.push(b.quaternion.clone());
    for (const name of CLIP_NAMES) {
      const clip = t.clips.find((a) => a.name === name);
      if (!clip) continue;
      if (name === 'Aim' || name === 'Shoot' || name === 'Punch') {
        this.upper[name] = upperClip(clip, this.rig);
        continue;
      }
      const action = this.mixer.clipAction(clip);
      const once = name === 'Fall' || name === 'GetUp';
      if (once) {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      } else action.setLoop(LoopRepeat, Infinity);
      this.actions[name] = action;
    }
    // Locomotion runs all the time, weighted by speed; desynchronised so crowds don't step in unison.
    for (const name of ['Idle', 'Walk', 'Run'] as const) {
      const a = this.actions[name];
      if (!a) continue;
      a.play();
      a.time = Math.random() * a.getClip().duration;
      a.setEffectiveWeight(name === 'Idle' ? 1 : 0);
    }
    this.setOutfit({});
    this.rig.updateMatrixWorld(true);
  }

  /** Advance animation for this frame at `groundSpeed` m/s; `down` while knocked over. */
  update(dt: number, groundSpeed: number, down = false): void {
    this.flashTime = Math.max(0, this.flashTime - dt);
    this.staggerTime = Math.max(0, this.staggerTime - dt);
    const a = this.actions;
    const clipFall = a.Fall !== undefined || a.Down !== undefined;
    // --- Down and up ---
    if (down !== this.wasDown) {
      this.wasDown = down;
      this.downTime = 0;
      if (down) {
        a.GetUp?.stop();
        a.Fall?.reset().play();
      } else if (a.GetUp && clipFall) {
        a.Fall?.stop();
        a.Down?.stop();
        a.GetUp.reset().play();
        this.getUpTime = GETUP_SECONDS;
      }
    }
    this.downTime += dt;
    this.getUpTime = Math.max(0, this.getUpTime - dt);
    if (down && a.Down && this.downTime > FALL_SECONDS && !a.Down.isRunning()) {
      a.Fall?.stop();
      a.Down.reset().play();
    }
    if (!down && !this.getUpTime) {
      a.Fall?.stop();
      a.Down?.stop();
      a.GetUp?.stop();
    }
    // Procedural fall: tip flat on the back (only when there are no clips for it).
    const lyingFake = down && !clipFall;
    const lean = !down && !clipFall ? this.leanFor(groundSpeed) : 0;
    const target = lyingFake ? -Math.PI / 2 : lean;
    this.body.rotation.x += (target - this.body.rotation.x) * Math.min(1, dt * (lyingFake || this.staggerTime > 0 ? 12 : 8));
    this.body.position.y = lyingFake ? 0.15 : 0;
    if (!this.mixer || !this.rig) return;

    // --- Locomotion: Idle / Walk / Run by speed (nothing while down or getting up) ---
    const ride = this.riding && !down && a.Ride !== undefined;
    if (a.Ride && ride !== a.Ride.isRunning()) {
      if (ride) a.Ride.reset().play();
      else a.Ride.stop();
    }
    const busy = down || this.getUpTime > 0 || ride;
    const moving = busy ? 0 : Math.min(1, Math.max(0, (groundSpeed - 0.15) / 0.5));
    const run = a.Run ? Math.min(1, Math.max(0, (groundSpeed - RUN_FROM) / (RUN_TO - RUN_FROM))) : 0;
    const legs = busy ? 0 : 1;
    a.Idle?.setEffectiveWeight(legs * (1 - moving));
    if (a.Walk) {
      a.Walk.setEffectiveWeight(legs * moving * (1 - run));
      a.Walk.timeScale = Math.max(0.3, groundSpeed / this.walkSpeed);
    }
    if (a.Run) {
      a.Run.setEffectiveWeight(legs * moving * run);
      a.Run.timeScale = Math.max(0.5, groundSpeed / RUN_SPEED);
    }
    const bones = this.upperBones;
    for (let i = 0; i < bones.length; i++) bones[i].quaternion.copy(this.upperBase[i]);
    this.mixer.update(dt);
    for (let i = 0; i < bones.length; i++) this.upperBase[i].copy(bones[i].quaternion);

    // --- Upper body: aim, shoot, punch over the legs ---
    const armed = this.armed !== false && !busy;
    this.aimWeight += ((armed ? 1 : 0) - this.aimWeight) * Math.min(1, dt * 12);
    this.punchTime = Math.max(0, this.punchTime - dt);
    this.shootTime = Math.max(0, this.shootTime - dt);
    const u = this.upper;
    this.aimTime += dt;
    if (u.Aim && this.aimWeight > 0.001) this.layer(u.Aim, this.aimTime % u.Aim.duration, this.aimWeight);
    if (u.Shoot && this.shootTime > 0) this.layer(u.Shoot, (1 - this.shootTime / SHOOT_SECONDS) * u.Shoot.duration, 1);
    if (u.Punch && this.punchTime > 0) {
      const dur = PUNCH_SECONDS * (this.punchStep === 2 ? 1.4 : 1);
      this.layer(u.Punch, (1 - this.punchTime / dur) * u.Punch.duration, 1);
    }
    // Fakes for whatever has no clip.
    if (!u.Aim && this.aimWeight > 0.01) {
      this.swing(this.armR, -1.35 * this.aimWeight);
      if (this.armed === 'two' || (!armed && this.aimWeight > 0)) this.swing(this.armL, -1.2 * this.aimWeight);
    }
    if (!u.Shoot && this.shootTime > 0) this.swing(this.armR, -0.35 * (this.shootTime / SHOOT_SECONDS));
    if (!u.Punch && this.punchTime > 0) this.fakePunch();
    // A hit: the chest snaps back.
    if (this.staggerTime > 0 && this.chest) {
      punchQ.setFromAxisAngle(X_AXIS, STAGGER_LEAN * (this.staggerTime / STAGGER_SECONDS));
      this.chest.quaternion.multiply(punchQ);
    }
    this.rig.updateMatrixWorld(true);
  }

  /** Throw a punch (layered on top of whatever the legs do): 0 a right jab, 1 a left, 2 a hook. */
  punch(step = 0): void {
    this.punchTime = PUNCH_SECONDS * (step === 2 ? 1.4 : 1);
    this.punchStep = step;
  }

  /** A shot's recoil (layered on top of the aim). */
  shoot(): void {
    this.shootTime = SHOOT_SECONDS;
  }

  /** Reel from a hit for `seconds`. */
  stagger(seconds = STAGGER_SECONDS): void {
    this.staggerTime = Math.max(this.staggerTime, seconds);
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

  /** Forward lean: running (when there's no Run clip to do it) and reeling back from a hit. */
  private leanFor(speed: number): number {
    if (this.staggerTime > 0) return STAGGER_LEAN * 0.6;
    if (this.actions.Run) return 0;
    return Math.min(0.14, Math.max(0, (speed - RUN_FROM) * 0.06));
  }

  /** Pose the upper bones from `clip` at time `t`, blended `weight` over what's there. */
  private layer(clip: UpperClip, t: number, weight: number): void {
    for (let i = 0; i < clip.bones.length; i++) {
      const v = clip.samplers[i].evaluate(t);
      tmpQ.set(v[0], v[1], v[2], v[3]);
      clip.bones[i].quaternion.slerp(tmpQ, weight);
    }
  }

  /** Rotate a bone forward (negative) or back about its X axis, on top of its pose. */
  private swing(bone: Object3D | null, angle: number): void {
    if (!bone) return;
    punchQ.setFromAxisAngle(X_AXIS, angle);
    bone.quaternion.multiply(punchQ);
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
      punchQ.setFromAxisAngle(Y_AXIS, -0.5 * reach);
      this.chest.quaternion.multiply(punchQ);
    }
  }
}

/** An upper-body clip sampled by hand: its arm, chest and head rotation tracks. */
interface UpperClip {
  duration: number;
  bones: Object3D[];
  samplers: Interpolant[];
}

/** The upper-body bones' rotation tracks of `clip`, bound to `rig`'s bones. */
function upperClip(clip: AnimationClip, rig: Object3D): UpperClip {
  const out: UpperClip = { duration: Math.max(1e-3, clip.duration), bones: [], samplers: [] };
  for (const track of clip.tracks) {
    const [node, prop] = track.name.split('.');
    if (prop !== 'quaternion' || !UPPER_BONES.includes(node)) continue;
    const bone = rig.getObjectByName(node);
    if (!bone) continue;
    out.bones.push(bone);
    // createInterpolant is set per track by its interpolation mode (slerp for rotations).
    out.samplers.push((track as unknown as { createInterpolant(): Interpolant }).createInterpolant());
  }
  return out;
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
