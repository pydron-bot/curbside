import {
  AnimationAction,
  AnimationMixer,
  CapsuleGeometry,
  CircleGeometry,
  Group,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * A character from a Blender-built GLB (see blender/generators/characters.py)
 * with Idle/Walk clips. Shows a capsule until the GLB arrives so the game
 * never waits on assets.
 */
export class CharacterModel {
  readonly root = new Group();
  private mixer: AnimationMixer | null = null;
  private idle: AnimationAction | null = null;
  private walk: AnimationAction | null = null;
  private current: AnimationAction | null = null;
  /** Ground speed the walk cycle was authored for (from the GLB's extras). */
  private walkSpeed = 1.6;
  private placeholder: Mesh;

  constructor(url: string) {
    const shadow = new Mesh(
      new CircleGeometry(0.45, 16),
      new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.root.add(shadow);

    this.placeholder = new Mesh(new CapsuleGeometry(0.3, 1.1, 4, 8), new MeshLambertMaterial({ color: '#e6c43c' }));
    this.placeholder.position.y = 0.85;
    this.root.add(this.placeholder);

    new GLTFLoader().load(
      url,
      (gltf) => {
        this.root.remove(this.placeholder);
        this.root.add(gltf.scene);
        const extras = gltf.scene.getObjectByName('Player')?.userData ?? gltf.scene.children[0]?.userData;
        if (typeof extras?.walkSpeed === 'number') this.walkSpeed = extras.walkSpeed;
        this.mixer = new AnimationMixer(gltf.scene);
        const clip = (name: string) => gltf.animations.find((a) => a.name === name);
        const idleClip = clip('Idle');
        const walkClip = clip('Walk');
        if (idleClip) this.idle = this.mixer.clipAction(idleClip).setLoop(LoopRepeat, Infinity);
        if (walkClip) this.walk = this.mixer.clipAction(walkClip).setLoop(LoopRepeat, Infinity);
        this.play(this.idle);
      },
      undefined,
      (err) => console.error(`Failed to load ${url}`, err),
    );
  }

  /** Advance animation; picks Idle or Walk and matches stride to ground speed. */
  update(dt: number, groundSpeed: number): void {
    if (!this.mixer) return;
    if (groundSpeed > 0.2 && this.walk) {
      this.play(this.walk);
      this.walk.timeScale = groundSpeed / this.walkSpeed;
    } else {
      this.play(this.idle);
    }
    this.mixer.update(dt);
  }

  private play(action: AnimationAction | null): void {
    if (!action || action === this.current) return;
    action.reset().play();
    if (this.current) action.crossFadeFrom(this.current, 0.15, false);
    this.current = action;
  }
}
