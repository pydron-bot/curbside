import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  Vector4,
  type BufferGeometry,
  type Material,
} from 'three';
import { UB_COMMON, UB_STREET_LIGHT, after, replace, useWorldUniforms, worldUniforms } from '../render/shaderLib';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, type City, type Rect } from './city';
import { AWNING_DEPTH, AWNING_HEIGHT, planBuildings, type BuildingPlan, type RoofProp } from './buildingPlans';
import { DISTRICTS, DISTRICT_STYLES, ROOF_TYPES, type District, type RoofType } from './districts';
import { LAMP_ARM, LAMP_HEIGHT, generateStreetLamps } from './streetLamps';

/** Blocks per render chunk along each axis (4 → 256 m chunks, 16 chunks). */
const CHUNK_BLOCKS = 4;
const CHUNK_SIZE = CHUNK_BLOCKS * BLOCK_SIZE;
const CHUNKS_PER_SIDE = BLOCKS_PER_SIDE / CHUNK_BLOCKS;

/** Roof colours (sRGB) by roof type; one is picked per building. */
const ROOF_COLOURS: Readonly<Record<RoofType, readonly string[]>> = {
  tar: ['#3d3a37', '#34333a', '#48423c', '#3a3633'],
  gravel: ['#a69e90', '#9c978e', '#b4ab99', '#8f8a80'],
  metal: ['#8f9aa1', '#a4aaad', '#7e8a86', '#8a6a50'],
  garden: ['#5b7f3c', '#4e7535', '#668a42'],
  membrane: ['#cfd1cd', '#c7ccd0', '#d8d3c8'],
  terracotta: ['#b4552f', '#a6472b', '#bf6a3a', '#9c4a30'],
  helipad: ['#8c8f92', '#979a9b'],
};

const PROP_COLOURS: Readonly<Record<RoofProp['kind'], readonly string[]>> = {
  ac: ['#b9bcbd', '#a9adb0', '#c4c2bb'],
  vent: ['#8d9396', '#9da1a3', '#7f8486'],
  tank: ['#7a5a3a', '#6e5236', '#9da3a6'],
  chimney: ['#8a4a3a', '#7c4436', '#6f6a66'],
  solar: ['#22355a', '#1d2f4f'],
  housing: [],
};
const LAMP_POST = '#3c4146';
const LAMP_HEAD = '#ffe2b0';
const LAMP_GLOW = '#ff9a3c';

/** What a chunk is made of: one instanced mesh each. */
type PartName = 'buildings' | 'boxes' | 'cylinders' | 'canopies' | 'glows';

export interface CityMesh {
  root: Group;
  /** Per frame: hide the night-only glow meshes by day (saves their draw calls). */
  update(night: number): void;
}

/**
 * Turns a City into a handful of instanced meshes per 256 m chunk (each with
 * its own bounding sphere, so three.js culls whole chunks):
 * - buildings: one box per building, dressed entirely in the building shader
 *   (windows aligned to the corners, floor ledges, shopfronts, roofs);
 * - boxes: rooftop AC units, stair housings, chimneys, solar panels, awnings,
 *   neon tubes and street-lamp posts;
 * - cylinders: vents, water tanks and tree trunks;
 * - canopies: trees;
 * - glows (night only): lamp halos and neon light spilling on the sidewalk.
 * A typical view touches 1–2 chunks: ~4–5 draw calls each.
 */
