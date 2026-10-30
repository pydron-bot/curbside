/**
 * The whole city drawn once into an offscreen canvas for the radar: asphalt,
 * sidewalks, building footprints tinted by district, parks with trees,
 * plazas, and the boundary wall. The radar then just copies the part around
 * the player each redraw, so the city costs nothing per frame.
 */
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, SIDEWALK, WORLD_LIMIT, type City } from '../world/city';

/** Map resolution: about native for a ~100 px radar at 2x showing ±60 m. */
export const MAP_PX_PER_M = 1.5;
/** Dark ground drawn beyond the walls, m. */
export const MAP_MARGIN = 30;
/** Half the map's extent in metres (it's centred on the world origin). */
export const MAP_EXTENT = WORLD_LIMIT + MAP_MARGIN;

const ASPHALT = '#262932';
const LANE = 'rgba(255, 214, 92, 0.22)';
const SIDEWALK_COL = '#4b4f5b';
const LOT = '#31343d';
const PARK = '#2c5a37';
const TREE = '#20442a';
const PLAZA = '#6a6153';
const OUTSIDE = '#090b10';
const WALL = '#11131a';

/** District hue for a point: a downtown core and four quadrants, so each part of town reads differently. */
export function districtHue(x: number, z: number): number {
  if (Math.hypot(x, z) < HALF_EXTENT * 0.32) return 285; // downtown: violet
  if (x >= 0) return z < 0 ? 185 : 215; // NE teal, SE blue
  return z < 0 ? 32 : 345; // NW amber, SW rose
}

export function renderCityMap(city: City, pxPerM = MAP_PX_PER_M): HTMLCanvasElement {
  const size = Math.ceil(MAP_EXTENT * 2 * pxPerM);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = OUTSIDE;
  ctx.fillRect(0, 0, size, size);
  // World metres from here on: (x, z) → canvas (x, z), origin at the centre.
  ctx.setTransform(pxPerM, 0, 0, pxPerM, MAP_EXTENT * pxPerM, MAP_EXTENT * pxPerM);

  const L = WORLD_LIMIT;
  ctx.fillStyle = ASPHALT;
  ctx.fillRect(-L, -L, 2 * L, 2 * L);

  // Faint centre lines on every road, for a sense of the grid when zoomed out.
  ctx.strokeStyle = LANE;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i <= BLOCKS_PER_SIDE; i++) {
    const c = -HALF_EXTENT + i * BLOCK_SIZE;
    ctx.moveTo(c, -HALF_EXTENT);
    ctx.lineTo(c, HALF_EXTENT);
    ctx.moveTo(-HALF_EXTENT, c);
    ctx.lineTo(HALF_EXTENT, c);
  }
  ctx.stroke();

  for (const b of city.blocks) {
    const r = b.interior;
    ctx.fillStyle = SIDEWALK_COL;
    ctx.fillRect(r.minX - SIDEWALK, r.minZ - SIDEWALK, r.maxX - r.minX + 2 * SIDEWALK, r.maxZ - r.minZ + 2 * SIDEWALK);
    ctx.fillStyle = b.kind === 'park' ? PARK : b.kind === 'plaza' ? PLAZA : LOT;
    ctx.fillRect(r.minX, r.minZ, r.maxX - r.minX, r.maxZ - r.minZ);
  }

  for (const bd of city.buildings) {
    const cx = (bd.minX + bd.maxX) / 2;
    const cz = (bd.minZ + bd.maxZ) / 2;
    const hue = districtHue(cx, cz);
    // Taller buildings read lighter, like roofs catching the sun; the
    // district shows as a gentle tint, not a colour wash.
    const light = 36 + Math.min(1, bd.height / 12) * 14 + bd.tint * 6;
    ctx.fillStyle = `hsl(${hue} 13% ${light.toFixed(0)}%)`;
    ctx.fillRect(bd.minX, bd.minZ, bd.maxX - bd.minX, bd.maxZ - bd.minZ);
    ctx.strokeStyle = `hsl(${hue} 22% ${(light + 14).toFixed(0)}%)`;
    ctx.lineWidth = 0.6;
    ctx.strokeRect(bd.minX + 0.3, bd.minZ + 0.3, bd.maxX - bd.minX - 0.6, bd.maxZ - bd.minZ - 0.6);
  }

  ctx.fillStyle = TREE;
  for (const t of city.trees) {
    ctx.beginPath();
    ctx.arc(t.x, t.z, t.radius * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = WALL;
  ctx.lineWidth = 3;
  ctx.strokeRect(-L - 1.5, -L - 1.5, 2 * L + 3, 2 * L + 3);
  return canvas;
}
