import { readFileSync } from 'node:fs';
import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../src/core/sessionLog';
import {
  CODE_LOOK,
  LOOK_KEY,
  LOOK_SPECS,
  LookTuning,
  clampLook,
  formatLook,
  lookDistance,
  parseLookFile,
  sanitiseLook,
  serialiseLookFile,
  SHADER_LOOK,
  SHADER_LOOK_FLOATS,
  shaderLookGlsl,
  writeShaderLook,
  type LookValues,
} from '../src/render/lookTuning';
import { GRADE_BASE, GRADE_UNIFORM, getExposure, setExposure, writeGrade } from '../src/render/post';
import { KEYS, chroma, createSkyState, hueTurn, sampleSky, setSkyKeys, tuneKeys } from '../src/render/timeOfDay';

function memoryStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('LOOK sliders', () => {
  it('have unique keys, defaults inside their ranges, and plain labels', () => {
    const keys = LOOK_SPECS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of LOOK_SPECS) {
      expect(s.def).toBeGreaterThanOrEqual(s.min);
      expect(s.def).toBeLessThanOrEqual(s.max);
      expect(s.label).toMatch(/^[A-Z &'-]+$/);
      expect(clampLook(s.key, s.def)).toBe(s.def);
    }
  });

  it('clamps and snaps values, and drops non-numbers', () => {
    expect(clampLook('neon', 5)).toBe(2);
    expect(clampLook('neon', -1)).toBe(0);
    expect(clampLook('neon', 1.234)).toBe(1.23);
    expect(clampLook('sunsetPink', 12.6)).toBe(13);
    expect(clampLook('neon', 'loud')).toBe(1);
    expect(clampLook('neon', NaN, 0.5)).toBe(0.5);
  });

  it('sanitises stored objects over a base', () => {
    const base = { ...CODE_LOOK, neon: 1.4 };
    const v = sanitiseLook({ neon: 9, moonlight: 0.5, bogus: 3, windows: 'x' }, base);
    expect(v.neon).toBe(2);
    expect(v.moonlight).toBe(0.5);
    expect(v.windows).toBe(1);
    expect('bogus' in v).toBe(false);
    expect(sanitiseLook(null, base).neon).toBe(1.4);
    expect(sanitiseLook([1, 2], base).neon).toBe(1.4);
  });

  it('shows values and distances in plain units', () => {
    expect(formatLook('neon', 1.15)).toBe('115%');
    expect(formatLook('sunsetPink', -8)).toBe('−8°');
    expect(formatLook('lampWhite', 0.3)).toBe('+30%');
    expect(lookDistance('neon', 1.15, 1)).toBe('+15%');
    expect(lookDistance('neon', 0.9, 1.2)).toBe('−30%');
    expect(lookDistance('neon', 1.2, 1.2)).toBe('');
    expect(lookDistance('nightHue', 5, 0)).toBe('+5°');
  });
});

describe('look.json', () => {
  it('round-trips, holding only what differs from the code, in panel order', () => {
    const v: LookValues = { ...CODE_LOOK, moonlight: 1.3, nightBrightness: 0.9, sunsetPink: -12 };
    const text = serialiseLookFile(v);
    expect(text).toBe('{\n  "version": 1,\n  "look": {\n    "nightBrightness": 0.9,\n    "moonlight": 1.3,\n    "sunsetPink": -12\n  }\n}\n');
    expect(parseLookFile(JSON.parse(text))).toEqual(v);
    expect(serialiseLookFile(CODE_LOOK)).toBe('{\n  "version": 1,\n  "look": {}\n}\n');
  });

  it('reads an unknown version or junk as the code look', () => {
    expect(parseLookFile({ version: 99, look: { neon: 2 } })).toEqual(CODE_LOOK);
    expect(parseLookFile('nope')).toEqual(CODE_LOOK);
  });

  it('the shipped file parses cleanly and is canonical', () => {
    const text = readFileSync(new URL('../src/render/look.json', import.meta.url), 'utf8');
    const v = parseLookFile(JSON.parse(text));
    expect(serialiseLookFile(v)).toBe(text);
  });
});

describe('LookTuning', () => {
  it('layers the owner over the shipped look, saving only what differs', () => {
    const shipped = { ...CODE_LOOK, neon: 1.2 };
    const kv = memoryStore({ [LOOK_KEY]: JSON.stringify({ moonlight: 0.6, neon: 'x', junk: 1 }) });
    const t = new LookTuning(shipped);
    let calls = 0;
    t.onChange(() => calls++);
    t.load(kv);
    expect(t.look.moonlight).toBe(0.6);
    expect(t.look.neon).toBe(1.2);
    expect(t.changed).toBe(1);
    expect(calls).toBe(1);

    expect(t.set('neon', 1.5)).toBe(1.5);
    expect(JSON.parse(kv.data[LOOK_KEY])).toEqual({ moonlight: 0.6, neon: 1.5 });
    t.reset('neon');
    expect(t.look.neon).toBe(1.2);
    expect(JSON.parse(kv.data[LOOK_KEY])).toEqual({ moonlight: 0.6 });
    // Setting the shipped value by hand drops it from the store too.
    t.set('moonlight', 1);
    expect(JSON.parse(kv.data[LOOK_KEY])).toEqual({});

    t.set('windows', 0.4);
    t.resetAll();
    expect(t.look).toEqual(shipped);
    expect(t.changed).toBe(0);
    // The export is a whole look over the code's (it replaces look.json).
    t.set('lamps', 1.1);
    expect(parseLookFile(JSON.parse(t.exportFile()))).toEqual({ ...shipped, lamps: 1.1 });
  });

  it('applies the owner values only while enabled, keeping them', () => {
    const t = new LookTuning();
    t.load(memoryStore({ [LOOK_KEY]: JSON.stringify({ neon: 0.5 }) }));
    t.setEnabled(false);
    expect(t.look.neon).toBe(1);
    expect(t.value('neon')).toBe(0.5);
    t.set('windows', 1.3);
    expect(t.look.windows).toBe(1);
    t.setEnabled(true);
    expect(t.look.neon).toBe(0.5);
    expect(t.look.windows).toBe(1.3);
    expect(t.changed).toBe(2);
  });

  it('copes with a broken or missing store', () => {
    const t = new LookTuning();
    t.load({ getItem: () => '{oops', setItem: () => {} });
    expect(t.look).toEqual(CODE_LOOK);
    t.load(null);
    t.set('neon', 0.5);
    expect(t.look.neon).toBe(0.5);
    const throwing = new LookTuning();
    throwing.load({
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
    });
    expect(throwing.set('neon', 0.7)).toBe(0.7);
  });
});

describe('sky tuning', () => {
  it('leaves the keys exactly as written at the defaults', () => {
    expect(tuneKeys(CODE_LOOK)).toEqual(KEYS);
  });

  it('scales each band on its own', () => {
    const keys = tuneKeys({ ...CODE_LOOK, nightBrightness: 1.5, sunlight: 0.5, dayHaze: 2 });
    KEYS.forEach((k, i) => {
      const t = keys[i];
      expect(t.exposure).toBeCloseTo(k.exposure * (k.band === 'night' ? 1.5 : 1));
      expect(t.light).toBeCloseTo(k.light * (k.band === 'day' ? 0.5 : 1));
      const haze = k.band === 'night' || k.band === 'dusk' ? 1 : 2;
      expect(t.fogFar).toBeCloseTo(k.fogFar * haze);
    });
    // KEYS themselves are untouched.
    expect(tuneKeys(CODE_LOOK)).toEqual(KEYS);
  });

  it('turns the sunset toward magenta and the night toward violet', () => {
    const sunset = KEYS.find((k) => k.band === 'dusk')!;
    const pink = tuneKeys({ ...CODE_LOOK, sunsetPink: 30 }).find((k) => k.band === 'dusk')!;
    // Magenta: more blue for the red.
    expect(pink.lightColor[2] / pink.lightColor[0]).toBeGreaterThan(sunset.lightColor[2] / sunset.lightColor[0]);
    const night = KEYS[0];
    const violet = tuneKeys({ ...CODE_LOOK, nightHue: 30 })[0];
    expect(violet.sky[0] / violet.sky[2]).toBeGreaterThan(night.sky[0] / night.sky[2]);
  });

  it('feeds sampleSky, and goes back to KEYS', () => {
    const a = sampleSky(0, createSkyState()).exposure;
    setSkyKeys(tuneKeys({ ...CODE_LOOK, nightBrightness: 1.2 }));
    expect(sampleSky(0, createSkyState()).exposure).toBeCloseTo(a * 1.2);
    setSkyKeys();
    expect(sampleSky(0, createSkyState()).exposure).toBe(a);
  });

  it('colour helpers keep greys grey and stay in range', () => {
    expect(hueTurn([0.5, 0.5, 0.5], 40).map((v) => +v.toFixed(4))).toEqual([0.5, 0.5, 0.5]);
    expect(chroma([0.2, 0.4, 0.9], 0).every((v, _, a) => Math.abs(v - a[0]) < 1e-9)).toBe(true);
    for (const v of chroma([1, 0.1, 0.9], 3)) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of hueTurn([1, 0, 0], 120)) expect(v).toBeLessThanOrEqual(1);
  });
});

