/**
 * The city's districts: where each one is, how tall it builds and what it
 * looks like. Pure data (no three.js) so the generator, the renderers and the
 * tests all agree. Districts are big, readable regions — a glassy downtown in
 * the middle, a brick old town, a neon arts quarter, the docks/industrial
 * yards and pastel suburbs — so the map has landmarks and you can tell where
 * you are from a glance at the roofs and pavements.
 */
import { BLOCKS_PER_SIDE } from './city';

export type District = 'downtown' | 'oldtown' | 'arts' | 'industrial' | 'residential';

/** Index order used by shaders (block data texture, per-building attributes). */
export const DISTRICTS: readonly District[] = ['downtown', 'oldtown', 'arts', 'industrial', 'residential'];

export type RoofType = 'tar' | 'gravel' | 'metal' | 'garden' | 'membrane' | 'terracotta' | 'helipad';
/** Index order used by the building shader. */
export const ROOF_TYPES: readonly RoofType[] = ['tar', 'gravel', 'metal', 'garden', 'membrane', 'terracotta', 'helipad'];

/** Sidewalk paving, drawn by the ground shader. */
export type Paving = 'granite' | 'brick' | 'tiles' | 'concrete' | 'verge';
export const PAVINGS: readonly Paving[] = ['granite', 'brick', 'tiles', 'concrete', 'verge'];

export interface DistrictStyle {
  /** Wall colours (sRGB hex), picked by building tint. */
  walls: readonly string[];
  /** Roof types and their weights. */
  roofs: ReadonlyArray<readonly [RoofType, number]>;
  /** Storey height, m (window rows). */
  floorHeight: number;
  /** Height = base + r1·span1 + r2·span2 (r1, r2 uniform 0..1), capped at MAX_HEIGHT. */
  height: readonly [number, number, number];
  /** Share of street-facing buildings with a shopfront (glass band + awnings). */
  shops: number;
  /** Share of shopfronts with neon at night. */
  neon: number;
  /** Window width and height as fractions of a window cell. */
  window: readonly [number, number];
  /** Window glass tint (sRGB hex) by day. */
  glass: string;
  paving: Paving;
  /** Awning colours (sRGB hex). */
  awnings: readonly string[];
}

/** Buildings never exceed this, so roofs stay well under the on-foot camera (20 m). */
export const MAX_HEIGHT = 12;

