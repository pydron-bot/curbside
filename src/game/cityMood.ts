/**
 * The crowd's mood by the hour and the weather: how busy each district's
 * pavements are, how much nightlife is on, and how the rain moves people
 * along. Pure (no three.js), tested in tests/cityMood.test.ts.
 *
 * By day the crowd follows the shops and offices (downtown and the old
 * town busiest, the docks quietest); as the evening comes on it drains out
 * of the quiet districts (the docks, the suburbs, the emptying offices) and
 * into the bars and clubs of the Neon Mile and the old town. Rain takes
 * people off every street alike, and those left walk faster.
 *
 * main.ts keeps one CityMood: it writes the hour (render/timeOfDay.ts) and
 * the rain (render/fxWeather.ts WeatherCycle) into it each frame, crowd
 * upkeep reads `densityAt` and `weight`, and the city's scenes read it
 * through `CityLifeDeps.mood` (`nightlife` is the street races' cue).
 */
import { DISTRICTS, districtAt, type District } from '../world/districts';

/** How busy each district's pavements are by day, × the crowd target. */
const DAY: Readonly<Record<District, number>> = { downtown: 1.15, oldtown: 1, arts: 0.9, industrial: 0.55, residential: 0.8 };
/** ...and at the height of the night: the bars fill, the rest empties. */
const NIGHT: Readonly<Record<District, number>> = { downtown: 0.55, oldtown: 1.05, arts: 1.3, industrial: 0.22, residential: 0.3 };
/** How much each district has going on at night (bars, clubs, neon): where the loiterers stand. */
export const NIGHTLIFE: Readonly<Record<District, number>> = { downtown: 0.3, oldtown: 0.6, arts: 1, industrial: 0, residential: 0.1 };
/** Full rain takes this share of people off the street. */
export const RAIN_THIN = 0.45;
/** Full rain speeds walkers up by this share (capped at a brisk walk). */
export const RAIN_HURRY = 0.5;
/** Densities never fall below / rise above these (a street is never quite empty). */
const MIN_DENSITY = 0.15;
const MAX_DENSITY = 1.4;

/**
 * How much nightlife is on at `hour` (0..24): 0 by day, easing in from 18:00
 * to full at 22:00, full until 03:00, gone by 06:00.
 */
export function nightlifeFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 18 && h < 22) return smooth((h - 18) / 4);
  if (h >= 22 || h < 3) return 1;
  if (h < 6) return 1 - smooth((h - 3) / 3);
  return 0;
}

/**
 * The crowd density in `district` at `hour` with `rain` (0..1) falling, as
 * a multiplier on the crowd target (1: the usual street).
 */
export function densityFor(district: District, hour: number, rain: number): number {
  const n = nightlifeFactor(hour);
  const d = DAY[district] + (NIGHT[district] - DAY[district]) * n;
  const wet = 1 - RAIN_THIN * clamp01(rain);
  return Math.max(MIN_DENSITY, Math.min(MAX_DENSITY, d * wet));
}

/** How much nightlife `district` has at `hour`, 0..1 (its bars × how late it is). */
export function nightlifeAt(district: District, hour: number): number {
  return NIGHTLIFE[district] * nightlifeFactor(hour);
}

/** A walker's pace in `rain` (0..1): brisker the harder it falls, never past a fast walk (1). */
export function rainPace(pace: number, rain: number): number {
  return Math.min(1, pace * (1 + RAIN_HURRY * clamp01(rain)));
}

/**
 * The mood now: the hour and the rain, and every district's density for
 * them (recomputed when either changes; reading allocates nothing).
 */
export class CityMood {
  /** Hour of the day, 0..24. */
  hour = 17;
  /** How hard it's raining, 0..1. */
  rain = 0;
  /** How much nightlife is on, 0..1: nightlifeFactor(hour). The street-race scene's cue. */
  nightlife = 0;
  private readonly densities = new Float32Array(DISTRICTS.length);
  private peak = 1;
  private ready = false;

  constructor(hour = 17, rain = 0) {
    this.set(hour, rain);
  }

  /** The sky now (per frame; cheap when nothing changed). */
  set(hour: number, rain: number): void {
    if (hour === this.hour && rain === this.rain && this.ready) return;
    this.ready = true;
    this.hour = hour;
    this.rain = rain;
    this.nightlife = nightlifeFactor(hour);
    let peak = 0;
    for (let i = 0; i < DISTRICTS.length; i++) {
      const d = densityFor(DISTRICTS[i], hour, rain);
      this.densities[i] = d;
      if (d > peak) peak = d;
    }
    this.peak = peak;
  }

  /** Is it raining enough for people to notice? */
  get raining(): boolean {
    return this.rain > 0.2;
  }

  /** Crowd density in `district` now. */
  density(district: District): number {
    return this.densities[DISTRICTS.indexOf(district)];
  }

  /** Crowd density at (x, z) now: its district's. */
  densityAt(x: number, z: number): number {
    return this.density(districtAt(x, z));
  }

  /** Nightlife at (x, z) now, 0..1. */
  nightlifeAt(x: number, z: number): number {
    return NIGHTLIFE[districtAt(x, z)] * this.nightlife;
  }

  /**
   * Share of crowd spawns kept at (x, z), 0..1: its district's density
   * against the busiest district's now, so new people gather where the
   * life is. Bound once: pass it to crowd upkeep as it is.
   */
  readonly weight = (x: number, z: number): number => this.densityAt(x, z) / this.peak;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}
