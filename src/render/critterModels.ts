import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import type { PropModels } from './propModels';

/**
 * Stand-in models for the street's umbrellas, built from a cone and a
 * stick into the props registry (as if props.glb had them) so they draw
 * in the `things` family with everything else: no mesh or program of
 * their own. A model of the same name in props.glb wins: `umbrella`, open
 * over someone's head. Surfaces named `paint` take the instance's tint
 * (the umbrella's colour).
 */
export function addCritterModels(models: PropModels): void {
  if (!models.has('umbrella')) models.add(umbrella(), 'umbrella');
}

const coat = new MeshStandardMaterial({ name: 'paint', color: 0xffffff });
const pole = new MeshStandardMaterial({ name: 'umbrella_pole', color: 0x2a2a2e });

/** An open umbrella over someone's head: a canopy and a stick, origin on the ground. */
function umbrella(): Group {
  const g = new Group();
  const canopy = new Mesh(new ConeGeometry(0.58, 0.22, 10, 1, true), coat);
  canopy.position.set(0, 2.08, 0);
  g.add(canopy);
  const stick = new Mesh(new CylinderGeometry(0.015, 0.015, 0.95, 4), pole);
  stick.position.set(0, 1.62, 0);
  g.add(stick);
  return g;
}
