import { describe, expect, it } from 'vitest';
import { Arranger, FORM, FORM_BARS, STEPS_PER_BAR, sectionAt, type NoteEvent } from '../src/audio/music/sequencer';
import { STATIONS } from '../src/audio/music/stations';
import { CHORD_SHAPES } from '../src/audio/music/theory';

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

describe('song form', () => {
  it('lays the sections end to end', () => {
    expect(FORM_BARS).toBe(FORM.reduce((n, [, b]) => n + b, 0));
    expect(sectionAt(0)).toMatchObject({ section: 'intro', bar: 0 });
    expect(sectionAt(4)).toMatchObject({ section: 'verse', bar: 0 });
    expect(sectionAt(12)).toMatchObject({ section: 'chorus', bar: 0 });
    expect(sectionAt(FORM_BARS - 1)).toMatchObject({ section: 'outro', next: 'intro' });
    expect(sectionAt(FORM_BARS)).toMatchObject({ section: 'intro', bar: 0 });
  });

  it('calm: a drumless intro, drums in the verse, the melody saved for the chorus, a breakdown', () => {
    const a = new Arranger(STATIONS[0]);
    a.setIntensity(2);
    const intro = play(a, 4);
    expect(has(intro, 'kick')).toBe(false);
    expect(has(intro, 'pad') || has(intro, 'keys')).toBe(true);
    expect(intro[3 * STEPS_PER_BAR].some((e) => e.part === 'riser')).toBe(true); // rises into the verse
    const verse = play(a, 8);
    expect(has(verse, 'kick')).toBe(true);
    expect(has(verse, 'lead')).toBe(false);
    const chorus = play(a, 8);
    expect(has(chorus, 'lead')).toBe(true);
    const brk = play(a, 4);
    expect(has(brk, 'kick')).toBe(false);
    expect(has(brk, 'snare')).toBe(false);
  });

  it('in a chase every section plays in full', () => {
    const a = new Arranger(STATIONS[1]);
    a.setIntensity(4);
    play(a, 1); // intensity lands on the bar line
    const intro = play(a, 3);
    expect(has(intro, 'kick')).toBe(true);
    expect(has(intro, 'snare')).toBe(true);
  });

  it('moves on to the next song after the outro, in its own key', () => {
    for (const station of STATIONS) {
      const a = new Arranger(station);
      a.setIntensity(3);
      const first = a.song;
      const n = a.songNumber;
      play(a, FORM_BARS);
      play(a, 1);
      expect(a.songNumber, station.id).toBe(n + 1);
      expect(a.song, station.id).toBe(station.songs[1]);
      expect(a.song.title).not.toBe(first.title);
      // The bass's first note of the new song's first bar is its first chord's root in its own key.
      const bars = play(a, 4);
      const bass = bars.slice(0, STEPS_PER_BAR).flat().find((e) => e.part === 'bass');
      if (bass) {
        const root = station.key + a.song.transpose + a.song.verse[1].root;
        expect(((bass.note - root) % 12 + 12) % 12, station.id).toBe(0);
      }
    }
  });

  it('every song is well formed', () => {
    for (const s of STATIONS) {
      expect(s.songs.length, s.id).toBeGreaterThanOrEqual(3);
      expect(new Set(s.songs.map((x) => x.title)).size).toBe(s.songs.length);
      for (const song of s.songs) {
        expect(Math.abs(song.transpose)).toBeLessThanOrEqual(5);
        for (const chords of [song.verse, song.chorus ?? song.verse]) {
          expect(chords).toHaveLength(8);
          for (const ch of chords) expect(CHORD_SHAPES[ch.quality], `${s.id} ${song.title}`).toBeDefined();
        }
      }
      expect(s.songs[0].verse).toBe(s.progression);
    }
  });

  it('a station picks up with its next song, starting from the intro', () => {
    const a = new Arranger(STATIONS[0]);
    play(a, 6);
    a.setStation(STATIONS[1]);
    play(a, 1);
    expect(a.song).toBe(STATIONS[1].songs[0]);
    expect(a.section).toBe('intro');
    a.setStation(STATIONS[0]);
    play(a, 1);
    expect(a.song).toBe(STATIONS[0].songs[1]);
  });
});
