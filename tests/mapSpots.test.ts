/**
 * W3-D round 3: payphones added and jobs moved onto them, custom frenzies,
 * story spots, landmarks and pickups as map edits: the file format, the
 * game applying them, the checks and the editor's tools.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { checkMapEdits, collectAnchors, newSpotId, spotRules, type Anchor } from '../src/game/mapAnchors';
import { checkRound3, landmarkBlocks, landmarkFit, phoneJobs, storyRule } from '../src/game/mapSpots';
import { FRENZIES, customFrenzy, frenzyList } from '../src/game/modes/frenzies';
import { FRENZY_LIMITS, frenzySpecProblems, frenzyTitle } from '../src/game/modes/frenzyLimits';
import { corePavement, placeDocks, placeFrenzyTokens, placePayphones, placeSafehouse } from '../src/game/modes/places';
import { hostKey } from '../src/game/sceneHosts';
import { defaultSave, pruneSave } from '../src/game/progressSave';
import { completionParts } from '../src/game/progressStats';
import {
  buildPreview,
  describeChange,
  moveLandmark,
  moveStoryHandle,
  placeSpot,
  setFrenzy,
  setJobPhone,
  setPickupKind,
  storyHandles,
} from '../src/game/mapEditorState';
import { buildMissions } from '../src/systems/missionsData';
import { editMissions as editMissionsOf, storySpots } from '../src/systems/storyEdits';
import { CORE_OFFSET, generateCity, type City } from '../src/world/city';
import { dressCity } from '../src/world/dressing';
import { placeSprayShops, placeStation } from '../src/world/landmarks';
import {
  NO_EDITS,
  PICKUP_ITEMS,
  diffMapEdits,
  parseMapEdits,
  revertChange,
  serializeMapEdits,
  withJobPhone,
  withLandmark,
  withStorySpotEdit,
  type MapEdits,
  type SpotEdit,
} from '../src/world/mapEdits';
import { PICKUP_KINDS, generatePickups, placePickups } from '../src/world/pickups';
import { placeCityRamps } from '../src/world/ramps';
import { placeHospital } from '../src/world/streetSpots';

afterEach(() => void generateCity(1337));

const edits = (e: Partial<MapEdits>): MapEdits => ({ ...NO_EDITS, ...e });

function built(map: MapEdits) {
  const city = generateCity(1337, map);
  const ramps = placeCityRamps(1337, map);
  const d = dressCity(city, placePickups(1337, map), ramps);
  const anchors = collectAnchors(city, { ramps, busStops: d.street.busStops, edits: map });
  return { city, d, anchors, problems: checkMapEdits(city, map, anchors, { street: d.street }) };
}
/** Points on the pavement round the spawn corner's block (clear of buildings and roads), to 0.1 m. */
const pave = (t: number) => {
  const p = corePavement(7, 7, 2, t);
  return { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 };
};
const about = (problems: ReadonlyArray<{ id: string; problem: string }>, id: string) => problems.filter((p) => p.id === id).map((p) => p.problem);
const blockOf = (city: City, a: Anchor) => {
  const p = a.points[0];
  return city.blocks.find((b) => p.x >= b.interior.minX - 9 && p.x <= b.interior.maxX + 9 && p.z >= b.interior.minZ - 9 && p.z <= b.interior.maxZ + 9)!;
};

