/**
 * Player settings, persisted in localStorage. Read anywhere via `settings`;
 * change with `updateSettings`, which saves and notifies subscribers.
 */
export type QualityPreset = 'auto' | 'high' | 'medium' | 'low';
export type SteeringMode = 'directional' | 'classic';
export type PerfOverlay = 'off' | 'fps' | 'full';

export const QUALITY_PRESETS: readonly QualityPreset[] = ['auto', 'high', 'medium', 'low'];
export const STEERING_MODES: readonly SteeringMode[] = ['directional', 'classic'];
export const PERF_OVERLAYS: readonly PerfOverlay[] = ['off', 'fps', 'full'];

export interface Settings {
  /** 0..1 */
  masterVolume: number;
  /** 0..1 */
  sfxVolume: number;
  /** 0..1 */
  musicVolume: number;
  /** iOS: play sound even with the ring/silent switch on (audio session 'playback' vs 'ambient'). */
  ignoreSilentSwitch: boolean;
  quality: QualityPreset;
  /** Touch steering: stick points where to go (directional) or steers left/right (classic). */
  steering: SteeringMode;
  /** Mirror the touch layout for left-handed play. */
  leftHanded: boolean;
  haptics: boolean;
  /** Frame-time overlay over the game: off, one fps line, or full stats. */
  perfOverlay: PerfOverlay;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.5,
  ignoreSilentSwitch: true,
  quality: 'auto',
  steering: 'directional',
  leftHanded: false,
  haptics: true,
  perfOverlay: 'off',
};

const KEY = 'curbside.settings';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Any parsed JSON (or nothing) → valid settings. A field that is missing, the
 * wrong type or a value this build doesn't know (a renamed preset, a newer
 * tab's choice, a hand edit) falls back to its default on its own, so a bad
 * value can't stop the game booting. Keys this build doesn't know are carried
 * through, so an older build's next write keeps a newer one's settings.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!isObj(raw)) return out;
  const known = out as unknown as Obj;
  for (const [k, v] of Object.entries(raw)) if (!(k in known)) known[k] = v;
  for (const k of ['masterVolume', 'sfxVolume', 'musicVolume'] as const) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v));
  }
  for (const k of ['ignoreSilentSwitch', 'leftHanded', 'haptics'] as const) {
    const v = raw[k];
    if (typeof v === 'boolean') out[k] = v;
  }
  if (QUALITY_PRESETS.includes(raw.quality as QualityPreset)) out.quality = raw.quality as QualityPreset;
  if (STEERING_MODES.includes(raw.steering as SteeringMode)) out.steering = raw.steering as SteeringMode;
  // The old Show FPS switch becomes the one-line overlay (its key is carried through for older builds).
  if (PERF_OVERLAYS.includes(raw.perfOverlay as PerfOverlay)) out.perfOverlay = raw.perfOverlay as PerfOverlay;
  else if (raw.showFps === true) out.perfOverlay = 'fps';
  return out;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch {
    // Unavailable or corrupt storage: fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export const settings: Settings = load();

const listeners: Array<(s: Settings) => void> = [];

export function onSettingsChange(fn: (s: Settings) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private mode / blocked storage: settings last for this session only.
  }
  for (const fn of listeners) fn(settings);
}
