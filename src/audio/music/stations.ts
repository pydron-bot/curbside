/**
 * The radio: original procedural tracks as data. Each station has a key, an
 * 8-bar chord progression, a tempo range and six arrangement tiers, one per
 * music intensity (0 = chill bass and hats ... 5 = everything), plus a sparse
 * "menu" arrangement for title screens.
 *
 * Patterns are 16 characters, one per 16th note of the bar:
 *   drums  'x' hit, 'o' soft hit, '.' rest; 'r' a roll of two 32nds and 't' of
 *          three (trap hi-hat rolls)
 *   keys / arp  'x' hit, 'o' soft hit, '.' rest
 *   bass   'x' root, 'o' octave up, '5' fifth, '4' fourth, '3' chord third,
 *          '7' flat seventh, 'g' ghost (a muted, percussive root), '-' holds
 *          the previous note, '~' holds it and slides into the next one (an
 *          808 glide; across the bar line too when it's the last step), '.' rest
 */
import { SCALES, type Chord, type MotifNote } from './theory';

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
  /** '808' a sine boom with glides, 'slap' thumb and pops, 'sub' a deep round line, 'tri' the 8-bit triangle. */
  bass: 'saw' | 'reese' | 'round' | '808' | 'slap' | 'sub' | 'tri';
  pad: 'saw' | 'dark' | 'soft' | 'chip';
  /** 'skank' reggae off-beat chops, 'wah' funk guitar through an auto-wah. */
  keys: 'stab' | 'epiano' | 'skank' | 'wah';
  /** Length of a keys hit, 16ths. */
  keysLen: number;
  arp: 'square' | 'pluck' | 'cowbell' | 'pulse';
  /** Chord-tone indices the arpeggio walks; indices past the chord size go up an octave. */
  arpOrder: readonly number[];
  /** The arp rests while a lead note sounds (one instrument plays both: the cowbell riff fills the melody's gaps). */
  arpYields?: boolean;
  lead: 'saw' | 'square' | 'flute' | 'cowbell' | 'brass' | 'melodica' | 'pulse';
  kickTune: number;
  kickDecay: number;
  /** Kick character: 'hard' more drive and click, 'chip' a stepped-triangle dive. */
  kick?: 'hard' | 'chip';
  snare: 'gated' | 'crisp' | 'rim' | 'rimshot' | 'chip';
  hat: 'tick' | 'shaker' | 'chip';
  /** Bass saturation (an 808's harmonics are what a phone speaker plays). */
  drive?: number;
  /** Bass slide time ('~'), s. */
  glide?: number;
  /** Vinyl crackle bed. */
  crackle: boolean;
  /** Echo time in beats (0.75 = dotted eighth). */
  echo: number;
  /** Echo send from arps, lead and stabs (0.32), feedback (0.36) and the repeats' lowpass (2600 Hz). */
  echoSend?: number;
  echoFeedback?: number;
  echoTone?: number;
  /** Dub: snare, perc and keys go into the echo at this level, and each section's last bar throws everything in. */
  throws?: number;
  /** Reverb send for snare / pad / lead. */
  reverb: number;
  /** Overall level trim so stations sit at the same loudness. */
  trim: number;
  /** The lead's level against the rest (1 when left out; the title theme's hook sits on top). */
  leadGain?: number;
}

/**
 * One song on a station: its own key, progressions and melody, played
 * through the song form (intro, verse, chorus, break, chorus, outro; see
 * sequencer.ts), then the next song.
 */
export interface Song {
  title: string;
  /** Made up, like the stations. */
  artist: string;
  /** Semitones from the station's key (within ±5, so voicings and the bass stay in range). */
  transpose: number;
  /** Intro, verse, break and outro chords, one per bar (8). */
  verse: readonly Chord[];
  /** Chorus chords (8); the verse's when left out. */
  chorus?: readonly Chord[];
  leadSeed: number;
  /** A hand-written 8-bar melody, played as written instead of one composed from `leadSeed` (the title theme's hook). */
  melody?: readonly MotifNote[];
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
  /** The station's songs, in play order (the first is `progression` / `leadSeed`). */
  songs: readonly Song[];
}

/** A chord: root in semitones above the key, quality. */
const c = (root: number, quality: Chord['quality']): Chord => ({ root, quality });

