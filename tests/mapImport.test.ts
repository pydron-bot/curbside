import { describe, expect, it } from 'vitest';
import { importMapText } from '../src/game/mapEditorState';
import { NO_EDITS, serializeMapEdits, type MapEdits } from '../src/world/mapEdits';

// The map editor's IMPORT: a city.json (EXPORT's own, or one edited by hand) back into the editor.
describe('importMapText', () => {
  it('reads an exported file back exactly', () => {
    const map: MapEdits = {
      ...NO_EDITS,
      blocks: [{ at: [9, 3], kind: 'carpark' }],
      roads: [{ a: [1, 1], b: [2, 1], pedestrian: true }],
      spots: [{ id: 'phone-0', add: 'phone', x: 34, z: 9.5 }],
      jobs: [{ id: 's3-quiet', phone: 'phone-0' }],
    };
    const r = importMapText(serializeMapEdits(map));
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.skipped).toEqual([]);
    expect(serializeMapEdits(r.edits)).toBe(serializeMapEdits(map));
  });

  it('loads what it can and lists what it skipped', () => {
    const r = importMapText(JSON.stringify({ version: 2, seed: 1337, blocks: [{ at: [9, 3], kind: 'carpark' }, { at: [1, 1], kind: 'volcano' }], roads: [], spots: [], props: [] }));
    if ('error' in r) throw new Error(r.error);
    expect(r.edits.blocks).toEqual([{ at: [9, 3], kind: 'carpark' }]);
    expect(r.skipped[0]).toMatch(/volcano/);
  });

  it('refuses what isn’t a map file', () => {
    expect(importMapText('not json')).toEqual({ error: "it isn't JSON" });
    expect(importMapText('[1, 2]')).toEqual({ error: 'it has no "version": not a map file' });
    expect(importMapText('{"look": 1}')).toEqual({ error: 'it has no "version": not a map file' });
    expect(importMapText('{"version": 9}')).toMatchObject({ error: expect.stringMatching(/^it's version 9/) });
    // A version 1 file (blocks only) still loads.
    expect(importMapText('{"version": 1, "seed": 1337, "blocks": [{ "at": [9, 3], "kind": "park" }]}')).toMatchObject({ edits: { blocks: [{ at: [9, 3], kind: 'park' }] } });
  });
});
