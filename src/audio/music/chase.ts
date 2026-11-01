/**
 * The chase: Curbside's own pursuit music, a score that takes over from the
 * radio once the police are really after you (CHASE_FROM stars) and gives
 * the radio back when they've lost you.
 *
 * Like the title theme it's a station of its own, off the dial, played
 * through its own looping form: it comes in on the hook (themes.ts) and keeps
 * it for every chorus, a brass lead over a breakbeat, a reese bass pushing
 * octaves and saw stabs on the hook's 3+3+2. Unlike the theme it follows the
 * intensity (the wanted level and play), from a tense pulse at one star to
 * everything at five, and leaves through a two-bar breath: the hook alone
 * over the pad, drums out. Its lead scale is chromatic, so melody degrees
 * are semitones above the lead tonic.
 *
 * ChaseMusic decides when it plays (pure, tested); GameAudio wires it up.
 */
import type { WantedReason } from '../../systems/wanted';
import type { Section, Theme } from './sequencer';
import type { Station, Tier } from './stations';
import { CHROMATIC, HOOK } from './themes';
import type { Chord, MotifNote } from './theory';

const n = (step: number, degree: number, len: number): MotifNote => ({ step, degree, len });
const at = (notes: readonly MotifNote[], bar: number) => notes.map((m) => ({ ...m, step: m.step + bar * 16 }));

/**
 * The chase's 8 bars over its chorus: the hook; an answer on the hook's
 * own 3+3+2, pushing up and turning on the leading tone; the hook again;
 * then a climb that hangs on the leading tone, so the loop drives on.
 */
export const CHASE_MELODY: readonly MotifNote[] = [
  ...at(HOOK, 0),
  ...at([n(0, 14, 3), n(3, 14, 3), n(6, 17, 2), n(8, 14, 6), n(16, 11, 3), n(19, 14, 3), n(22, 17, 2), n(24, 14, 4), n(28, 7, 2), n(30, 11, 2)], 2),
  ...at(HOOK, 4),
  ...at([n(0, 5, 2), n(2, 8, 2), n(4, 12, 2), n(6, 8, 2), n(8, 12, 3), n(11, 15, 3), n(14, 17, 2), n(16, 14, 3), n(19, 11, 3), n(22, 7, 2), n(24, 11, 8)], 6),
];

const c = (root: number, quality: Chord['quality']): Chord => ({ root, quality });

/** Em C D B7 | Em C Am B7: under the hook. */
export const CHASE_CHORUS: readonly Chord[] = [c(0, 'min'), c(8, 'maj'), c(10, 'maj'), c(7, 'dom7'), c(0, 'min'), c(8, 'maj'), c(5, 'min'), c(7, 'dom7')];
/** Em Em C D | Em Em F B7: the verse and breaks, with the flat second's menace. */
export const CHASE_VERSE: readonly Chord[] = [c(0, 'min'), c(0, 'min'), c(8, 'maj'), c(10, 'maj'), c(0, 'min'), c(0, 'min'), c(1, 'maj'), c(7, 'dom7')];
/** Em D C B7, twice: the second cue's verse, falling to the dominant. */
const CHASE_VERSE_2: readonly Chord[] = [c(0, 'min'), c(10, 'maj'), c(8, 'maj'), c(7, 'dom7'), c(0, 'min'), c(10, 'maj'), c(8, 'maj'), c(7, 'dom7')];

/** Breakbeat drums from intensity 3 (the chase proper); 1 and 2 are the calmer chase at one or two stars. */
const TIERS: readonly Tier[] = [
  { hat: '..o...o...o...o.', bass: 'x.x.x.x.x.x.x.x.', pad: true, cutoff: 1600 },
  { kick: 'x.......x.......', hat: 'o.o.o.o.o.o.o.o.', bass: 'x.x.x.x.x.x.x.o.', keys: 'x.........x.....', pad: true, cutoff: 2200 },
  {
    kick: 'x.........x.....',
    snare: '....x.......x...',
    hat: 'x.o.x.o.x.o.x.o.',
    bass: 'x.o.x.o.x.o.x.o.',
    keys: 'x..x..x.........',
    pad: true,
    cutoff: 3000,
  },
  {
    kick: 'x.x.......xx....',
    snare: '....x..o.o..x..o',
    hat: 'xoxoxoxoxoxoxoxo',
    bass: 'x.oxx.oxx.oxx.ox',
    keys: 'x..x..x...x..x..',
    pad: true,
    cutoff: 4500,
  },
  {
    kick: 'x.x.......xx....',
    snare: '....x..o.o..x..o',
    clap: '....x.......x...',
    hat: 'xoxoxoxoxoxoxoxo',
    openHat: '......x.......x.',
    bass: 'x.oxx.oxx.oxx.ox',
    keys: 'x..x..x...x..x..',
    arp: 'x.x.x.x.x.x.x.x.',
    pad: true,
    crash: true,
    cutoff: 7000,
  },
  {
    kick: 'x.x.......xx..x.',
    snare: '....x..o.o..x.oo',
    clap: '....x.......x...',
    hat: 'xoxoxoxrxoxoxoxt',
    openHat: '......x.......x.',
    perc: '..o..o....o..o..',
    bass: 'x.oxx.oxx.oxx.ox',
    keys: 'x..x..x...x..x..',
    arp: 'xxxxxxxxxxxxxxxx',
    pad: true,
    crash: true,
    riser: true,
    cutoff: 11000,
  },
];