export function createCityMesh(city: City): CityMesh {
  const root = new Group();
  root.name = 'city';
  const plans = planBuildings(city);

  const unitBox = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const cylinder = new CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0);
  const canopyGeo = new IcosahedronGeometry(1, 0);
  const glowGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  const buildingMat = buildingMaterial();
  const propMat = propMaterial();
  const canopyMat = new MeshLambertMaterial({ flatShading: true });
  const glowMat = glowMaterial();

  const chunks = new Map<number, ChunkBuilder>();
  const chunkFor = (x: number, z: number) => {
    const cx = clampChunk(Math.floor((x + HALF_EXTENT) / CHUNK_SIZE));
    const cz = clampChunk(Math.floor((z + HALF_EXTENT) / CHUNK_SIZE));
    const key = cx * CHUNKS_PER_SIDE + cz;
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = new ChunkBuilder(`chunk_${cx}_${cz}`)));
    return c;
  };

  const color = new Color();
  const roof = new Color();
  const m = new Matrix4();
  city.buildings.forEach((b, i) => {
    const plan = plans[i];
    const c = chunkFor((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
    wallColour(b.district, b.tint, color);
    roofColour(plan, roof);
    c.add('buildings', boxMatrix(b, 0, b.height, m), color, [
      roof.r,
      roof.g,
      roof.b,
      ROOF_TYPES.indexOf(plan.roof),
      plan.seed,
      plan.shopSides,
      DISTRICTS.indexOf(b.district),
    ]);
    addRoofProps(c, plan, color, m);
    addShopfronts(c, b, plan, m);
  });

  for (const lamp of generateStreetLamps()) addLamp(chunkFor(lamp.x, lamp.z), lamp, m);

  for (const t of city.trees) {
    const c = chunkFor(t.x, t.z);
    const h = 2.4 + t.radius * 0.6;
    c.add('cylinders', m.makeScale(0.42, h, 0.42).setPosition(t.x, 0, t.z), color.set('#5a4030'), [0]);
    m.makeScale(t.radius, t.radius * 0.8, t.radius).setPosition(t.x, h + t.radius * 0.4, t.z);
    c.add('canopies', m, color.setHSL(0.24 + ((t.x * 7.1 + t.z) % 1) * 0.07, 0.5, 0.27));
  }

  const parts: Record<PartName, [BufferGeometry, Material, string[]]> = {
    buildings: [unitBox, buildingMat, ['aRoofColor:3', 'aInfo:4']],
    boxes: [unitBox, propMat, ['aGlow:1']],
    cylinders: [cylinder, propMat, ['aGlow:1']],
    canopies: [canopyGeo, canopyMat, []],
    glows: [glowGeo, glowMat, []],
  };
  const glowMeshes: InstancedMesh[] = [];
  for (const c of chunks.values()) {
    const group = c.build(parts);
    for (const mesh of group.children as InstancedMesh[]) {
      if (mesh.userData.part === 'glows') glowMeshes.push(mesh);
      else {
        mesh.castShadow = true;
        mesh.receiveShadow = mesh.userData.part !== 'canopies';
      }
    }
    root.add(group);
  }
  root.add(boundaryWallMesh(city, unitBox, propMat));

  return {
    root,
    update(night: number) {
      const show = night > 0.02;
      for (const g of glowMeshes) g.visible = show;
    },
  };
}

// --- Content ---------------------------------------------------------------

function wallColour(district: District, tint: number, out: Color): Color {
  const walls = DISTRICT_STYLES[district].walls;
  out.set(walls[Math.floor(tint * walls.length) % walls.length]);
  return out.offsetHSL(0, 0, ((tint * 13.7) % 0.06) - 0.03);
}

function roofColour(plan: BuildingPlan, out: Color): Color {
  const options = ROOF_COLOURS[plan.roof];
  return out.set(options[Math.floor(plan.seed * 997) % options.length]);
}

function addRoofProps(c: ChunkBuilder, plan: BuildingPlan, wall: Color, m: Matrix4): void {
  const color = new Color();
  for (const p of plan.props) {
    const options = PROP_COLOURS[p.kind];
    if (p.kind === 'housing') color.copy(wall).multiplyScalar(0.85);
    else color.set(options[Math.floor((p.minX * 3.1 + p.minZ * 1.7) * 10) % options.length]);
    if (p.kind === 'vent' || p.kind === 'tank') {
      const legs = p.kind === 'tank' ? 0.9 : 0;
      if (legs) {
        for (const [lx, lz] of [
          [p.minX + 0.2, p.minZ + 0.2],
          [p.maxX - 0.2, p.minZ + 0.2],
          [p.minX + 0.2, p.maxZ - 0.2],
          [p.maxX - 0.2, p.maxZ - 0.2],
        ]) {
          c.add('boxes', m.makeScale(0.14, legs, 0.14).setPosition(lx, p.y0, lz), color.set('#4a4038'), [0]);
        }
        color.set(options[Math.floor(p.minX * 13) % options.length]);
      }
      c.add('cylinders', boxMatrix(p, p.y0 + legs, p.height, m), color, [0]);
    } else if (p.kind === 'solar') {
      // Panels tilted up toward the midday sun (south, +Z).
      tiltedBox(p, p.y0 + 0.2, 0.06, 0.26, m);
      c.add('boxes', m, color, [0]);
    } else {
      c.add('boxes', boxMatrix(p, p.y0, p.height, m), color, [0]);
    }
  }
}

const OUTWARD = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/** Awnings over the sidewalk, a neon tube along their edge, and the neon's glow on the pavement. */
function addShopfronts(c: ChunkBuilder, b: Rect, plan: BuildingPlan, m: Matrix4): void {
  const color = new Color();
  for (const s of plan.shopfronts) {
    if (!s.awning) continue;
    const [ox, oz] = OUTWARD[s.side];
    const alongX = s.side === 0 || s.side === 2;
    const face = s.side === 0 ? b.minZ : s.side === 1 ? b.maxX : s.side === 2 ? b.maxZ : b.minX;
    const mid = (s.from + s.to) / 2;
    const width = s.to - s.from;
    // Awning: a thin slab sloping down and out from the wall.
    const cx = alongX ? mid : face + (ox * AWNING_DEPTH) / 2;
    const cz = alongX ? face + (oz * AWNING_DEPTH) / 2 : mid;
    const slope = 0.28;
    const q = new Quaternion().setFromAxisAngle(
      new Vector3(alongX ? 1 : 0, 0, alongX ? 0 : 1),
      alongX ? slope * oz : -slope * ox,
    );
    m.compose(
      new Vector3(cx, AWNING_HEIGHT - 0.1, cz),
      q,
      new Vector3(alongX ? width : AWNING_DEPTH, 0.1, alongX ? AWNING_DEPTH : width),
    );
    c.add('boxes', m, color.set(s.awning), [0]);
    if (!s.neon) continue;
    const ex = alongX ? mid : face + ox * (AWNING_DEPTH + 0.05);
    const ez = alongX ? face + oz * (AWNING_DEPTH + 0.05) : mid;
    const drop = AWNING_HEIGHT - 0.1 - Math.sin(slope) * (AWNING_DEPTH / 2) - 0.12;
    m.makeScale(alongX ? width : 0.08, 0.08, alongX ? 0.08 : width).setPosition(ex, drop, ez);
    c.add('boxes', m, color.set(s.neon), [2.2]);
    // Coloured light spilling onto the sidewalk.
    const gx = alongX ? mid : face + ox * 2.4;
    const gz = alongX ? face + oz * 2.4 : mid;
    m.makeScale(alongX ? width + 2 : 4.2, 1, alongX ? 4.2 : width + 2).setPosition(gx, 0.04, gz);
    c.add('glows', m, color.set(s.neon).multiplyScalar(0.55));
  }
}

function addLamp(c: ChunkBuilder, lamp: { x: number; z: number; dx: number; dz: number }, m: Matrix4): void {
  const color = new Color(LAMP_POST);
  const along = lamp.dx !== 0;
  c.add('boxes', m.makeScale(0.32, 0.45, 0.32).setPosition(lamp.x, 0, lamp.z), color, [0]);
  c.add('boxes', m.makeScale(0.15, LAMP_HEIGHT, 0.15).setPosition(lamp.x, 0, lamp.z), color, [0]);
  const armX = lamp.x + (lamp.dx * LAMP_ARM) / 2;
  const armZ = lamp.z + (lamp.dz * LAMP_ARM) / 2;
  m.makeScale(along ? LAMP_ARM : 0.1, 0.1, along ? 0.1 : LAMP_ARM).setPosition(armX, LAMP_HEIGHT - 0.1, armZ);
  c.add('boxes', m, color, [0]);
  const hx = lamp.x + lamp.dx * LAMP_ARM;
  const hz = lamp.z + lamp.dz * LAMP_ARM;
  m.makeScale(along ? 0.62 : 0.34, 0.16, along ? 0.34 : 0.62).setPosition(hx, LAMP_HEIGHT - 0.22, hz);
  c.add('boxes', m, color.set(LAMP_HEAD), [1.6]);
  m.makeScale(2.8, 1, 2.8).setPosition(hx, LAMP_HEIGHT - 0.32, hz);
  c.add('glows', m, color.set(LAMP_GLOW).multiplyScalar(0.4));
}

// --- Mesh building ----------------------------------------------------------

class ChunkBuilder {
  private parts = new Map<PartName, { matrices: number[]; colors: number[]; extra: number[] }>();
  constructor(private readonly name: string) {}

  add(part: PartName, m: Matrix4, c: Color, extra: readonly number[] = []) {
    let p = this.parts.get(part);
    if (!p) this.parts.set(part, (p = { matrices: [], colors: [], extra: [] }));
    p.matrices.push(...m.elements);
    p.colors.push(c.r, c.g, c.b);
    p.extra.push(...extra);
  }

  build(defs: Record<PartName, [BufferGeometry, Material, string[]]>): Group {
    const g = new Group();
    g.name = this.name;
    for (const [part, { matrices, colors, extra }] of this.parts) {
      const [geo, mat, attrs] = defs[part];
      const count = matrices.length / 16;
      const mesh = new InstancedMesh(geo, mat, count);
      mesh.instanceMatrix.array.set(matrices);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(colors), 3);
      // Extra per-instance attributes are interleaved in `extra` in the order listed.
      const stride = attrs.reduce((s, a) => s + Number(a.split(':')[1]), 0);
      let offset = 0;
      for (const a of attrs) {
        const [name, sizeText] = a.split(':');
        const size = Number(sizeText);
        const data = new Float32Array(count * size);
        for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) data[i * size + k] = extra[i * stride + offset + k];
        mesh.geometry = mesh.geometry === geo ? geo.clone() : mesh.geometry;
        mesh.geometry.setAttribute(name, new InstancedBufferAttribute(data, size));
        offset += size;
      }
      mesh.computeBoundingSphere(); // covers all instances → per-chunk culling
      mesh.name = `${this.name}_${part}`;
      mesh.userData.part = part;
      g.add(mesh);
    }
    return g;
  }
}

