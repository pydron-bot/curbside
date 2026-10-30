/**
 * The soundtrack's brain, free of Web Audio so it's unit-tested:
 *
 * - StepClock: look-ahead scheduling math. A ~25 ms timer asks "is the next
 *   16th due before now + lookahead?" and books it on the AudioContext clock,
 *   so timing stays sample-accurate however janky the main thread is.
 * - Arranger: what plays on each 16th. Intensity, station and mode changes
 *   wait for a bar line; stepping up gets a drum fill, tempo glides a few BPM
 *   per bar, pads are voice-led, and the lead melody repeats per phrase.
 */
import { clamp, lerp } from '../mix';
import { STATIONS, type Station, type Tier } from './stations';
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
}

export type MusicMode = 'game' | 'menu' | 'off';

/** Velocity of a drum-pattern character. */
export function hitVelocity(pattern: string | undefined, step: number): number {
  if (!pattern) return 0;
  const c = pattern.charCodeAt(step);
  return c === 120 /* x */ ? 1 : c === 111 /* o */ ? 0.5 : 0;
}

/** Tempo for an intensity on a station (menus sit a little under the chill tempo). */
export function targetBpm(station: Station, intensity: number, mode: MusicMode): number {
  if (mode === 'menu') return station.bpm[0] - 6;
  return Math.round(lerp(station.bpm[0], station.bpm[1], clamp(intensity, 0, 5) / 5) * 2) / 2;
}

export class Arranger {
  station: Station;
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
  private lead: Array<MotifNote | undefined> = [];

  constructor(station: Station = STATIONS[0]) {
    this.station = station;
    this.bpm = targetBpm(station, 0, 'game');
    this.composeLead();
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
    this.step = 0;
    this.voicing = null;
  }

  tier(): Tier {
    return this.mode === 'menu' ? this.station.menu : this.station.tiers[this.intensity];
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
    if (this.step === 0) this.bar++;
    return step;
  }

  private startBar(): void {
    if (this.pendingStation) {
      this.station = this.pendingStation;
      this.pendingStation = null;
      this.bar = 0;
      this.voicing = null;
      this.composeLead();
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
    const chord = s.progression[this.bar % s.progression.length];
    this.voicing = voiceChord(s.key, chord, this.voicing, s.padCenter);
    this.classes = chordClasses(s.key, chord);
    this.chordRoot = s.key + chord.root;
  }

  private emit(tier: Tier, step: number, out: NoteEvent[]): void {
    const s = this.station;
    const phraseBar = this.bar % BARS_PER_PHRASE;
    const drum = (part: Part, vel: number) => {
      if (vel > 0) out.push({ part, note: 0, notes: null, vel, len: 1 });
    };

    // --- Drums ---
    if (this.fill && step >= 12) {
      drum(s.sound.snare === 'rim' ? 'perc' : 'snare', [0.45, 0.6, 0.8, 1][step - 12]);
      if (step === 12) drum('kick', 1);
    } else {
      drum('kick', hitVelocity(tier.kick, step));
      drum('snare', hitVelocity(tier.snare, step));
      drum('clap', hitVelocity(tier.clap, step));
      drum('perc', hitVelocity(tier.perc, step));
    }
    drum('hat', hitVelocity(tier.hat, step));
    drum('openHat', hitVelocity(tier.openHat, step));
    if (step === 0 && tier.crash && (phraseBar === 0 || this.rose)) drum('crash', 1);
    if (step === 0 && tier.riser && phraseBar === BARS_PER_PHRASE - 1) {
      out.push({ part: 'riser', note: 0, notes: null, vel: 1, len: STEPS_PER_BAR });
    }

    // --- Harmony ---
    const voicing = this.voicing!;
    if (step === 0 && tier.pad) out.push({ part: 'pad', note: 0, notes: voicing, vel: 1, len: STEPS_PER_BAR });
    const keys = hitVelocity(tier.keys, step);
    if (keys > 0) out.push({ part: 'keys', note: 0, notes: voicing, vel: keys, len: s.sound.keysLen });

    // --- Bass ---
    if (tier.bass) {
      const note = this.bassNote(tier.bass.charCodeAt(step));
      if (note > 0) {
        let len = 1;
        while (step + len < STEPS_PER_BAR && tier.bass.charCodeAt(step + len) === 45 /* - */) len++;
        out.push({ part: 'bass', note, notes: null, vel: tier.bass[step] === 'x' ? 1 : 0.85, len });
      }
    }

    // --- Arpeggio: walks the chord an octave above the pad ---
    if (hitVelocity(tier.arp, step) > 0) {
      const order = s.sound.arpOrder;
      const i = order[this.arpCount++ % order.length];
      const n = voicing.length;
      const note = voicing[i % n] + 12 * (1 + Math.floor(i / n));
      out.push({ part: 'arp', note, notes: null, vel: step % 4 === 0 ? 1 : 0.75, len: 1 });
    }

    // --- Lead ---
    if (tier.lead) {
      const m = this.lead[phraseBar * STEPS_PER_BAR + step];
      if (m) {
        const note = avoidClash(scaleNote(s.leadTonic, s.leadScale, m.degree), this.classes);
        out.push({ part: 'lead', note, notes: null, vel: 0.9, len: m.len });
      }
    }
  }

  private bassNote(c: number): number {
    const root = fold(this.chordRoot, this.station.bassLow);
    switch (c) {
      case 120: // x
        return root;
      case 111: // o
        return root + 12;
      case 53: // 5
        return root + 7;
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
    for (const m of composeLead(this.station.leadSeed, this.station.leadScale.length)) this.lead[m.step] = m;
  }
}
