/**
 * One-shot sound recipes. Each builds its graph into a Voice (which handles
 * placement, level and cleanup) starting at `v.t`. Everything is synthesised
 * from oscillators and the shared noise buffers; small random variations keep
 * repeated sounds (an SMG burst, footsteps) from sounding machine-gunned.
 */
import type { ScoreKind } from '../systems/score';
import type { WeaponKind } from '../systems/weapons';
import { clamp01, semis } from './mix';
import { fold, midiToHz, scaleNote, SCALES } from './music/theory';
import { perc, sweep, type Voice } from './synth';

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
/** 1 ± amount, uniformly. */
const vary = (amount: number) => 1 + (Math.random() * 2 - 1) * amount;

/** Noise through a filter with a percussive envelope: the workhorse of impacts. */
function noiseHit(
  v: Voice,
  buffer: AudioBuffer,
  at: number,
  type: BiquadFilterType,
  freq: number,
  q: number,
  peak: number,
  attack: number,
  tau: number,
  dest: AudioNode = v.input,
): GainNode {
  const n = v.noise(buffer, at, at + attack + tau * 7 + 0.01);
  const f = v.filter(type, freq, q);
  const g = v.gain();
  v.chain(n, f, g, dest);
  perc(g.gain, at, peak, attack, tau);
  return g;
}

/** A pitched thump that falls from f0 to f1: the "punch" under shots, hits and booms. */
function thump(v: Voice, at: number, f0: number, f1: number, glide: number, peak: number, tau: number, type: OscillatorType = 'sine'): void {
  const o = v.osc(type, f0, at, at + glide + tau * 7);
  sweep(o.frequency, at, f0, f1, glide);
  const g = v.gain();
  v.chain(o, g, v.input);
  perc(g.gain, at, peak, 0.0015, tau);
}

/** A short tone with a filtered pluck envelope, for stingers and UI. */
function pluck(v: Voice, at: number, midi: number, peak: number, tau = 0.11, bright = 5200, glideFrom = 0): void {
  const hz = midiToHz(midi);
  const a = v.osc('square', hz, at, at + tau * 7);
  const b = v.osc('triangle', hz * 2, at, at + tau * 7);
  if (glideFrom !== 0) {
    sweep(a.frequency, at, hz * semis(glideFrom), hz, 0.07);
    sweep(b.frequency, at, hz * 2 * semis(glideFrom), hz * 2, 0.07);
  }
  const lp = v.filter('lowpass', bright, 1.2);
  sweep(lp.frequency, at, bright, Math.max(600, bright * 0.25), tau * 1.5);
  const g = v.gain();
  a.connect(lp);
  b.connect(lp);
  v.chain(lp, g, v.input);
  perc(g.gain, at, peak, 0.003, tau);
}

// --- Guns ---

/** Pistol: a bright crack over a short thump, plus the hammer's click. */
export function pistol(v: Voice): void {
  const t = v.t;
  const p = vary(0.06);
  const b = v.bank;
  const n = v.noise(b.white, t, t + 0.25);
  const hp = v.filter('highpass', 900 * p, 0.6);
  const crack = v.gain();
  v.chain(n, hp, crack, v.input);
  perc(crack.gain, t, 0.9, 0.0015, 0.022);
  const lp = v.filter('lowpass', 2000 * p, 0.9);
  const body = v.gain();
  v.chain(n, lp, body, v.input);
  perc(body.gain, t, 0.7, 0.002, 0.04);
  thump(v, t, 190 * p, 52, 0.09, 0.75, 0.04);
  const c = v.osc('square', 2600 * p, t, t + 0.03);
  const cg = v.gain();
  v.chain(c, cg, v.input);
  perc(cg.gain, t, 0.16, 0.0005, 0.004);
}

/** SMG: tighter and higher than the pistol, built to repeat ~11 times a second. */
export function smg(v: Voice): void {
  const t = v.t;
  const p = vary(0.08);
  const n = v.noise(v.bank.white, t, t + 0.14);
  const bp = v.filter('bandpass', 2400 * p, 0.8);
  const crack = v.gain();
  v.chain(n, bp, crack, v.input);
  perc(crack.gain, t, 0.85, 0.001, 0.014);
  const lp = v.filter('lowpass', 1500 * p, 0.8);
  const body = v.gain();
  v.chain(n, lp, body, v.input);
  perc(body.gain, t, 0.6, 0.001, 0.022);
  thump(v, t, 240 * p, 80, 0.05, 0.55, 0.018);
  const tick = v.osc('square', 3800 * p, t, t + 0.02);
  const tg = v.gain();
  v.chain(tick, tg, v.input);
  perc(tg.gain, t, 0.1, 0.0005, 0.003);
}

/** Shotgun: a wide boom with a sweeping filter and a deep punch; the player's racks the slide. */
export function shotgun(v: Voice, pump: boolean): void {
  const t = v.t;
  const p = vary(0.05);
  const b = v.bank;
  const n = v.noise(b.white, t, t + 0.5);
  const lp = v.filter('lowpass', 7000, 0.7);
  sweep(lp.frequency, t, 7500 * p, 420, 0.3);
  const blast = v.gain();
  v.chain(n, lp, blast, v.input);
  perc(blast.gain, t, 0.8, 0.002, 0.07);
  noiseHit(v, b.brown, t, 'lowpass', 900, 0.7, 0.8, 0.003, 0.11);
  thump(v, t, 130 * p, 36, 0.28, 0.9, 0.09);
  const c = v.osc('square', 1800, t, t + 0.03);
  const cg = v.gain();
  v.chain(c, cg, v.input);
  perc(cg.gain, t, 0.14, 0.0005, 0.004);
  if (!pump) return;
  // Shuck-shuck: slide back, slide forward.
  const r0 = t + 0.42;
  const r1 = t + 0.56;
  const rn = v.noise(b.white, r0 - 0.01, r1 + 0.12);
  const rb = v.filter('bandpass', 1300, 3);
  rb.frequency.setValueAtTime(1300, r0);
  rb.frequency.setValueAtTime(2300, r1);
  const rg = v.gain();
  v.chain(rn, rb, rg, v.input);
  perc(rg.gain, r0, 0.5, 0.002, 0.014);
  perc(rg.gain, r1, 0.45, 0.002, 0.011);
  const clunk = v.osc('triangle', 320, r0, r1 + 0.12);
  clunk.frequency.setValueAtTime(420, r1);
  const kg = v.gain();
  v.chain(clunk, kg, v.input);
  perc(kg.gain, r0, 0.22, 0.001, 0.016);
  perc(kg.gain, r1, 0.2, 0.001, 0.014);
}

