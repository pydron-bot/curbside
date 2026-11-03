/**
 * Searchlights on downtown's tallest roofs (pure; tests/searchlights.test.ts):
 * a few, spread well apart, each a lamp on the roof that sweeps a long beam
 * back and forth over the streets at night (render/look.ts draws the beams,
 * world/cityMesh.ts the lamp housing).
 */
import type { BuildingPlan } from './buildingPlans';
import type { Building } from './city';

export interface Searchlight {
  /** The lamp, on the roof. */
  x: number;
  y: number;
  z: number;
  /** The heading it sweeps about (0 = +Z), and its phase in the sweep. */
  heading: number;
  phase: number;
}

/** At most this many, at least this far apart (m), on roofs at least this tall. */
const MAX = 6;
const APART = 110;
const MIN_HEIGHT = 9.5;

export function planSearchlights(buildings: readonly Building[], plans: readonly BuildingPlan[]): Searchlight[] {
  const tall = buildings
    .map((b, i) => ({ b, plan: plans[i] }))
    .filter(({ b }) => b.district === 'downtown' && b.height >= MIN_HEIGHT)
    .sort((a, b) => b.b.height - a.b.height || a.b.minX - b.b.minX || a.b.minZ - b.b.minZ);
  const out: Searchlight[] = [];
  for (const { b, plan } of tall) {
    if (out.length >= MAX) break;
    const x = (b.minX + b.maxX) / 2;
    const z = (b.minZ + b.maxZ) / 2;
    if (out.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < APART * APART)) continue;
    // Toward the city's middle-ish, off the building's own seed so neighbours differ.
    const heading = Math.atan2(-x, -z) + (plan.seed - 0.5) * 1.6;
    out.push({ x, y: b.height + 1.2, z, heading, phase: plan.seed * Math.PI * 2 });
  }
  return out;
}

/** Where a searchlight points at time t (s): a slow sweep either side of its heading. */
export function searchlightHeading(s: Searchlight, t: number): number {
  return s.heading + 1.1 * Math.sin(t * 0.27 + s.phase);
}
