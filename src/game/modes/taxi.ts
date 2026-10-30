/**
 * TAXI FARES: get behind the wheel of a taxi and you're on duty. Every so
 * often someone on the pavement ahead hails you; stop beside them, they get
 * in, and the clock starts for their destination. The fare grows with the
 * distance and with the time to spare; every fifth fare in a row pays a
 * streak bonus. A passenger bails if the cab gets badly knocked about or the
 * police get interested (2★), and the streak is lost. Pure logic (fare
 * maths and the duty state machine), unit-tested; taxiMode.ts does the rest.
 */

export const FARE_BASE = 50;
/** Dollars per metre of trip. */
export const FARE_PER_M = 0.6;
/** Every STREAK_EVERY-th fare in a row adds STREAK_BONUS. */
export const STREAK_EVERY = 5;
export const STREAK_BONUS = 500;
/** Trips run this far (straight line), m. */
export const TRIP_RANGE = [250, 700] as const;
/** A hail comes this long after the last fare (or going on duty), s. */
export const HAIL_EVERY = [8, 15] as const;
/** Pick-up: stop this close to the fare, m, below this speed, m/s, for this long, s. */
export const PICKUP_RANGE = 6;
export const PICKUP_SPEED = 2;
export const PICKUP_HOLD = 1;
/** Drop-off: this close to the destination, m, below this speed. */
export const DROP_RANGE = 9;
export const DROP_SPEED = 3;
/** The passenger bails if the cab loses this share of its health on the trip... */
export const BAIL_DAMAGE = 0.25;
/** ...or the wanted level reaches this. */
export const BAIL_STARS = 2;
/** A hail no one answers lapses after this long, s. */
export const HAIL_PATIENCE = 30;

/** Seconds allowed for a trip of `dist` metres. */
export function tripTime(dist: number): number {
  return Math.round(15 + dist / 11);
}

/** The fare for a trip of `dist` m with `timeLeft` of `total` seconds to spare. */
export function fareFor(dist: number, timeLeft: number, total: number): number {
  const spare = total > 0 ? Math.max(0, Math.min(1, timeLeft / total)) : 0;
  return Math.round(FARE_BASE + FARE_PER_M * dist * (1 + spare));
}

/** The streak bonus for completing fare number `streak` in a row. */
export function streakBonus(streak: number): number {
  return streak > 0 && streak % STREAK_EVERY === 0 ? STREAK_BONUS : 0;
}

export type TaxiPhase = 'off' | 'cruising' | 'hailed' | 'boarding' | 'trip';
export type TaxiOutcome = 'fare' | 'late' | 'bailed' | 'lost';

/** What the cab is doing this step, as the glue sees it. */
export interface TaxiInput {
  /** The player is driving a taxi that isn't wrecked. */
  onDuty: boolean;
  x: number;
  z: number;
  speed: number;
  /** The cab's health, 0..1. */
  health: number;
  stars: number;
  /** Where the hailing fare stands (when hailed / boarding), or null if they're gone. */
  fare: { x: number; z: number } | null;
}

/**
 * The duty cycle: off → cruising → (a hail) hailed → (stopped beside them)
 * boarding → (they're in) trip → paid or failed → cruising. The glue picks
 * the hailing ped and the destination; this keeps the rules.
 */
export class TaxiDuty {
  phase: TaxiPhase = 'off';
  /** Fares in a row (lost on a failed trip or going off duty). */
  streak = 0;
  hailIn = 0;
  /** Seconds the hail has waited, or the cab has been stopped beside them. */
  waited = 0;
  held = 0;
  dest = { x: 0, z: 0 };
  tripDist = 0;
  timeTotal = 0;
  timeLeft = 0;
  healthAtPickup = 1;

  constructor(private readonly rand: () => number) {}

  /** Seconds to the next hail, drawn from HAIL_EVERY. */
  private nextHail(): number {
    return HAIL_EVERY[0] + this.rand() * (HAIL_EVERY[1] - HAIL_EVERY[0]);
  }

  /**
   * One step. Returns what the glue must act on: 'wantHail' (pick a fare
   * and call hailed()), 'board' (the fare gets in: pick a destination and
   * call startTrip()), a finished trip's outcome, or null.
   */
  step(dt: number, i: TaxiInput): 'wantHail' | 'board' | 'lapsed' | TaxiOutcome | null {
    if (!i.onDuty) {
      const was = this.phase;
      this.phase = 'off';
      if (was === 'trip') {
        this.streak = 0;
        return 'lost';
      }
      if (was !== 'off') this.streak = 0;
      return was === 'hailed' || was === 'boarding' ? 'lapsed' : null;
    }
    switch (this.phase) {
      case 'off':
        this.phase = 'cruising';
        this.hailIn = Math.min(4, this.nextHail()); // a first fare comes quickly
        return null;
      case 'cruising':
        if ((this.hailIn -= dt) <= 0) {
          this.hailIn = 2; // retry soon if no one's about
          return 'wantHail';
        }
        return null;
      case 'hailed':
      case 'boarding': {
        if (!i.fare || (this.waited += dt) > HAIL_PATIENCE) {
          this.phase = 'cruising';
          this.hailIn = this.nextHail();
          return 'lapsed';
        }
        const near = Math.hypot(i.x - i.fare.x, i.z - i.fare.z) < PICKUP_RANGE && i.speed < PICKUP_SPEED;
        this.held = near ? this.held + dt : 0;
        this.phase = near ? 'boarding' : 'hailed';
        if (this.held >= PICKUP_HOLD) return 'board';
        return null;
      }
      case 'trip': {
        this.timeLeft = Math.max(0, this.timeLeft - dt);
        if (this.healthAtPickup - i.health > BAIL_DAMAGE || i.stars >= BAIL_STARS) return this.endTrip('bailed');
        if (this.timeLeft <= 0) return this.endTrip('late');
        if (Math.hypot(i.x - this.dest.x, i.z - this.dest.z) < DROP_RANGE && i.speed < DROP_SPEED) return this.endTrip('fare');
        return null;
      }
    }
  }

  /** The glue found someone to hail. */
  hailed(): void {
    this.phase = 'hailed';
    this.waited = 0;
    this.held = 0;
  }

  /** The fare is in: the trip to (x, z), `dist` m away, starts now. */
  startTrip(x: number, z: number, dist: number, health: number): void {
    this.phase = 'trip';
    this.dest.x = x;
    this.dest.z = z;
    this.tripDist = dist;
    this.timeTotal = tripTime(dist);
    this.timeLeft = this.timeTotal;
    this.healthAtPickup = health;
  }

  /** What a successful trip pays now (fare plus any streak bonus); call after a 'fare' outcome. */
  payout(): { fare: number; bonus: number } {
    return { fare: fareFor(this.tripDist, this.timeLeft, this.timeTotal), bonus: streakBonus(this.streak) };
  }

  private endTrip(outcome: TaxiOutcome): TaxiOutcome {
    this.phase = 'cruising';
    this.hailIn = this.nextHail();
    this.streak = outcome === 'fare' ? this.streak + 1 : 0;
    return outcome;
  }
}