/** Street guns: darker and duller than the player's, so you can tell who's shooting. */
export function npcGun(v: Voice): void {
  const t = v.t;
  const p = vary(0.08);
  const n = v.noise(v.bank.white, t, t + 0.25);
  const hp = v.filter('highpass', 600 * p, 0.6);
  const crack = v.gain();
  v.chain(n, hp, crack, v.input);
  perc(crack.gain, t, 0.7, 0.0015, 0.02);
  const lp = v.filter('lowpass', 1300 * p, 0.9);
  const body = v.gain();
  v.chain(n, lp, body, v.input);
  perc(body.gain, t, 0.75, 0.002, 0.045);
  thump(v, t, 150 * p, 46, 0.1, 0.8, 0.045);
}

export function gunshot(v: Voice, weapon: WeaponKind | null, byPlayer: boolean): void {
  if (weapon === 'pistol') pistol(v);
  else if (weapon === 'smg') smg(v);
  else if (weapon === 'shotgun') shotgun(v, byPlayer);
  else if (weapon === 'rocket') rocketLaunch(v);
  else npcGun(v);
}

/** A rocket leaving the tube: a hollow pop, then a roaring hiss that climbs away. */
export function rocketLaunch(v: Voice): void {
  const t = v.t;
  const b = v.bank;
  thump(v, t, 110, 40, 0.18, 0.85, 0.07);
  noiseHit(v, b.white, t, 'bandpass', 900, 0.8, 0.7, 0.002, 0.04);
  const n = v.noise(b.pink, t, t + 1.4);
  const bp = v.filter('bandpass', 600, 0.9);
  sweep(bp.frequency, t, 500, 2600, 0.9);
  const g = v.gain();
  v.chain(n, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.75, t + 0.05);
  g.gain.setTargetAtTime(0, t + 0.25, 0.35);
}

/** Nitro lighting: a deep thump and a jet-like roar rising and fading. */
export function boost(v: Voice): void {
  const t = v.t;
  const b = v.bank;
  thump(v, t, 70, 38, 0.25, 0.7, 0.12);
  const n = v.noise(b.pink, t, t + 1.3);
  const bp = v.filter('bandpass', 400, 0.8);
  sweep(bp.frequency, t, 300, 2200, 0.7);
  const g = v.gain();
  v.chain(n, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.85, t + 0.08);
  g.gain.setTargetAtTime(0, t + 0.45, 0.3);
  const o = v.osc('sawtooth', 90, t, t + 1);
  sweep(o.frequency, t, 90, 240, 0.6);
  const lp = v.filter('lowpass', 900, 0.8);
  const og = v.gain();
  v.chain(o, lp, og, v.input);
  perc(og.gain, t, 0.25, 0.05, 0.25);
}

/** Off a ramp: the engine note gone light, and air rushing past. */
export function jumpWhoosh(v: Voice): void {
  const t = v.t;
  const n = v.noise(v.bank.pink, t, t + 1.2);
  const bp = v.filter('bandpass', 600, 0.9);
  sweep(bp.frequency, t, 500, 1800, 0.5);
  const g = v.gain();
  v.chain(n, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.7, t + 0.15);
  g.gain.setTargetAtTime(0, t + 0.5, 0.25);
  // The suspension unloading: a springy clunk.
  noiseHit(v, v.bank.white, t, 'bandpass', 700, 1.5, 0.45, 0.002, 0.03);
}

/** A car landing a jump: a heavy, springy thud and a scrape, scaled by how hard (m/s). */
export function landThump(v: Voice, impact: number): void {
  const t = v.t;
  const k = clamp01((impact - 4) / 12);
  thump(v, t, 95, 32, 0.22, 0.7 + 0.3 * k, 0.09 + 0.05 * k);
  noiseHit(v, v.bank.brown, t, 'lowpass', 700 + 900 * k, 0.7, 0.8, 0.003, 0.07);
  noiseHit(v, v.bank.white, t + 0.02, 'bandpass', 2400, 1, 0.25 * k, 0.002, 0.06);
  // Springs bouncing back.
  const o = v.osc('triangle', 180, t + 0.08, t + 0.5);
  sweep(o.frequency, t + 0.08, 180, 120, 0.3);
  const g = v.gain();
  v.chain(o, g, v.input);
  perc(g.gain, t + 0.08, 0.12 * (0.5 + k), 0.01, 0.06);
}

/** Something thrown: a short cloth-and-air whoosh. */
export function throwWhoosh(v: Voice): void {
  const t = v.t;
  const n = v.noise(v.bank.pink, t, t + 0.4);
  const bp = v.filter('bandpass', 900, 1.4);
  sweep(bp.frequency, t, 1500, 420, 0.28);
  const g = v.gain();
  v.chain(n, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.7, t + 0.06);
  g.gain.setTargetAtTime(0, t + 0.09, 0.07);
}

