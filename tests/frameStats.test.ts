import { describe, expect, it } from 'vitest';
import { emptySummary, FrameStats, formatFps, formatFrameStats } from '../src/core/frameStats';

const run = (fs: FrameStats, ms: number, frames: number, js = 2) => {
  for (let i = 0; i < frames; i++) fs.sample(ms, js);
};

describe('frameStats', () => {
  it('nothing sampled gives zeros, not NaN', () => {
    const s = new FrameStats().summarize(emptySummary());
    expect(s).toEqual(emptySummary());
  });

  it('steady 60 Hz: fps, percentiles and no hitches', () => {
    const fs = new FrameStats();
    run(fs, 1000 / 60, 600);
    const s = fs.summarize(emptySummary());
    expect(s.fps).toBeCloseTo(60, 0);
    expect(s.p50).toBeCloseTo(16.67, 1);
    expect(s.p99).toBeCloseTo(16.67, 1);
    expect(s.hitchesPerMin).toBe(0);
    expect(s.capped30).toBe(false);
  });

  it('percentiles see the slow tail', () => {
    const fs = new FrameStats();
    // 100 frames: 90 at 10 ms, 9 at 20 ms, 1 at 80 ms.
    run(fs, 10, 90);
    run(fs, 20, 9);
    run(fs, 80, 1);
    const s = fs.summarize(emptySummary());
    expect(s.p50).toBe(10);
    expect(s.p95).toBe(20);
    expect(s.p99).toBe(20);
    expect(s.max).toBe(80);
    expect(s.frames).toBe(100);
  });

  it('hitches are counted per minute of the window', () => {
    const fs = new FrameStats();
    // 6 s of frames with 3 hitches over 50 ms (one over 100 ms): 30 and 10 per minute.
    run(fs, 1000 / 60, 330);
    fs.sample(60, 1);
    fs.sample(70, 1);
    fs.sample(120, 1);
    run(fs, (6000 - 330 * (1000 / 60) - 250) / 30, 30);
    const s = fs.summarize(emptySummary());
    expect(s.hitchesPerMin).toBeCloseTo(30, 0);
    expect(s.bigHitchesPerMin).toBeCloseTo(10, 0);
  });

  it('the ring wraps: old frames drop out of the window', () => {
    const fs = new FrameStats();
    run(fs, 200, 100); // 20 s of 5 fps
    run(fs, 8, 1300); // more than the ring holds
    const s = fs.summarize(emptySummary());
    expect(s.max).toBe(8);
    expect(s.hitchesPerMin).toBe(0);
    expect(s.fps).toBeCloseTo(125, 0);
  });

  it('percentiles cover about 10 s, not the whole ring', () => {
    const fs = new FrameStats();
    run(fs, 100, 50); // 5 s of hitches, then 12 s smooth
    run(fs, 20, 600);
    const s = fs.summarize(emptySummary());
    expect(s.max).toBe(20);
  });

  it('a slow renderer reads a fraction of a frame per second, never 0', () => {
    const fs = new FrameStats();
    run(fs, 2500, 5);
    const s = fs.summarize(emptySummary());
    expect(s.fps).toBeCloseTo(0.4, 2);
    expect(formatFps(s.fps)).toBe('0.4');
    expect(formatFps(59.6)).toBe('60');
  });

  it('a steady 33 ms run is flagged as a 30 Hz cap', () => {
    const fs = new FrameStats();
    run(fs, 33.3, 300);
    const s = fs.summarize(emptySummary());
    expect(s.capped30).toBe(true);
    expect(formatFrameStats(s)).toContain('30 Hz');
  });

  it('JS time is reported separately from the frame interval', () => {
    const fs = new FrameStats();
    for (let i = 0; i < 100; i++) fs.sample(16.7, i < 95 ? 3 : 12);
    expect(fs.summarize(emptySummary()).jsP95).toBe(3);
    fs.sample(16.7, 12);
    // Within the sort throttle, the cached percentiles stand.
    expect(fs.summarize(emptySummary()).jsP95).toBe(3);
    run(fs, 16.7, 20, 12);
    expect(fs.summarize(emptySummary()).jsP95).toBe(12);
  });

  it('bad intervals are ignored', () => {
    const fs = new FrameStats();
    fs.sample(-5, 1);
    fs.sample(0, 1);
    fs.sample(NaN, 1);
    fs.sample(Infinity, 1);
    expect(fs.summarize(emptySummary()).frames).toBe(0);
  });

  it('fills and returns the object it was given', () => {
    const fs = new FrameStats();
    run(fs, 16, 10);
    const out = emptySummary();
    expect(fs.summarize(out)).toBe(out);
    expect(formatFrameStats(out)).toMatch(/^\d+ fps · [\d.]+\/[\d.]+\/[\d.]+\/[\d.]+ ms · \d+ hitch\/min · JS p95 [\d.]+ ms$/);
  });
});
