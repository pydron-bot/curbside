/**
 * Places in front of the shops: under each awning (where people shelter
 * from the rain) and under each neon tube (where they hang about at
 * night). From the same building plans the city mesh draws the awnings
 * from (buildingPlans.ts, seeded per building), so the spots line up with
 * what's on screen. Pure, tested in tests/shopSpots.test.ts.
 */
import { AWNING_DEPTH, planBuildings, type BuildingPlan, type Side } from './buildingPlans';
import type { City } from './city';
import type { District } from './districts';

export interface ShopSpot {
  /** Under the middle of the awning, a step out from the wall. */
  x: number;
  z: number;
  /** Outward from the shop (toward the road), unit. */
  outX: number;
  outZ: number;
  /** Along the shop front, unit (for standing side by side). */
  alongX: number;
  alongZ: number;
  /** Half the awning's width, m. */
  half: number;
  /** A neon tube along the awning (lit at night). */
  neon: boolean;
  district: District;
}

const OUT: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** How far out from the wall people stand under an awning (at its drip line, so they still show from above), m. */
export const SHELTER_OUT = AWNING_DEPTH * 0.85;

/** Every awning's spot in the city (`plans` from planBuildings: pass the look's to save working them out again). */
export function shopSpots(city: City, plans: readonly BuildingPlan[] = planBuildings(city)): ShopSpot[] {
  const out: ShopSpot[] = [];
  city.buildings.forEach((b, i) => {
    for (const s of plans[i].shopfronts) {
      if (!s.awning) continue;
      const side: Side = s.side;
      const [ox, oz] = OUT[side];
      const alongX = side === 0 || side === 2;
      const face = side === 0 ? b.minZ : side === 1 ? b.maxX : side === 2 ? b.maxZ : b.minX;
      const mid = (s.from + s.to) / 2;
      out.push({
        x: alongX ? mid : face + ox * SHELTER_OUT,
        z: alongX ? face + oz * SHELTER_OUT : mid,
        outX: ox,
        outZ: oz,
        alongX: alongX ? 1 : 0,
        alongZ: alongX ? 0 : 1,
        half: (s.to - s.from) / 2,
        neon: s.neon !== null,
        district: b.district,
      });
    }
  });
  return out;
}

/**
 * A grid of spot indices by 64 m cell, so nearby spots are found without
 * scanning the city (thousands of shopfronts).
 */
export class SpotGrid {
  private readonly cells = new Map<number, number[]>();

  constructor(
    readonly spots: readonly ShopSpot[],
    private readonly cell = 64,
  ) {
    spots.forEach((s, i) => {
      const k = this.key(Math.floor(s.x / cell), Math.floor(s.z / cell));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(i);
    });
  }

  /**
   * The nearest spot to (x, z) within `range` that `ok(index)` accepts, or
   * -1. Scans the cells round (x, z) only.
   */
  nearest(x: number, z: number, range: number, ok: (i: number) => boolean): number {
    const c = this.cell;
    const r = Math.ceil(range / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    let best = -1;
    let bestD = range * range;
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cz - r; j <= cz + r; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const k of list) {
          const s = this.spots[k];
          const d = (s.x - x) ** 2 + (s.z - z) ** 2;
          if (d < bestD && ok(k)) {
            bestD = d;
            best = k;
          }
        }
      }
    }
    return best;
  }

  private key(i: number, j: number): number {
    return ((i + 1024) << 11) | (j + 1024);
  }
}

/**
 * Is (x, z) on the pavement in front of `s` (within `along` m of it along
 * the shop front and no more than `out` m out from it)? A walker there can
 * walk straight in under the awning without cutting a corner of the block.
 */
export function inFrontOf(s: ShopSpot, x: number, z: number, along: number, out = 4): boolean {
  const dx = x - s.x;
  const dz = z - s.z;
  const o = dx * s.outX + dz * s.outZ;
  const a = dx * s.alongX + dz * s.alongZ;
  return o > -0.5 && o < out && Math.abs(a) < along;
}
