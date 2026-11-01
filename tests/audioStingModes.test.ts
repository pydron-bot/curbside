import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sfx from '../src/audio/sfx';
import { Arranger, FORM, STEPS_PER_BAR, formBars, type NoteEvent } from '../src/audio/music/sequencer';
import { STATIONS, songMajor, type Song } from '../src/audio/music/stations';
import {
  bassRoot,
  bustedSting,
  countInSting,
  leadTonic,
  missionFailedSting,
  missionPassedSting,
  missionStartSting,
  wastedSting,
  type Sting,
} from '../src/audio/music/stings';
import { THEME, THEME_STATION } from '../src/audio/music/themes';
import { CHORD_SHAPES, type Chord } from '../src/audio/music/theory';
import { Voice } from '../src/audio/synth';
import type { ScoreKind } from '../src/systems/score';
import { mulberry32 } from '../src/world/random';

/** A 53-bit string hash (cyrb53): fingerprints of whole scores and graphs. */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Every sting score in every key from C2 to B3, as minor (the default). */
function minorScores(): string {
  const out: unknown[] = [];
  for (let key = 36; key < 60; key++) {
    out.push(wastedSting(key), bustedSting(key));
    for (let i = 0; i < 8; i++) out.push(missionStartSting(key, i), missionPassedSting(key, i), missionFailedSting(key, i));
    for (const n of [3, 2, 1, 0]) out.push(countInSting(n, key));
  }
  return JSON.stringify(out);
}

/**
 * A BaseAudioContext that logs every node, connection and parameter call, so
 * a recipe's whole graph can be fingerprinted, and keeps each oscillator's
 * wave and starting frequency.
 */
function recordingContext() {
  const log: string[] = [];
  const oscs: Array<{ type: string; hz: number }> = [];
  let id = 0;
  const num = (x: unknown) => (typeof x === 'number' ? String(+x.toFixed(6)) : typeof x === 'object' && x && '_id' in x ? String((x as { _id: string })._id) : String(x));
  const param = (owner: number, name: string, onSet?: (x: number) => void) => {
    const p: Record<string, unknown> = { _id: `${owner}.${name}` };
    let value = 0;
    Object.defineProperty(p, 'value', {
      get: () => value,
      set: (x: number) => {
        value = x;
        onSet?.(x);
        log.push(`${owner}.${name}=${num(x)}`);
      },
    });
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues']) {
      p[m] = (...a: unknown[]) => {
        log.push(`${owner}.${name}.${m}(${a.map(num).join(',')})`);
        return p;
      };
    }
    return p;
  };
  const node = (kind: string) => () => {
    const n = ++id;
    log.push(`${n}:${kind}`);
    const rec = kind === 'osc' ? { type: '', hz: 0 } : null;
    if (rec) oscs.push(rec);
    const o: Record<string, unknown> = {
      _id: String(n),
      connect: (d: unknown) => {
        log.push(`${n}->${num(d)}`);
        return d;
      },
      disconnect() {},
      start: (...a: unknown[]) => log.push(`${n}.start(${a.map(num).join(',')})`),
      stop: (...a: unknown[]) => log.push(`${n}.stop(${a.map(num).join(',')})`),
      setPeriodicWave: () => log.push(`${n}.wave`),
    };
    for (const name of ['gain', 'frequency', 'detune', 'Q', 'playbackRate', 'delayTime']) {
      o[name] = param(n, name, rec && name === 'frequency' ? (x) => (rec.hz = x) : undefined);
    }
    for (const prop of ['type', 'buffer', 'loop', 'curve']) {
      let v: unknown = null;
      Object.defineProperty(o, prop, {
        get: () => v,
        set: (x: unknown) => {
          v = x;
          if (rec && prop === 'type') rec.type = String(x);
          log.push(`${n}.${prop}=${prop === 'buffer' ? (x as { _name?: string })?._name : prop === 'curve' ? (x as Float32Array).length : num(x)}`);
        },
      });
    }
    return o;
  };
  const buffer = (name: string) => ({ _name: name, length: 16000, sampleRate: 8000, duration: 2, numberOfChannels: 1, getChannelData: () => new Float32Array(16000) });
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    createGain: node('gain'),
    createBiquadFilter: node('filter'),
    createOscillator: node('osc'),
    createDelay: node('delay'),
    createConvolver: node('convolver'),
    createBufferSource: node('source'),
    createWaveShaper: node('shaper'),
  };
  const bank = { white: buffer('white'), pink: buffer('pink'), brown: buffer('brown'), crackle: buffer('crackle'), glass: buffer('glass'), offset: () => Math.random() };
  return { log, oscs, voice: (t = 1) => new Voice(ctx as never, bank as never, t) };
}

