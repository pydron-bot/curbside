/**
 * One-shot sound recipes. Each builds its graph into a Voice (which handles
 * placement, level and cleanup) starting at `v.t`. Everything is synthesised
 * from oscillators and the shared noise buffers; small random variations keep
 * repeated sounds (an SMG burst, footsteps) from sounding machine-gunned.
 */
import type { ScoreKind } from '../systems/score';
import type { WeaponKind } from '../systems/weapons';
import { ALARM_CYCLE } from '../systems/emergency';
import { clamp01, semis } from './mix';
import type { KitPart } from './music/drumKit';
import { bustedSting, wastedSting, type Sting, type StingDrum, type StingNote } from './music/stings';
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

/**
 * The air horn (W3-B): a blast of compressed air through a brass reed, a
 * loud, slightly sour chord (three saws a minor third and a fourth apart)
 * that bends up into pitch as the pressure arrives, with the hiss of the
 * valve opening under it. ~0.8 s.
 */
export function airHorn(v: Voice): void {
  const t = v.t;
  const len = 0.75;
  const p = vary(0.04);
  const bp = v.filter('bandpass', 1200 * p, 0.7);
  const sh = v.shaper(3);
  const g = v.gain();
  for (const hz of [466 * p, 554 * p, 740 * p]) {
    const o = v.osc('sawtooth', hz * 0.9, t, t + len + 0.1);
    o.frequency.setValueAtTime(hz * 0.9, t);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.06);
    o.detune.value = rnd(-10, 10);
    o.connect(bp);
  }
  v.chain(bp, sh, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.55, t + 0.025);
  g.gain.setValueAtTime(0.5, t + len - 0.1);
  g.gain.linearRampToValueAtTime(0, t + len);
  noiseHit(v, v.bank.white, t, 'highpass', 3000, 0.7, 0.18, 0.005, 0.05);
}

/**
 * A taser (W3-B): the cartridge's nitrogen pop and a snap of the doors,
 * then, if the darts land, ~0.8 s of the current: a dry, fast ticking
 * crackle (one noise source gated ~20 times a second, each tick a little
 * different) over a thin electrical buzz.
 */
export function taser(v: Voice, hit: boolean): void {
  const t = v.t;
  const p = vary(0.05);
  noiseHit(v, v.bank.white, t, 'bandpass', 2600 * p, 0.9, 0.55, 0.001, 0.012);
  thump(v, t, 320 * p, 120, 0.04, 0.3, 0.015, 'triangle');
  if (!hit) return;
  const start = t + 0.05;
  const len = 0.8;
  const n = v.noise(v.bank.white, start, start + len + 0.05);
  const hp = v.filter('highpass', 2200 * p, 0.8);
  const ticks = v.gain();
  v.chain(n, hp, ticks, v.input);
  ticks.gain.setValueAtTime(0, start);
  for (let at = start; at < start + len; at += 0.045 + Math.random() * 0.012) {
    const peak = (0.35 + Math.random() * 0.35) * (1 - (at - start) / (len * 1.6));
    ticks.gain.setValueAtTime(peak, at);
    ticks.gain.setTargetAtTime(0, at + 0.002, 0.006);
  }
  const buzz = v.osc('sawtooth', 110 * p, start, start + len + 0.05);
  const bp = v.filter('bandpass', 1800, 2);
  const bg = v.gain();
  v.chain(buzz, bp, bg, v.input);
  bg.gain.setValueAtTime(0, start);
  bg.gain.linearRampToValueAtTime(0.12, start + 0.02);
  bg.gain.setValueAtTime(0.1, start + len - 0.08);
  bg.gain.linearRampToValueAtTime(0, start + len);
}

/**
 * A stinger (W3-B) going down: it hits the tarmac and the hinged sections
 * slap out one after another, a run of tinny clanks with a little ring to
 * them, quickening as it unrolls. ~0.45 s.
 */