describe('grade uniform', () => {
  it('holds the shipped grade at the defaults', () => {
    const out = writeGrade(CODE_LOOK, new Float32Array(16));
    expect(out[4]).toBeCloseTo(GRADE_BASE.darkSat);
    expect(out[5]).toBeCloseTo(GRADE_BASE.brightSat);
    expect(out[6]).toBe(1);
    expect(out[7]).toBe(1);
    expect([...out.slice(8, 11)].map((v) => +v.toFixed(4))).toEqual([...GRADE_BASE.shadowTint]);
    expect([...out.slice(12, 15)].map((v) => +v.toFixed(4))).toEqual([...GRADE_BASE.highTint]);
  });

  it('scales the tints toward white and the saturation toward grey', () => {
    const out = writeGrade({ ...CODE_LOOK, violetShadows: 0, saturation: 0 }, new Float32Array(16));
    expect([...out.slice(8, 11)]).toEqual([1, 1, 1]);
    expect(out[4]).toBe(0);
    expect(out[5]).toBe(0);
  });

  it('rides in toneMappingExposure, so every tone-mapped program gets it', () => {
    const chunk = ShaderChunk.tonemapping_pars_fragment;
    expect(chunk).toContain('uniform vec4 toneMappingExposure[ 4 ];');
    expect(chunk).not.toContain('uniform float toneMappingExposure');
    expect(chunk).toContain('ubExposure');
    setExposure(1.3);
    expect(getExposure()).toBeCloseTo(1.3);
    expect(GRADE_UNIFORM[0]).toBeCloseTo(1.3);
  });
});

