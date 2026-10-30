/**
 * The radio: original procedural tracks as data. Each station has a key, an
 * 8-bar chord progression, a tempo range and six arrangement tiers, one per
 * music intensity (0 = chill bass and hats ... 5 = everything), plus a sparse
 * "menu" arrangement for title screens.
 *
 * Patterns are 16 characters, one per 16th note of the bar:
 *   drums  'x' hit, 'o' soft hit, '.' rest
 *   bass   'x' root, 'o' octave up, '5' fifth, '3' chord third, '7' flat seventh,
 *          '-' holds the previous note, '.' rest
 */
import { SCALES, type Chord } from './theory';

export interface Tier {
  kick?: string;
  snare?: string;
  clap?: string;
  hat?: string;
  openHat?: string;
  perc?: string;
  bass?: string;
  /** Sustained chord each bar. */
  pad?: boolean;
  /** Chord hits (stabs / electric piano). */
  keys?: string;
  /** Arpeggio rhythm; notes walk the chord in the station's arpOrder. */
  arp?: string;
  lead?: boolean;
  /** Cymbal on the first bar of each phrase (and when the music steps up). */
  crash?: boolean;
  /** Noise sweep up through the last bar of each phrase. */
  riser?: boolean;
  /** Lowpass over the melodic parts, Hz: the arrangement "opens up" as it intensifies. */
  cutoff: number;
}

export interface StationSound {
  bass: 'saw' | 'reese' | 'round';
  pad: 'saw' | 'dark' | 'soft';
  keys: 'stab' | 'epiano';
  /** Length of a keys hit, 16ths. */
  keysLen: number;
  arp: 'square' | 'pluck';
  /** Chord-tone indices the arpeggio walks; indices past the chord size go up an octave. */
  arpOrder: readonly number[];
  lead: 'saw' | 'square' | 'flute';
  kickTune: number;
  kickDecay: number;
  snare: 'gated' | 'crisp' | 'rim';
  hat: 'tick' | 'shaker';
  /** Vinyl crackle bed. */
  crackle: boolean;
  /** Echo time in beats (0.75 = dotted eighth). */
  echo: number;
  /** Reverb send for snare / pad / lead. */
  reverb: number;
  /** Overall level trim so stations sit at the same loudness. */
  trim: number;
}

export interface Station {
  id: string;
  name: string;
  /** Tonic (MIDI, any octave). */
  key: number;
  /** Lowest bass note; bass notes fold into the octave above it. */
  bassLow: number;
  /** Centre of the pad / keys voicings. */
  padCenter: number;
  /** Tonic of the lead melody. */
  leadTonic: number;
  leadScale: readonly number[];
  leadSeed: number;
  progression: readonly Chord[];
  /** Tempo at intensity 0 and at intensity 5. */
  bpm: readonly [number, number];
  /** Delay on odd 16ths, as a fraction of a 16th. */
  swing: number;
  /** One tier per intensity 0..5. */
  tiers: readonly Tier[];
  menu: Tier;
  sound: StationSound;
}

