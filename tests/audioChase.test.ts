import { describe, expect, it } from 'vitest';
import { CHASE, CHASE_CHORUS, CHASE_FROM, CHASE_MELODY, CHASE_STATION, ChaseMusic, chaseTier } from '../src/audio/music/chase';
import { MusicPlayer } from '../src/audio/music/musicPlayer';
import { Arranger, STEPS_PER_BAR, formBars, type NoteEvent } from '../src/audio/music/sequencer';
import { STATIONS, type Station } from '../src/audio/music/stations';
import { HOOK, THEME, THEME_STATION } from '../src/audio/music/themes';
import { chordClasses, scaleNote } from '../src/audio/music/theory';

function play(a: Arranger, bars: number): NoteEvent[][] {
  return steps(a, bars * STEPS_PER_BAR);
}
function steps(a: Arranger, n: number): NoteEvent[][] {
  const out: NoteEvent[][] = [];
  const ev: NoteEvent[] = [];
  for (let i = 0; i < n; i++) {
    a.next(ev);
    out.push(ev.map((e) => ({ ...e })));
  }
  return out;
}
const has = (bars: NoteEvent[][], part: string) => bars.flat().some((e) => e.part === part);
const DRUMS = ['kick', 'snare', 'clap', 'hat', 'openHat', 'perc'];
const drums = (bars: NoteEvent[][]) => bars.flat().some((e) => DRUMS.includes(e.part));

/** E minor's notes with the raised seventh (the answers turn on the leading tone over B7). */
const MINOR_PCS = [0, 2, 3, 5, 7, 8, 10, 11];

describe('the chase', () => {
  it('is off the dial, in on the hook: its melody states the hook twice, in key, on chord tones', () => {
    expect(STATIONS).not.toContain(CHASE_STATION);
    expect(STATIONS.map((s) => s.id)).not.toContain(CHASE_STATION.id);
    const bars = (from: number) => CHASE_MELODY.filter((m) => m.step >= from * 16 && m.step < (from + 2) * 16).map((m) => ({ ...m, step: m.step - from * 16 }));
    expect(bars(0)).toEqual(HOOK);
    expect(bars(4)).toEqual(HOOK);
    let end = 0;
    for (const m of CHASE_MELODY) {
      expect(m.step).toBeGreaterThanOrEqual(end);
      expect(m.len).toBeGreaterThan(0);
      end = m.step + m.len;
      expect(MINOR_PCS).toContain(m.degree % 12);
      expect(m.degree).toBeGreaterThanOrEqual(0);
      expect(m.degree).toBeLessThanOrEqual(17);
    }
    expect(end).toBeLessThanOrEqual(8 * STEPS_PER_BAR);
    const s = CHASE_STATION;
    for (const m of CHASE_MELODY) {
      if (m.step % 8 !== 0) continue;
      const pc = (scaleNote(s.leadTonic, s.leadScale, m.degree) % 12 + 12) % 12;
      expect(chordClasses(s.key, CHASE_CHORUS[Math.floor(m.step / 16)]), `step ${m.step}`).toContain(pc);
    }
    for (const song of s.songs) expect(song.melody).toBe(CHASE_MELODY);
  });

  it('writes valid patterns, has a tier per intensity and loops in about a minute at four stars', () => {
    expect(CHASE_STATION.tiers).toHaveLength(6);
    for (const tier of [...CHASE_STATION.tiers, CHASE.outro.tier]) {
      for (const p of [tier.kick, tier.snare, tier.clap, tier.hat, tier.openHat, tier.perc]) if (p !== undefined) expect(p).toMatch(/^[xo.rt]{16}$/);
      for (const p of [tier.keys, tier.arp]) if (p !== undefined) expect(p).toMatch(/^[xo.]{16}$/);
      if (tier.bass) expect(tier.bass).toMatch(/^[xo5437g.~-]{16}$/);
    }
    // Breakbeat drums from the chase proper up; the calm tiers have no snare.
    for (let i = 3; i <= 5; i++) expect(CHASE_STATION.tiers[i].snare).toBeDefined();
    expect(CHASE_STATION.tiers[0].kick).toBeUndefined();
    const seconds = formBars(CHASE.form) * 4 * (60 / 145.5);
    expect(seconds).toBeGreaterThan(45);
    expect(seconds).toBeLessThan(75);
    expect(CHASE.form[0][0]).toBe('chorus');
    // The way out: no drums, the hook.
    const out = CHASE.outro.tier;
    expect(out.lead).toBe(true);
    for (const p of [out.kick, out.snare, out.clap, out.hat, out.openHat, out.perc]) expect(p).toBeUndefined();
  });

  it('shapes its sections: the hook every chorus, the verse driving without it, a two-bar breath in the break', () => {
    const t = CHASE_STATION.tiers[5];
    expect(chaseTier(CHASE_STATION.tiers[2], 'chorus', 2).lead).toBe(true);
    expect(chaseTier(t, 'verse', 5).lead).toBeFalsy();
    const brk = chaseTier(t, 'break', 5);
    expect(brk.kick).toBe('x...............');
    expect(brk.snare).toBeUndefined();
    expect(brk.riser).toBe(true);
  });

  it('keeps the bass in range through the whole form at every intensity, in both cues', () => {
    for (const level of [1, 3, 5]) {
      const a = new Arranger(STATIONS[0]);
      a.setScore(CHASE);
      a.setIntensity(level);
      play(a, 1);
      for (let i = 0; i < 2 * formBars(CHASE.form); i++) {
        for (const e of play(a, 1).flat()) {
          if (e.part !== 'bass') continue;
          expect(e.note).toBeGreaterThanOrEqual(CHASE_STATION.bassLow);
          expect(e.note).toBeLessThan(CHASE_STATION.bassLow + 24);
        }
      }
      expect(a.station).toBe(CHASE_STATION);
    }
  });
});