/** A molotov bursting: breaking glass and the whump of fuel catching. */
export function ignite(v: Voice): void {
  const t = v.t;
  const b = v.bank;
  noiseHit(v, b.white, t, 'highpass', 4200, 0.7, 0.8, 0.0005, 0.03);
  for (let i = 0; i < 3; i++) {
    const at = t + rnd(0.01, 0.12);
    const o = v.osc('sine', rnd(2600, 4800), at, at + 0.2);
    const g = v.gain();
    v.chain(o, g, v.input);
    perc(g.gain, at, rnd(0.05, 0.1), 0.001, 0.03);
  }
  const n = v.noise(b.brown, t + 0.03, t + 1.4);
  const lp = v.filter('lowpass', 300, 0.7);
  sweep(lp.frequency, t + 0.03, 300, 1600, 0.25);
  const g = v.gain();
  v.chain(n, lp, g, v.input);
  g.gain.setValueAtTime(0, t + 0.03);
  g.gain.linearRampToValueAtTime(0.9, t + 0.12);
  g.gain.setTargetAtTime(0, t + 0.3, 0.3);
  thump(v, t + 0.04, 90, 40, 0.2, 0.6, 0.08);
}

/** A bullet passing close by: a short tearing hiss. */
export function whiz(v: Voice): void {
  const t = v.t;
  const n = v.noise(v.bank.white, t, t + 0.3);
  const bp = v.filter('bandpass', 2600, 4);
  sweep(bp.frequency, t, rnd(2600, 3400), 900, 0.18);
  const g = v.gain();
  v.chain(n, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(2, t + 0.06);
  g.gain.setTargetAtTime(0, t + 0.07, 0.035);
}

// --- Bullet impacts ---

/** Chips off a wall, sometimes with a whining ricochet. */
export function bulletWall(v: Voice, ricochet: boolean): void {
  const t = v.t;
  noiseHit(v, v.bank.white, t, 'bandpass', 2600 * vary(0.15), 1.1, 0.5, 0.001, 0.012);
  noiseHit(v, v.bank.white, t, 'highpass', 5000, 0.7, 0.25, 0.0005, 0.005);
  if (!ricochet) return;
  const f0 = rnd(2200, 3600);
  const o = v.osc('triangle', f0, t + 0.005, t + 0.5);
  sweep(o.frequency, t + 0.005, f0, f0 * rnd(0.45, 0.6), rnd(0.25, 0.38));
  const g = v.gain();
  v.chain(o, g, v.input);
  perc(g.gain, t + 0.005, 0.2, 0.004, 0.085);
}

/** Struck sheet metal: inharmonic partials over a tick. */
export function bulletMetal(v: Voice): void {
  const t = v.t;
  const f0 = rnd(380, 640);
  const partials: Array<[number, number, number]> = [
    [1, 0.35, 0.07],
    [2.76, 0.22, 0.045],
    [5.4, 0.12, 0.025],
  ];
  for (const [ratio, peak, tau] of partials) {
    const o = v.osc('sine', f0 * ratio, t, t + tau * 7);
    const g = v.gain();
    v.chain(o, g, v.input);
    perc(g.gain, t, peak, 0.0005, tau);
  }
  noiseHit(v, v.bank.white, t, 'highpass', 3000, 0.7, 0.45, 0.0005, 0.006);
}

/** A dull thwack into a body. */
export function bulletFlesh(v: Voice): void {
  const t = v.t;
  noiseHit(v, v.bank.white, t, 'lowpass', 700, 0.8, 0.7, 0.002, 0.03);
  thump(v, t, 130, 60, 0.06, 0.55, 0.035);
}

// --- Fists and bodies ---

/** A swing's whoosh, and if it lands, a meaty thwack. */
export function punch(v: Voice, hit: boolean): void {
  const t = v.t;
  const n = v.noise(v.bank.pink, t, t + 0.25);
  const bp = v.filter('bandpass', 500, 1.6);
  sweep(bp.frequency, t, 450, 2400, 0.13);
  const g = v.gain();
  v.chain(n, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.9, t + 0.07);
  g.gain.setTargetAtTime(0, t + 0.08, 0.03);
  if (!hit) return;
  const th = t + 0.055;
  noiseHit(v, v.bank.white, th, 'lowpass', 2800, 0.8, 0.8, 0.001, 0.016);
  noiseHit(v, v.bank.white, th, 'bandpass', 1300, 1.2, 0.5, 0.0005, 0.008);
  thump(v, th, 175, 62, 0.09, 0.8, 0.035);
}

/** Someone hitting the ground (delayed by `delay` s after the blow). */
export function bodyFall(v: Voice, delay: number): void {
  const t = v.t + delay;
  noiseHit(v, v.bank.brown, t, 'lowpass', 500, 0.7, 0.8, 0.004, 0.04);
  thump(v, t, 95, 50, 0.06, 0.5, 0.04);
}

/** A pedestrian bouncing off a car: body thud plus a little panel crunch. */
export function bodyHit(v: Voice): void {
  const t = v.t;
  thump(v, t, 120, 48, 0.1, 0.9, 0.05);
  noiseHit(v, v.bank.white, t, 'lowpass', 1600, 0.8, 0.6, 0.002, 0.035);
  noiseHit(v, v.bank.white, t + 0.01, 'bandpass', 900, 1, 0.3, 0.002, 0.03);
}

// --- Cars ---

/**
 * A crash scaled by impact speed (m/s): a low thump and crunch for bumps,
 * crumpling metal and ringing panels for big hits, shattering glass on top.
 */
export function crash(v: Voice, impact: number, carOnCar: boolean): void {
  const t = v.t;
  const k = clamp01((impact - 3) / 17);
  thump(v, t, 95 + 25 * k, 40, 0.22, 0.45 + 0.45 * k, 0.05 + 0.06 * k);

  // Crumple: a band of noise whose level re-bumps a few times as panels give.
  const len = 0.25 + 0.6 * k;
  const n = v.noise(v.bank.white, t, t + len + 0.3);
  const bp = v.filter('bandpass', rnd(650, 1100), 0.9);
  const lp = v.filter('lowpass', 5200, 0.7);
  sweep(lp.frequency, t, 5200, 900, 0.15 + 0.3 * k);
  const g = v.gain();
  v.chain(n, bp, lp, g, v.input);
  const a = 0.75 * (0.35 + 0.65 * k);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(a, t + 0.004);
  g.gain.setTargetAtTime(a * 0.2, t + 0.006, 0.02);
  const bumps = 1 + Math.round(k * 4);
  for (let i = 1; i <= bumps; i++) {
    const at = t + 0.03 * i + rnd(0, 0.03);
    g.gain.setTargetAtTime(a * rnd(0.35, 0.7), at, 0.004);
    g.gain.setTargetAtTime(0, at + 0.012, 0.02 + 0.03 * k);
  }

  if (carOnCar || k > 0.4) {
    const f0 = rnd(240, 360);
    for (const [ratio, peak] of [
      [1, 0.12 + 0.18 * k],
      [2.31, 0.07 + 0.1 * k],
    ] as const) {
      const o = v.osc('sine', f0 * ratio, t, t + 1.4);
      const og = v.gain();
      v.chain(o, og, v.input);
      perc(og.gain, t, peak, 0.002, 0.12 + 0.18 * k);
    }
  }

  if (k > 0.5) {
    // Glass: a burst of tiny impulses ringing through two resonant bands.
    const gl = v.burst(v.bank.glass, t + 0.015, t + 0.9);
    const glass = v.gain();
    for (const [f, q] of [
      [4200 * vary(0.1), 14],
      [6600 * vary(0.1), 16],
    ] as const) {
      const r = v.filter('bandpass', f, q);
      v.chain(gl, r, glass);
    }
    glass.connect(v.input);
    glass.gain.setValueAtTime(0, t);
    glass.gain.setValueAtTime(6 * (k - 0.3), t + 0.015);
    glass.gain.setTargetAtTime(0, t + 0.35, 0.12);
  }
}

/** Overrun pop from the exhaust. */
export function backfire(v: Voice): void {
  const t = v.t;
  noiseHit(v, v.bank.white, t, 'lowpass', 1400 * vary(0.2), 0.8, 0.8, 0.001, 0.012);
  thump(v, t, 95, 50, 0.04, 0.6, 0.02);
}

/** A car door: the latch, then the clunk (opening and closing, as one gesture). */
export function door(v: Voice, open: boolean): void {
  const t = v.t;
  const slam = open ? t + 0.24 : t + 0.02;
  if (open) noiseHit(v, v.bank.white, t, 'highpass', 3000, 0.7, 0.3, 0.0005, 0.004);
  noiseHit(v, v.bank.white, slam, 'lowpass', 650, 0.8, 0.9, 0.002, 0.045);
  thump(v, slam, 90, 52, 0.08, 0.8, 0.05);
  noiseHit(v, v.bank.white, slam, 'bandpass', 2100, 2, 0.2, 0.002, 0.02);
}

/** Carjack: the door wrenched open, a creak, and the driver hitting the tarmac. */
export function carjack(v: Voice): void {
  const t = v.t;
  const n = v.noise(v.bank.pink, t, t + 0.35);
  const bp = v.filter('bandpass', 1800, 1.5);
  sweep(bp.frequency, t, 1800, 600, 0.2);
  const g = v.gain();
  v.chain(n, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.04);
  g.gain.setTargetAtTime(0, t + 0.05, 0.06);
  const creak = v.osc('sawtooth', 140, t, t + 0.3);
  for (let i = 1; i < 6; i++) creak.frequency.setValueAtTime(rnd(110, 190), t + i * 0.03);
  const cf = v.filter('bandpass', 900, 6);
  const cg = v.gain();
  v.chain(creak, cf, cg, v.input);
  perc(cg.gain, t, 0.3, 0.02, 0.06);
  const th = t + 0.2;
  thump(v, th, 160, 60, 0.08, 0.8, 0.04);
  noiseHit(v, v.bank.white, th, 'lowpass', 1500, 0.8, 0.6, 0.002, 0.03);
}

/**
 * The ice cream van's jingle: a little music-box tune (eight notes of a
 * major scale, square-ish and bright, each with a soft octave above) that
 * reads as "ice cream" from down the street.
 */
export function chime(v: Voice): void {
  const t = v.t;
  const tune = [76, 79, 81, 79, 76, 72, 74, 76];
  const step = 0.16;
  const g = v.gain();
  g.gain.value = 0.22;
  const lp = v.filter('lowpass', 3800, 0.6);
  v.chain(lp, g, v.input);
  tune.forEach((midi, i) => {
    const at = t + i * step;
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    for (const [mul, level] of [
      [1, 0.5],
      [2, 0.16],
    ] as const) {
      const o = v.osc('triangle', hz * mul, at, at + step * 1.6);
      const e = v.gain();
      e.gain.setValueAtTime(0, at);
      e.gain.linearRampToValueAtTime(level, at + 0.008);
      e.gain.exponentialRampToValueAtTime(0.001, at + step * 1.5);
      o.connect(e);
      e.connect(lp);
    }
  });
}

/** Car horn: two detuned saws a major third apart through a nasal band. */
export function horn(v: Voice, duration: number): void {
  const t = v.t;
  const p = vary(0.08);
  const bp = v.filter('bandpass', 1000 * p, 0.9);
  const sh = v.shaper(2);
  const g = v.gain();
  for (const hz of [349.2 * p, 440 * p]) {
    const o = v.osc('sawtooth', hz, t, t + duration + 0.1);
    o.detune.value = rnd(-6, 6);
    o.connect(bp);
  }
  v.chain(bp, sh, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.42, t + 0.012);
  g.gain.setValueAtTime(0.42, t + duration);
  g.gain.linearRampToValueAtTime(0, t + duration + 0.05);
}

// --- Explosions ---

/**
 * Explosion: the blast-front crack, a body of brown noise whose filter closes
 * from bright to rumble, a sub drop, a crackling tail and falling debris.
 * `near` (0..1) adds weight up close.
 */
export function explosion(v: Voice, near: number): void {
  const t = v.t;
  const b = v.bank;
  noiseHit(v, b.white, t, 'highpass', 400, 0.6, 0.6 + 0.2 * near, 0.001, 0.025);

  const body = v.noise(b.brown, t, t + 3);
  const lp = v.filter('lowpass', 3800, 0.5);
  sweep(lp.frequency, t, 3800, 160, 1.6);
  const bg = v.gain();
  v.chain(body, lp, bg, v.input);
  perc(bg.gain, t, 0.85, 0.006, 0.45);

  thump(v, t, 82, 26, 1.1, 0.9 + 0.2 * near, 0.42);
  thump(v, t, 160, 60, 0.3, 0.4, 0.08);

  const tail = v.noise(b.crackle, t + 0.12, t + 2.8);
  const tbp = v.filter('bandpass', 1800, 0.6);
  const tg = v.gain();
  v.chain(tail, tbp, tg, v.input);
  tg.gain.setValueAtTime(0, t + 0.12);
  tg.gain.linearRampToValueAtTime(0.6, t + 0.35);
  tg.gain.setTargetAtTime(0, t + 0.6, 0.5);

  // Debris: bits of metal landing.
  const tink = v.osc('sine', 1500, t + 0.3, t + 1.6);
  const kg = v.gain();
  v.chain(tink, kg, v.input);
  const rattle = v.noise(b.crackle, t + 0.3, t + 1.6);
  const rhp = v.filter('highpass', 2500, 0.7);
  const rg = v.gain();
  v.chain(rattle, rhp, rg, v.input);
  for (let i = 0; i < 4; i++) {
    const at = t + 0.35 + rnd(0, 0.85);
    tink.frequency.setValueAtTime(rnd(900, 2400), at);
    perc(kg.gain, at, rnd(0.06, 0.12), 0.001, 0.03);
    perc(rg.gain, at, rnd(0.3, 0.5), 0.002, 0.04);
  }
}

/**
 * A facade giving way (the destruction test): a low rumble of masonry under
 * a closing lowpass, a thump, a crackle of grit, then chunks landing.
 * `size` 0..1 is the crater's share of the largest.
 */
export function crumble(v: Voice, size: number): void {
  const t = v.t;
  const b = v.bank;
  const len = 1.2 + 1.2 * size;
  const body = v.noise(b.brown, t, t + len + 0.4);
  const lp = v.filter('lowpass', 1400, 0.6);
  sweep(lp.frequency, t, 1400, 180, len);
  const bg = v.gain();
  v.chain(body, lp, bg, v.input);
  perc(bg.gain, t, 0.7, 0.01, len * 0.35);

  thump(v, t, 55 + 15 * size, 30, 0.5, 0.5 + 0.4 * size, 0.25);

  const grit = v.noise(b.crackle, t + 0.05, t + len);
  const bp = v.filter('bandpass', 900, 0.8);
  const gg = v.gain();
  v.chain(grit, bp, gg, v.input);
  gg.gain.setValueAtTime(0, t + 0.05);
  gg.gain.linearRampToValueAtTime(0.4, t + 0.2);
  gg.gain.setTargetAtTime(0, t + 0.45, len * 0.25);

  // Chunks landing on the pavement.
  const grains = 6 + Math.round(6 * size);
  for (let i = 0; i < grains; i++) {
    noiseHit(v, b.white, t + rnd(0.15, 1.4), 'bandpass', rnd(600, 2200), 1.4, rnd(0.15, 0.4), 0.001, rnd(0.02, 0.05));
  }
}

/** A high whine after a close blast: your ears ringing. */
export function tinnitus(v: Voice, amount: number): void {
  const t = v.t;
  const o = v.osc('sine', rnd(3900, 4400), t, t + 3);
  const g = v.gain();
  v.chain(o, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.05 * amount, t + 0.08);
  g.gain.setTargetAtTime(0, t + 0.5, 0.6);
}

// --- Pickups, player ---

/** A gun pickup: the action worked twice (slide or pump for the shotgun). */
export function pickupWeapon(v: Voice, kind: WeaponKind): void {
  const t = v.t;
  const heavy = kind === 'shotgun' || kind === 'rocket';
  const second = t + (heavy ? 0.16 : 0.12);
  const n = v.noise(v.bank.white, t, second + 0.15);
  const bp = v.filter('bandpass', heavy ? 2200 : 3400, 3);
  bp.frequency.setValueAtTime(heavy ? 1300 : 1700, second);
  const g = v.gain();
  v.chain(n, bp, g, v.input);
  perc(g.gain, t, 0.9, 0.001, 0.006);
  perc(g.gain, second, 1.2, 0.001, 0.012);
  const ping = v.osc('triangle', heavy ? 1500 : 2200, t, second + 0.25);
  ping.frequency.setValueAtTime(heavy ? 700 : 1100, second);
  const pg = v.gain();
  v.chain(ping, pg, v.input);
  perc(pg.gain, t, 0.2, 0.001, 0.02);
  perc(pg.gain, second, 0.3, 0.001, 0.03);
}

/** An armour pickup: straps ripping tight and a low, solid chime. */
export function pickupArmour(v: Voice): void {
  const t = v.t;
  for (let i = 0; i < 2; i++) {
    const at = t + i * 0.09;
    const n = v.noise(v.bank.white, at, at + 0.12);
    const bp = v.filter('bandpass', 1800 + i * 600, 2.5);
    const g = v.gain();
    v.chain(n, bp, g, v.input);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.5, at + 0.01);
    g.gain.linearRampToValueAtTime(0, at + 0.07);
  }
  [0, 7, 12].forEach((st, i) => {
    const at = t + 0.16 + i * 0.05;
    const o = v.osc('triangle', 330 * semis(st), at, at + 0.8);
    const g = v.gain();
    v.chain(o, g, v.input);
    perc(g.gain, at, 0.22, 0.004, 0.14);
  });
}

