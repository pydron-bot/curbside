/**
 * Plays the Arranger's notes on Web Audio. A 25 ms timer (owned by GameAudio)
 * calls pump(), which books every 16th due in the next ~0.12 s on the
 * AudioContext clock. Bass and lead are persistent mono synths (no nodes per
 * note, free portamento); drums, pads, keys and arps are short-lived voices
 * that are disconnected once they finish. Works on an OfflineAudioContext too.
 */
import { Dip } from '../mix';
import { NoiseBank, Voice, automateDip, perc, sweep } from '../synth';
import { Arranger, StepClock, swingOffset, type MusicMode, type NoteEvent } from './sequencer';
import { STATIONS, type Station, type StationSound } from './stations';
import { midiToHz } from './theory';

/** How far ahead the scheduler books notes, s. */
export const LOOKAHEAD = 0.12;

const PAD_LEVEL = 0.09;
const KEYS_LEVEL = 0.2;
const ARP_LEVEL = 0.1;
const BASS_LEVEL = 0.17;
const LEAD_LEVEL = 0.1;

export class MusicPlayer {
  readonly arranger: Arranger;
  readonly clock = new StepClock();
  stationIndex = 0;
  /** Steps booked so far (debug: proves the scheduler runs). */
  stepsScheduled = 0;
  private readonly events: NoteEvent[] = [];
  private readonly notes: Voice[] = [];
  /** Persistent nodes (channels, mono synths, effects). */
  private readonly rig: Voice;
  private sound: StationSound;
  private running = false;
  /** Faded out by setMode('off'), waiting to come back. */
  private off = false;
  private readonly duckDip = new Dip(1);

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
  private readonly side: GainNode;
  private readonly padLp: BiquadFilterNode;
  private readonly keysBus: GainNode;
  private readonly arpBus: BiquadFilterNode;
  private readonly lead: OscillatorNode;
  private readonly leadAmp: GainNode;
  private readonly echoSend: GainNode;
  private readonly echoDelay: DelayNode;
  private readonly verbSend: GainNode;
  private readonly crackleGain: GainNode;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly bank: NoiseBank,
    out: AudioNode,
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
    this.echoSend = r.gain(0.32);
    this.echoDelay = r.track(ctx.createDelay(2));
    const echoDamp = r.filter('lowpass', 2600, 0.5);
    const echoFb = r.gain(0.36);
    const echoOut = r.gain(0.55);
    r.chain(this.echoSend, this.echoDelay, echoDamp, echoFb, this.echoDelay);
    r.chain(echoDamp, echoOut, this.synth);
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

  /** Begin playing from the top of a phrase at `when`. */
  start(when: number): void {
    this.running = true;
    this.off = false;
    this.arranger.restart();
    this.clock.reset(when);
    this.fadeGain.gain.setTargetAtTime(1, when, 0.05);
  }

