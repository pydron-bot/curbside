/**
 * Plays the Arranger's notes on Web Audio. A 25 ms timer (owned by GameAudio)
 * calls pump(), which books every 16th due in the next ~0.12 s on the
 * AudioContext clock. Bass and lead are persistent mono synths (no nodes per
 * note, free portamento and 808 slides), reshaped per station: oscillator
 * shapes (custom ones from waves.ts, built once), envelopes, and a drive
 * patched into the bass chain only for the stations that want it. Drums,
 * pads, keys, arps and the cowbell are short-lived voices that are
 * disconnected once they finish. Drums play from a kit rendered per station
 * sound (drumKit.ts); the live drum voices below stand in if a kit can't be
 * made. Works on an OfflineAudioContext too.
 */
import { Dip } from '../mix';
import { NoiseBank, Voice, automateDip, perc, sweep } from '../synth';
import { Arranger, StepClock, swingOffset, type MusicMode, type NoteEvent, type Theme } from './sequencer';
import { kitJobs, kitKey, type KitJob, type KitPart } from './drumKit';
import { STATIONS, type Song, type Station, type StationSound } from './stations';
import { midiToHz } from './theory';
import { pulseWave, reedWave, steppedTriangle } from './waves';

/** How far ahead the scheduler books notes, s. */
export const LOOKAHEAD = 0.12;

const PAD_LEVEL = 0.09;
const KEYS_LEVEL = 0.2;
const ARP_LEVEL = 0.1;
const BASS_LEVEL = 0.17;
const LEAD_LEVEL = 0.1;
const COWBELL_LEVEL = 0.22;
/** The rendered kit is denser than the live drums were: this brings it back to the same loudness. */
const KIT_TRIM = 0.5;
/** Paused, the music drops back to this fraction of the station's trim. */
const PAUSE_TRIM = 0.6;
/** Echo defaults (a station's sound can override them): send, feedback, the repeats' lowpass. */
const ECHO_SEND = 0.32;
const ECHO_FEEDBACK = 0.36;
const ECHO_TONE = 2600;
/** Hits after the first in a drum roll. */
const ROLL_VEL = 0.7;

interface BassShape {
  a: OscillatorType;
  b: OscillatorType;
  /** Second oscillator's level, and each oscillator's detune (cents). */
  bGain: number;
  aDetune: number;
  bDetune: number;
  /** Filter resonance. */
  q: number;
  /** Level against BASS_LEVEL. */
  level: number;
}

/** The mono bass, per timbre ('tri' swaps oscillator A for the stepped triangle). */
const BASS_SHAPES: Record<StationSound['bass'], BassShape> = {
  saw: { a: 'sawtooth', b: 'square', bGain: 0.5, aDetune: 0, bDetune: 0, q: 2, level: 1 },
  reese: { a: 'sawtooth', b: 'sawtooth', bGain: 0.9, aDetune: -12, bDetune: 22, q: 2, level: 1 },
  round: { a: 'triangle', b: 'sine', bGain: 0.7, aDetune: 0, bDetune: 0, q: 2, level: 1 },
  '808': { a: 'sine', b: 'triangle', bGain: 0.3, aDetune: 0, bDetune: 0, q: 0.7, level: 0.6 },
  slap: { a: 'sawtooth', b: 'square', bGain: 0.35, aDetune: 0, bDetune: 4, q: 2.5, level: 1.5 },
  sub: { a: 'sine', b: 'triangle', bGain: 0.45, aDetune: 0, bDetune: 0, q: 0.7, level: 0.72 },
  tri: { a: 'triangle', b: 'sine', bGain: 0, aDetune: 0, bDetune: 0, q: 0.5, level: 1.5 },
};

type WaveKind = 'pulse12' | 'pulse25' | 'pulse50' | 'tri' | 'reed';

type Kit = Record<KitPart, AudioBuffer[]>;

/** A kit being rendered, a take at a time. */
interface KitRender {
  kit: Kit;
  jobs: KitJob[];
  /** Its sound plays (or is about to): a take per macrotask, ahead of any warming. */
  urgent: boolean;
}

/** Between warming takes on the title without requestIdleCallback (Safari), ms. */
const WARM_GAP = 40;

export class MusicPlayer {
  readonly arranger: Arranger;
  readonly clock = new StepClock();
  stationIndex = 0;
  /** Steps booked so far (debug: proves the scheduler runs). */
  stepsScheduled = 0;
  /** A new song is about to start (called as its first bar is booked, ~0.1 s ahead). */
  onSong: ((song: Song, station: Station) => void) | null = null;
  private songSeen = 0;
  private readonly events: NoteEvent[] = [];
  private readonly notes: Voice[] = [];
  /** Persistent nodes (channels, mono synths, effects). */
  private readonly rig: Voice;
  private sound: StationSound;
  private running = false;
  /** Faded out by setMode('off'), waiting to come back. */
  private off = false;
  private paused = false;
  /** Volume at zero: nothing booked, rig unhooked from the output (see setDormant). */
  private dormant = false;
  private readonly duckDip = new Dip(1);
  /** The station sound's drum kit (null: the live voices play the drums). */
  private kit: Kit | null = null;
  private readonly kits = new Map<string, Kit>();
  /** Kits still rendering, in order. */
  private readonly renders: KitRender[] = [];
  /**
   * The crash take, by chip-ness: only the sample rate shapes it (its noise
   * aside), so it's rendered once per context and shared by every kit. It's
   * the longest job by far (2.2 s of audio, 14-24 ms).
   */
  private readonly crashes = new Map<boolean, AudioBuffer[]>();
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private idleWaiting = false;
  /** The title is up (the last mode asked for was 'menu'): kits may warm in idle time. */
  private onTitle = false;
  private disposed = false;
  /** Round robin over each hit's takes. */
  private take = 0;
  /** Custom oscillator shapes, built once per context. */
  private readonly waves = new Map<WaveKind, PeriodicWave>();
  /** The bass's last note (slides start from it). */
  private bassHz = 0;
  /** The drive is patched into the bass chain. */
  private driven = false;

