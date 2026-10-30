import { Box3, Matrix4, Mesh, Vector3, type BufferGeometry, type MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleArchetype } from '../entities/vehicle';
import { partKind, tagCarGeometry } from './carMesh';

/** A car model's footprint, for lights and shadows. */
export interface CarDims {
  halfWidth: number;
  /** Nose and tail, along local +Z / −Z. */
  front: number;
  rear: number;
  /** Roof height. */
  height: number;
}

/**
 * Loads vehicles.glb (blender/generators/vehicles.py) once. Each archetype is
 * a root node; on load all of its parts — body, glass, lights, wheels — are
 * merged into ONE geometry whose vertices carry their base colour, part kind
 * (paint, glass, headlight, ...) and, for the front wheels, the steering
 * pivot. CarBatch draws every car of an archetype from it in a single
 * instanced draw call, tinting paint and steering wheels in the shader.
 */
export class VehicleModels {
  private constructor(
    private readonly geometries: Map<string, BufferGeometry>,
    private readonly sizes: Map<string, CarDims>,
    private readonly seats: Map<string, readonly [number, number, number]>,
  ) {}

  static async load(url: string): Promise<VehicleModels> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const geometries = new Map<string, BufferGeometry>();
    const sizes = new Map<string, CarDims>();
    const seats = new Map<string, readonly [number, number, number]>();
    for (const child of [...gltf.scene.children]) {
      child.position.set(0, 0, 0); // laid out side by side in Blender
      // A bike's `<arch>_seat` empty: where its rider's hips go.
      const seat = child.getObjectByName(`${child.name}_seat`);
      if (seat) {
        child.updateMatrixWorld(true);
        const p = new Vector3().setFromMatrixPosition(seat.matrixWorld);
        seats.set(child.name, [p.x, p.y, p.z]);
      }
      const geo = mergeCar(child);
      if (!geo) continue;
      geometries.set(child.name, geo);
      sizes.set(child.name, dimsOf(geo));
    }
    return new VehicleModels(geometries, sizes, seats);
  }

  /** A bike's seat (the rider's hips), in its own frame; undefined for cars. */
  seat(archetype: VehicleArchetype): readonly [number, number, number] | undefined {
    return this.seats.get(archetype);
  }

  geometry(archetype: VehicleArchetype): BufferGeometry | undefined {
    return this.geometries.get(archetype);
  }

  dims(archetype: VehicleArchetype): CarDims | undefined {
    return this.sizes.get(archetype);
  }
}

export function dimsOf(geo: BufferGeometry): CarDims {
  geo.computeBoundingBox();
  const b = geo.boundingBox ?? new Box3(new Vector3(-0.95, 0, -2.2), new Vector3(0.95, 1.6, 2.2));
  return { halfWidth: Math.max(-b.min.x, b.max.x), front: b.max.z, rear: -b.min.z, height: b.max.y };
}

function mergeCar(root: Object3D): BufferGeometry | null {
  root.updateMatrixWorld(true);
  const inverseRoot = new Matrix4().copy(root.matrixWorld).invert();
  const parts: BufferGeometry[] = [];
  const toRoot = new Matrix4();
  const pivot = new Vector3();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    toRoot.multiplyMatrices(inverseRoot, o.matrixWorld);
    let geo = (o.geometry as BufferGeometry).clone();
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name); // untextured
    }
    if (geo.index) geo = geo.toNonIndexed();
    geo.applyMatrix4(toRoot);
    const mat = o.material as MeshStandardMaterial;
    // Front wheels steer about their own origin.
    const front = /_wheel_F[LR]$/.test(o.name) ? pivot.setFromMatrixPosition(toRoot) : null;
    parts.push(tagCarGeometry(geo, mat.color, partKind(mat.name), front && { x: front.x, z: front.z }));
  });
  return parts.length ? mergeGeometries(parts) : null;
}
