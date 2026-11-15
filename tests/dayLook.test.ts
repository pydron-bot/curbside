import { describe, expect, it } from 'vitest';
import { CODE_LOOK, DAY_LOOKS, DAY_LOOK_KEYS, clampLook, parseLookFile, serialiseLookFile, type LookKey } from '../src/render/lookTuning';
import { GRADE_UNIFORM, setDayGrade, writeGrade } from '../src/render/post';
import { packShadow, shadowedLight, unpackShadow, shadowTintInstalled } from '../src/render/shadowTint';

describe('sun shadows coloured by the sky', () => {
  it('pack darkness and tint into the one shadow uniform, and back', () => {
    for (const [d, t] of [[0, 0], [0.92, 0], [0.5, 1], [1, 1.3], [0.66, 2]]) {
      const [d2, t2] = unpackShadow(packShadow(d, t));
      expect(d2).toBeCloseTo(d, 6);
      expect(t2).toBeCloseTo(t, 2);
    }
    expect(packShadow(0.7, 0)).toBe(0.7);
  });

  it("is three's own shadow with no tint, and lifts full shadow with one", () => {
    // three: mix(1, lit, darkness).
    for (const lit of [0, 0.4, 1]) expect(shadowedLight(lit, 0.8, 0, 1)).toBeCloseTo(1 + (lit - 1) * 0.8, 6);
    expect(shadowedLight(0, 0.8, 1, 1)).toBeGreaterThan(shadowedLight(0, 0.8, 0, 1));
    expect(shadowedLight(1, 0.8, 1.5, 1)).toBe(1);
  });

  it("patched three's lights chunk", () => {
    expect(shadowTintInstalled).toBe(true);
  });
});

/** Sliders that change the picture at night too: a day look must not touch them. */
const ALL_HOURS: readonly LookKey[] = ['exposure', 'saturation', 'darkSaturation', 'violetShadows', 'roseHighlights', 'pinkMids', 'contrast', 'shadowDarkness', 'nightBrightness', 'moonlight', 'nightFill'];

describe('three day looks', () => {
  it('are three candidates plus TODAY, in range, setting day-only sliders', () => {
    expect(DAY_LOOKS.map((d) => d.label)).toEqual(['TODAY', 'SUNNY PASTEL', 'HAZY GOLD', 'COMIC']);
    expect(DAY_LOOKS[0].values).toEqual({});
    for (const d of DAY_LOOKS) {
      for (const [k, v] of Object.entries(d.values) as Array<[LookKey, number]>) {
        expect(clampLook(k, v)).toBe(v);
        expect(ALL_HOURS).not.toContain(k);
      }
    }
    expect(DAY_LOOK_KEYS).toContain('shadowTint');
  });

  it('each round-trips as a look.json', () => {
    for (const d of DAY_LOOKS.slice(1)) {
      const v = { ...CODE_LOOK, ...d.values };
      expect(parseLookFile(JSON.parse(serialiseLookFile(v)))).toEqual(v);
    }
  });

  it("ship today's look: no shadow colour, the day grade neutral", () => {
    expect(CODE_LOOK.shadowTint).toBe(0);
    for (const k of ['dayShadows', 'shadowSoftness', 'daySaturation', 'dayContrast'] as const) expect(CODE_LOOK[k]).toBe(1);
    expect(CODE_LOOK.dayWarmth).toBe(0);
  });

  it('scale the grade by day only: at night (day 0) it is the sliders’ grade', () => {
    writeGrade({ saturation: 1, darkSaturation: 1, violetShadows: 1, roseHighlights: 1, pinkMids: 1, contrast: 1 });
    const before = [...GRADE_UNIFORM];
    setDayGrade(0, 1.4, 1.25, 0.9);
    expect([...GRADE_UNIFORM]).toEqual(before);
    setDayGrade(1, 1.4, 1.25, 0.9);
    expect(GRADE_UNIFORM[5]).toBeCloseTo(before[5] * 1.4, 5);
    expect(GRADE_UNIFORM[7]).toBeCloseTo(before[7] * 1.25, 5);
    expect(GRADE_UNIFORM[12]).toBeGreaterThan(before[12]);
    setDayGrade(1, 1, 1, 0);
    expect([...GRADE_UNIFORM]).toEqual(before);
  });
});