const NIGHTDRIVE_PROGRESSION: readonly Chord[] = [
  { root: 0, quality: 'min' },
  { root: 8, quality: 'maj' },
  { root: 3, quality: 'maj' },
  { root: 10, quality: 'maj' },
  { root: 0, quality: 'min' },
  { root: 8, quality: 'maj' },
  { root: 5, quality: 'min' },
  { root: 7, quality: 'maj' },
];

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
  progression: NIGHTDRIVE_PROGRESSION,
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
  songs: [
    {
      title: 'Neon Overpass',
      artist: 'Vela Grey',
      transpose: 0,
      verse: NIGHTDRIVE_PROGRESSION,
      chorus: [c(8, 'maj'), c(10, 'maj'), c(0, 'min'), c(0, 'min'), c(8, 'maj'), c(10, 'maj'), c(7, 'maj'), c(7, 'maj')],
      leadSeed: 7,
    },
    {
      title: 'Tail Lights in the Rain',
      artist: 'Midnight Arcade',
      transpose: 3,
      verse: [c(0, 'min'), c(10, 'maj'), c(8, 'maj'), c(10, 'maj'), c(0, 'min'), c(10, 'maj'), c(8, 'maj'), c(7, 'maj')],
      chorus: [c(8, 'maj'), c(10, 'maj'), c(0, 'min'), c(0, 'min'), c(5, 'min'), c(8, 'maj'), c(7, 'maj'), c(7, 'maj')],
      leadSeed: 21,
    },
    {
      title: 'Chrome Heart',
      artist: 'Static Coast',
      transpose: -2,
      verse: [c(0, 'min'), c(0, 'min'), c(5, 'min'), c(5, 'min'), c(8, 'maj'), c(8, 'maj'), c(7, 'maj'), c(7, 'maj')],
      chorus: [c(0, 'min'), c(8, 'maj'), c(3, 'maj'), c(10, 'maj'), c(0, 'min'), c(8, 'maj'), c(3, 'maj'), c(10, 'maj')],
      leadSeed: 44,
    },
    {
      title: 'Last Exit 99',
      artist: 'Vela Grey',
      transpose: 5,
      verse: [c(8, 'maj7'), c(10, 'maj'), c(0, 'min7'), c(0, 'min7'), c(8, 'maj7'), c(10, 'maj'), c(3, 'maj7'), c(7, 'maj')],
      chorus: [c(0, 'min'), c(10, 'maj'), c(8, 'maj'), c(10, 'maj'), c(0, 'min'), c(10, 'maj'), c(8, 'maj'), c(7, 'dom7')],
      leadSeed: 63,
    },
  ],
};

const BREAKNECK_PROGRESSION: readonly Chord[] = [
  { root: 0, quality: 'min7' },
  { root: 1, quality: 'maj7' },
  { root: 0, quality: 'min7' },
  { root: 10, quality: 'maj' },
  { root: 0, quality: 'min7' },
  { root: 1, quality: 'maj7' },
  { root: 8, quality: 'maj7' },
  { root: 7, quality: 'min7' },
];

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
  progression: BREAKNECK_PROGRESSION,
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
  songs: [
    {
      title: 'Kerb Crawler',
      artist: 'DJ Hazard Lights',
      transpose: 0,
      verse: BREAKNECK_PROGRESSION,
      chorus: [c(8, 'maj7'), c(10, 'maj'), c(0, 'min7'), c(0, 'min7'), c(8, 'maj7'), c(10, 'maj'), c(7, 'min7'), c(7, 'min7')],
      leadSeed: 31,
    },
    {
      title: 'Amen to That',
      artist: 'Rotor & Clutch',
      transpose: 2,
      verse: [c(0, 'min7'), c(0, 'min7'), c(1, 'maj7'), c(1, 'maj7'), c(0, 'min7'), c(0, 'min7'), c(10, 'maj'), c(8, 'maj7')],
      chorus: [c(5, 'min7'), c(5, 'min7'), c(1, 'maj7'), c(1, 'maj7'), c(5, 'min7'), c(3, 'maj'), c(1, 'maj7'), c(10, 'maj')],
      leadSeed: 52,
    },
    {
      title: 'Red Light Runner',
      artist: 'Siren Theory',
      transpose: -3,
      verse: [c(0, 'min7'), c(3, 'maj'), c(5, 'min7'), c(3, 'maj'), c(0, 'min7'), c(3, 'maj'), c(1, 'maj7'), c(1, 'maj7')],
      chorus: [c(8, 'maj7'), c(7, 'min7'), c(5, 'min7'), c(3, 'maj'), c(8, 'maj7'), c(7, 'min7'), c(1, 'maj7'), c(1, 'maj7')],
      leadSeed: 77,
    },
    {
      title: 'Overpass Bass',
      artist: 'DJ Hazard Lights',
      transpose: 4,
      verse: [c(0, 'min9'), c(0, 'min9'), c(10, 'maj'), c(10, 'maj'), c(8, 'maj7'), c(8, 'maj7'), c(1, 'maj7'), c(1, 'maj7')],
      chorus: [c(0, 'min7'), c(1, 'maj7'), c(0, 'min7'), c(10, 'maj'), c(8, 'maj7'), c(10, 'maj'), c(1, 'maj7'), c(1, 'maj7')],
      leadSeed: 90,
    },
  ],
};