const UI: sfx.UiSound[] = ['click', 'confirm', 'back', 'countdown', 'go', 'success', 'fail', 'cash', 'star', 'ring'];
const AWARDS: ScoreKind[] = ['drift', 'nearMiss', 'smash', 'hitAndRun', 'knockout', 'carjack', 'copRam', 'copWreck', 'evaded', 'stunt'];
const SFX_KEYS = [40, 45, 50, 53];

/** The graphs of every key-following recipe in sfx.ts, minor (the default), with Math.random seeded. */
function minorGraphs(): string {
  const { log, voice } = recordingContext();
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(7));
  for (const key of SFX_KEYS) {
    for (const kind of UI) sfx.ui(voice(), kind, key);
    for (const kind of AWARDS) for (let m = 1; m <= 10; m++) sfx.award(voice(), kind, m, key);
    sfx.bigSting(voice(), key);
    sfx.fanfare(voice(), key);
    sfx.respawn(voice(), key);
    sfx.wasted(voice(), key);
    sfx.busted(voice(), key);
  }
  return log.join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Pitch class of a MIDI note (or Hz) relative to a key. */
const pc = (note: number, key: number) => (((Math.round(note) - key) % 12) + 12) % 12;
const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
/** Every pitch class a score sounds, relative to the key. */
function pcsOf(s: Sting, key: number): Set<number> {
  const out = new Set<number>();
  for (const n of [...s.melody, ...s.bass]) out.add(pc(n.note, key));
  for (const c of s.chords) for (const n of c.notes) out.add(pc(n, key));
  return out;
}
const shape = (notes: readonly number[], key: number) => notes.map((n) => pc(n, key));

/** A chord's thirds over the key: +1 the major third, -1 the minor third. */
const third = (c: Chord) => (CHORD_SHAPES[c.quality] as readonly number[]).reduce((t: number, s) => t + ((c.root + s) % 12 === 4 ? 1 : (c.root + s) % 12 === 3 ? -1 : 0), 0);
const chordsOf = (song: Song) => [...song.verse, ...(song.chorus ?? [])];

const insertCoin = STATIONS.find((s) => s.id === 'insertcoin')!;
const getaway = STATIONS.find((s) => s.id === 'getaway')!;
/** Songs in a major key: INSERT COIN's four, and GETAWAY's dominant-ninth blues. */
const MAJOR_SONGS = [...insertCoin.songs.map((s) => s.title), 'Hot Wire Strut'];

