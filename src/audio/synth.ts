/**
 * Web Audio building blocks: noise buffers generated once, a Voice that
 * remembers every node it creates so it can be torn down without leaks,
 * envelope helpers, soft-clip curves and a synthetic reverb impulse. Works on
 * any BaseAudioContext, so sounds can also be rendered offline for checks.
 */
import type { Dip } from './mix';

/** Live node accounting for the debug readout: a leak shows up as `live` creeping up. */
export const nodeStats = { created: 0, live: 0 };

/** Pre-generated noise (mono, ~2 s, loop-safe) shared by every sound. */
export class NoiseBank {
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  /** Sparse pops and snaps: fire, debris, vinyl. */
  readonly crackle: AudioBuffer;
  /** A one-shot burst of tiny impulses that thins out: shattering glass through resonant filters. */
  readonly glass: AudioBuffer;

  constructor(ctx: BaseAudioContext, seconds = 2) {
    const rate = ctx.sampleRate;
    const n = Math.floor(rate * seconds);
    this.white = ctx.createBuffer(1, n, rate);
    this.pink = ctx.createBuffer(1, n, rate);
    this.brown = ctx.createBuffer(1, n, rate);
    this.crackle = ctx.createBuffer(1, n, rate);
    this.glass = ctx.createBuffer(1, Math.floor(rate * 0.9), rate);
    fillNoise(this.white.getChannelData(0), this.pink.getChannelData(0), this.brown.getChannelData(0));
    fillCrackle(this.crackle.getChannelData(0), rate);
    fillGlass(this.glass.getChannelData(0), rate);
  }

  /** A random start point, so back-to-back sounds don't share the same grain. */
  offset(buffer: AudioBuffer, tail = 0.5): number {
    return Math.random() * Math.max(0, buffer.duration - tail);
  }
}

function fillNoise(white: Float32Array, pink: Float32Array, brown: Float32Array): void {
  // Paul Kellet's pink filter; brown is leaky-integrated white.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < white.length; i++) {
    const w = Math.random() * 2 - 1;
    white[i] = w * 0.5;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    pink[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
    br = (br + 0.02 * w) / 1.02;
    brown[i] = br * 3.5;
  }
  // Close the loop: bend each buffer so its end meets its start (no click at the seam).
  for (const d of [pink, brown]) {
    const drift = d[d.length - 1] - d[0];
    for (let i = 0; i < d.length; i++) d[i] -= (drift * i) / (d.length - 1);
  }
}

function fillCrackle(d: Float32Array, rate: number): void {
  let i = 0;
  while (i < d.length) {
    // Pops arrive in little clusters, like burning wood.
    i += Math.floor(rate * (Math.random() < 0.3 ? 0.004 + Math.random() * 0.01 : 0.02 + Math.random() * 0.07));
    const amp = (0.25 + Math.random() * 0.75) * (Math.random() < 0.5 ? -1 : 1);
    const len = Math.floor(rate * (0.0006 + Math.random() * 0.0025));
    for (let k = 0; k < len && i + k < d.length; k++) d[i + k] += amp * Math.exp(-k / (len * 0.3)) * (Math.random() * 2 - 1);
  }
}

function fillGlass(d: Float32Array, rate: number): void {
  for (let i = 0; i < d.length; i++) {
    const t = i / rate;
    if (Math.random() < 0.012 * Math.exp(-t / 0.16)) {
      const amp = 0.4 + Math.random() * 0.6;
      const len = Math.floor(rate * 0.0004);
      for (let k = 0; k < len && i + k < d.length; k++) d[i + k] += amp * (Math.random() * 2 - 1);
    }
  }
}

const curves = new Map<number, Float32Array<ArrayBuffer>>();

/** tanh soft-clip curve; drive 1 is nearly clean, 4 is raspy. Cached per drive. */
export function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = Math.round(drive * 10) / 10;
  let c = curves.get(key);
  if (!c) {
    c = new Float32Array(1024);
    const norm = Math.tanh(key);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(key * x) / norm;
    }
    curves.set(key, c);
  }
  return c;
}

/**
 * A stereo "street" reverb: a few hard early reflections (building faces)
 * and a diffuse tail that darkens as it decays.
 */
export function makeImpulse(ctx: BaseAudioContext, seconds = 1.6, decay = 0.38): AudioBuffer {
  const rate = ctx.sampleRate;
  const n = Math.floor(rate * seconds);
  const ir = ctx.createBuffer(2, n, rate);
  const reflections = [0.011, 0.019, 0.027, 0.041, 0.058, 0.083];
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      // One-pole lowpass whose cutoff falls over time: highs die first.
      const k = 0.55 + 0.4 * Math.min(1, t / seconds);
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * 2.2 * Math.exp(-t / decay) * Math.min(1, t / 0.012);
    }
    for (const r of reflections) {
      const at = Math.floor((r + (ch ? 0.0037 : 0)) * rate);
      if (at < n) d[at] += (Math.random() < 0.5 ? -0.5 : 0.5) * Math.exp(-r / 0.06);
    }
  }
  return ir;
}

