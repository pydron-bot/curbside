/**
 * Time of day: a 24-hour clock that runs a full cycle in CYCLE_SECONDS of
 * play (12 minutes by default) and a keyframed sky — sun (or moon) direction,
 * colour and strength, sky/ground fill, fog, exposure and how "night" it is.
 * Pure (no three.js): `sampleSky` fills a plain SkyState that SceneLighting
 * applies to the scene. The game starts in the late afternoon so the first
 * minutes run through golden hour and sunset into night.
 *
 * Missions can pin the time: `time.set(22)` and `time.speed = 0`.
 */

/** Real seconds for a full 24-hour day. */
export const CYCLE_SECONDS = 12 * 60;
/** Where a new game starts: late afternoon, a minute or so before golden hour. */
export const START_HOUR = 17;

/** Hours of daylight: the sun drives the light between these, the moon outside. */
export const SUNRISE = 5.6;
export const SUNSET = 19.7;
/** The sun's highest elevation, radians (kept below overhead so shadows always read). */
const SUN_PEAK = (62 * Math.PI) / 180;
/** Lowest elevation used for the light direction, so dusk shadows don't swallow whole streets. */
const MIN_LIGHT_ELEVATION = (21 * Math.PI) / 180;
/** Moonlight comes from high in the south-east. */
const MOON_DIR = normalise([0.45, 1.25, 0.55]);

type Rgb = readonly [number, number, number];

/** Everything about the sky at one moment. Colours are sRGB 0..1. */
export interface SkyState {
  hour: number;
  /** Unit vector toward the light (sun by day, moon by night). */
  lightDir: [number, number, number];
  lightColor: [number, number, number];
  lightIntensity: number;
  /** Hemisphere fill: sky colour from above, ground bounce from below. */
  skyColor: [number, number, number];
  groundColor: [number, number, number];
  hemiIntensity: number;
  /** Fog colour (also the clear colour) and its range, m. */
  fogColor: [number, number, number];
  fogNear: number;
  fogFar: number;
  /** Tone-mapping exposure. */
  exposure: number;
  /** 0 by day, 1 at night: window glow, street lamps, headlights. */
  night: number;
  /** Strength of reflections on car paint and glass. */
  envIntensity: number;
  /** How much shadows darken (fades with the light). */
  shadowStrength: number;
}

interface Key {
  h: number;
  light: number;
  lightColor: Rgb;
  sky: Rgb;
  ground: Rgb;
  hemi: number;
  fog: Rgb;
  fogNear: number;
  fogFar: number;
  exposure: number;
  night: number;
  env: number;
}

const hex = (v: number): Rgb => [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];

/**
 * Keyframes over the day (hours, ascending; the list wraps at 24). The light
 * fades to 0 at SUNRISE and SUNSET, where its direction swaps between moon
 * and sun, so the swap is never seen.
 */
const KEYS: readonly Key[] = [
  { h: 0, light: 0.42, lightColor: hex(0x9fb4ff), sky: hex(0x31416e), ground: hex(0x15151d), hemi: 0.75, fog: hex(0x0d1424), fogNear: 46, fogFar: 150, exposure: 1.15, night: 1, env: 0.22 },
  { h: 4.6, light: 0.38, lightColor: hex(0x9fb4ff), sky: hex(0x33406a), ground: hex(0x17161d), hemi: 0.75, fog: hex(0x111a2c), fogNear: 46, fogFar: 150, exposure: 1.15, night: 1, env: 0.22 },
  { h: SUNRISE, light: 0, lightColor: hex(0xffb27a), sky: hex(0x6a6f96), ground: hex(0x2a2224), hemi: 0.75, fog: hex(0x3a3550), fogNear: 60, fogFar: 190, exposure: 1.12, night: 0.55, env: 0.4 },
  { h: 6.4, light: 1.1, lightColor: hex(0xffa968), sky: hex(0xa7a6c4), ground: hex(0x4a3a30), hemi: 0.85, fog: hex(0x9a8f9e), fogNear: 80, fogFar: 260, exposure: 1.05, night: 0.1, env: 0.75 },
  { h: 8, light: 2.3, lightColor: hex(0xffe2bd), sky: hex(0xb9cdf0), ground: hex(0x6b5a48), hemi: 0.9, fog: hex(0xa8bdd6), fogNear: 110, fogFar: 320, exposure: 1, night: 0, env: 1 },
  { h: 12.5, light: 2.75, lightColor: hex(0xfff1dc), sky: hex(0xbfd3ff), ground: hex(0x6e5e4c), hemi: 0.95, fog: hex(0xaec4dd), fogNear: 120, fogFar: 340, exposure: 1, night: 0, env: 1 },
  { h: 16.5, light: 2.6, lightColor: hex(0xffe4c0), sky: hex(0xb7c9ee), ground: hex(0x6d5a46), hemi: 0.9, fog: hex(0xb3bfd2), fogNear: 110, fogFar: 320, exposure: 1, night: 0, env: 1 },
  // Golden hour: low, warm, long shadows.
  { h: 18.2, light: 2.35, lightColor: hex(0xffb867), sky: hex(0xb4b3d6), ground: hex(0x6a4a36), hemi: 0.82, fog: hex(0xd9a77f), fogNear: 90, fogFar: 280, exposure: 1.04, night: 0, env: 0.95 },
  { h: 19.1, light: 1.15, lightColor: hex(0xff7f45), sky: hex(0x8c7fae), ground: hex(0x4a3036), hemi: 0.8, fog: hex(0xb06a5c), fogNear: 75, fogFar: 240, exposure: 1.1, night: 0.25, env: 0.7 },
  { h: SUNSET, light: 0, lightColor: hex(0xff6a45), sky: hex(0x5a5688), ground: hex(0x2c2230), hemi: 0.78, fog: hex(0x4c3a5a), fogNear: 60, fogFar: 200, exposure: 1.14, night: 0.62, env: 0.45 },
  { h: 20.6, light: 0.3, lightColor: hex(0x9fb4ff), sky: hex(0x3a4476), ground: hex(0x1a1822), hemi: 0.76, fog: hex(0x1a2036), fogNear: 50, fogFar: 165, exposure: 1.15, night: 0.92, env: 0.28 },
  { h: 22, light: 0.42, lightColor: hex(0x9fb4ff), sky: hex(0x31416e), ground: hex(0x15151d), hemi: 0.75, fog: hex(0x0d1424), fogNear: 46, fogFar: 150, exposure: 1.15, night: 1, env: 0.22 },
];