describe('the file: new fields and sections', () => {
  const map = edits({
    spots: [
      { id: 'fz-0', add: 'frenzy', x: 10, z: 41, frenzy: { goal: 'wreck', target: 8, seconds: 90, gift: 'rocket' } },
      { id: 'phone-0', add: 'phone', x: -20, z: 41 },
      { id: 'pickup-59', add: 'pickup', x: 5, z: 41, pickup: 'shotgun' },
      { id: 'story:m6-midnight/steps.2.nodes', nodes: [[1, 2], [1, 3], [2, 3]] },
      { id: 'story:m4-parcels/steps.0.points', points: [[1, 2], [3, 4], [5, 6]] },
    ],
    jobs: [
      { id: 's3-quiet', phone: 'phone-0' },
      { id: 's2-noise', phone: 'phone-arts' },
    ],
    landmarks: [{ id: 'station', at: [3, 4] }],
  });

  it('round-trips canonically: sections sorted, keys in order, frenzies and pickups with their spots', () => {
    const text = serializeMapEdits(map);
    expect(text).toContain(
      '"spots": [\n    { "id": "fz-0", "add": "frenzy", "x": 10, "z": 41, "frenzy": { "goal": "wreck", "target": 8, "seconds": 90, "gift": "rocket" } },\n    { "id": "phone-0", "add": "phone", "x": -20, "z": 41 },\n    { "id": "pickup-59", "add": "pickup", "x": 5, "z": 41, "pickup": "shotgun" },\n    { "id": "story:m4-parcels/steps.0.points", "points": [[1, 2], [3, 4], [5, 6]] },\n    { "id": "story:m6-midnight/steps.2.nodes", "nodes": [[1, 2], [1, 3], [2, 3]] }\n  ]',
    );
    expect(text).toContain('"jobs": [\n    { "id": "s2-noise", "phone": "phone-arts" },\n    { "id": "s3-quiet", "phone": "phone-0" }\n  ],\n  "landmarks": [\n    { "id": "station", "at": [3, 4] }\n  ]\n}\n');
    const back = parseMapEdits(JSON.parse(text));
    expect(back.problems).toEqual([]);
    expect(serializeMapEdits(back.edits)).toBe(text);
  });

  it('leaves the new sections out when empty, so an older map writes the same bytes', () => {
    expect(serializeMapEdits(NO_EDITS)).not.toContain('jobs');
    const p = parseMapEdits({ version: 2, seed: 1337, blocks: [], roads: [], spots: [], props: [], jobs: [], landmarks: [] });
    expect(p.problems).toEqual([]);
    expect(p.edits).toEqual(NO_EDITS);
    // Emptied by the tools: the section goes.
    expect(withJobPhone(withJobPhone(NO_EDITS, 's2-noise', 'phone-arts'), 's2-noise')).toEqual(NO_EDITS);
    expect(withLandmark(withLandmark(NO_EDITS, 'docks', [1, 1]), 'docks')).toEqual(NO_EDITS);
  });

  it('drops what it can’t read, with reasons, and clamps a frenzy into its limits', () => {
    const p = parseMapEdits({
      version: 2,
      spots: [
        { id: 'fz-1', add: 'frenzy', x: 1, z: 1, frenzy: { goal: 'drift', target: 123456, seconds: 2, gift: 'charge' } },
        { id: 'fz-2', add: 'frenzy', x: 1, z: 1, frenzy: { goal: 'dance', target: 3, seconds: 30 } },
        { id: 'fz-3', add: 'frenzy', x: 1, z: 1 },
        { id: 'pickup-60', add: 'pickup', x: 1, z: 1, pickup: 'banana' },
        { id: 'story:x/steps.0', nodes: [[1, 2]] },
        { id: 'ramp-3', frenzy: { goal: 'wreck' }, x: 3, z: 4 },
      ],
      jobs: [{ id: 's2-noise' }, { id: 's3-quiet', phone: 'phone-0', ring: true }],
      landmarks: [{ id: 'airport', at: [1, 1] }, { id: 'docks', at: [1.5, 2] }],
    });
    expect(p.edits.spots.find((s) => s.id === 'fz-1')!.frenzy).toEqual({ goal: 'drift', target: 10000, seconds: 15 });
    expect(p.edits.spots.map((s) => s.id)).toEqual(['fz-1', 'ramp-3']);
    expect(p.edits.jobs).toEqual([{ id: 's3-quiet', phone: 'phone-0' }]);
    expect(p.edits.landmarks).toBeUndefined();
    const all = p.problems.join('\n');
    for (const why of ['clamped', 'unknown frenzy goal "dance"', 'needs "frenzy"', 'needs "pickup"', '"nodes" must be a list', 'only go with an added spot', 'unknown field "ring"', 'no landmark "airport"', '"at" must be a block', '"phone" must be']) {
      expect(all).toContain(why);
    }
  });

  it('diffs and reverts the new entries', () => {
    const changes = diffMapEdits(NO_EDITS, map);
    expect(changes.map((c) => `${c.section}:${c.key}`)).toEqual([
      'spots:fz-0',
      'spots:phone-0',
      'spots:pickup-59',
      'spots:story:m4-parcels/steps.0.points',
      'spots:story:m6-midnight/steps.2.nodes',
      'jobs:s2-noise',
      'jobs:s3-quiet',
      'landmarks:station',
    ]);
    expect(changes.map(describeChange)).toContain('Job s3-quiet: rings from phone-0');
    expect(changes.map(describeChange)).toContain('Landmark station: moved to block 3,4');
    expect(changes.map(describeChange)).toContain('Spot fz-0: frenzy added, WRECK 8 CARS in 90 s with a rocket');
    let back = map;
    for (const c of changes) back = revertChange(back, c);
    expect(back).toEqual(NO_EDITS);
  });
});

