import { describe, expect, it } from 'vitest';
import { BASE_POINTS, COMBO_WINDOW, EVADE_BONUS_FROM, MAX_COMBO, Score, evadeBonus } from '../src/systems/score';

describe('chaos score', () => {
  it('chains events into a growing multiplier', () => {
    const s = new Score();
    expect(s.award('nearMiss').points).toBe(BASE_POINTS.nearMiss);
    const second = s.award('nearMiss');
    expect(second.multiplier).toBe(2);
    expect(second.points).toBe(BASE_POINTS.nearMiss * 2);
    expect(s.total).toBe(BASE_POINTS.nearMiss * 3);
  });

  it('breaks the chain after the combo window', () => {
    const s = new Score();
    s.award('smash');
    s.award('smash');
    s.step(COMBO_WINDOW + 0.1);
    expect(s.combo).toBe(1);
    expect(s.award('smash').multiplier).toBe(1);
  });

  it('caps the multiplier', () => {
    const s = new Score();
    for (let i = 0; i < 30; i++) s.award('nearMiss');
    expect(s.combo).toBe(MAX_COMBO);
  });

  it('banks a drift once the slide ends, and ignores tiny ones', () => {
    const s = new Score();
    for (let i = 0; i < 90; i++) expect(s.drift(6, 20, 1 / 60)).toBeNull(); // 1.5 s sliding
    let award = null;
    for (let i = 0; i < 60 && !award; i++) award = s.drift(0, 20, 1 / 60);
    expect(award?.kind).toBe('drift');
    expect(award!.points).toBeGreaterThan(80);

    const t = new Score();
    for (let i = 0; i < 10; i++) t.drift(4, 20, 1 / 60); // a twitch
    let none = null;
    for (let i = 0; i < 60; i++) none = none ?? t.drift(0, 20, 1 / 60);
    expect(none).toBeNull();
    expect(t.total).toBe(0);
  });

  it('banks or drops a pending drift when the slide is cut short', () => {
    const s = new Score();
    for (let i = 0; i < 90; i++) s.drift(6, 20, 1 / 60);
    const banked = s.endDrift(true);
    expect(banked?.kind).toBe('drift');
    expect(s.driftPoints).toBe(0);
    // Nothing left to bank later at a different multiplier.
    for (let i = 0; i < 60; i++) expect(s.drift(0, 20, 1 / 60)).toBeNull();

    const t = new Score();
    for (let i = 0; i < 90; i++) t.drift(6, 20, 1 / 60);
    expect(t.endDrift(false)).toBeNull();
    expect(t.driftPoints).toBe(0);
    expect(t.total).toBe(0);
  });

  it('tracks the best score', () => {
    const s = new Score(1000);
    s.award('boom');
    expect(s.best).toBe(1000);
    s.award('boom');
    s.award('boom');
    expect(s.best).toBe(s.total);
  });
});

describe('police scoring', () => {
  it('a bust fines a share of the run (and drops the combo); the best stays', () => {
    const s = new Score();
    s.award('boom');
    s.award('boom');
    const total = s.total;
    expect(s.combo).toBeGreaterThan(1);
    const fine = s.fine(0.25);
    expect(fine).toBe(Math.round(total * 0.25));
    expect(s.total).toBe(total - fine);
    expect(s.best).toBe(total);
    expect(s.combo).toBe(1);
  });

  it('only a chase of 3 stars or more pays an EVADED bonus, more for more stars', () => {
    expect(evadeBonus(EVADE_BONUS_FROM - 1)).toBe(0);
    expect(evadeBonus(3)).toBeGreaterThan(0);
    expect(evadeBonus(5)).toBeGreaterThan(evadeBonus(3));
    const s = new Score();
    expect(s.award('evaded', evadeBonus(4)).points).toBe(evadeBonus(4));
    expect(s.award('copRam').label).toBe('COP RAM');
  });
});