describe("the song's mode", () => {
  it('is major for every INSERT COIN song and the dominant blues, minor for the rest and the title theme', () => {
    const modes: Record<string, boolean> = {};
    for (const station of [...STATIONS, THEME_STATION]) for (const song of station.songs) modes[`${station.id}: ${song.title}`] = songMajor(song);
    const expected: Record<string, boolean> = {};
    for (const station of [...STATIONS, THEME_STATION]) for (const song of station.songs) expected[`${station.id}: ${song.title}`] = MAJOR_SONGS.includes(song.title);
    expect(modes).toEqual(expected);
    expect(Object.values(modes).filter(Boolean)).toHaveLength(5);
  });

  it("follows the chords: every tonic chord carries the song's third, and a song without one keeps to its key's major third", () => {
    for (const station of [...STATIONS, THEME_STATION]) {
      for (const song of station.songs) {
        const major = songMajor(song);
        const tonics = chordsOf(song).filter((c) => c.root === 0);
        for (const c of tonics) expect(third(c), `${song.title} ${c.quality}`).toBe(major ? 1 : -1);
        if (tonics.length === 0) {
          // Boss Rush Hour lives on its relative minor: the chords hold the key's major third and never its minor one.
          expect(song.title).toBe('Boss Rush Hour');
          expect(chordsOf(song).some((c) => third(c) > 0)).toBe(true);
          expect(chordsOf(song).some((c) => third(c) < 0)).toBe(false);
        }
      }
    }
    // Hot Wire Strut's tonic is a dominant ninth (C# over A): major, though GETAWAY is dorian.
    const strut = getaway.songs.find((s) => s.title === 'Hot Wire Strut')!;
    expect(strut.verse[0]).toEqual({ root: 0, quality: 'dom9' });
  });

  it('is reported for the song playing, or the one about to start while a switch is pending, like the key', () => {
    const a = new Arranger(STATIONS[0]);
    expect(a.major).toBe(false);
    a.setStation(insertCoin);
    expect(a.major).toBe(true); // before the bar line that switches
    const ev: NoteEvent[] = [];
    for (let i = 0; i < STEPS_PER_BAR; i++) a.next(ev);
    expect(a.station).toBe(insertCoin);
    expect(a.major).toBe(true);
    // Through all four of its songs (Boss Rush Hour included).
    for (let song = 0; song < insertCoin.songs.length; song++) {
      expect(a.song).toBe(insertCoin.songs[song]);
      expect(a.major).toBe(true);
      for (let i = 0; i < formBars(FORM) * STEPS_PER_BAR; i++) a.next(ev);
    }
    // Under the title theme it's the theme's A minor; PLAY with INSERT COIN tuned: major before the switch lands.
    const t = new Arranger(insertCoin);
    t.theme = THEME;
    t.setMode('menu');
    for (let i = 0; i < STEPS_PER_BAR; i++) t.next(ev);
    expect(t.playingTheme).toBe(true);
    expect(t.major).toBe(false);
    t.setMode('game');
    expect(t.major).toBe(true);
    expect(t.key).toBe(insertCoin.key);
  });
});

const KEYS = [40, 45, 50, 53, 47, 57];