describe('payphones and the jobs that ring them', () => {
  it('adds a phone, rings a job from it, and the game hears it', () => {
    expect(newSpotId(NO_EDITS, 'phone')).toBe('phone-0');
    const at = pave(0.5);
    const placed = placeSpot(NO_EDITS, 'phone', at.x, at.z);
    expect(placed.id).toBe('phone-0');
    let map = placed.edits;
    expect(placePayphones(map).at(-1)).toEqual({ id: 'phone-0', ...at });
    expect(spotRules('phone-0')).toMatchObject({ group: 'payphone', removable: true, generated: false });
    // Nobody rings it yet: a problem.
    expect(about(built(map).problems, 'phone-0')).toEqual(['no job rings it (move a job to it, or remove it)']);
    map = setJobPhone(map, 's3-quiet', 'phone-0');
    expect(map.jobs).toEqual([{ id: 's3-quiet', phone: 'phone-0' }]);
    expect(buildMissions({ x: 0, z: 0 }, { x: 0, z: 0 }, map).find((m) => m.id === 's3-quiet')!.phone).toBe('phone-0');
    expect(phoneJobs(map).find((j) => j.id === 's3-quiet')).toMatchObject({ phone: 'phone-0', written: 'phone-suburbs' });
    expect(built(map).problems).toEqual([]);
    // Back to its own phone: no edit.
    expect(setJobPhone(map, 's3-quiet', 'phone-suburbs').jobs).toBeUndefined();
  });

  it('flags a job on a missing phone, the cold open given one, and a phone both arcs ring', () => {
    const map = edits({
      jobs: [
        { id: 's2-noise', phone: 'phone-docks' },
        { id: 'opening', phone: 'phone-arts' },
        { id: 's3-quiet', phone: 'phone-7' },
        { id: 'zz-nope', phone: 'phone-arts' },
      ],
    });
    const p = built(map).problems;
    expect(about(p, 'phone-docks')[0]).toMatch(/both the main story and the Night Shift ring it/);
    expect(p.find((x) => x.id === 'phone-docks')!.edit).toEqual({ section: 'jobs', key: 's2-noise' });
    expect(about(p, 'job:s3-quiet')).toEqual(['rings from "phone-7", which isn\'t a payphone on the map']);
    expect(about(p, 'job:zz-nope')).toEqual(['no story job has the id "zz-nope"']);
    const opening = buildMissions({ x: 0, z: 0 }, { x: 0, z: 0 }, NO_EDITS).find((m) => m.direct)!;
    expect(about(checkRound3(generateCity(1337), edits({ jobs: [{ id: opening.id, phone: 'phone-arts' }] }), built(NO_EDITS).anchors), `job:${opening.id}`)).toEqual([
      'starts without a call (the cold open): it rings no phone',
    ]);
  });

  it('an added phone can go, a generated one can’t', () => {
    expect(spotRules('phone-docks')).toMatchObject({ removable: false });
    expect(spotRules('phone-3')).toMatchObject({ removable: true });
  });
});

