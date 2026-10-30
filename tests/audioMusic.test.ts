import { describe, expect, it } from 'vitest';
import {
  Arranger,
  STEPS_PER_BAR,
  StepClock,
  hitVelocity,
  swingOffset,
  targetBpm,
  type NoteEvent,
  type Part,
} from '../src/audio/music/sequencer';
import { STATIONS } from '../src/audio/music/stations';
import {
  CHORD_SHAPES,
  avoidClash,
  chordClasses,
  composeLead,
  fold,
  midiToHz,
  scaleNote,
  SCALES,
  voiceChord,
} from '../src/audio/music/theory';

/** Run the arranger for `bars` bars, collecting the events of each step. */
function play(a: Arranger, bars: number): NoteEvent[][] {
  return playSteps(a, bars * STEPS_PER_BAR);
}

function playSteps(a: Arranger, steps: number): NoteEvent[][] {
  const out: NoteEvent[][] = [];
  const events: NoteEvent[] = [];
  for (let i = 0; i < steps; i++) {
    a.next(events);
    out.push(events.map((e) => ({ ...e })));
  }
  return out;
}

const parts = (steps: NoteEvent[][]) => new Set(steps.flat().map((e) => e.part));
const stepsWith = (steps: NoteEvent[][], part: Part) =>
  steps.flatMap((evs, i) => (evs.some((e) => e.part === part) ? [i % STEPS_PER_BAR] : []));

describe('look-ahead step clock', () => {
  it('books exactly one bar of 16ths per bar of time, evenly spaced, from 25 ms ticks', () => {
    const clock = new StepClock(120); // 16th = 0.125 s, bar = 2 s
    clock.reset(0.05);
    const times: number[] = [];
    for (let now = 0; now < 4; now += 0.025) {
      while (clock.due(now, 0.12)) {
        times.push(clock.nextTime);
        clock.advance();
      }
    }
    // Everything up to now + lookahead is booked, nothing beyond.
    expect(times.length).toBe(Math.floor((4 - 0.025 + 0.12 - 0.05) / 0.125) + 1);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(0.125, 9);
    // Steps are never booked late: each was scheduled before it was due.
    expect(times[0]).toBeCloseTo(0.05);
  });

  it('only books steps inside the look-ahead window', () => {
    const clock = new StepClock(100);
    clock.reset(1);
    expect(clock.due(0.5, 0.12)).toBe(false);
    expect(clock.due(0.9, 0.12)).toBe(true);
  });

  it('skips ahead after a stall instead of machine-gunning the backlog', () => {
    const clock = new StepClock(120);
    clock.reset(0);
    let booked = 0;
    // The tab slept for 10 s.
    while (clock.due(10, 0.12) && booked < 1000) {
      booked++;
      clock.advance();
    }
    expect(booked).toBeLessThanOrEqual(2);
    expect(clock.nextTime).toBeGreaterThan(10);
  });

  it('swings odd 16ths late', () => {
    expect(swingOffset(0, 0.2, 0.1)).toBe(0);
    expect(swingOffset(1, 0.2, 0.1)).toBeCloseTo(0.02);
    expect(swingOffset(2, 0.2, 0.1)).toBe(0);
  });
});