export const DISTRICT_STYLES: Readonly<Record<District, DistrictStyle>> = {
  // Glass and steel: cool blues and teals, the tallest blocks, helipads.
  downtown: {
    walls: ['#5d7894', '#4f8a96', '#7f96ad', '#a9b8c6', '#3e5a78', '#6c7f8f', '#8aa7b8', '#c4cbd3'],
    roofs: [
      ['membrane', 3],
      ['gravel', 3],
      ['tar', 2],
      ['garden', 1.2],
      ['metal', 1],
    ],
    floorHeight: 3.2,
    height: [6.5, 3.5, 2],
    shops: 0.55,
    neon: 0.25,
    window: [0.82, 0.68],
    glass: '#3c5f7e',
    paving: 'granite',
    awnings: ['#1f3b57', '#2b6f75', '#c9a227', '#7d2632'],
  },
  // Brick and terracotta, three-storey walk-ups, water tanks on the roofs.
  oldtown: {
    walls: ['#a2493a', '#b5653f', '#8c3f33', '#c98a55', '#d3b07a', '#9a5a3c', '#b8483a', '#c7a07a'],
    roofs: [
      ['tar', 3],
      ['gravel', 2],
      ['terracotta', 2],
      ['garden', 1],
    ],
    floorHeight: 3,
    height: [4.6, 2.6, 1.2],
    shops: 0.75,
    neon: 0.2,
    window: [0.42, 0.58],
    glass: '#2d3a48',
    paving: 'brick',
    awnings: ['#2f6b3f', '#a3262a', '#1d3f6e', '#d48a1e', '#6b2a5a'],
  },
  // Painted render in loud colours, bars and clubs: neon at night.
  arts: {
    walls: ['#c2457a', '#e07a3b', '#3aa6a0', '#7a4fc0', '#e0b33a', '#2f8fd0', '#d9d0c3', '#4bb06a'],
    roofs: [
      ['tar', 3],
      ['membrane', 2],
      ['garden', 1.5],
      ['gravel', 1.5],
    ],
    floorHeight: 3.1,
    height: [5, 3.6, 2.2],
    shops: 0.85,
    neon: 0.7,
    window: [0.55, 0.6],
    glass: '#2b3646',
    paving: 'tiles',
    awnings: ['#e8327a', '#18b3c0', '#f2c32e', '#7d3cd8', '#f06b2a'],
  },
  // Docks and yards: big low sheds in grey, rust and hazard yellow.
  industrial: {
    walls: ['#7c8085', '#8e6b52', '#96999c', '#5f6a63', '#b39a5a', '#6e7378', '#a3793f', '#59606b'],
    roofs: [
      ['metal', 4],
      ['tar', 2],
      ['gravel', 1.5],
    ],
    floorHeight: 4.2,
    height: [4, 2.6, 1.4],
    shops: 0.1,
    neon: 0,
    window: [0.7, 0.32],
    glass: '#40505c',
    paving: 'concrete',
    awnings: ['#d4a81c', '#3d4a52'],
  },
  // Pastel houses and low apartments, grass verges, tiled roofs.
  residential: {
    walls: ['#e7c6a5', '#a9d3c0', '#c8b8e0', '#f0dd9a', '#a8c7e6', '#e8a99a', '#d8d2c2', '#b7d69a'],
    roofs: [
      ['terracotta', 4],
      ['gravel', 1.5],
      ['garden', 1.2],
      ['tar', 1],
    ],
    floorHeight: 2.9,
    height: [3.6, 2, 0.8],
    shops: 0.18,
    neon: 0.1,
    window: [0.4, 0.5],
    glass: '#34465a',
    paving: 'verge',
    awnings: ['#2f6fa8', '#c8452f', '#3f8a52'],
  },
};

/** Downtown: blocks within this many blocks of the centre. */
const DOWNTOWN_RADIUS = 3.1;

/**
 * District of block (bx, bz). Downtown is the middle of town; the rest is
 * split into quarters (NW old town, NE arts, SE industrial, SW residential)
 * with gently wavy borders so they don't read as a ruled grid.
 */
export function districtOf(bx: number, bz: number): District {
  // (Read at call time: city.ts imports this module, so its constants aren't ready at load.)
  const centre = (BLOCKS_PER_SIDE - 1) / 2;
  const dx = bx - centre;
  const dz = bz - centre;
  if (Math.hypot(dx, dz) < DOWNTOWN_RADIUS) return 'downtown';
  // Wobble the quarter borders by up to a block, depending on how far out you are.
  const wx = dx + Math.sin(bz * 0.9 + 1.3) * 0.9;
  const wz = dz + Math.sin(bx * 0.8 + 0.4) * 0.9;
  if (wz < 0) return wx < 0 ? 'oldtown' : 'arts';
  return wx < 0 ? 'residential' : 'industrial';
}

/** Building height for a district from two uniform random numbers. */
export function buildingHeight(district: District, r1: number, r2: number): number {
  const [base, s1, s2] = DISTRICT_STYLES[district].height;
  return Math.min(MAX_HEIGHT, base + r1 * s1 + r2 * s2);
}

/** Pick from weighted options with u in [0, 1). */
export function pickWeighted<T>(options: ReadonlyArray<readonly [T, number]>, u: number): T {
  let total = 0;
  for (const [, w] of options) total += w;
  let r = u * total;
  for (const [v, w] of options) if ((r -= w) < 0) return v;
  return options[options.length - 1][0];
}
