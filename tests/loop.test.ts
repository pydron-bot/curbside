import { describe, expect, it } from 'vitest';
import { FixedStep } from '../src/core/loop';

describe('FixedStep', () => {
  it('runs whole steps and carries the remainder as alpha', () => {
    const loop = new FixedStep(0.1);
    let steps = 0;
    const alpha = loop.advance(0.25, () => steps++);
    expect(steps).toBe(2);
    expect(alpha).toBeCloseTo(0.5);
  });

  it('accumulates small frames until a step is due', () => {
    const loop = new FixedStep(0.1);
    let steps = 0;
    loop.advance(0.06, () => steps++);
    expect(steps).toBe(0);
    loop.advance(0.06, () => steps++);
    expect(steps).toBe(1);
  });

  it('caps steps per frame and drops the backlog after a stall', () => {
    const loop = new FixedStep(0.1, 5);
    let steps = 0;
    const alpha = loop.advance(10, () => steps++);
    expect(steps).toBe(5);
    expect(alpha).toBe(0);
    loop.advance(0.1, () => steps++);
    expect(steps).toBe(6);
  });

  it('ignores negative frame times', () => {
    const loop = new FixedStep(0.1);
    let steps = 0;
    loop.advance(-1, () => steps++);
    loop.advance(0.1, () => steps++);
    expect(steps).toBe(1);
  });
});
