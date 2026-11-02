import { describe, expect, it } from 'vitest';
import { InViewMeter, LONG_QUIET } from '../src/systems/inViewMeter';

describe('InViewMeter', () => {
  it('counts seconds in view, starts, and episodes seen or ended unseen, per kind', () => {
    const m = new InViewMeter(['race', 'bus'], [true, false]);
    // A race starts unseen, comes into view for a second, then ends.
    m.sample(0, 1, false, 0.25);
    m.tick(0.25);
    for (let i = 0; i < 4; i++) {
      m.sample(0, 1, true, 0.25);
      m.tick(0.25);
    }
    m.sample(0, 0, false, 0.25);
    // A bus comes and goes without being seen.
    m.sample(1, 1, false, 0.25);
    m.sample(1, 0, false, 0.25);
    m.tick(0.25);
    const r = m.report();
    expect(r.rows).toEqual([
      { kind: 'race', seconds: 1, started: 1, seen: 1, unseen: 0 },
      { kind: 'bus', seconds: 0, started: 1, seen: 0, unseen: 1 },
    ]);
    expect(r.played).toBe(1.5);
    expect(r.anyInView).toBe(1);
    expect(m.line()).toContain('race 1/1/1/0');
  });

  it('only incidents end a quiet stretch; long ones are counted once each', () => {
    const m = new InViewMeter(['fight', 'bus'], [true, false]);
    for (let t = 0; t < LONG_QUIET + 10; t += 1) {
      m.sample(1, 1, true, 1);
      m.tick(1);
    }
    expect(m.longQuiets).toBe(1);
    expect(m.longestQuiet).toBe(LONG_QUIET + 10);
    m.sample(0, 1, true, 1);
    m.tick(1);
    expect(m.quiet).toBe(0);
    expect(m.anyInView).toBe(1);
    for (let t = 0; t < 20; t++) m.tick(1);
    expect(m.longQuiets).toBe(1);
  });

  it('a reset of the scenes is not an unseen ending; clear() starts over', () => {
    const m = new InViewMeter(['chase'], [true]);
    m.sample(0, 1, false, 0.25);
    m.cut();
    m.sample(0, 0, false, 0.25);
    expect(m.unseen[0]).toBe(0);
    expect(m.started[0]).toBe(1);
    m.clear();
    expect(m.report().rows[0]).toEqual({ kind: 'chase', seconds: 0, started: 0, seen: 0, unseen: 0 });
  });

  it('samples without allocating: the same typed arrays, and the heap does not grow per sample', () => {
    const m = new InViewMeter(['a', 'b', 'c'], [true, true, false]);
    const arrays = [m.seconds, m.started, m.seen, m.unseen];
    const run = (n: number) => {
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < 3; i++) m.sample(i, (k >> i) & 1, (k & 2) === 0, 0.25);
        m.tick(0.25);
      }
    };
    run(10_000); // warm (JIT)
    const g = (globalThis as { gc?: () => void }).gc;
    g?.();
    const before = process.memoryUsage().heapUsed;
    run(200_000);
    const grown = process.memoryUsage().heapUsed - before;
    [m.seconds, m.started, m.seen, m.unseen].forEach((a, i) => expect(a).toBe(arrays[i]));
    expect(m.seconds[0]).toBeGreaterThan(0);
    // 200k samples allocating even one small object each would be several MB.
    expect(grown).toBeLessThan(2_000_000);
  });
});
