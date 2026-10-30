import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Vector3,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WeaponKind } from '../systems/weapons';
import type { CharacterModel } from './characterModel';
import { after } from './shaderLib';

/** Every weapon that can be in a hand, and its root in weapons.glb. */
const HELD: readonly WeaponKind[] = ['pistol', 'smg', 'shotgun', 'grenade', 'molotov', 'rocket'];
const ROOT: Record<WeaponKind, string> = {
  pistol: 'pistol',
  smg: 'smg',
  shotgun: 'shotgun',
  grenade: 'grenade',
  molotov: 'molotov',
  rocket: 'rocket_launcher',
};
/** Grip → muzzle along the barrel, m, until the GLB's `muzzle` extras arrive. */
const MUZZLE_GUESS: Record<WeaponKind, number> = { pistol: 0.2, smg: 0.38, shotgun: 0.73, grenade: 0, molotov: 0, rocket: 0.76 };
/** Shots start this far ahead of the shooter (combat.ts), m: how a shot is matched to who fired it. */
const SHOT_LEAD = 0.6;
const SHOOTER_MATCH = 0.9;

const hand = new Matrix4();
const world = new Matrix4();
const inv = new Matrix4();
const muzzleP = new Vector3();

/**
 * Weapons in people's hands, all in ONE instanced draw call (no shadow pass):
 * the six models of weapons.glb are merged into one geometry whose vertices
 * know which weapon they belong to, and each instance shows only its own
 * (the rest collapse to nothing in the vertex shader). An instance follows
 * its holder's right hand every frame: at the fist, along the arm when
 * lowered, straight ahead when aimed (CharacterModel.gripMatrix).
 *
 * Also places muzzle flashes: a shot's flash goes to the end of the barrel
 * of whoever fired it (the GLB's `muzzle` extra: grip → muzzle, m).
 */
export class HeldWeapons {
  readonly mesh: InstancedMesh;
  private readonly sel: InstancedBufferAttribute;
  private readonly muzzle = { ...MUZZLE_GUESS };
  private loaded = false;
  private warned = false;

  constructor(
    url = '/assets/weapons.glb',
    private readonly capacity = 48,
  ) {
    const material = new MeshLambertMaterial({ vertexColors: true });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = after(shader.vertexShader, '#include <common>', 'attribute float aWeapon;\nattribute float aSel;');
      // Only this instance's weapon: the others' vertices collapse to a point (no triangles drawn).
      shader.vertexShader = after(shader.vertexShader, '#include <begin_vertex>', 'if (abs(aWeapon - aSel) > 0.5) transformed = vec3(0.0);');
    };
    material.customProgramCacheKey = () => 'curbside-held-weapons';
    const geometry = new BufferGeometry();
    this.sel = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.sel.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aSel', this.sel);
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'held-weapons';
    if (url) {
      new GLTFLoader().loadAsync(url).then(
        (gltf) => this.useModel(gltf.scene),
        (err) => console.error(`Failed to load ${url}`, err),
      );
    }
  }

  /**
   * Put a weapon in every visible hand that holds one. Call after the
   * character batches' flush() (it reads where they drew everyone).
   */
  flush(batches: ReadonlyArray<{ readonly shown: readonly CharacterModel[] }>): void {
    let n = 0;
    if (this.loaded) {
      outer: for (const b of batches) {
        for (const m of b.shown) {
          if (!m.showsWeapon || !m.weapon || !m.gripMatrix(hand)) continue;
          if (n >= this.capacity) {
            if (!this.warned) console.warn(`HeldWeapons: more than ${this.capacity} weapons visible`);
            this.warned = true;
            break outer;
          }
          world.multiplyMatrices(m.instanceMatrix, hand);
          this.mesh.setMatrixAt(n, world);
          this.sel.array[n] = HELD.indexOf(m.weapon);
          n++;
        }
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.sel.clearUpdateRanges();
    this.sel.addUpdateRange(0, n);
    this.sel.needsUpdate = true;
  }

  /** Where `model`'s muzzle is (world, as drawn last frame); false if nothing's in hand. */
  muzzleOf(model: CharacterModel, out: Vector3): boolean {
    if (!model.weapon || !model.gripMatrix(hand)) return false;
    world.multiplyMatrices(model.instanceMatrix, hand);
    out.set(0, 0, this.muzzle[model.weapon]).applyMatrix4(world);
    return true;
  }

  /**
   * Move a shot's muzzle flash from the shooter's chest to the end of the
   * barrel of whoever among `people` fired it (matched by position; drive-bys
   * and police cars have no hand). The barrel is taken from the shooter's
   * pose, turned to the shot's own direction (the body turns to it on the
   * next frame). Writes (x, y, z) into `out`; false when nobody matches.
   */
  placeShot(
    e: { x: number; z: number; dirX: number; dirZ: number; driveBy?: boolean },
    people: ReadonlyArray<{ readonly shown: readonly CharacterModel[] }>,
    out: { x: number; y: number; z: number },
  ): boolean {
    if (e.driveBy || !this.loaded) return false;
    const sx = e.x - e.dirX * SHOT_LEAD;
    const sz = e.z - e.dirZ * SHOT_LEAD;
    let best: CharacterModel | null = null;
    let bestD = SHOOTER_MATCH * SHOOTER_MATCH;
    for (const b of people) {
      for (const m of b.shown) {
        if (!m.weapon) continue;
        const p = m.root.position;
        const d = (p.x - sx) ** 2 + (p.z - sz) ** 2;
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    if (!best || !this.muzzleOf(best, muzzleP)) return false;
    // Into the shooter's own frame, then out again along the shot's heading.
    muzzleP.applyMatrix4(inv.copy(best.root.matrixWorld).invert());
    const c = e.dirZ;
    const s = e.dirX;
    out.x = sx + muzzleP.x * c + muzzleP.z * s;
    out.y = muzzleP.y;
    out.z = sz - muzzleP.x * s + muzzleP.z * c;
    return true;
  }

  /** weapons.glb arrived: one geometry, each vertex tagged with its weapon and coloured by its material. */
  private useModel(scene: Object3D): void {
    const parts: BufferGeometry[] = [];
    const colour = new Color();
    for (const kind of HELD) {
      const root = scene.getObjectByName(ROOT[kind]);
      if (!root) continue;
      const m = root.userData?.muzzle;
      if (typeof m === 'number') this.muzzle[kind] = m;
      // Roots are laid out side by side in the file: each at its own origin.
      root.position.set(0, 0, 0);
      root.updateMatrixWorld(true);
      inv.copy(root.matrixWorld).invert();
      root.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const geo = (o.geometry as BufferGeometry).clone();
        for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
        geo.applyMatrix4(world.multiplyMatrices(inv, o.matrixWorld));
        const count = geo.getAttribute('position').count;
        colour.copy((o.material as MeshStandardMaterial).color);
        const rgb = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) rgb.set([colour.r, colour.g, colour.b], i * 3);
        geo.setAttribute('color', new BufferAttribute(rgb, 3));
        geo.setAttribute('aWeapon', new BufferAttribute(new Float32Array(count).fill(HELD.indexOf(kind)), 1));
        parts.push(geo.index ? geo.toNonIndexed() : geo);
      });
    }
    const merged = parts.length ? mergeGeometries(parts) : null;
    if (!merged) {
      console.error('HeldWeapons: no weapons in weapons.glb');
      return;
    }
    merged.setAttribute('aSel', this.sel);
    const old = this.mesh.geometry;
    this.mesh.geometry = merged;
    old.dispose();
    this.loaded = true;
  }
}
