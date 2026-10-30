import { Box3, BufferAttribute, Color, Matrix4, Mesh, Vector3, type BufferGeometry, type MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * What a prop vertex is, from its material name: plain colour, or something
 * the prop shader lights or animates (propBatch.ts). The GLB authors name
 * materials by role (docs/BLENDER_TODO.md §3, §7, §8), so the names are the
 * contract.
 */
export const SURF = {
  plain: 0,
  /** Takes the instance's tint (debris in the car's paint). */
  paint: 1,
  /** Street lamp heads, the safehouse light, rooftop door lights: glow at night. */
  lamp: 2,
  /** Traffic light lenses: lit by the signal cycle. */
  red: 3,
  amber: 4,
  green: 5,
  /** The police station's blue lamp: glows at night, slow pulse. */
  policeLamp: 6,
  /** Signage that is always a little self-lit (spray, export, payphone signs, crate stripes). */
  sign: 7,
  /** Hazard paint and cones: catch the light at night. */
  hazard: 8,
  /** A stunt ramp's deck: chevrons pointing up the slope. */
  rampDeck: 9,
  /** An aircraft-warning light: blinks. */
  blink: 10,
  /** The helicopter's searchlight: bright. */
  searchlight: 11,
  /** Strobes: flash red / blue in turn. */
  strobeRed: 12,
  strobeBlue: 13,
  /** Self-lit in the instance's tint (the frenzy gem: purple, gold once beaten). */
  tint: 14,
} as const;

/** Surface class for a material (and the root it's on: an antenna's red tip blinks, a signal's is a lens). */
export function surfaceFor(material: string, root: string): number {
  switch (material) {
    case 'paint':
      return SURF.paint;
    case 'lamp':
      return SURF.lamp;
    case 'light_red':
      return root === 'traffic_light' ? SURF.red : SURF.blink;
    case 'light_amber':
      return SURF.amber;
    case 'light_green':
      return SURF.green;
    case 'police_lamp':
      return SURF.policeLamp;
    case 'spray_sign':
    case 'export_sign':
    case 'payphone_sign':
      return SURF.sign;
    case 'frenzy':
      return SURF.tint;
    case 'hazard':
    case 'cone_orange':
    case 'barrier_orange':
      return SURF.hazard;
    case 'ramp':
      return SURF.rampDeck;
    case 'searchlight':
      return SURF.searchlight;
    case 'siren_red':
      return SURF.strobeRed;
    case 'siren_blue':
      return SURF.strobeBlue;
    default:
      return material.startsWith('stripe_') ? SURF.sign : SURF.plain;
  }
}

/** A prop's extent in its own frame (origin on the ground unless the GLB says otherwise), m. */
export interface PropDims {
  min: Vector3;
  max: Vector3;
}

/**
 * Loads GLBs with one root per prop (props.glb, pickups.glb, debris.glb,
 * blender/generators): each root is merged into ONE non-indexed geometry
 * whose vertices carry their colour (`aColor`, linear) and surface class
 * (`aSurf`), positioned relative to the root (roots are laid out side by
 * side in the file, so their positions are reset as VehicleModels does).
 * PropBatch combines several of them into a family drawn in one call.
 * Several files can be added to one registry.
 */
export class PropModels {
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly extents = new Map<string, PropDims>();
  /** Named empties and child nodes (a rotor hub, a seat), in their root's frame. */
  private readonly nodes = new Map<string, Vector3>();

  static async load(...urls: string[]): Promise<PropModels> {
    const models = new PropModels();
    const loader = new GLTFLoader();
    const files = await Promise.all(urls.map((u) => loader.loadAsync(u)));
    for (const gltf of files) for (const root of [...gltf.scene.children]) models.add(root);
    return models;
  }

  /** Merge one root into the registry under its name (exported for the helicopter's parts too). */
  add(root: Object3D, name = root.name, skip?: (o: Object3D) => boolean): BufferGeometry | null {
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const inverse = new Matrix4().copy(root.matrixWorld).invert();
    const toRoot = new Matrix4();
    const parts: BufferGeometry[] = [];
    const p = new Vector3();
    root.traverse((o) => {
      if (o !== root) this.nodes.set(o.name, p.setFromMatrixPosition(toRoot.multiplyMatrices(inverse, o.matrixWorld)).clone());
      if (!(o instanceof Mesh) || skip?.(o)) return;
      toRoot.multiplyMatrices(inverse, o.matrixWorld);
      parts.push(tagged(o, toRoot, name));
    });
    if (!parts.length) return null;
    const geo = mergeGeometries(parts);
    if (!geo) return null;
    geo.computeBoundingBox();
    const b = geo.boundingBox ?? new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
    this.geometries.set(name, geo);
    this.extents.set(name, { min: b.min.clone(), max: b.max.clone() });
    return geo;
  }

  geometry(name: string): BufferGeometry | undefined {
    return this.geometries.get(name);
  }

  dims(name: string): PropDims | undefined {
    return this.extents.get(name);
  }

  /** Where a named child node sits in its root's frame (e.g. 'heli_rotor_main'). */
  node(name: string): Vector3 | undefined {
    return this.nodes.get(name);
  }

  has(name: string): boolean {
    return this.geometries.has(name);
  }
}

/** One mesh's geometry in its root's frame, tagged with colour and surface class. */
export function tagged(mesh: Mesh, toRoot: Matrix4, rootName: string): BufferGeometry {
  let geo = (mesh.geometry as BufferGeometry).clone();
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  if (geo.index) geo = geo.toNonIndexed();
  geo.applyMatrix4(toRoot);
  const mat = mesh.material as MeshStandardMaterial;
  const colour = mat.color ?? new Color(1, 1, 1);
  const surf = surfaceFor(mat.name, rootName);
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = colour.r;
    c[i * 3 + 1] = colour.g;
    c[i * 3 + 2] = colour.b;
  }
  geo.setAttribute('aColor', new BufferAttribute(c, 3));
  geo.setAttribute('aSurf', new BufferAttribute(new Float32Array(n).fill(surf), 1));
  return geo;
}
