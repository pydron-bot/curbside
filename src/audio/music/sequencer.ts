/**
 * The soundtrack's brain, free of Web Audio so it's unit-tested:
 *
 * - StepClock: look-ahead scheduling math. A ~25 ms timer asks "is the next
 *   16th due before now + lookahead?" and books it on the AudioContext clock,
 *   so timing stays sample-accurate however janky the main thread is.
 * - Arranger: what plays on each 16th. Intensity, station and mode changes
 *   wait for a bar line; stepping up gets a drum fill, tempo glides a few BPM
 *   per bar, pads are voice-led, and the lead melody repeats per phrase.
 *   Each station plays its songs in turn through a song FORM (intro, verse,
 *   chorus, break, chorus, outro), every song in its own key with its own
 *   chords and melody. While calm the form shapes the arrangement (a drumless
 *   intro, the melody saved for the chorus, a breakdown); in a chase
 *   (intensity FORM_FULL_FROM and up) every section plays in full.
 */
import { clamp, lerp } from '../mix';
import { STATIONS, type Song, type Station, type Tier } from './stations';
import { avoidClash, chordClasses, composeLead, fold, scaleNote, voiceChord, type MotifNote } from './theory';

export const STEPS_PER_BAR = 16;
export const BARS_PER_PHRASE = 8;
/** Steps fell this far behind (tab asleep, context suspended) → skip ahead instead of catching up. */
const MAX_LAG = 0.2;
/** Most the tempo moves per bar, BPM. */
const BPM_GLIDE = 6;

export class StepClock {
  /** Context time of the next 16th to book. */
  nextTime = 0;

  constructor(public bpm = 100) {}

  get stepDuration(): number {
    return 60 / this.bpm / 4;
  }

  reset(time: number): void {
    this.nextTime = time;
  }

  /**
   * True if the next step starts before `now + lookahead` and should be booked
   * now. If we've fallen behind (the context was suspended, or the tab slept)
   * the clock jumps forward rather than machine-gunning the backlog.
   */
  due(now: number, lookahead: number): boolean {
    if (this.nextTime < now - MAX_LAG) this.nextTime = now + 0.03;
    return this.nextTime < now + lookahead;
  }

  advance(): void {
    this.nextTime += this.stepDuration;
  }
}

export type Section = 'intro' | 'verse' | 'chorus' | 'break' | 'outro';

/** A song: its sections and their lengths in bars. */
export const FORM: ReadonlyArray<readonly [Section, number]> = [
  ['intro', 4],
  ['verse', 8],
  ['chorus', 8],
  ['break', 4],
  ['chorus', 8],
  ['outro', 4],
];
export const FORM_BARS = FORM.reduce((n, [, bars]) => n + bars, 0);
/** From this intensity up (a chase) the form no longer thins the arrangement out. */
export const FORM_FULL_FROM = 3;

export interface SectionAt {
  section: Section;
  /** Bar within the section, and the section's length. */
  bar: number;
  bars: number;
  /** The section after this one (the next song's intro after the outro). */
  next: Section;
}

/** Where bar `songBar` of a song falls in the form. */
export function sectionAt(songBar: number): SectionAt {
  let b = ((songBar % FORM_BARS) + FORM_BARS) % FORM_BARS;
  for (let i = 0; i < FORM.length; i++) {
    const [section, bars] = FORM[i];
    if (b < bars) return { section, bar: b, bars, next: FORM[(i + 1) % FORM.length][0] };
    b -= bars;
  }
  return { section: 'verse', bar: 0, bars: 8, next: 'chorus' };
}

/**
 * The tier as a section plays it. Calm: the intro and outro are drumless
 * (hats, bass and chords), the melody waits for the chorus (which always
 * has it, from intensity 1), and the break keeps only the chords and arp.
 * From FORM_FULL_FROM up every section is the tier itself (bar the verse's
 * melody until intensity 4).
 */
export function shapeTier(tier: Tier, section: Section, intensity: number): Tier {
  if (section === 'chorus') return tier.lead || intensity < 1 ? tier : { ...tier, lead: true };
  if (section === 'verse' || intensity >= FORM_FULL_FROM) return intensity >= 4 ? tier : { ...tier, lead: false };
  if (section === 'break') return { pad: true, keys: tier.keys, arp: tier.arp, cutoff: Math.round(tier.cutoff * 0.7) };
  return { hat: tier.hat, bass: tier.bass, pad: tier.pad, keys: tier.keys, arp: section === 'intro' ? tier.arp : undefined, cutoff: Math.round(tier.cutoff * 0.8) };
}

