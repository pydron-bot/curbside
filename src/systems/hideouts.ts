/**
 * Places to lie low (heat.md, LYING LOW): the city's car parks and its
 * alleys, the narrow gaps between two buildings of a block. Built once from
 * the city data (the same car parks the ground draws, the same gaps the
 * dumpsters stand in), then looked up by position every step through a grid
 * of block-sized cells, without allocating. Pure: no three.js.
 */
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, isCarPark, lotBytes, type Building, type City, type Rect } from '../world/city';

export type HideoutKind = 'carPark' | 'alley';

export interface Hideout extends Rect {
  kind: HideoutKind;
}

/** A gap between two buildings this wide is an alley, m (a road is 16, a pavement 3)... */
export const ALLEY_MIN = 2.5;
export const ALLEY_MAX = 6;
/** ...if they face each other along at least this much of it, m. */
export const ALLEY_LENGTH = 8;

export class Hideouts {
  readonly list: Hideout[] = [];
  /** Per block-sized cell, the hideouts that overlap it. */
  private readonly cells: Hideout[][] = [];

  constructor(city: City) {
    for (let i = 0; i < BLOCKS_PER_SIDE * BLOCKS_PER_SIDE; i++) this.cells.push([]);
    const bytes = lotBytes(city);
    for (let i = 0; i < city.blocks.length; i++) {
      // A merged car park: every block in it carries the whole interior, so one is enough.
      const b = city.blocks[i];
      if (!isCarPark(city, bytes, i)) continue;
      if (b.merge && (b.merge.bx !== b.bx || b.merge.bz !== b.bz)) continue;
      this.add({ ...b.interior, kind: 'carPark' });
    }
    for (const r of alleys(city.buildings)) this.add({ ...r, kind: 'alley' });
  }

  /** The hideout at (x, z), or null. */
  at(x: number, z: number): Hideout | null {
    const cx = Math.floor((x + HALF_EXTENT) / BLOCK_SIZE);
    const cz = Math.floor((z + HALF_EXTENT) / BLOCK_SIZE);
    if (cx < 0 || cz < 0 || cx >= BLOCKS_PER_SIDE || cz >= BLOCKS_PER_SIDE) return null;
    const cell = this.cells[cx * BLOCKS_PER_SIDE + cz];
    for (let i = 0; i < cell.length; i++) {
      const h = cell[i];
      if (x >= h.minX && x <= h.maxX && z >= h.minZ && z <= h.maxZ) return h;
    }
    return null;
  }

  private add(h: Hideout): void {
    this.list.push(h);
    const x0 = Math.max(0, Math.floor((h.minX + HALF_EXTENT) / BLOCK_SIZE));
    const x1 = Math.min(BLOCKS_PER_SIDE - 1, Math.floor((h.maxX + HALF_EXTENT) / BLOCK_SIZE));
    const z0 = Math.max(0, Math.floor((h.minZ + HALF_EXTENT) / BLOCK_SIZE));
    const z1 = Math.min(BLOCKS_PER_SIDE - 1, Math.floor((h.maxZ + HALF_EXTENT) / BLOCK_SIZE));
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) this.cells[cx * BLOCKS_PER_SIDE + cz].push(h);
  }
}

/**
 * The alleys: for each pair of buildings in a block standing ALLEY_MIN to
 * ALLEY_MAX apart along a shared stretch of at least ALLEY_LENGTH, the gap
 * between them.
 */
export function alleys(buildings: readonly Building[]): Rect[] {
  const byCell = new Map<number, Building[]>();
  for (const b of buildings) {
    const cx = Math.floor(((b.minX + b.maxX) / 2 + HALF_EXTENT) / BLOCK_SIZE);
    const cz = Math.floor(((b.minZ + b.maxZ) / 2 + HALF_EXTENT) / BLOCK_SIZE);
    const key = cx * BLOCKS_PER_SIDE + cz;
    let list = byCell.get(key);
    if (!list) byCell.set(key, (list = []));
    list.push(b);
  }
  const out: Rect[] = [];
  for (const list of byCell.values()) {
    // Open ground only: a third building standing in the gap makes it no alley.
    const open = (r: Rect) => !list.some((c) => c.minX < r.maxX && c.maxX > r.minX && c.minZ < r.maxZ && c.maxZ > r.minZ);
    for (const a of list) {
      for (const b of list) {
        if (a === b) continue;
        // Running along z: b to the east of a.
        const gapX = b.minX - a.maxX;
        const z0 = Math.max(a.minZ, b.minZ);
        const z1 = Math.min(a.maxZ, b.maxZ);
        if (gapX >= ALLEY_MIN && gapX <= ALLEY_MAX && z1 - z0 >= ALLEY_LENGTH) {
          const r = { minX: a.maxX, maxX: b.minX, minZ: z0, maxZ: z1 };
          if (open(r)) out.push(r);
        }
        // Running along x: b to the south of a.
        const gapZ = b.minZ - a.maxZ;
        const x0 = Math.max(a.minX, b.minX);
        const x1 = Math.min(a.maxX, b.maxX);
        if (gapZ >= ALLEY_MIN && gapZ <= ALLEY_MAX && x1 - x0 >= ALLEY_LENGTH) {
          const r = { minX: x0, maxX: x1, minZ: a.maxZ, maxZ: b.minZ };
          if (open(r)) out.push(r);
        }
      }
    }
  }
  return out;
}
