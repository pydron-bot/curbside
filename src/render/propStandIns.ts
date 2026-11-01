import { BufferAttribute, BufferGeometry, Color, Matrix4, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceFor, type PropModels } from './propModels';

/**
 * A box in a model's own frame (origin on the ground, +Z the front, m):
 * material name (the same names props.glb would use, so the surface classes
 * match: `blink_amber` blinks, `ad_panel` / `screen` / `stripe_*` are
 * self-lit, `barrier_orange` / `roadwork_sign` catch the light, `lamp`
 * glows, `paint` takes the instance tint), sRGB colour, the middle of its
 * footprint (x, z), its base height, its size, and a tilt about X through
 * its middle (rad: positive tips the front down).
 */
type Part = readonly [material: string, colour: string, x: number, y: number, z: number, w: number, h: number, d: number, tilt?: number];

const ORANGE = '#f0661c';
const WHITE = '#f2f1ec';
const DARK = '#2a2b2d';
const POLE = '#6e7478';
const AMBER = '#ffb020';
const STEEL = '#a9b0b6';
const WOOD = '#8a6a48';

/** An umbrella or canopy seen from above: four squares in two colours, `size` across, at height `y`. */
function quarters(a: readonly [string, string], b: readonly [string, string], size: number, y: number, cx = 0, cz = 0): Part[] {
  const q = size / 2;
  return [
    [a[0], a[1], cx - q / 2, y, cz - q / 2, q, 0.08, q],
    [b[0], b[1], cx + q / 2, y, cz - q / 2, q, 0.08, q],
    [b[0], b[1], cx - q / 2, y, cz + q / 2, q, 0.08, q],
    [a[0], a[1], cx + q / 2, y, cz + q / 2, q, 0.08, q],
  ];
}

/**
 * Box stand-ins for the street models props.glb doesn't have yet (the
 * contracts are in docs/BLENDER_TODO.md, *Street props, round 2*). Kept to a
 * few boxes each: every model in a family runs through the vertex shader for
 * every instance of that family (propBatch.ts), so the street family's
 * vertex count is what these cost. A real model of the same root name in
 * props.glb replaces its stand-in.
 */
