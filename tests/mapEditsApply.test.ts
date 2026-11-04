/**
 * W3-D: the map edits' roads, spots and props sections applied in the game
 * (road rules in the road graph, spots where the placement functions put
 * them, props and closure barriers in the dressing), and the checks that
 * turn a breaking edit red (game/mapAnchors.ts checkMapEdits).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { checkMapEdits, collectAnchors, editsOn, newSpotId, spotRules, type Anchor } from '../src/game/mapAnchors';
import { placePackages } from '../src/game/modes/packages';
import { placeFrenzyTokens, placePayphones, placeSafehouse } from '../src/game/modes/places';
import { GANGS, placeHangouts } from '../src/game/gangs';
import { createVehicleState } from '../src/entities/vehicle';
import { routeToward } from '../src/systems/pursuit';
import { rerouteAi, spawnAi, createDriver } from '../src/systems/traffic';
import { CORE_OFFSET, generateCity, type City } from '../src/world/city';
import { dressCity } from '../src/world/dressing';
import { NO_EDITS, type MapEdits, type PropEdit, type RoadEdit, type SpotEdit } from '../src/world/mapEdits';
import { generatePickups } from '../src/world/pickups';
import { placeCityRamps } from '../src/world/ramps';
import { roadRules } from '../src/world/roadRules';
import { DIRS, DIR_VEC, MAX_NODE, canLeave, chooseTurn, roadExists } from '../src/world/roads';
import { segmentValid } from '../src/world/streetSpots';
import { SHIPPED_MAP } from '../src/world/shippedMap';
import { mulberry32 } from '../src/world/random';

afterEach(() => void generateCity(1337));

const edits = (e: Partial<MapEdits>): MapEdits => ({ ...NO_EDITS, ...e });
const road = (a: [number, number], b: [number, number], rule: 'closed' | 'oneWay'): RoadEdit => ({ a, b, [rule]: true });

function dressed(map: MapEdits) {
  const city = generateCity(1337, map);
  const ramps = placeCityRamps(1337, map);
  const d = dressCity(city, generatePickups(1337), ramps);
  return { city, ramps, d, anchors: collectAnchors(city, { ramps, busStops: d.street.busStops }) };
}

describe('road rules in the road graph', () => {
  it('a closed road takes no traffic either way, a one-way only a → b', () => {
    generateCity(1337, edits({ roads: [road([2, 1], [3, 1], 'closed'), road([0, 4], [0, 5], 'oneWay')] }));
    expect(canLeave(2, 1, 1)).toBe(false);
    expect(canLeave(3, 1, 3)).toBe(false);
    expect(roadExists(2, 1, 1)).toBe(true);
    expect(canLeave(0, 4, 2)).toBe(true);
    expect(canLeave(0, 5, 0)).toBe(false);
    expect(roadRules().isClosed(3, 1, 2, 1)).toBe(true);
    // Spawns and kerb spots: none on the closed road, none in the one-way's empty lane.
    expect(spawnAi(3, 1, 1, 0.5, mulberry32(1))).toBeNull();
    expect(spawnAi(0, 4, 0, 0.5, mulberry32(1))).toBeNull();
    expect(spawnAi(0, 5, 2, 0.5, mulberry32(1))).not.toBeNull();
    expect(segmentValid(3, 1, 1)).toBe(false);
    // Generated again unedited: the rules go.
    generateCity(1337);
    expect(canLeave(2, 1, 1)).toBe(true);
  });

  it('traffic never drives onto a closed road or the wrong way, and turns back at a dead end', () => {
    const closed = [road([1, 0], [1, 1], 'closed'), road([-2, -2], [-1, -2], 'closed'), road([0, 2], [1, 2], 'closed')];
    const oneWays = [road([0, 0], [0, 1], 'oneWay'), road([2, 2], [2, 3], 'oneWay')];
    // A dead end: (5, 5) has one way out, closed.
    const deadEnd = [road([5, 5], [6, 5], 'closed'), road([5, 5], [5, 6], 'closed'), road([5, 5], [5, 4], 'closed')];
    generateCity(1337, edits({ roads: [...closed, ...oneWays, ...deadEnd] }));
    const rand = mulberry32(7);
    const shut = new Set<string>();
    for (const r of [...closed, ...deadEnd]) shut.add(`${r.a}>${r.b}`).add(`${r.b}>${r.a}`);
    for (const r of oneWays) shut.add(`${r.b}>${r.a}`);
    let legs = 0;
    for (let car = 0; car < 60; car++) {
      let ix = Math.floor(rand() * 13) - 6;
      let iz = Math.floor(rand() * 13) - 6;
      let d = DIRS[Math.floor(rand() * 4)];
      for (let step = 0; step < 300; step++) {
        const next = step % 3 === 0 ? routeToward(ix, iz, d, 0, 0) : chooseTurn(ix, iz, d, rand);
        const v = DIR_VEC[next];
        expect(shut.has(`${ix},${iz}>${ix + v.x},${iz + v.z}`), `${ix},${iz} heading ${next}`).toBe(false);
        ix += v.x;
        iz += v.z;
        d = next;
        legs++;
      }
    }
    expect(legs).toBe(60 * 300);
    // Arriving at the dead end heading east: the only way on is back.
    expect(chooseTurn(5, 5, 1, rand)).toBe(3);
  });

  it('a car knocked onto a closed road drives off it', () => {
    generateCity(1337, edits({ roads: [road([0, 1], [0, 2], 'closed')] }));
    const ai = createDriver(0, 0, 0, mulberry32(3));
    // Mid-block on the closed road, nose north.
    rerouteAi(ai, createVehicleState(2, 96, Math.PI), mulberry32(3));
    expect([ai.ix, ai.iz, ai.dir]).toEqual([0, 1, 0]);
  });
});

describe('the dressing with road and prop edits', () => {
  const plain = dressed(NO_EDITS);
  const shelter = plain.d.street.busStops[3];
  const v = DIR_VEC[shelter.dir];
  const busRoad = road([shelter.ix - v.x, shelter.iz - v.z], [shelter.ix, shelter.iz], 'closed');

  it('closes a road with knockable barriers at both ends, and no stop or works on it', () => {
    const { d } = dressed(edits({ roads: [busRoad] }));
    const [ax, az] = busRoad.a;
    const [bx, bz] = busRoad.b;
    const near = (x: number, z: number) => d.street.props.filter((p) => (p.kind === 'work_barrier' || p.kind === 'traffic_barrel') && Math.hypot(p.x - x * 64, p.z - z * 64) < 15 && Math.hypot(p.x - x * 64, p.z - z * 64) > 10);
    expect(near(ax, az).length).toBeGreaterThanOrEqual(8);
    expect(near(bx, bz).length).toBeGreaterThanOrEqual(8);
    const barriers = new Set(near(ax, az).map((p) => d.street.props.indexOf(p)));
    expect(d.knockables.filter((k) => barriers.has(k.id)).length).toBe(barriers.size);
    expect(d.street.busStops.some((s) => s.ix === shelter.ix && s.iz === shelter.iz && s.dir === shelter.dir)).toBe(false);
    expect(d.street.roadworks.some((w) => w.ix === shelter.ix && w.iz === shelter.iz && w.dir === shelter.dir)).toBe(false);
  });

  it('removes a generated prop and adds one, with its solid and knockable; a removal matching nothing is reported', () => {
    const hydrant = plain.d.street.props.find((p) => p.kind === 'hydrant')!;
    const props: PropEdit[] = [
      { kind: 'hydrant', x: Math.round(hydrant.x * 10) / 10, z: Math.round(hydrant.z * 10) / 10, removed: true },
      { kind: 'bench', x: 20, z: 9.6, heading: 0 },
      { kind: 'mailbox', x: 400.4, z: 400.4, removed: true },
      { kind: 'streetlamp', x: 30, z: 9.6 },
    ];
    const { d } = dressed(edits({ props }));
    expect(d.street.props.length).toBe(plain.d.street.props.length - 1 + 1);
    expect(d.street.props.some((p) => p.kind === 'hydrant' && p.x === hydrant.x && p.z === hydrant.z)).toBe(false);
    const bench = d.street.props.findIndex((p) => p.kind === 'bench' && p.x === 20 && p.z === 9.6);
    expect(bench).toBeGreaterThan(-1);
    expect(d.knockables.some((k) => k.id === bench)).toBe(true);
    expect(d.street.propEditProblems.map((p) => p.edit.kind)).toEqual(['mailbox', 'streetlamp']);
    // Everything else stays put.
    const key = (p: { kind: string; x: number; z: number }) => `${p.kind}@${p.x},${p.z}`;
    const before = new Set(plain.d.street.props.map(key));
    expect(d.street.props.filter((p) => !before.has(key(p))).map((p) => p.kind)).toEqual(['bench']);
  });
});

describe('spot edits', () => {
  it('move the safehouse, payphones and tokens (phones can go too), move or remove hangouts and ramps', () => {
    const spots: SpotEdit[] = [
      { id: 'safehouse', x: 100, z: 41 },
      { id: 'phone-docks', x: 200, z: 41 },
      { id: 'fz-drift', removed: true },
      { id: 'phone-arts', removed: true },
      { id: `${GANGS[0].id}-0`, x: -150, z: 41 },
      { id: `${GANGS[0].id}-1`, removed: true },
      { id: 'ramp-2', x: 64, z: 150, heading: 0.1 },
      { id: 'ramp-4', removed: true },
    ];
    const map = edits({ spots });
    expect(placeSafehouse(map)).toEqual({ id: 'safehouse', x: 100, z: 41 });
    expect(placePayphones(map).find((p) => p.id === 'phone-docks')).toEqual({ id: 'phone-docks', x: 200, z: 41 });
    expect(placePayphones(map).length).toBe(placePayphones(NO_EDITS).length - 1);
    expect(placeFrenzyTokens(map)).toEqual(placeFrenzyTokens(NO_EDITS));
    const h = placeHangouts(GANGS, map);
    expect(h.length).toBe(placeHangouts(GANGS, NO_EDITS).length - 1);
    const moved = h.find((x) => x.id === `${GANGS[0].id}-0`)!;
    expect([moved.x, moved.z]).toEqual([-150, 41]);
    const mx = moved.members.reduce((s, m) => s + m.x, 0) / moved.members.length;
    expect(mx).toBeCloseTo(-150, 0);
    const ramps = placeCityRamps(1337, map);
    expect(ramps.length).toBe(placeCityRamps(1337, NO_EDITS).length - 1);
    expect(ramps.some((r) => r.id === 'ramp-4')).toBe(false);
    const r2 = ramps.find((r) => r.id === 'ramp-2')!;
    expect([r2.x, r2.z, r2.dir, r2.heading]).toEqual([64, 150, 2, 0]);
    // The anchors carry them where they are, flagged moved.
    const city = generateCity(1337, map);
    const anchors = collectAnchors(city, { ramps });
    expect(anchors.find((a) => a.id === 'safehouse')).toMatchObject({ moved: true, points: [{ x: 100, z: 41 }] });
    expect(anchors.some((a) => a.id === 'ramp-4')).toBe(false);
  });

  it('the rule table', () => {
    expect(spotRules('safehouse')).toMatchObject({ movable: true, removable: false });
    expect(spotRules('phone-oldtown')).toMatchObject({ movable: true, removable: true });
    expect(spotRules('fz-brawl')).toMatchObject({ movable: true, removable: false });
    expect(spotRules(`${GANGS[0].id}-1`)).toMatchObject({ group: 'hangout', movable: true, removable: true });
    expect(spotRules('ramp-0')).toMatchObject({ movable: true, removable: true, turnable: true });
    // An id only an added spot can have: the rules, marked not generated.
    expect(spotRules('ramp-99')).toMatchObject({ group: 'ramp', generated: false, turnable: true });
    expect(spotRules('ramp-0')).toMatchObject({ generated: true });
    expect(spotRules('pkg-3')).toMatchObject({ group: 'package', movable: true, removable: true, generated: true });
    expect(spotRules('pkg-40')).toMatchObject({ group: 'package', generated: false });
    expect(spotRules('ramp-x')).toBeNull();
    expect(spotRules('docks')).toBeNull();
  });

  it('added ramps, kickers, hangouts and packages are placed, with new ids', () => {
    const g = GANGS[0].id;
    expect(newSpotId(NO_EDITS, 'ramp')).toBe(`ramp-${placeCityRamps(1337, NO_EDITS).length}`);
    expect(newSpotId(NO_EDITS, 'package')).toBe('pkg-40');
    expect(newSpotId(NO_EDITS, 'hangout')).toBe(`${g}-${GANGS[0].hangouts.length}`);
    const spots: SpotEdit[] = [
      { id: 'ramp-30', add: 'ramp', x: 64, z: 100, heading: 3.1 },
      { id: 'ramp-31', add: 'kicker', x: 120, z: 64 },
      { id: `${g}-9`, add: 'hangout', x: 74.5, z: 100 },
      { id: 'pkg-40', add: 'package', x: 100, z: 100 },
      { id: 'pkg-7', removed: true },
    ];
    const map = edits({ spots });
    expect(newSpotId(map, 'ramp')).toBe('ramp-32');
    expect(newSpotId(map, 'package')).toBe('pkg-41');
    const ramps = placeCityRamps(1337, map);
    expect(ramps.find((r) => r.id === 'ramp-30')).toMatchObject({ kind: 'ramp', x: 64, z: 100, dir: 0, length: 6 });
    expect(ramps.find((r) => r.id === 'ramp-31')).toMatchObject({ kind: 'kicker', dir: 1, length: 2.5 });
    const h = placeHangouts(GANGS, map).find((x) => x.id === `${g}-9`)!;
    // Nearer the road at x = 64 than z = 64 or 128: the crew lines up north–south.
    expect(new Set(h.members.map((m) => m.x))).toEqual(new Set([74.5]));
    expect(h.members.length).toBeGreaterThan(1);
    const pk = placePackages(map);
    expect(pk.length).toBe(40);
    expect(pk.some((p) => p.index === 7)).toBe(false);
    expect(pk.find((p) => p.index === 40)).toMatchObject({ x: 100, z: 100 });
    const city = generateCity(1337, map);
    const anchors = collectAnchors(city, { ramps, edits: map });
    expect(anchors.find((a) => a.id === 'pkg-40')).toMatchObject({ group: 'package', added: true, moved: true });
    expect(anchors.find((a) => a.id === 'ramp-31')).toMatchObject({ group: 'ramp', added: true });
    expect(anchors.find((a) => a.id === 'pkg-0')?.added).toBeUndefined();
  });

  it('packages stay put whatever a block becomes', () => {
    const before = placePackages(NO_EDITS);
    generateCity(1337, edits({ blocks: [{ at: [3, 4], kind: 'park' }, { at: [9, 9], variant: 3 }] }));
    expect(placePackages(NO_EDITS)).toEqual(before);
    expect(before.map((p) => p.index)).toEqual([...Array(40).keys()]);
  });
});

describe('an empty lot', () => {
  it('has junk and a broken line of bollards, no carts and no buskers’ plaza', () => {
    const plain = generateCity(1337);
    const b = plain.blocks.find((x) => x.kind === 'buildings' && x.bx > 4 && x.bz > 4)!;
    const map = edits({ blocks: [{ at: [b.bx - CORE_OFFSET, b.bz - CORE_OFFSET], kind: 'lot' }] });
    const { d } = dressed(map);
    const r = b.interior;
    const inLot = (p: { x: number; z: number }) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;
    const junk = d.street.props.filter(inLot).map((p) => p.kind);
    expect(junk.length).toBeGreaterThan(2);
    expect(junk.every((k) => ['dumpster', 'traffic_barrel', 'shopping_cart', 'traffic_cone', 'trash_bin'].includes(k))).toBe(true);
    expect(d.street.vendors.filter((v) => Math.abs(v.x - (r.minX + r.maxX) / 2) < 36 && Math.abs(v.z - (r.minZ + r.maxZ) / 2) < 36 && inLot({ x: v.x, z: v.z }))).toEqual([]);
  });
});

describe('what the map edits break', () => {
  const ids = (city: City, map: MapEdits, anchors: readonly Anchor[], extra = {}) => checkMapEdits(city, map, anchors, extra);

  it('nothing, with the committed map', () => {
    const { city, d, anchors } = dressed(SHIPPED_MAP);
    expect(checkMapEdits(city, SHIPPED_MAP, anchors, { street: d.street })).toEqual([]);
  });

  it('a race over a closed road or against a one-way', () => {
    for (const rule of ['closed', 'oneWay'] as const) {
      const map = edits({ roads: [road([8, 0], [8, 1], rule)] });
      const { city, anchors } = dressed(map);
      const p = ids(city, map, anchors).filter((x) => x.id === 'race-ring');
      expect(p.length, rule).toBe(1);
      expect(p[0].problem).toMatch(rule === 'closed' ? /closed road 8, 0 – 8, 1|closed road 8, 1 – 8, 0/ : /wrong way down the one-way/);
      expect(p[0].edit).toEqual({ section: 'roads', key: '8,0|8,1' });
    }
  });

  it("a job's drive route cut off, and the crossing it cuts off", () => {
    const shut = ([[-3, -4], [-5, -4], [-4, -3], [-4, -5]] as Array<[number, number]>).map((b) => road([-4, -4], b, 'closed'));
    const map = edits({ roads: shut });
    const { city, anchors } = dressed(map);
    const problems = ids(city, map, anchors);
    expect(problems.find((p) => p.label === 'QUIETEST CITY: coach route')?.problem).toMatch(/can't get from .* to -4, -4/);
    expect(problems.find((p) => p.id === 'roads')?.problem).toBe("traffic can't get to (-4, -4)");
  });

  it('a one-way trap, a bus stop on a closed lane, and Pike’s stop', () => {
    const into = ([[3, 2], [3, 4], [2, 3], [4, 3]] as Array<[number, number]>).map((a) => road(a, [3, 3], 'oneWay'));
    const plain = dressed(NO_EDITS);
    const stop = plain.anchors.filter((a) => a.lane)[5];
    const v = DIR_VEC[stop.lane!.dir];
    const stopRoad = road([stop.lane!.ix - v.x, stop.lane!.iz - v.z], [stop.lane!.ix, stop.lane!.iz], 'closed');
    // Pike's stop: core block (3, 11), east side: the lane south along x = -4 from z = 3 to 4.
    const pike = road([-4, 3], [-4, 4], 'closed');
    const map = edits({ roads: [...into, stopRoad, pike] });
    const city = generateCity(1337, map);
    // The anchors as the unedited dressing had them, so the closed stop is still listed.
    const problems = ids(city, map, plain.anchors);
    expect(problems.find((p) => p.id === 'roads')?.problem).toBe("traffic that gets to (3, 3) can't get back");
    expect(problems.find((p) => p.id === stop.id)?.problem).toBe('its road is closed: no bus comes');
    expect(problems.some((p) => p.id === 'bus-pike')).toBe(true);
  });

  it('spot edits: an unknown id, an unremovable removal, a spot in a building, on the road, off the map', () => {
    const plainCity = generateCity(1337);
    const b = plainCity.buildings[40];
    const spots: SpotEdit[] = [
      { id: 'phone-moon', x: 1, z: 1 },
      { id: 'docks', removed: true },
      { id: 'phone-docks', removed: true },
      { id: 'fz-brawl', x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 },
      { id: 'fz-drift', x: 2, z: 30 },
      { id: 'safehouse', x: 2000, z: 0 },
      { id: 'ramp-1', x: 20, z: 20 },
      { id: 'safehouse-x', heading: 1 },
      ...GANGS[0].hangouts.map((_, i) => ({ id: `${GANGS[0].id}-${i}`, removed: true })),
    ];
    const map = edits({ spots });
    const { city, anchors } = dressed(map);
    const problems = ids(city, map, anchors);
    const about = (id: string) => problems.filter((p) => p.id === id).map((p) => p.problem);
    expect(about('phone-moon')).toEqual(['no spot has the id "phone-moon"']);
    expect(about('docks')).toEqual(["isn't a spot the map file moves or removes"]);
    expect(about('phone-docks')[0]).toMatch(/^removed, but (a job still rings|\d+ jobs still ring) it/);
    expect(about('fz-brawl')[0]).toMatch(/^inside a building/);
    expect(about('fz-drift')[0]).toMatch(/^stands in the road/);
    expect(about('safehouse')[0]).toMatch(/^off the map/);
    expect(about('ramp-1')).toContain('a ramp must stand on a road');
    expect(about(GANGS[0].id)).toEqual(['every hangout is removed: the gang never shows up']);
    expect(problems.find((p) => p.id === 'fz-brawl')?.edit).toEqual({ section: 'spots', key: 'fz-brawl' });
  });

  it('added spots: an id the city has, an id of the wrong kind, a move of a spot nobody added, and the package count', () => {
    const map = edits({
      spots: [
        { id: 'ramp-0', add: 'kicker', x: 64, z: 100 },
        { id: 'pkg-41', add: 'ramp', x: 64, z: 120 },
        { id: 'ramp-77', x: 64, z: 140 },
        { id: 'pkg-3', removed: true },
      ],
    });
    const { city, d, ramps } = dressed(map);
    const anchors = collectAnchors(city, { ramps, busStops: d.street.busStops, edits: map });
    const problems = ids(city, map, anchors);
    const about = (id: string) => problems.filter((p) => p.id === id).map((p) => p.problem);
    expect(about('ramp-0')[0]).toMatch(/id of a spot the city already has/);
    expect(about('pkg-41')).toEqual(['an added ramp needs an id like "ramp-18"']);
    expect(about('ramp-77')).toEqual(['no spot has the id "ramp-77"']);
    expect(about('packages')).toEqual(['39 on the map, not 40: the perks and 100% count 40']);
    // The generated ramp-0 stays as it was.
    expect(ramps.find((r) => r.id === 'ramp-0')).toEqual(placeCityRamps(1337, NO_EDITS).find((r) => r.id === 'ramp-0'));
  });

  it('prop edits that match nothing, or a kind that can’t be edited', () => {
    const map = edits({ props: [{ kind: 'mailbox', x: 400.4, z: 400.4, removed: true }, { kind: 'rocket', x: 10, z: 10 }] });
    const { city, d, anchors } = dressed(map);
    const problems = ids(city, map, anchors, { street: d.street });
    expect(problems.map((p) => p.problem)).toEqual(['no mailbox within 0.5 m to remove', 'unknown prop kind "rocket"']);
    expect(problems[0].edit).toEqual({ section: 'props', key: 'mailbox@400.4,400.4' });
  });

  it('lists the edits on a pick', () => {
    const map = edits({ roads: [road([8, 0], [8, 1], 'closed')], props: [{ kind: 'bench', x: 20, z: 5 }] });
    expect(editsOn(map, { kind: 'segment', a: [8, 1], b: [8, 0] })).toEqual([{ section: 'roads', key: '8,0|8,1', label: 'Road closed' }]);
    expect(editsOn(map, { kind: 'junction', ix: 8, iz: 0 }).length).toBe(1);
    expect(editsOn(map, { kind: 'segment', a: [0, 0], b: [1, 0] }).map((e) => e.section)).toEqual(['props']);
    expect(MAX_NODE).toBeGreaterThanOrEqual(8);
  });
});
