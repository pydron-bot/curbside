/**
 * Live touch tuning for the device session: the touch-feel numbers that were
 * module constants (stick size and shaping, point-to-steer gain, pedal reach
 * and size), adjustable from the Diagnostics sheet without a redeploy, so
 * "the stick feels twitchy" comes back as a number to bake in. Readers read
 * `tune` at use time (plain fields: no allocation). Tuning only applies while
 * the Diagnostics sheet is available (Perf overlay on, or ?debug); otherwise
 * `tune` holds the defaults, so a bad stored value can't follow a player who
 * turned diagnostics off. Every value is clamped and snapped to its step.
 */
import type { KeyValueStore } from './sessionLog';

export const TUNE_KEY = 'curbside.tune';

export type TuneKey =
  | 'stickR'
  | 'steerDz'
  | 'steerExpo'
  | 'driveDz'
  | 'walkDz'
  | 'dirGain'
  | 'dirDeadzone'
  | 'aimR'
  | 'aimDz'
  | 'pedalReach'
  | 'pedalScale';

export interface TuneSpec {
  key: TuneKey;
  label: string;
  def: number;
  min: number;
  max: number;
  step: number;
  unit: string;
}

/** In the order the sheet shows them. Defaults are the shipped constants. */
export const TUNE_SPECS: readonly TuneSpec[] = [
  { key: 'stickR', label: 'STICK RADIUS', def: 58, min: 40, max: 84, step: 2, unit: 'px' },
  { key: 'dirGain', label: 'STEER GAIN (POINT)', def: 2.2, min: 1, max: 4, step: 0.1, unit: '' },
  { key: 'dirDeadzone', label: 'STEER DEADZONE (POINT)', def: 0.1, min: 0, max: 0.3, step: 0.01, unit: '' },
  { key: 'steerDz', label: 'STEER DEADZONE (CLASSIC)', def: 0.08, min: 0, max: 0.3, step: 0.01, unit: '' },
  { key: 'steerExpo', label: 'STEER EXPO (CLASSIC)', def: 1.5, min: 1, max: 3, step: 0.1, unit: '' },
  { key: 'driveDz', label: 'DRIVE DEADZONE', def: 0.1, min: 0, max: 0.3, step: 0.01, unit: '' },
  { key: 'walkDz', label: 'WALK DEADZONE', def: 0.08, min: 0, max: 0.3, step: 0.01, unit: '' },
  { key: 'aimR', label: 'AIM RADIUS', def: 52, min: 36, max: 80, step: 2, unit: 'px' },
  { key: 'aimDz', label: 'AIM DEADZONE', def: 0.14, min: 0, max: 0.4, step: 0.01, unit: '' },
  { key: 'pedalReach', label: 'PEDAL REACH', def: 1.45, min: 1, max: 2, step: 0.05, unit: '×r' },
  { key: 'pedalScale', label: 'PEDAL SIZE', def: 1, min: 0.8, max: 1.3, step: 0.05, unit: '×' },
];

export type TuneValues = Record<TuneKey, number>;

const SPEC = new Map<TuneKey, TuneSpec>(TUNE_SPECS.map((s) => [s.key, s]));

export const TUNE_DEFAULTS: Readonly<TuneValues> = Object.freeze(
  Object.fromEntries(TUNE_SPECS.map((s) => [s.key, s.def])) as TuneValues,
);

/** The live values every reader uses: the defaults unless tuning is enabled. */
export const tune: TuneValues = { ...TUNE_DEFAULTS };

/** What the player set (applied only while enabled). */
const chosen: TuneValues = { ...TUNE_DEFAULTS };
let enabled = false;
let store: KeyValueStore | null = null;
const listeners: Array<() => void> = [];

/** `v` clamped to the key's range and snapped to its step (non-numbers give the default). */
export function clampTune(key: TuneKey, v: unknown): number {
  const s = SPEC.get(key)!;
  if (typeof v !== 'number' || !Number.isFinite(v)) return s.def;
  const snapped = s.min + Math.round((v - s.min) / s.step) * s.step;
  const c = Math.min(s.max, Math.max(s.min, snapped));
  // Rounded to the step's decimals: 0.1 + 0.2 shows as 0.3.
  return Number(c.toFixed(decimals(s.step)));
}

/** A stored object to values: unknown keys dropped, bad values defaulted, everything clamped. */
export function sanitiseTune(raw: unknown): TuneValues {
  const out = { ...TUNE_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const s of TUNE_SPECS) if (s.key in r) out[s.key] = clampTune(s.key, r[s.key]);
  return out;
}

/** Reads the stored values (kept in `chosen`; applied once enabled). */
export function loadTune(kv: KeyValueStore | null): void {
  store = kv;
  let raw: unknown = null;
  try {
    const text = kv?.getItem(TUNE_KEY);
    if (text) raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  Object.assign(chosen, sanitiseTune(raw));
  apply();
}

/** On while the Diagnostics sheet is available (Perf overlay on, or ?debug). */
export function setTuneEnabled(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  apply();
}

export function tuneEnabled(): boolean {
  return enabled;
}

/** The player's value for `key` (what the sheet shows, even while disabled). */
export function tuneValue(key: TuneKey): number {
  return chosen[key];
}

/** One step up (+1) or down (−1); returns the new value. */
export function stepTune(key: TuneKey, dir: 1 | -1): number {
  return setTune(key, chosen[key] + dir * SPEC.get(key)!.step);
}

export function setTune(key: TuneKey, v: number): number {
  chosen[key] = clampTune(key, v);
  save();
  apply();
  return chosen[key];
}

/** Everything back to the shipped constants. */
export function resetTune(): void {
  Object.assign(chosen, TUNE_DEFAULTS);
  save();
  apply();
}

/** The values that differ from the defaults (for the report: these are the numbers to bake in). */
export function changedTune(): Partial<TuneValues> {
  const out: Partial<TuneValues> = {};
  for (const s of TUNE_SPECS) if (chosen[s.key] !== s.def) out[s.key] = chosen[s.key];
  return out;
}

/** One line for the report summary. */
export function tuneSummary(): string {
  const c = changedTune();
  const parts = TUNE_SPECS.filter((s) => s.key in c).map((s) => `${s.key} ${c[s.key]}`);
  return `TUNE ${parts.length ? parts.join(' · ') : 'defaults'}${parts.length && !enabled ? ' (inactive)' : ''}`;
}

/** Called after any change to the live values (CSS sizes follow it). */
export function onTuneChange(cb: () => void): void {
  listeners.push(cb);
}

/** The value as the sheet shows it. */
export function formatTune(key: TuneKey, v = chosen[key]): string {
  const s = SPEC.get(key)!;
  return `${v.toFixed(decimals(s.step))}${s.unit ? ` ${s.unit}` : ''}`;
}

function apply(): void {
  Object.assign(tune, enabled ? chosen : TUNE_DEFAULTS);
  for (const cb of listeners) cb();
}

function save(): void {
  try {
    store?.setItem(TUNE_KEY, JSON.stringify(changedTune()));
  } catch {
    // Full or blocked storage: the values still hold for this session.
  }
}

function decimals(step: number): number {
  const t = String(step);
  const i = t.indexOf('.');
  return i < 0 ? 0 : t.length - i - 1;
}
