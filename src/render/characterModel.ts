import {
  Quaternion,
  Vector3,
  AnimationAction,
  AnimationMixer,
  CapsuleGeometry,
  CircleGeometry,
  Group,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type ColorRepresentation,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/** Recolour parts by material suffix: player_shirt → "shirt", etc. */
export type Outfit = Partial<Record<'skin' | 'hair' | 'shirt' | 'pants' | 'shoes', ColorRepresentation>>;

const cache = new Map<string, Promise<GLTF>>();
function loadShared(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) cache.set(url, (p = new GLTFLoader().loadAsync(url)));
  return p;
}

const PUNCH_SECONDS = 0.3;
const X_AXIS = new Vector3(1, 0, 0);
const punchQ = new Quaternion();

const shadowGeo = new CircleGeometry(0.45, 16);
const shadowMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
const placeholderGeo = new CapsuleGeometry(0.3, 1.1, 4, 8);

/**
 * A character from a Blender-built GLB (see blender/generators/characters.py)
 * with Idle/Walk clips. The GLB is fetched once per URL and cloned per
 * character. Shows a capsule until it arrives so the game never waits.
 */
export class CharacterModel {
  readonly root = new Group();
  /** Holds the model; tipped over when knocked down. */
  private readonly body = new Group();
  private mixer: AnimationMixer | null = null;
  private idle: AnimationAction | null = null;
  private walk: AnimationAction | null = null;
  private current: AnimationAction | null = null;
  /** Ground speed the walk cycle was authored for (from the GLB's extras). */
  private walkSpeed = 1.6;
  private ownedMaterials: Material[] = [];
  private punchArm: Object3D | null = null;
  private punchTime = 0;
  private disposed = false;

  constructor(url: string, outfit: Outfit = {}) {
    const shadow = new Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.root.add(shadow, this.body);

    const placeholder = new Mesh(placeholderGeo, new MeshLambertMaterial({ color: outfit.shirt ?? '#e6c43c' }));
    this.ownedMaterials.push(placeholder.material as Material);
    placeholder.position.y = 0.85;
    this.body.add(placeholder);

    loadShared(url).then(
      (gltf) => {
        if (this.disposed) return;
        this.body.remove(placeholder);
        const scene = cloneSkinned(gltf.scene);
        this.applyOutfit(scene, outfit);
        this.body.add(scene);
        const extras = scene.children[0]?.userData;
        if (typeof extras?.walkSpeed === 'number') this.walkSpeed = extras.walkSpeed;
        // GLTFLoader sanitises "arm.R" to "armR".
        this.punchArm = scene.getObjectByName('armR') ?? null;
        this.mixer = new AnimationMixer(scene);
        const clip = (name: string) => gltf.animations.find((a) => a.name === name);
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
      },
      (err) => console.error(`Failed to load ${url}`, err),
    );
  }

  private applyOutfit(scene: Object3D, outfit: Outfit) {
    const swapped = new Map<Material, MeshStandardMaterial>();
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const mat = o.material as MeshStandardMaterial;
      const part = mat.name.split('_').pop() as keyof Outfit;
      const colour = outfit[part];
      if (colour === undefined) return;
      let m = swapped.get(mat);
      if (!m) {
        m = mat.clone();
        m.color.set(colour);
        swapped.set(mat, m);
        this.ownedMaterials.push(m);
      }
      o.material = m;
    });
  }

  /** Advance animation; picks Idle or Walk and matches stride to ground speed. */
  update(dt: number, groundSpeed: number, down = false): void {
    // Knocked down: lie flat on the back, feet toward where we were facing.
    const target = down ? -Math.PI / 2 : 0;
    this.body.rotation.x += (target - this.body.rotation.x) * Math.min(1, dt * 12);
    this.body.position.y = down ? 0.15 : 0;
    if (!this.mixer) return;
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
  }

  /** Throw a right jab (layered on top of whatever clip is playing). */
  punch(): void {
    this.punchTime = PUNCH_SECONDS;
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    this.mixer?.stopAllAction();
    for (const m of this.ownedMaterials) m.dispose();
  }

  private play(action: AnimationAction | null): void {
    if (!action || action === this.current) return;
    action.reset().play();
    if (this.current) action.crossFadeFrom(this.current, 0.15, false);
    this.current = action;
  }
}