/** A health pickup: a bright rising major arpeggio and a little shimmer. */
export function pickupHealth(v: Voice): void {
  const t = v.t;
  [0, 4, 7, 12].forEach((s, i) => {
    const at = t + i * 0.07;
    const o = v.osc('triangle', 880 * semis(s), at, at + 0.9);
    const g = v.gain();
    v.chain(o, g, v.input);
    perc(g.gain, at, 0.24, 0.004, 0.12);
  });
  noiseHit(v, v.bank.white, t + 0.05, 'highpass', 7000, 0.7, 0.07, 0.02, 0.2);
}

/** Weapon switch: a click-clack for a gun, a cloth whoosh for fists. */
export function weaponSwitch(v: Voice, gun: boolean): void {
  const t = v.t;
  if (!gun) {
    const n = v.noise(v.bank.pink, t, t + 0.25);
    const bp = v.filter('bandpass', 700, 1);
    const g = v.gain();
    v.chain(n, bp, g, v.input);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.04);
    g.gain.setTargetAtTime(0, t + 0.05, 0.05);
    return;
  }
  noiseHit(v, v.bank.white, t, 'bandpass', 2800, 2.5, 0.8, 0.001, 0.006);
  noiseHit(v, v.bank.white, t + 0.07, 'bandpass', 2000, 2.5, 1, 0.001, 0.009);
  const o = v.osc('triangle', 1500, t, t + 0.2);
  const g = v.gain();
  v.chain(o, g, v.input);
  perc(g.gain, t + 0.07, 0.1, 0.001, 0.02);
}

