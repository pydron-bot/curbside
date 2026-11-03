/**
 * Midnight fireworks over downtown (0.24.0): from 23:30 to 00:45 shells
 * burst over the middle of the city, below the camera, as spheres of
 * coloured streaks (Effects.firework) with a flash in the air and its colour
 * in the road below (shared glows, stronger on a wet road). Shells are set
 * off over the part of the show in view, so elsewhere they cost nothing. `fireworksLevel`
 * is pure (tests/fireworks.test.ts).
 */
import type { Rect } from '../world/city';
import type { Effects } from './effects';
import { GLOW, type GlowSprites } from './glowSprites';
import { worldUniforms } from './shaderLib';

/** Where the show is: the middle of downtown, this far round, m. */
const CENTRE_X = 0;
const CENTRE_Z = 0;
const RADIUS = 150;
/** Seconds between shells in view at the show's height. */
const EVERY = 0.7;
/** A burst's flash fades over this long, s. */
const FLASH = 0.9;
const MAX_BURSTS = 8;

/** Shell colours (linear, bright): the logo's pink and cyan, gold, violet, green, white. */
const COLOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 0.18, 0.55],
  [0.2, 0.85, 1.0],
  [1.0, 0.72, 0.2],
  [0.65, 0.3, 1.0],
  [0.3, 1.0, 0.45],
  [1.0, 0.95, 0.85],
];

/** How lively the show is at this hour, 0..1: ramps up from 23:30, full from 23:50, done by 00:45. */
export function fireworksLevel(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  // Hours since 23:30, through midnight.
  const t = h >= 23.5 ? h - 23.5 : h < 1 ? h + 0.5 : -1;
  if (t < 0 || t > 1.25) return 0;
  if (t < 0.33) return t / 0.33;
  if (t > 1.0) return (1.25 - t) / 0.25;
  return 1;
}

export class Fireworks {
  /** Live bursts: x, y, z, r, g, b, age (s); age ≥ FLASH is free. */
  private readonly bursts = new Float32Array(MAX_BURSTS * 7);

  constructor(private readonly fx: Effects) {
    for (let i = 0; i < MAX_BURSTS; i++) this.bursts[i * 7 + 6] = FLASH;
  }

  update(dt: number, hour: number, view: Rect): void {
    for (let i = 0; i < MAX_BURSTS; i++) this.bursts[i * 7 + 6] += dt;
    const level = fireworksLevel(hour);
    if (level <= 0 || dt <= 0 || Math.random() >= (dt / EVERY) * level) return;
    // Over the part of the show in view (none if the view is nowhere near downtown).
    const x = view.minX - 10 + Math.random() * (view.maxX - view.minX + 20);
    const z = view.minZ - 10 + Math.random() * (view.maxZ - view.minZ + 20);
    if ((x - CENTRE_X) ** 2 + (z - CENTRE_Z) ** 2 > RADIUS * RADIUS) return;
    const y = 14 + Math.random() * 8;
    const [cr, cg, cb] = COLOURS[Math.floor(Math.random() * COLOURS.length)];
    this.fx.firework(x, y, z, cr, cg, cb);
    // Into the oldest slot.
    let slot = 0;
    for (let i = 1; i < MAX_BURSTS; i++) if (this.bursts[i * 7 + 6] > this.bursts[slot * 7 + 6]) slot = i;
    const o = slot * 7;
    this.bursts[o] = x;
    this.bursts[o + 1] = y;
    this.bursts[o + 2] = z;
    this.bursts[o + 3] = cr;
    this.bursts[o + 4] = cg;
    this.bursts[o + 5] = cb;
    this.bursts[o + 6] = 0;
  }

  /** The bursts' flashes in the air and their colour on the road below (a Look glow source). */
  drawGlows(glows: GlowSprites): void {
    const wet = worldUniforms.uWetness.value;
    const d = this.bursts;
    for (let i = 0; i < MAX_BURSTS; i++) {
      const o = i * 7;
      const age = d[o + 6];
      if (age >= FLASH) continue;
      const k = (1 - age / FLASH) ** 2;
      const a = 1.4 * k;
      glows.addFlat(d[o], d[o + 1], d[o + 2], 0, 9, 9, d[o + 3] * a, d[o + 4] * a, d[o + 5] * a, GLOW.disc);
      const q = k * (0.35 + 0.45 * wet);
      glows.addFlat(d[o], 0.06, d[o + 2], 0, 22, 22, d[o + 3] * q, d[o + 4] * q, d[o + 5] * q, GLOW.disc);
    }
  }
}