/** Swing: odd 16ths land late by `swing` of a step. */
export function swingOffset(step: number, swing: number, stepDuration: number): number {
  return step % 2 === 1 ? swing * stepDuration : 0;
}

export type Part =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'openHat'
  | 'perc'
  | 'crash'
  | 'riser'
  | 'bass'
  | 'pad'
  | 'keys'
  | 'arp'
  | 'lead';

export interface NoteEvent {
  part: Part;
  /** MIDI note for melodic parts (0 for drums). */
  note: number;
  /** Chord notes for pad / keys. */
  notes: readonly number[] | null;
  /** 0..1 */
  vel: number;
  /** Length in 16th steps. */
  len: number;
  /** Drums: hits in the step, evenly spaced (a hi-hat roll); 1 when left out. */
  roll?: number;
  /** Bass: glides in from the note before without a new attack (a '~' before it). */
  slide?: boolean;
  /** Bass: held into a note that slides in (its run ends in '~'), so it has no release of its own. */
  tie?: boolean;
}

export type MusicMode = 'game' | 'menu' | 'off';

/** Velocity of a drum-pattern character. */
export function hitVelocity(pattern: string | undefined, step: number): number {
  if (!pattern) return 0;
  const c = pattern.charCodeAt(step);
  return c === 120 /* x */ ? 1 : c === 111 /* o */ ? 0.5 : c === 114 /* r */ || c === 116 /* t */ ? 0.8 : 0;
}

/** Hits in a drum step: 2 for a roll ('r', 32nds), 3 for a triplet roll ('t'), else 1. */
export function rollCount(pattern: string | undefined, step: number): number {
  if (!pattern) return 1;
  const c = pattern.charCodeAt(step);
  return c === 114 /* r */ ? 2 : c === 116 /* t */ ? 3 : 1;
}

const HOLD = 45; // '-'
const SLIDE = 126; // '~'

/** Tempo for an intensity on a station (menus sit a little under the chill tempo). */
export function targetBpm(station: Station, intensity: number, mode: MusicMode): number {
  if (mode === 'menu') return station.bpm[0] - 6;
  return Math.round(lerp(station.bpm[0], station.bpm[1], clamp(intensity, 0, 5) / 5) * 2) / 2;
}

export interface ArrangerOptions {
  /** Play songs through FORM (default). Off: one song's verse loops (tests, the old behaviour). */
  form?: boolean;
}

export class Arranger {
  station: Station;
  /** The song playing, its bar in the form, and a count of songs started (listeners compare it). */
  song: Song;
  songBar = 0;
  songNumber = 0;
  mode: MusicMode = 'game';
  /** Intensity being played (changes only on a bar line). */
  intensity = 0;
  /** Intensity asked for. */
  target = 0;
  bpm: number;
  /** Position of the next step to produce. */
  bar = 0;
  step = 0;
  private pendingStation: Station | null = null;
  private pendingMode: MusicMode | null = null;
  private voicing: number[] | null = null;
  private classes: number[] = [];
  private chordRoot = 0;
  private fill = false;
  /** The music stepped up on this bar: hit the crash. */
  private rose = false;
  private arpCount = 0;
  /** Steps left of the lead note sounding (an arp that yields rests under it). */
  private leadLeft = 0;
  /** The last bass note was held into a slide: the next one glides in. */
  private bassTied = false;
  private lead: Array<MotifNote | undefined> = [];
  private readonly form: boolean;
  /** This bar's section, and the tier as it plays it (worked out once per bar). */
  private at: SectionAt = sectionAt(0);
  private shaped: Tier;
  /** Each station's next song (the radio carries on where you left it). */
  private readonly nextSong = new Map<string, number>();

  constructor(station: Station = STATIONS[0], opts: ArrangerOptions = {}) {
    this.form = opts.form ?? true;
    this.station = station;
    this.song = station.songs[0];
    this.bpm = targetBpm(station, 0, 'game');
    this.shaped = station.tiers[0];
    this.startSong(station);
  }

  /** The section playing (`verse` throughout without the form). */
  get section(): Section {
    return this.form ? this.at.section : 'verse';
  }

