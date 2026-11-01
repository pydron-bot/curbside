import { describe, expect, it } from 'vitest';
import { MusicPlayer } from '../src/audio/music/musicPlayer';
import { Arranger, FORM, STEPS_PER_BAR, firstBar, formBars, sectionAt, type NoteEvent } from '../src/audio/music/sequencer';
import { STATIONS, type Station } from '../src/audio/music/stations';
import {
  COUNT_SPACING,
  STING_LEVELS,
  bustedSting,
  countInSting,
  missionFailedSting,
  missionPassedSting,
  missionStartSting,
  wastedSting,
  type Sting,
} from '../src/audio/music/stings';
import { CHROMATIC, HOOK, THEME, THEME_BPM, THEME_CHORUS, THEME_MELODY, THEME_STATION, THEME_VERSE } from '../src/audio/music/themes';
import { CHORD_SHAPES, chordClasses, scaleNote } from '../src/audio/music/theory';
import { EventBus } from '../src/core/events';
import type { ModeCtx } from '../src/game/modes/context';
import { FRENZY_COUNTDOWN } from '../src/game/modes/frenzies';
import { FrenzyMode } from '../src/game/modes/frenzyMode';
import { Player } from '../src/game/player';
import { Progress } from '../src/game/progress';
import { defaultSave } from '../src/game/progressSave';

function play(a: Arranger, bars: number): NoteEvent[][] {
  const out: NoteEvent[][] = [];
  const ev: NoteEvent[] = [];
  for (let i = 0; i < bars * STEPS_PER_BAR; i++) {
    a.next(ev);
    out.push(ev.map((e) => ({ ...e })));
  }
  return out;
}
const has = (steps: NoteEvent[][], part: string) => steps.flat().some((e) => e.part === part);

/** A minor key's notes, with the raised seventh (the hook's answer turns on the leading tone over E). */
const MINOR_PCS = [0, 2, 3, 5, 7, 8, 10, 11];

describe('the hook and the title theme', () => {
  it('has a two-bar hook in the minor key, on its tresillo, ending home on the tonic', () => {
    expect(HOOK.map((m) => m.step)).toEqual([0, 3, 6, 8, 16, 19, 22, 24]);
    for (let i = 0; i < HOOK.length; i++) {
      const m = HOOK[i];
      expect(m.len).toBeGreaterThan(0);
      expect(m.step + m.len).toBeLessThanOrEqual(i + 1 < HOOK.length ? HOOK[i + 1].step : 32);
      expect(MINOR_PCS).toContain(m.degree % 12);
    }
    expect(HOOK[0].degree).toBe(12);
    expect(HOOK[HOOK.length - 1].degree).toBe(0);
  });

  it('writes an 8-bar melody that states the hook, stays in range and in key, and lands on chord tones', () => {
    let end = 0;
    for (const m of THEME_MELODY) {
      expect(m.step).toBeGreaterThanOrEqual(end); // sorted, no overlaps
      expect(m.len).toBeGreaterThan(0);
      end = m.step + m.len;
      expect(MINOR_PCS).toContain(m.degree % 12);
      expect(m.degree).toBeGreaterThanOrEqual(0);
      expect(m.degree).toBeLessThanOrEqual(14);
    }
    expect(end).toBeLessThanOrEqual(8 * STEPS_PER_BAR);
    // Bars 1-2 and 5-6 are the hook itself.
    const bars = (from: number) => THEME_MELODY.filter((m) => m.step >= from * 16 && m.step < (from + 2) * 16).map((m) => ({ ...m, step: m.step - from * 16 }));
    expect(bars(0)).toEqual(HOOK);
    expect(bars(4)).toEqual(HOOK);
    // Every note starting on beat 1 or 3 is a tone of that bar's chorus chord.
    const s = THEME_STATION;
    for (const m of THEME_MELODY) {
      if (m.step % 8 !== 0) continue;
      const pc = (scaleNote(s.leadTonic, s.leadScale, m.degree) % 12 + 12) % 12;
      expect(chordClasses(s.key, THEME_CHORUS[Math.floor(m.step / 16)]), `step ${m.step}`).toContain(pc);
    }
  });

  it('has 8 chords each for its verse and chorus, and a chromatic lead scale (degrees are semitones)', () => {
    for (const chords of [THEME_VERSE, THEME_CHORUS]) {
      expect(chords).toHaveLength(8);
      for (const c of chords) expect(CHORD_SHAPES[c.quality]).toBeDefined();
    }
    expect(CHROMATIC).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(scaleNote(69, CHROMATIC, 14)).toBe(83);
  });

  it('is a station of its own, off the dial, with a form whose every part has a tier', () => {
    expect(STATIONS).not.toContain(THEME_STATION);
    expect(STATIONS.map((s) => s.id)).not.toContain(THEME_STATION.id);
    expect(THEME.levels).toHaveLength(THEME.form.length);
    for (const level of THEME.levels) expect(THEME_STATION.tiers[level]).toBeDefined();
    for (const tier of THEME_STATION.tiers) {
      for (const p of [tier.kick, tier.snare, tier.clap, tier.hat, tier.openHat, tier.perc, tier.keys, tier.arp]) {
        if (p !== undefined) expect(p).toMatch(/^[xo.]{16}$/);
      }
      if (tier.bass) expect(tier.bass).toMatch(/^[xo537.\-]{16}$/);
    }
    // The hook comes in within a few seconds, and the loop is about a minute and a bit.
    expect(firstBar('chorus', THEME.form) * 4 * (60 / THEME_BPM)).toBeLessThan(6);
    const seconds = formBars(THEME.form) * 4 * (60 / THEME_BPM);
    expect(seconds).toBeGreaterThan(50);
    expect(seconds).toBeLessThan(100);
    expect(sectionAt(2, THEME.form)).toMatchObject({ section: 'chorus', bar: 0, part: 1 });
  });
});