/** Linear attack to `peak`, then an exponential decay with time constant `tau`. Returns when it's silent. */
export function perc(p: AudioParam, t: number, peak: number, attack: number, tau: number): number {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setTargetAtTime(0, t + attack, tau);
  return t + attack + tau * 7;
}

/**
 * Re-schedule `p` to follow `dip` from `now`. Everything queued is dropped
 * first (keeping the value reached), so an earlier "recover at t" can't undo a
 * deeper dip scheduled after it. Glides down with time constant `attack`.
 */
export function automateDip(p: AudioParam, dip: Dip, now: number, attack: number): void {
  const reached = p.value;
  p.cancelScheduledValues(now);
  p.setValueAtTime(reached, now);
  if (dip.holdEnd > now) p.setTargetAtTime(dip.level, now, attack);
  if (dip.holdEnd !== Infinity) p.setTargetAtTime(dip.rest, Math.max(now, dip.holdEnd), dip.tau);
}

/** Exponential glide of a frequency from f0 to f1 over `dur` seconds. */
export function sweep(p: AudioParam, t: number, f0: number, f1: number, dur: number): void {
  p.setValueAtTime(Math.max(1e-3, f0), t);
  p.exponentialRampToValueAtTime(Math.max(1e-3, f1), t + dur);
}

/**
 * Every node of one sound. Sources connect into `input`; `out` is the voice's
 * own gain stage (a steal fades it). The owner disconnects everything once
 * `end` has passed, so nothing leaks however the sound ends.
 */
export class Voice {
  readonly nodes: AudioNode[] = [];
  readonly sources: AudioScheduledSourceNode[] = [];
  readonly out: GainNode;
  /** Where the sound's sources and filters connect. */
  input: AudioNode;
  /** Context time it falls silent. */
  end: number;
  disposed = false;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly bank: NoiseBank,
    /** Start time. */
    readonly t: number,
    level = 1,
  ) {
    this.out = this.gain(level);
    this.input = this.out;
    this.end = t;
  }

  track<N extends AudioNode>(node: N): N {
    this.nodes.push(node);
    nodeStats.created++;
    nodeStats.live++;
    return node;
  }

  gain(value = 0): GainNode {
    const g = this.track(this.ctx.createGain());
    g.gain.value = value;
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
    const f = this.track(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  shaper(drive: number): WaveShaperNode {
    const s = this.track(this.ctx.createWaveShaper());
    s.curve = driveCurve(drive);
    return s;
  }

  /** An oscillator running from `start` to `stop` (or until the voice is released). */
  osc(type: OscillatorType, freq: number, start: number, stop?: number): OscillatorNode {
    const o = this.track(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = freq;
    this.play(o, start, stop);
    return o;
  }

  /**
   * A noise buffer from a random point, from `start` to `stop` (or until the
   * voice is released). Loops when the sound outlasts the buffer.
   */
  noise(buffer: AudioBuffer, start: number, stop?: number, rate = 1, loop = false): AudioBufferSourceNode {
    const s = this.track(this.ctx.createBufferSource());
    s.buffer = buffer;
    const need = stop === undefined ? Infinity : (stop - start) * rate;
    s.loop = loop || need > buffer.duration - 0.05;
    s.playbackRate.value = rate;
    this.sources.push(s);
    s.start(start, s.loop ? this.bank.offset(buffer) : this.bank.offset(buffer, need + 0.02));
    if (stop !== undefined) {
      s.stop(stop);
      this.until(stop);
    }
    return s;
  }

  play(src: AudioScheduledSourceNode, start: number, stop?: number): void {
    this.sources.push(src);
    src.start(start);
    if (stop !== undefined) {
      src.stop(stop);
      this.until(stop);
    }
  }

  /** Fade a looping voice out over ~`fade` s and stop its sources; returns when it's silent. */
  release(now: number, fade = 0.15): number {
    this.out.gain.setTargetAtTime(0, now, fade / 4);
    const stop = now + fade + 0.05;
    for (const s of this.sources) {
      try {
        s.stop(stop);
      } catch {
        // Already stopped.
      }
    }
    this.end = stop;
    return stop;
  }

  /** Connect a chain a → b → c ...; returns the last node. */
  chain(...nodes: AudioNode[]): AudioNode {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  until(t: number): void {
    if (t > this.end) this.end = t;
  }

  /** Fade out fast (voice stealing); returns when it's silent. */
  kill(now: number): number {
    this.out.gain.setTargetAtTime(0, now, 0.012);
    const stop = now + 0.08;
    for (const s of this.sources) {
      try {
        s.stop(stop);
      } catch {
        // Already stopped.
      }
    }
    this.end = Math.min(this.end, stop);
    return stop;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of this.nodes) n.disconnect();
    nodeStats.live -= this.nodes.length;
    this.nodes.length = 0;
    this.sources.length = 0;
  }
}