describe('the arranger with a score', () => {
  it('comes in on the next bar line, risen into, with a crash, on the hook', () => {
    const a = new Arranger(STATIONS[0]);
    a.setIntensity(1);
    play(a, 2);
    steps(a, 5); // mid-bar
    a.setIntensity(3);
    a.setScore(CHASE);
    expect(a.station).toBe(STATIONS[0]);
    expect(a.upcomingStation).toBe(CHASE_STATION);
    const rest = steps(a, STEPS_PER_BAR - 5);
    expect(a.station).toBe(STATIONS[0]);
    // A riser over what's left of the bar (booked once).
    expect(rest.flat().filter((e) => e.part === 'riser')).toHaveLength(1);
    expect(rest.flat().find((e) => e.part === 'riser')!.len).toBe(STEPS_PER_BAR - 5);
    const first = play(a, 1);
    expect(a.station).toBe(CHASE_STATION);
    expect(a.playingScore).toBe(true);
    expect(a.playingTheme).toBe(false);
    expect(a.section).toBe('chorus');
    expect(first[0].some((e) => e.part === 'crash')).toBe(true);
    expect(first[0].some((e) => e.part === 'kick')).toBe(true);
    const leads = first.flatMap((evs, i) => evs.filter((e) => e.part === 'lead').map((e) => [i, e.note]));
    expect(leads).toEqual(HOOK.filter((m) => m.step < 16).map((m) => [m.step, CHASE_STATION.leadTonic + m.degree]));
    // The radio is untouched: it's what comes back.
    expect(a.radio).toBe(STATIONS[0]);
  });

  it('only hits (no riser) when asked too late in the bar', () => {
    const a = new Arranger(STATIONS[0]);
    play(a, 1);
    steps(a, 14);
    a.setScore(CHASE);
    const rest = steps(a, 2);
    expect(has(rest, 'riser')).toBe(false);
    expect(play(a, 1)[0].some((e) => e.part === 'crash')).toBe(true);
  });

  it('follows the intensity: more parts and a faster tempo with the stars, calmer (still the chase) at one or two', () => {
    const a = new Arranger(STATIONS[0]);
    a.setScore(CHASE);
    a.setIntensity(3);
    play(a, 1);
    const at3 = play(a, 1);
    const bpm3 = a.bpm;
    a.setIntensity(5);
    play(a, 4);
    expect(a.intensity).toBe(5);
    expect(a.bpm).toBeGreaterThan(bpm3);
    expect(a.bpm).toBe(CHASE_STATION.bpm[1]);
    const at5 = play(a, 1);
    expect(has(at5, 'arp')).toBe(true);
    expect(has(at3, 'arp')).toBe(false);
    a.setIntensity(1);
    play(a, 4);
    expect(a.station).toBe(CHASE_STATION);
    expect(a.intensity).toBe(1);
    expect(has(play(a, 1), 'snare')).toBe(false);
  });

  it('calms down on the way out (two drumless bars, the hook) and hands back to the radio with its next song', () => {
    const a = new Arranger(STATIONS[1]);
    a.setIntensity(1);
    play(a, 3); // a bar or more of the radio's first song is heard
    a.setScore(CHASE);
    a.setIntensity(4);
    play(a, 6);
    expect(a.playingScore).toBe(true);
    steps(a, 7);
    a.endScore();
    expect(a.scoreEnding).toBe(true);
    steps(a, STEPS_PER_BAR - 7);
    const outro = play(a, 2);
    expect(a.station).toBe(CHASE_STATION);
    expect(a.section).toBe('outro');
    expect(drums(outro)).toBe(false);
    expect(has(outro, 'lead')).toBe(true);
    const back = play(a, 1);
    expect(a.station).toBe(STATIONS[1]);
    expect(a.score).toBeNull();
    expect(a.scoreEnding).toBe(false);
    expect(a.song).toBe(STATIONS[1].songs[1]);
    expect(a.section).toBe('intro');
    expect(has(back, 'crash')).toBe(false);
  });

  it('a chase coming back during the calm-down carries on, and one dropped before it started never plays', () => {
    const a = new Arranger(STATIONS[0]);
    a.setScore(CHASE);
    play(a, 4);
    a.endScore();
    play(a, 1);
    expect(a.section).toBe('outro');
    a.setScore(CHASE);
    play(a, 3);
    expect(a.station).toBe(CHASE_STATION);
    expect(a.section).not.toBe('outro');
    const b = new Arranger(STATIONS[0]);
    play(b, 1);
    steps(b, 3);
    b.setScore(CHASE);
    b.endScore();
    play(b, 2);
    expect(b.station).toBe(STATIONS[0]);
    expect(b.score).toBeNull();
  });

  it("never plays in 'menu' (the theme does) and the radio's song isn't skipped if it hadn't started", () => {
    const a = new Arranger(STATIONS[0]);
    a.theme = THEME;
    a.setScore(CHASE);
    a.setMode('menu');
    play(a, 2);
    expect(a.station).toBe(THEME_STATION);
    // At boot the score took over before a bar of the radio's first song: it's still that song's turn after.
    const b = new Arranger(STATIONS[2]);
    b.setScore(CHASE);
    play(b, 2);
    b.setScore(null);
    play(b, 1);
    expect(b.song).toBe(STATIONS[2].songs[0]);
  });

  it('GO after a count-in never drops into the score', () => {
    const a = new Arranger(STATIONS[0]);
    a.setScore(CHASE);
    play(a, 2);
    a.dropIn(5);
    play(a, 1);
    expect(a.station).toBe(CHASE_STATION);
    expect(a.section).toBe('chorus');
  });
});

