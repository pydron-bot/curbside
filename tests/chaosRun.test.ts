import { describe, expect, it } from 'vitest';
import {
  BOOM_BONUS,
  CHAOS_MEDALS,
  CHAOS_RUN_SECONDS,
  COMBO_BONUS,
  CHAOS_LOADOUT,
  ChaosRun,
  armForRun,
  categoryOf,
  chaosMedal,
  nextMedal,
  type ChaosCue,
} from '../src/game/modes/chaosRun';
import type { Award } from '../src/systems/score';
import { Arsenal, WEAPONS } from '../src/systems/weapons';

const award = (kind: Award['kind'], points: number, multiplier = 1): Award => ({ kind, label: '', points, multiplier });

function run(r: ChaosRun, seconds: number, dt = 1 / 60): ChaosCue[] {
  const out: ChaosCue[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    r.step(dt);
    out.push(...r.cues.splice(0));
  }
  return out;
}

describe('chaos run: clock', () => {
  it('runs two minutes, counts the last ten seconds out loud, then ends', () => {
    const r = new ChaosRun();
    expect(r.timeLeft).toBe(CHAOS_RUN_SECONDS);
    const cues = run(r, CHAOS_RUN_SECONDS + 1);
    const counts = cues.filter((c) => c.kind === 'count').map((c) => (c as { n: number }).n);
    expect(counts).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(cues.at(-1)).toEqual({ kind: 'end', reason: 'time' });
    expect(r.running).toBe(false);
    expect(r.elapsed).toBeCloseTo(CHAOS_RUN_SECONDS, 1);
  });

  it('an explosion you cause buys 5 s; your own car, or someone else’s, buys nothing', () => {
    const r = new ChaosRun();
    r.explosion(true, false);
    r.explosion(true, true);
    r.explosion(false, false);
    expect(r.timeLeft).toBe(CHAOS_RUN_SECONDS + BOOM_BONUS);
    expect(r.bonusTime).toBe(BOOM_BONUS);
    expect(r.cues).toEqual([{ kind: 'bonus', seconds: BOOM_BONUS, why: 'boom' }]);
  });

  it('reaching a ×5 combo buys 3 s (each time a chain gets there)', () => {
    const r = new ChaosRun();
    for (let m = 1; m <= 6; m++) r.award(award('nearMiss', 100 * m, m));
    expect(r.bonusTime).toBe(COMBO_BONUS);
    r.award(award('nearMiss', 100, 4));
    expect(r.bonusTime).toBe(2 * COMBO_BONUS);
  });

  it('tallies points and counts per category, cop stuff together', () => {
    const r = new ChaosRun();
    r.award(award('drift', 300));
    r.award(award('drift', 500, 2));
    r.award(award('copRam', 400, 2));
    r.award(award('evaded', 3000, 3));
    expect(r.tally.drift).toEqual({ count: 2, points: 800 });
    expect(r.tally.cops).toEqual({ count: 2, points: 3400 });
    expect(categoryOf('copWreck')).toBe('cops');
    expect(categoryOf('knockout')).toBe('knockout');
  });

  it('ends early when wasted or busted, and stops counting', () => {
    const r = new ChaosRun();
    run(r, 30);
    r.end('wasted');
    expect(r.ended).toBe('wasted');
    r.award(award('boom', 500));
    r.explosion(true, false);
    expect(r.tally.boom.count).toBe(0);
    const before = r.timeLeft;
    run(r, 5);
    expect(r.timeLeft).toBe(before);
    r.end('time');
    expect(r.ended).toBe('wasted');
  });
});

describe('chaos run: medals', () => {
  it('bronze, silver, gold at the thresholds', () => {
    expect(chaosMedal(CHAOS_MEDALS.bronze - 1)).toBeNull();
    expect(chaosMedal(CHAOS_MEDALS.bronze)).toBe('bronze');
    expect(chaosMedal(CHAOS_MEDALS.silver)).toBe('silver');
    expect(chaosMedal(CHAOS_MEDALS.gold + 1)).toBe('gold');
    expect(CHAOS_MEDALS.bronze).toBeLessThan(CHAOS_MEDALS.silver);
    expect(CHAOS_MEDALS.silver).toBeLessThan(CHAOS_MEDALS.gold);
  });

  it('says what the next medal takes', () => {
    expect(nextMedal(0)).toEqual({ medal: 'bronze', at: CHAOS_MEDALS.bronze });
    expect(nextMedal(CHAOS_MEDALS.bronze)).toEqual({ medal: 'silver', at: CHAOS_MEDALS.silver });
    expect(nextMedal(CHAOS_MEDALS.gold)).toBeNull();
  });
});

describe('chaos run: loadout', () => {
  it('every run starts with the same guns, whatever was carried in', () => {
    const a = new Arsenal();
    for (const k of ['rocket', 'grenade', 'smg', 'smg'] as const) a.pickUp(k);
    a.current = 'rocket';
    armForRun(a);
    expect([...a.ammo.entries()].filter(([, n]) => n > 0)).toEqual(CHAOS_LOADOUT.map((k) => [k, WEAPONS[k].pickupAmmo]));
    expect(a.current).toBe(CHAOS_LOADOUT[0]);
    expect(a.has('rocket')).toBe(false);
  });
});
