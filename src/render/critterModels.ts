import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three';
import type { PropModels } from './propModels';

/**
 * Stand-in models for the street's animals and umbrellas, built from a few
 * boxes and cones into the props registry (as if props.glb had them) so
 * they draw in the `things` family with everything else: no mesh or
 * program of their own. A model of the same name in props.glb wins
 * (docs/BLENDER_TODO.md has the contract): `dog` standing, `dog_stride`
 * mid-stride (the look swaps the two for a trot), `umbrella` open over
 * someone's head. Surfaces named `paint` take the instance's tint (the
 * dog's coat, the umbrella's colour).
 */
export function addCritterModels(models: PropModels): void {
  if (!models.has('dog')) models.add(dog(false), 'dog');
  if (!models.has('dog_stride')) models.add(dog(true), 'dog_stride');
  if (!models.has('umbrella')) models.add(umbrella(), 'umbrella');
}

const coat = new MeshStandardMaterial({ name: 'paint', color: 0xffffff });
const dark = new MeshStandardMaterial({ name: 'dog_nose', color: 0x141210 });
const pole = new MeshStandardMaterial({ name: 'umbrella_pole', color: 0x2a2a2e });

/** A medium dog, +Z forward, feet on the ground; `stride` swings the legs. */
function dog(stride: boolean): Group {
  const g = new Group();
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, mat = coat, m?: Matrix4): void => {
    const geo: BufferGeometry = new BoxGeometry(w, h, l);
    if (m) geo.applyMatrix4(m);
    const mesh = new Mesh(geo, mat);
    mesh.position.set(x, y, z);
    g.add(mesh);
  };
  box(0.27, 0.27, 0.64, 0, 0.44, 0);
  box(0.22, 0.22, 0.26, 0, 0.62, 0.38);
  box(0.13, 0.11, 0.16, 0, 0.56, 0.56);
  box(0.07, 0.06, 0.04, 0, 0.59, 0.65, dark);
  box(0.06, 0.11, 0.05, -0.08, 0.76, 0.34);
  box(0.06, 0.11, 0.05, 0.08, 0.76, 0.34);
  // The tail, up and back.
  box(0.05, 0.05, 0.3, 0, 0.54, -0.3, coat, new Matrix4().makeRotationX(0.7).multiply(new Matrix4().makeTranslation(0, 0, -0.15)));
  // Legs: pivot at the hip / shoulder; mid-stride, diagonal pairs swing opposite ways.
  for (const [x, z, k] of [
    [-0.09, 0.22, 1],
    [0.09, 0.22, -1],
    [-0.09, -0.22, -1],
    [0.09, -0.22, 1],
  ] as const) {
    const swing = stride ? 0.5 * k : 0;
    const m = new Matrix4().makeRotationX(swing).multiply(new Matrix4().makeTranslation(0, -0.2, 0));
    box(0.08, 0.4, 0.08, x, 0.4, z, coat, m);
  }
  return g;
}

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