describe('the arranger with a theme', () => {
  it('plays an explicit Song.melody as written, clashes and all, instead of composing one', () => {
    const base = STATIONS[0];
    // C# over A minor: a composed lead would be nudged off it; a written one isn't.
    const melody = [
      { step: 0, degree: 0, len: 4 },
      { step: 4, degree: 1, len: 4 },
      { step: 20, degree: 4, len: 2 },
    ];
    const station: Station = { ...base, leadScale: CHROMATIC, songs: [{ ...base.songs[0], melody }] };
    const a = new Arranger(station, { form: false });
    a.setIntensity(5); // lands on the first bar line
    const bars = play(a, 2);
    const leads = bars.flatMap((evs, i) => evs.filter((e) => e.part === 'lead').map((e) => [i, e.note, e.len]));
    expect(leads).toEqual([
      [0, station.leadTonic, 4],
      [4, station.leadTonic + 1, 4],
      [20, station.leadTonic + 4, 2],
    ]);
  });

  it("plays the theme through its own form in 'menu', at its tempo, the hook only where written", () => {
    const a = new Arranger(STATIONS[1]);
    a.theme = THEME;
    a.setMode('menu');
    const intro = play(a, 2);
    expect(a.station).toBe(THEME_STATION);
    expect(a.playingTheme).toBe(true);
    expect(a.bpm).toBe(THEME_BPM);
    expect(has(intro, 'lead')).toBe(false);
    expect(has(intro, 'kick')).toBe(false);
    expect(intro[STEPS_PER_BAR].some((e) => e.part === 'riser')).toBe(true); // rises into the hook
    const hook = play(a, 8);
    expect(a.section).toBe('chorus');
    const leads = hook.flatMap((evs, i) => evs.filter((e) => e.part === 'lead').map((e) => [i, e.note]));
    expect(leads).toEqual(THEME_MELODY.map((m) => [m.step, THEME_STATION.leadTonic + m.degree]));
    const verse = play(a, 8);
    expect(has(verse, 'kick')).toBe(true);
    expect(has(verse, 'lead')).toBe(false);
    const again = play(a, 8);
    expect(has(again, 'crash')).toBe(true);
    expect(has(again, 'lead')).toBe(true);
    play(a, 4);
    // Round again: the theme's own song from its intro, not the radio.
    const songs = a.songNumber;
    play(a, 1);
    expect(a.songNumber).toBe(songs + 1);
    expect(a.station).toBe(THEME_STATION);
    expect(a.section).toBe('intro');
  });

  it('starts the game on the radio\'s first song when the title theme took over before it played (boot)', () => {
    const a = new Arranger(STATIONS[0]);
    a.theme = THEME;
    a.setMode('menu');
    play(a, 3);
    a.setMode('game');
    play(a, 1);
    expect(a.song).toBe(STATIONS[0].songs[0]);
  });

  it("gives way to the radio in 'game' with its next song, keeping a retune made under the theme", () => {
    const a = new Arranger(STATIONS[0]);
    expect(a.song).toBe(STATIONS[0].songs[0]);
    play(a, 1); // a bar of the radio's first song is heard
    a.theme = THEME;
    a.setMode('menu');
    play(a, 3);
    a.setStation(STATIONS[2]);
    expect(a.upcomingStation).toBe(THEME_STATION);
    play(a, 2);
    expect(a.station).toBe(THEME_STATION);
    expect(a.radio).toBe(STATIONS[2]);
    a.setMode('game');
    expect(a.upcomingStation).toBe(STATIONS[2]);
    play(a, 1);
    expect(a.station).toBe(STATIONS[2]);
    expect(a.playingTheme).toBe(false);
    expect(a.song).toBe(STATIONS[2].songs[0]);
    expect(a.section).toBe('intro');
    // And back on the title, then into the game again: the radio carries on with its next song.
    a.setMode('menu');
    play(a, 2);
    expect(a.station).toBe(THEME_STATION);
    a.setMode('game');
    play(a, 1);
    expect(a.song).toBe(STATIONS[2].songs[1]);
  });

  it('reports the key of the song about to start while a switch is pending, so stings land in it', () => {
    const a = new Arranger(STATIONS[0]);
    a.theme = THEME;
    a.setMode('menu');
    play(a, 1);
    a.setStation(STATIONS[1]);
    expect(a.key).toBe(THEME_STATION.key);
    a.setMode('game');
    const next = STATIONS[1].songs[0];
    expect(a.key).toBe(STATIONS[1].key + next.transpose);
    play(a, 1);
    expect(a.song).toBe(next);
    expect(a.key).toBe(STATIONS[1].key + next.transpose);
  });

  it("without a theme 'menu' is still the station's own menu tier", () => {
    const a = new Arranger(STATIONS[0]);
    a.setMode('menu');
    play(a, 1);
    expect(a.station).toBe(STATIONS[0]);
    expect(a.tier()).toBe(STATIONS[0].menu);
  });

  it('drops in on the top of a chorus at GO, at the asked intensity, from the very next step', () => {
    const a = new Arranger(STATIONS[0]);
    a.setIntensity(1);
    play(a, 2);
    for (let i = 0; i < 5; i++) a.next([]); // mid-bar
    a.dropIn(4);
    const bar = play(a, 1);
    expect(a.intensity).toBe(4);
    expect(a.section).toBe('chorus');
    expect(stepsOf(bar, 'kick')).toContain(0);
    expect(has(bar, 'lead')).toBe(true);
    // Never under the theme.
    const t = new Arranger(STATIONS[0]);
    t.theme = THEME;
    t.setMode('menu');
    play(t, 1);
    t.dropIn(5);
    play(t, 1);
    expect(t.playingTheme).toBe(true);
    expect(t.section).toBe('intro');
  });
});

