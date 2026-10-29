import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  type BufferGeometry,
  type Material,
} from 'three';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, type City, type Rect } from './city';

/** Blocks per render chunk along each axis (4 → 256 m chunks, 16 chunks). */
const CHUNK_BLOCKS = 4;
const CHUNK_SIZE = CHUNK_BLOCKS * BLOCK_SIZE;
const CHUNKS_PER_SIDE = BLOCKS_PER_SIDE / CHUNK_BLOCKS;

/**
 * Turns a City into a handful of instanced meshes per chunk. Each chunk's
 * meshes get their own bounding sphere so three.js frustum-culls whole chunks;
 * a typical view draws a few chunks at ~5 draw calls each.
 */
export function createCityMesh(city: City): Group {
  const root = new Group();
  root.name = 'city';

  const buildingGeo = unitBox({ topShade: 1.0, sideShade: 0.78 });
  const roofBoxGeo = unitBox({ topShade: 0.95, sideShade: 0.7 });
  const slabGeo = unitBox({ topShade: 1, sideShade: 1 });
  const canopyGeo = new IcosahedronGeometry(1, 0).translate(0, 0, 0);
  const trunkGeo = new CylinderGeometry(0.18, 0.24, 1, 6).translate(0, 0.5, 0);

  const buildingMat = windowedMaterial();
  const plainMat = new MeshLambertMaterial({ vertexColors: true });
  const canopyMat = new MeshLambertMaterial({ flatShading: true });
  const trunkMat = new MeshLambertMaterial({ color: '#5a4030' });

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
  for (const b of city.buildings) {
    const c = chunkFor((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
    c.add('buildings', boxMatrix(b, 0, b.height), buildingColor(b.tint, color));
    if (b.roofBox) {
      c.add('roofBoxes', boxMatrix(b.roofBox, b.height, b.roofBox.height), color.set('#8d8a84'));
    }
  }
  for (const blk of city.blocks) {
    if (blk.kind !== 'park') continue;
    const i = blk.interior;
    const c = chunkFor((i.minX + i.maxX) / 2, (i.minZ + i.maxZ) / 2);
    c.add('slabs', boxMatrix(i, 0, 0.06), color.set('#3f6a34'));
  }
  for (const t of city.trees) {
    const c = chunkFor(t.x, t.z);
    const h = 2.4 + t.radius * 0.6;
    c.add('trunks', new Matrix4().makeScale(1, h, 1).setPosition(t.x, 0, t.z), color.set('#ffffff'));
    const m = new Matrix4().makeScale(t.radius, t.radius * 0.8, t.radius).setPosition(t.x, h + t.radius * 0.4, t.z);
    c.add('canopies', m, color.setHSL(0.27 + ((t.x * 7.1 + t.z) % 1) * 0.06, 0.45, 0.3));
  }

  const parts: Record<PartName, [BufferGeometry, Material]> = {
    buildings: [buildingGeo, buildingMat],
    roofBoxes: [roofBoxGeo, plainMat],
    slabs: [slabGeo, plainMat],
    trunks: [trunkGeo, trunkMat],
    canopies: [canopyGeo, canopyMat],
  };
  for (const c of chunks.values()) root.add(c.build(parts));

  root.add(boundaryWallMesh(city, slabGeo, plainMat));
  return root;
}

type PartName = 'buildings' | 'roofBoxes' | 'slabs' | 'trunks' | 'canopies';

class ChunkBuilder {
  private parts = new Map<PartName, { matrices: Matrix4[]; colors: Color[] }>();
  constructor(private readonly name: string) {}

  add(part: PartName, m: Matrix4, c: Color) {
    let p = this.parts.get(part);
    if (!p) this.parts.set(part, (p = { matrices: [], colors: [] }));
    p.matrices.push(m);
    p.colors.push(c.clone());
  }

  build(defs: Record<PartName, [BufferGeometry, Material]>): Group {
    const g = new Group();
    g.name = this.name;
    for (const [part, { matrices, colors }] of this.parts) {
      const [geo, mat] = defs[part];
      const mesh = new InstancedMesh(geo, mat, matrices.length);
      matrices.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, colors[i]);
      });
      mesh.computeBoundingSphere(); // covers all instances → per-chunk culling
      mesh.name = `${this.name}_${part}`;
      g.add(mesh);
    }
    return g;
  }
}

function clampChunk(c: number) {
  return Math.max(0, Math.min(CHUNKS_PER_SIDE - 1, c));
}

/** Matrix placing a unit box (base at y=0) over `r`, from y0 up `height`. */
function boxMatrix(r: Rect, y0: number, height: number): Matrix4 {
  return new Matrix4()
    .makeScale(r.maxX - r.minX, height, r.maxZ - r.minZ)
    .setPosition((r.minX + r.maxX) / 2, y0, (r.minZ + r.maxZ) / 2);
}

/** Unit box with its base at y=0 and baked per-face shading in vertex colours. */
function unitBox({ topShade, sideShade }: { topShade: number; sideShade: number }): BoxGeometry {
  const geo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const normals = geo.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const ny = normals.getY(i);
    const s = ny > 0.5 ? topShade : ny < -0.5 ? 0.5 : sideShade;
    colors.set([s, s, s], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

const PALETTE = ['#9b8a74', '#8a6e5c', '#7d8790', '#a59d8f', '#6f6a66', '#94785e', '#b0a48c', '#7a6f80'];

function buildingColor(tint: number, out: Color): Color {
  out.set(PALETTE[Math.floor(tint * PALETTE.length) % PALETTE.length]);
  return out.offsetHSL(0, 0, (tint * 13.7) % 0.08 - 0.04);
}

/**
 * Lambert material that paints a window grid on walls from world position,
 * so windows stay evenly sized whatever the building's dimensions.
 */
function windowedMaterial(): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vUbWorld;\nvarying vec3 vUbNormal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vUbWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vUbNormal = normal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vUbWorld;\nvarying vec3 vUbNormal;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (abs(vUbNormal.y) < 0.5) {
          float along = abs(vUbNormal.x) > 0.5 ? vUbWorld.z : vUbWorld.x;
          float fy = fract(vUbWorld.y / 3.0);
          float fx = fract(along / 2.6);
          float win = step(0.38, fy) * step(fy, 0.82) * step(0.22, fx) * step(fx, 0.78) * step(1.2, vUbWorld.y);
          float lit = step(0.82, fract(sin(dot(floor(vec2(along / 2.6, vUbWorld.y / 3.0)), vec2(12.9898, 78.233))) * 43758.5453));
          vec3 glass = mix(vec3(0.13, 0.16, 0.21), vec3(0.85, 0.74, 0.45), lit);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.9);
        }`,
      );
  };
  return mat;
}

function boundaryWallMesh(city: City, geo: BufferGeometry, mat: Material): InstancedMesh {
  const walls = city.obstacles.slice(-4);
  const mesh = new InstancedMesh(geo, mat, walls.length);
  const c = new Color('#8f8c86');
  walls.forEach((w, i) => {
    mesh.setMatrixAt(i, boxMatrix(w, 0, 1.4));
    mesh.setColorAt(i, c);
  });
  mesh.name = 'boundary';
  return mesh;
}
