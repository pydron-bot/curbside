import { describe, expect, it } from 'vitest';
import { LOD_CLOSE, LOD_FAR, LOD_FULL, LOD_NEAR, LOD_NEAR_RANGE, LOD_VIEW_MARGIN, SimLod, newSimClock } from '../src/systems/simLod';

const DT = 1 / 60;
const VIEW = { minX: -30, minZ: -10, maxX: 30, maxZ: 10 };

/** Run `steps` sim steps for the clocks on `tier`; returns each clock's tick count and time integrated. */
function run(lod: SimLod, clocks: ReturnType<typeof newSimClock>[], tier: 0 | 1 | 2, steps: number) {
  const ticks = clocks.map(() => 0);
  const time = clocks.map(() => 0);
  const perStep: number[] = [];
  for (let s = 0; s < steps; s++) {
    lod.begin(0, 0, VIEW);
    let n = 0;
    clocks.forEach((c, i) => {
      const dt = lod.due(c, tier, DT);
      if (dt > 0) {
        ticks[i]++;
        time[i] += dt;
        n++;
      }
    });
    perStep.push(n);
  }
  return { ticks, time, perStep };
}

describe('SimLod tiers', () => {
  const lod = new SimLod();
  lod.begin(0, 0, VIEW);

  it('on screen (and the margin round it) and close by: every step', () => {
    expect(lod.tier(25, 10)).toBe(LOD_FULL);
    expect(lod.tier(30 + LOD_VIEW_MARGIN - 1, 0)).toBe(LOD_FULL);
    expect(lod.tier(0, 10 + LOD_VIEW_MARGIN + 1)).toBe(LOD_FULL); // off screen, but within LOD_CLOSE
    expect(LOD_CLOSE).toBeGreaterThan(10 + LOD_VIEW_MARGIN + 1);
  });

  it('off screen: 15 Hz within LOD_NEAR_RANGE, 5 Hz beyond', () => {
    expect(lod.tier(0, 40)).toBe(LOD_NEAR);
    expect(lod.tier(0, -(LOD_NEAR_RANGE - 1))).toBe(LOD_NEAR);
    expect(lod.tier(LOD_NEAR_RANGE + 1, 40)).toBe(LOD_FAR);
  });

  it('disabled: everything full', () => {
    const off = new SimLod();
    off.enabled = false;
    off.begin(0, 0, VIEW);
    expect(off.tier(500, 500)).toBe(LOD_FULL);
  });
});

describe('SimLod ticks', () => {
  it('a tier ticks at its rate and integrates every second of sim time', () => {
    const lod = new SimLod();
    for (const [tier, hz] of [
      [LOD_FULL, 60],
      [LOD_NEAR, 15],
      [LOD_FAR, 5],
    ] as const) {
      const clocks = Array.from({ length: 24 }, newSimClock);
      const r = run(lod, clocks, tier, 120);
      for (const t of r.ticks) expect(t).toBe(hz * 2);
      // All the time owed is paid on a tick (the last tick may be a step or so back).
      for (const [i, t] of r.time.entries()) expect(t + clocks[i].owed).toBeCloseTo(2, 9);
    }
  });

  it('round-robin buckets spread the ticks evenly over the steps', () => {
    const lod = new SimLod();
    const clocks = Array.from({ length: 24 }, newSimClock);
    const near = run(lod, clocks, LOD_NEAR, 48).perStep;
    expect(Math.max(...near)).toBe(6);
    expect(Math.min(...near)).toBe(6);
    const far = run(lod, clocks, LOD_FAR, 48).perStep;
    expect(Math.max(...far)).toBe(2);
    expect(Math.min(...far)).toBe(2);
  });

  it('pinned runs every step and pays what was owed at once', () => {
    const lod = new SimLod();
    const c = newSimClock();
    let owed = 0;
    // Skip steps at 5 Hz until something is owed.
    for (let i = 0; i < 12 && owed === 0; i++) {
      lod.begin(0, 0, VIEW);
      if (lod.due(c, LOD_FAR, DT) === 0) owed = c.owed;
    }
    expect(owed).toBeGreaterThan(0);
    lod.begin(0, 0, VIEW);
    const dt = lod.due(c, LOD_FAR, DT, true);
    expect(dt).toBeCloseTo(owed + DT, 9);
    expect(c.owed).toBe(0);
    expect(c.tier).toBe(LOD_FULL);
  });

  it('settle pays now between ticks; dt reads 0 on a skipped step', () => {
    const lod = new SimLod();
    const c = newSimClock();
    let skipped = false;
    for (let i = 0; i < 4 && !skipped; i++) {
      lod.begin(0, 0, VIEW);
      skipped = lod.due(c, LOD_NEAR, DT) === 0;
    }
    expect(skipped).toBe(true);
    expect(c.dt).toBe(0);
    const owed = c.owed;
    expect(lod.settle(c)).toBe(owed);
    expect(c.dt).toBe(owed);
    expect(c.owed).toBe(0);
  });
});