const stepsOf = (steps: NoteEvent[][], part: string) => steps.flatMap((evs, i) => (evs.some((e) => e.part === part) ? [i] : []));

/** Just enough of a BaseAudioContext for the MusicPlayer's bookkeeping (nothing sounds). */
function fakeAudio() {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({
    connect() {},
    disconnect() {},
    start() {},
    stop() {},
    gain: param(),
    frequency: param(),
    detune: param(),
    Q: param(),
    delayTime: param(),
    playbackRate: param(),
    type: '',
    buffer: null,
    loop: false,
    curve: null,
    setPeriodicWave() {},
  });
  const buffer = (channels: number, length: number, sampleRate: number) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, duration: length / sampleRate, numberOfChannels: channels, getChannelData: (c: number) => data[c], copyToChannel() {} };
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    createGain: node,
    createBiquadFilter: node,
    createOscillator: node,
    createDelay: node,
    createConvolver: node,
    createBufferSource: node,
    createWaveShaper: node,
    createPeriodicWave: () => ({}),
    createBuffer: buffer,
  };
  const noise = buffer(1, 16000, 8000);
  const bank = { white: noise, pink: noise, brown: noise, crackle: noise, glass: noise, offset: () => 0 };
  return { ctx, bank, out: node(), impulse: noise };
}

