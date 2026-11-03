/**
 * Steam from the road vents at night (world/steamVents.ts): the vents in
 * view breathe wisps through the shared soft particles (Effects.emitSteam),
 * tinted by the light of their part of town (the arts quarter's pink and
 * cyan, downtown's cyan, warm lamplight elsewhere). A handful of particles
 * at a time; nothing allocates per frame.
 */
import type { Rect } from '../world/city';
import type { SteamVent } from '../world/steamVents';
import type { Effects } from './effects';
import { inView } from './neonReflect';
import { getQuality } from './quality';
import { worldUniforms } from './shaderLib';

/** Seconds between wisps from one vent (at a particle scale of 1). */
const EVERY = 0.18;

/** Linear tints: pink, cyan, warm lamplight. */
const PINK = [1.0, 0.28, 0.6] as const;
const CYAN = [0.3, 0.85, 1.0] as const;
const WARM = [1.0, 0.72, 0.45] as const;

export class SteamLook {
  private readonly tints: Float32Array;

  constructor(
    private readonly fx: Effects,
    private readonly vents: readonly SteamVent[],
  ) {
    this.tints = new Float32Array(vents.length * 3);
    vents.forEach((v, i) => {
      const t = v.district === 'arts' ? (i % 2 ? PINK : CYAN) : v.district === 'downtown' ? CYAN : WARM;
      this.tints.set(t, i * 3);
    });
  }

  update(dt: number, view: Rect): void {
    const night = worldUniforms.uNight.value;
    if (night < 0.1 || dt <= 0) return;
    const chance = (dt / EVERY) * getQuality().particleScale * night;
    for (let i = 0; i < this.vents.length; i++) {
      const v = this.vents[i];
      if (!inView(view, v.x, v.z, 6) || Math.random() >= chance) continue;
      // Pale steam, with the local light in it.
      const o = i * 3;
      this.fx.emitSteam(v.x, v.z, 0.5 + 0.42 * this.tints[o], 0.5 + 0.42 * this.tints[o + 1], 0.54 + 0.42 * this.tints[o + 2]);
    }
  }
}
