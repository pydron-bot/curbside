/**
 * W3-D: everything tied to a place (game/mapAnchors.ts), what relies on a
 * block, road or junction, and the checks a map edit must pass. The
 * committed map must break nothing, so a map that breaks a job can't ship.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { blockAt, checkAnchors, collectAnchors, dependentsOf, districtBlockAt, roadAt, routeNodes, type Anchor } from '../src/game/mapAnchors';
import { CORE_OFFSET, generateCity } from '../src/world/city';
import { dressCity } from '../src/world/dressing';
import { generatePickups } from '../src/world/pickups';
import { placeKickers, placeRamps } from '../src/world/ramps';
import { SHIPPED_MAP } from '../src/world/shippedMap';

afterEach(() => void generateCity(1337));

function shipped() {
  const city = generateCity(1337, SHIPPED_MAP);
  const big = placeRamps(1337);
  const ramps = [...big, ...placeKickers(1337, big)];
  const busStops = dressCity(city, generatePickups(1337), ramps).street.busStops;
  return { city, anchors: collectAnchors(city, { ramps, busStops }) };
}

describe('the anchors of the shipped city', () => {
  const { city, anchors } = shipped();

  it('lists every kind of hand-placed thing, each once', () => {
    const groups = new Set(anchors.map((a) => a.group));
    for (const g of ['safehouse', 'payphone', 'frenzy', 'docks', 'spray', 'station', 'hospital', 'story', 'hangout', 'race', 'ramp', 'busStop']) {
      expect(groups, g).toContain(g);
    }
    expect(new Set(anchors.map((a) => a.id)).size).toBe(anchors.length);
    // Story jobs' spots are found by walking the jobs: spawns, targets, mayhem areas, routes.
    expect(anchors.filter((a) => a.group === 'story').length).toBeGreaterThan(40);
    expect(anchors.find((a) => a.label === 'QUIETEST CITY: coach route')?.via?.length).toBeGreaterThan(3);
    expect(anchors.some((a) => a.district === 'oldtown')).toBe(true);
  });

  it('breaks nothing with the committed map', () => {
    expect(checkAnchors(city, anchors)).toEqual([]);
  });

  it('answers what relies on a block, a road and a junction', () => {
    const safehouse = anchors.find((a) => a.id === 'safehouse')!;
    const b = blockAt(safehouse.points[0].x, safehouse.points[0].z)!;
    expect(dependentsOf(anchors, { kind: 'block', ...b }).map((a) => a.id)).toContain('safehouse');
    // RING ROAD RUN goes up the east ring road (node x 8).
    expect(dependentsOf(anchors, { kind: 'segment', a: [8, 1], b: [8, 0] }).map((a) => a.id)).toContain('race-ring');
    expect(dependentsOf(anchors, { kind: 'segment', a: [7, 0], b: [7, 1] }).map((a) => a.id)).not.toContain('race-ring');
    // The coach steers for (-4, -4) on its tour; DOWNTOWN DASH starts at (0, -1).
    expect(dependentsOf(anchors, { kind: 'junction', ix: -4, iz: -4 }).map((a) => a.label)).toContain('QUIETEST CITY: coach route');
    expect(dependentsOf(anchors, { kind: 'junction', ix: 0, iz: -1 }).map((a) => a.id)).toContain('race-downtown');
    // Every kerbside car is on a road segment, so closing it would show.
    const parked = anchors.filter((a) => a.group === 'story' && a.points.length === 1 && roadAt(a.points[0].x, a.points[0].z)?.kind === 'segment');
    expect(parked.length).toBeGreaterThan(5);
  });
});

describe('what an edit breaks', () => {
  it('a job written for a district its spot is no longer in', () => {
    const { anchors } = shipped();
    const noise = anchors.find((a) => a.district === 'oldtown')!;
    // On the road: the district is the block to its south-east's, and repainting that block is what breaks it.
    const b = districtBlockAt(noise.points[0].x, noise.points[0].z);
    expect(dependentsOf(anchors, { kind: 'block', ...b }).map((a) => a.id)).toContain(noise.id);
    const city = generateCity(1337, { version: 1, seed: 1337, blocks: [{ at: [b.bx - CORE_OFFSET, b.bz - CORE_OFFSET], district: 'arts' }] });
    const problems = checkAnchors(city, collectAnchors(city));
    expect(problems.map((p) => p.id)).toContain(noise.id);
    expect(problems.find((p) => p.id === noise.id)!.problem).toBe('written for oldtown, but its spot is in arts');
  });

  it('a spot inside a building, a route off the roads or off the map', () => {
    const plain = generateCity(1337);
    const park = plain.blocks.find((b) => b.kind === 'park')!;
    const mid = { x: (park.interior.minX + park.interior.maxX) / 2, z: (park.interior.minZ + park.interior.maxZ) / 2 };
    const spots: Anchor[] = [
      { id: 'bench', group: 'story', label: 'bench', points: [mid] },
      { id: 'zigzag', group: 'race', label: 'zigzag', points: [], route: [[0, 0], [2, 1]] },
      { id: 'far', group: 'story', label: 'far', points: [], via: [[0, 0], [40, 0]] },
    ];
    expect(checkAnchors(plain, spots).map((p) => p.id)).toEqual(['zigzag', 'far']);
    const built = generateCity(1337, { version: 1, seed: 1337, blocks: [{ at: [park.bx - CORE_OFFSET, park.bz - CORE_OFFSET], kind: 'buildings' }] });
    const covered = built.buildings.some((b) => mid.x > b.minX && mid.x < b.maxX && mid.z > b.minZ && mid.z < b.maxZ);
    expect(checkAnchors(built, spots).some((p) => p.id === 'bench')).toBe(covered);
  });
});

describe('where a point is', () => {
  it('on a block, a segment or a junction', () => {
    expect(roadAt(0, 0)).toEqual({ kind: 'junction', ix: 0, iz: 0 });
    expect(roadAt(5.5, 30)).toEqual({ kind: 'segment', a: [0, 0], b: [0, 1] });
    expect(roadAt(-30, 64 + 3)).toEqual({ kind: 'segment', a: [-1, 1], b: [0, 1] });
    expect(roadAt(20, 20)).toBeNull();
    expect(blockAt(5.5, 30)).toBeNull();
    expect(blockAt(20, 20)).toEqual({ bx: 8 + CORE_OFFSET, bz: 8 + CORE_OFFSET });
    expect(routeNodes([[0, 0], [0, 2], [1, 2]])).toEqual([[0, 0], [0, 1], [0, 2], [1, 2]]);
    expect(routeNodes([[0, 0], [1, 1]])).toBeNull();
  });
});