export const STAND_INS: Readonly<Record<string, readonly Part[]>> = {
  // Road works.
  traffic_barrel: [
    ['barrier_orange', ORANGE, 0, 0, 0, 0.56, 0.95, 0.56],
    ['white', WHITE, 0, 0.3, 0, 0.6, 0.13, 0.6],
    ['white', WHITE, 0, 0.62, 0, 0.6, 0.13, 0.6],
    ['blink_amber', AMBER, 0, 0.95, 0, 0.18, 0.14, 0.18],
  ],
  roadwork_sign: [
    ['roadwork_sign', '#ff9418', 0, 0.12, 0.165, 1.1, 1.05, 0.05, -0.25],
    ['dark', DARK, 0, 0.12, -0.165, 1.1, 1.05, 0.05, 0.25],
    ['dark', '#141414', 0, 0.55, 0.205, 0.7, 0.14, 0.03, -0.25],
  ],
  work_barrier: [
    ['barrier_orange', '#e8551a', 0, 0.32, 0, 1.8, 0.56, 0.18],
    ['white', WHITE, 0, 0.5, 0, 1.82, 0.18, 0.2],
    ['dark', DARK, -0.72, 0, 0, 0.16, 0.12, 0.5],
    ['dark', DARK, 0.72, 0, 0, 0.16, 0.12, 0.5],
    ['blink_amber', AMBER, 0.78, 0.88, 0, 0.16, 0.13, 0.16],
  ],
  steel_plate: [['steel_plate', '#5c6267', 0, 0, 0, 1.6, 0.04, 2.4]],
  work_trench: [
    ['trench', '#241c14', 0.3, 0, 0, 0.8, 0.02, 3.6],
    ['spoil', '#7d6448', -0.45, 0, 0, 0.6, 0.35, 3.0],
  ],
  skip: [
    ['skip_paint', '#e6ae17', 0, 0, 0, 1.6, 1.0, 2.6],
    ['rubble', '#7b746a', 0, 1.0, 0.1, 1.4, 0.1, 2.3],
    ['rubble_dark', '#594b3d', 0.25, 1.0, -0.5, 0.6, 0.3, 0.8],
  ],
  mini_digger: [
    ['dark', '#232323', -0.55, 0, -0.3, 0.38, 0.45, 1.9],
    ['dark', '#232323', 0.55, 0, -0.3, 0.38, 0.45, 1.9],
    ['digger_paint', '#f0b418', 0, 0.45, -0.35, 1.3, 0.75, 1.4],
    ['glass', '#2c3e4a', 0.15, 1.2, -0.5, 0.85, 0.85, 0.9],
    ['digger_paint', '#f0b418', 0.15, 2.05, -0.5, 0.95, 0.08, 1.0],
    ['digger_paint', '#f0b418', -0.35, 0.95, 0.55, 0.22, 0.22, 1.5, 0.45],
    ['dark', '#3a3a3a', -0.35, 0, 1.2, 0.6, 0.45, 0.45],
  ],
  portable_toilet: [
    ['toilet_blue', '#2d6fc2', 0, 0, 0, 1.1, 2.2, 1.1],
    ['toilet_roof', '#e4e6e2', 0, 2.2, 0, 1.16, 0.1, 1.16],
  ],
  // Vendors.
  food_cart_hotdog: [
    ['dark', DARK, 0, 0, 0, 1.2, 0.3, 0.7],
    ['cart_steel', '#c9ccd0', 0, 0.3, 0, 1.6, 0.65, 0.8],
    ['pole', POLE, 0, 0.95, 0, 0.05, 1.1, 0.05],
    ...quarters(['umbrella_red', '#c8302a'], ['umbrella_yellow', '#f2c21b'], 2.0, 2.02),
  ],
  food_cart_coffee: [
    ['dark', DARK, 0, 0, 0, 1.2, 0.3, 0.7],
    ['coffee_brown', '#6b4228', 0, 0.3, 0, 1.5, 0.75, 0.8],
    ['pole', POLE, -0.65, 1.05, -0.3, 0.05, 0.92, 0.05],
    ['pole', POLE, 0.65, 1.05, -0.3, 0.05, 0.92, 0.05],
    ['canopy_green', '#1f5a44', 0, 1.97, -0.3, 1.8, 0.07, 0.4],
    ['canopy_cream', '#efe2c8', 0, 1.97, 0.1, 1.8, 0.07, 0.4],
    ['canopy_green', '#1f5a44', 0, 1.97, 0.5, 1.8, 0.07, 0.4],
  ],
  fruit_stand: [
    ['wood', WOOD, 0, 0, 0, 2.0, 0.8, 1.0],
    ['fruit_red', '#d8322a', -0.72, 0.8, 0.2, 0.46, 0.22, 0.5],
    ['fruit_orange', '#f08a1a', -0.24, 0.8, 0.2, 0.46, 0.22, 0.5],
    ['fruit_yellow', '#f2d02a', 0.24, 0.8, 0.2, 0.46, 0.22, 0.5],
    ['fruit_green', '#6cb83a', 0.72, 0.8, 0.2, 0.46, 0.22, 0.5],
    ['pole', POLE, -1.0, 0.8, -0.45, 0.05, 1.2, 0.05],
    ['pole', POLE, 1.0, 0.8, -0.45, 0.05, 1.2, 0.05],
    ['awning_green', '#2f8a4a', 0, 2.0, -0.3, 2.2, 0.07, 0.75],
    ['white', WHITE, 0, 2.0, -0.3, 2.2, 0.075, 0.22],
  ],
  // Kerbside furniture.
  bus_shelter: [
    ['glass', '#7f9fae', 0, 0.1, -0.4, 3.4, 2.1, 0.06],
    ['glass', '#7f9fae', -1.67, 0.1, -0.05, 0.06, 2.1, 0.75],
    ['ad_panel', '#f3e7c8', 1.67, 0.1, -0.05, 0.08, 2.1, 0.75],
    ['wood', WOOD, 0, 0.42, -0.22, 2.2, 0.06, 0.36],
    ['shelter_roof', '#d6dadd', 0, 2.2, -0.12, 3.6, 0.08, 0.95],
    ['stripe_bus', '#1f6fd1', 0, 2.2, 0.38, 3.6, 0.1, 0.18],
    ['pole', POLE, 1.95, 0, 0.32, 0.07, 2.55, 0.07],
    ['stripe_bus', '#1f6fd1', 1.95, 2.3, 0.32, 0.42, 0.42, 0.12],
  ],
  bike_rack: [
    ['metal', STEEL, 0, 0, 0, 1.8, 0.06, 0.08],
    ['metal', STEEL, -0.62, 0, 0, 0.5, 0.8, 0.05],
    ['metal', STEEL, 0, 0, 0, 0.5, 0.8, 0.05],
    ['metal', STEEL, 0.62, 0, 0, 0.5, 0.8, 0.05],
    ['bike_frame', '#2fa36b', 0.1, 0.35, 0.14, 1.5, 0.45, 0.06],
    ['dark', DARK, 0.75, 0.9, 0.14, 0.06, 0.05, 0.5],
  ],
  planter: [
    ['concrete', '#a8a49c', 0, 0, 0, 1.2, 0.5, 0.7],
    ['leaf', '#3f7a36', 0, 0.5, 0, 1.0, 0.32, 0.5],
    ['flowers', '#d8487a', 0.22, 0.82, 0.04, 0.42, 0.07, 0.26],
  ],
  parking_meter: [
    ['pole', '#5a5f63', 0, 0, 0, 0.07, 1.0, 0.07],
    ['meter', '#3d4448', 0, 1.0, 0, 0.22, 0.36, 0.16],
    ['meter_cap', '#c9a227', 0, 1.36, 0, 0.24, 0.05, 0.18],
  ],
  recycling_bin: [
    ['recycle_blue', '#2a62b8', 0, 0, 0, 0.6, 0.92, 0.6],
    ['recycle_lid', '#4b86d6', 0, 0.92, 0, 0.64, 0.06, 0.64],
    ['white', WHITE, 0, 0.98, 0.08, 0.4, 0.015, 0.1],
  ],
  cafe_table: [
    ['pole', POLE, 0, 0, 0, 0.05, 2.05, 0.05],
    ['white', WHITE, 0, 0.72, 0, 0.7, 0.04, 0.7],
    ['dark', '#3b3b3b', -0.6, 0, 0, 0.4, 0.85, 0.4],
    ['dark', '#3b3b3b', 0.6, 0, 0, 0.4, 0.85, 0.4],
    ...quarters(['umbrella_cream', '#efe4cc'], ['paint', '#b8322e'], 1.7, 2.05),
  ],
  vending_machine: [
    ['paint', '#c82a2a', 0, 0, 0, 1.0, 1.85, 0.8],
    ['ad_panel', '#e8f4ff', -0.1, 0.6, 0.41, 0.65, 1.1, 0.02],
    ['white', WHITE, 0, 1.85, 0.12, 0.9, 0.03, 0.22],
  ],
  atm: [
    ['atm_body', '#5b6670', 0, 0, 0, 0.8, 1.7, 0.6],
    ['screen', '#59c6ff', 0, 1.0, 0.31, 0.45, 0.35, 0.02],
    ['stripe_atm', '#2a7de1', 0, 1.7, 0, 0.84, 0.12, 0.64],
  ],
  shopping_cart: [
    ['dark', DARK, 0, 0, 0, 0.45, 0.12, 0.75],
    ['metal', STEEL, 0, 0.35, 0, 0.55, 0.55, 0.85],
    ['cart_red', '#c8302a', 0, 0.85, -0.45, 0.55, 0.06, 0.06],
  ],
};

