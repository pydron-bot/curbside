/**
 * Park water (world/parkWater.ts): the plaza fountains in view throw a
 * plume from the middle and a ring of little arcs in from the basin's rim,
 * day and night (lit cyan from the basin at night), and the lawn sprinklers
 * sweep their fans over the grass by day while it's dry. All drops are the
 * shared soft particles (the hose's look: stretched dots on a ballistic
 * flight), so nothing new is drawn; the rainbow over a fountain is in the
 * ground shader (world/ground.ts). Nothing allocates per frame.
 */
import type { Rect } from '../world/city';
import { sprinklerAngle, sprinklerOn, type Fountain, type Sprinkler } from '../world/parkWater';
import type { Effects } from './effects';
import { FLAG, FRAME, RAMP } from './fxParticles';
import { inView } from './neonReflect';
import { getQuality } from './quality';
import { worldUniforms } from './shaderLib';

const GRAVITY = 9;
/** Drops a second (at a particle scale of 1): the fountain's middle plume, each of its rim jets, a sprinkler. */
const PLUME = 46;
const RIM_JETS = 8;
const RIM = 11;
const SPRINKLER = 55;
/** The basin's rim radius and the fountain's spout height, m (ground.ts draws the basin at 4.4 m). */
const RIM_R = 3.9;
const SPOUT_Y = 0.9;

export class WaterLook {
  /** Fractional drops carried between frames, so low rates still spray steadily. */
  private plumeDebt = 0;
  private rimDebt = 0;
  private sprinklerDebt = 0;
  /** This frame's step, s. */
  private dt = 0;

  constructor(
    private readonly fx: Effects,
    private readonly fountains: readonly Fountain[],
    private readonly sprinklers: readonly Sprinkler[],
  ) {}

  update(dt: number, view: Rect): void {
    if (dt <= 0) return;
    this.dt = dt;
    const scale = getQuality().particleScale;
    const night = worldUniforms.uNight.value;
    const t = worldUniforms.uTime.value;
    this.plumeDebt += dt * PLUME * scale;
    this.rimDebt += dt * RIM * scale;
    const plume = Math.floor(this.plumeDebt);
    const rim = Math.floor(this.rimDebt);
    this.plumeDebt -= plume;
    this.rimDebt -= rim;
    for (const f of this.fountains) {
      if (!inView(view, f.x, f.z, 8)) continue;
      for (let k = 0; k < plume; k++) {
        const a = Math.random() * Math.PI * 2;
        const out = 0.3 + Math.random() * 0.7;
        this.drop(f.x, SPOUT_Y, f.z, Math.cos(a) * out, 5.6 + Math.random() * 1.1, Math.sin(a) * out, night);
      }
      for (let j = 0; j < RIM_JETS; j++) {
        const a = (j / RIM_JETS) * Math.PI * 2 + 0.2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        for (let k = 0; k < rim; k++) {
          const v = 1.7 + Math.random() * 0.3;
          this.drop(f.x + c * RIM_R, 0.5, f.z + s * RIM_R, -c * v, 3.4 + Math.random() * 0.4, -s * v, night);
        }
      }
      // A little mist where the plume falls back.
      if (Math.random() < dt * 2 * scale) this.fx.puff(f.x + (Math.random() - 0.5) * 2, 0.6, f.z + (Math.random() - 0.5) * 2, 0.95, 1.2, 2.6, 0.18, 0, 0.3, 0, 1.4);
    }
    // Sprinklers by day, while it's dry.
    if (night > 0.35 || worldUniforms.uRain.value > 0.1) return;
    this.sprinklerDebt += dt * SPRINKLER * scale;
    const n = Math.floor(this.sprinklerDebt);
    this.sprinklerDebt -= n;
    for (const s of this.sprinklers) {
      if (!inView(view, s.x, s.z, 6) || !sprinklerOn(s.phase, t)) continue;
      const a = sprinklerAngle(s, t);
      for (let k = 0; k < n; k++) {
        // A fan: spread a little across the jet and all along its throw.
        const aa = a + (Math.random() - 0.5) * 0.35;
        const v = 2.2 + Math.random() * 3;
        this.drop(s.x, 0.15, s.z, Math.cos(aa) * v, 3.6 + Math.random() * 1.2, Math.sin(aa) * v, night);
      }
    }
  }

  /**
   * One drop on a ballistic flight back to the ground, started somewhere in
   * the last frame of its flight (as the hose does), so a slow frame still
   * draws a stream, not a clump at the nozzle.
   */
  private drop(x: number, y: number, z: number, vx: number, vy: number, vz: number, night: number): void {
    const pool = this.fx.soft;
    const life = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * y)) / GRAVITY;
    const a = Math.random() * Math.min(this.dt, life * 0.8);
    const i = pool.spawn(x + vx * a, y + (vy - (GRAVITY * a) / 2) * a, z + vz * a, vx, vy - GRAVITY * a, vz, life - a, 0.28, 0.5, RAMP.flat, FRAME.dot);
    if (i < 0) return;
    // White water by day; at night lit from the basin, cool cyan, adding light.
    pool.r[i] = 0.86 - 0.3 * night;
    pool.g[i] = 0.93;
    pool.b[i] = 1;
    pool.alpha[i] = 0.75;
    pool.add[i] = 0.55 * night;
    pool.gravity[i] = GRAVITY;
    pool.drag[i] = 0;
    pool.flags[i] = FLAG.stretch;
    pool.stretch[i] = 0.06;
  }
}
