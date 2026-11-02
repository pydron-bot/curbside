/**
 * Attract mode behind the title screen: the city runs on its own and the
 * camera drifts after one car of traffic, then glides over to another every
 * few seconds; now and then the title's show (game/attractHighlights.ts)
 * hands it a scene to watch instead. No player input; the camera focus
 * also stands in for the player as the point Population keeps the streets
 * busy around.
 */
import type { Subject } from '../game/cityLife';
import type { Vehicle } from '../game/population';
import type { LeadSettings } from '../render/cameraRig';
import { len2 } from '../core/len';

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
const LEAD = 0.6;
/**
 * Watching a highlight: keep up with it (its velocity fed forward, then
 * close the gap), up to WATCH_SPEED m/s; no lead of its own, or a racer
 * at 30 m/s ends up at the edge of a landscape phone's short height.
 */
const WATCH_CHASE = 1.6;
const WATCH_SMOOTH = 4;
const WATCH_SPEED = 60;

/** The rig's look-ahead behind the title: gentle, so the subject stays in the free area right of the menu. */
export const LEAD_ATTRACT: LeadSettings = { seconds: 0.4, maxX: 0.08, maxZ: 0.1 };

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

  /** Straight to (x, z) (a cut, under the title's fade), already moving at (vx, vz). */
  jump(x: number, z: number, vx: number, vz: number): void {
    this.x = x;
    this.z = z;
    this.vx = vx;
    this.vz = vz;
  }

  /** `watch`: the highlight to follow this frame (null: cruise after traffic). */
  update(dt: number, vehicles: readonly Vehicle[], watch: Subject | null = null): void {
    if (!this.active) return;
    if (watch) {
      this.follow(dt, watch);
      return;
    }
    this.hold -= dt;
    const t = this.target;
    const lost =
      !t || !t.ai || t.damage.wrecked || !vehicles.includes(t) || len2(t.sim.x - this.x, t.sim.z - this.z) > LOSE_RANGE;
    if (lost || this.hold <= 0) this.pick(vehicles);

    let wantVx = 4; // nobody to follow: drift east
    let wantVz = 0;
    const tgt = this.target;
    if (tgt) {
      const gx = tgt.sim.x + tgt.sim.vx * LEAD - this.x;
      const gz = tgt.sim.z + tgt.sim.vz * LEAD - this.z;
      wantVx = gx * CHASE;
      wantVz = gz * CHASE;
      const sp = len2(wantVx, wantVz);
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

  private follow(dt: number, w: Subject): void {
    // Pick a car afresh once the show lets go.
    this.target = null;
    let wantVx = w.vx + (w.x - this.x) * WATCH_CHASE;
    let wantVz = w.vz + (w.z - this.z) * WATCH_CHASE;
    const sp = len2(wantVx, wantVz);
    if (sp > WATCH_SPEED) {
      wantVx *= WATCH_SPEED / sp;
      wantVz *= WATCH_SPEED / sp;
    }
    const k = 1 - Math.exp(-WATCH_SMOOTH * dt);
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
      const d = len2(v.sim.x - this.x, v.sim.z - this.z);
      if (d > PICK_RANGE) continue;
      const sp = len2(v.sim.vx, v.sim.vz);
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
