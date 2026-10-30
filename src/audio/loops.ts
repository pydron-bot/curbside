/**
 * Continuous voices that live for as long as their source does: the player's
 * engine (with road and wind noise), tyre squeal, burning-car fire, the city
 * ambience and police sirens. Each owns a fixed set of nodes created once and
 * steered by smoothed parameter changes; release() fades it out and stops its
 * sources, and the owner disposes it after that.
 */
import { createEngine, roadAmount, squealAmount, windAmount, type CarSound, type EngineModel } from './carSound';
import { clamp, clamp01, dopplerCents } from './mix';
import { NoiseBank, Voice } from './synth';
import type { VehicleArchetype } from '../entities/vehicle';

/** Time constant for parameter smoothing, s: fast enough to track, slow enough not to zipper. */
const SMOOTH = 0.03;
/** The engine sits under the music and effects: present, never droning over them. */
const ENGINE_LEVEL = 0.36;

/** Set a parameter smoothly toward `v`. */
function to(p: AudioParam, v: number, now: number, tau = SMOOTH): void {
  p.setTargetAtTime(v, now, tau);
}

/**
 * The player's engine: two detuned oscillators and a band of hiss, soft-clipped
 * and lowpassed (brighter under load), with an amplitude "lope" at a fraction
 * of the firing rate for V8 burble or diesel chug. Road roar and wind ride on
 * top. Pitch comes from the gear model in carSound.ts.
 */
export class EngineVoice {
  readonly v: Voice;
  readonly model: EngineModel;
  private readonly a: OscillatorNode;
  private readonly b: OscillatorNode;
  private readonly lfo: OscillatorNode;
  private readonly lopeDepth: GainNode;
  private readonly am: GainNode;
  private readonly hissBp: BiquadFilterNode;
  private readonly hiss: GainNode;
  private readonly lp: BiquadFilterNode;
  private readonly body: GainNode;
  private readonly roadLp: BiquadFilterNode;
  private readonly road: GainNode;
  private readonly wind: GainNode;

  constructor(
    ctx: BaseAudioContext,
    bank: NoiseBank,
    dest: AudioNode,
    readonly archetype: VehicleArchetype,
    now: number,
  ) {
    this.model = createEngine(archetype);
    const p = this.model.profile;
    const v = (this.v = new Voice(ctx, bank, now, 0));
    v.out.connect(dest);
    v.out.gain.setTargetAtTime(1, now, 0.05);

    this.a = v.osc(p.waveA, 40, now);
    this.b = v.osc(p.waveB, 40 * p.ratioB, now);
    this.b.detune.value = p.detuneB;
    const ga = v.gain(1);
    const gb = v.gain(p.mixB);
    const shaper = v.shaper(p.drive);
    this.lp = v.filter('lowpass', p.cutoff, 1.1);
    this.am = v.gain(1);
    this.body = v.gain(0);
    v.chain(this.a, ga, shaper);
    v.chain(this.b, gb, shaper);
    // Lope before the lowpass, so a square-wave chug thumps instead of clicking.
    v.chain(shaper, this.am, this.lp, this.body, v.out);

    const pink = v.noise(bank.pink, now, undefined, 1, true);
    this.hissBp = v.filter('bandpass', 1200, 1.5);
    this.hiss = v.gain(0);
    v.chain(pink, this.hissBp, this.hiss, shaper);

    // A deep lope chugs (square); a light one burbles (sine).
    this.lfo = v.osc(p.lope >= 0.3 ? 'square' : 'sine', 10, now);
    this.lopeDepth = v.gain(0);
    v.chain(this.lfo, this.lopeDepth);
    this.lopeDepth.connect(this.am.gain);

    const brown = v.noise(bank.brown, now, undefined, 1, true);
    this.roadLp = v.filter('lowpass', 150, 0.7);
    this.road = v.gain(0);
    v.chain(brown, this.roadLp, this.road, v.out);
    const windHp = v.filter('highpass', 1800, 0.5);
    this.wind = v.gain(0);
    v.chain(pink, windHp, this.wind, v.out);
  }

