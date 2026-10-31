import { afterEach, describe, expect, it } from 'vitest';
import { createDirectionalState, directionalControls } from '../src/core/steering';
import {
  TUNE_DEFAULTS,
  TUNE_KEY,
  TUNE_SPECS,
  changedTune,
  clampTune,
  loadTune,
  resetTune,
  sanitiseTune,
  setTune,
  setTuneEnabled,
  stepTune,
  tune,
  tuneSummary,
} from '../src/core/touchTuning';
import { pedalsAt, type PedalLayout } from '../src/ui/pedalZones';

function memoryStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

afterEach(() => {
  loadTune(null);
  resetTune();
  setTuneEnabled(false);
});

describe('touch tuning', () => {
  it('defaults are the shipped constants (no change in feel when untouched)', () => {
    expect(TUNE_DEFAULTS).toEqual({
      stickR: 58,
      steerDz: 0.08,
      steerExpo: 1.5,
      driveDz: 0.1,
      walkDz: 0.08,
      dirGain: 2.2,
      dirDeadzone: 0.1,
      aimR: 52,
      aimDz: 0.14,
      pedalReach: 1.45,
      pedalScale: 1,
    });
    expect(tune).toEqual(TUNE_DEFAULTS);
    for (const s of TUNE_SPECS) {
      expect(s.def).toBeGreaterThanOrEqual(s.min);
      expect(s.def).toBeLessThanOrEqual(s.max);
      expect(clampTune(s.key, s.def)).toBe(s.def);
    }
  });

  it('clamps to the range, snaps to the step, and defaults non-numbers', () => {
    expect(clampTune('stickR', 999)).toBe(84);
    expect(clampTune('stickR', -5)).toBe(40);
    expect(clampTune('stickR', 61)).toBe(62);
    expect(clampTune('dirGain', 2.2 + 0.1 + 0.1 + 0.1)).toBe(2.5);
    expect(clampTune('pedalScale', Number.NaN)).toBe(1);
    expect(clampTune('aimDz', '0.2')).toBe(0.14);
    expect(sanitiseTune({ stickR: 1e9, bogus: 3, aimR: null })).toEqual({ ...TUNE_DEFAULTS, stickR: 84 });
    expect(sanitiseTune('garbage')).toEqual(TUNE_DEFAULTS);
  });

  it('applies only while enabled; disabling restores the shipped feel', () => {
    loadTune(memoryStore());
    setTune('stickR', 70);
    expect(tune.stickR).toBe(58);
    setTuneEnabled(true);
    expect(tune.stickR).toBe(70);
    setTuneEnabled(false);
    expect(tune.stickR).toBe(58);
    expect(tuneSummary()).toBe('TUNE stickR 70 (inactive)');
  });

  it('persists only the changed values and reads them back; RESET clears them', () => {
    const kv = memoryStore();
    loadTune(kv);
    setTuneEnabled(true);
    stepTune('pedalScale', 1);
    stepTune('dirGain', -1);
    expect(JSON.parse(kv.m.get(TUNE_KEY)!)).toEqual({ dirGain: 2.1, pedalScale: 1.05 });
    expect(changedTune()).toEqual({ dirGain: 2.1, pedalScale: 1.05 });
    resetTune();
    loadTune(memoryStore({ [TUNE_KEY]: JSON.stringify({ dirGain: 2.1, pedalScale: 1.05 }) }));
    expect(tune.dirGain).toBe(2.1);
    expect(tune.pedalScale).toBe(1.05);
    resetTune();
    expect(tune).toEqual(TUNE_DEFAULTS);
    expect(tuneSummary()).toBe('TUNE defaults');
  });

  it('survives unreadable storage', () => {
    loadTune({
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('quota');
      },
    });
    setTuneEnabled(true);
    expect(tune).toEqual(TUNE_DEFAULTS);
    expect(setTune('aimR', 60)).toBe(60);
    expect(tune.aimR).toBe(60);
  });

  it('pedal reach follows the tuning', () => {
    const layout: PedalLayout = {
      gas: { x: 100, y: 100, r: 40 },
      brake: { x: 0, y: 100, r: 30 },
      hand: { x: 100, y: 0, r: 25 },
      chord: { minX: -1, minY: -1, maxX: -1, maxY: -1 },
    };
    const at = (x: number) => {
      const out = { gas: false, brake: false, hand: false };
      pedalsAt(x, 100, layout, out);
      return out.gas;
    };
    // 1.6 radii right of GAS: outside the default reach (1.45), inside 1.7.
    expect(at(164)).toBe(false);
    setTuneEnabled(true);
    setTune('pedalReach', 1.7);
    expect(at(164)).toBe(true);
  });

  it('point-to-steer gain and deadzone follow the tuning', () => {
    const car = { x: 0, z: 0, heading: 0, vx: 0, vz: 0, speed: 0, angVel: 0 } as never;
    const out = { throttle: 0, steer: 0, handbrake: false } as never as Parameters<typeof directionalControls>[3];
    const input = { x: 0.05, y: -0.06, gas: false, brake: false, handbrake: false };
    // A stick length of ~0.078: past a 0.05 deadzone, inside the default 0.1.
    directionalControls(input, car, createDirectionalState(), out);
    expect(out.steer).toBe(0);
    setTuneEnabled(true);
    setTune('dirDeadzone', 0.05);
    directionalControls(input, car, createDirectionalState(), out);
    const base = out.steer;
    expect(base).not.toBe(0);
    setTune('dirGain', 1.1);
    directionalControls({ ...input, x: 0.02, y: -0.07 }, car, createDirectionalState(), out);
    const soft = out.steer;
    setTune('dirGain', 2.2);
    directionalControls({ ...input, x: 0.02, y: -0.07 }, car, createDirectionalState(), out);
    expect(Math.abs(out.steer)).toBeCloseTo(Math.abs(soft) * 2, 5);
  });
});