describe('stings in a major key', () => {
  it('count in on I, IV and V, landing GO on the major tonic, the riser on the tonic and the lead on the octave', () => {
    for (const key of KEYS) {
      const [three, two, one, go] = [3, 2, 1, 0].map((n) => countInSting(n, key, true));
      expect(shape(three.chords[0].notes, key)).toEqual([0, 4, 7]);
      expect(shape(two.chords[0].notes, key)).toEqual([5, 9, 0]);
      expect(shape(one.chords[0].notes, key)).toEqual([7, 11, 2]);
      expect(shape(go.chords[0].notes, key)).toEqual([0, 4, 7, 0]);
      // The bass climbs from IV to V, then home.
      expect([three, two, one, go].map((s) => pc(s.bass[0].note, key))).toEqual([0, 5, 7, 0]);
      expect(two.bass[0].note).toBeLessThan(one.bass[0].note);
      expect(one.bass[0].note).toBeLessThan(go.bass[0].note);
      expect(pc(Math.round(one.riser!.to), key)).toBe(0);
      expect(go.melody[0].note).toBe(leadTonic(key) + 12);
      for (const s of [three, two, one, go]) expect(pcsOf(s, key).has(3), `count in ${key}`).toBe(false);
      // Only the harmony changes: rhythm, riser and levels are the minor count's.
      for (const n of [3, 2, 1, 0]) {
        const [maj, min] = [countInSting(n, key, true), countInSting(n, key)];
        expect(maj.drums).toEqual(min.drums);
        expect(maj.riser).toEqual(min.riser);
        expect(maj.length).toBe(min.length);
      }
    }
  });

  it('start a job on the hook re-spelled major, over major chords', () => {
    for (const key of KEYS) {
      for (let i = 0; i < 4; i++) {
        const s = missionStartSting(key, i, true);
        expect(s.melody.slice(0, 4).map((n) => n.note - s.melody[0].note)).toEqual([0, -5, -3, -5]); // the sixth, not the flat sixth
        expect(pc(s.melody[0].note, key)).toBe(0);
        expect(shape(s.chords[0].notes, key)).toEqual([0, 4, 7]);
        expect(shape(s.chords[1].notes, key)).toEqual(i % 2 === 0 ? [0, 4, 7, 0] : [7, 11, 2, 7]);
        expect(pcsOf(s, key).has(3), `start ${i} in ${key}`).toBe(false);
        expect(pcsOf(s, key).has(8)).toBe(false);
        // Same groove and length as the minor cue.
        const min = missionStartSting(key, i);
        expect(s.drums).toEqual(min.drums);
        expect(s.bass).toEqual(min.bass);
        expect(s.length).toBe(min.length);
      }
    }
  });

  it('fail a job on to the relative minor: no minor third of the key anywhere', () => {
    for (const key of KEYS) {
      for (const i of [0, 1]) {
        const s = missionFailedSting(key, i, true);
        expect(s.melody.map((n) => n.note - s.melody[0].note)).toEqual([0, -5, -3, -5, -6, -7, -12]);
        expect(shape(s.chords[0].notes, key)).toEqual([0, 4, 7]);
        expect(shape(s.chords[1].notes, key)).toEqual([5, 9, 0]);
        expect(shape(s.chords[2].notes, key)).toEqual([9, 0, 4]); // vi
        expect(s.bass.map((n) => pc(n.note, key))).toEqual([0, 9, 9]);
        expect(s.bass[2].note).toBeLessThanOrEqual(s.bass[1].note);
        expect(s.bass[1].note).toBe(bassRoot(key) - 3);
        expect(pcsOf(s, key).has(3), `failed in ${key}`).toBe(false);
        expect(s.sag).toEqual(missionFailedSting(key, i).sag);
      }
    }
  });

  it('pass a job in the major already (no change needed)', () => {
    for (const key of KEYS) for (let i = 0; i < 3; i++) expect(pcsOf(missionPassedSting(key, i), key).has(3)).toBe(false);
  });

  it('are valid scores in every key', () => {
    for (let key = 36; key < 60; key++) {
      const scores = [...[3, 2, 1, 0].map((n) => countInSting(n, key, true)), ...[0, 1, 2, 3].flatMap((i) => [missionStartSting(key, i, true), missionFailedSting(key, i, true)])];
      for (const s of scores) {
        for (const [notes, lo, hi] of [
          [s.melody, 48, 100],
          [s.bass, 28, 60],
        ] as const) {
          for (let k = 0; k < notes.length; k++) {
            const n = notes[k];
            expect(n.note >= lo && n.note <= hi, `${key}: ${n.note}`).toBe(true);
            expect(n.t + n.len).toBeLessThanOrEqual(s.length);
            if (k > 0) expect(n.t).toBeGreaterThanOrEqual(notes[k - 1].t);
          }
        }
        for (const c of s.chords) for (const n of c.notes) expect(n >= 40 && n <= 90).toBe(true);
      }
    }
  });
});

describe('playSting', () => {
  /**
   * Each mono part's gain (only ever moved by setTargetAtTime) in time order:
   * two releases in a row mean a note's release landed inside the next note.
   */
  function overlaps(s: Sting): string[] {
    const { log, voice } = recordingContext();
    sfx.playSting(voice(1), s);
    const byParam = new Map<string, Array<{ t: number; to: number; other: boolean }>>();
    for (const line of log) {
      const m = /^(\d+)\.gain\.(\w+)\(([^)]*)\)$/.exec(line);
      if (!m) continue;
      const [, id, method, args] = m;
      const [to, t] = args.split(',').map(Number);
      const list = byParam.get(id) ?? [];
      list.push({ t, to, other: method !== 'setTargetAtTime' });
      byParam.set(id, list);
    }
    const out: string[] = [];
    for (const [id, events] of byParam) {
      if (events.some((e) => e.other)) continue; // not a mono synth's gain
      const sorted = [...events].sort((a, b) => a.t - b.t);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].to === 0 && sorted[i - 1].to === 0) out.push(`gain ${id}: release at ${sorted[i - 1].t.toFixed(3)} inside the note before ${sorted[i].t.toFixed(3)}`);
      }
    }
    return out;
  }

  it("never lets a mono note's release cut into the next note (MISSION FAILED lands on its tonic)", () => {
    for (const key of [40, 45, 50, 53, 57]) {
      for (const major of [false, true]) {
        const scores: Array<[string, Sting]> = [
          ['wasted', wastedSting(key)],
          ['busted', bustedSting(key)],
          ...[3, 2, 1, 0].map((n): [string, Sting] => [`count ${n}`, countInSting(n, key, major)]),
        ];
        for (let i = 0; i < 4; i++) {
          scores.push([`start ${i}`, missionStartSting(key, i, major)], [`passed ${i}`, missionPassedSting(key, i)], [`failed ${i}`, missionFailedSting(key, i, major)]);
        }
        for (const [name, s] of scores) expect(overlaps(s), `${name} in ${key}${major ? ' major' : ''}`).toEqual([]);
      }
    }
  });
});

