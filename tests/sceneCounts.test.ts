import { describe, expect, it } from 'vitest';
import {
  BoomWindow,
  BOOM_WINDOW,
  countsSummary,
  DIP_COOLDOWN_MS,
  DipDetector,
  emptyCounts,
  formatCounts,
  roundCounts,
  sceneKinds,
} from '../src/core/sceneCounts';

/** Feed `ms` of frames at `interval` ms; returns how many dips fired. */
function run(d: DipDetector, ms: number, interval: number): number {
  let dips = 0;
  for (let t = 0; t < ms; t += interval) if (d.sample(interval)) dips++;
  return dips;
}

describe('dip detector', () => {
  it('stays quiet at 60 fps, and through a few lone hitches', () => {
    const d = new DipDetector();
    expect(run(d, 10_000, 16.7)).toBe(0);
    // Two 80 ms hitches a second are under 5% of the frames: not a dip.
    let dips = 0;
    for (let s = 0; s < 5; s++) {
      dips += run(d, 840, 16.7);
      if (d.sample(80)) dips++;
      if (d.sample(80)) dips++;
    }
    expect(dips).toBe(0);
  });

  it('fires within a second of frames going slow, with that window', () => {
    const d = new DipDetector();
    run(d, 3000, 16.7);
    let at = -1;
    for (let t = 0; t < 2000 && at < 0; t += 30) if (d.sample(30)) at = t;
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThanOrEqual(2000);
    expect(d.last.p95).toBeCloseTo(30);
    expect(d.last.fps).toBeCloseTo(33.3, 0);
  });

  it('fires at most once per cooldown while it stays slow', () => {
    const d = new DipDetector();
    const dips = run(d, 20_000, 30);
    expect(dips).toBeGreaterThanOrEqual(3);
    expect(dips).toBeLessThanOrEqual(Math.ceil(20_000 / DIP_COOLDOWN_MS));
  });

  it('one long stall (a window with few frames) is not a dip', () => {
    const d = new DipDetector();
    expect(d.sample(3000)).toBe(false);
    expect(d.sample(NaN)).toBe(false);
    expect(d.sample(-5)).toBe(false);
  });
});

describe('explosion window', () => {
  it('counts the explosions in the last BOOM_WINDOW seconds, in a fixed ring', () => {
    const b = new BoomWindow(4);
    b.add(1);
    b.add(2);
    b.add(9);
    expect(b.count(9)).toBe(3);
    expect(b.count(1 + BOOM_WINDOW + 0.5)).toBe(2);
    for (let i = 0; i < 10; i++) b.add(20);
    expect(b.count(20)).toBe(4); // the ring holds 4
    b.clear();
    expect(b.count(20)).toBe(0);
  });
});

describe('counts text', () => {
  it('lists running scenes by kind with counts', () => {
    expect(sceneKinds(['medic', 'dog', 'fire', 'tow'], [1, 3, 0, 2])).toEqual({ count: 6, kinds: 'medic dog×3 tow×2' });
    expect(sceneKinds(['a'], [])).toEqual({ count: 0, kinds: '' });
  });

  it('formats the overlay and summary lines, and rounds for the log', () => {
    const c = { ...emptyCounts(), hot: 120, soft: 80, big: 9, fill: 1.234, glows: 40, glowFill: 0.55, fires: 3, firesSeen: 2, people: 30, peopleSeen: 12, scenes: 4, kinds: 'fire×2 dog×2' };
    expect(formatCounts(c)).toContain('fx 120/80 big 9 fill 1.2');
    expect(formatCounts(c)).toContain('fire 2/3');
    expect(formatCounts(c)).toContain('scenes 4 fire×2 dog×2');
    expect(countsSummary(c)).toContain('people 12/30');
    const r = roundCounts(c);
    expect(r.fill).toBe(1.2);
    expect(r.glowFill).toBe(0.6);
    expect(r).not.toBe(c);
  });
});