describe('custom frenzies', () => {
  it('words titles as the shipped ones do', () => {
    for (const f of FRENZIES) expect(frenzyTitle(f.goal, f.target), f.id).toBe(f.title);
    for (const f of FRENZIES) expect(frenzySpecProblems(f), f.id).toEqual([]);
  });

  it('adds one with a token and a definition, counted with the shipped ones', () => {
    expect(newSpotId(NO_EDITS, 'frenzy')).toBe('fz-0');
    const at = pave(0.3);
    let map = placeSpot(NO_EDITS, 'frenzy', at.x, at.z).edits;
    expect(map.spots[0]).toEqual({ id: 'fz-0', add: 'frenzy', ...at, frenzy: { goal: 'knockdown', target: 15, seconds: 60 } });
    map = setFrenzy(map, 'fz-0', { goal: 'drift' });
    expect(map.spots[0].frenzy).toEqual({ goal: 'drift', target: 3000, seconds: 40 });
    map = setFrenzy(map, 'fz-0', { target: 999999, seconds: 7, gift: 'smg' });
    expect(map.spots[0].frenzy).toEqual({ goal: 'drift', target: FRENZY_LIMITS.drift.target[1], seconds: FRENZY_LIMITS.drift.seconds[0], gift: 'smg' });
    expect(setFrenzy(map, 'fz-0', { gift: null }).spots[0].frenzy!.gift).toBeUndefined();
    const list = frenzyList(map);
    expect(list.length).toBe(FRENZIES.length + 1);
    expect(list.at(-1)).toEqual({ id: 'fz-0', title: 'DRIFT 10,000', goal: 'drift', target: 10000, seconds: 15, needsCar: true, gift: 'smg' });
    expect(placeFrenzyTokens(map).at(-1)).toEqual({ id: 'fz-0', ...at });
    expect(frenzyList(NO_EDITS)).toBe(FRENZIES);
    expect(customFrenzy({ id: 'fz-9', frenzy: { goal: 'carjack', target: 4, seconds: 60 } })).toEqual({ id: 'fz-9', title: 'CARJACK 4', goal: 'carjack', target: 4, seconds: 60 });
    // Moving it keeps its frenzy.
    expect(built(map).problems).toEqual([]);
    expect(spotRules('fz-0')).toMatchObject({ group: 'frenzy', removable: true, generated: false });
  });

  it('flags a frenzy outside its limits (a file written by hand)', () => {
    const map = edits({ spots: [{ id: 'fz-4', add: 'frenzy', ...pave(0.3), frenzy: { goal: 'combo', target: 25, seconds: 45 } }] });
    expect(about(built(map).problems, 'fz-4')).toEqual(['its target must be 3 to 10 for combo']);
  });
});

