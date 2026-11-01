import { describe, expect, it } from 'vitest';
import {
  COP_GAIN_CAP,
  DOWN_COST,
  FORGIVE_EVERY,
  FRIENDLY_FROM,
  GANGS,
  HOSTILE_BELOW,
  KO_COST,
  afterCopHurt,
  afterMemberDown,
  forgive,
  gangOn,
  placeHangouts,
  standing,
} from '../src/game/gangs';
import { AreaTracker, SETTLE } from '../src/game/modes/areaMode';
import { SAFEHOUSE, placeDocks, placeFrenzyTokens, placePayphones } from '../src/game/modes/places';
import { RACES, nodeX, nodeZ } from '../src/game/modes/races';
import { defaultSave, migrateSave } from '../src/game/progressSave';
import { buildMissions } from '../src/systems/missionsData';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, generateCity } from '../src/world/city';
import { DISTRICTS, DISTRICT_NAMES, districtAt, districtOf } from '../src/world/districts';
import { placeSprayShops, placeStation } from '../src/world/landmarks';

describe('district names', () => {
  it('every district has a distinct name', () => {
    const names = DISTRICTS.map((d) => DISTRICT_NAMES[d]);
    for (const n of names) expect(n.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(DISTRICTS.length);
  });

  it('districtAt agrees with districtOf in every block, and clamps off the map', () => {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
        const x = -HALF_EXTENT + (bx + 0.5) * BLOCK_SIZE;
        const z = -HALF_EXTENT + (bz + 0.5) * BLOCK_SIZE;
        expect(districtAt(x, z)).toBe(districtOf(bx, bz));
      }
    }
    expect(districtAt(-1e5, -1e5)).toBe(districtOf(0, 0));
    expect(districtAt(1e5, 1e5)).toBe(districtOf(BLOCKS_PER_SIDE - 1, BLOCKS_PER_SIDE - 1));
  });
});

describe('the area card', () => {
  it('names a district once you have settled in it, and not again until you leave', () => {
    const t = new AreaTracker();
    expect(t.update('downtown', SETTLE / 2)).toBeNull();
    expect(t.update('downtown', SETTLE / 2 + 0.01)).toBe('downtown');
    expect(t.update('downtown', 5)).toBeNull();
    // Skimming a wobbly border: no card.
    expect(t.update('arts', SETTLE / 2)).toBeNull();
    expect(t.update('downtown', SETTLE * 2)).toBeNull();
    expect(t.update('arts', 0.1)).toBeNull();
    expect(t.update('arts', SETTLE)).toBe('arts');
    t.reset();
    expect(t.update('arts', SETTLE + 0.01)).toBe('arts');
  });
});

describe('respect', () => {
  it('standing by thresholds', () => {
    expect(standing(0)).toBe('neutral');
    expect(standing(HOSTILE_BELOW)).toBe('neutral');
    expect(standing(HOSTILE_BELOW - 1)).toBe('hostile');
    expect(standing(FRIENDLY_FROM)).toBe('friendly');
  });

  it('knocking members down costs it, clamped at -100', () => {
    expect(afterMemberDown(0, false)).toBe(-DOWN_COST);
    expect(afterMemberDown(0, true)).toBe(-KO_COST);
    expect(afterMemberDown(-98, true)).toBe(-100);
    // A brawl with a whole crew turns them.
    let r = 0;
    for (let i = 0; i < 3; i++) r = afterMemberDown(r, true);
    expect(standing(r)).toBe('hostile');
  });

  it('hurting the police earns some, never past the cap', () => {
    expect(afterCopHurt(-30, 3)).toBe(-27);
    expect(afterCopHurt(COP_GAIN_CAP - 1, 3)).toBe(COP_GAIN_CAP);
    expect(afterCopHurt(COP_GAIN_CAP, 3)).toBe(COP_GAIN_CAP);
    expect(afterCopHurt(70, 3)).toBe(70);
    expect(standing(COP_GAIN_CAP)).not.toBe('friendly');
  });

  it('a grudge fades a point every FORGIVE_EVERY seconds, back to zero and no further', () => {
    let s = { respect: -3, carry: 0 };
    s = forgive(s.respect, s.carry, FORGIVE_EVERY - 1);
    expect(s.respect).toBe(-3);
    s = forgive(s.respect, s.carry, 2);
    expect(s.respect).toBe(-2);
    s = forgive(s.respect, s.carry, FORGIVE_EVERY * 10);
    expect(s).toEqual({ respect: 0, carry: 0 });
    expect(forgive(12, 5, 100)).toEqual({ respect: 12, carry: 0 });
  });

  it('is saved, sanitised and clamped; older saves start at zero', () => {
    expect(migrateSave({ cash: 5 }).respect).toEqual({});
    expect(migrateSave({ respect: { vipers: -40, saints: 250, bad: 'x', nan: NaN, frac: 3.6 } }).respect).toEqual({ vipers: -40, saints: 100, frac: 4 });
    expect(migrateSave({ respect: [1, 2] }).respect).toEqual({});
    expect(defaultSave().respect).toEqual({});
  });
});

describe('gangs and their hangouts', () => {
  const city = generateCity(1337);
  const hangouts = placeHangouts();
  const inside = (x: number, z: number, m: number) => city.obstacles.some((o) => x > o.minX - m && x < o.maxX + m && z > o.minZ - m && z < o.maxZ + m);

  it('each gang runs one district, and no two share one', () => {
    expect(new Set(GANGS.map((g) => g.turf)).size).toBe(GANGS.length);
    for (const g of GANGS) expect(gangOn(g.turf)).toBe(g);
    expect(gangOn('downtown')).toBeNull();
  });

  it('hangouts stand on their own turf, members clear of buildings', () => {
    expect(hangouts.length).toBeGreaterThan(0);
    for (const h of hangouts) {
      expect(districtAt(h.x, h.z), h.id).toBe(h.gang.turf);
      for (const m of h.members) expect(inside(m.x, m.z, 0.5), h.id).toBe(false);
    }
  });

  it('keep away from each other and from the activity spots, races, police landmarks and story spawns', () => {
    const docks = placeDocks(city);
    const others: Array<{ id: string; x: number; z: number; r: number }> = [
      { ...SAFEHOUSE, r: 60 },
      ...placePayphones().map((p) => ({ ...p, r: 60 })),
      ...placeFrenzyTokens().map((p) => ({ ...p, r: 40 })),
      { id: 'docks', x: docks.x, z: docks.z, r: 60 },
      ...placeSprayShops(city).map((s) => ({ id: s.id, x: s.x, z: s.z, r: 40 })),
      { id: 'station', ...placeStation(city), r: 60 },
      ...RACES.flatMap((r) => r.nodes.map((n, i) => ({ id: `${r.id}#${i}`, x: nodeX(n), z: nodeZ(n), r: 20 }))),
    ];
    for (const m of buildMissions(docks, SAFEHOUSE)) {
      for (const s of m.steps) for (const a of s.start ?? []) if (a.do === 'spawnCar' || a.do === 'spawnPed') others.push({ id: `${m.id}/${a.tag}`, x: a.x, z: a.z, r: 60 });
    }
    for (let i = 0; i < hangouts.length; i++) {
      const h = hangouts[i];
      for (let j = i + 1; j < hangouts.length; j++) expect(Math.hypot(h.x - hangouts[j].x, h.z - hangouts[j].z), `${h.id}/${hangouts[j].id}`).toBeGreaterThan(80);
      for (const o of others) expect(Math.hypot(h.x - o.x, h.z - o.z), `${h.id}/${o.id}`).toBeGreaterThan(o.r);
    }
  });
});
