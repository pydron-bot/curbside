/**
 * W3-D round 3 (streets): pedestrian streets and removed roads. The file
 * format (parse, canonical text, diff), the road rules (both shut to
 * traffic), merged blocks (rectangles only, the outer ring kept, the
 * north-west block's kind and district, everything else as before), the
 * editor's REMOVE and put-back, and the checks.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { checkMapEdits, collectAnchors, blockAt, roadAt } from '../src/game/mapAnchors';
import { describeChange, removeRefusal, roadState, setRoad } from '../src/game/mapEditorState';
import { cornerPoint } from '../src/systems/crowd';
import { blocksBeside, innerRoads, planMerges, removeRoad, restoreRoad } from '../src/world/blockMerge';
import { BLOCK_SIZE, CORE_OFFSET, blockSpan, generateCity, mergedAway, type City } from '../src/world/city';
import { districtAt, districtOf } from '../src/world/districts';
import { dressCity } from '../src/world/dressing';
import { NO_EDITS, diffMapEdits, parseMapEdits, serializeMapEdits, withPedestrianRoad, type MapEdits, type RoadEdit } from '../src/world/mapEdits';
import { generatePickups } from '../src/world/pickups';
import { placeCityRamps } from '../src/world/ramps';
import { RoadRules, STREET_PEDESTRIAN, STREET_REMOVED, STREET_ROAD, roadRules } from '../src/world/roadRules';
import { MAX_NODE, canLeave } from '../src/world/roads';
import { hasSignals, signalPoles } from '../src/world/signals';
import { generateStreetLamps } from '../src/world/streetLamps';
import { segmentValid } from '../src/world/streetSpots';
import { spawnAi } from '../src/systems/traffic';
import { mulberry32 } from '../src/world/random';

afterEach(() => void generateCity(1337));

type N = [number, number];
const ped = (a: N, b: N): RoadEdit => ({ a, b, pedestrian: true });
const gone = (a: N, b: N): RoadEdit => ({ a, b, removed: true });
const edits = (roads: RoadEdit[], more: Partial<MapEdits> = {}): MapEdits => ({ ...NO_EDITS, roads, ...more });
/** A 2×2 merge round crossing (-2, -2). */
const SQUARE = [gone([-2, -3], [-2, -2]), gone([-2, -2], [-2, -1]), gone([-3, -2], [-2, -2]), gone([-2, -2], [-1, -2])];

describe('the file', () => {
  it('reads, writes canonically and diffs pedestrian streets and removed roads', () => {
    const { edits: e, problems } = parseMapEdits({
      version: 2,
      seed: 1337,
      roads: [
        { a: [2, 1], b: [1, 1], pedestrian: true },
        { a: [1, 0], b: [1, -1], removed: true, closed: true },
        { a: [3, 3], b: [3, 4], pedestrian: true, oneWay: true },
      ],
    });
    expect(problems).toEqual(['roads[1]: removed and closed; removed wins', 'roads[2]: pedestrian and oneWay; pedestrian wins']);
    // Smaller crossing first (no direction), one state per entry.
    expect(e.roads).toEqual([gone([1, -1], [1, 0]), ped([1, 1], [2, 1]), ped([3, 3], [3, 4])]);
    const text = serializeMapEdits(e);
    expect(text).toContain('{ "a": [1, 1], "b": [2, 1], "pedestrian": true }');
    expect(text).toContain('{ "a": [1, -1], "b": [1, 0], "removed": true }');
    expect(parseMapEdits(JSON.parse(text)).edits).toEqual(e);
    expect(serializeMapEdits(parseMapEdits(JSON.parse(text)).edits)).toBe(text);
    const diff = diffMapEdits(NO_EDITS, e);
    expect(diff.map(describeChange)).toEqual(['Road 1,-1–1,0: removed (blocks merged)', 'Road 1,1–2,1: pedestrian street', 'Road 3,3–3,4: pedestrian street']);
    expect(withPedestrianRoad(NO_EDITS, [2, 1], [1, 1]).roads).toEqual([ped([1, 1], [2, 1])]);
    expect(withPedestrianRoad(e, [1, 1], [2, 1], false).roads).toHaveLength(2);
  });
});

