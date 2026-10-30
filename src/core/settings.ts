/**
 * Player settings, persisted in localStorage. Read anywhere via `settings`;
 * change with `updateSettings`, which saves and notifies subscribers.
 */
export type QualityPreset = 'auto' | 'high' | 'medium' | 'low';
export type SteeringMode = 'directional' | 'classic';

export interface Settings {
  /** 0..1 */
  masterVolume: number;
  /** 0..1 */
  sfxVolume: number;
  /** 0..1 */
  musicVolume: number;
  quality: QualityPreset;
  /** Touch steering: stick points where to go (directional) or steers left/right (classic). */
  steering: SteeringMode;
  /** Mirror the touch layout for left-handed play. */
  leftHanded: boolean;
  haptics: boolean;
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.5,
  quality: 'auto',
  steering: 'directional',
  leftHanded: false,
  haptics: true,
  showFps: false,
};

const KEY = 'curbside.settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
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