/** Taking a hit: a heavy, dull impact (GameAudio also muffles the world for a moment). */
export function hurt(v: Voice, amount: number): void {
  const t = v.t;
  const k = clamp01(amount / 35);
  thump(v, t, 150, 60, 0.15, 0.5 + 0.3 * k, 0.06);
  noiseHit(v, v.bank.brown, t, 'lowpass', 900, 0.7, 0.55, 0.003, 0.05);
}

/** Low-health heartbeat: lub-dub. */
export function heartbeat(v: Voice): void {
  const t = v.t;
  for (const [at, peak] of [
    [t, 0.75],
    [t + 0.16, 0.5],
  ] as const) {
    const o = v.osc('sine', 58, at, at + 0.4);
    const g = v.gain();
    v.chain(o, g, v.input);
    perc(g.gain, at, peak, 0.006, 0.05);
  }
}

/** A footstep: a soft, randomly tuned scuff. */
export function footstep(v: Voice, sprint: boolean): void {
  const t = v.t;
  noiseHit(v, v.bank.pink, t, 'bandpass', rnd(260, 520), 1.3, sprint ? 1.5 : 1.1, 0.002, 0.016);
  noiseHit(v, v.bank.white, t + 0.004, 'highpass', 2500, 0.7, 0.15, 0.004, 0.02);
}