describe('road rules', () => {
  it('a pedestrian street and a removed road take no traffic; spawns and kerb spots keep off them', () => {
    generateCity(1337, edits([ped([1, 1], [2, 1]), gone([1, -1], [1, 0])]));
    const r = roadRules();
    expect(r.streets).toBe(true);
    expect(canLeave(1, 1, 1)).toBe(false);
    expect(canLeave(2, 1, 3)).toBe(false);
    expect(canLeave(1, -1, 2)).toBe(false);
    expect(r.isClosed(1, 1, 2, 1)).toBe(true);
    expect(r.streetOf(2, 1, 1, 1)).toBe(STREET_PEDESTRIAN);
    expect(r.streetOf(1, 0, 1, -1)).toBe(STREET_REMOVED);
    expect(r.streetOf(0, 0, 1, 0)).toBe(STREET_ROAD);
    expect(r.closed).toEqual([]);
    expect(segmentValid(2, 1, 1)).toBe(false);
    expect(spawnAi(2, 1, 1, 0.5, mulberry32(1))).toBeNull();
    expect(spawnAi(1, 0, 2, 0.5, mulberry32(1))).toBeNull();
    // Junctions at the ends lose that arm: no light faces it; a crossing with two roads left has none.
    for (const p of signalPoles()) {
      expect(Math.abs(p.z - 64) < 9 && p.x > 64 + 9 && p.x < 128 - 9).toBe(false);
    }
  });

  it('a crossing left with fewer than three roads has no lights, and one with none is no crossing', () => {
    // Crossing (3, 3): pedestrian streets north and south, so only two roads.
    generateCity(1337);
    const lit = [...Array(13).keys()].map((i) => i - 6).flatMap((x) => [...Array(13).keys()].map((i) => [x, i - 6] as N)).filter(([x, z]) => hasSignals(x, z));
    const [x, z] = lit[0];
    generateCity(1337, edits([ped([x, z - 1], [x, z]), ped([x, z], [x, z + 1])]));
    expect(hasSignals(x, z)).toBe(false);
    expect(roadRules().crossingStands(x, z)).toBe(true);
    generateCity(1337, edits([ped([x, z - 1], [x, z]), ped([x, z], [x, z + 1]), ped([x - 1, z], [x, z]), ped([x, z], [x + 1, z])]));
    expect(roadRules().crossingStands(x, z)).toBe(false);
  });
});

