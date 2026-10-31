/**
 * The radio's drum kit, rendered once per station sound into sample buffers
 * (plain Float32Arrays: pure, deterministic, unit-tested). Rendering ahead
 * lets each hit be far richer than a live Web Audio voice could afford per
 * note: layered body and transient, 808-style metallic hats from six square
 * partials, a snare with two tuned body modes, a four-hand clap, all through
 * soft saturation, and three slightly different takes of every hit so a
 * pattern doesn't sound machine-gunned. MusicPlayer plays them back as
 * buffers (round robin), falling back to its live voices until a kit is in.
 */
import type { StationSound } from './stations';

export type KitPart = 'kick' | 'snare' | 'clap' | 'hat' | 'openHat' | 'perc' | 'crash';

/** Takes per hit (round robin); the long, rare ones need fewer. */
export const TAKES: Record<KitPart, number> = { kick: 3, snare: 3, clap: 3, hat: 3, openHat: 2, perc: 3, crash: 1 };

/** Peak level of each part at full velocity (matches the live voices' mix). */
export const KIT_LEVEL: Record<KitPart, number> = {
  kick: 0.75,
  snare: 0.7,
  clap: 0.55,
  hat: 0.24,
  openHat: 0.2,
  perc: 0.38,
  crash: 0.22,
};

export type DrumKit = Record<KitPart, Float32Array[]>;

/** One take of one part: rendered by run(). */
export interface KitJob {
  part: KitPart;
  run(): Float32Array;
}

/**
 * The kit as small jobs (one take each, a few ms), so a caller can render
 * it between frames instead of in one go. Same output as renderKit.
 */
export function kitJobs(sound: StationSound, rate: number, seed = 1): KitJob[] {
  const r = mulberry32(seed);
  const noise = () => r() * 2 - 1;
  const vary = mulberry32(seed * 7919 + Math.round(sound.kickTune * 13));
  const make: Record<KitPart, (v: number) => Float32Array> = {
    kick: (v) => kick(rate, sound.kickTune * (1 + v * 0.015), sound.kickDecay * (1 + v * 0.05), noise),
    snare: (v) => (sound.snare === 'rim' ? rim(rate, 1 + v * 0.02, noise) : snare(rate, sound.snare === 'gated', 1 + v * 0.02, noise)),
    clap: (v) => clap(rate, 1 + v * 0.15, noise),
    hat: (v) => (sound.hat === 'shaker' ? shaker(rate, false, 1 + v * 0.08, noise) : metalHat(rate, false, 1 + v * 0.02, noise)),
    openHat: (v) => (sound.hat === 'shaker' ? shaker(rate, true, 1 + v * 0.08, noise) : metalHat(rate, true, 1 + v * 0.02, noise)),
    perc: (v) => (sound.snare === 'rim' ? rim(rate, 0.8 + v * 0.03, noise) : bongo(rate, 1 + v * 0.03, noise)),
    crash: (v) => crash(rate, 1 + v * 0.02, noise),
  };
  const jobs: KitJob[] = [];
  for (const part of Object.keys(make) as KitPart[]) {
    for (let i = 0; i < TAKES[part]; i++) {
      // Take 0 is the reference; the others drift a little in tune, decay and level.
      const v = i === 0 ? 0 : vary() * 2 - 1;
      const level = KIT_LEVEL[part] * (i === 0 ? 1 : 0.94 + vary() * 0.06);
      jobs.push({ part, run: () => normalize(make[part](v), level) });
    }
  }
  return jobs;
}

/** Render every part's takes at `rate` Hz for a station's sound, in one go. */
export function renderKit(sound: StationSound, rate: number, seed = 1): DrumKit {
  const kit: DrumKit = { kick: [], snare: [], clap: [], hat: [], openHat: [], perc: [], crash: [] };
  for (const job of kitJobs(sound, rate, seed)) kit[job.part].push(job.run());
  return kit;
}

// ---------------------------------------------------------------- the hits

