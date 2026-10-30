import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { BUST_FINE } from '../src/game/heat';
import { BUST_FINE_CAP, HOSPITAL_BILL, Progress, betterMedal, bustFine, hospitalBill, type CashChange } from '../src/game/progress';
import { ChainBank, POINTS_PER_DOLLAR, chainCash, chainLive } from '../src/game/progressBank';
import { defaultSave, type SaveStorage } from '../src/game/progressSave';
import type { Award } from '../src/systems/score';

const award = (points: number, multiplier = 1, kind: Award['kind'] = 'nearMiss'): Award => ({ kind, label: '', points, multiplier });

describe('banking your chaos', () => {
  it('pays points / 10 × (1 + 0.5 · stars)', () => {
    expect(POINTS_PER_DOLLAR).toBe(10);
    expect(chainCash(1000, 0)).toBe(100);
    expect(chainCash(1000, 1)).toBe(150);
    expect(chainCash(1000, 3)).toBe(250);
    expect(chainCash(1000, 5)).toBe(350);
    expect(chainCash(999, 0)).toBe(99);
    expect(chainCash(0, 5)).toBe(0);
    expect(chainCash(-50, 2)).toBe(0);
    // A perk bonus multiplies the lot.
    expect(chainCash(1000, 2, 1.25)).toBe(250);
  });

  it('a chain banks at the highest wanted level it reached', () => {
    const bank = new ChainBank();
    bank.add(400, 0);
    bank.add(600, 2);
    bank.add(1000, 1);
    expect(bank.open).toBe(true);
    expect(bank.points).toBe(2000);
    expect(bank.close()).toBe(400);
    expect(bank.open).toBe(false);
    expect(bank.close()).toBe(0);
  });

  it('losing the chain (wasted / busted) pays nothing and reports what was lost', () => {
    const bank = new ChainBank();
    bank.add(1500, 3);
    expect(bank.lose()).toBe(1500);
    expect(bank.points).toBe(0);
    expect(bank.close()).toBe(0);
  });

  it('a chain is live while the combo window is open or a drift is sliding', () => {
    expect(chainLive({ comboTimer: 0.2, driftPoints: 0 })).toBe(true);
    expect(chainLive({ comboTimer: 0, driftPoints: 40 })).toBe(true);
    expect(chainLive({ comboTimer: 0, driftPoints: 0 })).toBe(false);
  });
});

describe('progress: cash', () => {
  it('earns, spends and refuses what it cannot afford', () => {
    const p = new Progress(null, null);
    const log: CashChange[] = [];
    p.onCash((c) => log.push(c));
    expect(p.earn(250.7, 'chain')).toBe(250);
    expect(p.earn(0, 'chain')).toBe(0);
    expect(p.earn(-10, 'chain')).toBe(0);
    expect(p.spend(400, 'shop')).toBe(false);
    expect(p.cash).toBe(250);
    expect(p.spend(100, 'shop')).toBe(true);
    expect(p.cash).toBe(150);
    expect(p.stats.cashEarned).toBe(250);
    expect(p.stats.cashSpent).toBe(100);
    expect(log.map((c) => [c.amount, c.total, c.reason])).toEqual([
      [250, 250, 'chain'],
      [-100, 150, 'shop'],
    ]);
  });

  it('bills and fines take what there is, never more', () => {
    const p = new Progress(null, null);
    p.earn(120, 'x');
    expect(p.charge(hospitalBill(p.cash), 'hospital')).toBe(120);
    expect(p.cash).toBe(0);
    expect(p.charge(500, 'fine')).toBe(0);
  });

  it('hospital bill and bust fine follow the rules', () => {
    expect(hospitalBill(50)).toBe(50);
    expect(hospitalBill(10_000)).toBe(HOSPITAL_BILL);
    expect(bustFine(1000)).toBe(Math.round(1000 * BUST_FINE));
    expect(bustFine(1_000_000)).toBe(BUST_FINE_CAP);
    expect(bustFine(0)).toBe(0);
  });

  it('records bests, medals, unlocks and completions once', () => {
    const p = new Progress(null, null);
    expect(p.recordBest('chaosRun', 100)).toBe(true);
    expect(p.recordBest('chaosRun', 50)).toBe(false);
    expect(p.best('chaosRun')).toBe(100);
    expect(p.recordMedal('chaosRun', 'silver')).toBe(true);
    expect(p.recordMedal('chaosRun', 'bronze')).toBe(false);
    expect(p.recordMedal('chaosRun', null)).toBe(false);
    expect(p.recordMedal('chaosRun', 'gold')).toBe(true);
    expect(p.medal('chaosRun')).toBe('gold');
    expect(betterMedal('gold', null)).toBe(true);
    expect(betterMedal(null, 'bronze')).toBe(false);
    expect(p.unlock('scanner')).toBe(true);
    expect(p.unlock('scanner')).toBe(false);
    expect(p.has('scanner')).toBe(true);
    expect(p.complete('frenzies', 'fz-brawl')).toBe(true);
    expect(p.complete('frenzies', 'fz-brawl')).toBe(false);
  });

  it('batches saves: written within a few seconds of a change, or on flush', () => {
    const writes: string[] = [];
    const store: SaveStorage = { getItem: () => null, setItem: (_k, v) => void writes.push(v) };
    const p = new Progress(defaultSave(), store);
    p.earn(10, 'x');
    p.step(1);
    expect(writes).toHaveLength(0);
    p.step(4);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]).cash).toBe(10);
    p.step(5);
    expect(writes).toHaveLength(1); // nothing new
    p.earn(5, 'x');
    p.flush();
    expect(writes).toHaveLength(2);
  });

  it('counts lifetime stats from the bus while live', () => {
    const bus = new EventBus();
    let live = true;
    const p = new Progress(null, null);
    p.track(bus, () => live);
    bus.emit({ type: 'award', award: award(300, 4) });
    bus.emit({ type: 'pedDown', x: 0, z: 0, cause: 'punch', byPlayer: true });
    bus.emit({ type: 'pedDown', x: 0, z: 0, cause: 'punch', byPlayer: false, isPlayer: true });
    bus.emit({ type: 'explosion', x: 0, z: 0, distance: 0, byPlayer: true, ownCar: true });
    bus.emit({ type: 'explosion', x: 0, z: 0, distance: 0, byPlayer: true });
    bus.emit({ type: 'carjack', x: 0, z: 0 });
    bus.emit({ type: 'wanted', level: 3, prev: 2, reason: 'crime' });
    bus.emit({ type: 'playerDied' });
    live = false;
    bus.emit({ type: 'carjack', x: 0, z: 0 });
    const s = p.stats;
    expect(s.chaosPoints).toBe(300);
    expect(s.bestCombo).toBe(5);
    expect(s.knockouts).toBe(1);
    expect(s.carsWrecked).toBe(1);
    expect(s.carjacks).toBe(1);
    expect(s.maxStars).toBe(3);
    expect(s.wasted).toBe(1);
  });
});