describe('merged blocks', () => {
  it('merge whole rectangles only, never across the outer ring', () => {
    expect(planMerges([gone([1, -1], [1, 0])], 8).merges).toEqual([{ ix: 0, iz: -1, w: 2, h: 1 }]);
    expect(planMerges(SQUARE, 8).merges).toEqual([{ ix: -3, iz: -3, w: 2, h: 2 }]);
    expect(innerRoads({ ix: -3, iz: -3, w: 2, h: 2 })).toHaveLength(4);
    // An L: three blocks.
    const l = planMerges([gone([1, -1], [1, 0]), gone([0, 0], [1, 0])], 8);
    expect(l.merges).toEqual([]);
    expect(l.refused.map((x) => x.why)).toEqual([expect.stringContaining("don't make a rectangle"), expect.stringContaining("don't make a rectangle")]);
    // A 2×2 with a road left inside.
    const stub = planMerges(SQUARE.slice(0, 3), 8);
    expect(stub.merges).toEqual([]);
    expect(stub.refused[0].why).toContain('-2,-2 – -1,-2');
    // The outer ring.
    expect(blocksBeside([8, 0], [8, 1], 8)).toBeNull();
    expect(planMerges([gone([8, 0], [8, 1])], 8).refused[0].why).toContain('outer ring');
    // A refused removal plays as a closed road.
    const rules = new RoadRules([gone([8, 0], [8, 1])], 8);
    expect(rules.closed).toHaveLength(1);
    expect(rules.isClosed(8, 0, 8, 1)).toBe(true);
    expect(rules.merges).toEqual([]);
  });

  it("the editor's REMOVE merges or refuses, and putting a road back cuts the merge along its line", () => {
    const one = removeRoad(NO_EDITS, [1, -1], [1, 0], MAX_NODE);
    expect('edits' in one && one.edits.roads).toEqual([gone([1, -1], [1, 0])]);
    expect(removeRoad(NO_EDITS, [8, 0], [8, 1], MAX_NODE)).toEqual({ refused: expect.stringContaining('outer ring') });
    // 2×1 beside a single block above one of its halves: an L.
    const e1 = (one as { edits: MapEdits }).edits;
    expect(removeRoad(e1, [0, -1], [1, -1], MAX_NODE)).toEqual({ refused: expect.stringContaining('L-shaped') });
    expect(removeRefusal(e1, [0, -1], [1, -1])).toContain('L-shaped');
    // Two 2×1s stacked: removing between them makes the 2×2 and takes the last inner road with it.
    let e = setRoad(NO_EDITS, [-2, -3], [-2, -2], 'removed');
    e = setRoad(e, [-2, -2], [-2, -1], 'removed');
    e = setRoad(e, [-3, -2], [-2, -2], 'removed');
    expect(new RoadRules(e.roads, MAX_NODE).merges).toEqual([{ ix: -3, iz: -3, w: 2, h: 2 }]);
    expect(e.roads).toHaveLength(4);
    expect(roadState(e, [-2, -2], [-1, -2]).mode).toBe('removed');
    // Back to open: the merge is cut along that whole line, two 2×1s (side by side) left.
    const back = setRoad(e, [-2, -2], [-1, -2], 'open');
    expect(new RoadRules(back.roads, MAX_NODE).merges).toEqual([{ ix: -3, iz: -3, w: 2, h: 1 }, { ix: -3, iz: -2, w: 2, h: 1 }]);
    // Or made a pedestrian street.
    const paved = setRoad(e, [-2, -3], [-2, -2], 'pedestrian');
    expect(roadState(paved, [-2, -3], [-2, -2]).mode).toBe('pedestrian');
    expect(roadState(paved, [-2, -2], [-2, -1]).mode).toBe('open');
    expect(new RoadRules(paved.roads, MAX_NODE).merges).toEqual([{ ix: -3, iz: -3, w: 1, h: 2 }, { ix: -2, iz: -3, w: 1, h: 2 }]);
    expect(restoreRoad(NO_EDITS, [0, 0], [1, 0], MAX_NODE)).toEqual(NO_EDITS);
  });

  it('build one block across the merge, the north-west block deciding, and nothing else changes', () => {
    const plain = generateCity(1337);
    const plainBuildings = new Set(plain.buildings.map((b) => JSON.stringify(b)));
    const plainTrees = new Set(plain.trees.map((t) => JSON.stringify(t)));
    const plainDistricts = plain.blocks.map((b) => districtOf(b.bx, b.bz));
    for (const roads of [[gone([1, -1], [1, 0])], SQUARE]) {
      const city = generateCity(1337, edits(roads));
      const merge = roadRules().merges[0];
      const lead = city.blocks.find((b) => b.bx === merge.ix + MAX_NODE && b.bz === merge.iz + MAX_NODE)!;
      const members = city.blocks.filter((b) => b.merge);
      expect(members).toHaveLength(merge.w * merge.h);
      const plainLead = plain.blocks.find((b) => b.bx === lead.bx && b.bz === lead.bz)!;
      for (const b of members) {
        expect(b.kind).toBe(plainLead.kind);
        expect(b.district).toBe(plainLead.district);
        expect(b.interior).toEqual({ minX: merge.ix * BLOCK_SIZE + 11, minZ: merge.iz * BLOCK_SIZE + 11, maxX: (merge.ix + merge.w) * BLOCK_SIZE - 11, maxZ: (merge.iz + merge.h) * BLOCK_SIZE - 11 });
        expect(districtOf(b.bx, b.bz)).toBe(plainLead.district);
        expect(mergedAway(b)).toBe(b !== lead);
        expect(blockSpan(b.bx, b.bz)).toEqual({ bx: lead.bx, bz: lead.bz, w: merge.w, h: merge.h });
      }
      // On the old road's centreline: the merge's district.
      expect(districtAt((merge.ix + 1) * BLOCK_SIZE, (merge.iz + 0.5) * BLOCK_SIZE)).toBe(plainLead.district);
      const inMerge = (x: number, z: number) => x > merge.ix * BLOCK_SIZE && x < (merge.ix + merge.w) * BLOCK_SIZE && z > merge.iz * BLOCK_SIZE && z < (merge.iz + merge.h) * BLOCK_SIZE;
      // Everything outside it exactly as before; inside, new content (buildings across the old road if it's built up).
      const outsideB = city.buildings.filter((b) => !inMerge((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2));
      expect(outsideB.every((b) => plainBuildings.has(JSON.stringify(b)))).toBe(true);
      expect(outsideB.length).toBe(plain.buildings.filter((b) => !inMerge((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)).length);
      expect(city.trees.filter((t) => !inMerge(t.x, t.z)).every((t) => plainTrees.has(JSON.stringify(t)))).toBe(true);
      city.blocks.forEach((b, i) => {
        if (!b.merge) expect(districtOf(b.bx, b.bz)).toBe(plainDistricts[i]);
      });
      if (lead.kind === 'buildings') {
        const x = (merge.ix + 1) * BLOCK_SIZE;
        expect(city.buildings.some((b) => b.minX < x && b.maxX > x && inMerge(b.minX, b.minZ))).toBe(true);
      }
    }
  });

  it('the dressing, lamps and paths see one block', () => {
    const map = edits([gone([1, -1], [1, 0]), ped([1, 1], [2, 1])]);
    const city = generateCity(1337, map);
    const d = dressCity(city, generatePickups(1337), placeCityRamps(1337, map));
    const inside = (x: number, z: number) => x > 11 && x < 117 && z > -53 && z < -11;
    expect(generateStreetLamps().filter((l) => inside(l.x, l.z))).toEqual([]);
    expect(d.street.props.filter((p) => p.kind === 'streetlamp' && inside(p.x, p.z))).toEqual([]);
    // No kerb furniture, bus stop or cart left on the removed road's old pavements.
    expect(d.street.props.filter((p) => Math.abs(p.x - 64) < 11 && p.z > -50 && p.z < -14 && p.kind !== 'tree_round' && p.kind !== 'tree_tall' && p.kind !== 'palm' && p.kind !== 'dumpster')).toEqual([]);
    // Bollards across both ends of the pedestrian street, dressing down it.
    const onPed = d.street.props.filter((p) => Math.abs(p.z - 64) < 8 && p.x > 70 && p.x < 122);
    expect(onPed.filter((p) => p.kind === 'bollard')).toHaveLength(18);
    expect(onPed.filter((p) => p.kind !== 'bollard').length).toBeGreaterThan(2);
    // People walk round the merge, not into the old road.
    expect(cornerPoint(8, 7, 0)).toEqual({ x: 9.5, z: -54.5 });
    expect(cornerPoint(9, 7, 1)).toEqual({ x: 118.5, z: -54.5 });
    expect(cornerPoint(8, 7, 2)).toEqual({ x: 118.5, z: -9.5 });
    // The inventory: a point on the old road is the merge's block, not a road.
    expect(roadAt(64, -32)).toBeNull();
    expect(blockAt(64, -32)).toEqual({ bx: 8, bz: 7 });
    expect(blockAt(100, -20)).toEqual({ bx: 8, bz: 7 });
    expect(roadAt(96, 64)).toEqual({ kind: 'segment', a: [1, 1], b: [2, 1] });
  });

  it('come out the same at any size from the same file (core blocks)', () => {
    const e = edits(SQUARE);
    const city = generateCity(1337, e);
    const lead = city.blocks.find((b) => b.merge && !mergedAway(b))!;
    expect([lead.bx - CORE_OFFSET, lead.bz - CORE_OFFSET]).toEqual([5, 5]);
  });
});

describe('checks', () => {
  function check(map: MapEdits): { city: City; problems: ReturnType<typeof checkMapEdits> } {
    const city = generateCity(1337, map);
    const ramps = placeCityRamps(1337, map);
    const d = dressCity(city, generatePickups(1337), ramps);
    const anchors = collectAnchors(city, { ramps, busStops: d.street.busStops, edits: map });
    return { city, problems: checkMapEdits(city, map, anchors, { street: d.street }) };
  }

  it('the committed map and a clean merge and pedestrian street pass; crossings with no road left are no problem', () => {
    // Somewhere no course, route or spot uses: the far south-west.
    const quiet = edits([gone([-7, 6], [-7, 7]), ped([-6, 6], [-6, 7]), ped([-6, 7], [-5, 7])]);
    const { problems } = check(quiet);
    expect(problems.filter((p) => p.id.startsWith('road') || p.id === 'roads')).toEqual([]);
  });

  it('flags a refused removal, a course down a pedestrian street or a removed road, and a spot on a removed road', () => {
    const { problems } = check(edits([gone([0, -1], [1, -1]), gone([1, -1], [1, 0]), gone([8, 0], [8, 1])]));
    const text = problems.map((p) => p.problem);
    expect(text.some((t) => t.includes("can't be removed") && t.includes('outer ring'))).toBe(true);
    // (0, -1)–(1, -1) and (1, -1)–(1, 0) join three blocks in an L.
    expect(text.filter((t) => t.includes("don't make a rectangle"))).toHaveLength(2);
    // Races: find a course leg and pave it.
    const base = check(NO_EDITS);
    const anyCourse = collectAnchors(base.city, { ramps: placeCityRamps(1337, NO_EDITS), busStops: [] }).find((a) => a.route)!;
    const [p, q] = [anyCourse.route![0], anyCourse.route![1]];
    const step: N = [p[0] + Math.sign(q[0] - p[0]), p[1] + Math.sign(q[1] - p[1])];
    const paved = check(edits([ped([p[0], p[1]], step)]));
    expect(paved.problems.some((x) => x.id === anyCourse.id && x.problem.includes('pedestrian street'))).toBe(true);
    const blockEdit = check(edits([gone([1, -1], [1, 0])], { blocks: [{ at: [9 - CORE_OFFSET, 7 - CORE_OFFSET], kind: 'park' }] }));
    expect(blockEdit.problems.some((x) => x.problem.includes('part of the merged block'))).toBe(true);
  });
});