function player(station: Station) {
  const { ctx, bank, out, impulse } = fakeAudio();
  const music = new MusicPlayer(ctx as never, bank as never, out as never, impulse as never, station);
  let maxNotes = 0;
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.025) {
      ctx.currentTime += 0.025;
      music.pump(ctx.currentTime);
      maxNotes = Math.max(maxNotes, music.activeNotes);
    }
  };
  return { ctx, music, run, maxNotes: () => maxNotes };
}

describe('the music player with the theme', () => {
  it('plays the theme on the title and the radio in the game, never touching the station index', () => {
    const { music, run, maxNotes } = player(STATIONS[1]);
    const heard: string[] = [];
    music.onSong = (song, station) => heard.push(`${station.id}: ${song.title}`);
    music.setTheme(THEME);
    music.setMode('menu');
    run(2);
    expect(music.playingTheme).toBe(true);
    expect(music.station).toBe(THEME_STATION);
    expect(music.stationIndex).toBe(1);
    expect(music.arranger.radio).toBe(STATIONS[1]);
    // Retuning on the title: the radio moves, the theme plays on.
    music.nextStation();
    run(3);
    expect(music.playingTheme).toBe(true);
    expect(music.stationIndex).toBe(2);
    // PLAY: the radio comes back, on the station chosen.
    music.setMode('game');
    run(1);
    expect(music.playingTheme).toBe(false);
    expect(music.station).toBe(STATIONS[2]);
    expect(music.stationIndex).toBe(2);
    // Quit to the title, and the theme is back.
    music.setMode('menu');
    run(1);
    expect(music.playingTheme).toBe(true);
    expect(music.stationIndex).toBe(2);
    // The theme's songs are reported with the theme's station, so listeners can tell them from the radio's.
    expect(heard[0]).toBe(`theme: ${THEME_STATION.songs[0].title}`);
    expect(heard).toContain(`${STATIONS[2].id}: ${STATIONS[2].songs[0].title}`);
    // A minute of the theme and the notes in flight stay bounded (they're reaped as they end).
    run(60);
    expect(maxNotes()).toBeLessThan(80);
    music.dispose();
  });

  it('drops the radio in at GO: out of the duck, on a chorus, at the intensity asked', () => {
    const { ctx, music, run } = player(STATIONS[0]);
    music.setTheme(THEME);
    music.setMode('game');
    music.setIntensity(1);
    run(6);
    music.duck(0.3, 0.3, 1.25);
    const when = ctx.currentTime + 0.03;
    music.dropIn(when, 4);
    music.pump(ctx.currentTime);
    expect(music.arranger.intensity).toBe(4);
    expect(music.arranger.section).toBe('chorus');
    expect(music.clock.nextTime).toBeGreaterThan(when); // its first step booked at `when`
    music.setIntensity(4);
    run(3);
    expect(music.arranger.intensity).toBe(4);
    // Not on the title: the theme plays on.
    music.setMode('menu');
    run(1);
    music.dropIn(ctx.currentTime + 0.03, 5);
    run(1);
    expect(music.playingTheme).toBe(true);
    music.dispose();
  });
});

const KEYS = [40, 45, 48, 45 - 5, 45 + 5, 47];