describe('stations', () => {
  it('are well-formed', () => {
    expect(STATIONS.length).toBeGreaterThanOrEqual(3);
    const drumChars = /^[xo.]{16}$/;
    const bassChars = /^[xo537.\-]{16}$/;
    for (const s of STATIONS) {
      expect(s.tiers.length, s.name).toBe(6);
      expect(s.progression.length, s.name).toBe(8);
      expect(s.bpm[0]).toBeLessThan(s.bpm[1]);
      for (const tier of [...s.tiers, s.menu]) {
        for (const p of [tier.kick, tier.snare, tier.clap, tier.hat, tier.openHat, tier.perc, tier.keys, tier.arp]) {
          if (p !== undefined) expect(p, s.name).toMatch(drumChars);
        }
        if (tier.bass) expect(tier.bass, s.name).toMatch(bassChars);
        expect(tier.cutoff).toBeGreaterThan(500);
      }
      // The filter opens as intensity rises.
      for (let i = 1; i < 6; i++) expect(s.tiers[i].cutoff).toBeGreaterThan(s.tiers[i - 1].cutoff);
      for (const c of s.progression) expect(CHORD_SHAPES[c.quality]).toBeDefined();
    }
  });

  it('reads pattern velocities', () => {
    expect(hitVelocity('x.o.', 0)).toBe(1);
    expect(hitVelocity('x.o.', 1)).toBe(0);
    expect(hitVelocity('x.o.', 2)).toBe(0.5);
    expect(hitVelocity(undefined, 0)).toBe(0);
  });

  it('speeds up with intensity; menus sit under the chill tempo', () => {
    for (const s of STATIONS) {
      expect(targetBpm(s, 5, 'game')).toBeGreaterThan(targetBpm(s, 0, 'game'));
      expect(targetBpm(s, 0, 'menu')).toBeLessThan(targetBpm(s, 0, 'game'));
    }
  });
});

describe('arranger (adaptive layers)', () => {
  it('intensity 0 is chill: bass and hats, no kick or snare', () => {
    const a = new Arranger(STATIONS[0]);
    const p = parts(play(a, 2));
    expect(p.has('bass')).toBe(true);
    expect(p.has('hat')).toBe(true);
    expect(p.has('kick')).toBe(false);
    expect(p.has('snare')).toBe(false);
    expect(p.has('lead')).toBe(false);
  });

  it('layers in kick, snare on the backbeat, arps and lead as intensity rises', () => {
    for (const station of STATIONS) {
      const a = new Arranger(station);
      a.setIntensity(5);
      play(a, 1); // the change lands on the next bar line
      const steps = play(a, 8);
      const p = parts(steps);
      for (const part of ['kick', 'snare', 'hat', 'bass', 'lead'] as const) expect(p.has(part), `${station.name} ${part}`).toBe(true);
      expect(p.has('arp') || p.has('keys'), station.name).toBe(true);
      const snares = new Set(stepsWith(steps, 'snare'));
      expect(snares.has(4) && snares.has(12), station.name).toBe(true);
    }
  });

  it('changes intensity only on a bar line, with a drum fill leading into a step up', () => {
    const a = new Arranger(STATIONS[0]);
    play(a, 1);
    playSteps(a, 5); // into the bar
    a.setIntensity(3);
    const rest = playSteps(a, 11); // the rest of this bar
    expect(a.intensity).toBe(0);
    expect(parts(rest).has('kick')).toBe(true); // the fill's kick on step 12
    const fill = rest.slice(7).flat().filter((e) => e.part === 'snare');
    expect(fill.length).toBe(4);
    expect(fill[3].vel).toBeGreaterThan(fill[0].vel); // a rising roll
    const next = play(a, 1);
    expect(a.intensity).toBe(3);
    expect(stepsWith(next, 'kick')).toEqual([0, 4, 8, 12]);
  });

  it('drops intensity at the next bar line without a fill', () => {
    const a = new Arranger(STATIONS[0]);
    a.setIntensity(4);
    play(a, 2);
    expect(a.intensity).toBe(4);
    a.setIntensity(1);
    const bar = play(a, 1);
    expect(a.intensity).toBe(1);
    expect(stepsWith(bar, 'kick')).toEqual([0, 8]);
  });

  it('glides the tempo a few BPM per bar instead of jumping', () => {
    const a = new Arranger(STATIONS[0]);
    play(a, 1);
    const start = a.bpm;
    a.setIntensity(5);
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      play(a, 1);
      seen.push(a.bpm);
    }
    let prev = start;
    for (const bpm of seen) {
      expect(Math.abs(bpm - prev)).toBeLessThanOrEqual(6);
      prev = bpm;
    }
    expect(seen[seen.length - 1]).toBe(targetBpm(STATIONS[0], 5, 'game'));
  });

  it('switches station on the next bar line and restarts the phrase', () => {
    const a = new Arranger(STATIONS[0]);
    play(a, 3);
    a.setStation(STATIONS[1]);
    expect(a.station).toBe(STATIONS[0]);
    expect(a.upcomingStation).toBe(STATIONS[1]);
    play(a, 1);
    expect(a.station).toBe(STATIONS[1]);
    expect(a.bar).toBe(1);
  });

  it('plays a drumless arrangement in menu mode and nothing when off', () => {
    const a = new Arranger(STATIONS[0]);
    a.setIntensity(5);
    a.setMode('menu');
    play(a, 1);
    const menu = parts(play(a, 4));
    expect(menu.has('kick')).toBe(false);
    expect(menu.has('snare')).toBe(false);
    expect(menu.has('pad')).toBe(true);
    a.setMode('off');
    play(a, 1);
    expect(play(a, 2).flat().length).toBe(0);
  });

  it('keeps the bass low and the chords following the progression', () => {
    for (const station of STATIONS) {
      const a = new Arranger(station);
      a.setIntensity(3);
      const steps = play(a, 9);
      for (const e of steps.flat()) {
        if (e.part === 'bass') {
          expect(e.note).toBeGreaterThanOrEqual(station.bassLow);
          expect(e.note).toBeLessThan(station.bassLow + 24);
        }
      }
      // The bass's first note in each bar is the chord root.
      for (let bar = 1; bar < 9; bar++) {
        const first = steps.slice(bar * 16, bar * 16 + 16).flat().find((e) => e.part === 'bass');
        const chord = station.progression[bar % 8];
        if (first) expect(((first.note - station.key - chord.root) % 12 + 12) % 12).toBe(0);
      }
    }
  });
});