  /** The bar playing is its section's last (an 8-bar phrase's without the form). */
  get lastBar(): boolean {
    return this.form ? this.at.bar === this.at.bars - 1 : this.bar % BARS_PER_PHRASE === BARS_PER_PHRASE - 1;
  }

  setIntensity(level: number): void {
    this.target = clamp(Math.round(level), 0, 5);
  }

  /** Switch station at the next bar line (the phrase restarts). */
  setStation(station: Station): void {
    this.pendingStation = station === this.station ? null : station;
  }

  /** The station playing, or the one about to. */
  get upcomingStation(): Station {
    return this.pendingStation ?? this.station;
  }

  setMode(mode: MusicMode): void {
    this.pendingMode = mode === this.mode ? null : mode;
  }

  /** Start over from the top of a phrase now, applying any pending changes. */
  restart(): void {
    this.bar = 0;
    this.songBar = 0;
    this.step = 0;
    this.voicing = null;
    this.bassTied = false;
    this.leadLeft = 0;
  }

  tier(): Tier {
    if (this.mode === 'menu') return this.station.menu;
    return this.form ? this.shaped : this.station.tiers[this.intensity];
  }

  /** Fill `out` with the events of the current step, then move on. Returns that step's index in its bar. */
  next(out: NoteEvent[]): number {
    out.length = 0;
    const step = this.step;
    if (step === 0) this.startBar();
    // Stepping up next bar: lead into it with a fill.
    if (step === 12 && this.mode === 'game' && this.target > this.intensity) this.fill = true;
    if (this.mode !== 'off') this.emit(this.tier(), step, out);
    this.step = (step + 1) % STEPS_PER_BAR;
    if (this.step === 0) {
      this.bar++;
      this.songBar++;
    }
    return step;
  }

  /** Begin `station`'s next song from its intro. */
  private startSong(station: Station): void {
    const songs = station.songs;
    const i = (this.nextSong.get(station.id) ?? 0) % songs.length;
    this.nextSong.set(station.id, i + 1);
    this.song = songs[i];
    this.songBar = 0;
    this.songNumber++;
    this.composeLead();
  }

  private startBar(): void {
    if (this.pendingStation) {
      this.station = this.pendingStation;
      this.pendingStation = null;
      this.bar = 0;
      this.voicing = null;
      this.bassTied = false;
      this.startSong(this.station);
    } else if (this.form && this.songBar >= FORM_BARS) {
      this.startSong(this.station);
    }
    if (this.pendingMode) {
      this.mode = this.pendingMode;
      this.pendingMode = null;
    }
    this.rose = this.target > this.intensity;
    this.intensity = this.target;
    this.fill = false;
    this.arpCount = 0;
    const want = targetBpm(this.station, this.intensity, this.mode);
    this.bpm += clamp(want - this.bpm, -BPM_GLIDE, BPM_GLIDE);

    const s = this.station;
    const song = this.song;
    this.at = sectionAt(this.form ? this.songBar : FORM[0][1]); // without the form: always the verse
    const base = s.tiers[this.intensity];
    this.shaped = this.form ? shapeTier(base, this.at.section, this.intensity) : base;
    const chords = this.at.section === 'chorus' && song.chorus ? song.chorus : song.verse;
    const chord = chords[(this.form ? this.at.bar : this.bar) % chords.length];
    const key = s.key + song.transpose;
    this.voicing = voiceChord(key, chord, this.voicing, s.padCenter);
    this.classes = chordClasses(key, chord);
    this.chordRoot = key + chord.root;
  }

