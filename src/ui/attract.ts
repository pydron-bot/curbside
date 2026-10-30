/**
 * Attract mode behind the title screen: the city runs on its own and the
 * camera drifts after one car of traffic, then glides over to another every
 * few seconds. No player input; the camera focus also stands in for the
 * player as the point Population keeps the streets busy around.
 */
import type { Vehicle } from '../game/population';

/** Seconds on one car before looking for another. */
const HOLD = [7, 11] as const;
/** Cars considered when picking the next one, m from the focus. */
const PICK_RANGE = 130;
/** Lost a car this far away (recycled, or it got away): pick again. */
const LOSE_RANGE = 190;
/** Camera glide limits: top speed (m/s) and how hard it chases the target. */
const MAX_SPEED = 26;
const CHASE = 1.1;
const SMOOTH = 2.2;
/** Lead the target by this many seconds of its velocity. */
const LEAD = 0.9;

export class AttractCamera {
  active = false;
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  private target: Vehicle | null = null;
  private hold = 0;

  constructor(private readonly rand: () => number = Math.random) {}

  start(x: number, z: number): void {
    this.active = true;
    this.x = x;
    this.z = z;
    this.vx = this.vz = 0;
    this.target = null;
    this.hold = 0;
  }

  stop(): void {
    this.active = false;
    this.target = null;
  }

  update(dt: number, vehicles: readonly Vehicle[]): void {
    if (!this.active) return;
    this.hold -= dt;
    const t = this.target;
    const lost =
      !t || !t.ai || t.damage.wrecked || !vehicles.includes(t) || Math.hypot(t.sim.x - this.x, t.sim.z - this.z) > LOSE_RANGE;
    if (lost || this.hold <= 0) this.pick(vehicles);

    let wantVx = 4; // nobody to follow: drift east
    let wantVz = 0;
    const tgt = this.target;
    if (tgt) {
      const gx = tgt.sim.x + tgt.sim.vx * LEAD - this.x;
      const gz = tgt.sim.z + tgt.sim.vz * LEAD - this.z;
      wantVx = gx * CHASE;
      wantVz = gz * CHASE;
      const sp = Math.hypot(wantVx, wantVz);
      if (sp > MAX_SPEED) {
        wantVx *= MAX_SPEED / sp;
        wantVz *= MAX_SPEED / sp;
      }
    }
    const k = 1 - Math.exp(-SMOOTH * dt);
    this.vx += (wantVx - this.vx) * k;
    this.vz += (wantVz - this.vz) * k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
  }

  /** A moving AI car nearby, preferably not the one we were on. */
  private pick(vehicles: readonly Vehicle[]): void {
    this.hold = HOLD[0] + this.rand() * (HOLD[1] - HOLD[0]);
    let best: Vehicle | null = null;
    let bestScore = -Infinity;
    for (const v of vehicles) {
      if (!v.ai || v.damage.wrecked) continue;
      const d = Math.hypot(v.sim.x - this.x, v.sim.z - this.z);
      if (d > PICK_RANGE) continue;
      const sp = Math.hypot(v.sim.vx, v.sim.vz);
      // Moving cars a little way off make the nicest glide; add some chance.
      const score = Math.min(sp, 12) - Math.abs(d - 45) * 0.08 + this.rand() * 6 - (v === this.target ? 8 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    this.target = best;
  }
}