export function stingerDown(v: Voice): void {
  const t = v.t;
  const b = v.bank;
  noiseHit(v, b.brown, t, 'lowpass', 900, 0.7, 0.6, 0.002, 0.03);
  let at = t + 0.05;
  for (let i = 0; i < 6; i++) {
    noiseHit(v, b.white, at, 'bandpass', rnd(2200, 3400), 2.5, 0.5 - i * 0.05, 0.0008, 0.012);
    const o = v.osc('triangle', rnd(1900, 2900), at, at + 0.12);
    const g = v.gain();
    v.chain(o, g, v.input);
    perc(g.gain, at, 0.08, 0.001, 0.02);
    at += 0.075 - i * 0.008;
  }
}

/**
 * Tyres bursting on a stinger: a sharp double bang (front, then rear) with
 * a thump under it, a hiss of air, then the shredded rubber flapping round,
 * slowing as the car does. `speed` (m/s) quickens the flaps. ~1.3 s.
 */
export function tyresBurst(v: Voice, speed: number): void {
  const t = v.t;
  const b = v.bank;
  const k = clamp01(speed / 25);
  for (const at of [t, t + rnd(0.06, 0.12)]) {
    noiseHit(v, b.white, at, 'highpass', 1800, 0.7, 0.9, 0.0005, 0.018);
    thump(v, at, 160, 55, 0.08, 0.6, 0.04);
  }
  noiseHit(v, b.white, t + 0.02, 'bandpass', 5200, 0.8, 0.25, 0.01, 0.12);
  // The flaps: a rubbery slap per wheel turn, spacing out as it slows.
  let gap = 0.05 + 0.06 * (1 - k);
  let at = t + 0.18;
  let level = 0.45;
  while (at < t + 1.3) {
    noiseHit(v, b.brown, at, 'bandpass', rnd(300, 450), 1.2, level, 0.002, 0.018);
    at += gap;
    gap *= 1.08;
    level *= 0.94;
  }
}

/**
 * One cycle (ALARM_CYCLE s) of a car alarm through its little horn speaker:
 * pattern 0 whoops (rising sweeps), 1 a hi-lo two-tone, 2 chirps then two
 * honks. Repeated by the street event while it sounds.
 */
