/**
 * W3-D: the map edits file (world/mapEdits.ts) and generateCity applying it.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CORE_OFFSET, generateCity, isCarPark, lotBytes, type City, type Rect } from '../src/world/city';
import { districtOf } from '../src/world/districts';
import {
  NO_EDITS,
  diffMapEdits,
  parseMapEdits,
  revertChange,
  serializeMapEdits,
  withBlockEdit,
  withPropEdit,
  withRoadEdit,
  withSpotEdit,
  type MapEdits,
} from '../src/world/mapEdits';
import { SHIPPED_MAP, SHIPPED_MAP_PROBLEMS } from '../src/world/shippedMap';

const edits = (blocks: MapEdits['blocks']): MapEdits => ({ ...NO_EDITS, blocks });
const blockOf = (city: City, cx: number, cz: number) => city.blocks.find((b) => b.bx === cx + CORE_OFFSET && b.bz === cz + CORE_OFFSET)!;
const inside = (r: Rect, x: number, z: number) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
const centreIn = (r: Rect) => (b: Rect) => inside(r, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);

// generateCity installs district repaints globally: leave the generated city's behind.
afterEach(() => void generateCity(1337));

describe('the committed map file', () => {
  it('parses clean, for this seed, and is canonical', () => {
    expect(SHIPPED_MAP_PROBLEMS).toEqual([]);
    expect(SHIPPED_MAP.seed).toBe(1337);
    const text = readFileSync(new URL('../src/world/maps/city.json', import.meta.url), 'utf8');
    expect(serializeMapEdits(SHIPPED_MAP)).toBe(text);
  });
});

describe('parse and serialize', () => {
  const sample: MapEdits = {
    ...NO_EDITS,
    blocks: [
      { at: [9, 3], kind: 'carpark' },
      { at: [-2, 17], district: 'arts', variant: -4 },
      { at: [5, 6], kind: 'park', district: 'oldtown', height: 1.25 },
    ],
    roads: [
      { a: [3, 1], b: [2, 1], closed: true },
      { a: [0, -2], b: [0, -1], oneWay: true },
    ],
    spots: [{ id: 'phone-docks', x: 12.34, z: -50.06 }, { id: 'ramp-3', removed: true }],
    props: [
      { kind: 'bench', x: 40.04, z: 9.5, heading: 1.5708 },
      { kind: 'hydrant', x: -3, z: 9.6, removed: true },
    ],
  };

  it('round-trips, each section sorted, one entry a line, positions to 0.1 m', () => {
    const text = serializeMapEdits(sample);
    expect(text).toBe(
      [
        '{',
        '  "version": 2,',
        '  "seed": 1337,',
        '  "blocks": [',
        '    { "at": [9, 3], "kind": "carpark" },',
        '    { "at": [5, 6], "kind": "park", "district": "oldtown", "height": 1.25 },',
        '    { "at": [-2, 17], "district": "arts", "variant": -4 }',
        '  ],',
        '  "roads": [',
        '    { "a": [0, -2], "b": [0, -1], "oneWay": true },',
        '    { "a": [3, 1], "b": [2, 1], "closed": true }',
        '  ],',
        '  "spots": [',
        '    { "id": "phone-docks", "x": 12.34, "z": -50.06 },',
        '    { "id": "ramp-3", "removed": true }',
        '  ],',
        '  "props": [',
        '    { "kind": "bench", "x": 40.04, "z": 9.5, "heading": 1.5708 },',
        '    { "kind": "hydrant", "x": -3, "z": 9.6, "removed": true }',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
    // Read back: positions to 0.1 m, headings to 0.01, a two-way edit smaller node first.
    const back = parseMapEdits(JSON.parse(text));
    expect(back.problems).toEqual([]);
    expect(back.edits.roads).toContainEqual({ a: [2, 1], b: [3, 1], closed: true });
    expect(back.edits.spots[0]).toEqual({ id: 'phone-docks', x: 12.3, z: -50.1 });
    expect(back.edits.props[0]).toEqual({ kind: 'bench', x: 40, z: 9.5, heading: 1.57 });
    const again = serializeMapEdits(back.edits);
    expect(serializeMapEdits(parseMapEdits(JSON.parse(again)).edits)).toBe(again);
    expect(serializeMapEdits(NO_EDITS)).toBe('{\n  "version": 2,\n  "seed": 1337,\n  "blocks": [],\n  "roads": [],\n  "spots": [],\n  "props": []\n}\n');
  });

  it('reads added spots, and drops one with no place or an unknown kind', () => {
    const r = parseMapEdits({
      version: 2,
      spots: [
        { id: 'ramp-20', add: 'kicker', x: 1.23, z: 4, heading: 1 },
        { id: 'pkg-40', add: 'package', x: 5, z: 6, removed: true },
        { id: 'pkg-41', add: 'package' },
        { id: 'ramp-21', add: 'rocket', x: 1, z: 1 },
      ],
    });
    expect(r.edits.spots).toEqual([
      { id: 'pkg-40', add: 'package', x: 5, z: 6 },
      { id: 'ramp-20', add: 'kicker', x: 1.2, z: 4, heading: 1 },
    ]);
    expect(r.problems).toEqual([
      'spots[1]: an added spot can\'t be removed (drop its entry); "removed" ignored',
      'spots[2]: an added spot needs "x" and "z" on the map',
      'spots[3]: can\'t add a spot of kind "rocket"',
    ]);
    expect(serializeMapEdits(r.edits)).toContain('{ "id": "ramp-20", "add": "kicker", "x": 1.2, "z": 4, "heading": 1 }');
  });

  it('reads a version 1 file (blocks only)', () => {
    const r = parseMapEdits({ version: 1, seed: 1337, blocks: [{ at: [1, 2], kind: 'park' }] });
    expect(r.problems).toEqual([]);
    expect(r.edits).toEqual({ ...NO_EDITS, blocks: [{ at: [1, 2], kind: 'park' }] });
    expect(parseMapEdits({ version: 1, roads: [] }).problems).toEqual(['unknown section "roads" ignored']);
  });

  it('drops what it cannot read, says why, and never throws', () => {
    for (const junk of [null, 3, 'x', [], { version: 3, blocks: [{ at: [1, 1], kind: 'park' }] }]) {
      const r = parseMapEdits(junk);
      expect(r.edits).toEqual(NO_EDITS);
      expect(r.problems.length).toBeGreaterThan(0);
    }
    const r = parseMapEdits({
      version: 2,
      bridges: [],
      blocks: [
        { at: [1, 2], kind: 'castle' },
        { at: [1.5, 2], kind: 'park' },
        { at: [999, 0], kind: 'park' },
        { at: [3, 3] },
        { at: [4, 4], kind: 'park', colour: 'red' },
        { at: [4, 4], kind: 'plaza', district: 'moon' },
        { at: [5, 5], height: 9 },
        'nope',
      ],
      roads: [{ a: [0, 0], b: [2, 0], closed: true }, { a: [0, 0], b: [0, 1] }, { a: [1, 1], b: [1, 2], closed: true, oneWay: true }],
      spots: [{ id: '' }, { id: 'safehouse' }, { id: 'safehouse', x: 1 }],
      props: [{ kind: 'Bench!', x: 0, z: 0 }, { kind: 'bench', x: 1e9, z: 0 }],
    });
    expect(r.edits.blocks).toEqual([{ at: [4, 4], kind: 'plaza' }]);
    expect(r.edits.roads).toEqual([{ a: [1, 1], b: [1, 2], closed: true }]);
    expect(r.edits.spots).toEqual([]);
    expect(r.edits.props).toEqual([]);
    const all = r.problems.join('\n');
    for (const want of [/unknown section "bridges"/, /edited twice; the later one wins/, /height must be a scale/, /aren't neighbouring crossings/, /closed and one-way; closed wins/, /must both be on the map/, /"kind" must be a prop kind/]) {
      expect(all).toMatch(want);
    }
  });

  it('diffs local edits against the file, in the file\'s order, and reverts a change', () => {
    let local = withBlockEdit(sample, [9, 3]);
    local = withBlockEdit(local, [5, 6], { kind: 'plaza' });
    local = withBlockEdit(local, [0, 0], { variant: 1 });
    local = withRoadEdit(local, [2, 1], [3, 1]);
    local = withRoadEdit(local, [4, 4], [4, 5], { oneWay: true });
    local = withSpotEdit(local, 'safehouse', { x: 10, z: 20 });
    local = withPropEdit(local, { kind: 'hydrant', x: -3, z: 9.6, removed: true }, true);
    expect(withBlockEdit(local, [1, 1], {}).blocks).toEqual(local.blocks);
    const changes = diffMapEdits(sample, local);
    expect(changes.map((c) => `${c.section} ${c.key} ${c.before ? 'B' : '-'}${c.after ? 'A' : '-'}`)).toEqual([
      'blocks 0,0 -A',
      'blocks 9,3 B-',
      'blocks 5,6 BA',
      'roads 2,1|3,1 B-',
      'roads 4,4|4,5 -A',
      'spots safehouse -A',
      'props hydrant@-3.0,9.6 B-',
    ]);
    expect(diffMapEdits(sample, sample)).toEqual([]);
    // Reverting every change gets the file back.
    const reverted = changes.reduce((e, c) => revertChange(e, c), local);
    expect(serializeMapEdits(reverted)).toBe(serializeMapEdits(sample));
  });
});

describe('generateCity with edits', () => {
  const plain = generateCity(1337);
  /** A core block the seed builds on, and one it leaves a park. */
  const built = plain.blocks.find((b) => b.kind === 'buildings')!;
  const park = plain.blocks.find((b) => b.kind === 'park')!;
  const at = (b: { bx: number; bz: number }): [number, number] => [b.bx - CORE_OFFSET, b.bz - CORE_OFFSET];

  it('changes the edited block and nothing else', () => {
    const city = generateCity(1337, edits([{ at: at(built), kind: 'park' }, { at: at(park), kind: 'buildings' }]));
    expect(blockOf(city, ...at(built)).kind).toBe('park');
    expect(blockOf(city, ...at(park)).kind).toBe('buildings');
    expect(city.buildings.filter(centreIn(built.interior))).toEqual([]);
    expect(city.trees.filter((t) => inside(built.interior, t.x, t.z)).length).toBeGreaterThan(0);
    expect(city.buildings.filter(centreIn(park.interior)).length).toBeGreaterThan(0);
    const elsewhere = (b: Rect) => !centreIn(built.interior)(b) && !centreIn(park.interior)(b);
    expect(city.buildings.filter(elsewhere)).toEqual(plain.buildings.filter(elsewhere));
    const treesElsewhere = (c: City) => c.trees.filter((t) => !inside(built.interior, t.x, t.z) && !inside(park.interior, t.x, t.z));
    expect(treesElsewhere(city)).toEqual(treesElsewhere(plain));
    expect(city.blocks.map((b) => b.kind).filter((k, i) => k !== plain.blocks[i].kind)).toHaveLength(2);
  });

  it('rerolls a block by variant, the same each time', () => {
    const a = generateCity(1337, edits([{ at: at(built), variant: 1 }])).buildings.filter(centreIn(built.interior));
    const b = generateCity(1337, edits([{ at: at(built), variant: 2 }])).buildings.filter(centreIn(built.interior));
    const a2 = generateCity(1337, edits([{ at: at(built), variant: 1 }])).buildings.filter(centreIn(built.interior));
    expect(a).toEqual(a2);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(plain.buildings.filter(centreIn(built.interior)));
  });

  it('repaints a district: same footprints, the new district everywhere that asks', () => {
    const was = built.district;
    const to = was === 'arts' ? 'industrial' : 'arts';
    const city = generateCity(1337, edits([{ at: at(built), district: to }]));
    expect(districtOf(built.bx, built.bz)).toBe(to);
    expect(blockOf(city, ...at(built)).district).toBe(to);
    const mine = city.buildings.filter(centreIn(built.interior));
    const before = plain.buildings.filter(centreIn(built.interior));
    expect(mine.map((b) => [b.minX, b.minZ, b.maxX, b.maxZ])).toEqual(before.map((b) => [b.minX, b.minZ, b.maxX, b.maxZ]));
    expect(mine.every((b) => b.district === to)).toBe(true);
    generateCity(1337);
    expect(districtOf(built.bx, built.bz)).toBe(was);
  });

  it('restyles a block: the same footprints in another district\'s look, the district kept', () => {
    const to = built.district === 'downtown' ? 'industrial' : 'downtown';
    const city = generateCity(1337, edits([{ at: at(built), style: to }]));
    const block = blockOf(city, ...at(built));
    expect(block.district).toBe(built.district);
    expect(block.style).toBe(to);
    expect(districtOf(built.bx, built.bz)).toBe(built.district);
    const mine = city.buildings.filter(centreIn(built.interior));
    const before = plain.buildings.filter(centreIn(built.interior));
    expect(mine.map((b) => [b.minX, b.minZ, b.maxX, b.maxZ])).toEqual(before.map((b) => [b.minX, b.minZ, b.maxX, b.maxZ]));
    expect(mine.every((b) => b.district === to)).toBe(true);
  });

  it('clears a block to waste ground: no buildings or trees', () => {
    const city = generateCity(1337, edits([{ at: at(built), kind: 'lot' }, { at: at(park), kind: 'lot' }]));
    expect(blockOf(city, ...at(built)).kind).toBe('lot');
    expect(city.buildings.filter(centreIn(built.interior))).toEqual([]);
    expect(city.trees.filter((t) => inside(park.interior, t.x, t.z))).toEqual([]);
    const r = parseMapEdits({ version: 2, blocks: [{ at: [1, 1], kind: 'lot', style: 'arts' }, { at: [2, 2], style: 'moon' }] });
    expect(r.edits.blocks).toEqual([{ at: [1, 1], kind: 'lot', style: 'arts' }]);
    expect(r.problems).toEqual(['blocks[1]: unknown style "moon" ignored', 'blocks[1]: changes nothing']);
  });

  it('scales a block\'s building heights, capped, footprints kept', () => {
    const city = generateCity(1337, edits([{ at: at(built), height: 0.5 }]));
    const mine = city.buildings.filter(centreIn(built.interior));
    const before = plain.buildings.filter(centreIn(built.interior));
    expect(mine.map((b) => [b.minX, b.minZ, b.maxX, b.maxZ])).toEqual(before.map((b) => [b.minX, b.minZ, b.maxX, b.maxZ]));
    mine.forEach((b, i) => expect(b.height).toBeCloseTo(before[i].height * 0.5, 6));
    const tall = generateCity(1337, edits([{ at: at(built), height: 1.6 }])).buildings.filter(centreIn(built.interior));
    expect(Math.max(...tall.map((b) => b.height))).toBeLessThanOrEqual(12);
  });

  it('makes a plaza a car park or an open one, and leaves the other lots alone', () => {
    const bytes0 = lotBytes(plain);
    const i = plain.blocks.findIndex((b) => b.kind === 'buildings');
    const target = plain.blocks[i];
    const asPark = generateCity(1337, edits([{ at: at(target), kind: 'carpark' }]));
    const bytes1 = lotBytes(asPark);
    expect(asPark.blocks[i].kind).toBe('plaza');
    expect(isCarPark(asPark, bytes1, i)).toBe(true);
    const asPlaza = generateCity(1337, edits([{ at: at(target), kind: 'plaza' }]));
    expect(isCarPark(asPlaza, lotBytes(asPlaza), i)).toBe(false);
    expect([...bytes1].filter((_b, k) => k !== i)).toEqual([...bytes0].filter((_b, k) => k !== i));
  });
});