const LOW_TIDE_PROGRESSION: readonly Chord[] = [
  { root: 0, quality: 'min9' },
  { root: 0, quality: 'min9' },
  { root: 8, quality: 'maj9' },
  { root: 8, quality: 'maj9' },
  { root: 5, quality: 'min9' },
  { root: 5, quality: 'min9' },
  { root: 7, quality: 'dom7' },
  { root: 7, quality: 'dom7' },
];

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
  progression: LOW_TIDE_PROGRESSION,
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
  songs: [
    {
      title: 'Rain on the Windshield',
      artist: 'Mellow Hydrant',
      transpose: 0,
      verse: LOW_TIDE_PROGRESSION,
      chorus: [c(8, 'maj9'), c(8, 'maj9'), c(10, 'dom7'), c(10, 'dom7'), c(0, 'min9'), c(0, 'min9'), c(7, 'dom7'), c(7, 'dom7')],
      leadSeed: 113,
    },
    {
      title: '3 AM Laundromat',
      artist: 'Soft Tyres',
      transpose: -3,
      verse: [c(5, 'min9'), c(10, 'dom7'), c(3, 'maj9'), c(3, 'maj9'), c(5, 'min9'), c(10, 'dom7'), c(0, 'min9'), c(0, 'min9')],
      chorus: [c(8, 'maj9'), c(7, 'dom7'), c(0, 'min9'), c(0, 'min9'), c(8, 'maj9'), c(7, 'dom7'), c(0, 'min9'), c(10, 'sus2')],
      leadSeed: 127,
    },
    {
      title: 'Parking Garage Echo',
      artist: 'Mellow Hydrant',
      transpose: 2,
      verse: [c(0, 'min9'), c(0, 'min9'), c(5, 'dom7'), c(5, 'dom7'), c(0, 'min9'), c(0, 'min9'), c(5, 'dom7'), c(7, 'dom7')],
      chorus: [c(3, 'maj9'), c(3, 'maj9'), c(5, 'min9'), c(5, 'min9'), c(8, 'maj9'), c(8, 'maj9'), c(7, 'dom7'), c(7, 'dom7')],
      leadSeed: 141,
    },
    {
      title: 'Night Bus Home',
      artist: 'Corner Store Choir',
      transpose: 5,
      verse: [c(0, 'min9'), c(8, 'maj9'), c(3, 'maj9'), c(10, 'dom7'), c(0, 'min9'), c(8, 'maj9'), c(3, 'maj9'), c(10, 'dom7')],
      chorus: [c(5, 'min9'), c(5, 'min9'), c(0, 'min9'), c(0, 'min9'), c(8, 'maj9'), c(10, 'dom7'), c(0, 'min9'), c(0, 'min9')],
      leadSeed: 166,
    },
  ],
};

const SIDEWAYS_PROGRESSION: readonly Chord[] = [c(0, 'min'), c(0, 'min'), c(1, 'maj'), c(1, 'maj'), c(0, 'min'), c(0, 'min'), c(8, 'maj'), c(7, 'min')];

/**
 * Phonk for drifting: a distorted 808 that slides between notes, a melodic
 * cowbell riff (the melody takes the bell over in the chorus, the riff
 * fills its gaps), a hard kick and rolling hats, dark phrygian keys.
 */