  private emit(tier: Tier, step: number, out: NoteEvent[]): void {
    const s = this.station;
    const at = this.at;
    // The phrase the melody, crash and riser follow: the section's bars with the form, else 8-bar phrases.
    const phraseBar = this.form ? at.bar % BARS_PER_PHRASE : this.bar % BARS_PER_PHRASE;
    const lastBar = this.form ? at.bar === at.bars - 1 : phraseBar === BARS_PER_PHRASE - 1;
    const drum = (part: Part, vel: number, roll = 1) => {
      if (vel > 0) out.push(roll > 1 ? { part, note: 0, notes: null, vel, len: 1, roll } : { part, note: 0, notes: null, vel, len: 1 });
    };

    // --- Drums ---
    if (this.fill && step >= 12) {
      drum(s.sound.snare === 'rim' ? 'perc' : 'snare', [0.45, 0.6, 0.8, 1][step - 12]);
      if (step === 12) drum('kick', 1);
    } else {
      drum('kick', hitVelocity(tier.kick, step), rollCount(tier.kick, step));
      drum('snare', hitVelocity(tier.snare, step), rollCount(tier.snare, step));
      drum('clap', hitVelocity(tier.clap, step), rollCount(tier.clap, step));
      drum('perc', hitVelocity(tier.perc, step), rollCount(tier.perc, step));
    }
    drum('hat', hitVelocity(tier.hat, step), rollCount(tier.hat, step));
    drum('openHat', hitVelocity(tier.openHat, step), rollCount(tier.openHat, step));
    if (step === 0 && tier.crash && (phraseBar === 0 || this.rose)) drum('crash', 1);
    // Rise into the next section (calm intros and breaks rise into the drums coming back in too).
    const rise = tier.riser || (this.form && this.mode === 'game' && (at.section === 'intro' || at.section === 'break'));
    if (step === 0 && rise && lastBar && (!this.form || at.next !== 'intro')) {
      out.push({ part: 'riser', note: 0, notes: null, vel: 1, len: STEPS_PER_BAR });
    }

    // --- Harmony ---
    const voicing = this.voicing!;
    if (step === 0 && tier.pad) out.push({ part: 'pad', note: 0, notes: voicing, vel: 1, len: STEPS_PER_BAR });
    const keys = hitVelocity(tier.keys, step);
    if (keys > 0) out.push({ part: 'keys', note: 0, notes: voicing, vel: keys, len: s.sound.keysLen });

    // --- Bass ---
    const bass = tier.bass;
    if (bass) {
      const c = bass.charCodeAt(step);
      const note = this.bassNote(c);
      if (note > 0) {
        let len = 1;
        while (step + len < STEPS_PER_BAR && (bass.charCodeAt(step + len) === HOLD || bass.charCodeAt(step + len) === SLIDE)) len++;
        const tie = bass.charCodeAt(step + len - 1) === SLIDE;
        const vel = c === 120 /* x */ ? 1 : c === 103 /* g */ ? 0.35 : 0.85;
        out.push({ part: 'bass', note, notes: null, vel, len, slide: this.bassTied, tie });
        this.bassTied = tie;
      } else if (c !== HOLD && c !== SLIDE) {
        this.bassTied = false;
      }
    } else {
      this.bassTied = false;
    }

    // The lead note starting here, if any (an arp that yields rests under it).
    const m = tier.lead ? this.lead[phraseBar * STEPS_PER_BAR + step] : undefined;
    if (m) this.leadLeft = m.len;

    // --- Arpeggio: walks the chord an octave above the pad ---
    if (hitVelocity(tier.arp, step) > 0) {
      const order = s.sound.arpOrder;
      const i = order[this.arpCount++ % order.length];
      if (!(s.sound.arpYields && this.leadLeft > 0)) {
        const n = voicing.length;
        const note = voicing[i % n] + 12 * (1 + Math.floor(i / n));
        out.push({ part: 'arp', note, notes: null, vel: step % 4 === 0 ? 1 : 0.75, len: 1 });
      }
    }
    if (this.leadLeft > 0) this.leadLeft--;

    // --- Lead ---
    if (m) {
      const note = avoidClash(scaleNote(s.leadTonic + this.song.transpose, s.leadScale, m.degree), this.classes);
      out.push({ part: 'lead', note, notes: null, vel: 0.9, len: m.len });
    }
  }

  private bassNote(c: number): number {
    const root = fold(this.chordRoot, this.station.bassLow);
    switch (c) {
      case 120: // x
        return root;
      case 111: // o
        return root + 12;
      case 103: // g (ghost)
        return root;
      case 53: // 5
        return root + 7;
      case 52: // 4
        return root + 5;
      case 51: // 3
        return root + (this.classes.includes((this.chordRoot + 4) % 12) ? 4 : 3);
      case 55: // 7
        return root + 10;
      default:
        return 0;
    }
  }

  private composeLead(): void {
    this.lead = [];
    for (const m of composeLead(this.song.leadSeed, this.station.leadScale.length)) this.lead[m.step] = m;
  }
}