  /** Turn the key: starter motor, then the engine catches. */
  ignite(): void {
    this.model.start();
  }

  /**
   * Step the gear model (every frame) and steer the synth (when `push`, or on a
   * gear change so the throttle cut lands on time). Returns 'pop' when an
   * overrun or a hard upshift should crack the exhaust.
   */
  apply(c: CarSound, dt: number, now: number, push = true): 'pop' | null {
    const m = this.model;
    const p = m.profile;
    m.step(dt, c.forwardSpeed, c.throttle, c.slip);
    const popChance = m.overrun ? p.backfire : m.shifted === 1 && m.rpmNorm > 0.55 ? p.backfire * 0.5 : 0;
    const pop = popChance > 0 && Math.random() < popChance ? 'pop' : null;
    if (!push && m.shifted === 0) return pop;

    if (m.cranking) {
      // Starter motor: a whine stuttering with each compression.
      to(this.a.frequency, 150, now);
      to(this.b.frequency, 150 * p.ratioB, now);
      to(this.lfo.frequency, 7, now);
      to(this.lopeDepth.gain, 0.45, now);
      to(this.am.gain, 0.55, now);
      to(this.lp.frequency, 900, now);
      to(this.hiss.gain, 0, now);
      to(this.body.gain, ENGINE_LEVEL * p.gain * 0.35, now);
    } else {
      const hz = m.hz;
      const load = m.load;
      const rpm = m.rpmNorm;
      const lope = p.lope * (1 - 0.5 * rpm);
      to(this.a.frequency, hz, now);
      to(this.b.frequency, hz * p.ratioB, now);
      to(this.lfo.frequency, hz * p.lopeRate, now);
      to(this.lopeDepth.gain, lope, now);
      to(this.am.gain, 1 - lope, now);
      to(this.lp.frequency, p.cutoff + load * p.loadOpen + rpm * p.rpmOpen, now);
      to(this.hissBp.frequency, clamp(hz * 8, 600, 5000), now);
      to(this.hiss.gain, p.noise * (0.3 + 0.7 * load), now);
      to(this.body.gain, ENGINE_LEVEL * p.gain * (0.3 + 0.7 * load) * (0.65 + 0.35 * rpm), now, m.shifting ? 0.012 : SMOOTH);
    }
    to(this.roadLp.frequency, 120 + c.speed * 14, now, 0.08);
    to(this.road.gain, 0.12 * roadAmount(c.speed), now, 0.08);
    to(this.wind.gain, 0.06 * windAmount(c.speed), now, 0.15);
    return pop;
  }

  release(now: number): number {
    return this.v.release(now, 0.5);
  }
}

/**
 * Tyre squeal: a wobbling tone and a band of noise, gated by slip, the
 * handbrake and hard braking; a low scrub rumbles under it.
 */
export class TyreVoice {
  readonly v: Voice;
  private readonly tone: OscillatorNode;
  private readonly bp: BiquadFilterNode;
  private readonly squeal: GainNode;
  private readonly scrub: GainNode;

  constructor(ctx: BaseAudioContext, bank: NoiseBank, dest: AudioNode, now: number) {
    const v = (this.v = new Voice(ctx, bank, now, 1));
    v.out.connect(dest);
    const white = v.noise(bank.white, now, undefined, 1, true);
    this.bp = v.filter('bandpass', 2000, 6);
    const noiseGain = v.gain(0.9);
    this.squeal = v.gain(0);
    v.chain(white, this.bp, noiseGain, this.squeal, v.out);
    this.tone = v.osc('triangle', 950, now);
    const wobble = v.osc('sine', 7.5, now);
    const wobbleDepth = v.gain(35);
    v.chain(wobble, wobbleDepth);
    wobbleDepth.connect(this.tone.frequency);
    const toneGain = v.gain(0.22);
    v.chain(this.tone, toneGain, this.squeal);
    const brown = v.noise(bank.brown, now, undefined, 1, true);
    const lp = v.filter('lowpass', 300, 0.7);
    this.scrub = v.gain(0);
    v.chain(brown, lp, this.scrub, v.out);
  }

