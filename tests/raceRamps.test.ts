import { describe, expect, it } from 'vitest';
import { RACES, legDir, nodeX, nodeZ } from '../src/game/modes/races';
import { ROAD_WIDTH } from '../src/world/city';
import { placeKickers, placeRamps, rampSolids, type Ramp } from '../src/world/ramps';

// The city's ramps and kickers, as main.ts places them.
const big = placeRamps(1337);
const ramps = [...big, ...placeKickers(1337, big)];
const solids = rampSolids(ramps);

type Node = readonly [number, number];

/** Ramps and kickers whose solid part is on the road from a to b. */
function rampsOnLeg(a: Node, b: Node): Ramp[] {
  const minX = Math.min(nodeX(a), nodeX(b)) - ROAD_WIDTH / 2;
  const maxX = Math.max(nodeX(a), nodeX(b)) + ROAD_WIDTH / 2;
  const minZ = Math.min(nodeZ(a), nodeZ(b)) - ROAD_WIDTH / 2;
  const maxZ = Math.max(nodeZ(a), nodeZ(b)) + ROAD_WIDTH / 2;
  return ramps.filter((_, i) => {
    const s = solids[i];
    return s.maxX > minX && s.minX < maxX && s.maxZ > minZ && s.minZ < maxZ;
  });
}

describe('races: ramps on the courses', () => {
  it('finds a ramp facing against travel (the old Old Town leg up x = -6)', () => {
    const hits = rampsOnLeg([-6, -3], [-6, -6]);
    expect(hits.some((r) => r.dir !== legDir([-6, -3], [-6, -6]))).toBe(true);
  });

  it('no leg meets the solid back or side of a ramp or kicker', () => {
    const bad: string[] = [];
    for (const r of RACES) {
      for (let i = 1; i < r.nodes.length; i++) {
        const d = legDir(r.nodes[i - 1], r.nodes[i]);
        for (const q of rampsOnLeg(r.nodes[i - 1], r.nodes[i])) {
          if (q.dir !== d) bad.push(`${r.id} leg ${i}: ${q.kind} at (${q.x}, ${q.z})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
