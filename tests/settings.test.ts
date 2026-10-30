import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/core/settings';

describe('settings: sanitising what was stored', () => {
  it('anything that is not an object gives the defaults', () => {
    for (const raw of [null, undefined, 42, 'quality', [1, 2, 3], true, NaN]) {
      expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('the result is a copy, never the defaults themselves', () => {
    const s = sanitizeSettings(null);
    s.masterVolume = 0;
    expect(DEFAULT_SETTINGS.masterVolume).toBe(0.8);
  });

  it('valid settings come through unchanged', () => {
    const stored = {
      masterVolume: 0,
      sfxVolume: 1,
      musicVolume: 0.25,
      ignoreSilentSwitch: false,
      quality: 'low',
      steering: 'classic',
      leftHanded: true,
      haptics: false,
      showFps: true,
    };
    expect(sanitizeSettings(stored)).toEqual(stored);
  });

  it('unknown preset and steering names fall back to the defaults', () => {
    const s = sanitizeSettings({ quality: 'ultra', steering: 'tank', leftHanded: true });
    expect(s.quality).toBe('auto');
    expect(s.steering).toBe('directional');
    expect(s.leftHanded).toBe(true);
    for (const bad of [null, 3, {}, ['low'], 'toString', '__proto__']) {
      expect(sanitizeSettings({ quality: bad }).quality).toBe('auto');
      expect(sanitizeSettings({ steering: bad }).steering).toBe('directional');
    }
  });

  it('volumes must be finite numbers and are clamped to 0..1', () => {
    const s = sanitizeSettings({ masterVolume: NaN, sfxVolume: '0.3', musicVolume: Infinity });
    expect(s.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
    expect(s.sfxVolume).toBe(DEFAULT_SETTINGS.sfxVolume);
    expect(s.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    const c = sanitizeSettings({ masterVolume: 2, sfxVolume: -1, musicVolume: null });
    expect(c.masterVolume).toBe(1);
    expect(c.sfxVolume).toBe(0);
    expect(c.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
  });

  it('switches must be booleans', () => {
    const s = sanitizeSettings({ haptics: 'false', showFps: 1, leftHanded: null, ignoreSilentSwitch: false });
    expect(s.haptics).toBe(true);
    expect(s.showFps).toBe(false);
    expect(s.leftHanded).toBe(false);
    expect(s.ignoreSilentSwitch).toBe(false);
  });

  it("garbage JSON's values all fall back, one field at a time", () => {
    const s = sanitizeSettings(JSON.parse('{"masterVolume":"loud","quality":7,"steering":true,"haptics":0,"sfxVolume":0.4}'));
    expect(s).toEqual({ ...DEFAULT_SETTINGS, sfxVolume: 0.4 });
  });

  it("a newer build's unknown keys are carried through, so writing back keeps them", () => {
    const s = sanitizeSettings({ quality: 'medium', subtitles: true, hud: { scale: 1.2 } });
    expect(s.quality).toBe('medium');
    expect(JSON.parse(JSON.stringify(s))).toMatchObject({ subtitles: true, hud: { scale: 1.2 } });
  });

  it('a key that names something on Object.prototype is not carried into it', () => {
    const s = sanitizeSettings(JSON.parse('{"__proto__":{"polluted":true},"constructor":1}'));
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('settings from before steering and left-handed play fill in the defaults', () => {
    const s = sanitizeSettings({ masterVolume: 0.6, sfxVolume: 0.7, musicVolume: 0.1, quality: 'high', haptics: false });
    expect(s).toEqual({
      ...DEFAULT_SETTINGS,
      masterVolume: 0.6,
      sfxVolume: 0.7,
      musicVolume: 0.1,
      quality: 'high',
      haptics: false,
    });
  });
});
