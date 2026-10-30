import { BoxGeometry, BufferAttribute, Color, Group, Object3D, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleArchetype } from '../entities/vehicle';

/**
 * A car as the game sees it: `root` is positioned and turned by the game like
 * any Object3D (and may carry children), `frontWheels` take the steering
 * angle in rotation.y. The body itself is drawn by the CarBatch that made it
 * (all cars share a few instanced meshes), from these fields.
 */
export interface CarMesh {
  root: Group;
  /** Steering proxies: rotation.y is read as the front wheels' angle. */
  frontWheels: Object3D[];
  archetype: VehicleArchetype;
  /** Body colour (linear). */
  paint: Color;
  /** Burnt-out shell. */
  charred: boolean;
  /** Light bar flashing (police lights). */
  siren: boolean;
}

/** Surface kinds, per vertex; the car shader looks up paint/glass/lights by these. */
export const PART = {
  paint: 0,
  glass: 1,
  headlight: 2,
  taillight: 3,
  tyre: 4,
  trim: 5,
  sirenBlue: 6,
  sirenRed: 7,
  other: 8,
} as const;

/** Part kind for a GLB material name (vehicles.py names them after their role). */
export function partKind(materialName: string): number {
  switch (materialName) {
    case 'paint':
      return PART.paint;
    case 'glass':
      return PART.glass;
    case 'headlight':
      return PART.headlight;
    case 'taillight':
      return PART.taillight;
    case 'tyre':
      return PART.tyre;
    case 'trim':
      return PART.trim;
    case 'siren_blue':
      return PART.sirenBlue;
    case 'siren_red':
      return PART.sirenRed;
    default:
      return PART.other;
  }
}

/**
 * Tag every vertex with what it is: base colour (linear), part kind, and for
 * front wheels the steering pivot (x, z) and a flag.
 */
export function tagCarGeometry(
  geo: BufferGeometry,
  colour: Color,
  kind: number,
  pivot: { x: number; z: number } | null,
): BufferGeometry {
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  const w = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c.set([colour.r, colour.g, colour.b], i * 3);
    if (pivot) w.set([pivot.x, pivot.z, 1], i * 3);
  }
  geo.setAttribute('aColor', new BufferAttribute(c, 3));
  geo.setAttribute('aKind', new BufferAttribute(new Float32Array(n).fill(kind), 1));
  geo.setAttribute('aWheel', new BufferAttribute(w, 3));
  return geo;
}

/**
 * Placeholder car built from boxes (~4.4 m sedan, nose along local +Z), used
 * until vehicles.glb arrives or if it fails to load.
 */
export function placeholderCarGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, colour: string, kind: number, pivot: { x: number; z: number } | null = null) => {
    const g = new BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
    g.deleteAttribute('uv');
    parts.push(tagCarGeometry(g, new Color(colour), kind, pivot));
  };
  box(1.9, 0.7, 4.4, 0, 0.65, 0, '#ffffff', PART.paint);
  box(1.6, 0.6, 2.2, 0, 1.25, -0.2, '#0b1219', PART.glass);
  box(1.5, 0.08, 1.7, 0, 1.58, -0.3, '#ffffff', PART.paint);
  for (const x of [-0.6, 0.6]) {
    box(0.4, 0.15, 0.06, x, 0.75, 2.21, '#fff4c2', PART.headlight);
    box(0.4, 0.15, 0.06, x, 0.75, -2.21, '#b3100a', PART.taillight);
  }
  for (const [x, z] of [
    [-0.95, 1.35],
    [0.95, 1.35],
    [-0.95, -1.35],
    [0.95, -1.35],
  ] as const) {
    box(0.3, 0.64, 0.64, x, 0.32, z, '#141414', PART.tyre, z > 0 ? { x, z } : null);
  }
  return mergeGeometries(parts)!;
}

/** A fresh CarMesh record (not yet drawn by anything). */
export function createCarMesh(archetype: VehicleArchetype, paint: Color): CarMesh {
  const root = new Group();
  const frontWheels = [new Object3D(), new Object3D()];
  root.add(...frontWheels);
  return { root, frontWheels, archetype, paint, charred: false, siren: false };
}
