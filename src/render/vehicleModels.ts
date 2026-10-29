import { Color, Mesh, MeshStandardMaterial, type ColorRepresentation, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { VehicleArchetype } from '../entities/vehicle';
import type { CarMesh } from './carMesh';

/**
 * Loads vehicles.glb (blender/generators/vehicles.py) once. Each archetype is
 * a root node; `dress` swaps a placeholder CarMesh's contents for a clone,
 * tinting the "paint" material and exposing the front wheels for steering.
 */
export class VehicleModels {
  private constructor(private readonly roots: Map<string, Object3D>) {}

  static async load(url: string): Promise<VehicleModels> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const roots = new Map<string, Object3D>();
    for (const child of gltf.scene.children) {
      child.position.set(0, 0, 0); // laid out side by side in Blender
      roots.set(child.name, child);
    }
    return new VehicleModels(roots);
  }

  /** Replace `car`'s placeholder geometry (keeping its blob shadow) with the model. */
  dress(car: CarMesh, archetype: VehicleArchetype, paint: ColorRepresentation): boolean {
    const source = this.roots.get(archetype);
    if (!source) return false;
    const model = source.clone(true);
    const tint = new Color(paint);
    const paintMats = new Map<MeshStandardMaterial, MeshStandardMaterial>();
    model.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const mat = o.material as MeshStandardMaterial;
      if (mat.name === 'paint') {
        let tinted = paintMats.get(mat);
        if (!tinted) {
          tinted = mat.clone();
          tinted.color.copy(tint);
          paintMats.set(mat, tinted);
        }
        o.material = tinted;
      }
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