describe('story spots', () => {
  const docks = placeDocks(generateCity(1337));
  const jobs = buildMissions(docks, placeSafehouse(NO_EDITS), NO_EDITS);

  it('the inventory lists the same ids the edits apply to, and each is a movable spot', () => {
    const ids = collectAnchors(generateCity(1337)).filter((a) => a.group === 'story').map((a) => a.id);
    expect(storySpots(jobs).map((s) => s.id)).toEqual(ids);
    for (const id of ids) expect(spotRules(id), id).toMatchObject({ group: 'story', movable: true, removable: false });
    expect(storyRule('story:m3-saints/steps.0.start.0')).toMatchObject({ turnable: true });
    expect(storyRule('story:m3-saints/steps.0.start.0')!.label).toBe("SAINTS' PAINT: saintcar");
    expect(storyRule('story:m4-parcels/steps.1')).toMatchObject({ turnable: false });
  });

  it('moves a point, a parked car (turned), a drive route and collect points in the jobs the game builds', () => {
    const car = storySpots(jobs).find((s) => s.id === 'story:m3-saints/steps.0.start.0')!;
    const map = edits({
      spots: [
        { id: 'story:m3-saints/steps.0.start.0', x: car.x + 64, z: car.z, heading: 1.57 },
        { id: 'story:s6-quietest/steps.0.start.0.route', nodes: [[-1, -3], [-4, -4], [0, -6], [3, -5], [3, -2], [1, -1]] },
        { id: 'story:m4-parcels/steps.0.points', points: [[100, 41], [130, 41], [160, 41]] },
      ],
    });
    const now = buildMissions(docks, placeSafehouse(map), map);
    const saints = now.find((m) => m.id === 'm3-saints')!;
    expect(saints.steps[0].start![0]).toMatchObject({ x: car.x + 64, z: car.z, heading: 1.57 });
    const coach = now.find((m) => m.id === 's6-quietest')!.steps[0].start![0] as unknown as { route: number[][] };
    expect(coach.route.at(-1)).toEqual([1, -1]);
    expect(now.find((m) => m.id === 'm4-parcels')!.steps[0]).toMatchObject({ points: [[100, 41], [130, 41], [160, 41]] });
    // Untouched jobs are the same objects; no edits, the same list.
    expect(now.find((m) => m.id === 's2-noise')).toEqual(jobs.find((m) => m.id === 's2-noise'));
    const list = jobs.slice();
    expect(editMissionsOf(list, NO_EDITS)).toBe(list);
    // The inventory carries them, flagged moved.
    const anchors = collectAnchors(generateCity(1337, map), { edits: map });
    expect(anchors.find((a) => a.id === 'story:m3-saints/steps.0.start.0')).toMatchObject({ moved: true, points: [{ x: car.x + 64, z: car.z }] });
  });

  it('checks: the wrong shape, a parked car off the road, a pavement spot in the road', () => {
    const tuna = storySpots(jobs).find((s) => s.id === 'story:m2-tuna/steps.1.start.0')!;
    const map = edits({
      spots: [
        { id: 'story:m3-saints/steps.0.start.0', ...pave(0.5) },
        { id: 'story:m2-tuna/steps.1.start.0', x: Math.round(tuna.x / 64) * 64, z: tuna.z },
        { id: 'story:m6-midnight/steps.2.nodes', nodes: [[0, 0], [1, 0]] },
        { id: 'story:m4-parcels/steps.1', heading: 1 },
      ],
    });
    const p = built(map).problems;
    expect(about(p, 'story:m3-saints/steps.0.start.0')[0]).toMatch(/must stand on a road/);
    expect(about(p, 'story:m2-tuna/steps.1.start.0')[0]).toMatch(/stands in the road/);
    expect(about(p, 'story:m6-midnight/steps.2.nodes')).toContain('has 6 crossings, not 2');
    expect(about(p, 'story:m4-parcels/steps.1')).toContain('has no facing to turn');
  });

  it('the editor drags a route crossing to the nearest crossing, and back home clears it', () => {
    const anchors = collectAnchors(generateCity(1337));
    const route = anchors.find((a) => a.id === 'story:s6-quietest/steps.0.start.0.route')!;
    const handles = storyHandles(route)!;
    expect(handles.length).toBe(route.via!.length);
    const written = route.via!;
    const map = moveStoryHandle(NO_EDITS, route, 5, { x: 70, z: -60 }, written);
    expect(map.spots[0].nodes!.at(-1)).toEqual([1, -1]);
    expect(moveStoryHandle(NO_EDITS, route, 5, { x: 3, z: -62 }, written)).toEqual(NO_EDITS);
    const parcels = anchors.find((a) => a.id === 'story:m4-parcels/steps.0.points')!;
    const moved = moveStoryHandle(NO_EDITS, parcels, 1, { x: 12.34, z: 41 }, parcels.points.map((q) => [q.x, q.z] as const));
    expect(moved.spots[0].points![1]).toEqual([12.3, 41]);
    expect(withStorySpotEdit(moved, parcels.id)).toEqual(NO_EDITS);
  });
});