const NIGHTDRIVE: Station = {
  id: 'nightdrive',
  name: 'NIGHTDRIVE FM',
  key: 45, // A minor
  bassLow: 36,
  padCenter: 64,
  leadTonic: 69,
  leadScale: SCALES.pentatonicMinor,
  leadSeed: 7,
  // Am F C G | Am F Dm E
  progression: [
    { root: 0, quality: 'min' },
    { root: 8, quality: 'maj' },
    { root: 3, quality: 'maj' },
    { root: 10, quality: 'maj' },
    { root: 0, quality: 'min' },
    { root: 8, quality: 'maj' },
    { root: 5, quality: 'min' },
    { root: 7, quality: 'maj' },
  ],
  bpm: [90, 116],
  swing: 0,
  tiers: [
    { hat: '..o...o...o...o.', bass: 'x-----..x-----..', pad: true, cutoff: 1500 },
    { kick: 'x.......x.......', hat: '..o...o...o...o.', bass: 'x-----.xx-----.o', pad: true, cutoff: 2200 },
    {
      kick: 'x.......x.......',
      snare: '....x.......x...',
      hat: 'o.x.o.x.o.x.o.x.',
      bass: 'x.x.x.x.x.x.x.o.',
      pad: true,
      cutoff: 3200,
    },
    {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: 'o.x.o.x.o.x.o.x.',
      bass: 'x.o.x.o.x.o.x.o.',
      arp: 'x.x.x.x.x.x.x.x.',
      pad: true,
      cutoff: 5000,
    },
    {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      clap: '....x.......x...',
      hat: 'oooooooooooooooo',
      openHat: '..x...x...x...x.',
      bass: 'x.oxx.oxx.oxx.ox',
      arp: 'xxxxxxxxxxxxxxxx',
      lead: true,
      pad: true,
      cutoff: 8000,
    },
    {
      kick: 'x...x...x...x...',
      snare: '....x.......x.o.',
      clap: '....x.......x...',
      hat: 'oooooooooooooooo',
      openHat: '..x...x...x...x.',
      bass: 'x.oxx.oxx.oxx.ox',
      arp: 'xxxxxxxxxxxxxxxx',
      lead: true,
      pad: true,
      crash: true,
      riser: true,
      cutoff: 12000,
    },
  ],
  menu: { bass: 'x---------------', arp: 'x..x..x.x..x..x.', pad: true, cutoff: 1800 },
  sound: {
    bass: 'saw',
    pad: 'saw',
    keys: 'stab',
    keysLen: 2,
    arp: 'square',
    arpOrder: [0, 1, 2, 3, 4, 3, 2, 1],
    lead: 'saw',
    kickTune: 50,
    kickDecay: 0.32,
    snare: 'gated',
    hat: 'tick',
    crackle: false,
    echo: 0.75,
    reverb: 0.32,
    trim: 1,
  },
};

const BREAKNECK: Station = {
  id: 'breakneck',
  name: 'BREAKNECK 99.1',
  key: 40, // E phrygian
  bassLow: 36,
  padCenter: 62,
  leadTonic: 64,
  leadScale: SCALES.pentatonicMinor,
  leadSeed: 31,
  // Em7 Fmaj7 Em7 D | Em7 Fmaj7 Cmaj7 Bm7
  progression: [
    { root: 0, quality: 'min7' },
    { root: 1, quality: 'maj7' },
    { root: 0, quality: 'min7' },
    { root: 10, quality: 'maj' },
    { root: 0, quality: 'min7' },
    { root: 1, quality: 'maj7' },
    { root: 8, quality: 'maj7' },
    { root: 7, quality: 'min7' },
  ],
  bpm: [100, 128],
  swing: 0.06,
  tiers: [
    { hat: 'o.o.o.o.o.o.o.o.', bass: 'x---------------', pad: true, cutoff: 1300 },
    { kick: 'x.........x.....', hat: 'o.o.o.o.o.o.o.o.', bass: 'x-------x-----x-', pad: true, cutoff: 1900 },
    {
      kick: 'x.........x.....',
      snare: '....x.......x...',
      hat: 'x.o.x.o.x.o.x.o.',
      bass: 'x-----x---x-----',
      pad: true,
      cutoff: 2800,
    },
    {
      kick: 'x.x.......x..x..',
      snare: '....x..o.o..x..o',
      hat: 'xoxoxoxoxoxoxoxo',
      bass: 'x-----x-x---x-o-',
      keys: '...x..x....x....',
      pad: true,
      cutoff: 4500,
    },
    {
      kick: 'x.x.......x..x..',
      snare: '....x..o.o..x..o',
      hat: 'xoxoxoxoxoxoxoxo',
      openHat: '......x.......x.',
      bass: 'x-----x-x---x-o-',
      keys: '...x..x....x..x.',
      lead: true,
      pad: true,
      cutoff: 7000,
    },
    {
      kick: 'x.x.......x..x..',
      snare: '....x..o.o..x..o',
      clap: '....x.......x...',
      hat: 'xoxoxoxoxoxoxoxo',
      openHat: '......x.......x.',
      perc: '..o..o....o..o..',
      bass: 'x-----x-x---x-o-',
      keys: '...x..x....x..x.',
      lead: true,
      pad: true,
      crash: true,
      riser: true,
      cutoff: 11000,
    },
  ],
  menu: { bass: 'x---------------', keys: 'x...............', pad: true, cutoff: 1600 },
  sound: {
    bass: 'reese',
    pad: 'dark',
    keys: 'stab',
    keysLen: 2,
    arp: 'square',
    arpOrder: [0, 2, 1, 3],
    lead: 'square',
    kickTune: 54,
    kickDecay: 0.22,
    snare: 'crisp',
    hat: 'tick',
    crackle: false,
    echo: 0.75,
    reverb: 0.26,
    trim: 0.95,
  },
};

