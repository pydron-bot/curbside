import { describe, expect, it } from 'vitest';
import { ResolutionController, STALL_MS, buildLadder, type QualityLevel } from '../src/render/dynamicResolution';
import { QUALITY_TIERS, tierForPreset } from '../src/render/quality';
import type { QualityPreset } from '../src/core/settings';

const HZ60 = 1000 / 60;

/** Feed `seconds` of frames whose interval comes from `interval(level, i)`; returns level changes. */
function run(c: ResolutionController, seconds: number, interval: (level: number, i: number) => number) {
  let t = 0;
  let i = 0;
  let changes = 0;
  while (t < seconds * 1000) {
    const ms = interval(c.level, i++);
    t += ms;
    if (c.sample(ms)) changes++;
  }
  return changes;
}

const phoneLadder = () => buildLadder('medium', true, 3);

describe('quality tiers', () => {
  it("'auto' picks medium on phones and high on desktops", () => {
    expect(tierForPreset('auto', { handheld: true, pixelRatio: 3 })).toBe('medium');
    expect(tierForPreset('auto', { handheld: false, pixelRatio: 2 })).toBe('high');
    expect(tierForPreset('low', { handheld: false, pixelRatio: 2 })).toBe('low');
  });

  it("a preset with no tier (a newer build's, a hand edit) acts as 'auto'", () => {
    for (const name of ['ultra', 'toString', '']) {
      expect(tierForPreset(name as QualityPreset, { handheld: true, pixelRatio: 3 })).toBe('medium');
      expect(tierForPreset(name as QualityPreset, { handheld: false, pixelRatio: 2 })).toBe('high');
    }
  });

  it('phones cap the pixel ratio at 1.5-2', () => {
    expect(QUALITY_TIERS.medium.maxPixelRatio).toBeGreaterThanOrEqual(1.5);
    expect(QUALITY_TIERS.medium.maxPixelRatio).toBeLessThanOrEqual(2);
    expect(QUALITY_TIERS.medium.bloom).toBe(false);
    expect(QUALITY_TIERS.low.shadowMapSize).toBe(0);
  });
});

describe('quality ladder', () => {
  it('phone: each tier at its own pixel cap, then resolution, never below 1x', () => {
    const l = phoneLadder();
    expect(l).toEqual([
      { tier: 'medium', pixelRatio: 1.5 },
      { tier: 'low', pixelRatio: 1.25 },
      { tier: 'low', pixelRatio: 1 },
    ]);
  });

  it('desktop: high → medium → low, every tier step also lowering resolution', () => {
    const l = buildLadder('high', true, 2);
    expect(l.map((x) => x.tier).slice(0, 3)).toEqual(['high', 'medium', 'low']);
    for (const x of l) expect(x.pixelRatio).toBeLessThanOrEqual(QUALITY_TIERS[x.tier].maxPixelRatio);
    for (let i = 1; i < l.length; i++) expect(l[i].pixelRatio).toBeLessThan(l[i - 1].pixelRatio);
    expect(l[l.length - 1].pixelRatio).toBe(1);
  });

  it('a 1x screen steps effects down first, then goes only a little below native', () => {
    expect(buildLadder('high', true, 1)).toEqual([
      { tier: 'high', pixelRatio: 1 },
      { tier: 'medium', pixelRatio: 1 },
      { tier: 'low', pixelRatio: 1 },
      { tier: 'low', pixelRatio: 0.85 },
    ]);
  });

  it('a chosen tier stays put and keeps its own pixel cap', () => {
    const l = buildLadder('high', false, 1);
    expect(l.every((x) => x.tier === 'high')).toBe(true);
    expect(l.map((x) => x.pixelRatio)).toEqual([1, 0.85]);
    expect(buildLadder('medium', false, 2)[0]).toEqual({ tier: 'medium', pixelRatio: 1.5 });
  });
});

/**
 * A GPU busy filling pixels: its work scales with pixelRatio² and ignores the
 * effects tier. Frames land on vsync, averaging the work once it's over 16.7 ms.
 */
function fillBound(ladder: QualityLevel[], msAtTop: number) {
  const top = ladder[0].pixelRatio;
  let owed = 0;
  return (level: number) => {
    const pr = ladder[level].pixelRatio;
    owed += Math.max(HZ60, (msAtTop * pr * pr) / (top * top));
    const vsyncs = Math.max(1, Math.round(owed / HZ60));
    owed -= vsyncs * HZ60;
    return vsyncs * HZ60;
  };
}

