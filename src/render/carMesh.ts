import {
  BoxGeometry,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type ColorRepresentation,
} from 'three';

export interface CarMesh {
  root: Group;
  /** Front wheels, yawed to show steering input. */
  frontWheels: Mesh[];
}

/**
 * Placeholder car built from boxes (~4.4 m sedan, nose along local +Z).
 * Replaced by Blender-generated GLBs in M3.
 */
export function createCarMesh(paint: ColorRepresentation = '#c8342b'): CarMesh {
  const root = new Group();
  const body = new MeshLambertMaterial({ color: paint });
  const glass = new MeshLambertMaterial({ color: '#1d2733' });
  const tyre = new MeshLambertMaterial({ color: '#141414' });
  const light = new MeshBasicMaterial({ color: '#fff4c2' });
  const tail = new MeshBasicMaterial({ color: '#ff3b2f' });

  const shadow = new Mesh(
    new CircleGeometry(1, 24),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.3, 2.6, 1);
  shadow.position.y = 0.02;
  root.add(shadow);

  const chassis = new Mesh(new BoxGeometry(1.9, 0.7, 4.4), body);
  chassis.position.y = 0.65;
  root.add(chassis);

  const cabin = new Mesh(new BoxGeometry(1.6, 0.6, 2.2), glass);
  cabin.position.set(0, 1.25, -0.2);
  root.add(cabin);

  const roof = new Mesh(new BoxGeometry(1.5, 0.08, 1.7), body);
  roof.position.set(0, 1.58, -0.3);
  root.add(roof);

  for (const x of [-0.6, 0.6]) {
    const head = new Mesh(new BoxGeometry(0.4, 0.15, 0.06), light);
    head.position.set(x, 0.75, 2.21);
    root.add(head);
    const back = new Mesh(new BoxGeometry(0.4, 0.15, 0.06), tail);
    back.position.set(x, 0.75, -2.21);
    root.add(back);
  }

  const wheelGeo = new BoxGeometry(0.3, 0.64, 0.64);
  const frontWheels: Mesh[] = [];
  for (const [x, z] of [
    [-0.95, 1.35],
    [0.95, 1.35],
    [-0.95, -1.35],
    [0.95, -1.35],
  ] as const) {
    const w = new Mesh(wheelGeo, tyre);
    w.position.set(x, 0.32, z);
    root.add(w);
    if (z > 0) frontWheels.push(w);
  }

  return { root, frontWheels };
}
