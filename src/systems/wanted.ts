/**
 * The wanted level: a heat value 0..5 whose whole part is the star count.
 * Witnessed crimes add heat; civilians alone can only push it to 3 stars,
 * 4 and 5 need attacks on the police. Once no cop has seen the player for a
 * while the stars blink, then drop one level at a time; a sighting (or a new
 * crime) restarts the clock. Pure rules (no three.js): the caller decides
 * what counts as witnessed and seen, this decides what it costs.
 */
import type { EventBus } from '../core/events';

export type Crime =
  /** A civilian knocked down by the player (punch, shot, run over, blast). */
  | 'assault'
  | 'carjack'
  /** One shot fired (capped per window, see GUNFIRE_CAP). */
  | 'gunfire'
  /** An explosion the player caused. */
  | 'explosion'
  /** Rammed a police car. */
  | 'ramCop'
  /** Put a bullet into a police car (capped per window like gunfire). */
  | 'shootCop'
  /** Knocked down a police officer. */
  | 'copDown'
  /** Blew up a police car. */
  | 'copCarWrecked'
  /** Drove off in a police car: at least one star, witnessed or not. */
  | 'copCarStolen';

/** Why the level changed (on the 'wanted' event). */
export type WantedReason = 'crime' | 'lost' | 'evaded' | 'respray' | 'busted' | 'died' | 'reset';

export const MAX_HEAT = 5;
/** Heat each crime adds. */
export const CRIME_HEAT: Record<Crime, number> = {
  assault: 0.3,
  carjack: 0.35,
  gunfire: 0.05,
  explosion: 0.6,
  ramCop: 0.6,
  shootCop: 0.15,
  copDown: 1,
  copCarWrecked: 1,
  copCarStolen: 0,
};
/** Crimes against the police: the only way past 3 stars. */
const AGAINST_POLICE: ReadonlySet<Crime> = new Set<Crime>(['ramCop', 'shootCop', 'copDown', 'copCarWrecked', 'copCarStolen']);
/** Crimes against civilians raise heat to just under 4 stars at most. */
export const CIVILIAN_CAP = 3.999;
/** A crime within this distance of a cop (m) is witnessed even off-screen. */
export const WITNESS_RANGE = 60;
/** Gunfire adds at most GUNFIRE_CAP heat per GUNFIRE_WINDOW seconds (an SMG burst isn't 4 stars). */
export const GUNFIRE_CAP = 0.5;
export const GUNFIRE_WINDOW = 5;
/** Bullets into police cars: at most this much per window. */
export const SHOOT_COP_CAP = 0.6;
/** Unseen this long, the stars start blinking (a corner turned isn't lost yet), s. */
export const SEARCH_AFTER = 1.5;
/** Seconds unseen to drop one star: EVADE_BASE + EVADE_PER_STAR per star held. */
export const EVADE_BASE = 6;
export const EVADE_PER_STAR = 3;
/** Below one star, heat fades this fast (per second)... */
export const COOL_RATE = 0.03;
/** ...once this long has passed since the last crime, s. */
export const COOL_AFTER = 10;

/** Seconds out of sight it takes to lose one star while holding `stars`. */
export function evadeSeconds(stars: number): number {
  return EVADE_BASE + EVADE_PER_STAR * stars;
}

export function starsFor(heat: number): number {
  return Math.max(0, Math.min(MAX_HEAT, Math.floor(heat + 1e-9)));
}

export class Wanted {
  /** 0..MAX_HEAT; stars = floor(heat). */
  heat = 0;
  /** Seconds since any cop last saw the player (only counts while wanted). */
  unseen = 0;
  /** Highest level reached in the current chase (for the EVADED bonus); 0 when clean. */
  peak = 0;
  private time = 0;
  private lastCrime = -Infinity;
  private readonly gunfire = new Allowance(GUNFIRE_CAP);
  private readonly shootCop = new Allowance(SHOOT_COP_CAP);

  constructor(private readonly bus: EventBus) {}

  get level(): number {
    return starsFor(this.heat);
  }

  /** Out of sight long enough that the stars blink (the search is on). */
  get searching(): boolean {
    return this.level > 0 && this.unseen >= SEARCH_AFTER;
  }

