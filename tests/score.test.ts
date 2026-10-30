import { describe, expect, it } from 'vitest';
import { createVehicleState } from '../src/entities/vehicle';
import { collideVehicles, type CarContact } from '../src/systems/physics';
import { BASE_POINTS, COMBO_WINDOW, EVADE_BONUS_FROM, MAX_COMBO, Score, evadeBonus, rammed, smashCredit } from '../src/systems/score';

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

describe('who rammed whom', () => {
  // A real contact between car A (x, z, heading, vx, vz) and car B; returns
  // [impact, A's closing speed, B's closing speed].
  function hit(a: number[], b: number[]): [number, number, number] {
    const ca = createVehicleState(a[0], a[1], a[2]);
    const cb = createVehicleState(b[0], b[1], b[2]);
    ca.vx = a[3];
    ca.vz = a[4];
    cb.vx = b[3];
    cb.vz = b[4];
    const contact: CarContact = { x: 0, z: 0, nx: 0, nz: 0, closingA: 0, closingB: 0 };
    const impact = collideVehicles(ca, cb, contact);
    return [impact, contact.closingA, contact.closingB];
  }

  it('the stopped car that gets rear-ended scores nothing; the rammer does', () => {
    const [impact, rammer, stopped] = hit([0, 0, Math.PI / 2, 15, 0], [4.4, 0, Math.PI / 2, 0, 0]);
    expect(impact).toBeGreaterThan(6);
    expect(smashCredit(impact, stopped, rammer)).toBe(false);
    expect(smashCredit(impact, rammer, stopped)).toBe(true);
  });

  it('a head-on counts for both cars', () => {
    const [impact, a, b] = hit([0, 0, Math.PI / 2, 10, 0], [4.4, 0, -Math.PI / 2, -10, 0]);
    expect(smashCredit(impact, a, b)).toBe(true);
    expect(smashCredit(impact, b, a)).toBe(true);
  });

  it('driving across and getting T-boned is not ramming', () => {
    // B crosses along +z; A drives into its side along +x.
    const [impact, a, b] = hit([-3.2, 0, Math.PI / 2, 15, 0], [0, 0, 0, 0, 10]);
    expect(impact).toBeGreaterThan(6);
    expect(smashCredit(impact, b, a)).toBe(false);
    expect(smashCredit(impact, a, b)).toBe(true);
  });

  it('pulling away from a car that rams you is not ramming; a light bump never scores', () => {
    expect(rammed(-2, 17)).toBe(false); // rear-ended while moving off
    expect(rammed(2, 0)).toBe(false); // too slow to be a ram
    expect(rammed(6, 10)).toBe(false); // under 40% of the closing speed
    expect(rammed(8, 10)).toBe(true);
    expect(smashCredit(5, 5, 0)).toBe(false);
  });
});
