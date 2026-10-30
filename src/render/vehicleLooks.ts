import { Mesh, MeshLambertMaterial, type ColorRepresentation, type Object3D } from 'three';
import type { Vehicle } from '../game/population';
import { createCarMesh, type CarMesh } from './carMesh';
import type { VehicleModels } from './vehicleModels';

/**
 * A car's look over its life: placeholder boxes until vehicles.glb arrives,
 * the dressed model after, a charred shell once it has blown up, and back to
 * normal when Population recycles it. Keeps the `charred` flag in step with
 * what's on screen whatever order the GLB load and explosions happen in.
 */

const charredMaterial = new MeshLambertMaterial({ color: '#1c1a19' });

/** Placeholder car whose boxes are marked as owned (safe to dispose on rebuild). */
export function createVehicleMesh(paint: ColorRepresentation): CarMesh {
  const mesh = createCarMesh(paint);
  for (const child of mesh.root.children) if (child.name !== 'shadow') child.userData.placeholder = true;
  return mesh;
}

/** Blacken a burnt-out car (the blob shadow keeps its material). */
export function charVehicle(v: Vehicle): void {
  v.charred = true;
  v.mesh.root.traverse((o) => {
    if (o instanceof Mesh && o.name !== 'shadow') o.material = charredMaterial;
  });
}

/** Give a car its proper look back: the model if loaded, else fresh placeholder boxes. */
export function restoreVehicleLook(v: Vehicle, models: VehicleModels | null): void {
  v.charred = false;
  if (models?.dress(v.mesh, v.archetype, v.paint)) return;
  // No models (still loading, or the GLB failed): rebuild the placeholder in place.
  const fresh = createVehicleMesh(v.paint);
  for (const child of [...v.mesh.root.children]) {
    if (child.name === 'shadow') continue;
    v.mesh.root.remove(child);
    if (child.userData.placeholder) disposeBoxes(child);
  }
  for (const child of [...fresh.root.children]) if (child.name !== 'shadow') v.mesh.root.add(child);
  v.mesh.frontWheels.length = 0;
  v.mesh.frontWheels.push(...fresh.frontWheels);
}

/**
 * vehicles.glb arrived: dress every car (live or waiting in the spare pool),
 * then re-blacken the ones that are wrecks so they don't look brand new.
 */
export function dressAll(cars: Iterable<Vehicle>, models: VehicleModels): void {
  for (const v of cars) {
    models.dress(v.mesh, v.archetype, v.paint);
    if (v.charred) charVehicle(v);
  }
}

function disposeBoxes(o: Object3D) {
  if (o instanceof Mesh) o.geometry.dispose();
}