describe('when the chase plays', () => {
  it(`starts at ${CHASE_FROM} stars, stays calmer at one or two, ends when the police lose you`, () => {
    const c = new ChaseMusic();
    expect(c.wanted(1, 'crime')).toBeNull();
    expect(c.wanted(2, 'crime')).toBeNull();
    expect(c.phase).toBe('idle');
    expect(c.wanted(3, 'crime')).toBe('start');
    expect(c.wanted(4, 'crime')).toBeNull();
    expect(c.wanted(5, 'crime')).toBeNull();
    expect(c.wanted(2, 'lost')).toBeNull();
    expect(c.wanted(1, 'lost')).toBeNull();
    expect(c.phase).toBe('on');
    expect(c.wanted(3, 'crime')).toBeNull();
    expect(c.wanted(0, 'evaded')).toBe('end');
    expect(c.phase).toBe('idle');
    expect(c.wanted(3, 'crime')).toBe('start');
    expect(c.wanted(0, 'respray')).toBe('end');
    // Forced clean, a fresh run: calms down the same way.
    c.wanted(4, 'crime');
    expect(c.wanted(0, 'reset')).toBe('end');
  });

  it('WASTED and BUSTED drop it at once (the music stops anyway); the radio after respawn', () => {
    const c = new ChaseMusic();
    c.wanted(4, 'crime');
    expect(c.wanted(0, 'busted')).toBe('drop');
    expect(c.phase).toBe('idle');
    c.wanted(5, 'crime');
    expect(c.wanted(0, 'died')).toBe('drop');
    c.wanted(3, 'crime');
    expect(c.reset()).toBe('drop');
    expect(c.reset()).toBeNull();
    expect(c.wanted(0, 'died')).toBeNull();
  });

  it('R drops it for the radio and it stays away until the next chase', () => {
    const c = new ChaseMusic();
    expect(c.skip()).toBeNull();
    c.wanted(3, 'crime');
    expect(c.skip()).toBe('drop');
    expect(c.phase).toBe('skipped');
    expect(c.skip()).toBeNull();
    expect(c.wanted(4, 'crime')).toBeNull();
    expect(c.wanted(1, 'lost')).toBeNull();
    expect(c.wanted(3, 'crime')).toBeNull();
    expect(c.wanted(0, 'evaded')).toBeNull();
    expect(c.wanted(3, 'crime')).toBe('start');
  });
});

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
  const heard: string[] = [];
  music.onSong = (song, st) => heard.push(`${st.id}: ${song.title}`);
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.025) {
      ctx.currentTime += 0.025;
      music.pump(ctx.currentTime);
    }
  };
  return { ctx, music, run, heard };
}

