import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core/events';
import { FRENZIES, FRENZY_COUNTDOWN, FrenzyRun, frenzyCredit, type FrenzyDef } from '../src/game/modes/frenzies';
import { placeFrenzyTokens } from '../src/game/modes/places';
import type { Award } from '../src/systems/score';

const award = (kind: Award['kind'], points = 100, multiplier = 1): GameEvent => ({ type: 'award', award: { kind, label: '', points, multiplier } });
const down = (byPlayer: boolean, isPlayer = false): GameEvent => ({ type: 'pedDown', x: 0, z: 0, cause: 'punch', byPlayer, isPlayer });
const boom = (byPlayer: boolean, ownCar = false): GameEvent => ({ type: 'explosion', x: 0, z: 0, distance: 0, byPlayer, ownCar });

describe('frenzies: data', () => {
  it('eight frenzies, each with a token on the map', () => {
    expect(FRENZIES).toHaveLength(8);
    const tokens = placeFrenzyTokens();
    expect(new Set(FRENZIES.map((f) => f.id))).toEqual(new Set(tokens.map((t) => t.id)));
  });
});

describe('frenzies: what counts', () => {
  it('knockdowns by the player, not of the player', () => {
    expect(frenzyCredit('knockdown', down(true))).toBe(1);
    expect(frenzyCredit('knockdown', down(false))).toBe(0);
    expect(frenzyCredit('knockdown', down(true, true))).toBe(0);
  });

  it('wrecks the player caused, not their own car', () => {
    expect(frenzyCredit('wreck', boom(true))).toBe(1);
    expect(frenzyCredit('wreck', boom(true, true))).toBe(0);
    expect(frenzyCredit('wreck', boom(false))).toBe(0);
  });

  it('drift counts banked drift points; stunts count by kind; combo reads the level reached', () => {
    expect(frenzyCredit('drift', award('drift', 640, 2))).toBe(640);
    expect(frenzyCredit('drift', award('nearMiss'))).toBe(0);
    expect(frenzyCredit('nearMiss', award('nearMiss'))).toBe(1);
    expect(frenzyCredit('smash', award('smash'))).toBe(1);
    expect(frenzyCredit('hitAndRun', award('knockout'))).toBe(0);
    expect(frenzyCredit('carjack', { type: 'carjack', x: 0, z: 0 })).toBe(1);
    expect(frenzyCredit('combo', award('nearMiss', 100, 6))).toBe(7);
  });
});

describe('frenzies: a run', () => {
  const def: FrenzyDef = { id: 't', title: 'KNOCK DOWN 3', goal: 'knockdown', target: 3, seconds: 10 };

  it('counts only after the 3-2-1, passes at the target', () => {
    const r = new FrenzyRun(def);
    expect(r.event(down(true))).toBe(false);
    r.step(FRENZY_COUNTDOWN + 0.01);
    expect(r.phase).toBe('live');
    r.event(down(true));
    r.event(down(true));
    expect(r.phase).toBe('live');
    r.event(down(true));
    expect(r.phase).toBe('passed');
    expect(r.done).toBe(true);
  });

  it('fails when the clock runs out, or when called off', () => {
    const r = new FrenzyRun(def);
    r.step(FRENZY_COUNTDOWN + 0.01);
    for (let i = 0; i < 700; i++) r.step(1 / 60);
    expect(r.phase).toBe('failed');
    const s = new FrenzyRun(def);
    s.fail();
    expect(s.phase).toBe('failed');
  });

  it('a combo frenzy keeps the highest combo, not a sum', () => {
    const r = new FrenzyRun({ id: 'c', title: '', goal: 'combo', target: 8, seconds: 30 });
    r.step(FRENZY_COUNTDOWN + 0.01);
    r.event(award('nearMiss', 100, 5));
    r.event(award('nearMiss', 100, 2));
    expect(r.count).toBe(6);
    r.event(award('nearMiss', 100, 7));
    expect(r.phase).toBe('passed');
  });
});