  apply(c: CarSound | null, now: number): void {
    const amount = c ? squealAmount(c) : 0;
    const slip = c ? c.slip : 0;
    to(this.squeal.gain, amount * 0.3, now, 0.04);
    to(this.scrub.gain, amount * 0.25, now, 0.04);
    to(this.tone.frequency, clamp(880 + slip * 25, 880, 1400), now, 0.06);
    to(this.bp.frequency, 1900 + (c ? c.speed : 0) * 15, now, 0.06);
  }

  release(now: number): number {
    return this.v.release(now, 0.2);
  }
}

/** Burning cars near the listener, mixed into one crackling roar with an overall pan. */
export class FireVoice {
  readonly v: Voice;
  private readonly level: GainNode;
  private readonly pan: StereoPannerNode | null;
  /** Seconds it has been silent (the owner frees it after a while). */
  idle = 0;

  constructor(ctx: BaseAudioContext, bank: NoiseBank, dest: AudioNode, now: number) {
    const v = (this.v = new Voice(ctx, bank, now, 1));
    this.pan = typeof ctx.createStereoPanner === 'function' ? v.track(ctx.createStereoPanner()) : null;
    if (this.pan) v.chain(v.out, this.pan, dest);
    else v.out.connect(dest);
    this.level = v.gain(0);
    this.level.connect(v.out);
    const crackle = v.noise(bank.crackle, now, undefined, 1, true);
    const cbp = v.filter('bandpass', 2400, 0.7);
    const cg = v.gain(0.9);
    v.chain(crackle, cbp, cg, this.level);
    const crackle2 = v.noise(bank.crackle, now, undefined, 0.6, true);
    const c2 = v.filter('lowpass', 900, 0.7);
    const c2g = v.gain(0.7);
    v.chain(crackle2, c2, c2g, this.level);
    const roar = v.noise(bank.brown, now, undefined, 1, true);
    const rlp = v.filter('lowpass', 380, 0.6);
    const rg = v.gain(0.55);
    v.chain(roar, rlp, rg, this.level);
  }

  apply(amount: number, pan: number, now: number, dt: number): void {
    to(this.level.gain, clamp(amount, 0, 1.2) * 0.5, now, 0.12);
    if (this.pan) to(this.pan.pan, pan, now, 0.12);
    this.idle = amount > 0.005 ? 0 : this.idle + dt;
  }

  release(now: number): number {
    return this.v.release(now, 0.3);
  }
}

/**
 * The city at night: a soft filtered wash that drifts, a low rumble, brighter
 * and fuller on foot, duller from inside a car.
 */
export class AmbientBed {
  readonly v: Voice;
  private readonly washLp: BiquadFilterNode;
  private readonly wash: GainNode;
  private readonly rumble: GainNode;
  private readonly drift: GainNode;

  constructor(ctx: BaseAudioContext, bank: NoiseBank, dest: AudioNode, now: number) {
    const v = (this.v = new Voice(ctx, bank, now, 0));
    v.out.connect(dest);
    v.out.gain.setTargetAtTime(1, now, 1.5);
    const pink = v.noise(bank.pink, now, undefined, 1, true);
    this.washLp = v.filter('lowpass', 800, 0.5);
    this.wash = v.gain(0.035);
    v.chain(pink, this.washLp, this.wash, v.out);
    const lfo = v.osc('sine', 0.07, now);
    this.drift = v.gain(160);
    v.chain(lfo, this.drift);
    this.drift.connect(this.washLp.frequency);
    const brown = v.noise(bank.brown, now, undefined, 1, true);
    const lp = v.filter('lowpass', 140, 0.6);
    this.rumble = v.gain(0.06);
    v.chain(brown, lp, this.rumble, v.out);
  }