function clampChunk(c: number) {
  return Math.max(0, Math.min(CHUNKS_PER_SIDE - 1, c));
}

/** Matrix placing a unit box (base at y=0) over `r`, from y0 up `height`. */
function boxMatrix(r: Rect, y0: number, height: number, out: Matrix4): Matrix4 {
  return out
    .makeScale(r.maxX - r.minX, height, r.maxZ - r.minZ)
    .setPosition((r.minX + r.maxX) / 2, y0, (r.minZ + r.maxZ) / 2);
}

/** A thin box over `r` tilted `angle` (radians) about X, raised `y0`. */
function tiltedBox(r: Rect, y0: number, thickness: number, angle: number, out: Matrix4): Matrix4 {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle);
  return out.compose(
    new Vector3((r.minX + r.maxX) / 2, y0, (r.minZ + r.maxZ) / 2),
    q,
    new Vector3(r.maxX - r.minX, thickness, (r.maxZ - r.minZ) / Math.cos(angle)),
  );
}

function boundaryWallMesh(city: City, geo: BufferGeometry, mat: Material): InstancedMesh {
  const walls = city.obstacles.slice(-4);
  const g = geo.clone();
  g.setAttribute('aGlow', new InstancedBufferAttribute(new Float32Array(walls.length), 1));
  const mesh = new InstancedMesh(g, mat, walls.length);
  const c = new Color('#8f8c86');
  const m = new Matrix4();
  walls.forEach((w, i) => {
    mesh.setMatrixAt(i, boxMatrix(w, 0, 1.4, m));
    mesh.setColorAt(i, c);
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'boundary';
  return mesh;
}

// --- Materials ---------------------------------------------------------------

/** Rooftop props, awnings, lamps, trunks: instance colour, plus `aGlow` emission at night (neon, lamp heads). */
function propMaterial(): MeshLambertMaterial {
  const mat = new MeshLambertMaterial();
  mat.onBeforeCompile = (shader) => {
    useWorldUniforms(shader);
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <common>',
      'attribute float aGlow;\nvarying float vGlow;\nvarying vec3 vPropWorld;\nvarying vec3 vPropNormal;',
    );
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <project_vertex>',
      `vGlow = aGlow;
      mat4 propModel = modelMatrix * instanceMatrix;
      vPropWorld = (propModel * vec4(transformed, 1.0)).xyz;
      vPropNormal = normalize(mat3(propModel) * objectNormal);`,
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <common>',
      `varying float vGlow;\nvarying vec3 vPropWorld;\nvarying vec3 vPropNormal;\n${UB_COMMON}\n${UB_STREET_LIGHT}`,
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      `totalEmissiveRadiance += vColor.rgb * vGlow * (0.12 + uNight)
        + diffuseColor.rgb * ubStreetLight(vPropWorld, normalize(vPropNormal));`,
    );
  };
  mat.customProgramCacheKey = () => 'curbside-props';
  return mat;
}