describe('resolution controller', () => {
  it('ignores the warm-up after boot', () => {
    const c = new ResolutionController(phoneLadder());
    // Shader compiles and GLB loads: awful frames for 2.5 s.
    run(c, 2.5, () => 60);
    expect(c.level).toBe(0);
  });

  it('treats a steady 33 ms (Low Power Mode) as a cap, not overload', () => {
    const c = new ResolutionController(phoneLadder());
    run(c, 10, () => HZ60); // normal at first
    const changes = run(c, 60, (_, i) => 33.33 + (i % 3) * 0.2 - 0.2);
    expect(changes).toBe(0);
    expect(c.level).toBe(0);
    expect(c.lastVerdict).toBe('capped');
  });

  it('stays sharp when capped at 30 Hz from the start', () => {
    const c = new ResolutionController(phoneLadder());
    run(c, 60, () => 33.33);
    expect(c.level).toBe(0);
  });

  it('drops quality when frames are genuinely missed, and keeps a drop that helps', () => {
    const c = new ResolutionController(phoneLadder());
    // GPU-bound: the top level misses every other vsync; anything cheaper is fine.
    const gpu = (level: number, i: number) => (level === 0 && i % 2 ? 33.3 : HZ60);
    run(c, 4, () => HZ60);
    run(c, 3.5, gpu);
    expect(c.level).toBe(1);
    run(c, 3, gpu); // the probe confirms the drop helped
    expect(c.level).toBe(1);
  });

  it('undoes a drop that does not help (CPU-bound) and stops trying for a while', () => {
    const c = new ResolutionController(phoneLadder());
    const cpu = (_: number, i: number) => (i % 2 ? 33.3 : HZ60); // same at every level
    run(c, 3.5, () => HZ60);
    const changes = run(c, 25, cpu);
    expect(c.level).toBe(0);
    expect(changes).toBe(2); // one drop, one undo
  });

  it('climbs back cautiously, at most one step per 10 s', () => {
    const ladder = phoneLadder();
    const c = new ResolutionController(ladder);
    c.level = ladder.length - 1;
    const changes = run(c, 25, () => HZ60);
    expect(changes).toBeGreaterThanOrEqual(1);
    expect(changes).toBeLessThanOrEqual(2);
    run(c, 60, () => HZ60);
    expect(c.level).toBe(0);
  });

  it('does not pump between two levels when only the lower one fits', () => {
    const c = new ResolutionController(phoneLadder());
    const gpu = (level: number, i: number) => (level === 0 && i % 2 ? 33.3 : HZ60);
    run(c, 3.5, () => HZ60);
    const changes = run(c, 180, gpu);
    // Drop, then a few probing raises with growing back-off — not one every couple of seconds.
    expect(changes).toBeLessThanOrEqual(7);
    expect(c.level).toBe(1);
  });

  it('lowers resolution on a fill-bound phone (effects steps alone would not help)', () => {
    const ladder = phoneLadder();
    const c = new ResolutionController(ladder);
    run(c, 4, () => HZ60);
    // 22 ms of pixel work at 1.5x; at 1.25x it's 15.3 ms and fits.
    run(c, 300, fillBound(ladder, 22));
    expect(c.current.pixelRatio).toBe(1.25);
    // Heavier still: all the way to the 1x floor.
    const d = new ResolutionController(ladder);
    run(d, 4, () => HZ60);
    run(d, 120, fillBound(ladder, 40));
    expect(d.current).toEqual({ tier: 'low', pixelRatio: 1 });
  });

  it('keeps going past effects-only steps to the resolution step that helps', () => {
    const ladder = buildLadder('high', true, 1); // high@1, medium@1, low@1, low@0.85
    const c = new ResolutionController(ladder);
    const load = fillBound(ladder, 20); // 20 ms at 1x, 14.5 ms at 0.85x: only the last rung fits
    run(c, 4, () => HZ60);
    run(c, 8, load);
    expect(c.level).toBe(3);
    // Later probing raises fail and back off; it settles where it fits.
    run(c, 120, load);
    expect(c.level).toBe(3);
  });

  it('puts effects-only steps back too when the resolution step after them does not help', () => {
    const c = new ResolutionController(buildLadder('high', true, 1));
    const cpu = (_: number, i: number) => (i % 2 ? 33.3 : HZ60);
    run(c, 3.5, () => HZ60);
    const changes = run(c, 25, cpu);
    expect(c.level).toBe(0);
    expect(changes).toBe(4); // three drops, one undo
  });

  it('is happy at 100 fps on a 144 Hz screen', () => {
    const c = new ResolutionController(buildLadder('high', true, 2));
    run(c, 3.5, () => 6.94);
    run(c, 30, (_, i) => (i % 3 ? 9 : 11));
    expect(c.level).toBe(0);
  });

  it('ignores stalls like a tab switch', () => {
    const c = new ResolutionController(phoneLadder());
    run(c, 5, () => HZ60);
    c.sample(2000);
    run(c, 0.5, () => 50); // the catch-up frames right after
    run(c, 5, () => HZ60);
    expect(c.level).toBe(0);
  });

  it('treats a hitch as a stall even when the caller clamps it to the sim limit', () => {
    expect(STALL_MS).toBeLessThan(250);
    const c = new ResolutionController(phoneLadder());
    run(c, 5, () => HZ60);
    // A 1 s shader compile, clamped to 0.25 s the way main clamps sim time,
    // then a second of catch-up stutter: none of it is judged.
    c.sample(Math.min(250, 1000));
    run(c, 0.9, (_, i) => (i % 2 ? 40 : HZ60));
    expect(c.lastInterval).toBeCloseTo(HZ60, 0);
    run(c, 5, () => HZ60);
    expect(c.level).toBe(0);
  });

  it('holdOff gives a fresh warm-up', () => {
    const c = new ResolutionController(phoneLadder());
    run(c, 5, () => HZ60);
    c.holdOff(3);
    run(c, 2.8, (_, i) => (i % 2 ? 40 : HZ60));
    expect(c.level).toBe(0);
  });

  it('a new ladder starts from the top', () => {
    const c = new ResolutionController(phoneLadder());
    c.level = 2;
    const fresh: QualityLevel[] = buildLadder('high', false, 2);
    c.setLadder(fresh);
    expect(c.current).toEqual(fresh[0]);
  });
});
