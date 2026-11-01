/**
 * Curbside's own music: the title theme and the hook everything is built on.
 *
 * The hook is two bars in A minor: a falling call (high tonic, fifth, the
 * flat sixth sighing back onto the fifth) on a 3+3+2 tresillo, answered by a
 * climb back home to the tonic. The theme plays it over its own chords and
 * the stings (stings.ts) quote it, so WASTED, BUSTED, the mission cues and
 * the count-in all sound like the same game.
 *
 * The theme is a Station of its own (not on the radio, so the dial never
 * lands on it) that the Arranger plays while the mode is 'menu', through a
 * short looping form: a two-bar intro, the hook, a verse where the beat comes
 * in, the hook again with drums, a breath, round again (72 s). Its lead scale
 * is chromatic, so melody degrees are plain semitones above the lead tonic.
 */
import type { Station, Tier } from './stations';
import type { Theme } from './sequencer';
import type { Chord, MotifNote } from './theory';

/** Degrees on a chromatic scale are semitones: hand-written melodies can use any note. */
export const CHROMATIC: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const n = (step: number, degree: number, len: number): MotifNote => ({ step, degree, len });

/** The hook: two bars, degrees in semitones above the tonic (the call starts on the octave). */
export const HOOK: readonly MotifNote[] = [
  n(0, 12, 3),
  n(3, 7, 3),
  n(6, 8, 2),
  n(8, 7, 6),
  n(16, 3, 3),
  n(19, 5, 3),
  n(22, 7, 2),
  n(24, 0, 8),
];

const at = (notes: readonly MotifNote[], bar: number) => notes.map((m) => ({ ...m, step: m.step + bar * 16 }));

/**
 * The theme's 8-bar melody over its chorus: the hook; the hook a step lower
 * climbing on to a pickup; the hook; then an answer that turns to the
 * leading tone over E and hangs there, so the loop wants to go round again.
 */
export const THEME_MELODY: readonly MotifNote[] = [
  ...at(HOOK, 0),
  ...at([n(0, 10, 3), n(3, 7, 3), n(6, 8, 2), n(8, 7, 6), n(16, 2, 3), n(19, 5, 3), n(22, 10, 2), n(24, 5, 4), n(28, 7, 2), n(30, 10, 2)], 2),
  ...at(HOOK, 4),
  ...at([n(0, 5, 3), n(3, 8, 3), n(6, 12, 2), n(8, 8, 6), n(16, 7, 3), n(19, 11, 3), n(22, 14, 2), n(24, 11, 8)], 6),
];

const c = (root: number, quality: Chord['quality']): Chord => ({ root, quality });

/** Am Fmaj7 C G | Am Fmaj7 Dm7 E: under the hook. */
export const THEME_CHORUS: readonly Chord[] = [c(0, 'min'), c(8, 'maj7'), c(3, 'maj'), c(10, 'maj'), c(0, 'min'), c(8, 'maj7'), c(5, 'min7'), c(7, 'maj')];
/** Am9 Am9 Fmaj7 Fmaj7 | Dm7 Dm7 E E7: the intro, verse and break, slower and darker. */
export const THEME_VERSE: readonly Chord[] = [c(0, 'min9'), c(0, 'min9'), c(8, 'maj7'), c(8, 'maj7'), c(5, 'min7'), c(5, 'min7'), c(7, 'maj'), c(7, 'dom7')];

export const THEME_BPM = 100;

/** The theme's parts, sparse to full; THEME.levels picks one per section. */
const BREATH: Tier = { bass: 'x---------------', pad: true, arp: 'x..x..x.x..x..x.', cutoff: 1500 };
const INTRO: Tier = { bass: 'x-------x-------', pad: true, arp: 'x.x.x.x.x.x.x.x.', riser: true, cutoff: 1900 };
const HOOK_BED: Tier = { hat: '..o...o...o...o.', bass: 'x.x.x.x.x.x.x.x.', pad: true, arp: 'x.x.x.x.x.x.x.x.', lead: true, cutoff: 3400 };
const BEAT: Tier = {
  kick: 'x.......x.......',
  snare: '....o.......o...',
  hat: 'o.o.o.o.o.o.o.o.',
  bass: 'x.o.x.o.x.o.x.o.',
  keys: '...x..x....x....',
  pad: true,
  riser: true,
  cutoff: 3000,
};
const HOOK_FULL: Tier = {
  kick: 'x.......x.......',
  snare: '....x.......x...',
  hat: 'o.o.o.o.o.o.o.o.',
  openHat: '..............x.',
  bass: 'x.o.x.o.x.o.x.o.',
  arp: 'x.x.x.x.x.x.x.x.',
  lead: true,
  pad: true,
  crash: true,
  cutoff: 5200,
};

export const THEME_STATION: Station = {
  id: 'theme',
  name: 'CURBSIDE',
  key: 45, // A minor
  bassLow: 36,
  padCenter: 64,
  leadTonic: 69,
  leadScale: CHROMATIC,
  leadSeed: 0,
  progression: THEME_VERSE,
  bpm: [THEME_BPM, THEME_BPM],
  swing: 0,
  tiers: [BREATH, INTRO, HOOK_BED, BEAT, HOOK_FULL, HOOK_FULL],
  menu: BREATH,
  sound: {
    bass: 'reese',
    pad: 'saw',
    keys: 'stab',
    keysLen: 2,
    arp: 'pluck',
    arpOrder: [0, 1, 2, 3, 2, 1],
    lead: 'saw',
    // NIGHTDRIVE's kit: no second kit to render when that's the station.
    kickTune: 50,
    kickDecay: 0.32,
    snare: 'gated',
    hat: 'tick',
    crackle: false,
    echo: 0.75,
    reverb: 0.34,
    trim: 0.9,
    leadGain: 2,
  },
  songs: [{ title: 'Curbside', artist: 'Halogen Getaway', transpose: 0, verse: THEME_VERSE, chorus: THEME_CHORUS, leadSeed: 0, melody: THEME_MELODY }],
};

export const THEME = {
  station: THEME_STATION,
  bpm: THEME_BPM,
  // Intro, the hook, the beat comes in, the hook with drums, a breath: 30 bars.
  form: [
    ['intro', 2],
    ['chorus', 8],
    ['verse', 8],
    ['chorus', 8],
    ['break', 4],
  ],
  levels: [1, 2, 3, 4, 0],
} satisfies Theme;