export function createSkyState(): SkyState {
  return {
    hour: 0,
    lightDir: [0, 1, 0],
    lightColor: [1, 1, 1],
    lightIntensity: 1,
    skyColor: [1, 1, 1],
    groundColor: [0, 0, 0],
    hemiIntensity: 1,
    fogColor: [0, 0, 0],
    fogNear: 100,
    fogFar: 300,
    exposure: 1,
    night: 0,
    envIntensity: 1,
    shadowStrength: 1,
  };
}

/** Wrap any hour into [0, 24). */
export function wrapHour(h: number): number {
  return ((h % 24) + 24) % 24;
}

/** Is the sun (rather than the moon) the light source at this hour? */
export function isDaylight(hour: number): boolean {
  const h = wrapHour(hour);
  return h >= SUNRISE && h < SUNSET;
}

/**
 * Unit vector toward the sun: rises in the east (+X), crosses the south (+Z,
 * so shadows fall toward the top of the screen at noon) and sets in the west.
 * Elevation is clamped at MIN_LIGHT_ELEVATION for the light direction.
 */
export function sunDirection(hour: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const t = Math.min(1, Math.max(0, (wrapHour(hour) - SUNRISE) / (SUNSET - SUNRISE)));
  const azimuth = t * Math.PI;
  const elevation = Math.max(MIN_LIGHT_ELEVATION, SUN_PEAK * Math.sin(t * Math.PI));
  out[0] = Math.cos(azimuth) * Math.cos(elevation);
  out[1] = Math.sin(elevation);
  out[2] = Math.sin(azimuth) * Math.cos(elevation);
  return out;
}

/** Fill `out` with the sky at `hour`. Allocation-free. */
export function sampleSky(hour: number, out: SkyState): SkyState {
  const h = wrapHour(hour);
  let i = KEYS.length - 1;
  for (let k = 0; k < KEYS.length; k++) if (KEYS[k].h <= h) i = k;
  const a = KEYS[i];
  const b = KEYS[(i + 1) % KEYS.length];
  const span = (b.h <= a.h ? b.h + 24 : b.h) - a.h;
  const t = smooth((h - a.h) / span);

  out.hour = h;
  out.lightIntensity = lerp(a.light, b.light, t);
  mix3(a.lightColor, b.lightColor, t, out.lightColor);
  mix3(a.sky, b.sky, t, out.skyColor);
  mix3(a.ground, b.ground, t, out.groundColor);
  out.hemiIntensity = lerp(a.hemi, b.hemi, t);
  mix3(a.fog, b.fog, t, out.fogColor);
  out.fogNear = lerp(a.fogNear, b.fogNear, t);
  out.fogFar = lerp(a.fogFar, b.fogFar, t);
  out.exposure = lerp(a.exposure, b.exposure, t);
  out.night = lerp(a.night, b.night, t);
  out.envIntensity = lerp(a.env, b.env, t);

  if (isDaylight(h)) sunDirection(h, out.lightDir);
  else {
    out.lightDir[0] = MOON_DIR[0];
    out.lightDir[1] = MOON_DIR[1];
    out.lightDir[2] = MOON_DIR[2];
  }
  // Shadows fade with the light so the direction swap at dusk/dawn is invisible.
  out.shadowStrength = Math.min(1, out.lightIntensity / (isDaylight(h) ? 1.2 : 0.3)) * (isDaylight(h) ? 0.92 : 0.6);
  return out;
}

/**
 * The game clock. `speed` is game hours per real second (default: a full
 * day in CYCLE_SECONDS); 0 freezes time.
 */
export class TimeOfDay {
  hour: number;
  speed = 24 / CYCLE_SECONDS;

  constructor(hour = START_HOUR) {
    this.hour = wrapHour(hour);
  }

  update(dt: number): void {
    this.hour = wrapHour(this.hour + dt * this.speed);
  }

  /** Jump to an hour (0..24), e.g. for a mission or testing. */
  set(hour: number): void {
    this.hour = wrapHour(hour);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function mix3(a: Rgb, b: Rgb, t: number, out: [number, number, number]): void {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
}

function normalise(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