describe('the music player with the chase', () => {
  it('plays the chase over the radio without touching the station index, and gives the radio back', () => {
    const { music, run, heard } = player(STATIONS[2]);
    music.setTheme(THEME);
    music.setMode('game');
    music.setIntensity(1);
    run(4);
    music.setScore(CHASE);
    music.setIntensity(3);
    run(4);
    expect(music.playingScore).toBe(true);
    expect(music.station).toBe(CHASE_STATION);
    expect(music.stationIndex).toBe(2);
    expect(heard).toContain(`chase: ${CHASE_STATION.songs[0].title}`);
    music.endScore();
    run(6);
    expect(music.playingScore).toBe(false);
    expect(music.station).toBe(STATIONS[2]);
    expect(heard[heard.length - 1]).toBe(`lowtide: ${STATIONS[2].songs[1].title}`);
    music.dispose();
  });

  it('R mid-chase: the chase drops at once and the next station plays (and the chase stays dropped)', () => {
    const { music, run } = player(STATIONS[0]);
    music.setMode('game');
    music.setScore(CHASE);
    run(3);
    expect(music.playingScore).toBe(true);
    // As GameAudio.nextStation: drop the score, retune.
    music.dropScore();
    music.setStation(1);
    run(1);
    expect(music.playingScore).toBe(false);
    expect(music.station).toBe(STATIONS[1]);
    expect(music.arranger.score).toBeNull();
    run(10);
    expect(music.station).toBe(STATIONS[1]);
    music.dispose();
  });

  it('WASTED / BUSTED: off with the chase dropped, the radio after respawn; the title plays the theme', () => {
    const { music, run } = player(STATIONS[0]);
    music.setTheme(THEME);
    music.setMode('game');
    music.setScore(CHASE);
    run(3);
    // As GameAudio.onPlayerDied: music off, the chase gone.
    music.setMode('off');
    music.dropScore();
    run(2);
    expect(music.mode).toBe('off');
    music.setMode('game');
    run(1);
    expect(music.station).toBe(STATIONS[0]);
    expect(music.playingScore).toBe(false);
    music.setMode('menu');
    run(1);
    expect(music.playingTheme).toBe(true);
    music.dispose();
  });

  it('retunes quietly: at the next bar line, or at once from the top of a phrase when nobody can hear it', () => {
    const { music, run } = player(STATIONS[0]);
    music.setMode('game');
    run(1);
    music.tune(3);
    expect(music.station).toBe(STATIONS[0]);
    run(3);
    expect(music.station).toBe(STATIONS[3]);
    music.tune(5, true);
    run(0.05);
    expect(music.station).toBe(STATIONS[5]);
    expect(music.arranger.bar).toBe(0);
    // Under the chase the radio is retuned for later, the chase plays on.
    music.setScore(CHASE);
    run(3);
    music.tune(1, true);
    run(0.5);
    expect(music.station).toBe(CHASE_STATION);
    expect(music.arranger.radio).toBe(STATIONS[1]);
    music.dispose();
  });
});
