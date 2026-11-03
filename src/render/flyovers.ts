/**
 * Planes and blimps passing over by day (0.25.0), seen only as their shadows
 * sliding across the city (and a plane's faint contrail): every minute or
 * two one crosses the player's view. The shadow is drawn in shaderLib's
 * ubCloudShade from `uFlyer` (x, z, heading, kind), so it falls on streets,
 * roofs, cars and people alike, at no extra cost. The path is pure
 * (tests/flyovers.test.ts).
 */
import { worldUniforms } from './shaderLib';

export type FlyerKind = 'plane' | 'blimp';
/** uFlyer.w for each kind (0 = nothing overhead). */
export const FLYER_CODE: Readonly<Record<FlyerKind, number>> = { plane: 1, blimp: 2 };

const SPEED: Readonly<Record<FlyerKind, number>> = { plane: 48, blimp: 7 };
/** It starts and ends this far from the point it passes over, m (well outside any view). */
const REACH: Readonly<Record<FlyerKind, number>> = { plane: 260, blimp: 120 };
/** Seconds between flyovers by day: at least, plus up to. */
const GAP_MIN = 70;
const GAP_SPREAD = 70;

export interface FlyoverPath {
  kind: FlyerKind;
  x0: number;
  z0: number;
  /** Heading (0 = +Z) and how long it takes, s. */
  heading: number;
  duration: number;
  speed: number;
}

/** A pass straight over (cx, cz) on `heading`: where it starts, and how long it's overhead. */
export function flyoverPath(kind: FlyerKind, cx: number, cz: number, heading: number): FlyoverPath {
  const r = REACH[kind];
  const speed = SPEED[kind];
  return { kind, x0: cx - Math.sin(heading) * r, z0: cz - Math.cos(heading) * r, heading, duration: (2 * r) / speed, speed };
}

/** Where a flyover is t seconds in. */
export function flyoverAt(p: FlyoverPath, t: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = p.x0 + Math.sin(p.heading) * p.speed * t;
  out.z = p.z0 + Math.cos(p.heading) * p.speed * t;
  return out;
}

/** Is it daytime enough for flyovers (they'd be lost in the dark)? */
export function flyoverHours(hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return h >= 7 && h < 18.5;
}

export class Flyovers {
  private path: FlyoverPath | null = null;
  private t = 0;
  private wait = 25;
  private readonly at = { x: 0, z: 0 };

  /** Per frame: maybe send one over (x, z), move it along, publish its shadow. */
  update(dt: number, hour: number, x: number, z: number): void {
    const u = worldUniforms.uFlyer.value;
    if (this.path) {
      this.t += dt;
      if (this.t >= this.path.duration) {
        this.path = null;
        u.w = 0;
        return;
      }
      flyoverAt(this.path, this.t, this.at);
      u.set(this.at.x, this.at.z, this.path.heading, FLYER_CODE[this.path.kind]);
      return;
    }
    u.w = 0;
    if (!flyoverHours(hour)) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = GAP_MIN + Math.random() * GAP_SPREAD;
    const kind: FlyerKind = Math.random() < 0.75 ? 'plane' : 'blimp';
    // Over somewhere near the player, so it crosses the view.
    this.path = flyoverPath(kind, x + (Math.random() - 0.5) * 30, z + (Math.random() - 0.5) * 20, Math.random() * Math.PI * 2);
    this.t = 0;
  }

  /** Testing: one passing right over (x, z) now (`ahead` m before it gets there). */
  sendNow(kind: FlyerKind, x: number, z: number, heading = Math.PI / 4, ahead = 0): void {
    this.path = flyoverPath(kind, x, z, heading);
    this.t = Math.max(0, this.path.duration / 2 - ahead / this.path.speed);
  }
}