/** A sine body diving from ~3.2× to the tune, a click on top, saturated. */
function kick(rate: number, tune: number, decay: number, noise: () => number): Float32Array {
  const out = new Float32Array(Math.ceil(rate * (decay * 2.2 + 0.08)));
  const hp = new Biquad('highpass', 1800, 0.7, rate);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const f = tune * 0.85 + (tune * 3.2 - tune * 0.85) * Math.exp(-t / 0.032);
    phase += (2 * Math.PI * f) / rate;
    const body = Math.sin(phase) * attack(t, 0.0015) * Math.exp(-t / decay);
    // Second harmonic for punch on small speakers (phones).
    const knock = Math.sin(phase * 2) * 0.18 * Math.exp(-t / (decay * 0.35));
    const click = hp.run(noise()) * 0.35 * Math.exp(-t / 0.0025) + Math.sin(2 * Math.PI * 1500 * t) * 0.15 * Math.exp(-t / 0.004);
    out[i] = saturate(body + knock + click, 1.8);
  }
  return out;
}

/** Two tuned shell modes, a bandpassed noise crack and sizzle; gated: a held room, slammed shut. */
function snare(rate: number, gated: boolean, tune: number, noise: () => number): Float32Array {
  const len = gated ? 0.32 : 0.26;
  const out = new Float32Array(Math.ceil(rate * len));
  const crack = new Biquad('bandpass', (gated ? 1800 : 2600) * tune, gated ? 0.7 : 0.9, rate);
  const sizzle = new Biquad('highpass', 5200, 0.7, rate);
  const room = new Biquad('lowpass', 6000, 0.6, rate);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    p1 += (2 * Math.PI * (185 * tune + 30 * Math.exp(-t / 0.015))) / rate;
    p2 += (2 * Math.PI * 330 * tune) / rate;
    const shell = (Math.sin(p1) * 0.55 + Math.sin(p2) * 0.25) * Math.exp(-t / 0.05);
    const n = noise();
    let snap = crack.run(n) * Math.exp(-t / (gated ? 0.06 : 0.045));
    const wire = sizzle.run(n) * 0.35 * Math.exp(-t / 0.09);
    if (gated) {
      // The 80s gated room: a held noise bloom, shut hard at ~170 ms.
      const gate = t < 0.17 ? 1 : Math.exp(-(t - 0.17) / 0.012);
      snap += room.run(n) * 0.38 * gate * attack(t, 0.008);
    }
    out[i] = saturate((shell + snap * 1.2 + wire) * attack(t, 0.0008), 1.5);
  }
  return out;
}

/** A rimshot / cross-stick: a woody tone and a bright click (the lo-fi station's snare and perc). */
function rim(rate: number, tune: number, noise: () => number): Float32Array {
  const out = new Float32Array(Math.ceil(rate * 0.12));
  const bp = new Biquad('bandpass', 3200 * tune, 1.2, rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const tone = (Math.sin(2 * Math.PI * 820 * tune * t) * 0.6 + Math.sin(2 * Math.PI * 1650 * tune * t) * 0.25) * Math.exp(-t / 0.014);
    const click = bp.run(noise()) * Math.exp(-t / 0.008);
    out[i] = saturate((tone + click) * attack(t, 0.0004), 1.3);
  }
  return out;
}

/** Four hands a few ms apart (spread), then a short room tail. */
function clap(rate: number, spread: number, noise: () => number): Float32Array {
  const out = new Float32Array(Math.ceil(rate * 0.3));
  const bp = new Biquad('bandpass', 1150, 1.3, rate);
  const hits = [0, 0.009, 0.019, 0.03].map((h) => h * spread);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    let env = 0;
    for (let k = 0; k < hits.length; k++) {
      const dt = t - hits[k];
      if (dt >= 0) env = Math.max(env, Math.exp(-dt / (k === hits.length - 1 ? 0.07 : 0.0045)));
    }
    out[i] = saturate(bp.run(noise()) * env * 1.6, 1.4);
  }
  return out;
}