const SIDEWAYS: Station = {
  id: 'sideways',
  name: 'SIDEWAYS 808',
  key: 42, // F# phrygian
  bassLow: 29,
  padCenter: 61,
  leadTonic: 66,
  leadScale: SCALES.phrygian,
  leadSeed: 208,
  // F#m F#m G G | F#m F#m D C#m
  progression: SIDEWAYS_PROGRESSION,
  bpm: [124, 140],
  swing: 0,
  tiers: [
    { hat: 'o...o...o...o...', bass: 'x-----------x--~', arp: 'x.....x.....x...', pad: true, cutoff: 2000 },
    { kick: 'x.........x.....', hat: 'o.o.o.o.o.o.o.o.', bass: 'x---------x--~o-', arp: 'x..x..x...x..x..', pad: true, cutoff: 2600 },
    {
      kick: 'x.........x.....',
      snare: '....x.......x...',
      hat: 'x.o.x.o.x.o.x.or',
      bass: 'x---------x--~o-',
      arp: 'x..x..x...x..x..',
      pad: true,
      cutoff: 3600,
    },
    {
      kick: 'x.....x...x.....',
      snare: '....x.......x...',
      hat: 'xoxoxoxrxoxoxoxt',
      bass: 'x-----x---x--~o~',
      arp: 'x.xx.x.xx.x.x.x.',
      pad: true,
      cutoff: 5500,
    },
    {
      kick: 'x.....x...x...x.',
      snare: '....x.......x...',
      clap: '....x.......x...',
      hat: 'xoxoxoxrxoxoxtxr',
      bass: 'x-----x---x--~o~',
      arp: 'x.xx.x.xx.x.x.x.',
      lead: true,
      pad: true,
      cutoff: 8000,
    },
    {
      kick: 'x.....x...x...x.',
      snare: '....x.......x...',
      clap: '....x.......x...',
      hat: 'xoxtxoxrxoxoxtrr',
      openHat: '..........x.....',
      bass: 'x--x--x---x--~o~',
      arp: 'x.xx.x.xx.x.x.x.',
      lead: true,
      pad: true,
      crash: true,
      riser: true,
      cutoff: 12000,
    },
  ],
  menu: { bass: 'x---------------', arp: 'x.....x.....x...', pad: true, cutoff: 1800 },
  sound: {
    bass: '808',
    pad: 'dark',
    keys: 'stab',
    keysLen: 2,
    arp: 'cowbell',
    arpOrder: [0, 1, 2, 1, 0, 2, 1, 2],
    arpYields: true,
    lead: 'cowbell',
    kickTune: 52,
    kickDecay: 0.2,
    kick: 'hard',
    snare: 'crisp',
    hat: 'tick',
    drive: 3,
    glide: 0.09,
    crackle: false,
    echo: 0.5,
    reverb: 0.22,
    trim: 0.87,
  },
  songs: [
    {
      title: 'Handbrake Hymn',
      artist: 'SKIDMXRK',
      transpose: 0,
      verse: SIDEWAYS_PROGRESSION,
      chorus: [c(8, 'maj'), c(10, 'maj'), c(0, 'min'), c(0, 'min'), c(8, 'maj'), c(10, 'maj'), c(1, 'maj'), c(1, 'maj')],
      leadSeed: 208,
    },
    {
      title: 'Smoke the Apex',
      artist: 'Lil Handbrake',
      transpose: -2,
      verse: [c(0, 'min'), c(5, 'min'), c(0, 'min'), c(1, 'maj'), c(0, 'min'), c(5, 'min'), c(8, 'maj'), c(7, 'dom7')],
      chorus: [c(5, 'min'), c(5, 'min'), c(1, 'maj'), c(1, 'maj'), c(0, 'min'), c(0, 'min'), c(7, 'dom7'), c(7, 'dom7')],
      leadSeed: 233,
    },
    {
      title: 'Sideways Till Sunrise',
      artist: 'Tyre Wraith',
      transpose: 3,
      verse: [c(0, 'min7'), c(0, 'min7'), c(8, 'maj7'), c(8, 'maj7'), c(1, 'maj7'), c(1, 'maj7'), c(0, 'min7'), c(10, 'maj')],
      chorus: [c(8, 'maj'), c(1, 'maj'), c(0, 'min'), c(0, 'min'), c(8, 'maj'), c(1, 'maj'), c(7, 'min'), c(7, 'min')],
      leadSeed: 251,
    },
    {
      title: 'Cowbell Requiem',
      artist: 'SKIDMXRK',
      transpose: -4,
      verse: [c(0, 'min'), c(1, 'maj'), c(0, 'min'), c(1, 'maj'), c(8, 'maj'), c(7, 'min'), c(0, 'min'), c(0, 'min')],
      chorus: [c(3, 'maj'), c(1, 'maj'), c(0, 'min'), c(0, 'min'), c(3, 'maj'), c(1, 'maj'), c(10, 'maj'), c(7, 'dom7')],
      leadSeed: 274,
    },
  ],
};

