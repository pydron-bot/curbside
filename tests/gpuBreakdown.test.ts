import { describe, expect, it } from 'vitest';
import { ALL, GPU_LAYERS, GpuBreakdownRun, baselineOf, breakdownLines, layerOf, type GpuBreakdownResult } from '../src/core/gpuBreakdown';

describe('GPU breakdown', () => {
  it('sorts the scene by object name into parts, unknowns into "everything else"', () => {
    expect(layerOf('city')).toBe('city');
    expect(layerOf('groundDecals')).toBe('ground');
    expect(layerOf('props_trees')).toBe('props');
    expect(layerOf('characters-cop')).toBe('people');
    expect(layerOf('gulls')).toBe('people');
    expect(layerOf('cars')).toBe('cars');
    expect(layerOf('heli')).toBe('cars');
    expect(layerOf('glows')).toBe('glows');
    expect(layerOf('fxSoft')).toBe('particles');
    expect(layerOf('rain')).toBe('particles');
    expect(layerOf('contactShadows')).toBe('contact');
    expect(layerOf('rubble')).toBe('rubble');
    expect(layerOf('')).toBe('other');
    expect(layerOf('stingers')).toBe('other');
  });

  it('measures everything, each part left out, then everything again, skipping the warm-up frames', () => {
    const run = new GpuBreakdownRun(GPU_LAYERS, 2, 3);
    expect(run.plan[0]).toBe(ALL);
    expect(run.plan[run.plan.length - 1]).toBe(ALL);
    expect(run.plan.length).toBe(GPU_LAYERS.length + 2);
    // Warm-up frames are slow and must not count.
    expect(run.sample(1, 500)).toBe(false);
    expect(run.sample(1, 500)).toBe(false);
    expect(run.sample(2, 30)).toBe(false);
    expect(run.sample(2, 32)).toBe(false);
    expect(run.sample(2, 31)).toBe(true);
    expect(run.current).toBe('shadows');
    expect(run.results()[0]).toMatchObject({ key: ALL, total: 31, cpu: 2, frames: 3 });
    let guard = 0;
    while (run.current !== null && guard++ < 1000) run.sample(1, 20);
    expect(run.current).toBeNull();
    expect(run.results().length).toBe(run.plan.length);
    expect(run.sample(1, 20)).toBe(false);
  });

  it('reports what leaving each part out saved, biggest first, against the mean of both full frames', () => {
    const r: GpuBreakdownResult = {
      at: '',
      tier: 'medium',
      ratio: 1.5,
      dc: 60,
      steps: [
        { key: ALL, label: 'everything', total: 30, cpu: 6, p90: 34, frames: 20 },
        { key: 'glows', label: 'glows and lights', total: 24, cpu: 6, p90: 26, frames: 20 },
        { key: 'shadows', label: 'sun shadow pass', total: 27, cpu: 5, p90: 29, frames: 20 },
        { key: 'cars', label: 'cars', total: 33, cpu: 6, p90: 35, frames: 20 },
        { key: 'pixels', label: 'half the pixels', total: 30, cpu: 6, p90: 33, frames: 20 },
        { key: 'empty', label: 'nothing drawn', total: 4, cpu: 1, p90: 5, frames: 20 },
        { key: ALL, label: 'everything', total: 32, cpu: 6, p90: 36, frames: 20 },
      ],
    };
    expect(baselineOf(r.steps)).toBe(31);
    const lines = breakdownLines(r);
    expect(lines[1]).toContain('30.0');
    expect(lines[1]).toContain('32.0');
    expect(lines[2]).toContain('nothing drawn 4.0');
    expect(lines[3]).toContain('glows and lights off: −7.0 ms (23%)');
    expect(lines[4]).toContain('sun shadow pass off: −4.0');
    // Noise can make a part look free or worse: shown as +.
    expect(lines[5]).toContain('at half the pixels: −1.0');
    expect(lines[6]).toContain('cars off: +2.0 ms (6%)');
  });
});
