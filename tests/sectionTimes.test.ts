import { describe, expect, it } from 'vitest';
import { SectionTimes } from '../src/core/sectionTimes';

describe('SectionTimes', () => {
  it('off: nothing is recorded', () => {
    let t = 0;
    const p = new SectionTimes(['a'], () => t);
    p.begin(0);
    t = 5;
    p.end(0);
    p.endFrame();
    expect(p.frames).toBe(0);
    expect(p.summary()[0]).toEqual({ name: 'a', mean: 0, p95: 0, max: 0 });
  });

  it('adds up a section entered many times a frame; mean, p95 and max over frames', () => {
    let t = 0;
    const p = new SectionTimes(['car', 'frame'], () => t);
    p.start();
    for (let f = 0; f < 100; f++) {
      // Three cars a frame, 1 ms each (the last frame's a slow one: 10 ms).
      for (let c = 0; c < 3; c++) {
        p.begin(0);
        t += f === 99 ? 10 : 1;
        p.end(0);
      }
      p.add(1, 4);
      p.endFrame();
    }
    const [car, frame] = p.summary();
    expect(p.frames).toBe(100);
    expect(p.last(0)).toBe(30);
    expect(car.p95).toBe(3);
    expect(car.max).toBe(30);
    expect(car.mean).toBeCloseTo((99 * 3 + 30) / 100, 6);
    expect(frame.mean).toBe(4);
  });

  it('start() forgets what was sampled', () => {
    const p = new SectionTimes(['a'], () => 0);
    p.start();
    p.add(0, 2);
    p.endFrame();
    p.start();
    expect(p.frames).toBe(0);
    expect(p.last(0)).toBe(0);
  });
});