describe('shader sliders (uLook)', () => {
  it('fit the uniform, each a real slider once', () => {
    expect(SHADER_LOOK.length).toBeLessThanOrEqual(SHADER_LOOK_FLOATS);
    const keys = SHADER_LOOK.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(LOOK_SPECS.some((s) => s.key === k)).toBe(true);
  });

  it('are all zero at the code look, so an unset uniform is the shipped look', () => {
    expect([...writeShaderLook(CODE_LOOK, new Float32Array(SHADER_LOOK_FLOATS))].every((v) => v === 0)).toBe(true);
    const out = writeShaderLook({ ...CODE_LOOK, neon: 1.5, treeSway: 0 }, new Float32Array(SHADER_LOOK_FLOATS));
    expect(out[SHADER_LOOK.findIndex(([k]) => k === 'neon')]).toBeCloseTo(0.5);
    expect(out[SHADER_LOOK.findIndex(([k]) => k === 'treeSway')]).toBeCloseTo(-1);
  });

  it('declare the uniform and a macro per slider', () => {
    const glsl = shaderLookGlsl();
    expect(glsl).toContain(`uniform vec4 uLook[${SHADER_LOOK_FLOATS / 4}];`);
    expect(glsl).toContain('#define LK_NEON (1.0 + uLook[0].x)');
    expect(glsl).toContain('#define LK_COVER (1.0 + uLook[1].y)');
    for (const [, name] of SHADER_LOOK) expect(glsl).toMatch(new RegExp(`#define ${name} `));
  });
});
