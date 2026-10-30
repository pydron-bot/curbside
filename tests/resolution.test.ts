import { describe, expect, it } from 'vitest';
import { ResolutionController, buildLadder, type QualityLevel } from '../src/render/dynamicResolution';
import { QUALITY_TIERS, tierForPreset } from '../src/render/quality';

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

  it('phones cap the pixel ratio at 1.5-2', () => {
    expect(QUALITY_TIERS.medium.maxPixelRatio).toBeGreaterThanOrEqual(1.5);
    expect(QUALITY_TIERS.medium.maxPixelRatio).toBeLessThanOrEqual(2);
    expect(QUALITY_TIERS.medium.bloom).toBe(false);
    expect(QUALITY_TIERS.low.shadowMapSize).toBe(0);
  });
});

describe('quality ladder', () => {
  it('steps effects down before resolution, and never below 1x on a high-DPI phone', () => {
    const l = phoneLadder();
    expect(l[0]).toEqual({ tier: 'medium', pixelRatio: 1.5 });
    expect(l[1]).toEqual({ tier: 'low', pixelRatio: 1.5 });
    expect(l.slice(2).map((x) => x.pixelRatio)).toEqual([1.25, 1]);
    expect(Math.min(...l.map((x) => x.pixelRatio))).toBe(1);
  });

  it('desktop: high → medium → low at 2x, then resolution', () => {
    const l = buildLadder('high', true, 2);
    expect(l.map((x) => x.tier).slice(0, 3)).toEqual(['high', 'medium', 'low']);
    expect(l.slice(0, 3).every((x) => x.pixelRatio === 2)).toBe(true);
    expect(l[l.length - 1].pixelRatio).toBe(1);
  });

  it('a chosen tier stays put; 1x screens only go a little below native', () => {
    const l = buildLadder('high', false, 1);
    expect(l.every((x) => x.tier === 'high')).toBe(true);
    expect(l.map((x) => x.pixelRatio)).toEqual([1, 0.85]);
  });
});

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