const GETAWAY_PROGRESSION: readonly Chord[] = [c(0, 'min7'), c(0, 'min7'), c(5, 'dom9'), c(5, 'dom9'), c(0, 'min7'), c(0, 'min7'), c(5, 'dom9'), c(7, 'dom7')];

/**
 * Funk and disco for a chase: slap bass (thumbed roots, popped octaves,
 * ghost notes), wah guitar chops, four on the floor with open hats on the
 * off-beats, string pads and a brass lead up top.
 */
const GETAWAY: Station = {
  id: 'getaway',
  name: 'GETAWAY 104.3',
  key: 40, // E dorian
  bassLow: 35,
  padCenter: 62,
  leadTonic: 64,
  leadScale: SCALES.dorian,
  leadSeed: 305,
  // Em7 Em7 A9 A9 | Em7 Em7 A9 B7
  progression: GETAWAY_PROGRESSION,
  bpm: [108, 124],
  swing: 0.08,
  tiers: [
    { hat: 'x.o.x.o.x.o.x.o.', bass: 'x-..x-.o..x-.o..', keys: '....x.......x...', pad: true, cutoff: 2200 },
    { kick: 'x...x...x...x...', hat: 'x.o.x.o.x.o.x.o.', bass: 'x-..x-.o..x-.o..', keys: '....x..o....x..o', pad: true, cutoff: 2800 },
    {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: 'x...x...x...x...',
      openHat: '..x...x...x...x.',
      bass: 'x-.gx-.o..x-gxo.',
      keys: '..o.x..o..o.x..o',
      pad: true,
      cutoff: 3300,
    },
    {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      clap: '....o.......o...',
      hat: 'xo.oxo.oxo.oxo.o',
      openHat: '..x...x...x...x.',
      bass: 'x.gog.g5x.gog.o7',
      keys: '.ox.x.o..ox.x.o.',
      cutoff: 5000,
    },
    {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      clap: '....o.......o...',
      hat: 'xo.oxo.oxo.oxo.o',
      openHat: '..x...x...x...x.',
      bass: 'x.gog.x5x.gog7o.',
      keys: '.ox.x.o..ox.x.o.',
      lead: true,
      pad: true,
      cutoff: 7500,
    },
    {
      kick: 'x...x...x...x...',
      snare: '....x.......x..o',
      clap: '....o.......o...',
      hat: 'xo.oxo.oxo.oxo.o',
      openHat: '..x...x...x...x.',
      perc: '..o..o.o..o..o.o',
      bass: 'x.gog.x5x.gog7o.',
      keys: '.ox.x.o..ox.x.o.',
      lead: true,
      pad: true,
      crash: true,
      riser: true,
      cutoff: 11000,
    },
  ],
  menu: { bass: 'x---x-.o..x---o.', keys: '....x..o....x..o', pad: true, cutoff: 2400 },
  sound: {
    bass: 'slap',
    pad: 'saw',
    keys: 'wah',
    keysLen: 1,
    arp: 'pluck',
    arpOrder: [0, 1, 2, 1],
    lead: 'brass',
    kickTune: 50,
    kickDecay: 0.24,
    snare: 'crisp',
    hat: 'tick',
    crackle: false,
    echo: 0.5,
    reverb: 0.24,
    trim: 1,
  },
  songs: [
    {
      title: 'Wheelman Shuffle',
      artist: 'The Hubcap Horns',
      transpose: 0,
      verse: GETAWAY_PROGRESSION,
      chorus: [c(3, 'maj7'), c(5, 'dom9'), c(7, 'min7'), c(7, 'min7'), c(3, 'maj7'), c(5, 'dom9'), c(0, 'min9'), c(0, 'min9')],
      leadSeed: 305,
    },
    {
      title: 'Getaway Groove',
      artist: 'Lady Turbo',
      transpose: 2,
      verse: [c(0, 'min9'), c(0, 'min9'), c(10, 'dom9'), c(10, 'dom9'), c(0, 'min9'), c(0, 'min9'), c(10, 'dom9'), c(5, 'dom7')],
      chorus: [c(8, 'maj7'), c(10, 'dom7'), c(0, 'min7'), c(0, 'min7'), c(8, 'maj7'), c(10, 'dom7'), c(3, 'maj7'), c(5, 'dom9')],
      leadSeed: 322,
    },
    {
      title: 'Glovebox Boogie',
      artist: 'Brother Overdrive',
      transpose: -3,
      verse: [c(0, 'min7'), c(5, 'min7'), c(0, 'min7'), c(5, 'min7'), c(8, 'maj7'), c(7, 'dom7'), c(0, 'min7'), c(0, 'min7')],
      chorus: [c(3, 'maj7'), c(5, 'min7'), c(10, 'dom9'), c(3, 'maj7'), c(8, 'maj7'), c(5, 'min7'), c(7, 'dom7'), c(7, 'dom7')],
      leadSeed: 347,
    },
    {
      title: 'Hot Wire Strut',
      artist: 'The Hubcap Horns',
      transpose: 5,
      verse: [c(0, 'dom9'), c(0, 'dom9'), c(5, 'dom9'), c(5, 'dom9'), c(0, 'dom9'), c(0, 'dom9'), c(7, 'dom9'), c(5, 'dom9')],
      chorus: [c(5, 'dom9'), c(5, 'dom9'), c(0, 'dom9'), c(0, 'dom9'), c(7, 'dom9'), c(5, 'dom9'), c(0, 'dom9'), c(7, 'dom7')],
      leadSeed: 366,
    },
  ],
};