/** WASTED: a slam, a minor chord sagging down like a dying tape machine, and a bell. */
export function wasted(v: Voice, key: number): void {
  const t = v.t;
  thump(v, t, 70, 28, 1, 0.8, 0.35);
  const n = v.noise(v.bank.brown, t, t + 1.6);
  const nlp = v.filter('lowpass', 1200, 0.7);
  sweep(nlp.frequency, t, 1200, 150, 1.2);
  const ng = v.gain();
  v.chain(n, nlp, ng, v.input);
  perc(ng.gain, t, 0.6, 0.004, 0.3);

  const lp = v.filter('lowpass', 2400, 1.5);
  sweep(lp.frequency, t, 2400, 220, 2.4);
  const cg = v.gain();
  v.chain(lp, cg, v.input);
  const root = fold(key, 57);
  for (const s of [0, 3, 7]) {
    for (const d of [-10, 10]) {
      const hz = midiToHz(root + s);
      const o = v.osc('sawtooth', hz, t, t + 3.2);
      o.detune.value = d;
      sweep(o.frequency, t + 0.05, hz, hz * semis(-7), 2.2);
      o.connect(lp);
    }
  }
  cg.gain.setValueAtTime(0, t);
  cg.gain.linearRampToValueAtTime(0.26, t + 0.02);
  cg.gain.setTargetAtTime(0, t + 1.6, 0.4);

  const bell = midiToHz(root + 24);
  for (const [ratio, peak] of [
    [1, 0.18],
    [2.76, 0.07],
  ] as const) {
    const o = v.osc('sine', bell * ratio, t + 0.05, t + 4);
    const g = v.gain();
    v.chain(o, g, v.input);
    perc(g.gain, t + 0.05, peak, 0.002, 0.6);
  }
}

/**
 * BUSTED: handcuffs ratcheting shut and a cell door's clang, under a falling
 * minor stab, like WASTED but colder.
 */
export function busted(v: Voice, key: number): void {
  const t = v.t;
  // Cuffs: a quick run of metallic ticks.
  for (let i = 0; i < 6; i++) {
    noiseHit(v, v.bank.white, t + i * 0.035, 'bandpass', 5200 + i * 300, 9, 0.35, 0.0005, 0.012);
  }
  // The door: an inharmonic clang that rings.
  const clang = t + 0.28;
  thump(v, clang, 120, 60, 0.25, 0.7, 0.2);
  for (const [hz, peak, tau] of [
    [220, 0.16, 0.5],
    [601, 0.1, 0.35],
    [1187, 0.06, 0.25],
    [1712, 0.04, 0.2],
  ] as const) {
    const o = v.osc('square', hz, clang, clang + 2.4);
    const lp = v.filter('lowpass', hz * 3, 1);
    const g = v.gain();
    v.chain(o, lp, g, v.input);
    perc(g.gain, clang, peak, 0.002, tau);
  }
  noiseHit(v, v.bank.white, clang, 'highpass', 3000, 0.8, 0.3, 0.001, 0.08);
  // A cold minor chord, filtered down.
  const lp = v.filter('lowpass', 2000, 1.2);
  sweep(lp.frequency, clang, 2000, 260, 2.2);
  const cg = v.gain();
  v.chain(lp, cg, v.input);
  const root = fold(key, 57);
  for (const s of [0, 3, 10]) {
    const o = v.osc('sawtooth', midiToHz(root + s), clang, clang + 3);
    o.detune.value = rnd(-8, 8);
    o.connect(lp);
  }
  cg.gain.setValueAtTime(0, clang);
  cg.gain.linearRampToValueAtTime(0.2, clang + 0.03);
  cg.gain.setTargetAtTime(0, clang + 1.2, 0.4);
}