describe('landmarks', () => {
  const plain = generateCity(1337);
  const plainAnchors = collectAnchors(plain);

  it('a spray bay moves to another open lot, with its props and keep-out', () => {
    const lots = landmarkBlocks(plain, 'spray-ne', plainAnchors);
    expect(lots.length).toBeGreaterThan(10);
    // Not onto another bay's lot.
    const taken = placeSprayShops(plain).map((s) => s.id);
    expect(lots.some(([x, z]) => taken.includes(`spray-${x}-${z}`) && `spray-${x}-${z}` !== 'spray-10-2')).toBe(false);
    const to = lots.find(([x, z]) => x === 12 && z === 2)!;
    expect(to).toBeDefined();
    const map = edits({ landmarks: [{ id: 'spray-ne', at: to }] });
    const b = built(map);
    const shops = placeSprayShops(b.city);
    expect(shops.map((s) => s.id)).toEqual(['spray-4-5', 'spray-12-2', 'spray-4-10', 'spray-10-11']);
    const shop = shops[1];
    expect(b.d.landmarks.props.some((p) => Math.hypot(p.x - shop.x, p.z - shop.z) < 8)).toBe(true);
    expect(b.anchors.find((a) => a.landmark === 'spray-ne')!.id).toBe('spray-12-2');
    expect(b.problems).toEqual([]);
  });

  it('the docks, the station and the hospital move; Vex waits at the moved docks', () => {
    const map = edits({
      landmarks: [
        { id: 'docks', at: [12, 10] },
        { id: 'station', at: [0, 0] },
        { id: 'hospital', at: [1, 1] },
      ],
    });
    const b = built(map);
    const docks = placeDocks(b.city);
    expect(blockOf(b.city, { id: 'd', group: 'docks', label: '', points: [docks] }).bx - CORE_OFFSET).toBe(12);
    expect(placeStation(b.city).z).toBeLessThan(-400);
    expect(placeHospital(b.city).x).toBeLessThan(-400);
    const vex = buildMissions(docks, placeSafehouse(map), map).find((m) => m.id === 'm1-audition')!.steps[1].start![0] as { x: number; z: number };
    expect(Math.hypot(vex.x - docks.x, vex.z - docks.z)).toBeLessThan(12);
    expect(b.problems).toEqual([]);
    // The editor: home clears the edit.
    expect(moveLandmark(map, 'docks', [13, 12], [13, 12]).landmarks!.some((l) => l.id === 'docks')).toBe(false);
  });

  it('flags a landmark that can’t fit where it is moved (it stays put)', () => {
    expect(landmarkFit(plain, 'station', [0, 7])).toMatch(/needs a built-up block/);
    expect(landmarkFit(plain, 'spray-nw', [0, 0])).toMatch(/needs an open lot/);
    const map = edits({ landmarks: [{ id: 'station', at: [0, 7] }, { id: 'spray-nw', at: [0, 0] }, { id: 'docks', at: [10, 2] }, { id: 'spray-ne', at: [10, 2] }] });
    const b = built(map);
    expect(placeStation(b.city)).toEqual(placeStation(plain));
    expect(about(b.problems, 'station')[0]).toMatch(/built-up block .* it stays where the city put it/);
    expect(b.problems.find((p) => p.edit?.key === 'spray-ne')!.problem).toMatch(/another landmark took block 10,2/);
  });
});

