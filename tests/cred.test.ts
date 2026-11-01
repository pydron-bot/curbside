import { describe, expect, it } from 'vitest';
import {
  MAXED_LEVEL_CASH,
  NEUTRAL,
  PERKS,
  PERK_IDS,
  PERK_RANKS,
  cashInMaxed,
  credForLife,
  defaultCred,
  levelCost,
  levelFor,
  offerFor,
  pendingLevels,
  perkEffects,
  pick,
  rankOf,
  sanitiseCred,
  type CredSave,
} from '../src/game/cred';

const totalFor = (level: number) => Array.from({ length: level }, (_, i) => levelCost(i + 1)).reduce((a, b) => a + b, 0);

describe('CRED for a life', () => {
  it('a good three minutes earns about 130; a quick death a handful; nothing is never negative', () => {
    const good = credForLife({ points: 20_000, seconds: 180, peakStars: 3, cash: 1000 });
    expect(good).toBeGreaterThan(110);
    expect(good).toBeLessThan(160);
    expect(credForLife({ points: 1200, seconds: 25, peakStars: 0, cash: 0 })).toBeLessThan(20);
    expect(credForLife({ points: -5, seconds: -1, peakStars: -2, cash: -100 })).toBe(0);
    expect(credForLife({ points: NaN, seconds: 0, peakStars: 0, cash: 0 })).toBe(0);
  });

  it('a wild five minutes at 5 stars is about 250, so level 5 takes several such lives', () => {
    const wild = credForLife({ points: 52_000, seconds: 300, peakStars: 5, cash: 0 });
    expect(wild).toBeGreaterThan(200);
    expect(wild).toBeLessThan(300);
    expect(totalFor(5) / wild).toBeGreaterThan(3.5);
  });

  it('every part counts, and stars count more the higher they go', () => {
    const base = { points: 0, seconds: 0, peakStars: 0, cash: 0 };
    for (const k of ['points', 'seconds', 'cash'] as const) expect(credForLife({ ...base, [k]: 3000 })).toBeGreaterThan(0);
    const star = (s: number) => credForLife({ ...base, peakStars: s });
    expect(star(2) - star(1)).toBeLessThan(star(5) - star(4));
    expect(star(9)).toBe(star(5));
  });
});

describe('levels', () => {
  it('cost 100, then 50 more each', () => {
    expect([1, 2, 3, 10].map(levelCost)).toEqual([100, 150, 200, 550]);
  });

  it('levelFor counts levels reached and the way into the next', () => {
    expect(levelFor(0)).toEqual({ level: 0, into: 0, need: 100 });
    expect(levelFor(99)).toEqual({ level: 0, into: 99, need: 100 });
    expect(levelFor(100)).toEqual({ level: 1, into: 0, need: 150 });
    expect(levelFor(260)).toEqual({ level: 2, into: 10, need: 200 });
  });

  it('maxing every perk takes about a hundred wild lives', () => {
    const levels = PERKS.length * PERK_RANKS;
    const cred = totalFor(levels);
    expect(levelFor(cred).level).toBe(levels);
    expect(cred / 250).toBeGreaterThan(80);
    expect(cred / 250).toBeLessThan(150);
  });
});

describe('picking perks', () => {
  const save = (total: number, perks: CredSave['perks'] = {}, picked = 0): CredSave => ({ total, picked, perks });

  it('offers three different perks, the same three every time for the same level', () => {
    const c = save(totalFor(1));
    const a = offerFor(c);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(offerFor({ ...c, perks: {} })).toEqual(a);
    // The next level draws again.
    const seen = new Set<string>();
    for (let picked = 0; picked < 20; picked++) seen.add(offerFor(save(0, {}, picked)).join());
    expect(seen.size).toBeGreaterThan(5);
  });

  it('every perk turns up in offers', () => {
    const seen = new Set<string>();
    for (let picked = 0; picked < 40; picked++) for (const id of offerFor(save(0, {}, picked))) seen.add(id);
    expect([...seen].sort()).toEqual([...PERK_IDS].sort());
  });

  it('a pick needs a pending level and a perk with a rank to spare', () => {
    const c = save(totalFor(2));
    expect(pendingLevels(c)).toBe(2);
    expect(pick(c, 'tough')).toBe(true);
    expect(pick(c, 'tough')).toBe(true);
    expect(rankOf(c, 'tough')).toBe(2);
    expect(pendingLevels(c)).toBe(0);
    expect(pick(c, 'ghost')).toBe(false);
    const full = save(totalFor(9), { tough: PERK_RANKS }, 4);
    expect(pick(full, 'tough')).toBe(false);
    expect(offerFor(full)).not.toContain('tough');
  });

  it('with every perk maxed, a level pays cash instead', () => {
    const perks = Object.fromEntries(PERK_IDS.map((id) => [id, PERK_RANKS]));
    const levels = PERK_IDS.length * PERK_RANKS;
    const c = save(totalFor(levels + 2), perks, levels);
    expect(offerFor(c)).toEqual([]);
    expect(cashInMaxed(c)).toBe(MAXED_LEVEL_CASH);
    expect(cashInMaxed(c)).toBe(MAXED_LEVEL_CASH);
    expect(cashInMaxed(c)).toBe(0);
    // Not while something is still on offer.
    expect(cashInMaxed(save(totalFor(1)))).toBe(0);
  });
});

describe('effects', () => {
  it('no perks is neutral', () => {
    expect(perkEffects(defaultCred())).toEqual(NEUTRAL);
  });

  it('maxed is a clear edge, not god mode', () => {
    const e = perkEffects({ total: 0, picked: 0, perks: Object.fromEntries(PERK_IDS.map((id) => [id, PERK_RANKS])) });
    expect(e.maxHealth).toBe(60);
    expect(e.armour).toBe(100);
    expect(e.carDamage).toBeCloseTo(0.6);
    expect(e.nitroFill).toBeCloseTo(1.6);
    expect(e.grabTime).toBeCloseTo(1.6);
    expect(e.evadeTime).toBeCloseTo(0.68);
    expect(e.bills).toBeCloseTo(0.2);
    expect(e.bank).toBeCloseTo(1.4);
  });

  it("each card line says what that perk's ranks add up to", () => {
    for (const p of PERKS) {
      expect(p.says(1).length, p.id).toBeGreaterThan(0);
      expect(p.says(1)).not.toBe(p.says(2));
      expect(p.says(PERK_RANKS).length, p.id).toBeLessThanOrEqual(40);
    }
  });
});

describe('the save record', () => {
  it('cleans up anything', () => {
    expect(sanitiseCred(undefined)).toEqual(defaultCred());
    expect(sanitiseCred([1, 2])).toEqual(defaultCred());
    const c = sanitiseCred({ total: 350.7, picked: 99, perks: { tough: 9, ghost: -1, nope: 3, vest: '2' } });
    expect(c.total).toBe(350);
    expect(c.perks).toEqual({ tough: PERK_RANKS });
    // Two levels earned (350 CRED): picks capped there.
    expect(c.picked).toBe(2);
  });

  it('a rank held counts as a level cashed in', () => {
    const c = sanitiseCred({ total: totalFor(3), picked: 0, perks: { banker: 2 } });
    expect(c.picked).toBe(2);
    expect(pendingLevels(c)).toBe(1);
  });
});