  /** 0..1 progress toward losing the current star. */
  get evadeProgress(): number {
    const lvl = this.level;
    return lvl > 0 ? Math.min(1, this.unseen / evadeSeconds(lvl)) : 0;
  }

  /**
   * Report a crime. Unwitnessed crimes cost nothing (stealing a police car
   * always does: it has a radio). Returns true if the heat went up.
   */
  commit(crime: Crime, witnessed: boolean): boolean {
    if (!witnessed && crime !== 'copCarStolen') return false;
    const before = this.heat;
    const prev = this.level;
    this.lastCrime = this.time;
    // Seen doing it: the evasion clock starts over.
    if (witnessed) this.unseen = 0;
    if (crime === 'copCarStolen') {
      this.heat = Math.max(this.heat, 1);
    } else {
      let amount = CRIME_HEAT[crime];
      if (crime === 'gunfire') amount = this.gunfire.take(amount, this.time);
      else if (crime === 'shootCop') amount = this.shootCop.take(amount, this.time);
      const cap = AGAINST_POLICE.has(crime) ? MAX_HEAT : CIVILIAN_CAP;
      // A capped crime never lowers heat earned elsewhere.
      if (this.heat < cap) this.heat = Math.min(cap, this.heat + amount);
    }
    this.raised(prev);
    return this.heat > before;
  }

  /**
   * Advance one step. `seen`: some cop (car, officer, helicopter) can see
   * the player right now. Out of sight long enough, the level drops a star.
   */
  step(dt: number, seen: boolean): void {
    this.time += dt;
    const lvl = this.level;
    if (lvl === 0) {
      this.unseen = 0;
      if (this.heat > 0 && this.time - this.lastCrime > COOL_AFTER) this.heat = Math.max(0, this.heat - COOL_RATE * dt);
      return;
    }
    if (seen) {
      this.unseen = 0;
      return;
    }
    this.unseen += dt;
    if (this.unseen < evadeSeconds(lvl)) return;
    // Lost them for now: one star down, and the clock starts on the next.
    this.unseen = 0;
    this.heat = lvl - 1;
    if (lvl - 1 === 0) {
      this.bus.emit({ type: 'wanted', level: 0, prev: lvl, reason: 'evaded' });
      // The bonus listener has read it; the chase is over.
      this.peak = 0;
    } else {
      this.bus.emit({ type: 'wanted', level: lvl - 1, prev: lvl, reason: 'lost' });
    }
  }

  /** Straight to zero (respray, busted, died, fresh run). */
  clear(reason: WantedReason): void {
    const prev = this.level;
    this.heat = 0;
    this.unseen = 0;
    this.lastCrime = -Infinity;
    this.gunfire.reset();
    this.shootCop.reset();
    if (prev > 0) this.bus.emit({ type: 'wanted', level: 0, prev, reason });
    this.peak = 0;
  }

  /** Set the level outright (debugging, scripted chases). */
  force(stars: number): void {
    const prev = this.level;
    this.heat = Math.max(0, Math.min(MAX_HEAT, stars));
    this.unseen = 0;
    this.lastCrime = this.time;
    if (this.level > prev) this.raised(prev);
    else if (this.level < prev) this.bus.emit({ type: 'wanted', level: this.level, prev, reason: this.level === 0 ? 'reset' : 'lost' });
  }

  private raised(prev: number): void {
    const lvl = this.level;
    if (lvl <= prev) return;
    this.peak = Math.max(this.peak, lvl);
    this.bus.emit({ type: 'wanted', level: lvl, prev, reason: 'crime' });
  }
}

/** Heat a repeated crime may add per GUNFIRE_WINDOW (each window starts with its first use). */
class Allowance {
  private from = -Infinity;
  private used = 0;

  constructor(private readonly cap: number) {}

  /** How much of `amount` still fits in the current window (and use it). */
  take(amount: number, now: number): number {
    if (now - this.from >= GUNFIRE_WINDOW) {
      this.from = now;
      this.used = 0;
    }
    const add = Math.max(0, Math.min(amount, this.cap - this.used));
    this.used += add;
    return add;
  }

  reset(): void {
    this.from = -Infinity;
    this.used = 0;
  }
}
