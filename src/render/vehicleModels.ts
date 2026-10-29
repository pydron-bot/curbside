import {
  Color,
  Group,
  Matrix4,
  Mesh,
  type BufferGeometry,
  type ColorRepresentation,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleArchetype } from '../entities/vehicle';
import type { CarMesh } from './carMesh';

/**
 * Loads vehicles.glb (blender/generators/vehicles.py) once. Each archetype is
 * a root node; on load its parts are merged into one mesh per material (front
 * wheels stay separate so they can steer), taking a car from ~16 draw calls
 * to ~8. `dress` swaps a placeholder CarMesh's contents for a clone, tinting
 * the "paint" material.
 */
export class VehicleModels {
  private constructor(private readonly roots: Map<string, Object3D>) {}

  static async load(url: string): Promise<VehicleModels> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const roots = new Map<string, Object3D>();
    for (const child of [...gltf.scene.children]) {
      child.position.set(0, 0, 0); // laid out side by side in Blender
      roots.set(child.name, mergeByMaterial(child));
    }
    return new VehicleModels(roots);
  }

  /** Replace `car`'s placeholder geometry (keeping its blob shadow) with the model. */
  dress(car: CarMesh, archetype: VehicleArchetype, paint: ColorRepresentation): boolean {
    const source = this.roots.get(archetype);
    if (!source) return false;
    const model = source.clone(true);
    const tint = new Color(paint);
    let tinted: MeshStandardMaterial | null = null;
    model.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const mat = o.material as MeshStandardMaterial;
      if (mat.name !== 'paint') return;
      if (!tinted) {
        tinted = mat.clone();
        tinted.color.copy(tint);
      }
      o.material = tinted;
    });

    for (const child of [...car.root.children]) {
      if (child.name !== 'shadow') car.root.remove(child);
    }
    car.root.add(model);
    car.frontWheels.length = 0;
    model.traverse((o) => {
      if (o instanceof Mesh && /_wheel_F[LR]$/.test(o.name)) car.frontWheels.push(o);
    });
    return true;
  }
}

function mergeByMaterial(root: Object3D): Object3D {
  root.updateMatrixWorld(true);
  const inverseRoot = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<Material, BufferGeometry[]>();
  const out = new Group();
  out.name = root.name;

  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (/_wheel_F[LR]$/.test(o.name)) {
      const wheel = o.clone();
      wheel.matrix.multiplyMatrices(inverseRoot, o.matrixWorld);
      wheel.matrix.decompose(wheel.position, wheel.quaternion, wheel.scale);
      out.add(wheel);
      return;
    }
    const geo = (o.geometry as BufferGeometry).clone();
    geo.applyMatrix4(new Matrix4().multiplyMatrices(inverseRoot, o.matrixWorld));
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name); // untextured
    }
    const list = groups.get(o.material as Material) ?? [];
    list.push(geo);
    groups.set(o.material as Material, list);
  });

  for (const [material, geos] of groups) {
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
    if (!merged) continue;
    out.add(new Mesh(merged, material));
  }
  return out;
}
