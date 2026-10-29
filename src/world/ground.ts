import { CanvasTexture, Mesh, MeshLambertMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace } from 'three';
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK } from './city';

/** Ground extends one block past the city on every side (under the ring road and walls). */
const GROUND_SIZE = 2 * HALF_EXTENT + 2 * BLOCK_SIZE;

/**
 * The ground plane: one painted 64 m block tile, repeated so roads land on
 * multiples of BLOCK_SIZE (GROUND_SIZE is a whole number of blocks and the
 * plane is centred, so the tiling stays aligned with the city layout).
 */
export function createGround(): Mesh {
  const tex = new CanvasTexture(paintBlockTile(512));
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(GROUND_SIZE / BLOCK_SIZE, GROUND_SIZE / BLOCK_SIZE);
  tex.anisotropy = 4;

  const ground = new Mesh(new PlaneGeometry(GROUND_SIZE, GROUND_SIZE), new MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  return ground;
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
  const walk = SIDEWALK * m;

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