/** Additive light pools and halos, faded in with the night. */
function glowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uNight: worldUniforms.uNight },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        vUv = uv;
        vTint = instanceColor;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = max(1.0 - d, 0.0);
        gl_FragColor = vec4(vTint * (a * a * uNight), 1.0);
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * Lambert material that draws each building from its instance's size and
 * attributes: walls with windows fitted to the corners (lit at night), floor
 * ledges, a parapet cap and, on shop sides, a glazed ground floor with a
 * fascia; roofs by type with parapet rims and inner shadow, fake-pitched tile
 * roofs and ribbed metal (perturbed normals catch the sun), helipads.
 */
function buildingMaterial(): MeshLambertMaterial {
  const mat = new MeshLambertMaterial();
  const uDistWin = {
    value: DISTRICTS.map((d, i) => {
      const s = DISTRICT_STYLES[d];
      return new Vector4(s.floorHeight, s.window[0], s.window[1], i);
    }),
  };
  const uDistGlass = { value: DISTRICTS.map((d) => new Color(DISTRICT_STYLES[d].glass)) };
  mat.onBeforeCompile = (shader) => {
    useWorldUniforms(shader);
    shader.uniforms.uDistWin = uDistWin;
    shader.uniforms.uDistGlass = uDistGlass;
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <common>',
      `attribute vec3 aRoofColor;
      attribute vec4 aInfo;
      varying vec3 vLocal;
      varying vec3 vSize;
      varying vec3 vBN;
      varying vec3 vRoof;
      varying vec4 vInfo;
      varying vec3 vWorldB;`,
    );
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <project_vertex>',
      `vLocal = position;
      vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vBN = normal;
      vRoof = aRoofColor;
      vInfo = aInfo;
      vWorldB = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`,
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <common>',
      `varying vec3 vLocal;
      varying vec3 vSize;
      varying vec3 vBN;
      varying vec3 vRoof;
      varying vec4 vInfo;
      varying vec3 vWorldB;
      uniform vec4 uDistWin[${DISTRICTS.length}];
      uniform vec3 uDistGlass[${DISTRICTS.length}];
      ${UB_COMMON}
      ${UB_STREET_LIGHT}
      ${BUILDING_GLSL}`,
    );
    shader.fragmentShader = replace(
      shader.fragmentShader,
      '#include <color_fragment>',
      `#include <color_fragment>
      vec3 bGlow = vec3(0.0);
      vec3 bNormal = vBN;
      vec3 bl = vLocal * vSize;
      vec3 bd = fwidth(bl);
      float bpx = max(max(bd.x, bd.y), bd.z);
      if (vBN.y > 0.5) roofSurface(diffuseColor.rgb, bGlow, bNormal, bl, bpx);
      else if (vBN.y > -0.5) wallSurface(diffuseColor.rgb, bGlow, bl, bpx);`,
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <normal_fragment_maps>',
      'normal = normalize((viewMatrix * vec4(bNormal, 0.0)).xyz);',
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      'totalEmissiveRadiance += bGlow + diffuseColor.rgb * ubStreetLight(vWorldB, bNormal);',
    );
  };
  mat.customProgramCacheKey = () => 'curbside-buildings';
  return mat;
}

