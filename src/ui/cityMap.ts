/**
 * The whole city drawn once into an offscreen canvas for the radar: asphalt,
 * sidewalks, building footprints tinted by district, parks with trees,
 * plazas, the boundary wall, and the map edits' road rules (W3-D: a closed
 * road dimmed and hatched, a one-way with arrows). The radar then just copies the part around
 * the player each redraw, so the city costs nothing per frame.
 */
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, WORLD_LIMIT, type City } from '../world/city';
import type { District } from '../world/districts';
import type { RoadEdit } from '../world/mapEdits';
import { RoadRules } from '../world/roadRules';

/** Dark ground drawn beyond the walls, m. */
export const MAP_MARGIN = 30;
/** Half the map's extent in metres (it's centred on the world origin). */
export const MAP_EXTENT = WORLD_LIMIT + MAP_MARGIN;
/** The map canvas's side is kept to this, px (a bigger city, W3-A, draws a little coarser rather than a 40 MB canvas). */
const MAP_MAX_PX = 2048;
/** Map resolution: about native for a ~100 px radar at 2x showing ±60 m (1.5 for the core city). */
export const MAP_PX_PER_M = Math.min(1.5, MAP_MAX_PX / (2 * MAP_EXTENT));

const ASPHALT = '#211f30';
const LANE = 'rgba(255, 46, 136, 0.26)';
const SIDEWALK_COL = '#4a4560';
const LOT = '#2d2a3c';
const PARK = '#2c5a37';
const TREE = '#20442a';
const PLAZA = '#6a6153';
/** Waste ground (a map-edited empty lot). */
const WASTE = '#4a4236';
const OUTSIDE = '#090b10';
const WALL = '#11131a';

/** Radar hue per district (the city's own, wobbly borders and all), so each part of town reads differently. */
export const DISTRICT_HUE: Readonly<Record<District, number>> = {
  downtown: 285, // violet
  arts: 185, // NE teal
  industrial: 215, // SE blue
  oldtown: 32, // NW amber
  residential: 345, // SW rose
};

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
    ctx.fillStyle = b.kind === 'park' ? PARK : b.kind === 'plaza' ? PLAZA : b.kind === 'lot' ? WASTE : LOT;
    ctx.fillRect(r.minX, r.minZ, r.maxX - r.minX, r.maxZ - r.minZ);
  }

  for (const bd of city.buildings) {
    const hue = DISTRICT_HUE[bd.district];
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

  // The road rules as the game plays them (a removal that can't apply is a closure; an applied one is land, under the blocks above).
  const rules = new RoadRules(city.edits?.roads ?? [], BLOCKS_PER_SIDE / 2);
  for (const r of [...rules.closed, ...rules.oneWay]) drawRoadRule(ctx, r);
  for (const r of rules.pedestrian) drawPedestrianStreet(ctx, r);
  // A crossing with no road left (pedestrian streets all round): paved.
  if (rules.streets) {
    const n = BLOCKS_PER_SIDE / 2;
    ctx.fillStyle = PEDESTRIAN;
    for (let ix = -n; ix <= n; ix++) {
      for (let iz = -n; iz <= n; iz++) if (!rules.crossingStands(ix, iz)) ctx.fillRect(ix * BLOCK_SIZE - ROAD_WIDTH / 2, iz * BLOCK_SIZE - ROAD_WIDTH / 2, ROAD_WIDTH, ROAD_WIDTH);
    }
  }

  ctx.strokeStyle = WALL;
  ctx.lineWidth = 3;
  ctx.strokeRect(-L - 1.5, -L - 1.5, 2 * L + 3, 2 * L + 3);
  return canvas;
}

const CLOSED = 'rgba(9, 11, 16, 0.6)';
const CLOSED_HATCH = 'rgba(232, 92, 72, 0.75)';
const ONE_WAY = 'rgba(240, 240, 240, 0.7)';
/** A pedestrian street (round 3): paved, a pale line down the middle, bollards across the ends. */
const PEDESTRIAN = '#57506c';
const PEDESTRIAN_LINE = 'rgba(214, 206, 236, 0.45)';

function drawPedestrianStreet(ctx: CanvasRenderingContext2D, r: RoadEdit): void {
  const ax = r.a[0] * BLOCK_SIZE;
  const az = r.a[1] * BLOCK_SIZE;
  const vx = Math.sign(r.b[0] - r.a[0]);
  const vz = Math.sign(r.b[1] - r.a[1]);
  const half = ROAD_WIDTH / 2;
  const len = BLOCK_SIZE - ROAD_WIDTH;
  const at = (along: number, across: number): [number, number] => [ax + vx * (half + along) - vz * across, az + vz * (half + along) + vx * across];
  const [x0, z0] = at(0, -half);
  const [x1, z1] = at(len, half);
  ctx.fillStyle = PEDESTRIAN;
  ctx.fillRect(Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0));
  ctx.strokeStyle = PEDESTRIAN_LINE;
  ctx.lineWidth = 0.8;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(...at(2, 0));
  ctx.lineTo(...at(len - 2, 0));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const t of [1.6, len - 1.6]) {
    // Bollards across the end, with the gap in the middle.
    for (const [a, b] of [[-half + 1, -1.2], [1.2, half - 1]]) {
      ctx.moveTo(...at(t, a));
      ctx.lineTo(...at(t, b));
    }
  }
  ctx.stroke();
}

/** One-way arrows this far apart along the road, m. */
const ARROW_EVERY = 16;

/** A closed road (dimmed, hatched across) or a one-way (arrows a → b), between the junction boxes. */
function drawRoadRule(ctx: CanvasRenderingContext2D, r: RoadEdit): void {
  const ax = r.a[0] * BLOCK_SIZE;
  const az = r.a[1] * BLOCK_SIZE;
  const vx = Math.sign(r.b[0] - r.a[0]);
  const vz = Math.sign(r.b[1] - r.a[1]);
  const half = ROAD_WIDTH / 2;
  const len = BLOCK_SIZE - ROAD_WIDTH;
  // Along the road from the end of a's junction box; across it, -half..half.
  const at = (along: number, across: number): [number, number] => [ax + vx * (half + along) - vz * across, az + vz * (half + along) + vx * across];
  if (r.closed) {
    const [x0, z0] = at(0, -half);
    const [x1, z1] = at(len, half);
    const box: [number, number, number, number] = [Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0)];
    ctx.fillStyle = CLOSED;
    ctx.fillRect(...box);
    ctx.save();
    ctx.beginPath();
    ctx.rect(...box);
    ctx.clip();
    ctx.strokeStyle = CLOSED_HATCH;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let t = -ROAD_WIDTH; t < len; t += 6) {
      ctx.moveTo(...at(t, -half));
      ctx.lineTo(...at(t + ROAD_WIDTH, half));
    }
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.fillStyle = ONE_WAY;
  for (let t = ARROW_EVERY / 2; t < len; t += ARROW_EVERY) {
    ctx.beginPath();
    ctx.moveTo(...at(t + 3, 0));
    ctx.lineTo(...at(t - 2, -2.6));
    ctx.lineTo(...at(t - 2, 2.6));
    ctx.closePath();
    ctx.fill();
  }
}