/** The 808's metal: six detuned square partials, band-limited high. */
function metalHat(rate: number, open: boolean, tune: number, noise: () => number): Float32Array {
  const len = open ? 0.45 : 0.09;
  const out = new Float32Array(Math.ceil(rate * len));
  const freqs = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 1.95 * tune);
  const bp = new Biquad('bandpass', 10000, 0.9, rate);
  const hp = new Biquad('highpass', 7200, 0.7, rate);
  const air = new Biquad('highpass', 9000, 0.7, rate);
  const phases = freqs.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    let m = 0;
    for (let k = 0; k < freqs.length; k++) {
      phases[k] += freqs[k] / rate;
      m += phases[k] % 1 < 0.5 ? 1 : -1;
    }
    const env = attack(t, 0.0005) * (open ? Math.exp(-t / 0.11) : Math.exp(-t / 0.016));
    out[i] = (hp.run(bp.run(m / 6)) + air.run(noise()) * 0.25) * env;
  }
  return out;
}

/** A shaker: two grains of bandpassed noise with a soft attack. */
function shaker(rate: number, open: boolean, tune: number, noise: () => number): Float32Array {
  const len = open ? 0.3 : 0.11;
  const out = new Float32Array(Math.ceil(rate * len));
  const bp = new Biquad('bandpass', 6500 * tune, 1.1, rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const grain = (at: number, tau: number) => (t < at ? 0 : attack(t - at, 0.01) * Math.exp(-(t - at) / tau));
    const env = open ? grain(0, 0.06) + 0.7 * grain(0.07, 0.06) : grain(0, 0.022) + 0.45 * grain(0.035, 0.018);
    out[i] = bp.run(noise()) * env;
  }
  return out;
}

/** A tuned hand drum: sine with a small pitch drop and a slap. */
function bongo(rate: number, tune: number, noise: () => number): Float32Array {
  const out = new Float32Array(Math.ceil(rate * 0.2));
  const hp = new Biquad('highpass', 2500, 0.7, rate);
  let p = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    p += (2 * Math.PI * (300 * tune + 60 * Math.exp(-t / 0.02))) / rate;
    const body = Math.sin(p) * Math.exp(-t / 0.045);
    const slap = hp.run(noise()) * 0.3 * Math.exp(-t / 0.004);
    out[i] = saturate((body + slap) * attack(t, 0.0008), 1.2);
  }
  return out;
}

/** Metal partials an octave up plus bright noise, a long wash. */
function crash(rate: number, tune: number, noise: () => number): Float32Array {
  const out = new Float32Array(Math.ceil(rate * 2.2));
  const freqs = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 4.1 * tune);
  const hp = new Biquad('highpass', 4200, 0.6, rate);
  const hp2 = new Biquad('highpass', 3000, 0.6, rate);
  const phases = freqs.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    let m = 0;
    for (let k = 0; k < freqs.length; k++) {
      phases[k] += freqs[k] / rate;
      m += phases[k] % 1 < 0.5 ? 1 : -1;
    }
    const env = attack(t, 0.002) * (0.75 * Math.exp(-t / 0.5) + 0.25 * Math.exp(-t / 0.06));
    out[i] = (hp2.run(m / 6) * 0.45 + hp.run(noise())) * env;
  }
  return out;
}

// ---------------------------------------------------------------- DSP

function attack(t: number, a: number): number {
  return t >= a ? 1 : t / a;
}

/** Soft clip, unity at small levels' slope ~1. */
function saturate(x: number, drive: number): number {
  return Math.tanh(x * drive) / Math.tanh(drive);
}

/** Scale to `peak` (silence stays silence). */
function normalize(buf: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  // A short fade at the end so a cut-off tail never clicks.
  const fade = Math.min(buf.length, 64);
  for (let i = 0; i < fade; i++) buf[buf.length - 1 - i] *= i / fade;
  return buf;
}

/** RBJ biquad, direct form I. */
export class Biquad {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: 'lowpass' | 'highpass' | 'bandpass', freq: number, q: number, rate: number) {
    const w = (2 * Math.PI * Math.min(freq, rate * 0.45)) / rate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
