/**
 * Oscillator shapes the built-in types don't have, as Fourier series for
 * `createPeriodicWave` (pure, so they're unit-tested): the chip station's
 * pulse waves and stepped triangle, and a reedy melodica. MusicPlayer builds
 * each PeriodicWave once and reuses it, so a note costs no more than a plain
 * oscillator.
 */

export interface Harmonics {
  /** Cosine terms; [0] is DC (ignored by the browser). */
  real: Float32Array;
  /** Sine terms. */
  imag: Float32Array;
}

/** A pulse wave high for `duty` of each period (0.5 is a square; 0.125 the thin chip buzz). */
export function pulseWave(duty: number, harmonics = 48): Harmonics {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  // Centred on 0, so it's all cosine: a_n = 2 sin(πnd) / (πn).
  for (let n = 1; n <= harmonics; n++) real[n] = (2 * Math.sin(Math.PI * n * duty)) / (Math.PI * n);
  return { real, imag };
}

/**
 * The 8-bit console triangle: 32 flat steps (15 down to 0 and back up), not
 * a smooth ramp. The steps are what give it its slightly buzzy edge.
 */
export function steppedTriangle(harmonics = 48): Harmonics {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  const steps = 32;
  for (let k = 0; k < steps; k++) {
    const level = (k < 16 ? 15 - k : k - 16) / 7.5 - 1;
    const a = k / steps;
    const b = (k + 1) / steps;
    // Exact integral of a constant over [a, b) against cos / sin(2πnx).
    for (let n = 1; n <= harmonics; n++) {
      const w = 2 * Math.PI * n;
      real[n] += (2 * level * (Math.sin(w * b) - Math.sin(w * a))) / w;
      imag[n] += (2 * level * (Math.cos(w * a) - Math.cos(w * b))) / w;
    }
  }
  return { real, imag };
}

/** A free reed (melodica, harmonica): every harmonic, the odd ones stronger, a nasal bump around the 3rd to 5th. */
export function reedWave(harmonics = 32): Harmonics {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    const odd = n % 2 === 1 ? 1 : 0.55;
    const nasal = n >= 3 && n <= 5 ? 1.5 : 1;
    imag[n] = (odd * nasal) / Math.pow(n, 0.9);
  }
  return { real, imag };
}
