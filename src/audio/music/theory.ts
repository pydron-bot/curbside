/**
 * Just enough music theory for the procedural soundtrack: note frequencies,
 * scales, chord shapes, smooth voice leading, a seeded lead-melody composer
 * and a rule that keeps melody notes off semitone clashes with the chord.
 * Pure, so it's unit-tested.
 */
import { mulberry32 } from '../../world/random';

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Semitones above the chord root. 9th chords are rootless (the bass has the root) so voicings stay open. */
export const CHORD_SHAPES = {
  min: [0, 3, 7],
  maj: [0, 4, 7],
  min7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  dom7: [0, 4, 7, 10],
  min9: [3, 7, 10, 14],
  maj9: [4, 7, 11, 14],
  sus2: [0, 2, 7],
} as const satisfies Record<string, readonly number[]>;

export type ChordQuality = keyof typeof CHORD_SHAPES;

export interface Chord {
  /** Semitones above the key's tonic. */
  root: number;
  quality: ChordQuality;
}

export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  pentatonicMinor: [0, 3, 5, 7, 10],
} as const satisfies Record<string, readonly number[]>;

/** Wrap a MIDI note into [lo, lo + 12). */
export function fold(m: number, lo: number): number {
  return lo + ((((m - lo) % 12) + 12) % 12);
}

/** The note `degree` steps up `scale` from `tonic`; degrees past either end wrap by octaves. */
export function scaleNote(tonic: number, scale: readonly number[], degree: number): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  return tonic + octave * 12 + scale[degree - octave * n];
}

/** Pitch classes (0..11) of a chord in a key. */
export function chordClasses(key: number, chord: Chord): number[] {
  return CHORD_SHAPES[chord.quality].map((s) => (((key + chord.root + s) % 12) + 12) % 12);
}

/**
 * Voice a chord close around `center`, picking the inversion that moves least
 * from `prev` (smooth voice leading), or the one nearest `center` when there
 * is no previous chord. Returns ascending MIDI notes.
 */
export function voiceChord(key: number, chord: Chord, prev: readonly number[] | null, center = 62): number[] {
  const lo = center - 6;
  const tones = CHORD_SHAPES[chord.quality].map((s) => fold(key + chord.root + s, lo)).sort((a, b) => a - b);
  const n = tones.length;
  let best = tones;
  let bestCost = Infinity;
  for (let k = 0; k < n; k++) {
    const inversion = [...tones.slice(k), ...tones.slice(0, k).map((t) => t + 12)];
    for (const shift of [-12, 0, 12]) {
      const cand = inversion.map((t) => t + shift);
      const mean = cand.reduce((a, b) => a + b, 0) / n;
      let cost = Math.abs(mean - center) * 0.5;
      if (prev && prev.length > 0) {
        for (const t of cand) {
          let near = Infinity;
          for (const p of prev) near = Math.min(near, Math.abs(p - t));
          cost += near;
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = cand;
      }
    }
  }
  return best;
}

/**
 * Nudge a melody note that sits a semitone from a chord tone onto that chord
 * tone (an E minor pentatonic G over an E major chord becomes G#).
 */
export function avoidClash(note: number, classes: readonly number[]): number {
  const pc = ((note % 12) + 12) % 12;
  if (classes.includes(pc)) return note;
  if (classes.includes((pc + 11) % 12)) return note - 1;
  if (classes.includes((pc + 1) % 12)) return note + 1;
  return note;
}

export interface MotifNote {
  /** 16th step within the 8-bar phrase, 0..127. */
  step: number;
  /** Degree of the lead scale (0 = tonic). */
  degree: number;
  /** Length in 16th steps. */
  len: number;
}

/** Note lengths (16ths) the composer picks from; repeats weight the choice. */
const LENGTHS = [2, 2, 2, 3, 4, 4, 6];

/**
 * An 8-bar lead melody from a seed: a two-bar motif, a variation of it, the
 * motif again, then an answer that comes home to the tonic. Repetition is
 * what makes it sound composed rather than random.
 */
export function composeLead(seed: number, scaleSize = 5): MotifNote[] {
  const rand = mulberry32(seed);
  const top = scaleSize * 2 - 1;
  const phrase = (startDegree: number, resolve: boolean): MotifNote[] => {
    const out: MotifNote[] = [];
    let step = rand() < 0.5 ? 0 : 2;
    let degree = startDegree;
    while (step < 32) {
      let len = LENGTHS[Math.floor(rand() * LENGTHS.length)];
      if (step + len > 32) len = 32 - step;
      if (rand() < 0.18 && out.length > 0) {
        step += 2; // breathe
        continue;
      }
      out.push({ step, degree, len });
      step += len;
      const move = [-2, -1, -1, 0, 1, 1, 2][Math.floor(rand() * 7)];
      degree = Math.max(2, Math.min(top, degree + move));
    }
    if (resolve && out.length > 0) {
      const last = out[out.length - 1];
      last.degree = rand() < 0.5 ? scaleSize : 0;
      last.len = Math.max(last.len, Math.min(8, 32 - last.step));
    }
    return out;
  };
  const a = phrase(scaleSize + Math.floor(rand() * 3) - 1, false);
  const variation = a.map((n, i) => (i >= a.length - 2 ? { ...n, degree: Math.max(0, n.degree + (rand() < 0.5 ? -1 : 1)) } : { ...n }));
  const answer = phrase(scaleSize + 1, true);
  const at = (notes: MotifNote[], bar: number) => notes.map((n) => ({ ...n, step: n.step + bar * 16 }));
  return [...at(a, 0), ...at(variation, 2), ...at(a, 4), ...at(answer, 6)];
}