/** A Pay 'n' Spray at work: a long hiss of paint with a rattle-can shake at the start. */
export function spray(v: Voice): void {
  const t = v.t;
  for (let i = 0; i < 4; i++) noiseHit(v, v.bank.white, t + i * 0.09, 'bandpass', 2600, 4, 0.25, 0.001, 0.02);
  const n = v.noise(v.bank.white, t + 0.35, t + 2.1);
  const hp = v.filter('highpass', 3500, 0.7);
  const bp = v.filter('peaking', 7000, 1.5);
  bp.gain.value = 6;
  const g = v.gain();
  v.chain(n, hp, bp, g, v.input);
  g.gain.setValueAtTime(0, t + 0.35);
  g.gain.linearRampToValueAtTime(0.22, t + 0.45);
  g.gain.setValueAtTime(0.22, t + 1.9);
  g.gain.linearRampToValueAtTime(0, t + 2.1);
}

/** Back on your feet: a breathy riser into a soft chord. */
export function respawn(v: Voice, key: number): void {
  const t = v.t;
  const n = v.noise(v.bank.pink, t, t + 0.9);
  const bp = v.filter('bandpass', 300, 2);
  sweep(bp.frequency, t, 300, 3500, 0.7);
  const g = v.gain();
  v.chain(n, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.25, t + 0.65);
  g.gain.linearRampToValueAtTime(0, t + 0.75);
  const root = fold(key, 69);
  for (const s of [0, 7, 12]) {
    const o = v.osc('sine', midiToHz(root + s), t + 0.55, t + 2.2);
    const og = v.gain();
    v.chain(o, og, v.input);
    og.gain.setValueAtTime(0, t + 0.55);
    og.gain.linearRampToValueAtTime(0.08, t + 0.75);
    og.gain.setTargetAtTime(0, t + 0.9, 0.25);
  }
}

// --- Score stingers ---

/**
 * A score award, tuned to the music's key: a grace note into a pluck that
 * climbs one minor-pentatonic step per combo multiplier, adding a fifth and an
 * octave sparkle as the chain grows. Each kind has a little signature.
 */
export function award(v: Voice, kind: ScoreKind, multiplier: number, key: number): void {
  const t = v.t;
  const tonic = fold(key, 64);
  const degree = Math.min(9, Math.max(0, multiplier - 1));
  const note = scaleNote(tonic, SCALES.pentatonicMinor, degree);
  const grace = scaleNote(tonic, SCALES.pentatonicMinor, degree - 1);
  if (kind === 'nearMiss') {
    const n = v.noise(v.bank.white, t, t + 0.2);
    const bp = v.filter('bandpass', 1200, 2);
    sweep(bp.frequency, t, 1200, 3800, 0.12);
    const g = v.gain();
    v.chain(n, bp, g, v.input);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.08);
    g.gain.linearRampToValueAtTime(0, t + 0.13);
  }
  if (kind === 'knockout') thump(v, t, 420, 170, 0.08, 0.35, 0.04);
  const at = t + 0.035;
  pluck(v, t, grace, 0.12, 0.05);
  pluck(v, at, note, 0.22, 0.12, 5200, kind === 'drift' ? -3 : 0);
  if (multiplier >= 4) pluck(v, at + 0.06, note + 7, 0.12, 0.12);
  if (multiplier >= 7) pluck(v, at + 0.12, note + 12, 0.1, 0.16, 7000);
}

/** KABOOM: a brassy minor stab, a timpani hit and a cymbal. */
export function bigSting(v: Voice, key: number): void {
  const t = v.t;
  const root = fold(key, 57);
  const lp = v.filter('lowpass', 400, 2);
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.exponentialRampToValueAtTime(5000, t + 0.04);
  lp.frequency.exponentialRampToValueAtTime(800, t + 0.45);
  const g = v.gain();
  v.chain(lp, g, v.input);
  for (const s of [0, 7, 12, 15]) {
    const o = v.osc('sawtooth', midiToHz(root + s), t, t + 1.4);
    o.detune.value = rnd(-8, 8);
    o.connect(lp);
  }
  perc(g.gain, t, 0.16, 0.005, 0.22);
  thump(v, t, 110, 55, 0.2, 0.7, 0.15);
  noiseHit(v, v.bank.white, t, 'highpass', 5000, 0.6, 0.25, 0.002, 0.35);
}

/** NEW BEST: a major fanfare up to a held chord. */
export function fanfare(v: Voice, key: number): void {
  const t = v.t;
  const root = fold(key, 69);
  [0, 4, 7, 12].forEach((s, i) => pluck(v, t + i * 0.085, root + s, 0.2, 0.14, 6000));
  const end = t + 0.34;
  const lp = v.filter('lowpass', 3500, 0.8);
  const g = v.gain();
  v.chain(lp, g, v.input);
  for (const s of [12, 16, 19]) {
    const o = v.osc('sawtooth', midiToHz(root + s), end, end + 1.6);
    o.detune.value = rnd(-6, 6);
    o.connect(lp);
  }
  g.gain.setValueAtTime(0, end);
  g.gain.linearRampToValueAtTime(0.13, end + 0.02);
  g.gain.setTargetAtTime(0, end + 0.45, 0.22);
  noiseHit(v, v.bank.white, end, 'highpass', 6500, 0.6, 0.12, 0.004, 0.4);
}

// --- UI ---

