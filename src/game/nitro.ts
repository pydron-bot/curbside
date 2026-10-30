/**
 * Nitro: a tank that fills by driving with style (drifting, near misses,
 * stunts) and empties while you boost (more power, a higher top speed; see
 * BOOST_ACCEL in vehicle.ts). Lighting it needs a little in the tank; once
 * lit it burns to empty or until you let go. Start and stop go out as
 * 'boost' events for the effects and sound. Pure logic.
 */
import type { EventBus } from '../core/events';

/** A full tank lasts this long, s. */
export const NITRO_SECONDS = 3.2;
/** It takes this much in the tank to light it. */
export const NITRO_MIN = 0.12;
/** Every run (and a respawn) starts with this much. */
export const NITRO_START = 0.5;
/** Refills: per second of drifting, per near miss, per stunt. */
export const NITRO_DRIFT = 0.14;
export const NITRO_NEAR_MISS = 0.15;
export const NITRO_STUNT = 0.3;

export class Nitro {
  /** 0..1 */
  charge = NITRO_START;
  boosting = false;

  constructor(private readonly bus: EventBus) {}

  add(amount: number): void {
    this.charge = Math.min(1, this.charge + Math.max(0, amount));
  }

  /**
   * One sim step: `want` is the boost held, `car` where the player drives
   * (null on foot). Returns true while boosting.
   */
  step(dt: number, want: boolean, car: { x: number; z: number } | null): boolean {
    const can = car !== null && want && (this.boosting ? this.charge > 0 : this.charge >= NITRO_MIN);
    if (can) this.charge = Math.max(0, this.charge - dt / NITRO_SECONDS);
    if (can !== this.boosting) {
      this.boosting = can;
      this.bus.emit({ type: 'boost', on: can, x: car?.x ?? 0, z: car?.z ?? 0 });
    }
    return can;
  }

  /** A fresh run: the starting tank, nothing burning. */
  reset(): void {
    if (this.boosting) this.bus.emit({ type: 'boost', on: false, x: 0, z: 0 });
    this.boosting = false;
    this.charge = NITRO_START;
  }
}
