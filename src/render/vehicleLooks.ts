import type { Vehicle } from '../game/population';
import type { CarBatch } from './vehicleBatch';

/**
 * A car's look over its life: brand new, a charred shell once it has blown
 * up, and back to normal (possibly as another model or paint) when
 * Population recycles it. The CarBatch draws whatever the CarMesh says, so
 * these only flip its fields; the GLB arriving late needs nothing here.
 */

/** Blacken a burnt-out car. */
export function charVehicle(v: Vehicle): void {
  v.charred = true;
  v.mesh.charred = true;
}

/** Give a car its proper look back, with its current model and paint. */
export function restoreVehicleLook(v: Vehicle, cars: CarBatch): void {
  v.charred = false;
  v.mesh.charred = false;
  v.mesh.siren = false;
  cars.restyle(v.mesh, v.archetype, v.paint);
}