const LOW_TIDE: Station = {
  id: 'lowtide',
  name: 'LOW TIDE',
  key: 48, // C dorian
  bassLow: 36,
  padCenter: 63,
  leadTonic: 72,
  leadScale: SCALES.pentatonicMinor,
  leadSeed: 113,
  // Cm9 Cm9 Abmaj9 Abmaj9 | Fm9 Fm9 G7 G7
  progression: [
    { root: 0, quality: 'min9' },
    { root: 0, quality: 'min9' },
    { root: 8, quality: 'maj9' },
    { root: 8, quality: 'maj9' },
    { root: 5, quality: 'min9' },
    { root: 5, quality: 'min9' },
    { root: 7, quality: 'dom7' },
    { root: 7, quality: 'dom7' },
  ],
  bpm: [76, 92],
  swing: 0.22,
  tiers: [
    { hat: 'o.o.o.o.o.o.o.o.', keys: 'x.........x.....', bass: 'x-------x-----..', cutoff: 1700 },
    { kick: 'x......x..x.....', hat: 'o.o.o.o.o.o.o.o.', keys: 'x.........x.....', bass: 'x-----.x--x-----', cutoff: 2100 },
    {
      kick: 'x......x..x.....',
      snare: '....x.......x...',
      hat: 'x.o.x.o.x.o.x.oo',
      keys: 'x.....x...x.....',
      bass: 'x-----.x--x-----',
      cutoff: 2600,
    },
    {
      kick: 'x......x..x.....',
      snare: '....x.......x...',
      hat: 'x.o.x.o.x.o.x.oo',
      perc: '..........o.....',
      keys: 'x.....x...x.....',
      arp: 'x..x..x...x..x..',
      bass: 'x-----.x--x--.5-',
      cutoff: 3200,
    },
    {
      kick: 'x......x..x..x..',
      snare: '....x.......x...',
      hat: 'x.o.x.o.x.o.x.oo',
      perc: '..........o.....',
      keys: 'x.....x...x.....',
      arp: 'x..x..x...x..x..',
      bass: 'x-----.x--x--.5-',
      lead: true,
      pad: true,
      cutoff: 3800,
    },
    {
      kick: 'x......x..x..x..',
      snare: '....x.......x..o',
      hat: 'x.o.x.o.x.o.x.oo',
      perc: '...o.......o..o.',
      keys: 'x.....x...x.....',
      arp: 'x..x..x...x..x..',
      bass: 'x-----.x--x--.5-',
      lead: true,
      pad: true,
      crash: true,
      cutoff: 4600,
    },
  ],
  menu: { keys: 'x...............', bass: 'x---------------', pad: true, cutoff: 1600 },
  sound: {
    bass: 'round',
    pad: 'soft',
    keys: 'epiano',
    keysLen: 6,
    arp: 'pluck',
    arpOrder: [0, 2, 1, 3, 2, 4],
    lead: 'flute',
    kickTune: 48,
    kickDecay: 0.26,
    snare: 'rim',
    hat: 'shaker',
    crackle: true,
    echo: 0.5,
    reverb: 0.3,
    trim: 0.9,
  },
};

export const STATIONS: readonly Station[] = [NIGHTDRIVE, BREAKNECK, LOW_TIDE];