describe('pickups', () => {
  it('stand where they did, with ids, and move, go and come with the edits', () => {
    const raw = generatePickups(1337);
    const placed = placePickups(1337, NO_EDITS);
    expect(placed.map(({ x, z, kind }) => ({ x, z, kind }))).toEqual(raw.map(({ x, z, kind }) => ({ x, z, kind })));
    expect(placed.map((p) => p.id).slice(0, 2)).toEqual(['pickup-0', 'pickup-1']);
    expect(placed.at(-1)!.id).toBe('pickup-58');
    expect(newSpotId(NO_EDITS, 'pickup')).toBe('pickup-59');
    expect(new Set(PICKUP_ITEMS)).toEqual(new Set(PICKUP_KINDS));
    const at = pave(0.6);
    const added = placeSpot(NO_EDITS, 'pickup', at.x, at.z, 'rocket');
    let map = added.edits;
    map = setPickupKind(map, added.id, 'smoke');
    map = edits({ spots: [...map.spots, { id: 'pickup-3', ...pave(0.4) }, { id: 'pickup-4', removed: true }] });
    const now = placePickups(1337, map);
    expect(now.length).toBe(raw.length);
    expect(now.find((p) => p.id === 'pickup-3')).toMatchObject({ ...pave(0.4), kind: raw[3].kind });
    expect(now.some((p) => p.id === 'pickup-4')).toBe(false);
    expect(now.at(-1)).toMatchObject({ id: 'pickup-59', kind: 'smoke', ...at });
    const b = built(map);
    expect(b.anchors.find((a) => a.id === 'pickup-59')).toMatchObject({ group: 'pickup', added: true });
    expect(b.problems).toEqual([]);
  });
});

describe('the committed map', () => {
  it('has none of round 3’s problems', () => {
    const b = built(NO_EDITS);
    expect(checkRound3(b.city, NO_EDITS, b.anchors)).toEqual([]);
  });

  it('every spot edit kind the editor writes is a valid entry', () => {
    const spots: SpotEdit[] = [placeSpot(NO_EDITS, 'frenzy', 1, 2).edits.spots[0], placeSpot(NO_EDITS, 'phone', 1, 2).edits.spots[0]];
    expect(parseMapEdits(JSON.parse(serializeMapEdits(edits({ spots })))).problems).toEqual([]);
  });
});

describe('what the run-time scenes can pick (the editor’s "can host")', () => {
  it('lists kerb scenes on a road, awnings, neon and kebab shops on a block, and drops a closed road’s', () => {
    const inputs = { pickups: generatePickups(1337), ramps: placeCityRamps(1337, NO_EDITS) };
    const p = buildPreview(NO_EDITS, inputs, NO_EDITS);
    const road = hostKey({ kind: 'segment', a: [0, 1], b: [0, 2] })!;
    expect(p.hosts.get(road)!.map((h) => h.scene)).toContain('ice cream van, cash run, funeral (kerb)');
    expect(p.hosts.get(road)!.find((h) => h.scene.startsWith('ice cream'))!.count).toBe(2);
    const kebab = [...p.hosts.entries()].find(([k, v]) => k.startsWith('block:') && v.some((h) => h.scene.startsWith('kebab')));
    expect(kebab).toBeDefined();
    expect([...p.hosts.values()].some((v) => v.some((h) => h.scene.startsWith('film shoot')))).toBe(true);
    // Closed: no kerb scenes there.
    const closed = buildPreview(edits({ roads: [{ a: [0, 1], b: [0, 2], closed: true }] }), inputs, NO_EDITS);
    expect(closed.hosts.get(road)).toBeUndefined();
    // Shop doors and road works are listed apart (zoomed in only).
    expect(p.extras.filter((a) => a.group === 'shop').length).toBeGreaterThan(100);
    expect(p.extras.filter((a) => a.group === 'roadworks').length).toBeGreaterThan(5);
  });
});

describe('frenzies counted from the map', () => {
  it('a map with a custom frenzy needs it beaten for the frenzies’ share, and the save keeps its id', () => {
    const map = placeSpot(NO_EDITS, 'frenzy', pave(0.3).x, pave(0.3).z).edits;
    const list = frenzyList(map);
    const save = defaultSave();
    save.frenzies = FRENZIES.map((f) => f.id);
    const totals = { missions: [], frenzies: list.length, packages: 40, races: [], exportOrders: 5 };
    expect(completionParts(save, totals).frenzies).toBeCloseTo(8 / 9);
    save.frenzies.push('fz-0', 'fz-77');
    pruneSave(save, { frenzies: list.map((f) => f.id) });
    expect(save.frenzies).toContain('fz-0');
    expect(save.frenzies).not.toContain('fz-77');
    expect(completionParts(save, totals).frenzies).toBe(1);
  });
});