function stingsFor(key: number): Array<[string, Sting]> {
  const out: Array<[string, Sting]> = [
    ['wasted', wastedSting(key)],
    ['busted', bustedSting(key)],
  ];
  for (let i = 0; i < 8; i++) {
    out.push([`start ${i}`, missionStartSting(key, i)], [`passed ${i}`, missionPassedSting(key, i)], [`failed ${i}`, missionFailedSting(key, i)]);
  }
  for (const n of [3, 2, 1, 0]) out.push([`count ${n}`, countInSting(n, key)]);
  return out;
}

describe('stings', () => {
  it('are valid scores: sorted, finite, in range, all inside their length', () => {
    for (const key of KEYS) {
      for (const [name, s] of stingsFor(key)) {
        const label = `${name} in ${key}`;
        expect(Number.isFinite(s.length) && s.length > 0 && s.length < 8, label).toBe(true);
        expect(s.echo).toBeGreaterThanOrEqual(0);
        expect(s.echo).toBeLessThan(1);
        const sorted = (ts: number[]) => ts.every((t, i) => i === 0 || t >= ts[i - 1]);
        for (const [part, notes, lo, hi] of [
          ['melody', s.melody, 48, 100],
          ['bass', s.bass, 28, 60],
        ] as const) {
          expect(sorted(notes.map((n) => n.t)), `${label} ${part}`).toBe(true);
          // One voice: a note releases (playSting: at 0.9 / 0.88 of its length) before the next starts, or slurs into a note that glides.
          const hold = part === 'melody' ? 0.9 : 0.88;
          for (let k = 1; k < notes.length; k++) {
            const [a, b] = [notes[k - 1], notes[k]];
            expect(a.t + a.len * hold < b.t || b.glide !== undefined, `${label} ${part} ${k - 1} runs into ${k}`).toBe(true);
          }
          for (const n of notes) {
            for (const x of [n.t, n.note, n.len, n.vel]) expect(Number.isFinite(x), `${label} ${part}`).toBe(true);
            expect(n.t).toBeGreaterThanOrEqual(0);
            expect(n.len).toBeGreaterThan(0);
            expect(n.vel).toBeGreaterThan(0);
            expect(n.vel).toBeLessThanOrEqual(1);
            expect(n.note, `${label} ${part}`).toBeGreaterThanOrEqual(lo);
            expect(n.note, `${label} ${part}`).toBeLessThanOrEqual(hi);
            expect(n.t + n.len).toBeLessThanOrEqual(s.length);
          }
        }
        expect(sorted(s.chords.map((c) => c.t)), label).toBe(true);
        for (const c of s.chords) {
          expect(c.notes.length).toBeGreaterThanOrEqual(3);
          for (const n of c.notes) expect(n >= 40 && n <= 90, label).toBe(true);
          expect(c.vel > 0 && c.vel <= 1 && c.len > 0 && c.t >= 0).toBe(true);
          expect(c.t + c.len).toBeLessThanOrEqual(s.length);
        }
        expect(sorted(s.drums.map((d) => d.t)), label).toBe(true);
        for (const d of s.drums) {
          expect(d.vel > 0 && d.vel <= 1 && d.t >= 0 && d.t < s.length, label).toBe(true);
        }
        if (s.riser) expect(s.riser.t + s.riser.len).toBeLessThanOrEqual(s.length);
        if (s.sag) expect(s.sag.t + s.sag.len).toBeLessThanOrEqual(s.length);
      }
    }
    for (const level of Object.values(STING_LEVELS)) expect(level > 0 && level <= 1).toBe(true);
  });

  it("quote the hook, in the music's key", () => {
    const head = HOOK.slice(0, 4).map((m) => m.degree - HOOK[0].degree); // 0 -5 -4 -5
    for (const key of KEYS) {
      for (const s of [wastedSting(key), bustedSting(key), missionStartSting(key, 0), missionStartSting(key, 3), missionFailedSting(key, 1)]) {
        expect(s.melody.slice(0, 4).map((n) => n.note - s.melody[0].note)).toEqual(head);
        expect(((s.melody[0].note - key) % 12 + 12) % 12).toBe(0); // starts on the tonic
      }
      // PASSED: the hook in the major, its last note leaping up to the octave.
      const passed = missionPassedSting(key, 0);
      expect(passed.melody.map((n) => n.note - passed.melody[0].note)).toEqual([0, -5, -3, -5, -8, -7, -5, 0]);
    }
  });

  it('give each payphone job its own colour', () => {
    const starts = [0, 1, 2, 3].map((i) => missionStartSting(45, i));
    expect(new Set(starts.map((s) => `${s.lead} ${s.melody[1].t.toFixed(3)}`)).size).toBe(4);
    expect(missionStartSting(45, 4)).toEqual(missionStartSting(45, 0));
  });
});

