/**
 * The city's everyday life on screen (game/cityLife.ts runs it): guns
 * dropped in the street (the pickups.glb crate models in the world props'
 * `things` family, small, in a pulsing ring), the hospital's sign on the
 * pavement, and whatever the scenes register with add() (a fire's flames
 * and glow, a hose, a bus stop's marker...).
 *
 * No meshes of its own: particles go through Effects' pools, light
 * through the shared glow batch, models through the props' `things`
 * family, so it adds no draw call and compiles nothing. Nothing allocates
 * per frame (parts must keep it that way).
 */
import type { CityLife } from '../game/cityLife';
import type { Rect } from '../world/city';
import type { Effects } from './effects';
import { GLOW, type GlowSprites } from './glowSprites';
import { PICKUP_MODELS } from './pickupMesh';
import { worldUniforms } from './shaderLib';
import type { WorldProps } from './worldProps';

/** A scene's look: particles on the sim's clock, faked light and props models once a frame. */
export interface CityLookPart {
  /** Per frame, on the sim's clock (frozen by pause and hit-stop): emit particles through `fx`. */
  update?(dt: number, view: Rect, fx: Effects): void;
  /** Per frame, into the shared glow batch (and `props.things`, once loaded). */
  draw?(glows: GlowSprites, view: Rect, props: WorldProps): void;
}

/** Drop models are life-size crates: shown at this scale. */
const DROP_SCALE = 1.1;
const DROP_COLOUR = [1, 0.75, 0.3] as const;

export class CityLifeLook {
  private readonly parts: CityLookPart[] = [];
  private time = 0;

  constructor(
    private readonly life: CityLife,
    private readonly effects: Effects,
    private readonly props: WorldProps,
  ) {}

  /** Register a scene's look. */
  add(part: CityLookPart): void {
    this.parts.push(part);
  }

  /** Per frame on the sim's clock. */
  update(dt: number, view: Rect): void {
    this.time += dt;
    if (dt <= 0) return;
    for (const p of this.parts) p.update?.(dt, view, this.effects);
  }

  /** The faked light and the drop models (a glow source: once a frame, after the sim). */
  draw(glows: GlowSprites, view: Rect): void {
    const life = this.life;
    const t = this.time;
    const night = worldUniforms.uNight.value;
    // Dropped guns: the crate model, small, with a pulsing ring so they read as something to grab.
    const things = this.props.loaded ? this.props.things : null;
    for (const d of life.drops.list) {
      if (!d.alive || !near(view, d.x, d.z, 3)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(t * 5 + d.x);
      things?.add(PICKUP_MODELS[d.kind], d.x, 0.2, d.z, t * 1.5 + d.z, DROP_SCALE, DROP_SCALE, DROP_SCALE, 0, 0.3);
      const ring = 1.4 + pulse * 0.3;
      const k = 0.7 + 0.5 * pulse;
      glows.addFlat(d.x, 0.05, d.z, t, ring, ring, DROP_COLOUR[0] * k, DROP_COLOUR[1] * k, DROP_COLOUR[2] * k, GLOW.ring);
    }
    // The hospital: a red cross on the pavement and a white wash round it.
    const h = life.hospital;
    if (near(view, h.x, h.z, 6)) {
      const lit = 0.7 + 0.6 * night;
      glows.addFlat(h.x, 0.05, h.z, 0, 4.5, 4.5, 0.5 * lit, 0.5 * lit, 0.55 * lit, GLOW.disc);
      glows.addFlat(h.x, 0.06, h.z, 0, 0.6, 2.4, 1.6 * lit, 0.15 * lit, 0.15 * lit, GLOW.bar);
      glows.addFlat(h.x, 0.06, h.z, Math.PI / 2, 0.6, 2.4, 1.6 * lit, 0.15 * lit, 0.15 * lit, GLOW.bar);
    }
    for (const p of this.parts) p.draw?.(glows, view, this.props);
  }
}

/** Is (x, z) within `margin` of the view? (For parts too.) */
export function near(view: Rect, x: number, z: number, margin: number): boolean {
  return x > view.minX - margin && x < view.maxX + margin && z > view.minZ - margin && z < view.maxZ + margin;
}
