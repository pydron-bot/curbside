import { describe, expect, it } from 'vitest';
import { TimingRing, emptyTiming } from '../src/core/timingRing';

describe('TimingRing', () => {
  it('average, p95 and max of a known sequence', () => {
    const t = new TimingRing(100);
    for (let i = 1; i <= 100; i++) t.sample(i / 10, 1 / 60);
    const s = t.summarize(emptyTiming());
    expect(s.avg).toBeCloseTo(5.05, 5);
    expect(s.p95).toBeCloseTo(9.5, 5);
    expect(s.max).toBeCloseTo(10, 5);
    expect(s.samples).toBe(100);
    expect(s.total).toBe(100);
  });

  it('the window wraps: old samples drop out', () => {
    const t = new TimingRing(10);
    for (let i = 0; i < 10; i++) t.sample(50, 0);
    for (let i = 0; i < 10; i++) t.sample(1, 0);
    const s = t.summarize(emptyTiming());
    expect(s.max).toBe(1);
    expect(s.avg).toBe(1);
    expect(s.samples).toBe(10);
    expect(s.total).toBe(20);
  });

  it('per-second averages survive coarse timers', () => {
    const t = new TimingRing(600, 10);
    // A 1 ms-quantised clock reading a 0.25 ms step: three 0s and a 1, over and over.
    for (let i = 0; i < 240; i++) t.sample(i % 4 === 3 ? 1 : 0, 1 / 60);
    const s = t.summarize(emptyTiming());
    expect(s.seconds).toBe(4);
    expect(s.secAvgMax).toBeCloseTo(0.25, 5);
    expect(s.secAvgP95).toBeCloseTo(0.25, 5);
    expect(s.p95).toBe(1);
  });

  it('summarize fills and returns the object passed; empty reads 0; reset empties', () => {
    const t = new TimingRing(8);
    const out = emptyTiming();
    expect(t.summarize(out)).toBe(out);
    expect(out).toEqual(emptyTiming());
    t.sample(2, 1);
    t.sample(NaN, 1);
    t.sample(-1, 1);
    expect(t.summarize(out).samples).toBe(1);
    t.reset();
    expect(t.summarize(out)).toEqual(emptyTiming());
  });
});