/** Give `models` a box stand-in for each STAND_INS root it doesn't have. */
export function addStandIns(models: PropModels): void {
  for (const [name, parts] of Object.entries(STAND_INS)) {
    if (models.has(name)) continue;
    models.addGeometry(name, standInGeometry(name, parts));
  }
}

const m = new Matrix4();
const tilt = new Matrix4();
const v = new Vector3();
const n = new Vector3();
const colour = new Color();

/** Five faces of each box (never the bottom), tagged like a GLB part: aColor (linear) and aSurf. */
export function standInGeometry(root: string, parts: readonly Part[]): BufferGeometry {
  const geos = parts.map(([mat, hex, x, y, z, w, h, d, rx = 0]) => {
    const pos: number[] = [];
    const nor: number[] = [];
    const face = (nx: number, ny: number, nz: number, corners: ReadonlyArray<readonly [number, number, number]>) => {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(...corners[i]);
        nor.push(nx, ny, nz);
      }
    };
    const a = -0.5;
    const b = 0.5;
    // Unit box from y 0 to 1, counter-clockwise seen from outside.
    face(0, 1, 0, [[a, 1, a], [a, 1, b], [b, 1, b], [b, 1, a]]);
    face(1, 0, 0, [[b, 0, a], [b, 1, a], [b, 1, b], [b, 0, b]]);
    face(-1, 0, 0, [[a, 0, b], [a, 1, b], [a, 1, a], [a, 0, a]]);
    face(0, 0, 1, [[b, 0, b], [b, 1, b], [a, 1, b], [a, 0, b]]);
    face(0, 0, -1, [[a, 0, a], [a, 1, a], [b, 1, a], [b, 0, a]]);
    // Scale, tilt about the box's middle, then move into place.
    m.makeScale(w, h, d).premultiply(tilt.makeTranslation(0, -h / 2, 0)).premultiply(tilt.makeRotationX(rx)).premultiply(tilt.makeTranslation(x, y + h / 2, z));
    const count = pos.length / 3;
    const p = new Float32Array(count * 3);
    const nn = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(m);
      p.set([v.x, v.y, v.z], i * 3);
      n.set(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]).applyAxisAngle(X_AXIS, rx);
      nn.set([n.x, n.y, n.z], i * 3);
    }
    colour.set(hex);
    const c = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) c.set([colour.r, colour.g, colour.b], i * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(p, 3));
    g.setAttribute('normal', new BufferAttribute(nn, 3));
    g.setAttribute('aColor', new BufferAttribute(c, 3));
    g.setAttribute('aSurf', new BufferAttribute(new Float32Array(count).fill(surfaceFor(mat, root)), 1));
    return g;
  });
  return mergeGeometries(geos) ?? geos[0];
}

const X_AXIS = new Vector3(1, 0, 0);