const ROOF = Object.fromEntries(ROOF_TYPES.map((t, i) => [t, `${i}.0`])) as Record<RoofType, string>;
const STYLE = Object.fromEntries(DISTRICTS.map((d, i) => [d, `${i}.0`])) as Record<District, string>;

const BUILDING_GLSL = /* glsl */ `
vec3 bSrgb(float r, float g, float b) { return pow(vec3(r, g, b), vec3(2.2)); }

/** Walls. l = metric local position (x, z centred; y up from the ground). */
void wallSurface(inout vec3 col, inout vec3 glow, vec3 l, float px) {
  vec3 n = vBN;
  bool xFace = abs(n.x) > 0.5;
  float W = xFace ? vSize.z : vSize.x;
  float u = (xFace ? l.z : l.x) + W * 0.5;
  float y = l.y;
  float H = vSize.y;
  int d = int(vInfo.w + 0.5);
  float style = vInfo.w;
  vec4 dw = uDistWin[d];
  float floorH = dw.x;
  int side = n.z < -0.5 ? 0 : (n.x > 0.5 ? 1 : (n.z > 0.5 ? 2 : 3));
  bool shop = ((int(vInfo.z + 0.5) >> side) & 1) == 1;
  float seed = vInfo.y;
  vec3 wallC = col;

  // Weathering: darker toward the ground, faint vertical streaks.
  col *= (0.86 + 0.14 * smoothstep(0.0, 2.5, y)) * (0.94 + 0.09 * ubNoise(vec2(u * 0.7 + seed * 91.0, y * 0.12)));
  if (abs(style - ${STYLE.industrial}) < 0.5) {
    // Corrugated cladding.
    col *= 0.93 + 0.07 * sin(u * 17.95) * (1.0 - smoothstep(0.03, 0.08, px));
  }

  float base = shop ? 3.6 : 0.0;
  float yy = y - base;
  float usable = H - 0.6 - base;
  float rows = max(0.0, floor(usable / floorH + 0.15));
  float fl = floor(yy / floorH);
  float fy = fract(yy / floorH);
  // Columns fitted to the face so windows never get cut at a corner.
  float spacing = floorH * (abs(style - ${STYLE.industrial}) < 0.5 ? 1.6 : 0.85);
  float span = max(W - 0.7, 0.5);
  float cols = max(1.0, floor(span / spacing));
  float cw = span / cols;
  float uc = u - 0.35;
  float ci = floor(uc / cw);
  float fu = fract(uc / cw);
  float inGrid = step(0.0, uc) * step(uc, span) * step(0.0, yy) * step(fl, rows - 1.0);
  float hw = dw.y * 0.5;
  float hh = dw.z * 0.5;
  float cy = abs(style - ${STYLE.industrial}) < 0.5 ? 0.66 : 0.54;
  float winX = ubLine(fu - 0.5, hw, px / cw);
  float winY = ubLine(fy - cy, hh, px / floorH);
  float win = winX * winY * inGrid;

  // Floor ledges with a soft shadow under them.
  float ledgeY = fy * floorH;
  float ledge = ubBand(ledgeY, floorH - 0.14, floorH, px) * step(0.0, yy) * step(yy, usable);
  float under = ubBand(ledgeY, 0.0, 0.22, px) * step(floorH * 0.5, yy) * step(yy, usable + floorH);
  col *= 1.0 - 0.12 * under;
  col = mix(col, wallC * 1.16, ledge);

  if (abs(style - ${STYLE.downtown}) < 0.5) {
    // Curtain wall: glassy spandrels between the window rows.
    col = mix(col, mix(wallC, uDistGlass[d], 0.45) * 0.8, ubBand(fy, cy + hh, 1.0, px / floorH) * inGrid * 0.6);
  }
  if (abs(style - ${STYLE.oldtown}) < 0.5 || abs(style - ${STYLE.residential}) < 0.5) {
    // Light stone sills and lintels.
    float trim = ubLine(fu - 0.5, hw + 0.06, px / cw) * (ubBand(fy, cy - hh - 0.07, cy - hh, px / floorH) + ubBand(fy, cy + hh, cy + hh + 0.05, px / floorH));
    col = mix(col, bSrgb(0.85, 0.82, 0.76), trim * inGrid);
  }

  // Glass: reflects a little sky by day; some windows lit at night.
  float h = ubHash3(vec3(seed * 977.0 + float(side) * 13.0, fl, ci));
  vec3 glass = uDistGlass[d] * (0.55 + 0.7 * smoothstep(cy - hh, cy + hh, fy)) + uSkyTint * 0.035;
  float lit = step(h, 0.1 + 0.32 * uNight);
  vec3 warm = mix(vec3(1.0, 0.56, 0.24), vec3(1.0, 0.8, 0.5), fract(h * 7.0));
  vec3 lamp = fract(h * 13.0) < 0.2 ? vec3(0.5, 0.72, 1.0) : warm;
  float level = 0.35 + 0.65 * fract(h * 31.0);
  col = mix(col, glass, win);
  glow += win * lit * lamp * level * uNight * 0.75;

  // Ground floor.
  if (shop && y < base) {
    float nb = max(1.0, floor(W / 2.6));
    float bw = W / nb;
    float bi = floor(u / bw);
    float bu = fract(u / bw);
    float pane = ubLine(bu - 0.5, 0.43, px / bw) * ubBand(y, 0.35, 2.5, px);
    float door = step(fract(bi * 0.37 + seed * 3.1), 0.28) * ubLine(bu - 0.5, 0.22, px / bw) * ubBand(y, 0.0, 2.3, px);
    float glazed = max(pane, door);
    vec3 shopGlass = mix(bSrgb(0.09, 0.1, 0.11), uSkyTint * 0.22, smoothstep(0.4, 2.5, y) * 0.7);
    col = mix(col * 0.9, shopGlass, glazed);
    float sh = ubHash3(vec3(seed * 311.0, bi, float(side)));
    vec3 shopLight = sh > 0.7 ? vec3(0.8, 0.92, 1.0) : vec3(1.0, 0.74, 0.45);
    glow += glazed * shopLight * (0.25 + 0.75 * step(sh, 0.85)) * uNight * 0.6;
    // Fascia (sign band) and a cornice over the shop.
    vec3 fascia = mix(bSrgb(0.12, 0.13, 0.15), wallC * 0.5, step(0.5, fract(sh * 5.0)));
    col = mix(col, fascia, ubBand(y, 2.7, 3.4, px));
    col = mix(col, wallC * 1.2, ubBand(y, 3.4, 3.6, px));
  } else if (!shop) {
    col *= 1.0 - 0.25 * (1.0 - smoothstep(0.45 - px, 0.45 + px, y)); // plinth
    if (abs(style - ${STYLE.industrial}) < 0.5 && y < 4.0) {
      // Roller doors on the sheds.
      float nd = max(1.0, floor(W / 9.0));
      float du = fract(u / (W / nd)) * (W / nd);
      float doorM = ubBand(du, W / nd * 0.5 - 1.8, W / nd * 0.5 + 1.8, px) * ubBand(y, 0.0, 3.4, px);
      vec3 doorC = bSrgb(0.5, 0.52, 0.53) * (0.9 + 0.1 * sin(y * 40.0) * (1.0 - smoothstep(0.02, 0.05, px)));
      col = mix(col, doorC, doorM);
    }
  }
  // Parapet cap.
  col = mix(col, wallC * 1.2, smoothstep(H - 0.4 - px, H - 0.4 + px, y));
}

/** Roofs by type, with a parapet rim and its shadow (except pitched tiles). */
void roofSurface(inout vec3 col, inout vec3 glow, inout vec3 nW, vec3 l, float px) {
  vec3 wallC = col;
  vec2 rp = l.xz;
  vec2 hs = vSize.xz * 0.5;
  vec2 eD = hs - abs(rp);
  float e = min(eD.x, eD.y);
  float type = vInfo.x;
  float seed = vInfo.y;
  vec2 sp = rp + seed * 173.0;
  bool longX = vSize.x >= vSize.z;
  float along = longX ? rp.x : rp.y;
  float across = longX ? rp.y : rp.x;
  float fine = 1.0 - smoothstep(0.03, 0.09, px);
  vec3 c = vRoof;

  if (type < ${ROOF.tar} + 0.5) {
    float seam = ubLine(fract(across / 0.95) - 0.5, 0.47, px / 0.95);
    c *= (0.9 + 0.18 * ubNoise(sp * 0.5)) * (1.0 - (1.0 - seam) * 0.25 * fine);
    float patchH = ubHash(floor(sp / 3.2));
    c *= patchH > 0.86 ? 0.8 : (patchH < 0.06 ? 1.15 : 1.0);
  } else if (type < ${ROOF.gravel} + 0.5) {
    c *= 0.86 + 0.2 * ubNoise(sp * 0.8) + 0.14 * (ubHash(floor(sp * 14.0)) - 0.5) * fine;
  } else if (type < ${ROOF.metal} + 0.5) {
    // Standing-seam ribs: bend the normal so the sun picks them out.
    float rib = sin(fract(across / 0.55) * 6.2832) * 0.4 * (1.0 - smoothstep(0.04, 0.12, px));
    nW = normalize(vec3(longX ? 0.0 : rib, 1.0, longX ? rib : 0.0));
    c *= 1.0 - 0.3 * (1.0 - ubLine(fract(along / 6.0) - 0.5, 0.49, px / 6.0));
    // Skylights.
    vec2 cell = vec2(floor(along / 6.0), floor(across / 4.0));
    vec2 f = vec2(fract(along / 6.0), fract(across / 4.0)) - 0.5;
    float sky = ubLine(f.x, 0.17, px / 6.0) * ubLine(f.y, 0.22, px / 4.0) * step(0.45, ubHash(cell + seed * 40.0)) * step(1.5, e);
    c = mix(c, bSrgb(0.62, 0.72, 0.78), sky);
    glow += sky * vec3(0.9, 0.95, 1.0) * 0.18 * uNight;
  } else if (type < ${ROOF.garden} + 0.5) {
    // Planted beds, a timber deck down the middle, planter edging.
    vec3 green = c * (0.7 + 0.5 * ubFbm(sp * 0.7));
    vec3 soil = bSrgb(0.3, 0.22, 0.16);
    c = mix(soil, green, smoothstep(0.32, 0.45, ubNoise(sp * 1.6)));
    float deck = ubLine(across, 1.0, px) * step(1.0, e);
    vec3 wood = bSrgb(0.55, 0.38, 0.24) * (0.85 + 0.15 * ubLine(fract(along / 0.16) - 0.5, 0.42, px / 0.16));
    c = mix(c, wood, deck);
    c = mix(c, bSrgb(0.62, 0.6, 0.56), ubBand(e, 0.34, 0.75, px) + ubBand(abs(across), 1.0, 1.2, px) * step(1.0, e));
  } else if (type < ${ROOF.membrane} + 0.5) {
    float seam = ubLine(fract(across / 2.0) - 0.5, 0.49, px / 2.0);
    c *= (0.95 + 0.06 * ubNoise(sp * 0.4)) * (1.0 - (1.0 - seam) * 0.12);
  } else if (type < ${ROOF.terracotta} + 0.5) {
    // Hipped tile roof faked on the flat top: each side slopes toward its eave.
    bool xSide = eD.x < eD.y;
    vec2 toEdge = xSide ? vec2(sign(rp.x), 0.0) : vec2(0.0, sign(rp.y));
    nW = normalize(vec3(toEdge.x * 0.8, 1.0, toEdge.y * 0.8));
    float row = e / 0.34;
    float tileAlong = (xSide ? rp.y : rp.x) / 0.3 + 0.5 * mod(floor(row), 2.0);
    c *= (0.8 + 0.28 * fract(row) * fine + 0.14 * (1.0 - fine)) * (0.9 + 0.16 * ubHash(floor(vec2(row, tileAlong)) + seed * 50.0));
    c = mix(c, c * 1.35, ubLine(eD.x - eD.y, 0.07, px) * step(0.2, e)); // hip ridges
  } else {
    // Helipad: pale concrete deck, a dark landing circle with a yellow ring
    // and a white H (floodlit at night), blinking lights round the edge.
    c *= 0.9 + 0.12 * ubNoise(sp * 0.6);
    float rr = length(rp);
    float R = min(hs.x, hs.y) * 0.72;
    float pad = 1.0 - smoothstep(R + 0.45 - px, R + 0.45 + px, rr);
    c = mix(c, bSrgb(0.19, 0.21, 0.23) * (0.9 + 0.12 * ubNoise(sp * 1.3)), pad);
    float ring = ubLine(rr - R, 0.22, px);
    c = mix(c, bSrgb(0.95, 0.74, 0.12), ring);
    vec2 hp = rp / (R * 0.5);
    float hpx = px / (R * 0.5);
    float hbar = max(ubBand(abs(hp.x), 0.42, 0.66, hpx) * step(abs(hp.y), 0.85), ubLine(hp.y, 0.11, hpx) * step(abs(hp.x), 0.6));
    c = mix(c, bSrgb(0.93, 0.93, 0.9), hbar);
    glow += (ring * vec3(1.0, 0.72, 0.12) + hbar * vec3(0.9) + pad * vec3(0.02, 0.025, 0.035)) * 0.16 * uNight;
    float k = floor(atan(rp.y, rp.x) / 0.7854 + 0.5) * 0.7854;
    float spot = 1.0 - smoothstep(0.12, 0.22, length(rp - (R + 0.95) * vec2(cos(k), sin(k))));
    float blink = 0.35 + 0.65 * step(0.5, fract(uTime * 0.7 + k * 0.1));
    glow += spot * vec3(1.0, 0.3, 0.15) * blink * (0.4 + 2.0 * uNight);
  }

  if (type < ${ROOF.helipad} - 0.5) c *= 0.88 + 0.14 * smoothstep(0.25, 0.75, ubFbm(sp * 0.16)); // water stains
  if (abs(type - ${ROOF.terracotta}) > 0.5) {
    float rim = 1.0 - smoothstep(0.34 - px, 0.34 + px, e);
    float ao = mix(0.6, 1.0, smoothstep(0.34, 1.9, e));
    c = mix(c * ao, wallC * 1.12, rim);
    nW = mix(nW, vec3(0.0, 1.0, 0.0), rim);
  } else {
    c *= mix(0.7, 1.0, smoothstep(0.0, 0.3, e)); // eaves
  }
  col = c;
}
`;
