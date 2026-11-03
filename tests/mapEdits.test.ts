/**
 * W3-D: the map edits file (world/mapEdits.ts) and generateCity applying it.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CORE_OFFSET, generateCity, isCarPark, lotBytes, type City, type Rect } from '../src/world/city';
import { districtOf } from '../src/world/districts';
import { NO_EDITS, diffMapEdits, parseMapEdits, serializeMapEdits, withBlockEdit, type MapEdits } from '../src/world/mapEdits';
import { SHIPPED_MAP, SHIPPED_MAP_PROBLEMS } from '../src/world/shippedMap';

const edits = (blocks: MapEdits['blocks']): MapEdits => ({ version: 1, seed: 1337, blocks });
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
  const sample = edits([
    { at: [9, 3], kind: 'carpark' },
    { at: [-2, 17], district: 'arts', variant: -4 },
    { at: [5, 6], kind: 'park', district: 'oldtown' },
  ]);

  it('round-trips, sorted north to south then west to east, one block a line', () => {
    const text = serializeMapEdits(sample);
    expect(text).toBe(
      [
        '{',
        '  "version": 1,',
        '  "seed": 1337,',
        '  "blocks": [',
        '    { "at": [9, 3], "kind": "carpark" },',
        '    { "at": [5, 6], "kind": "park", "district": "oldtown" },',
        '    { "at": [-2, 17], "district": "arts", "variant": -4 }',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
    const back = parseMapEdits(JSON.parse(text));
    expect(back.problems).toEqual([]);
    expect(serializeMapEdits(back.edits)).toBe(text);
    expect(serializeMapEdits(NO_EDITS)).toBe('{\n  "version": 1,\n  "seed": 1337,\n  "blocks": []\n}\n');
  });

  it('drops what it cannot read, says why, and never throws', () => {
    for (const junk of [null, 3, 'x', [], { version: 2, blocks: [{ at: [1, 1], kind: 'park' }] }]) {
      const r = parseMapEdits(junk);
      expect(r.edits.blocks).toEqual([]);
      expect(r.problems.length).toBeGreaterThan(0);
    }
    const r = parseMapEdits({
      version: 1,
      roads: [],
      blocks: [
        { at: [1, 2], kind: 'castle' },
        { at: [1.5, 2], kind: 'park' },
        { at: [999, 0], kind: 'park' },
        { at: [3, 3] },
        { at: [4, 4], kind: 'park', colour: 'red' },
        { at: [4, 4], kind: 'plaza', district: 'moon' },
        'nope',
      ],
    });
    expect(r.edits.blocks).toEqual([{ at: [4, 4], kind: 'plaza' }]);
    expect(r.problems).toHaveLength(10);
    expect(r.problems.join('\n')).toMatch(/unknown section "roads"/);
    expect(r.problems.join('\n')).toMatch(/edited twice; the later one wins/);
  });

  it('diffs local edits against the file, and sets or clears one block', () => {
    let local = withBlockEdit(sample, [9, 3]);
    local = withBlockEdit(local, [5, 6], { kind: 'plaza' });
    local = withBlockEdit(local, [0, 0], { variant: 1 });
    expect(withBlockEdit(local, [1, 1], {}).blocks).toEqual(local.blocks);
    expect(diffMapEdits(sample, local)).toEqual([
      { at: [0, 0], after: { at: [0, 0], variant: 1 } },
      { at: [9, 3], before: { at: [9, 3], kind: 'carpark' } },
      { at: [5, 6], before: { at: [5, 6], kind: 'park', district: 'oldtown' }, after: { at: [5, 6], kind: 'plaza' } },
    ]);
    expect(diffMapEdits(sample, sample)).toEqual([]);
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
