/**
 * Stunt scoring for the player's car: from take-off to landing it times the
 * airtime, measures the distance flown and adds up the spin, then scores the
 * jump. Short hops (under MIN_AIRTIME) don't count. Pure logic.
 */
import { wrapAngle, type VehicleState } from '../entities/vehicle';

/** Jumps shorter than this (s in the air) aren't stunts. */
export const MIN_AIRTIME = 0.45;
/** Points per second in the air, per metre flown, per half-turn of spin. */
export const STUNT_PER_SECOND = 1000;
export const STUNT_PER_METRE = 20;
export const STUNT_PER_HALF_TURN = 500;
/** Ratings by points. */
const GREAT = 2000;
const INSANE = 3500;

export interface StuntResult {
  airtime: number;
  /** Ground distance from take-off to landing, m. */
  distance: number;
  /** Total rotation in the air, degrees (absolute). */
  spin: number;
  /** Highest point, m. */
  height: number;
  points: number;
  /** "STUNT", "GREAT STUNT", "INSANE STUNT", with "360" / "180" for spins. */
  label: string;
}

/** Points for a jump. */
export function stuntPoints(airtime: number, distance: number, spinDeg: number): number {
  const halfTurns = Math.floor((Math.abs(spinDeg) + 30) / 180);
  return Math.round(airtime * STUNT_PER_SECOND + distance * STUNT_PER_METRE + halfTurns * STUNT_PER_HALF_TURN);
}

/** The feed label for a jump worth `points` with `spinDeg` of spin. */
export function stuntLabel(points: number, spinDeg: number): string {
  const rating = points >= INSANE ? 'INSANE STUNT' : points >= GREAT ? 'GREAT STUNT' : 'STUNT';
  const turns = Math.floor((Math.abs(spinDeg) + 30) / 180);
  return turns >= 2 ? `${turns * 180} ${rating}` : turns === 1 ? `180 ${rating}` : rating;
}

export class StuntTracker {
  private flying = false;
  private airtime = 0;
  private spin = 0;
  private height = 0;
  private lastHeading = 0;
  private x0 = 0;
  private z0 = 0;
  private readonly result: StuntResult = { airtime: 0, distance: 0, spin: 0, height: 0, points: 0, label: '' };

  /** In the air right now (since a take-off this tracker saw). */
  get airborne(): boolean {
    return this.flying;
  }

  /**
   * One sim step for the player's car (after it moved). Returns the stunt
   * on the step it lands (a reused object), else null.
   */
  step(s: VehicleState, dt: number): StuntResult | null {
    if (s.airborne) {
      if (!this.flying) {
        this.flying = true;
        this.airtime = 0;
        this.spin = 0;
        this.height = s.y;
        this.x0 = s.x;
        this.z0 = s.z;
        this.lastHeading = s.heading;
      }
      this.airtime += dt;
      this.spin += wrapAngle(s.heading - this.lastHeading);
      this.lastHeading = s.heading;
      this.height = Math.max(this.height, s.y);
      return null;
    }
    if (!this.flying) return null;
    this.flying = false;
    if (this.airtime < MIN_AIRTIME) return null;
    const r = this.result;
    r.airtime = this.airtime;
    r.distance = Math.hypot(s.x - this.x0, s.z - this.z0);
    r.spin = Math.abs(this.spin) * (180 / Math.PI);
    r.height = this.height;
    r.points = stuntPoints(r.airtime, r.distance, r.spin);
    r.label = stuntLabel(r.points, r.spin);
    return r;
  }

  /** Forget a jump in progress (got out mid-air, the car blew up, a fresh run). */
  cancel(): void {
    this.flying = false;
  }
}