  private readonly duckGain: GainNode;
  private readonly fadeGain: GainNode;
  private readonly pauseLp: BiquadFilterNode;
  private readonly trim: GainNode;
  private readonly mix: GainNode;
  private readonly drums: GainNode;
  private readonly hatBus: BiquadFilterNode;
  private readonly synth: BiquadFilterNode;
  private readonly bassLp: BiquadFilterNode;
  private readonly bassAmp: GainNode;
  private readonly bassA: OscillatorNode;
  private readonly bassB: OscillatorNode;
  private readonly bassBGain: GainNode;
  private readonly drivePre: GainNode;
  private readonly drivePost: GainNode;
  private readonly side: GainNode;
  private readonly padLp: BiquadFilterNode;
  private readonly keysBus: GainNode;
  private readonly arpBus: BiquadFilterNode;
  private readonly lead: OscillatorNode;
  private readonly leadAmp: GainNode;
  private readonly echoSend: GainNode;
  private readonly echoDelay: DelayNode;
  private readonly echoDamp: BiquadFilterNode;
  private readonly echoFb: GainNode;
  private readonly verbSend: GainNode;
  private readonly crackleGain: GainNode;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly bank: NoiseBank,
    private readonly out: AudioNode,
    impulse: AudioBuffer,
    station: Station = STATIONS[0],
  ) {
    this.arranger = new Arranger(station);
    this.stationIndex = Math.max(0, STATIONS.indexOf(station));
    this.sound = station.sound;
    const t = ctx.currentTime;
    const r = (this.rig = new Voice(ctx, bank, t, 1));

    // Output: mix → trim → pause muffle → fade (start/stop/death) → duck (explosions) → out
    this.duckGain = r.gain(1);
    this.fadeGain = r.gain(0);
    this.pauseLp = r.filter('lowpass', 20000, 0.5);
    this.trim = r.gain(station.sound.trim);
    this.mix = r.gain(1);
    r.chain(this.mix, this.trim, this.pauseLp, this.fadeGain, this.duckGain, out);

    this.drums = r.gain(0.9);
    this.drums.connect(this.mix);
    this.hatBus = r.filter('highpass', 7200, 0.6);
    this.hatBus.connect(this.drums);

    // Melodic parts share a lowpass that opens with intensity.
    this.synth = r.filter('lowpass', 1500, 0.4);
    this.synth.connect(this.mix);

    this.bassLp = r.filter('lowpass', 400, 2);
    this.bassAmp = r.gain(0);
    this.bassA = r.osc('sawtooth', 110, t);
    this.bassB = r.osc('square', 55, t);
    this.bassBGain = r.gain(0.5);
    this.bassA.connect(this.bassAmp);
    r.chain(this.bassB, this.bassBGain, this.bassAmp);
    r.chain(this.bassAmp, this.bassLp, this.synth);
    // Drive (808s), patched in between bassAmp and bassLp only while a station asks for it.
    // The curve is set once (it can't be replaced); the gains around it set how hard it's hit.
    this.drivePre = r.gain(1);
    this.drivePost = r.gain(1);
    r.chain(this.drivePre, r.shaper(4), this.drivePost);

    // Pads pump against the kick (side) under a darker filter of their own.
    this.side = r.gain(1);
    this.padLp = r.filter('lowpass', 1800, 0.5);
    r.chain(this.padLp, this.side, this.synth);
    this.keysBus = r.gain(1);
    this.keysBus.connect(this.synth);
    this.arpBus = r.filter('lowpass', 3200, 1.5);
    this.arpBus.connect(this.synth);

    this.lead = r.osc('sawtooth', 440, t);
    const vibrato = r.osc('sine', 5.2, t);
    const vibratoDepth = r.gain(12);
    r.chain(vibrato, vibratoDepth);
    vibratoDepth.connect(this.lead.detune);
    this.leadAmp = r.gain(0);
    r.chain(this.lead, this.leadAmp, this.synth);

    // Dotted-eighth echo on arps and lead, damped each repeat.
    this.echoSend = r.gain(ECHO_SEND);
    this.echoDelay = r.track(ctx.createDelay(2));
    this.echoDamp = r.filter('lowpass', ECHO_TONE, 0.5);
    this.echoFb = r.gain(ECHO_FEEDBACK);
    const echoOut = r.gain(0.55);
    r.chain(this.echoSend, this.echoDelay, this.echoDamp, this.echoFb, this.echoDelay);
    r.chain(this.echoDamp, echoOut, this.synth);
    this.arpBus.connect(this.echoSend);
    this.leadAmp.connect(this.echoSend);

    // A big 80s room for snares, pads and lead.
    this.verbSend = r.gain(1);
    const verb = r.track(ctx.createConvolver());
    verb.buffer = impulse;
    const verbOut = r.gain(0.5);
    r.chain(this.verbSend, verb, verbOut, this.mix);
    this.leadAmp.connect(this.verbSend);
    this.side.connect(this.verbSend);

    // Vinyl crackle bed (lo-fi station).
    const crackle = r.noise(bank.crackle, t, undefined, 1, true);
    const crackleBp = r.filter('bandpass', 2800, 0.6);
    this.crackleGain = r.gain(0);
    r.chain(crackle, crackleBp, this.crackleGain, this.mix);

    this.applySound(station.sound, t);
  }

  get station(): Station {
    return this.arranger.station;
  }

  get mode(): MusicMode {
    return this.off ? 'off' : this.arranger.mode;
  }

  /** The title theme to play while the mode is 'menu' (null: the station's menu tier). */
  setTheme(theme: Theme | null): void {
    this.arranger.theme = theme;
  }

  /** The title theme is what's playing (not the radio). */
  get playingTheme(): boolean {
    return this.arranger.playingTheme;
  }

  /** A score (the chase) is what's playing, its outro included. */
  get playingScore(): boolean {
    return this.arranger.playingScore;
  }

  /** Play `score` instead of the radio in 'game': it comes in on the next bar line, risen into, with a crash (no static: it's not a retune). */
  setScore(score: Theme): void {
    this.arranger.setScore(score);
  }

  /** The score's way out: its outro from the next bar line, then the radio's next song. Not playing (silent, asleep), it just goes. */
  endScore(): void {
    if (this.dormant || this.off || !this.running) this.arranger.setScore(null);
    else this.arranger.endScore();
  }

  /** Drop the score now: a quick fade and the radio from the top of a phrase (nothing to do if it isn't playing). */
  dropScore(): void {
    const playing = this.arranger.playingScore;
    this.arranger.setScore(null);
    if (playing && this.running && !this.off) this.restartAfterFade(this.ctx.currentTime);
  }

  /**
   * Retune without a sound (music heard on the street switches like this,
   * its owner fading it out first and back in after): the station changes at
   * the next bar line, at its own tempo, with its next song; `now`, nobody
   * can hear it, so it changes at once, from the top of a phrase, with
   * nothing of the old station left ringing. Returns the station.
   */
  tune(index: number, now = false): Station {
    this.stationIndex = ((index % STATIONS.length) + STATIONS.length) % STATIONS.length;
    const station = STATIONS[this.stationIndex];
    this.arranger.setStation(station);
    if (now && this.running && !this.off && !this.dormant && this.arranger.upcomingStation === station && this.arranger.station !== station) {
      const when = this.ctx.currentTime + 0.02;
      this.cutAt(when);
      this.arranger.restart();
      this.clock.reset(when);
    }
    return station;
  }

  /** Render a station sound's drum kit ahead of time (between frames), so it's in when that music first plays. */
  warmKit(sound: StationSound): void {
    this.kitFor(sound);
  }

  /**
   * Render these sounds' kits behind the title, a take per idle slot (the
   * radio's own first: PLAY starts it), so music first heard on foot, or the
   * chase, doesn't render one mid-play. Only on the title, and never while a
   * kit that's playing is still rendering; the game starting pauses it (a kit
   * wanted then renders at once, as before).
   */
  warmKits(sounds: readonly StationSound[]): void {
    this.kitFor(this.arranger.radio.sound, false);
    for (const s of sounds) this.kitFor(s, false);
  }

  /** Begin playing from the top of a phrase at `when`. */
  start(when: number): void {
    this.running = true;
    this.off = false;
    // A calm-down left over from before the silence is stale: the chase it ended is long gone.
    if (this.arranger.scoreEnding) this.arranger.setScore(null);
    this.arranger.restart();
    this.clock.reset(when);
    this.fadeGain.gain.setTargetAtTime(1, when, 0.05);
  }

  /** Book every step that starts before `now + lookahead`, and clean up finished notes. */
  pump(now: number, lookahead = LOOKAHEAD): void {
    this.reap(now);
    if (!this.running || this.dormant) return;
    let guard = 0;
    while (this.clock.due(now, lookahead) && guard++ < 256) {
      const t = this.clock.nextTime;
      const step = this.arranger.next(this.events);
      if (this.arranger.songNumber !== this.songSeen) {
        this.songSeen = this.arranger.songNumber;
        this.onSong?.(this.arranger.song, this.arranger.station);
      }
      if (this.arranger.station.sound !== this.sound) {
        // The new shapes and drive wiring take at once, up to LOOKAHEAD before t, and a bar-line switch to or
        // from the score has no fade over it: let the old station's mono notes go first.
        this.releaseMono(now);
        this.applySound(this.arranger.station.sound, t);
      }
      if (step === 0) this.onBar(t);
      this.clock.bpm = this.arranger.bpm;
      const dur = this.clock.stepDuration;
      const at = t + swingOffset(step, this.arranger.station.swing, dur);
      for (const e of this.events) this.play(e, at, dur);
      this.clock.advance();
      this.stepsScheduled++;
    }
  }

  /** Disconnect notes that have finished. */
  reap(now: number): void {
    let w = 0;
    for (let i = 0; i < this.notes.length; i++) {
      const v = this.notes[i];
      if (v.end + 0.05 <= now) v.dispose();
      else this.notes[w++] = v;
    }
    this.notes.length = w;
  }

  /** Live per-note voices (debug). */
  get activeNotes(): number {
    return this.notes.length;
  }

  setIntensity(level: number): void {
    this.arranger.setIntensity(level);
  }

  setMode(mode: MusicMode): void {
    const now = this.ctx.currentTime;
    this.onTitle = mode === 'menu';
    this.scheduleRender();
    if (mode === 'off') {
      this.off = true;
      // Drop anything queued first: a fade back up booked by an earlier restart must not undo the silence.
      this.fadeGain.gain.cancelScheduledValues(now);
      this.fadeGain.gain.setTargetAtTime(0, now, 0.15);
      this.arranger.setMode('off');
      return;
    }
    if (this.off || !this.running) {
      // Coming back from silence: start a fresh phrase right away.
      this.off = false;
      this.arranger.setMode(mode);
      this.arranger.mode = mode;
      this.start(now + 0.05);
    } else {
      const was = this.arranger.upcomingStation;
      this.arranger.setMode(mode);
      // To or from the title theme: a quick fade and a fresh start, not a cut on the bar line.
      if (this.running && this.arranger.upcomingStation !== was) this.restartAfterFade(now);
    }
  }

  /** Switch station now, with a burst of radio static over the cut. Returns the new station. */
  nextStation(): Station {
    return this.setStation((this.stationIndex + 1) % STATIONS.length);
  }

  setStation(index: number): Station {
    this.stationIndex = ((index % STATIONS.length) + STATIONS.length) % STATIONS.length;
    const station = STATIONS[this.stationIndex];
    const now = this.ctx.currentTime;
    this.arranger.setStation(station);
    // Under the title theme the radio is retuned silently, for when the game starts.
    if (this.running && !this.off && this.arranger.upcomingStation === station) {
      this.restartAfterFade(now);
      this.tuneStatic(now);
    }
    return station;
  }

  /** Fade out and start again from the top of a phrase (a new station, or the theme) ~0.3 s later. */
  private restartAfterFade(now: number): void {
    const g = this.fadeGain.gain;
    g.setTargetAtTime(0, now, 0.02);
    g.setTargetAtTime(1, now + 0.3, 0.04);
    // Kill the old phrase while the fade is down, or its pads and keys come back up with it.
    this.cutAt(now + 0.28);
    this.arranger.restart();
    this.clock.reset(now + 0.32);
  }

  /**
   * GO after a count-in: at `when` the radio drops in on the downbeat of a
   * chorus at `intensity` or more, out of any duck at once. Whatever the old
   * phrase had booked past `when` is cut, so nothing doubles or hangs over.
   */
  dropIn(when: number, intensity: number): void {
    // GO lets go of the count-in's duck even when nothing drops in (a frenzy counted in over the chase).
    this.unduck(when);
    if (!this.running || this.off || this.dormant || this.arranger.mode !== 'game' || this.arranger.playing) return;
    this.cutAt(when);
    this.arranger.dropIn(intensity);
    this.clock.reset(when);
  }

  /** Cut whatever the old phrase booked past `when`, so nothing doubles or hangs over what starts there. */
  private cutAt(when: number): void {
    for (const v of this.notes) {
      v.kill(when);
      // Booked to start after the cut, its own envelope (set at its start) would outrank kill's fade: silence it outright.
      if (v.t >= when) {
        v.out.gain.cancelScheduledValues(when);
        v.out.gain.setValueAtTime(0, when);
      }
    }
    // The mono synths: drop the old phrase's queued notes and let a held one go.
    this.bassA.frequency.cancelScheduledValues(when);
    this.bassB.frequency.cancelScheduledValues(when);
    this.lead.frequency.cancelScheduledValues(when);
    this.bassAmp.gain.cancelScheduledValues(when);
    this.bassAmp.gain.setTargetAtTime(0, when, 0.01);
    this.leadAmp.gain.cancelScheduledValues(when);
    this.leadAmp.gain.setTargetAtTime(0, when, 0.01);
  }

  /** Let the bass and lead go now (their queued notes dropped). */
  private releaseMono(now: number): void {
    this.bassAmp.gain.cancelScheduledValues(now);
    this.bassAmp.gain.setTargetAtTime(0, now, 0.008);
    this.leadAmp.gain.cancelScheduledValues(now);
    this.leadAmp.gain.setTargetAtTime(0, now, 0.008);
  }

  /** One take of a hit from the current station's kit (stings borrow the radio's drums); null until it's rendered. */
  kitTake(part: KitPart): AudioBuffer | null {
    const takes = this.kit?.[part];
    return takes && takes.length > 0 ? takes[this.take++ % takes.length] : null;
  }

  /** Dip the music under something loud. `depth` is the gain at the bottom, held `hold` s; overlapping ducks merge (deepest wins). */
  duck(depth: number, release: number, hold = 0.12): void {
    const now = this.ctx.currentTime;
    this.duckDip.add(now, depth, hold, Math.max(0.15, release));
    automateDip(this.duckGain.gain, this.duckDip, now, 0.015);
  }

  /** Let go of any duck at `when`, at once (GO after a count-in, whatever plays then). */
  unduck(when: number): void {
    this.duckDip.release(when, 0.04);
    automateDip(this.duckGain.gain, this.duckDip, this.ctx.currentTime, 0.015);
  }

  /** Paused: the music drops back and goes muffled, like it's in the next room. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    const now = this.ctx.currentTime;
    this.pauseLp.frequency.setTargetAtTime(paused ? 650 : 20000, now, paused ? 0.08 : 0.15);
    this.trim.gain.setTargetAtTime(this.sound.trim * (paused ? PAUSE_TRIM : 1), now, 0.1);
  }

  /**
   * Music volume at zero: stop booking notes and unhook the rig from the
   * output, so the destination no longer pulls (renders) its oscillators,
   * echo and reverb. Waking restarts from the top of a phrase.
   */
  setDormant(dormant: boolean): void {
    if (dormant === this.dormant) return;
    this.dormant = dormant;
    if (dormant) {
      this.duckGain.disconnect();
      // Notes already booked (a pad holds for seconds) end now and are reaped.
      const now = this.ctx.currentTime;
      for (const v of this.notes) v.kill(now);
      return;
    }
    this.duckGain.connect(this.out);
    if (this.running && !this.off) this.start(this.ctx.currentTime + 0.05);
  }

  get isDormant(): boolean {
    return this.dormant;
  }

  dispose(): void {
    this.running = false;
    this.disposed = true;
    if (this.renderTimer !== null) clearTimeout(this.renderTimer);
    this.renders.length = 0;
    for (const v of this.notes) v.dispose();
    this.notes.length = 0;
    this.rig.dispose();
  }

  // --- Internals ---

  private applySound(s: StationSound, t: number): void {
    this.sound = s;
    this.kit = this.kitFor(s);
    this.trim.gain.setTargetAtTime(s.trim * (this.paused ? PAUSE_TRIM : 1), t, 0.05);
    const bass = BASS_SHAPES[s.bass];
    if (s.bass === 'tri') this.bassA.setPeriodicWave(this.wave('tri'));
    else this.bassA.type = bass.a;
    this.bassB.type = bass.b;
    this.bassB.detune.setValueAtTime(bass.bDetune, t);
    this.bassA.detune.setValueAtTime(bass.aDetune, t);
    this.bassBGain.gain.setValueAtTime(bass.bGain, t);
    this.bassLp.Q.setValueAtTime(bass.q, t);
    this.patchDrive(s.drive ?? 0, BASS_LEVEL * bass.level * (1 + bass.bGain), t);
    if (s.lead === 'pulse' || s.lead === 'melodica') this.lead.setPeriodicWave(this.wave(s.lead === 'pulse' ? 'pulse25' : 'reed'));
    else this.lead.type = s.lead === 'flute' ? 'triangle' : s.lead === 'saw' || s.lead === 'brass' ? 'sawtooth' : 'square';
    this.arpBus.frequency.setValueAtTime(s.arp === 'pulse' ? 6500 : 3200, t);
    this.echoDelay.delayTime.setValueAtTime(Math.min(1.9, (60 / this.arranger.bpm) * s.echo), t);
    this.echoSend.gain.setValueAtTime(s.echoSend ?? ECHO_SEND, t);
    this.echoFb.gain.setValueAtTime(s.echoFeedback ?? ECHO_FEEDBACK, t);
    this.echoDamp.frequency.setValueAtTime(s.echoTone ?? ECHO_TONE, t);
    this.verbSend.gain.setValueAtTime(s.reverb, t);
    this.crackleGain.gain.setTargetAtTime(s.crackle ? 0.05 : 0, t, 0.2);
    this.padLp.frequency.setValueAtTime(s.pad === 'dark' ? 900 : s.pad === 'soft' ? 1400 : s.pad === 'chip' ? 3000 : 2000, t);
  }

  /**
   * Patch the drive into the bass chain (or take it out). The shaper saturates
   * fully at 4, so the bass's `peak` is scaled to hit it `drive` hard and comes
   * back out at the same peak. Rewiring happens as a new station's first bar
   * is booked, up to LOOKAHEAD before it: under the retune fade, or (to and
   * from the score) once pump has let the bass go.
   */
  private patchDrive(drive: number, peak: number, t: number): void {
    const on = drive > 0;
    if (on) {
      // Patched in now, it's scaled now too: what's left of the bass must not hit the shaper at full gain.
      const at = on !== this.driven ? this.ctx.currentTime : t;
      this.drivePre.gain.setValueAtTime(drive / (4 * peak), at);
      this.drivePost.gain.setValueAtTime(peak / Math.tanh(drive), at);
    }
    if (on === this.driven) return;
    this.driven = on;
    this.bassAmp.disconnect();
    if (on) {
      this.bassAmp.connect(this.drivePre);
      this.drivePost.connect(this.bassLp);
    } else {
      this.drivePost.disconnect();
      this.bassAmp.connect(this.bassLp);
    }
  }

  /** A custom oscillator shape, built the first time it's asked for. */
  private wave(kind: WaveKind): PeriodicWave {
    let w = this.waves.get(kind);
    if (!w) {
      const h = kind === 'tri' ? steppedTriangle() : kind === 'reed' ? reedWave() : pulseWave(kind === 'pulse12' ? 0.125 : kind === 'pulse25' ? 0.25 : 0.5);
      w = this.ctx.createPeriodicWave(h.real, h.imag);
      this.waves.set(kind, w);
    }
    return w;
  }

  /**
   * The kit for a sound. The first time, it's rendered a take at a time
   * (up to ~10 ms each on a laptop, the shared crash aside): between frames
   * when `urgent` (its sound plays now), else in idle time on the title;
   * parts not in yet play on the live voices.
   */
  private kitFor(s: StationSound, urgent = true): Kit {
    const key = kitKey(s);
    let kit = this.kits.get(key);
    if (kit === undefined) {
      kit = { kick: [], snare: [], clap: [], hat: [], openHat: [], perc: [], crash: [] };
      this.kits.set(key, kit);
      const chip = s.snare === 'chip';
      let jobs = kitJobs(s, this.ctx.sampleRate);
      const crash = this.crashes.get(chip);
      if (crash) {
        kit.crash = crash;
        jobs = jobs.filter((j) => j.part !== 'crash');
      } else {
        this.crashes.set(chip, kit.crash);
      }
      this.renders.push({ kit, jobs, urgent });
    }
    if (urgent) this.hurry(kit);
    this.scheduleRender();
    return kit;
  }

  /** A kit is wanted now: the rest of it renders ahead of any warming, its crash too if a warming kit has that still to do. */
  private hurry(kit: Kit): void {
    const r = this.renders.find((x) => x.kit === kit);
    if (!r) return;
    r.urgent = true;
    if (kit.crash.length > 0 || r.jobs.some((j) => j.part === 'crash')) return;
    for (const other of this.renders) {
      const i = other.kit.crash === kit.crash ? other.jobs.findIndex((j) => j.part === 'crash') : -1;
      if (i >= 0) {
        r.jobs.push(other.jobs.splice(i, 1)[0]);
        return;
      }
    }
  }

  /** Book the next take: a wanted kit's at once (between frames), a warming one in an idle slot. */
  private scheduleRender(): void {
    if (this.disposed || this.renders.length === 0) return;
    if (this.renders.some((r) => r.urgent)) {
      if (this.renderTimer === null) this.renderTimer = setTimeout(this.renderNow, 0);
    } else if (this.onTitle && !this.idleWaiting) {
      this.idleWaiting = true;
      if (typeof requestIdleCallback === 'function') requestIdleCallback(this.renderIdle, { timeout: 1000 });
      else setTimeout(this.renderIdle, WARM_GAP);
    }
  }

  private readonly renderNow = (): void => {
    this.renderTimer = null;
    const r = this.renders.find((x) => x.urgent);
    if (r) this.renderTake(r);
  };

  private readonly renderIdle = (): void => {
    this.idleWaiting = false;
    // A kit that's playing goes first (its timer is booked), and nothing warms once the game is on.
    if (this.disposed || !this.onTitle || this.renders.some((r) => r.urgent)) return;
    const r = this.renders[0];
    if (r) this.renderTake(r);
  };

  private renderTake(r: KitRender): void {
    const job = r.jobs.shift();
    if (job) {
      try {
        const data = job.run();
        const rate = this.ctx.sampleRate;
        const b = this.ctx.createBuffer(1, data.length, rate);
        b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
        r.kit[job.part].push(b);
      } catch {
        r.jobs.length = 0; // no kit for the rest: the live voices play it
      }
    }
    if (r.jobs.length === 0) this.renders.splice(this.renders.indexOf(r), 1);
    this.scheduleRender();
  }

  /** A kit hit into `dest` (and the room by `verb`, the echo by `echo`); false when there's no kit. */
  private hit(part: KitPart, t: number, vel: number, dest: AudioNode, verb = 0, echo = 0): boolean {
    const takes = this.kit?.[part];
    if (!takes || takes.length === 0) return false;
    const v = this.voice(t, dest, vel * KIT_TRIM);
    v.burst(takes[this.take++ % takes.length], t, undefined, 0).connect(v.out);
    if (verb > 0) {
      const send = v.gain(verb);
      v.chain(v.out, send, this.verbSend);
    }
    if (echo > 0) {
      const send = v.gain(echo);
      v.chain(v.out, send, this.echoSend);
    }
    return true;
  }

  private onBar(t: number): void {
    const tier = this.arranger.tier();
    const s = this.sound;
    this.synth.frequency.setTargetAtTime(tier.cutoff, t, 0.6);
    this.echoDelay.delayTime.setTargetAtTime(Math.min(1.9, (60 / this.arranger.bpm) * s.echo), t, 0.05);
    if (s.throws) {
      // A dub throw: a section's last bar goes into the echo and spills over the next downbeat.
      const send = s.echoSend ?? ECHO_SEND;
      const thrown = this.arranger.lastBar && this.arranger.mode === 'game';
      this.echoSend.gain.setTargetAtTime(thrown ? Math.min(1, send * 1.8) : send, t, 0.05);
    }
  }

  private voice(t: number, dest: AudioNode, level = 1): Voice {
    const v = new Voice(this.ctx, this.bank, t, level);
    v.out.connect(dest);
    this.notes.push(v);
    return v;
  }

  private play(e: NoteEvent, t: number, step: number): void {
    switch (e.part) {
      case 'kick':
      case 'snare':
      case 'clap':
      case 'hat':
      case 'openHat':
      case 'perc': {
        // A roll splits the step into evenly spaced, softer hits.
        const n = e.roll ?? 1;
        for (let k = 0; k < n; k++) this.drum(e.part, t + (k * step) / n, k === 0 ? e.vel : e.vel * ROLL_VEL);
        return;
      }
      case 'crash':
        return this.crash(t);
      case 'riser':
        return this.riser(t, e.len * step);
      case 'bass':
        if (this.sound.bass === 'saw' || this.sound.bass === 'reese' || this.sound.bass === 'round') return this.bass(t, e.note, e.vel, e.len * step);
        return this.glideBass(t, e, step);
      case 'lead':
        return this.leadNote(t, e.note, e.len * step);
      case 'pad':
        return this.pad(t, e.notes!, e.len * step);
      case 'keys':
        return this.keys(t, e.notes!, e.vel, e.len * step);
      case 'arp':
        return this.arp(t, e.note, e.vel);
    }
  }

  private drum(part: 'kick' | 'snare' | 'clap' | 'hat' | 'openHat' | 'perc', t: number, vel: number): void {
    switch (part) {
      case 'kick':
        return this.kick(t, vel);
      case 'snare':
        return this.snare(t, vel);
      case 'clap':
        return this.clap(t, vel);
      case 'hat':
        return this.hat(t, vel, false);
      case 'openHat':
        return this.hat(t, vel, true);
      case 'perc':
        return this.perc(t, vel);
    }
  }

  private kick(t: number, vel: number): void {
    const s = this.sound;
    if (this.hit('kick', t, vel, this.drums)) {
      this.sidechain(t);
      return;
    }
    const v = this.voice(t, this.drums, 0);
    const o = v.osc('sine', s.kickTune * 3, t, t + s.kickDecay + 0.1);
    sweep(o.frequency, t, s.kickTune * 3.2, s.kickTune, 0.07);
    o.frequency.setTargetAtTime(s.kickTune * 0.85, t + 0.07, s.kickDecay);
    o.connect(v.out);
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(vel * 0.7, t + 0.002);
    g.setTargetAtTime(0, t + 0.012, s.kickDecay * 0.3);
    const click = v.noise(this.bank.white, t, t + 0.02);
    const cg = v.gain();
    v.chain(click, cg, this.drums);
    perc(cg.gain, t, vel * 0.1, 0.0005, 0.003);
    this.sidechain(t);
  }

  /** Sidechain pump: pads and bass duck under every kick. */
  private sidechain(t: number): void {
    this.side.gain.setValueAtTime(0.35, t);
    this.side.gain.setTargetAtTime(1, t + 0.02, 0.09);
  }

  private snare(t: number, vel: number): void {
    const s = this.sound;
    const verb = s.snare === 'gated' ? 0.45 : s.snare === 'rim' ? 0.35 : s.snare === 'rimshot' ? 0.5 : s.snare === 'chip' ? 0.08 : 0.25;
    if (this.hit('snare', t, vel, this.drums, verb, s.throws ?? 0)) return;
    if (s.snare === 'rim' || s.snare === 'rimshot') return this.rim(t, vel * 0.9);
    const gated = s.snare === 'gated';
    const v = this.voice(t, this.drums, 1);
    const n = v.noise(this.bank.white, t, t + 0.4);
    const bp = v.filter('bandpass', gated ? 1700 : 2600, gated ? 0.6 : 0.8);
    const ng = v.gain();
    v.chain(n, bp, ng, v.out);
    const g = ng.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(vel * (gated ? 0.75 : 0.7), t + 0.002);
    if (gated) {
      // The 80s gated-reverb snare: full body, then slammed shut.
      g.setTargetAtTime(vel * 0.4, t + 0.01, 0.08);
      g.setTargetAtTime(0, t + 0.17, 0.012);
    } else {
      g.setTargetAtTime(0, t + 0.004, 0.045);
    }
    const body = v.osc('triangle', 200, t, t + 0.15);
    sweep(body.frequency, t, 210, 170, 0.06);
    const bg = v.gain();
    v.chain(body, bg, v.out);
    perc(bg.gain, t, vel * 0.45, 0.001, 0.035);
    const send = v.gain(gated ? 0.55 : 0.25);
    v.chain(v.out, send, this.verbSend);
  }

  private rim(t: number, vel: number): void {
    const v = this.voice(t, this.drums, 1);
    const o = v.osc('triangle', 820, t, t + 0.08);
    const og = v.gain();
    v.chain(o, og, v.out);
    perc(og.gain, t, vel * 0.3, 0.0005, 0.012);
    const n = v.noise(this.bank.white, t, t + 0.06);
    const bp = v.filter('bandpass', 3200, 1.2);
    const ng = v.gain();
    v.chain(n, bp, ng, v.out);
    perc(ng.gain, t, vel * 0.35, 0.0005, 0.01);
    const send = v.gain(0.35);
    v.chain(v.out, send, this.verbSend);
  }

  private clap(t: number, vel: number): void {
    if (this.hit('clap', t, vel, this.drums, 0.4)) return;
    const v = this.voice(t, this.drums, 1);
    const n = v.noise(this.bank.white, t, t + 0.3);
    const bp = v.filter('bandpass', 1150, 1.4);
    const g = v.gain();
    v.chain(n, bp, g, v.out);
    // Three hands a few ms apart, then the room.
    for (const dt of [0, 0.011, 0.022]) perc(g.gain, t + dt, vel * 0.55, 0.0008, dt === 0.022 ? 0.06 : 0.004);
    const send = v.gain(0.4);
    v.chain(v.out, send, this.verbSend);
  }

  private hat(t: number, vel: number, open: boolean): void {
    if (this.hit(open ? 'openHat' : 'hat', t, vel, this.drums)) return;
    const shaker = this.sound.hat === 'shaker';
    const v = this.voice(t, this.hatBus, 0);
    const n = v.noise(this.bank.white, t, t + (open ? 0.5 : 0.12));
    if (shaker) {
      const bp = v.filter('bandpass', 6500, 1.2);
      v.chain(n, bp, v.out);
      const g = v.out.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(vel * 0.22, t + 0.012);
      g.setTargetAtTime(0, t + 0.014, 0.02);
    } else {
      n.connect(v.out);
      perc(v.out.gain, t, vel * (open ? 0.2 : 0.26), 0.0005, open ? 0.09 : 0.012);
    }
  }

  private perc(t: number, vel: number): void {
    const rim = this.sound.snare === 'rim' || this.sound.snare === 'rimshot';
    if (this.hit('perc', t, vel, this.drums, rim ? 0.3 : 0.15, this.sound.throws ?? 0)) return;
    if (rim) return this.rim(t, vel * 0.7);
    // A tuned bongo-ish knock.
    const v = this.voice(t, this.drums, 0);
    const o = v.osc('sine', 330, t, t + 0.15);
    sweep(o.frequency, t, 360, 290, 0.05);
    o.connect(v.out);
    perc(v.out.gain, t, vel * 0.35, 0.001, 0.03);
  }

  private crash(t: number): void {
    if (this.hit('crash', t, 1, this.drums, 0.4)) return;
    const v = this.voice(t, this.drums, 0);
    const n = v.noise(this.bank.white, t, t + 2.4);
    const hp = v.filter('highpass', 4200, 0.5);
    v.chain(n, hp, v.out);
    perc(v.out.gain, t, 0.2, 0.002, 0.42);
    const send = v.gain(0.4);
    v.chain(v.out, send, this.verbSend);
  }

  private riser(t: number, dur: number): void {
    const v = this.voice(t, this.mix, 0);
    const n = v.noise(this.bank.pink, t, t + dur + 0.05);
    const bp = v.filter('bandpass', 300, 2.5);
    sweep(bp.frequency, t, 300, 5200, dur);
    v.chain(n, bp, v.out);
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(0.2, t + dur - 0.02);
    g.linearRampToValueAtTime(0, t + dur + 0.02);
  }

  private bass(t: number, note: number, vel: number, dur: number): void {
    const s = this.sound;
    const hz = midiToHz(note);
    this.bassA.frequency.setValueAtTime(hz, t);
    this.bassB.frequency.setValueAtTime(s.bass === 'reese' ? hz : hz / 2, t);
    const g = this.bassAmp.gain;
    const level = BASS_LEVEL * vel;
    g.setTargetAtTime(level, t, 0.004);
    g.setTargetAtTime(0, t + Math.max(0.03, dur * 0.88), s.bass === 'round' ? 0.06 : 0.025);
    // Filter "pluck": opens on the note and closes over it.
    const base = s.bass === 'reese' ? 260 : s.bass === 'round' ? 520 : 320;
    const f = this.bassLp.frequency;
    f.setValueAtTime(base + (s.bass === 'round' ? 300 : 1300) * vel, t);
    f.setTargetAtTime(base, t + 0.005, s.bass === 'reese' ? 0.25 : 0.08);
  }

  /**
   * The bass timbres with slides: '808', 'slap', 'sub' and 'tri'. A slide
   * glides from the last note without a new attack and drops the tied
   * note's fallback release; a tie holds on into the slide.
   */
  private glideBass(t: number, e: NoteEvent, step: number): void {
    const s = this.sound;
    const kind = s.bass;
    const hz = midiToHz(e.note);
    const dur = e.len * step;
    const slide = e.slide === true && this.bassHz > 0;
    const a = this.bassA.frequency;
    const b = this.bassB.frequency;
    if (slide) {
      const end = t + Math.min(s.glide ?? 0.08, dur * 0.8);
      a.setValueAtTime(this.bassHz, t);
      a.exponentialRampToValueAtTime(hz, end);
      b.setValueAtTime(this.bassHz, t);
      b.exponentialRampToValueAtTime(hz, end);
    } else if (kind === '808') {
      // The boom: a quick dive onto the note.
      a.setValueAtTime(hz * 1.5, t);
      a.exponentialRampToValueAtTime(hz, t + 0.04);
      b.setValueAtTime(hz * 1.5, t);
      b.exponentialRampToValueAtTime(hz, t + 0.04);
    } else {
      a.setValueAtTime(hz, t);
      b.setValueAtTime(hz, t);
    }
    this.bassHz = hz;

    const ghost = e.vel < 0.5;
    const level = BASS_LEVEL * BASS_SHAPES[kind].level * e.vel * (ghost ? 1.6 : 1);
    const g = this.bassAmp.gain;
    if (slide) g.cancelScheduledValues(t);
    g.setTargetAtTime(level, t, slide ? 0.03 : kind === 'sub' ? 0.012 : 0.003);
    // 808s and slaps decay under their sustain; subs and the triangle hold.
    if (kind === '808') g.setTargetAtTime(level * 0.6, t + 0.05, 0.6);
    else if (kind === 'slap') g.setTargetAtTime(level * 0.6, t + 0.02, 0.2);
    const hold = kind === 'slap' ? (ghost ? 0.035 : dur * 0.85) : dur * (kind === '808' ? 0.95 : 0.9);
    const release = kind === 'tri' ? 0.004 : kind === 'slap' ? 0.02 : kind === 'sub' ? 0.07 : 0.05;
    // Tied: a fallback release a step late, which the slide that follows cancels.
    g.setTargetAtTime(0, e.tie ? t + dur + step : t + Math.max(0.03, hold), release);

    const f = this.bassLp.frequency;
    if (kind === 'slap') {
      if (slide) return;
      // Thumb on the low notes, popped octaves brighter; the click is the string hitting the frets.
      const pop = e.note >= this.station.bassLow + 12;
      f.setValueAtTime(Math.min(7500, hz * 3 + (ghost ? 300 : 3000 * e.vel + (pop ? 1500 : 0))), t);
      f.setTargetAtTime(hz * 3 + 250, t + 0.003, ghost ? 0.015 : 0.07);
      this.slapClick(t, ghost ? 0.12 : pop ? 0.14 : 0.09 * e.vel, ghost);
    } else {
      f.setValueAtTime(kind === '808' ? 1500 : kind === 'sub' ? 420 : 9000, t);
    }
  }

  private slapClick(t: number, level: number, ghost: boolean): void {
    const v = this.voice(t, this.synth, 0);
    const n = v.noise(this.bank.white, t, t + 0.03);
    const bp = v.filter('bandpass', ghost ? 1800 : 3000, 0.9);
    v.chain(n, bp, v.out);
    perc(v.out.gain, t, level, 0.0005, ghost ? 0.008 : 0.005);
  }

  /**
   * The 808 cowbell, pitched: two detuned squares 1.48× apart through a
   * bandpass, a clank then a short ring (phonk's hook).
   */
  private cowbell(t: number, note: number, level: number, verb: number): void {
    const hz = midiToHz(note);
    const v = this.voice(t, this.arpBus, 0);
    const bp = v.filter('bandpass', hz * 2.2, 1.4);
    const lo = v.osc('square', hz, t, t + 0.6);
    lo.detune.value = -6;
    const hi = v.osc('square', hz * 1.48, t, t + 0.6);
    hi.detune.value = 6;
    lo.connect(bp);
    hi.connect(bp);
    bp.connect(v.out);
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(level, t + 0.001);
    g.setTargetAtTime(level * 0.35, t + 0.001, 0.012);
    g.setTargetAtTime(0, t + 0.03, 0.1);
    if (verb > 0) {
      const send = v.gain(verb);
      v.chain(v.out, send, this.verbSend);
    }
  }

  private leadNote(t: number, note: number, dur: number): void {
    const kind = this.sound.lead;
    if (kind === 'cowbell') return this.cowbell(t, note, COWBELL_LEVEL * 1.15, 0.35);
    if (kind === 'pulse' || kind === 'brass' || kind === 'melodica') {
      const f = this.lead.frequency;
      const g = this.leadAmp.gain;
      const hz = midiToHz(note);
      const gain = this.sound.leadGain ?? 1;
      if (kind === 'pulse') {
        // Chip: straight onto the note, gated.
        f.setValueAtTime(hz, t);
        g.setTargetAtTime(LEAD_LEVEL * 1.3 * gain, t, 0.003);
        g.setTargetAtTime(0, t + Math.max(0.05, dur * 0.85), 0.012);
      } else if (kind === 'brass') {
        // A horn scoops up into the note and swells.
        f.setValueAtTime(hz * 0.93, t);
        f.setTargetAtTime(hz, t + 0.004, 0.03);
        g.setTargetAtTime(LEAD_LEVEL * 1.15 * gain, t, 0.025);
        g.setTargetAtTime(0, t + Math.max(0.05, dur * 0.85), 0.06);
      } else {
        // Melodica: breathy onset, slurred between notes.
        f.setTargetAtTime(hz, t, 0.025);
        g.setTargetAtTime(LEAD_LEVEL * 1.8 * gain, t, 0.035);
        g.setTargetAtTime(0, t + Math.max(0.05, dur * 0.85), 0.08);
      }
      return;
    }
    const flute = kind === 'flute';
    this.lead.frequency.setTargetAtTime(midiToHz(note), t, flute ? 0.03 : 0.018);
    const g = this.leadAmp.gain;
    g.setTargetAtTime(LEAD_LEVEL * (flute ? 1.6 : 1) * (this.sound.leadGain ?? 1), t, flute ? 0.03 : 0.01);
    g.setTargetAtTime(0, t + Math.max(0.05, dur * 0.85), 0.05);
  }

  private pad(t: number, notes: readonly number[], dur: number): void {
    const s = this.sound;
    if (s.pad === 'chip') return this.chipPad(t, notes, dur);
    const soft = s.pad === 'soft';
    const v = this.voice(t, this.padLp, 0);
    const attack = soft ? 0.6 : 0.3;
    const release = 0.6;
    const stop = t + dur + release * 4;
    for (const n of notes) {
      const hz = midiToHz(n);
      const a = v.osc(soft ? 'triangle' : 'sawtooth', hz, t, stop);
      a.detune.value = -7;
      const b = v.osc(soft ? 'sine' : s.pad === 'dark' ? 'square' : 'sawtooth', hz, t, stop);
      b.detune.value = 7;
      a.connect(v.out);
      b.connect(v.out);
    }
    const level = (PAD_LEVEL * (soft ? 1.6 : 1)) / Math.sqrt(notes.length);
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(level, t + attack);
    g.setValueAtTime(level, t + dur);
    g.setTargetAtTime(0, t + dur, release);
  }

  /** One 25% pulse per chord note, an 8-bit envelope (a quick drop to a held level). */
  private chipPad(t: number, notes: readonly number[], dur: number): void {
    const v = this.voice(t, this.padLp, 0);
    const stop = t + dur + 0.3;
    for (const n of notes) {
      const o = v.osc('square', midiToHz(n), t, stop);
      o.setPeriodicWave(this.wave('pulse25'));
      o.connect(v.out);
    }
    const level = (PAD_LEVEL * 1.2) / Math.sqrt(notes.length);
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(level, t + 0.01);
    g.setTargetAtTime(level * 0.55, t + 0.02, 0.2);
    g.setTargetAtTime(0, t + dur, 0.06);
  }

  private keys(t: number, notes: readonly number[], vel: number, dur: number): void {
    const s = this.sound;
    if (s.keys === 'skank') {
      // Reggae skank: a short, bright chop high up; the echo picks it up.
      const v = this.voice(t, this.keysBus, 0);
      const bp = v.filter('bandpass', 1900, 0.8);
      for (const n of notes) v.osc('square', midiToHz(n + 12), t, t + dur + 0.15).connect(bp);
      bp.connect(v.out);
      perc(v.out.gain, t, (KEYS_LEVEL * vel * 1.5) / Math.sqrt(notes.length), 0.002, Math.max(0.06, dur * 0.35));
      if (s.throws) {
        const send = v.gain(s.throws);
        v.chain(v.out, send, this.echoSend);
      }
      return;
    }
    if (s.keys === 'wah') {
      // Funk guitar chop through an auto-wah: the filter opens with the pick and falls back.
      const v = this.voice(t, this.keysBus, 0);
      const wah = v.filter('bandpass', 450, 3);
      const f = wah.frequency;
      f.setValueAtTime(450, t);
      f.exponentialRampToValueAtTime(700 + 1900 * vel, t + 0.04);
      f.setTargetAtTime(550, t + 0.04, 0.08);
      for (const n of notes) v.osc('sawtooth', midiToHz(n), t, t + dur + 0.25).connect(wah);
      wah.connect(v.out);
      perc(v.out.gain, t, (KEYS_LEVEL * vel * 4) / Math.sqrt(notes.length), 0.003, Math.max(0.03, dur * 0.4));
      return;
    }
    if (s.keys === 'epiano') {
      // Electric piano: a sine body and a quick bell an octave up, with a slow fade.
      const v = this.voice(t, this.keysBus, 0);
      const stop = t + dur + 1.2;
      for (const n of notes) {
        const hz = midiToHz(n);
        v.osc('sine', hz, t, stop).connect(v.out);
        const bell = v.osc('sine', hz * 2, t, t + 0.5);
        const bg = v.gain();
        v.chain(bell, bg, v.out);
        perc(bg.gain, t, 0.5, 0.002, 0.06);
      }
      const level = (KEYS_LEVEL * vel) / Math.sqrt(notes.length);
      const g = v.out.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(level, t + 0.006);
      g.setTargetAtTime(level * 0.45, t + 0.01, 0.35);
      g.setTargetAtTime(0, t + dur, 0.18);
      return;
    }
    // Synth stab: a saw chord through a snapping filter.
    const v = this.voice(t, this.keysBus, 0);
    const lp = v.filter('lowpass', 3000, 3);
    sweep(lp.frequency, t, 3200, 600, 0.12);
    for (const n of notes) {
      const o = v.osc('sawtooth', midiToHz(n + 12), t, t + dur + 0.3);
      o.connect(lp);
    }
    lp.connect(v.out);
    perc(v.out.gain, t, (KEYS_LEVEL * vel * 1.2) / Math.sqrt(notes.length), 0.003, Math.max(0.03, dur * 0.3));
    v.chain(v.out, this.echoSend);
  }

  private arp(t: number, note: number, vel: number): void {
    const kind = this.sound.arp;
    if (kind === 'cowbell') return this.cowbell(t, note, COWBELL_LEVEL * vel, 0);
    if (kind === 'pulse') {
      // Downbeats a fat square, the rest a thin buzz: the chip's duty-cycle colour.
      const v = this.voice(t, this.arpBus, 0);
      const o = v.osc('square', midiToHz(note), t, t + 0.3);
      o.setPeriodicWave(this.wave(vel >= 1 ? 'pulse50' : 'pulse12'));
      o.connect(v.out);
      perc(v.out.gain, t, ARP_LEVEL * vel * (vel >= 1 ? 1.1 : 1.5), 0.001, 0.07);
      return;
    }
    const pluck = kind === 'pluck';
    const v = this.voice(t, this.arpBus, 0);
    const hz = midiToHz(note);
    const o = v.osc(pluck ? 'triangle' : 'square', hz, t, t + 0.4);
    o.connect(v.out);
    if (pluck) {
      const o2 = v.osc('sine', hz * 2, t, t + 0.2);
      const g2 = v.gain();
      v.chain(o2, g2, v.out);
      perc(g2.gain, t, 0.6, 0.001, 0.03);
    }
    perc(v.out.gain, t, ARP_LEVEL * vel * (pluck ? 1.5 : 1), 0.002, pluck ? 0.09 : 0.06);
  }

  /** Radio static between stations. */
  private tuneStatic(now: number): void {
    const v = new Voice(this.ctx, this.bank, now, 0);
    v.out.connect(this.duckGain);
    this.notes.push(v);
    const n = v.noise(this.bank.white, now, now + 0.4);
    const bp = v.filter('bandpass', 900, 3);
    sweep(bp.frequency, now, 600, 3400, 0.3);
    v.chain(n, bp, v.out);
    const whistle = v.osc('sine', 1800, now, now + 0.35);
    sweep(whistle.frequency, now, 2400, 900, 0.3);
    const wg = v.gain(0.05);
    v.chain(whistle, wg, v.out);
    const g = v.out.gain;
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(0.16, now + 0.03);
    g.setValueAtTime(0.16, now + 0.24);
    g.linearRampToValueAtTime(0, now + 0.34);
  }
}
