/**
 * The smoke grenade's look (W3-B): each cloud (systems/smoke.ts, at most
 * MAX_CLOUDS) is billows of pale smoke from Effects' soft pool, the same
 * particles, budgets and low-resolution pass (render/lowResFx.ts) as every
 * other smoke, so it adds no draw call while anything else smokes and one
 * otherwise. Puffs come at a rate scaled by the tier's particleScale (about
 * 17 live per cloud on low, 26 on medium, 34 on high, 3–4.5 m across, under
 * the low tier's smokeMax) and stop SMOKE_EMIT_STOP before the cloud stops
 * being thick, so what you see thins as its effect ends. Police cars
 * stopped dead in one blink their hazards in the shared glow batch.
 * Nothing allocates per frame.
 */
import type { PoliceUnit } from '../systems/police';
import { MAX_CLOUDS, SMOKE_POUR, SMOKE_RADIUS, SMOKE_THICK, cloudRadius, type SmokeClouds } from '../systems/smoke';
import type { Rect } from '../world/city';
import { near } from './cityLifeLook';
import type { Effects } from './effects';
import { GLOW, type GlowSprites } from './glowSprites';
import type { Look } from './look';
import { worldUniforms } from './shaderLib';

/** Billows per second across a cloud at particleScale 1: while it pours, then while it hangs. */
const POUR_RATE = 16;
const HANG_RATE = 10;
/** Puffs from the canister's nozzle per second (particleScale 1). */
const JET_RATE = 7;
/** Emission stops this long before the cloud stops being thick, s (the last billows fade as it does). */
export const SMOKE_EMIT_STOP = 1.2;
/** Clouds this far outside the visible ground aren't fed, m. */
const VIEW_MARGIN = SMOKE_RADIUS + 20;

export class SmokeLook {
  /** Billows owed per cloud and from each nozzle (emission at a rate). */
  private readonly debt = new Float32Array(MAX_CLOUDS);
  private readonly jetDebt = new Float32Array(MAX_CLOUDS);
  private readonly view: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

  constructor(
    look: Look,
    private readonly effects: Effects,
    private readonly smoke: SmokeClouds,
    private readonly units: readonly PoliceUnit[],
  ) {
    look.addGlowSource((glows, view) => this.drawGlows(glows, view));
  }

  /** Per frame (sim-scaled time, so hit-stop holds the cloud too). */
  update(dt: number): void {
    if (dt <= 0 || !this.smoke.active) return;
    const fx = this.effects;
    const scale = fx.scale;
    const list = this.smoke.list;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.alive || c.age >= SMOKE_THICK - SMOKE_EMIT_STOP || !near(this.view, c.x, c.z, VIEW_MARGIN)) {
        this.debt[i] = this.jetDebt[i] = 0;
        continue;
      }
      const r = cloudRadius(c.age);
      this.debt[i] += dt * (c.age < SMOKE_POUR ? POUR_RATE : HANG_RATE) * scale;
      while (this.debt[i] >= 1) {
        this.debt[i] -= 1;
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * r * 0.8;
        const ux = Math.cos(a);
        const uz = Math.sin(a);
        const s = 0.85 + Math.random() * 0.25;
        fx.smokeCloud(c.x + ux * d, 0.5 + Math.random() * 1.3, c.z + uz * d, 2.4 * s, 4 * s, 3 + Math.random() * 0.8, ux * 0.35, uz * 0.35, 0.72 + Math.random() * 0.08, 0.62);
      }
      this.jetDebt[i] += dt * JET_RATE * scale;
      while (this.jetDebt[i] >= 1) {
        this.jetDebt[i] -= 1;
        const a = Math.random() * Math.PI * 2;
        fx.smokeCloud(c.x, 0.3, c.z, 0.5, 2.2, 1.3, Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0.84, 0.5);
      }
    }
  }

  /** Hazard lights on police cars stopped dead in the smoke; remembers the view for update(). */
  private drawGlows(glows: GlowSprites, view: Rect): void {
    this.view.minX = view.minX;
    this.view.minZ = view.minZ;
    this.view.maxX = view.maxX;
    this.view.maxZ = view.maxZ;
    // A hazard blink: on 0.45 s, off 0.35 s (as the traffic scenes').
    if (worldUniforms.uTime.value % 0.8 >= 0.45) return;
    for (const u of this.units) {
      const v = u.vehicle;
      if (!v || u.daze.confused !== 'hazards' || !v.mesh.root.visible) continue;
      const s = v.sim;
      if (!near(view, s.x, s.z, 4)) continue;
      const fx = Math.sin(s.heading);
      const fz = Math.cos(s.heading);
      const reach = (s.body?.reach ?? 2.3) - 0.15;
      const half = (s.body?.halfWidth ?? 0.95) - 0.1;
      for (let k = 0; k < 4; k++) {
        const along = k < 2 ? reach : -reach;
        const across = k % 2 ? half : -half;
        glows.addFlat(s.x + fx * along + fz * across, 0.9, s.z + fz * along - fx * across, s.heading, 0.9, 0.9, 1.6, 0.75, 0.1, GLOW.disc);
      }
    }
  }
}