export function carAlarm(v: Voice, pattern: number): void {
  const t = v.t;
  const end = t + ALARM_CYCLE;
  const bp = v.filter('bandpass', 1500, 0.8);
  const sh = v.shaper(2.5);
  const g = v.gain();
  v.chain(bp, sh, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.3, t + 0.01);
  g.gain.setValueAtTime(0.3, end - 0.03);
  g.gain.linearRampToValueAtTime(0, end);
  if (pattern === 0) {
    const o = v.osc('sawtooth', 500, t, end);
    for (let i = 0; i < 4; i++) sweep(o.frequency, t + i * 0.4, 480, 1500, 0.38);
    o.connect(bp);
  } else if (pattern === 1) {
    const o = v.osc('square', 1050, t, end);
    for (let i = 0; i < 8; i++) o.frequency.setValueAtTime(i % 2 ? 760 : 1050, t + i * 0.2);
    o.connect(bp);
  } else {
    // Chirps, then the car's own horn twice.
    const o = v.osc('square', 1800, t, t + 0.6);
    const k = v.gain(0);
    for (let i = 0; i < 4; i++) {
      k.gain.setValueAtTime(1, t + i * 0.14);
      k.gain.setValueAtTime(0, t + i * 0.14 + 0.07);
    }
    v.chain(o, k, bp);
    for (let n = 0; n < 2; n++) {
      const at = t + 0.7 + n * 0.45;
      const e = v.gain(0);
      e.gain.setValueAtTime(0, at);
      e.gain.linearRampToValueAtTime(0.9, at + 0.01);
      e.gain.setValueAtTime(0.9, at + 0.3);
      e.gain.linearRampToValueAtTime(0, at + 0.33);
      for (const hz of [349.2, 440]) {
        const h = v.osc('sawtooth', hz, at, at + 0.35);
        h.connect(e);
      }
      e.connect(bp);
    }
  }
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

/** WASTED: a slam, the theme's hook over a minor chord sagging like a dying tape machine (stings.ts), and a bell. */
export function wasted(v: Voice, key: number): void {
  const t = v.t;
  thump(v, t, 70, 28, 1, 0.8, 0.35);
  const n = v.noise(v.bank.brown, t, t + 1.6);
  const nlp = v.filter('lowpass', 1200, 0.7);
  sweep(nlp.frequency, t, 1200, 150, 1.2);
  const ng = v.gain();
  v.chain(n, nlp, ng, v.input);
  perc(ng.gain, t, 0.6, 0.004, 0.3);

  // Heavy: as loud as the chord it replaced.
  playSting(v, wastedSting(key), NO_KIT, 1.6);

  const bell = midiToHz(fold(key, 57) + 24);
  for (const [ratio, peak] of [
    [1, 0.12],
    [2.76, 0.05],
  ] as const) {
    const o = v.osc('sine', bell * ratio, t + 0.05, t + 4);
    const g = v.gain();
    v.chain(o, g, v.input);
    perc(g.gain, t + 0.05, peak, 0.002, 0.6);
  }
}

/**
 * BUSTED: handcuffs ratcheting shut and a cell door's clang, then the hook
 * on a cold square sinking to the flat fifth (stings.ts), like WASTED but colder.
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
  playSting(v, bustedSting(key));
}

/**
 * A record scratch: the boombox's music dragged back and forth under a hand
 * (a pitched buzz and a band of noise swept down, up, down) and stopped dead.
 */
export function recordScratch(v: Voice): void {
  const t = v.t;
  const o = v.osc('sawtooth', 300, t, t + 0.4);
  const f = o.frequency;
  f.setValueAtTime(320, t);
  f.exponentialRampToValueAtTime(90, t + 0.09);
  f.exponentialRampToValueAtTime(420, t + 0.16);
  f.exponentialRampToValueAtTime(60, t + 0.32);
  const bp = v.filter('bandpass', 1400, 1.1);
  const b = bp.frequency;
  b.setValueAtTime(1600, t);
  b.exponentialRampToValueAtTime(500, t + 0.09);
  b.exponentialRampToValueAtTime(2200, t + 0.16);
  b.exponentialRampToValueAtTime(300, t + 0.32);
  const n = v.noise(v.bank.white, t, t + 0.4);
  const ng = v.gain(0.9);
  v.chain(n, ng, bp);
  const og = v.gain(0.25);
  v.chain(o, og, bp);
  const g = v.gain();
  v.chain(bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.55, t + 0.01);
  g.gain.setValueAtTime(0.4, t + 0.09);
  g.gain.linearRampToValueAtTime(0.6, t + 0.13);
  g.gain.setTargetAtTime(0, t + 0.3, 0.025);
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
 * climbs one pentatonic step (minor, or major in a major key: the radio plays
 * on under it) per combo multiplier, adding a fifth and an octave sparkle as
 * the chain grows. Each kind has a little signature.
 */
export function award(v: Voice, kind: ScoreKind, multiplier: number, key: number, major = false): void {
  const t = v.t;
  const tonic = fold(key, 64);
  const degree = Math.min(9, Math.max(0, multiplier - 1));
  const scale = major ? SCALES.pentatonicMajor : SCALES.pentatonicMinor;
  const note = scaleNote(tonic, scale, degree);
  const grace = scaleNote(tonic, scale, degree - 1);
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

/** KABOOM: a brassy stab (minor, or major in a major key), a timpani hit and a cymbal. */
export function bigSting(v: Voice, key: number, major = false): void {
  const t = v.t;
  const root = fold(key, 57);
  const tenth = major ? 16 : 15;
  const lp = v.filter('lowpass', 400, 2);
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.exponentialRampToValueAtTime(5000, t + 0.04);
  lp.frequency.exponentialRampToValueAtTime(800, t + 0.45);
  const g = v.gain();
  v.chain(lp, g, v.input);
  for (const s of [0, 7, 12, tenth]) {
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

/** A named-mayhem stamp: the thunk of a rubber stamp, then a quick bright chord climbing on top. */
export function stamp(v: Voice, key: number, major = false): void {
  const t = v.t;
  thump(v, t, 150, 55, 0.1, 0.75, 0.1);
  noiseHit(v, v.bank.white, t, 'bandpass', 1500, 1.1, 0.4, 0.001, 0.05);
  const root = fold(key, 64);
  const third = major ? 4 : 3;
  const notes = [0, third, 7, 12];
  for (let i = 0; i < notes.length; i++) pluck(v, t + 0.05 + i * 0.035, root + notes[i], 0.16, 0.2, 6500);
}

// --- Theme stings ---

/** Where a sting's drums come from: a take of the radio's kit, or null for the synth stand-ins. */
export type KitSource = (part: KitPart) => AudioBuffer | null;
const NO_KIT: KitSource = () => null;

const STING_WAVE = { saw: 'sawtooth', square: 'square', flute: 'triangle' } as const;
// The hook leads; the kit sits under it as it does on the radio (where it plays at half level).
const STING_LEAD = 0.17;
const STING_BASS = 0.15;
const STING_CHORD = 0.2;
const STING_DRUM = 0.4;
const STING_RISER = 0.35;

/**
 * Play a sting score (music/stings.ts) from v.t. The lead and the bass are
 * one gliding synth each for all their notes (a few nodes, not a set per
 * note), chords are saw stacks under a closing filter, drums are takes of
 * the radio's kit when there is one, plus an optional riser and a
 * tape-stop sag over everything pitched. `level` scales the lot.
 */
export function playSting(v: Voice, s: Sting, kit: KitSource = NO_KIT, level = 1): void {
  const t0 = v.t;
  const end = t0 + s.length;
  const sagged: OscillatorNode[] = [];
  // The mono synths stop soon after their last note (the echo rings on without them).
  const until = (notes: readonly { t: number; len: number }[]) => t0 + notes.reduce((e, n) => Math.max(e, n.t + n.len), 0) + 0.4;

  if (s.melody.length > 0) {
    const first = midiToHz(s.melody[0].note);
    const stop = until(s.melody);
    const lp = v.filter('lowpass', s.lead === 'flute' ? 2600 : 4200, 0.8);
    const g = v.gain();
    v.chain(lp, g, v.input);
    const oscs = [v.osc(STING_WAVE[s.lead], first, t0, stop)];
    // The saw gets a detuned twin: the theme's fat lead.
    if (s.lead === 'saw') oscs.push(v.osc('sawtooth', first, t0, stop));
    for (let i = 0; i < oscs.length; i++) {
      if (oscs.length > 1) oscs[i].detune.value = i === 0 ? -8 : 8;
      oscs[i].connect(lp);
      sagged.push(oscs[i]);
    }
    const lead = level * STING_LEAD * (s.lead === 'flute' ? 1.6 : s.lead === 'square' ? 0.85 : 1);
    for (let i = 0; i < s.melody.length; i++) {
      const n = s.melody[i];
      const at = t0 + n.t;
      const hz = midiToHz(n.note);
      for (const o of oscs) o.frequency.setTargetAtTime(hz, at, n.glide ?? 0.005);
      g.gain.setTargetAtTime(lead * n.vel, at, s.lead === 'flute' ? 0.02 : 0.005);
      // A note that runs into the next is slurred into it: its release would cut the next one short.
      if (releases(s.melody, i, 0.9)) g.gain.setTargetAtTime(0, at + n.len * 0.9, s.lead === 'flute' ? 0.06 : 0.035);
    }
    if (s.echo > 0) {
      const d = v.track(v.ctx.createDelay(1));
      d.delayTime.value = Math.min(0.95, s.echo);
      const damp = v.filter('lowpass', 2400, 0.5);
      const fb = v.gain(0.35);
      const wet = v.gain(0.45);
      v.chain(g, d, damp, fb, d);
      v.chain(damp, wet, v.input);
    }
  }

  if (s.bass.length > 0) {
    const first = midiToHz(s.bass[0].note);
    const stop = until(s.bass);
    const a = v.osc('sawtooth', first, t0, stop);
    const sub = v.osc('sine', first / 2, t0, stop);
    const lp = v.filter('lowpass', 300, 1.5);
    const subGain = v.gain(0.7);
    const g = v.gain();
    v.chain(a, lp, g, v.input);
    v.chain(sub, subGain, g);
    sagged.push(a, sub);
    for (let i = 0; i < s.bass.length; i++) {
      const n = s.bass[i];
      const at = t0 + n.t;
      const hz = midiToHz(n.note);
      a.frequency.setTargetAtTime(hz, at, n.glide ?? 0.004);
      sub.frequency.setTargetAtTime(hz / 2, at, n.glide ?? 0.004);
      g.gain.setTargetAtTime(level * STING_BASS * n.vel, at, 0.004);
      if (releases(s.bass, i, 0.88)) g.gain.setTargetAtTime(0, at + n.len * 0.88, 0.04);
      // Filter pluck: opens on the note and closes over it.
      lp.frequency.setValueAtTime(300 + 1300 * n.vel, at);
      lp.frequency.setTargetAtTime(300, at + 0.005, 0.1);
    }
  }

  for (const c of s.chords) {
    const at = t0 + c.t;
    const stop = at + c.len + 0.9;
    const lp = v.filter('lowpass', 3200, 1.2);
    lp.frequency.setValueAtTime(3200, at);
    lp.frequency.exponentialRampToValueAtTime(700, at + Math.max(0.15, c.len));
    const g = v.gain();
    v.chain(lp, g, v.input);
    c.notes.forEach((note, i) => {
      const o = v.osc('sawtooth', midiToHz(note), at, stop);
      o.detune.value = i % 2 === 0 ? -7 : 7;
      o.connect(lp);
      sagged.push(o);
    });
    const peak = (level * STING_CHORD * c.vel) / Math.sqrt(c.notes.length);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.004);
    g.gain.setTargetAtTime(peak * 0.55, at + 0.01, 0.15);
    g.gain.setTargetAtTime(0, at + c.len, 0.12);
  }

  for (const h of s.drums) {
    const at = t0 + h.t;
    const take = kit(h.part);
    if (take) {
      const hg = v.gain(level * STING_DRUM * h.vel);
      v.chain(v.burst(take, at, undefined, 0), hg, v.input);
    } else {
      stingDrum(v, h.part, at, level * h.vel);
    }
  }

  const r = s.riser;
  if (r) {
    const at = t0 + r.t;
    const stop = at + r.len;
    const g = v.gain();
    g.connect(v.input);
    g.gain.setValueAtTime(level * STING_RISER * r.level[0], at);
    g.gain.linearRampToValueAtTime(level * STING_RISER * r.level[1], stop - 0.01);
    g.gain.linearRampToValueAtTime(0, stop + 0.02);
    const n = v.noise(v.bank.pink, at, stop + 0.03);
    const bp = v.filter('bandpass', midiToHz(r.from + 24), 2);
    sweep(bp.frequency, at, midiToHz(r.from + 24), midiToHz(r.to + 24), r.len);
    v.chain(n, bp, g);
    const o = v.osc('sawtooth', midiToHz(r.from), at, stop + 0.03);
    sweep(o.frequency, at, midiToHz(r.from), midiToHz(r.to), r.len);
    const olp = v.filter('lowpass', 1800, 0.7);
    const og = v.gain(0.4);
    v.chain(o, olp, og, g);
  }

  if (s.sag) {
    const at = t0 + s.sag.t;
    for (const o of sagged) {
      const base = o.detune.value;
      o.detune.setValueAtTime(base, at);
      o.detune.linearRampToValueAtTime(base + s.sag.semis * 100, at + s.sag.len);
    }
  }
  v.until(end);
}

/** A mono part's note `i` gets a release (at `hold` of its length) only when that falls before the next note starts. */
function releases(notes: readonly StingNote[], i: number, hold: number): boolean {
  const next = notes[i + 1];
  return !next || notes[i].t + notes[i].len * hold < next.t;
}

/** Synth drums for a sting when the radio's kit isn't rendered yet. */
function stingDrum(v: Voice, part: StingDrum, at: number, vel: number): void {
  switch (part) {
    case 'kick':
      thump(v, at, 150, 48, 0.07, 0.85 * vel, 0.14);
      return;
    case 'snare':
      noiseHit(v, v.bank.white, at, 'bandpass', 1800, 0.7, 0.55 * vel, 0.002, 0.07);
      thump(v, at, 220, 180, 0.05, 0.3 * vel, 0.04, 'triangle');
      return;
    case 'clap':
      noiseHit(v, v.bank.white, at, 'bandpass', 1150, 1.4, 0.5 * vel, 0.001, 0.05);
      return;
    case 'hat':
      noiseHit(v, v.bank.white, at, 'highpass', 7500, 0.7, 0.18 * vel, 0.0005, 0.02);
      return;
    case 'crash':
      noiseHit(v, v.bank.white, at, 'highpass', 4200, 0.5, 0.22 * vel, 0.002, 0.45);
      return;
  }
}

// --- UI ---

export type UiSound = 'click' | 'confirm' | 'back' | 'countdown' | 'go' | 'success' | 'fail' | 'cash' | 'star' | 'ring';

/** `key` and `major`: the music's, so the pitched ones sit in it. */
export function ui(v: Voice, kind: UiSound, key: number, major = false): void {
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
      // Down from the fifth through the minor third; in a major key (the radio plays on) through the fourth instead.
      [7, major ? 5 : 3, 0].forEach((s, i) => pluck(v, t + i * 0.12, root + s - 12, 0.16, i === 2 ? 0.25 : 0.1, 2500));
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

/**
 * A dog's bark: a gruff saw dropping in pitch through a throaty band, with
 * a breath of noise on the attack; now and then a second "woof" after it.
 */
export function bark(v: Voice): void {
  const n = Math.random() < 0.35 ? 2 : 1;
  const p = vary(0.12);
  for (let i = 0; i < n; i++) {
    const at = v.t + i * rnd(0.16, 0.22);
    const o = v.osc('sawtooth', 380 * p, at, at + 0.2);
    sweep(o.frequency, at, 420 * p, 190 * p, 0.12);
    const bp = v.filter('bandpass', 760 * p, 1.6);
    const g = v.gain();
    v.chain(o, bp, g, v.input);
    perc(g.gain, at, 0.9, 0.006, 0.045);
    noiseHit(v, v.bank.white, at, 'bandpass', 1400 * p, 1.2, 0.35, 0.003, 0.025);
  }
}

/** A dog's yelp (hit, or bolting from a gunshot): a high whine that rises and falls away. */
export function yelp(v: Voice): void {
  const t = v.t;
  const p = vary(0.1);
  const o = v.osc('triangle', 900 * p, t, t + 0.4);
  o.frequency.setValueAtTime(900 * p, t);
  o.frequency.linearRampToValueAtTime(1350 * p, t + 0.06);
  o.frequency.exponentialRampToValueAtTime(620 * p, t + 0.3);
  const bp = v.filter('bandpass', 1300 * p, 1.1);
  const g = v.gain();
  v.chain(o, bp, g, v.input);
  perc(g.gain, t, 0.7, 0.01, 0.07);
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

/** TAKE THE HEAT: a patrol car's short whoop, up and back down, as the chase swings onto you. */
export function sirenWhoop(v: Voice): void {
  const t = v.t;
  const o = v.osc('sawtooth', 620, t, t + 0.75);
  o.frequency.setValueAtTime(620, t);
  o.frequency.exponentialRampToValueAtTime(1500, t + 0.32);
  o.frequency.exponentialRampToValueAtTime(700, t + 0.7);
  const bp = v.filter('bandpass', 1300, 1.2);
  const g = v.gain();
  v.chain(o, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.05);
  g.gain.setValueAtTime(0.5, t + 0.55);
  g.gain.linearRampToValueAtTime(0, t + 0.72);
}

// --- The city's incidents (V2) ---

/** A struck bell: inharmonic partials over `hz`, each dying away (a handbell, a church bell). */
function bell(v: Voice, at: number, hz: number, peak: number, decay: number, partials: readonly (readonly [number, number])[]): void {
  for (const [mul, level] of partials) {
    const o = v.osc('sine', hz * mul, at, at + decay * 4);
    const g = v.gain();
    v.chain(o, g, v.input);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak * level, at + 0.004);
    g.gain.setTargetAtTime(0, at + 0.004, (decay * level) / (level + 0.3));
  }
}

/** Cash spilling: a rustle of notes and a scatter of coins ringing on the tarmac. */
export function cashSpill(v: Voice): void {
  const t = v.t;
  const n = v.noise(v.bank.pink, t, t + 0.5);
  const bp = v.filter('bandpass', 3200, 1.4);
  const g = v.gain();
  v.chain(n, bp, g, v.input);
  perc(g.gain, t, 0.35, 0.02, 0.09);
  for (let i = 0; i < 7; i++) {
    const at = t + 0.03 + Math.random() * 0.45;
    const hz = rnd(2400, 4200);
    const o = v.osc('sine', hz, at, at + 0.2);
    const og = v.gain();
    v.chain(o, og, v.input);
    perc(og.gain, at, 0.18, 0.001, 0.03);
  }
}

/** Last orders at the kebab shop: a hand bell rung twice. */
export function lastOrders(v: Voice): void {
  const hz = 1150 * vary(0.04);
  const partials = [
    [1, 1],
    [2.76, 0.45],
    [5.4, 0.2],
  ] as const;
  bell(v, v.t, hz, 0.32, 0.35, partials);
  bell(v, v.t + 0.32, hz, 0.28, 0.4, partials);
}

/** A funeral's bell: one slow, low toll from somewhere up the street. */
export function toll(v: Voice): void {
  bell(v, v.t, 196, 0.42, 1.6, [
    [0.5, 0.5],
    [1, 1],
    [1.19, 0.4],
    [1.5, 0.35],
    [2, 0.3],
    [2.74, 0.15],
  ]);
}

/** A burst hydrant gushing: a roar of white water with a low rumble under it. */
export function gush(v: Voice): void {
  const t = v.t;
  const len = 1.9;
  const n = v.noise(v.bank.white, t, t + len + 0.1);
  const hp = v.filter('highpass', 1300, 0.6);
  const bp = v.filter('peaking', 4200, 1);
  bp.gain.value = 5;
  const g = v.gain();
  v.chain(n, hp, bp, g, v.input);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.26, t + 0.12);
  g.gain.setValueAtTime(0.24, t + len - 0.5);
  g.gain.linearRampToValueAtTime(0, t + len);
  const r = v.noise(v.bank.brown, t, t + len + 0.1);
  const lp = v.filter('lowpass', 220, 0.8);
  const rg = v.gain();
  v.chain(r, lp, rg, v.input);
  rg.gain.setValueAtTime(0, t);
  rg.gain.linearRampToValueAtTime(0.5, t + 0.15);
  rg.gain.linearRampToValueAtTime(0, t + len);
}

/** A conga line: da-da-da-da-da-da-HEY on a hand drum, the HEY a shout. */
export function conga(v: Voice): void {
  const t = v.t;
  const step = 0.17;
  const hits = [0, 1, 2, 4, 5, 6];
  for (const k of hits) {
    const at = t + k * step;
    const hz = k % 2 ? 330 : 260;
    thump(v, at, hz * 1.5, hz, 0.03, 0.45, 0.06);
    noiseHit(v, v.bank.white, at, 'bandpass', 2400, 1.5, 0.12, 0.001, 0.012);
  }
  // HEY: a voiced shout on the kick.
  const at = t + 7 * step;
  const o = v.osc('sawtooth', 210, at, at + 0.3);
  sweep(o.frequency, at, 240, 180, 0.25);
  const f1 = v.filter('bandpass', 750, 3);
  const f2 = v.filter('bandpass', 1800, 4);
  const g = v.gain();
  o.connect(f1);
  o.connect(f2);
  f1.connect(g);
  f2.connect(g);
  g.connect(v.input);
  perc(g.gain, at, 0.4, 0.02, 0.07);
  thump(v, at, 160, 80, 0.06, 0.6, 0.07);
}

/** ACTION: the clapperboard's clack, then a little brass stab. */
export function clapper(v: Voice): void {
  const t = v.t;
  noiseHit(v, v.bank.white, t, 'highpass', 2500, 0.8, 0.7, 0.0005, 0.008);
  thump(v, t, 900, 500, 0.02, 0.5, 0.015, 'triangle');
  const at = t + 0.28;
  for (const [midi, off] of [
    [62, 0],
    [69, 0.12],
  ] as const) {
    const s = at + off;
    const hz = midiToHz(midi);
    const lp = v.filter('lowpass', 900, 1.5);
    sweep(lp.frequency, s, 900, 3200, 0.06);
    const g = v.gain();
    for (const d of [-8, 8]) {
      const o = v.osc('sawtooth', hz, s, s + 0.4);
      o.detune.value = d;
      o.connect(lp);
    }
    v.chain(lp, g, v.input);
    perc(g.gain, s, 0.22, 0.01, off ? 0.12 : 0.05);
  }
}

/**
 * The police scanner keying up (V2-11): a squelch of band-limited hiss, a
 * few syllables of radio burble under it, and the two-pip roger at the end.
 * Non-positional: it's the player's own scanner.
 */
export function squelch(v: Voice, syllables: number): void {
  const t = v.t;
  const len = 0.12 + syllables * 0.075;
  noiseHit(v, v.bank.white, t, 'bandpass', 1900, 1.1, 0.32, 0.004, 0.035);
  // Pseudo-speech: a buzz through a formant that steps between vowels, gated per syllable.
  const buzz = v.osc('sawtooth', rnd(125, 155), t + 0.06, t + 0.08 + len);
  const formant = v.filter('bandpass', 900, 4);
  const band = v.filter('highpass', 350, 0.7);
  const g = v.gain();
  v.chain(buzz, formant, band, g, v.input);
  g.gain.setValueAtTime(0, t);
  for (let i = 0; i < syllables; i++) {
    const at = t + 0.07 + i * 0.075;
    formant.frequency.setValueAtTime(rnd(600, 2200), at);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.11 * vary(0.3), at + 0.012);
    g.gain.linearRampToValueAtTime(0, at + 0.06);
  }
  // The hiss bed, and the roger pips.
  noiseHit(v, v.bank.pink, t + 0.05, 'bandpass', 2600, 0.8, 0.05, 0.02, len * 0.4);
  const end = t + 0.1 + len;
  for (const [hz, off] of [
    [1250, 0],
    [1650, 0.07],
  ] as const) {
    const o = v.osc('square', hz, end + off, end + off + 0.08);
    const lp = v.filter('lowpass', 2600, 0.7);
    const pg = v.gain();
    v.chain(o, lp, pg, v.input);
    perc(pg.gain, end + off, 0.07, 0.002, 0.018);
  }
}