export type UiSound = 'click' | 'confirm' | 'back' | 'countdown' | 'go' | 'success' | 'fail' | 'cash' | 'star' | 'ring';

export function ui(v: Voice, kind: UiSound, key: number): void {
  const t = v.t;
  const root = fold(key, 69);
  switch (kind) {
    case 'click': {
      const o = v.osc('sine', 1900, t, t + 0.06);
      const g = v.gain();
      v.chain(o, g, v.input);
      perc(g.gain, t, 0.22, 0.001, 0.008);
      noiseHit(v, v.bank.white, t, 'highpass', 4000, 0.7, 0.08, 0.0005, 0.003);
      return;
    }
    case 'confirm':
      pluck(v, t, root + 7, 0.16, 0.07);
      pluck(v, t + 0.07, root + 14, 0.18, 0.1);
      return;
    case 'back':
      pluck(v, t, root + 14, 0.12, 0.06);
      pluck(v, t + 0.07, root + 7, 0.12, 0.08);
      return;
    case 'countdown':
    case 'go': {
      const go = kind === 'go';
      const len = go ? 0.45 : 0.12;
      const lp = v.filter('lowpass', go ? 4000 : 3000, 0.7);
      const g = v.gain();
      v.chain(lp, g, v.input);
      v.osc('square', go ? 1760 : 880, t, t + len + 0.05).connect(lp);
      if (go) v.osc('triangle', 880, t, t + len + 0.05).connect(lp);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(go ? 0.24 : 0.2, t + 0.005);
      g.gain.setValueAtTime(go ? 0.24 : 0.2, t + len);
      g.gain.linearRampToValueAtTime(0, t + len + 0.03);
      return;
    }
    case 'success':
      [0, 4, 7, 12].forEach((s, i) => pluck(v, t + i * 0.08, root + s, 0.18, i === 3 ? 0.3 : 0.1, 6000));
      noiseHit(v, v.bank.white, t + 0.24, 'highpass', 7000, 0.6, 0.08, 0.01, 0.3);
      return;
    case 'fail': {
      [7, 3, 0].forEach((s, i) => pluck(v, t + i * 0.12, root + s - 12, 0.16, i === 2 ? 0.25 : 0.1, 2500));
      const o = v.osc('sawtooth', 110, t + 0.24, t + 1.2);
      const lp = v.filter('lowpass', 600, 0.7);
      const g = v.gain();
      v.chain(o, lp, g, v.input);
      perc(g.gain, t + 0.24, 0.2, 0.01, 0.2);
      return;
    }
    case 'cash': {
      noiseHit(v, v.bank.white, t, 'bandpass', 1500, 2, 0.35, 0.001, 0.008);
      const bell = t + 0.06;
      for (const [ratio, peak] of [
        [1, 0.16],
        [2, 0.08],
        [2.76, 0.06],
        [3.9, 0.04],
      ] as const) {
        const o = v.osc('sine', 2093 * ratio, bell, bell + 1.8);
        const g = v.gain();
        v.chain(o, g, v.input);
        perc(g.gain, bell, peak, 0.002, 0.25);
      }
      const coins = v.burst(v.bank.glass, bell, bell + 0.8);
      const bp = v.filter('bandpass', 7000, 6);
      const cg = v.gain();
      v.chain(coins, bp, cg, v.input);
      cg.gain.setValueAtTime(1.5, bell);
      cg.gain.setTargetAtTime(0, bell + 0.2, 0.1);
      return;
    }
    case 'ring': {
      // A payphone's bell: two bursts of a struck pair of tones, rattled by a
      // 20 Hz clapper (an LFO on the gain), "brrring-brrring".
      for (const at of [t, t + 0.55]) {
        const g = v.gain();
        const lp = v.filter('lowpass', 5200, 0.8);
        v.chain(lp, g, v.input);
        for (const hz of [1180, 1480]) v.osc('triangle', hz, at, at + 0.45).connect(lp);
        const lfo = v.osc('square', 20, at, at + 0.45);
        const depth = v.gain(0.05);
        lfo.connect(depth);
        depth.connect(g.gain);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.06, at + 0.01);
        g.gain.setValueAtTime(0.06, at + 0.36);
        g.gain.linearRampToValueAtTime(0, at + 0.44);
      }
      return;
    }
    case 'star': {
      const lp = v.filter('lowpass', 900, 1);
      const g = v.gain();
      v.chain(lp, g, v.input);
      for (const s of [-12, -5]) v.osc('sawtooth', midiToHz(root + s - 12), t, t + 2.4).connect(lp);
      perc(g.gain, t, 0.3, 0.005, 0.32);
      const o = v.osc('sine', midiToHz(root + 24), t, t + 2.6);
      const og = v.gain();
      v.chain(o, og, v.input);
      perc(og.gain, t, 0.1, 0.002, 0.38);
      return;
    }
  }
}

/** Far-off city life for the ambient bed: a car swishing past somewhere. */
export function carPass(v: Voice): void {
  const t = v.t;
  const len = rnd(1.6, 2.6);
  const n = v.noise(v.bank.pink, t, t + len + 0.1);
  const bp = v.filter('bandpass', 500, 1.2);
  sweep(bp.frequency, t, rnd(500, 700), rnd(250, 350), len);
  const g = v.gain();
  v.chain(n, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1.4, t + len * 0.5);
  g.gain.linearRampToValueAtTime(0, t + len);
}

/** A siren wailing somewhere across town, fading in and out. */
export function distantSiren(v: Voice): void {
  const t = v.t;
  const len = rnd(4, 6.5);
  const o = v.osc('sawtooth', 900, t, t + len + 0.1);
  const lfo = v.osc('triangle', 0.24, t, t + len + 0.1);
  const depth = v.gain(380);
  v.chain(lfo, depth);
  depth.connect(o.frequency);
  const bp = v.filter('bandpass', 1300, 1);
  const g = v.gain();
  v.chain(o, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.35, t + len * 0.45);
  g.gain.linearRampToValueAtTime(0, t + len);
}