describe('music theory', () => {
  it('converts notes to frequencies', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(57)).toBeCloseTo(220);
  });

  it('folds and walks scales', () => {
    expect(fold(45, 36)).toBe(45);
    expect(fold(50, 36)).toBe(38);
    expect(fold(30, 36)).toBe(42);
    expect(scaleNote(60, SCALES.minor, 0)).toBe(60);
    expect(scaleNote(60, SCALES.minor, 2)).toBe(63);
    expect(scaleNote(60, SCALES.minor, 7)).toBe(72);
    expect(scaleNote(60, SCALES.minor, -1)).toBe(58);
  });

  it('voices chords with smooth voice leading', () => {
    const key = 45;
    const am = voiceChord(key, { root: 0, quality: 'min' }, null, 64);
    expect(am.map((n) => n % 12).sort()).toEqual([0, 4, 9].sort()); // A C E
    const f = voiceChord(key, { root: 8, quality: 'maj' }, am, 64);
    expect(new Set(f.map((n) => n % 12))).toEqual(new Set([5, 9, 0])); // F A C
    // Common tones stay put: A and C are shared, so at most one voice moves, by a step.
    const moved = f.reduce((sum, n, i) => sum + Math.abs(n - am[i]), 0);
    expect(moved).toBeLessThanOrEqual(2);
    for (const n of f) expect(Math.abs(n - 64)).toBeLessThan(9);
  });

  it('keeps melody notes off semitone clashes with the chord', () => {
    const eMajor = chordClasses(40, { root: 0, quality: 'maj' }); // E G# B
    expect(avoidClash(67, eMajor)).toBe(68); // G → G#
    expect(avoidClash(64, eMajor)).toBe(64);
    expect(avoidClash(62, eMajor)).toBe(62); // D: no clash
  });

  it('composes a repeatable, in-range lead that comes home', () => {
    const a = composeLead(7);
    expect(composeLead(7)).toEqual(a);
    expect(composeLead(8)).not.toEqual(a);
    for (const n of a) {
      expect(n.step).toBeGreaterThanOrEqual(0);
      expect(n.step + n.len).toBeLessThanOrEqual(128);
      expect(n.degree).toBeGreaterThanOrEqual(0);
      expect(n.degree).toBeLessThan(10);
    }
    // Bars 1-2 and 5-6 are the same motif.
    const first = a.filter((n) => n.step < 32).map((n) => [n.step, n.degree]);
    const third = a.filter((n) => n.step >= 64 && n.step < 96).map((n) => [n.step - 64, n.degree]);
    expect(third).toEqual(first);
    const last = a[a.length - 1];
    expect([0, 5]).toContain(last.degree);
  });
});