const DUBWISE_PROGRESSION: readonly Chord[] = [c(0, 'min'), c(0, 'min'), c(10, 'maj'), c(10, 'maj'), c(0, 'min'), c(0, 'min'), c(5, 'min'), c(7, 'min')];

/**
 * Dub for cruising: the one drop (kick and rimshot together on beat 3),
 * skanks on 2 and 4, a deep sub bass carrying the tune, a melodica, and a
 * dark tape echo that each section's last bar is thrown into. Stepping up
 * goes to rockers and then steppers (a kick on every beat).
 */
const DUBWISE: Station = {
  id: 'dubwise',
  name: 'DUBWISE 88.8',
  key: 43, // G minor
  bassLow: 31,
  padCenter: 62,
  leadTonic: 67,
  leadScale: SCALES.pentatonicMinor,
  leadSeed: 404,
  // Gm Gm F F | Gm Gm Cm Dm
  progression: DUBWISE_PROGRESSION,
  bpm: [70, 80],
  swing: 0.14,
  tiers: [
    { hat: '..o...o...o...o.', keys: '....x.......x...', bass: 'x---..x-5-..3-4-', cutoff: 1500 },
    { kick: '........x.......', hat: '..o...o...o...o.', keys: '....x.......x...', bass: 'x---..x-5-..3-4-', cutoff: 1900 },
    {
      kick: '........x.......',
      snare: '........x.......',
      hat: 'o.o.o.o.o.o.o.o.',
      keys: '....x.......x...',
      bass: 'x--.x-5...3-4-5.',
      cutoff: 2500,
    },
    {
      kick: 'x.......x.......',
      snare: '........x.......',
      hat: 'x.o.x.o.x.o.x.oo',
      perc: '..........o.....',
      keys: '....x.o.....x.o.',
      bass: 'x-.xx-5..x3-4-5.',
      cutoff: 3300,
    },
    {
      kick: 'x.......x.......',
      snare: '........x.......',
      hat: 'x.o.x.o.x.o.x.oo',
      openHat: '......x.......x.',
      perc: '..o.......o..o..',
      keys: '....x.o.....x.o.',
      bass: 'x-.xx-5..73-4-5.',
      lead: true,
      cutoff: 4800,
    },
    {
      kick: 'x...o...x...o...',
      snare: '....o...x...o...',
      hat: 'xoxoxoxoxoxoxoxo',
      openHat: '......x.......x.',
      perc: '..o..o....o..o..',
      keys: '....x.o.....x.o.',
      bass: 'x-.xx-5..73-4-5.',
      lead: true,
      crash: true,
      riser: true,
      cutoff: 7000,
    },
  ],
  menu: { bass: 'x---..x-5-..3-..', keys: '....x.......x...', pad: true, cutoff: 1500 },
  sound: {
    bass: 'sub',
    pad: 'dark',
    keys: 'skank',
    keysLen: 1,
    arp: 'pluck',
    arpOrder: [0, 1, 2],
    lead: 'melodica',
    kickTune: 46,
    kickDecay: 0.28,
    snare: 'rimshot',
    hat: 'tick',
    drive: 1.6,
    crackle: false,
    echo: 0.75,
    echoSend: 0.5,
    echoFeedback: 0.6,
    echoTone: 1400,
    throws: 0.45,
    reverb: 0.42,
    trim: 1.27,
  },
  songs: [
    {
      title: 'Pothole Dub',
      artist: 'King Pothole',
      transpose: 0,
      verse: DUBWISE_PROGRESSION,
      chorus: [c(3, 'maj'), c(10, 'maj'), c(5, 'min'), c(0, 'min'), c(3, 'maj'), c(10, 'maj'), c(7, 'min'), c(0, 'min')],
      leadSeed: 404,
    },
    {
      title: 'Sunday Cruiser',
      artist: 'Sister Sub',
      transpose: 2,
      verse: [c(0, 'min7'), c(0, 'min7'), c(5, 'min7'), c(5, 'min7'), c(0, 'min7'), c(0, 'min7'), c(7, 'min7'), c(5, 'min7')],
      chorus: [c(8, 'maj'), c(10, 'maj'), c(0, 'min7'), c(0, 'min7'), c(8, 'maj'), c(10, 'maj'), c(5, 'min7'), c(7, 'min7')],
      leadSeed: 421,
    },
    {
      title: 'Speedbump Skank',
      artist: 'Roots Radiator',
      transpose: -3,
      verse: [c(0, 'min'), c(3, 'maj'), c(0, 'min'), c(3, 'maj'), c(8, 'maj'), c(10, 'maj'), c(0, 'min'), c(0, 'min')],
      chorus: [c(5, 'min'), c(5, 'min'), c(0, 'min'), c(0, 'min'), c(5, 'min'), c(10, 'maj'), c(0, 'min'), c(0, 'min')],
      leadSeed: 446,
    },
    {
      title: 'Hazard Light Version',
      artist: 'King Pothole',
      transpose: 4,
      verse: [c(0, 'min'), c(0, 'min'), c(0, 'min'), c(10, 'maj'), c(0, 'min'), c(0, 'min'), c(8, 'maj'), c(10, 'maj')],
      chorus: [c(8, 'maj'), c(8, 'maj'), c(10, 'maj'), c(10, 'maj'), c(0, 'min'), c(5, 'min'), c(10, 'maj'), c(10, 'maj')],
      leadSeed: 469,
    },
  ],
};