describe('minor output', () => {
  it('is unchanged: every sting score as before the modes came in', () => {
    expect(hash(minorScores())).toBe('13psthz8jms');
    for (const key of KEYS) {
      for (const n of [3, 2, 1, 0]) expect(countInSting(n, key, false)).toEqual(countInSting(n, key));
      for (let i = 0; i < 4; i++) {
        expect(missionStartSting(key, i, false)).toEqual(missionStartSting(key, i));
        expect(missionFailedSting(key, i, false)).toEqual(missionFailedSting(key, i));
      }
    }
  });

  it("is unchanged: the UI sounds', awards' and KABOOM's whole graphs as before", () => {
    expect(hash(minorGraphs())).toBe('bms7m4xsdv');
  });
});

describe('key-following sounds in a major key', () => {
  /** The pitch classes (relative to `key`) of the oscillators of wave `type` a recipe starts. */
  function pitches(type: string, key: number, play: (v: Voice) => void): number[] {
    const { oscs, voice } = recordingContext();
    play(voice());
    return oscs.filter((o) => o.type === type).map((o) => pc(hzToMidi(o.hz), key));
  }

  it('climb the major pentatonic for awards, never touching the minor third', () => {
    for (const key of SFX_KEYS) {
      for (const kind of ['smash', 'drift'] as const) {
        const heard = new Set<number>();
        for (let m = 1; m <= 10; m++) for (const p of pitches('square', key, (v) => sfx.award(v, kind, m, key, true))) heard.add(p);
        expect([...heard].sort((a, b) => a - b)).toEqual([0, 2, 4, 7, 9, 11]); // the scale, and the major seventh as a fifth above the third
        const minor = new Set<number>();
        for (let m = 1; m <= 10; m++) for (const p of pitches('square', key, (v) => sfx.award(v, kind, m, key))) minor.add(p);
        expect(minor.has(3)).toBe(true);
      }
    }
  });

  it('stab KABOOM with a major tenth and fall through the fourth on a fail', () => {
    for (const key of SFX_KEYS) {
      expect(pitches('sawtooth', key, (v) => sfx.bigSting(v, key, true))).toEqual([0, 7, 0, 4]);
      expect(pitches('sawtooth', key, (v) => sfx.bigSting(v, key))).toEqual([0, 7, 0, 3]);
      expect(pitches('square', key, (v) => sfx.ui(v, 'fail', key, true))).toEqual([7, 5, 0]);
      expect(pitches('square', key, (v) => sfx.ui(v, 'fail', key))).toEqual([7, 3, 0]);
      // The rest are major or have no third already: the mode changes nothing.
      for (const kind of ['confirm', 'back', 'success', 'star'] as const) {
        expect(pitches('square', key, (v) => sfx.ui(v, kind, key, true))).toEqual(pitches('square', key, (v) => sfx.ui(v, kind, key)));
        expect(pitches('sawtooth', key, (v) => sfx.ui(v, kind, key, true))).toEqual(pitches('sawtooth', key, (v) => sfx.ui(v, kind, key)));
      }
    }
  });
});