describe('the count-in', () => {
  it('is one self-contained hit per count, building, its riser climbing to the tonic on GO', () => {
    for (const key of KEYS) {
      const [three, two, one, go] = [3, 2, 1, 0].map((n) => countInSting(n, key));
      for (const s of [three, two, one]) {
        // Nothing booked past the next count but a ring-out: a count that stops leaves nothing hanging.
        expect(s.length).toBeLessThan(COUNT_SPACING + 0.5);
        expect(s.riser!.len).toBe(COUNT_SPACING);
        expect(s.drums.some((d) => d.part === 'kick' && d.t === 0)).toBe(true);
      }
      // One continuous rise across the three counts, landing on the tonic.
      expect(three.riser!.to).toBeCloseTo(two.riser!.from, 9);
      expect(two.riser!.to).toBeCloseTo(one.riser!.from, 9);
      expect(((Math.round(one.riser!.to) - key) % 12 + 12) % 12).toBe(0);
      expect(three.riser!.level[0]).toBeLessThan(one.riser!.level[1]);
      // Each hits harder than the last, and 1 rolls into GO.
      const kick = (s: Sting) => s.drums.find((d) => d.part === 'kick')!.vel;
      expect(kick(two)).toBeGreaterThan(kick(three));
      expect(kick(one)).toBeGreaterThan(kick(two));
      expect(one.drums.filter((d) => d.part === 'snare').length).toBeGreaterThan(two.drums.filter((d) => d.part === 'snare').length);
      // GO: the crash and the tonic chord.
      expect(go.drums.map((d) => d.part)).toContain('crash');
      expect(go.chords[0].notes.map((n) => ((n - key) % 12 + 12) % 12)).toEqual([0, 3, 7, 0]);
      expect(go.riser).toBeNull();
    }
  });

  it('plays a hit for each number as the mode shows it, then GO (no booking ahead)', () => {
    const bus = new EventBus();
    const p = new Player(bus, 0, 0);
    const calls: Array<[number, number]> = [];
    let clock = 0;
    const ctx = {
      deps: { bus, player: p, audio: { ui() {}, countIn: (n: number) => calls.push([n, clock]) } },
      progress: new Progress(defaultSave(), null),
      ui: { banner() {} },
      freeRoam: true,
      get live() {
        return p.alive && !p.arrested;
      },
      busy: null as string | null,
      blip() {},
      unblip() {},
    };
    const mode = new FrenzyMode(ctx as unknown as ModeCtx);
    const inner = mode as unknown as { begin(t: unknown): void; tokens: unknown[] };
    inner.begin(inner.tokens[0]);
    const dt = 1 / 60;
    for (; clock <= FRENZY_COUNTDOWN + 0.2; clock += dt) {
      mode.step(dt);
      // Exactly one call per number, made when it shows.
      expect(calls.length).toBeLessThanOrEqual(1 + Math.floor(clock / COUNT_SPACING + 1e-9) + (clock >= FRENZY_COUNTDOWN ? 1 : 0));
    }
    expect(calls.map(([n]) => n)).toEqual([3, 2, 1, 0]);
    for (let i = 1; i < calls.length; i++) expect(calls[i][1] - calls[i - 1][1]).toBeCloseTo(COUNT_SPACING, 1);
  });
});

describe('the song form helpers', () => {
  it('find sections and measure forms', () => {
    expect(firstBar('chorus')).toBe(12);
    expect(firstBar('intro')).toBe(0);
    expect(formBars(FORM)).toBe(36);
    expect(sectionAt(13).part).toBe(2);
  });
});