/** The way out: the hook alone over the pad and a held bass, drums out. */
const BREATH: Tier = { bass: 'x-------x-------', pad: true, lead: true, cutoff: 2000 };

export const CHASE_STATION: Station = {
  id: 'chase',
  name: 'CURBSIDE PURSUIT',
  key: 40, // E minor
  bassLow: 35,
  padCenter: 62,
  leadTonic: 64,
  leadScale: CHROMATIC,
  leadSeed: 0,
  progression: CHASE_VERSE,
  bpm: [128, 150],
  swing: 0,
  tiers: TIERS,
  menu: BREATH,
  sound: {
    bass: 'reese',
    pad: 'dark',
    keys: 'stab',
    keysLen: 2,
    arp: 'square',
    arpOrder: [0, 2, 1, 3, 2, 1],
    lead: 'brass',
    // SIDEWAYS 808's kit (a hard kick, a crisp snare): one kit for both.
    kickTune: 52,
    kickDecay: 0.2,
    kick: 'hard',
    snare: 'crisp',
    hat: 'tick',
    crackle: false,
    echo: 0.75,
    reverb: 0.26,
    trim: 0.68,
    // The hook rides over the breakbeat and the stabs.
    leadGain: 2.6,
  },
  songs: [
    { title: 'Blue Lights', artist: 'Halogen Getaway', transpose: 0, verse: CHASE_VERSE, chorus: CHASE_CHORUS, leadSeed: 0, melody: CHASE_MELODY },
    // Round again a minor third up: the same hook, higher.
    { title: 'Roadblock', artist: 'Halogen Getaway', transpose: 3, verse: CHASE_VERSE_2, chorus: CHASE_CHORUS, leadSeed: 0, melody: CHASE_MELODY },
  ],
};

/**
 * How a chase section plays the intensity's tier: every chorus has the hook
 * (so the chase is recognisable whenever it comes round), the verse drives
 * without it, and the two-bar break drops to a kick on the one, the hats and
 * a held bass, rising back into the chorus.
 */
export function chaseTier(tier: Tier, section: Section, _intensity: number): Tier {
  if (section === 'chorus') return tier.lead ? tier : { ...tier, lead: true };
  if (section === 'break') return { kick: 'x...............', hat: tier.hat, bass: 'x-------x-------', pad: true, riser: true, cutoff: Math.round(tier.cutoff * 0.6) };
  return tier.lead ? { ...tier, lead: false } : tier;
}

export const CHASE = {
  station: CHASE_STATION,
  // In on the hook; 36 bars round (about a minute at four stars), then the other cue.
  form: [
    ['chorus', 8],
    ['verse', 8],
    ['break', 2],
    ['chorus', 8],
    ['verse', 8],
    ['break', 2],
  ],
  shape: chaseTier,
  outro: { bars: 2, tier: BREATH },
} satisfies Theme;

/** Stars from which the chase takes over from the radio. */
export const CHASE_FROM = 3;

/** What the music should do about the chase: start it, let it calm down and hand back, or drop it now. */
export type ChaseCue = 'start' | 'end' | 'drop' | null;

/**
 * When the chase plays. It starts when the wanted level reaches CHASE_FROM,
 * stays (calmer) while the level drops to one or two stars, and ends when
 * the police have lost you (any way back to zero but a bust or a death,
 * which stop the music anyway). R during a chase drops it for the radio and
 * it stays away until the next chase: back to zero, then up again.
 */
export class ChaseMusic {
  /** 'idle': the radio; 'on': the chase; 'skipped': R dropped this chase. */
  phase: 'idle' | 'on' | 'skipped' = 'idle';

  /** The wanted level changed. */
  wanted(level: number, reason: WantedReason): ChaseCue {
    if (reason === 'busted' || reason === 'died') return this.reset();
    if (level <= 0) {
      const was = this.phase;
      this.phase = 'idle';
      return was === 'on' ? 'end' : null;
    }
    if (level >= CHASE_FROM && this.phase === 'idle') {
      this.phase = 'on';
      return 'start';
    }
    return null;
  }

  /** The player retuned (R): a chase playing gives way to the radio until the next one. */
  skip(): ChaseCue {
    if (this.phase !== 'on') return null;
    this.phase = 'skipped';
    return 'drop';
  }

  /** WASTED, BUSTED, a fresh run: no chase (the wanted level is reset too). */
  reset(): ChaseCue {
    const was = this.phase;
    this.phase = 'idle';
    return was === 'on' ? 'drop' : null;
  }
}
