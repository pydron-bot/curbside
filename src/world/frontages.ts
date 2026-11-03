/**
 * What stands against the shopfronts: café tables with umbrellas outside
 * shops with no awning (an awning would hide them from above; most in the
 * old town and the arts quarter), vending machines and ATMs at the ends of
 * shop windows. All on the building side of the pavement, clear of the
 * line people walk. Pure data from the city seed and the building plans
 * (world/buildingPlans.ts), via streetProps.ts.
 */
import { buildingStream, type BuildingPlan, type Side } from './buildingPlans';
import { BLOCK_SIZE, type City } from './city';
import type { District } from './districts';
import { WALK_LINE, type Placer } from './kerbs';

/** Chance of café tables outside a shop with no awning, by district. */
const CAFE: Readonly<Record<District, number>> = { oldtown: 0.3, arts: 0.3, downtown: 0.22, residential: 0.1, industrial: 0 };
const VENDING = 0.05;
const ATM: Readonly<Record<District, number>> = { downtown: 0.08, oldtown: 0.03, arts: 0.03, residential: 0.03, industrial: 0.02 };
const VENDING_COLOURS = ['#c82a2a', '#2a5cc8', '#2f9a4a', '#e07a1a'];
/** How far out from the wall each stands (its middle), and its half-depth, m. */
const OUT = { cafe_table: [0.7, 0.4], vending_machine: [0.45, 0.4], atm: [0.35, 0.3] } as const;
/** Café umbrellas' `paint` quarters: one fixed red for now (the other two quarters are cream). */
const CAFE_RED = '#b8322e';

/** Each building from its own stream (buildingStream), so a map edit elsewhere doesn't move its tables. */
export function placeFrontages(city: City, plans: readonly BuildingPlan[], placer: Placer): void {
  city.buildings.forEach((b, i) => {
    const rand = buildingStream(b, city.seed, 0xcafe);
    for (const shop of plans[i].shopfronts) {
      const cafe = shop.awning === null && rand() < CAFE[b.district];
      const vending = rand() < VENDING * (b.district === 'industrial' ? 2 : 1);
      const atm = rand() < ATM[b.district];
      const tint = VENDING_COLOURS[Math.floor(rand() * VENDING_COLOURS.length)];
      const width = shop.to - shop.from;
      const mid = (shop.from + shop.to) / 2;
      const at = (kind: keyof typeof OUT, u: number, tintHex?: string) => {
        const [out, depth] = OUT[kind];
        const p = facePoint(b, shop.side, u, out);
        // Off the walking line by more than a person's width.
        if (fromCentreline(p.x, p.z) - depth < WALK_LINE + 0.4) return;
        if (!placer.clear(p.x, p.z, kind === 'cafe_table' ? 0.85 : 0.55)) return;
        placer.put(kind, p.x, p.z, FACING[shop.side], 1, 0, tintHex);
      };
      if (cafe) {
        if (width >= 5) {
          at('cafe_table', mid - 1.1, CAFE_RED);
          at('cafe_table', mid + 1.1, CAFE_RED);
        } else at('cafe_table', mid, CAFE_RED);
      }
      if (vending && width >= 3) at('vending_machine', shop.from + 0.7, tint);
      if (atm && width >= 3) at('atm', shop.to - 0.6);
    }
  });
}

/** Heading out of each face: north (−Z), east, south, west. */
const FACING: Readonly<Record<Side, number>> = { 0: Math.PI, 1: Math.PI / 2, 2: 0, 3: -Math.PI / 2 };

/** A point `out` m in front of face `side` of building b, `u` along it (world x for N/S faces, z for E/W). */
function facePoint(b: { minX: number; minZ: number; maxX: number; maxZ: number }, side: Side, u: number, out: number): { x: number; z: number } {
  switch (side) {
    case 0:
      return { x: u, z: b.minZ - out };
    case 1:
      return { x: b.maxX + out, z: u };
    case 2:
      return { x: u, z: b.maxZ + out };
    default:
      return { x: b.minX - out, z: u };
  }
}

/** Distance from the nearest road centreline, m. */
function fromCentreline(x: number, z: number): number {
  const dx = Math.abs(x - Math.round(x / BLOCK_SIZE) * BLOCK_SIZE);
  const dz = Math.abs(z - Math.round(z / BLOCK_SIZE) * BLOCK_SIZE);
  return Math.min(dx, dz);
}