const INSERT_COIN_PROGRESSION: readonly Chord[] = [c(0, 'maj'), c(9, 'min'), c(5, 'maj'), c(7, 'maj'), c(0, 'maj'), c(9, 'min'), c(2, 'min'), c(7, 'maj')];

/**
 * Chiptune: an 8-bit console's four voices. Pulse-wave lead and arps (thin
 * and square duty cycles), a stepped-triangle bass, noise-channel drums and
 * a triangle kick, fast chord arpeggios.
 */
const INSERT_COIN: Station = {
  id: 'insertcoin',
  name: 'INSERT COIN',
  key: 50, // D major
  bassLow: 40,
  padCenter: 66,
  leadTonic: 62,
  leadScale: SCALES.major,
  leadSeed: 512,
  // D Bm G A | D Bm Em A
  progression: INSERT_COIN_PROGRESSION,
  bpm: [140, 160],
  swing: 0,
  tiers: [
    { hat: 'o...o...o...o...', bass: 'x-..x-..x-..x-..', arp: 'x.x.x.x.x.x.x.x.', cutoff: 2600 },
    { kick: 'x.......x.......', hat: 'o.o.o.o.o.o.o.o.', bass: 'x.x.o.x.x.5.o.x.', arp: 'x.x.x.x.x.x.x.x.', pad: true, cutoff: 3200 },
    {
      kick: 'x.......x.......',
      snare: '....x.......x...',
      hat: 'x.o.x.o.x.o.x.o.',
      bass: 'x.x.o.x.x.5.o.x.',
      arp: 'xxxxxxxxxxxxxxxx',
      pad: true,
      cutoff: 4200,
    },
    {
      kick: 'x.....x...x..x..',
      snare: '....x.......x...',
      hat: 'xoxoxoxoxoxoxoxo',
      bass: 'x.xox.xox.5ox.xo',
      arp: 'xxxxxxxxxxxxxxxx',
      pad: true,
      cutoff: 6000,
    },
    {
      kick: 'x.....x...x..x..',
      snare: '....x.......x...',
      hat: 'xoxoxoxoxoxoxoxo',
      perc: '..............xo',
      bass: 'x.xox.xox.5ox.xo',
      arp: 'xxxxxxxxxxxxxxxx',
      lead: true,
      pad: true,
      cutoff: 8500,
    },
    {
      kick: 'x.....x...x..x..',
      snare: '....x.......x...',
      hat: 'xoxoxoxoxoxoxoxo',
      openHat: '..x...x...x...x.',
      perc: '...........x.xx.',
      bass: 'x.xox.xox.5ox.xo',
      arp: 'xxxxxxxxxxxxxxxx',
      lead: true,
      pad: true,
      crash: true,
      riser: true,
      cutoff: 12000,
    },
  ],
  menu: { bass: 'x-..x-..x-..x-..', arp: 'x.x.x.x.x.x.x.x.', pad: true, cutoff: 2600 },
  sound: {
    bass: 'tri',
    pad: 'chip',
    keys: 'stab',
    keysLen: 2,
    arp: 'pulse',
    arpOrder: [0, 1, 2, 3, 2, 1],
    lead: 'pulse',
    kickTune: 55,
    kickDecay: 0.18,
    kick: 'chip',
    snare: 'chip',
    hat: 'chip',
    crackle: false,
    echo: 0.5,
    echoSend: 0.18,
    reverb: 0.12,
    trim: 1.27,
  },
  songs: [
    {
      title: 'High Score Heist',
      artist: 'Cartridge Kid',
      transpose: 0,
      verse: INSERT_COIN_PROGRESSION,
      chorus: [c(5, 'maj'), c(7, 'maj'), c(4, 'min'), c(9, 'min'), c(5, 'maj'), c(7, 'maj'), c(0, 'maj'), c(0, 'maj')],
      leadSeed: 512,
    },
    {
      title: 'One More Credit',
      artist: 'Player Two',
      transpose: -2,
      verse: [c(0, 'maj'), c(7, 'maj'), c(9, 'min'), c(5, 'maj'), c(0, 'maj'), c(7, 'maj'), c(5, 'maj'), c(7, 'maj')],
      chorus: [c(5, 'maj'), c(7, 'maj'), c(0, 'maj'), c(9, 'min'), c(5, 'maj'), c(7, 'maj'), c(0, 'maj'), c(0, 'maj')],
      leadSeed: 537,
    },
    {
      title: 'Boss Rush Hour',
      artist: 'Bitcrush Bandit',
      transpose: 3,
      verse: [c(9, 'min'), c(5, 'maj'), c(7, 'maj'), c(9, 'min'), c(9, 'min'), c(5, 'maj'), c(7, 'maj'), c(4, 'maj')],
      chorus: [c(5, 'maj'), c(7, 'maj'), c(9, 'min'), c(9, 'min'), c(5, 'maj'), c(7, 'maj'), c(4, 'maj'), c(4, 'maj')],
      leadSeed: 559,
    },
    {
      title: 'Bonus Stage Getaway',
      artist: 'Cartridge Kid',
      transpose: -5,
      verse: [c(0, 'maj'), c(0, 'maj'), c(5, 'maj'), c(5, 'maj'), c(2, 'min'), c(7, 'maj'), c(0, 'maj'), c(7, 'maj')],
      chorus: [c(5, 'maj'), c(4, 'min'), c(2, 'min'), c(7, 'maj'), c(5, 'maj'), c(4, 'min'), c(2, 'min'), c(7, 'maj')],
      leadSeed: 583,
    },
  ],
};

/**
 * Stations in tuning order. The saved station is an index into this
 * ('curbside.station'), so new ones go on the end.
 */
export const STATIONS: readonly Station[] = [NIGHTDRIVE, BREAKNECK, LOW_TIDE, SIDEWAYS, GETAWAY, DUBWISE, INSERT_COIN];
