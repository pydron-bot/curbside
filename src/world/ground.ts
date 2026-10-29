import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

/**
 * M1 placeholder world: an endless-looking ground with a painted road grid
 * (8 m tiles, blocks every 64 m) and some non-colliding boxes for speed
 * reference. M2 replaces this with the generated city and collision.
 */
export const BLOCK_SIZE = 64;
const ROAD_WIDTH = 16;
const WORLD_SIZE = 1024;

export function createGround(): Group {
  const group = new Group();

  const tex = new CanvasTexture(paintBlockTile(512));
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(WORLD_SIZE / BLOCK_SIZE, WORLD_SIZE / BLOCK_SIZE);
  tex.anisotropy = 4;

  const ground = new Mesh(new PlaneGeometry(WORLD_SIZE, WORLD_SIZE), new MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  group.add(createPlaceholderBuildings());
  return group;
}

/**
 * One 64 m block: road band along two edges (so tiling yields a grid),
 * lane markings, sidewalks and a grassy/concrete lot in the middle.
 * Texture coordinate (0,0) maps to a block corner on a road centreline.
 */
function paintBlockTile(px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  const m = px / BLOCK_SIZE; // pixels per metre
  const half = (ROAD_WIDTH / 2) * m;
  const walk = 3 * m;

  // Lot
  g.fillStyle = '#4a5a3c';
  g.fillRect(0, 0, px, px);
  // Sidewalk ring inside the roads
  g.fillStyle = '#8c8a84';
  g.fillRect(half, half, px - 2 * half, walk);
  g.fillRect(half, px - half - walk, px - 2 * half, walk);
  g.fillRect(half, half, walk, px - 2 * half);
  g.fillRect(px - half - walk, half, walk, px - 2 * half);
  // Inner lot: concrete pad
  g.fillStyle = '#5e5d58';
  const inset = half + walk + 2 * m;
  g.fillRect(inset, inset, px - 2 * inset, px - 2 * inset);

  // Roads: centred on the tile edges, so draw half-width bands on all four sides.
  g.fillStyle = '#2b2c30';
  g.fillRect(0, 0, px, half);
  g.fillRect(0, px - half, px, half);
  g.fillRect(0, 0, half, px);
  g.fillRect(px - half, 0, half, px);

  // Dashed centre lines along the edges (half a line on each side of the seam).
  g.fillStyle = '#d9c25a';
  const dash = 3 * m;
  const gap = 3 * m;
  const lw = 0.15 * m;
  for (let p = half + gap; p < px - half - dash; p += dash + gap) {
    g.fillRect(p, 0, dash, lw);
    g.fillRect(p, px - lw, dash, lw);
    g.fillRect(0, p, lw, dash);
    g.fillRect(px - lw, p, lw, dash);
  }

  // Crosswalks on every approach to every corner intersection. Each tile only
  // owns half of each road, so stripes are mirrored on all four edges and the
  // neighbouring tile completes them.
  g.fillStyle = '#d8d8d2';
  const stripeW = 0.6 * m;
  const stripeLen = 2.5 * m;
  const from = half + 0.8 * m; // just outside the intersection box
  for (let o = stripeW / 2; o + stripeW <= half; o += 2 * stripeW) {
    for (const along of [from, px - from - stripeLen]) {
      for (const across of [o, px - o - stripeW]) {
        g.fillRect(along, across, stripeLen, stripeW); // across horizontal roads
        g.fillRect(across, along, stripeW, stripeLen); // across vertical roads
      }
    }
  }
  return c;
}

function createPlaceholderBuildings(): InstancedMesh {
  const perSide = WORLD_SIZE / BLOCK_SIZE;
  const count = perSide * perSide;
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(), count);
  const m = new Matrix4();
  const color = new Color();
  const rand = mulberry32(1337);
  let i = 0;
  for (let bx = 0; bx < perSide; bx++) {
    for (let bz = 0; bz < perSide; bz++) {
      // Block centre: tiles are offset so roads sit on multiples of BLOCK_SIZE.
      const cx = -WORLD_SIZE / 2 + bx * BLOCK_SIZE + BLOCK_SIZE / 2;
      const cz = -WORLD_SIZE / 2 + bz * BLOCK_SIZE + BLOCK_SIZE / 2;
      if (Math.hypot(cx, cz) < BLOCK_SIZE) continue; // keep the spawn area open
      const size = BLOCK_SIZE - ROAD_WIDTH - 10;
      const w = size * (0.5 + rand() * 0.5);
      const d = size * (0.5 + rand() * 0.5);
      const h = 6 + rand() * 30;
      m.makeScale(w, h, d).setPosition(cx, h / 2, cz);
      mesh.setMatrixAt(i, m);
      color.setHSL(0.08 + rand() * 0.1, 0.12, 0.35 + rand() * 0.25);
      mesh.setColorAt(i, color);
      i++;
    }
  }
  mesh.count = i;
  return mesh;
}

/** Small seeded PRNG so the placeholder city is stable between reloads. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
