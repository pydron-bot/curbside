import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loads = new Map<string, Promise<Object3D>>();

/**
 * weapons.glb's scene, fetched and parsed once however many users it has
 * (the guns in hands and the projectiles in flight). Read it; don't move
 * or re-parent its nodes.
 */
export function loadWeaponsModel(url: string): Promise<Object3D> {
  let p = loads.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
    loads.set(url, p);
  }
  return p;
}
