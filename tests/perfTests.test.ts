import { describe, expect, it } from 'vitest';
import { FixedStep } from '../src/core/loop';
import { crowdTestScale, loadPerfTests, parsePerfTests, perfTests, perfTestsLabel, savePerfTests, simStepCap, trafficTestScale } from '../src/core/perfTests';

function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('Low Power Mode test switches', () => {
  it('read only true flags; anything unreadable is all off', () => {
    expect(parsePerfTests(null)).toEqual({ sim: false, crowd: false, traffic: false });
    expect(parsePerfTests('{nope')).toEqual({ sim: false, crowd: false, traffic: false });
    expect(parsePerfTests('{"sim":true,"crowd":"yes","traffic":true,"extra":1}')).toEqual({ sim: true, crowd: false, traffic: true });
  });

  it('save, load, label and the scales they give', () => {
    const s = store();
    Object.assign(perfTests, { sim: false, crowd: true, traffic: false });
    savePerfTests(s);
    Object.assign(perfTests, { sim: false, crowd: false, traffic: false });
    loadPerfTests(s);
    expect(perfTests.crowd).toBe(true);
    expect(perfTestsLabel(perfTests)).toBe('CROWD ½');
    expect(crowdTestScale()).toBe(0.5);
    expect(trafficTestScale()).toBe(1);
    expect(simStepCap(5)).toBe(5);
    Object.assign(perfTests, { sim: false, crowd: false, traffic: false });
    expect(perfTestsLabel(perfTests)).toBe('');
  });

  it('one sim step a frame: at 30 fps the sim runs at half speed and never builds a backlog', () => {
    Object.assign(perfTests, { sim: true, crowd: false, traffic: false });
    const loop = new FixedStep(1 / 60);
    loop.maxStepsPerFrame = simStepCap(5);
    let steps = 0;
    for (let i = 0; i < 30; i++) loop.advance(1 / 30, () => steps++);
    expect(steps).toBe(30);
    Object.assign(perfTests, { sim: false });
  });
});
