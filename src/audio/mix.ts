/**
 * Mixing math shared by every voice: volume curves, distance attenuation,
 * stereo pan, air absorption and doppler for a top-down listener. Pure (no
 * Web Audio) so it's unit-tested. The camera never rotates, so screen-right
 * is always world +X and pan is just the horizontal offset.
 */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 below `lo`, 1 above `hi`, smooth in between. */
export function smoothstep(lo: number, hi: number, v: number): number {
  const t = clamp01((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
}

/** Slider value 0..1 → linear gain. Squared, so the bottom half of a slider isn't all "loud". */
export function volumeToGain(v: number): number {
  const c = Number.isFinite(v) ? clamp01(v) : 0;
  return c * c;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** How a sound fades with distance. */
export interface Falloff {
  /** Full volume within this distance, m. */
  ref: number;
  /** Beyond this the sound isn't played at all, m. */
  max: number;
  /** Quietest it gets inside `max`: far-off events are quiet, not silent. */
  floor: number;
}

/** Inverse-distance gain (Web Audio's "inverse" model, rolloff 1) with a floor; 0 past `max`. */
export function distanceGain(d: number, f: Falloff): number {
  if (d > f.max) return 0;
  if (d <= f.ref) return 1;
  return Math.max(f.floor, f.ref / d);
}

/** Half-width of the stage, m: a source this far left/right is panned as far as it goes. */
export const PAN_WIDTH = 26;
/** Never pan fully into one ear; hard-panned sounds feel broken on headphones. */
export const PAN_LIMIT = 0.85;

/** Stereo position -1..1 for a source `dx` metres right (+) or left (-) of the listener. */
export function panFor(dx: number, width = PAN_WIDTH): number {
  return clamp(dx / width, -1, 1) * PAN_LIMIT;
}

/** Lowpass cutoff (Hz) for a source `d` m away: distant booms arrive as rumble. */
export function airCutoff(d: number): number {
  return clamp(20000 * Math.exp(-d / 50), 450, 20000);
}

/** Below this cutoff a voice gets its own air-absorption filter; above it the filter is inaudible. */
export const AIR_FILTER_BELOW = 12000;

/** Reverb send for a source: further away means more room and less direct sound. */
export function wetFor(base: number, d: number): number {
  return clamp01(base * (0.7 + d / 60));
}

export const SPEED_OF_SOUND = 343;

/** Pitch shift (cents) of a source receding at `radial` m/s (negative = approaching). */
export function dopplerCents(radial: number, limit = 300): number {
  const factor = SPEED_OF_SOUND / (SPEED_OF_SOUND + clamp(radial, -150, 150));
  return clamp(1200 * Math.log2(factor), -limit, limit);
}

/** Frequency ratio for `semitones` (equal temperament). */
export function semis(semitones: number): number {
  return Math.pow(2, semitones / 12);
}
