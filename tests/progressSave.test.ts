import { describe, expect, it } from 'vitest';
import { SAVE_KEY, SAVE_VERSION, defaultSave, loadSave, migrateSave, pruneSave, storeSave, type SaveStorage } from '../src/game/progressSave';

/** An in-memory Storage; `broken` makes every call throw (blocked storage). */
function memory(init: Record<string, string> = {}, broken = false): SaveStorage & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => {
      if (broken) throw new Error('blocked');
      return k in data ? data[k] : null;
    },
    setItem: (k, v) => {
      if (broken) throw new Error('blocked');
      data[k] = v;
    },
  };
}

describe('save: defaults and migration', () => {
  it('a fresh save is empty and current', () => {
    const s = defaultSave();
    expect(s.v).toBe(SAVE_VERSION);
    expect(s.cash).toBe(0);
    expect(s.packages).toEqual([]);
    expect(s.stats.bestCombo).toBe(1);
  });

  it('anything that is not an object migrates to a fresh save', () => {
    for (const raw of [null, undefined, 42, 'cash', [1, 2, 3], true]) {
      const s = migrateSave(raw);
      expect(s).toEqual(defaultSave());
    }
  });

  it('keeps good fields and drops broken ones one by one', () => {
    const s = migrateSave({
      cash: 1234.9,
      stats: { knockouts: 12, carjacks: -3, wasted: 'lots', playTime: 61.5 },
      best: { chaosRun: 42000, free: NaN, bogus: 'x' },
      medals: { chaosRun: 'gold', 'race-ring': 'platinum' },
      raceTimes: { 'race-ring': 71.25, x: -1 },
      packages: [3, 3, 1, -2, 1.5, 'x', 7],
      frenzies: ['fz-brawl', 4, 'fz-brawl'],
      exports: { done: ['taxi-any'], lists: 2 },
      taxi: { bestStreak: 6 },
      missions: ['m1-audition'],
      unlocks: ['scanner', null],
    });
    expect(s.cash).toBe(1234);
    expect(s.stats.knockouts).toBe(12);
    expect(s.stats.carjacks).toBe(0);
    expect(s.stats.wasted).toBe(0);
    expect(s.stats.playTime).toBeCloseTo(61.5);
    expect(s.best).toEqual({ chaosRun: 42000, free: 0 });
    expect(s.medals).toEqual({ chaosRun: 'gold' });
    expect(s.raceTimes).toEqual({ 'race-ring': 71.25 });
    expect(s.packages).toEqual([1, 3, 7]);
    expect(s.frenzies).toEqual(['fz-brawl']);
    expect(s.exports).toEqual({ done: ['taxi-any'], lists: 2 });
    expect(s.taxi.bestStreak).toBe(6);
    expect(s.missions).toEqual(['m1-audition']);
    expect(s.unlocks).toEqual(['scanner']);
  });

  it('a fresh player gets the first-run pointers; a save from before them with real play skips them', () => {
    expect(defaultSave().tutorial).toBe(0);
    expect(migrateSave({ cash: 10 }).tutorial).toBe(0);
    expect(migrateSave({ stats: { playTime: 900 } }).tutorial).toBe(3);
    expect(migrateSave({ tutorial: 1, stats: { playTime: 900 } }).tutorial).toBe(1);
    expect(migrateSave({ tutorial: 99 }).tutorial).toBe(3);
    expect(migrateSave({ tutorial: -1 }).tutorial).toBe(0);
  });

  it('negative or infinite cash is reset, not trusted', () => {
    expect(migrateSave({ cash: -500 }).cash).toBe(0);
    expect(migrateSave({ cash: Infinity }).cash).toBe(0);
  });

  it("a save from a newer build keeps what this one understands and carries the rest through a write", () => {
    const s = migrateSave({ v: 99, cash: 50, hoverboards: 3, garage: { slots: ['a'] }, unlocks: 'junk' });
    expect(s.v).toBe(99); // never downgraded: the older build doesn't own it
    expect(s.cash).toBe(50);
    expect(s.unlocks).toEqual([]); // a known field is still sanitised
    const store = memory();
    storeSave(s, store);
    const back = JSON.parse(store.getItem(SAVE_KEY)!);
    expect(back).toMatchObject({ v: 99, hoverboards: 3, garage: { slots: ['a'] } });
    expect(migrateSave({ v: 0 }).v).toBe(SAVE_VERSION);
  });

  it("ids this build doesn't have don't count (packages out of range, unknown frenzies, missions, orders)", () => {
    const s = migrateSave({
      packages: [0, 1, 2, 999, -1, 3.5],
      frenzies: ['fz-brawl', 'fz-unknown'],
      missions: ['m1-audition', 'm9-future'],
      exports: { done: ['sedan-any', 'hovercraft-any'], lists: 2 },
    });
    expect(s.packages).toEqual([0, 1, 2, 999]);
    pruneSave(s, { packages: 40, frenzies: ['fz-brawl'], exportOrders: ['sedan-any', 'van-any'] });
    expect(s.packages).toEqual([0, 1, 2]);
    expect(s.frenzies).toEqual(['fz-brawl']);
    expect(s.missions).toEqual(['m1-audition', 'm9-future']); // not given: left alone
    expect(s.exports).toEqual({ done: ['sedan-any'], lists: 2 });
    pruneSave(s, { missions: ['m1-audition'] });
    expect(s.missions).toEqual(['m1-audition']);
  });

  it('carries the old free-roam best score over', () => {
    expect(migrateSave(null, 9000).best.free).toBe(9000);
    expect(migrateSave({ best: { free: 12000 } }, 9000).best.free).toBe(12000);
  });
});

describe('save: storage', () => {
  it('round-trips through storage', () => {
    const store = memory();
    const s = defaultSave();
    s.cash = 777;
    s.unlocks.push('scanner');
    expect(storeSave(s, store)).toBe(true);
    expect(loadSave(store)).toEqual(s);
  });

  it('reads the legacy best score when there is no save yet', () => {
    expect(loadSave(memory({ 'curbside.best': '4321' })).best.free).toBe(4321);
  });

  it('ignores the legacy best once a save exists (the HUD writes Chaos Run scores there too)', () => {
    const s = defaultSave();
    s.best.free = 500;
    const store = memory({ 'curbside.best': '90000' });
    storeSave(s, store);
    expect(loadSave(store).best.free).toBe(500);
  });

  it('a corrupt save starts fresh and is kept aside, not lost', () => {
    const store = memory({ [SAVE_KEY]: '{"cash": 12, "stats": {' });
    const s = loadSave(store);
    expect(s.cash).toBe(0);
    expect(store.data[`${SAVE_KEY}.corrupt`]).toBe('{"cash": 12, "stats": {');
  });

  it('blocked storage never throws', () => {
    const store = memory({}, true);
    expect(loadSave(store).cash).toBe(0);
    expect(storeSave(defaultSave(), store)).toBe(false);
    expect(loadSave(null).cash).toBe(0);
    expect(storeSave(defaultSave(), null)).toBe(false);
  });
});