  setInCar(inCar: boolean, now: number): void {
    to(this.washLp.frequency, inCar ? 420 : 850, now, 0.6);
    to(this.drift.gain, inCar ? 80 : 160, now, 0.6);
    to(this.wash.gain, inCar ? 0.018 : 0.035, now, 0.6);
    to(this.rumble.gain, inCar ? 0.035 : 0.06, now, 0.6);
  }
}

export type SirenStyle = 'twoTone' | 'wail' | 'yelp';

const SIREN_STYLES: Record<SirenStyle, { lfo: OscillatorType; rate: number; base: number; depth: number }> = {
  /** Hi-lo: two tones a few semitones apart, ~0.6 s each. */
  twoTone: { lfo: 'square', rate: 0.85, base: 865, depth: 95 },
  /** Slow rise and fall. */
  wail: { lfo: 'triangle', rate: 0.22, base: 950, depth: 420 },
  /** Fast warble for when it's serious. */
  yelp: { lfo: 'triangle', rate: 3.2, base: 950, depth: 380 },
};

/**
 * A positional police siren: saw + square through a horn-speaker band, its
 * pitch swung by an LFO, with doppler from how fast it closes on the listener.
 */
export class SirenVoice {
  readonly v: Voice;
  x = 0;
  z = 0;
  /** Game seconds since the last siren() call; stale sirens are released. */
  age = 0;
  style: SirenStyle | null = null;
  private lastDist = -1;
  private radial = 0;
  private readonly o1: OscillatorNode;
  private readonly o2: OscillatorNode;
  private readonly lfo: OscillatorNode;
  private readonly depth: GainNode;
  private readonly air: BiquadFilterNode;
  private readonly pan: StereoPannerNode | null;

  constructor(
    ctx: BaseAudioContext,
    bank: NoiseBank,
    dest: AudioNode,
    readonly id: string | number,
    now: number,
  ) {
    const v = (this.v = new Voice(ctx, bank, now, 0));
    this.pan = typeof ctx.createStereoPanner === 'function' ? v.track(ctx.createStereoPanner()) : null;
    if (this.pan) v.chain(v.out, this.pan, dest);
    else v.out.connect(dest);
    this.o1 = v.osc('sawtooth', 865, now);
    this.o2 = v.osc('square', 865, now);
    this.o2.detune.value = 8;
    this.lfo = v.osc('square', 0.85, now);
    this.depth = v.gain(95);
    v.chain(this.lfo, this.depth);
    this.depth.connect(this.o1.frequency);
    this.depth.connect(this.o2.frequency);
    const bp = v.filter('bandpass', 1400, 0.9);
    const level = v.gain(0.3);
    this.air = v.filter('lowpass', 12000, 0.5);
    this.o1.connect(bp);
    this.o2.connect(bp);
    v.chain(bp, level, this.air, v.out);
  }

  setStyle(style: SirenStyle): void {
    if (style === this.style) return;
    this.style = style;
    const s = SIREN_STYLES[style];
    this.lfo.type = s.lfo;
    this.lfo.frequency.value = s.rate;
    this.depth.gain.value = s.depth;
    this.o1.frequency.value = s.base;
    this.o2.frequency.value = s.base;
  }

  /** Position relative to the listener: level, pan, air absorption and doppler. */
  place(gain: number, pan: number, cutoff: number, dist: number, dt: number, now: number): void {
    if (this.lastDist >= 0 && dt > 0) {
      const r = (dist - this.lastDist) / dt;
      this.radial += (clamp(r, -80, 80) - this.radial) * clamp01(dt * 6);
    }
    this.lastDist = dist;
    const cents = dopplerCents(this.radial);
    to(this.o1.detune, cents, now, 0.08);
    to(this.o2.detune, cents + 8, now, 0.08);
    to(this.v.out.gain, gain, now, 0.06);
    if (this.pan) to(this.pan.pan, pan, now, 0.06);
    to(this.air.frequency, cutoff, now, 0.1);
  }

  release(now: number): number {
    return this.v.release(now, 0.25);
  }
}
