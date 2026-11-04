import { describe, expect, it } from 'vitest';
import { ACTIVE_FRENZIES, FRENZIES } from '../src/game/modes/frenzies';
import { SAFEHOUSE, placeFrenzyTokens, placePayphones, placeSafehouse } from '../src/game/modes/places';
import { NO_EDITS, type MapEdits } from '../src/world/mapEdits';
import { ACTIVE_MAP, SHIPPED_MAP, setActiveMap } from '../src/world/shippedMap';

// The map editor's live rebuild switches the map the page plays (game/liveMap.ts): what's derived from it follows.
const EDITS: MapEdits = {
  ...NO_EDITS,
  spots: [
    { id: 'safehouse', x: 40, z: 9.5 },
    { id: 'fz-0', add: 'frenzy', x: 44, z: 9.5, frenzy: { goal: 'wreck', target: 9, seconds: 70 } },
    { id: 'phone-0', add: 'phone', x: 34, z: 9.5 },
  ],
};

describe('setActiveMap', () => {
  it('moves the safehouse, adds the frenzy and the phone, and goes back', () => {
    expect(ACTIVE_MAP).toBe(SHIPPED_MAP);
    const home = { x: SAFEHOUSE.x, z: SAFEHOUSE.z };
    setActiveMap(EDITS);
    try {
      expect(ACTIVE_MAP).toBe(EDITS);
      expect(SAFEHOUSE).toMatchObject({ x: 40, z: 9.5 });
      expect(ACTIVE_FRENZIES.map((f) => f.id)).toEqual([...FRENZIES.map((f) => f.id), 'fz-0']);
      expect(ACTIVE_FRENZIES.at(-1)?.title).toBe('WRECK 9 CARS');
      // The placement defaults read the active map.
      expect(placePayphones().some((p) => p.id === 'phone-0')).toBe(true);
      expect(placeFrenzyTokens().some((p) => p.id === 'fz-0')).toBe(true);
    } finally {
      setActiveMap(SHIPPED_MAP);
    }
    expect(SAFEHOUSE).toMatchObject(home);
    expect(SAFEHOUSE).toMatchObject(placeSafehouse(SHIPPED_MAP));
    expect(ACTIVE_FRENZIES).toBe(FRENZIES);
  });
});