  /** Book every step that starts before `now + lookahead`, and clean up finished notes. */
  pump(now: number, lookahead = LOOKAHEAD): void {
    this.reap(now);
    if (!this.running) return;
    let guard = 0;
    while (this.clock.due(now, lookahead) && guard++ < 256) {
      const t = this.clock.nextTime;
      const step = this.arranger.next(this.events);
      if (this.arranger.station.sound !== this.sound) this.applySound(this.arranger.station.sound, t);
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
    if (mode === 'off') {
      this.off = true;
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
      this.arranger.setMode(mode);
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
    if (this.running && !this.off) {
      const g = this.fadeGain.gain;
      g.setTargetAtTime(0, now, 0.02);
      g.setTargetAtTime(1, now + 0.3, 0.04);
      this.tuneStatic(now);
      this.arranger.restart();
      this.clock.reset(now + 0.32);
    }
    return station;
  }

  /** Dip the music under something loud. `depth` is the gain at the bottom; overlapping ducks merge (deepest wins). */
  duck(depth: number, release: number): void {
    const now = this.ctx.currentTime;
    this.duckDip.add(now, depth, 0.12, Math.max(0.15, release));
    automateDip(this.duckGain.gain, this.duckDip, now, 0.015);
  }

  /** Paused: the music drops back and goes muffled, like it's in the next room. */
  setPaused(paused: boolean): void {
    const now = this.ctx.currentTime;
    this.pauseLp.frequency.setTargetAtTime(paused ? 650 : 20000, now, paused ? 0.08 : 0.15);
    this.trim.gain.setTargetAtTime(this.sound.trim * (paused ? 0.6 : 1), now, 0.1);
  }

  dispose(): void {
    this.running = false;
    for (const v of this.notes) v.dispose();
    this.notes.length = 0;
    this.rig.dispose();
  }

  // --- Internals ---

  private applySound(s: StationSound, t: number): void {
    this.sound = s;
    this.trim.gain.setTargetAtTime(s.trim, t, 0.05);
    this.bassA.type = s.bass === 'round' ? 'triangle' : 'sawtooth';
    this.bassB.type = s.bass === 'saw' ? 'square' : s.bass === 'reese' ? 'sawtooth' : 'sine';
    this.bassB.detune.setValueAtTime(s.bass === 'reese' ? 22 : 0, t);
    this.bassA.detune.setValueAtTime(s.bass === 'reese' ? -12 : 0, t);
    this.bassBGain.gain.setValueAtTime(s.bass === 'round' ? 0.7 : s.bass === 'reese' ? 0.9 : 0.5, t);
    this.lead.type = s.lead === 'flute' ? 'triangle' : s.lead === 'saw' ? 'sawtooth' : 'square';
    this.echoDelay.delayTime.setValueAtTime(Math.min(1.9, (60 / this.arranger.bpm) * s.echo), t);
    this.verbSend.gain.setValueAtTime(s.reverb, t);
    this.crackleGain.gain.setTargetAtTime(s.crackle ? 0.05 : 0, t, 0.2);
    this.padLp.frequency.setValueAtTime(s.pad === 'dark' ? 900 : s.pad === 'soft' ? 1400 : 2000, t);
  }

  private onBar(t: number): void {
    const tier = this.arranger.tier();
    this.synth.frequency.setTargetAtTime(tier.cutoff, t, 0.6);
    this.echoDelay.delayTime.setTargetAtTime(Math.min(1.9, (60 / this.arranger.bpm) * this.sound.echo), t, 0.05);
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
        return this.kick(t, e.vel);
      case 'snare':
        return this.snare(t, e.vel);
      case 'clap':
        return this.clap(t, e.vel);
      case 'hat':
        return this.hat(t, e.vel, false);
      case 'openHat':
        return this.hat(t, e.vel, true);
      case 'perc':
        return this.perc(t, e.vel);
      case 'crash':
        return this.crash(t);
      case 'riser':
        return this.riser(t, e.len * step);
      case 'bass':
        return this.bass(t, e.note, e.vel, e.len * step);
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

  private kick(t: number, vel: number): void {
    const s = this.sound;
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
    // Sidechain pump: pads and bass duck under every kick.
    this.side.gain.setValueAtTime(0.35, t);
    this.side.gain.setTargetAtTime(1, t + 0.02, 0.09);
  }

  private snare(t: number, vel: number): void {
    const s = this.sound;
    if (s.snare === 'rim') return this.rim(t, vel * 0.9);
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
    if (this.sound.snare === 'rim') return this.rim(t, vel * 0.7);
    // A tuned bongo-ish knock.
    const v = this.voice(t, this.drums, 0);
    const o = v.osc('sine', 330, t, t + 0.15);
    sweep(o.frequency, t, 360, 290, 0.05);
    o.connect(v.out);
    perc(v.out.gain, t, vel * 0.35, 0.001, 0.03);
  }

  private crash(t: number): void {
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

  private leadNote(t: number, note: number, dur: number): void {
    const flute = this.sound.lead === 'flute';
    this.lead.frequency.setTargetAtTime(midiToHz(note), t, flute ? 0.03 : 0.018);
    const g = this.leadAmp.gain;
    g.setTargetAtTime(LEAD_LEVEL * (flute ? 1.6 : 1), t, flute ? 0.03 : 0.01);
    g.setTargetAtTime(0, t + Math.max(0.05, dur * 0.85), 0.05);
  }

  private pad(t: number, notes: readonly number[], dur: number): void {
    const s = this.sound;
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

  private keys(t: number, notes: readonly number[], vel: number, dur: number): void {
    const s = this.sound;
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
    const pluck = this.sound.arp === 'pluck';
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
