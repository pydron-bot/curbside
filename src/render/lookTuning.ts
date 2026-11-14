/**
 * The LOOK panel's sliders (TEST → LOOK; ui/lookPanel.ts): plain-named
 * strengths and colour turns over the look's code constants, so the owner
 * can tune the look and hand back a `look.json` to ship, the way the map
 * editor's city.json works.
 *
 * Three layers: the code's constants (every slider's `def`: 1 = as written,
 * a hue 0), the shipped `src/render/look.json` over them (bundled; its values
 * are what each slider shows its distance from), and the owner's own values
 * over that, kept in localStorage. `look` holds the live values; readers read
 * it at use time (plain fields: no allocation), and `onLookChange` tells the
 * few that rebuild something (the sky's keys, the grade's uniform).
 *
 * Pure: no three.js, no DOM (the store is passed in).
 */
import type { KeyValueStore } from '../core/sessionLog';

export const LOOK_KEY = 'curbside.look';
export const LOOK_FILE_VERSION = 1;

export type LookGroup = 'sky' | 'grade' | 'night' | 'day' | 'read' | 'camera';

export const LOOK_GROUPS: ReadonlyArray<readonly [LookGroup, string]> = [
  ['sky', 'SKY & LIGHT'],
  ['grade', 'COLOUR GRADE'],
  ['night', 'NEON & NIGHT'],
  ['day', 'DAYTIME'],
  ['read', 'PEOPLE & ROOFS'],
  ['camera', 'CAMERA (TRIAL)'],
];

export interface LookSpec {
  key: string;
  label: string;
  group: LookGroup;
  /** The code's value: 1 for a strength (shown as 100%), 0 for a hue turn (degrees) or a shift (±%). */
  def: number;
  min: number;
  max: number;
  step: number;
  unit: '%' | '°';
  /** What it changes, in a few words (under the label). */
  hint: string;
  /** Only shows on desktop (bloom): phones have no bloom. */
  desktopOnly?: boolean;
}

const pct = <K extends string>(key: K, label: string, group: LookGroup, hint: string, min = 0, max = 2, extra: Partial<Omit<LookSpec, 'key'>> = {}): LookSpec & { key: K } => ({
  key,
  label,
  group,
  def: 1,
  min,
  max,
  step: 0.01,
  unit: '%',
  hint,
  ...extra,
});
/** A shift either way from the code's colour, −100%..+100% (0 = as written). */
const shift = <K extends string>(key: K, label: string, group: LookGroup, hint: string): LookSpec & { key: K } => ({ key, label, group, def: 0, min: -1, max: 1, step: 0.01, unit: '%', hint });
const deg = <K extends string>(key: K, label: string, group: LookGroup, hint: string): LookSpec & { key: K } => ({ key, label, group, def: 0, min: -40, max: 40, step: 1, unit: '°', hint });

/** People are drawn this much larger than life by default (PEOPLE SIZE). */
export const PEOPLE_SCALE = 1.35;

/** The camera trial's presets (LOOK panel chips): tilt, on-foot height and field of view. */
export const CAMERA_PRESETS: ReadonlyArray<{ label: string; cameraTilt: number; footHeight: number; fieldOfView: number }> = [
  { label: 'TODAY 0.12', cameraTilt: 0.12, footHeight: 1, fieldOfView: 1 },
  { label: 'TILT 0.2', cameraTilt: 0.2, footHeight: 1, fieldOfView: 1 },
  { label: 'TILT 0.3', cameraTilt: 0.3, footHeight: 1.1, fieldOfView: 1 },
];

/** In the order the panel shows them. */
export const LOOK_SPECS = [
  // Sky and light: per part of the day (timeOfDay.ts KEYS, by band).
  pct('nightBrightness', 'NIGHT BRIGHTNESS', 'sky', 'The whole picture, 20:30–04:30', 0.5, 1.6),
  pct('moonlight', 'MOONLIGHT', 'sky', 'The cyan moon: night shadows and edges'),
  pct('nightFill', 'NIGHT FILL LIGHT', 'sky', 'Violet sky light that keeps dark streets readable'),
  deg('nightHue', 'NIGHT COLOUR', 'sky', 'Blue ← → violet'),
  pct('dawnBrightness', 'DAWN BRIGHTNESS', 'sky', '05:30–06:30', 0.5, 1.6),
  pct('dawnWarmth', 'DAWN WARMTH', 'sky', 'How orange the morning sun and haze are'),
  pct('dayBrightness', 'DAY BRIGHTNESS', 'sky', '08:00–16:30', 0.5, 1.6),
  pct('sunlight', 'SUNLIGHT STRENGTH', 'sky', 'Sun against sky fill: how deep shadows look'),
  pct('skyBlue', 'DAYTIME SKY BLUENESS', 'sky', 'Sky fill and distant haze'),
  pct('goldenBrightness', 'GOLDEN HOUR BRIGHTNESS', 'sky', 'Around 18:00', 0.5, 1.6),
  pct('goldenWarmth', 'GOLDEN HOUR WARMTH', 'sky', 'How orange the low sun is'),
  deg('sunsetPink', 'SUNSET PINKNESS', 'sky', 'Orange ← → magenta, 19:00–20:00'),
  pct('sunsetColour', 'SUNSET COLOUR STRENGTH', 'sky', 'How vivid the sunset is'),
  pct('duskBrightness', 'DUSK BRIGHTNESS', 'sky', 'The dip between sunset and night', 0.5, 1.6),
  pct('dayHaze', 'DAY HAZE DISTANCE', 'sky', 'Where the distance fades by day: more is clearer', 0.5, 2),
  pct('nightHaze', 'NIGHT HAZE DISTANCE', 'sky', 'Where the distance fades at night: more is clearer', 0.5, 2),
  pct('shadowDarkness', 'SHADOW DARKNESS', 'sky', 'Sun and moon shadows', 0, 1.6),
  pct('carShine', 'CAR SHINE', 'sky', 'Reflections in paint and glass'),
  // The colour grade, all hours (post.ts GRADE).
  pct('exposure', 'OVERALL BRIGHTNESS', 'grade', 'Every hour', 0.5, 1.6),
  pct('saturation', 'COLOUR SATURATION', 'grade', 'Mid-tones and highlights'),
  pct('darkSaturation', 'DARK SATURATION', 'grade', 'How colourful the darks are'),
  pct('violetShadows', 'VIOLET SHADOWS', 'grade', 'The violet-indigo tint in the darks', 0, 3),
  pct('roseHighlights', 'ROSE HIGHLIGHTS', 'grade', 'The warm rose tint in the brights', 0, 3),
  pct('pinkMids', 'PINK MID-TONES', 'grade', "A touch of the logo's pink", 0, 3),
  pct('contrast', 'CONTRAST', 'grade', 'Darks darker and brights brighter', 0.6, 1.5),
  // Neon and night.
  pct('neon', 'NEON STRENGTH', 'night', 'Shopfront and rooftop tubes, signs'),
  pct('neonHalos', 'NEON HALOS', 'night', 'The glow round tubes, signs and lamps'),
  pct('windows', 'LIT WINDOWS', 'night', 'Windows after dark'),
  pct('lamps', 'STREET LAMP BRIGHTNESS', 'night', 'The pools of lamp light'),
  shift('lampWhite', 'STREET LAMP COLOUR', 'night', 'Amber ← → white'),
  pct('wetSheen', 'WET ROAD SHEEN', 'night', 'Damp patches and lamp streaks'),
  pct('neonReflect', 'NEON IN THE ROAD', 'night', 'Coloured reflections of neon and signals'),
  pct('headlights', 'HEADLIGHTS', 'night', 'Beams, tail and brake lights'),
  pct('underglow', 'UNDERGLOW & TRAILS', 'night', 'Car underglow and light trails'),
  pct('searchlights', 'SEARCHLIGHTS', 'night', "Downtown's sweeping beams"),
  pct('steam', 'STEAM', 'night', 'Steam from the street vents'),
  pct('sirenWash', 'POLICE LIGHT WASH', 'night', 'Red and blue on walls and road'),
  pct('bloom', 'DESKTOP BLOOM', 'night', 'Glow bleeding round bright lights', 0, 2, { desktopOnly: true }),
  // Daytime.
  pct('cloudShadow', 'CLOUD SHADOW DARKNESS', 'day', 'The drifting cloud shadows', 0, 2.5),
  pct('cloudCover', 'CLOUD COVER', 'day', 'How much of the ground is under cloud', 0, 2.5),
  pct('flyerShadow', 'PLANE & BLIMP SHADOWS', 'day', 'Their shadows passing over'),
  pct('glints', 'SUN GLINTS', 'day', 'Sun off cars, glass and metal roofs'),
  pct('treeSway', 'TREE SWAY', 'day', 'Trees bending in the wind', 0, 2.5),
  pct('dapple', 'DAPPLED LIGHT', 'day', 'Sun through the tree shadows'),
  pct('fountains', 'FOUNTAIN SPRAY', 'day', 'Plumes and rim arcs'),
  pct('sprinklers', 'SPRINKLERS', 'day', 'Park sprinklers'),
  pct('rainbow', 'RAINBOW', 'day', 'In the fountain spray', 0, 3),
  pct('mist', 'MIST THICKNESS', 'day', 'Morning mist, 05:00–08:15', 0, 2.5),
  pct('mistSpread', 'MIST OUTSIDE THE OLD TOWN', 'day', 'Other districts get a fifth as much', 0, 5),
  pct('gullSize', 'GULL SIZE', 'day', 'The seagulls at the docks', 0.5, 2),
  pct('streetArt', 'STREET ART', 'day', 'Crossings, murals, logos, bay numbers', 0, 2.5),
  pct('billboards', 'BILLBOARDS BY DAY', 'day', 'How strongly the painted adverts show'),
  // Readability (V3 stage 1): people drawn larger than life (drawing only:
  // the sim, collisions, doors and seats are life size), lit edges, hostiles
  // marked; roofs a step back by day so the street leads.
  pct('peopleScale', 'PEOPLE SIZE', 'read', 'Drawn size against life size (100%)', 1, 1.6, { def: PEOPLE_SCALE }),
  pct('peopleRim', 'PEOPLE EDGE LIGHT', 'read', 'A lit outline that lifts people off the street', 0, 2.5),
  pct('hostileMark', 'HOSTILE MARKING', 'read', 'Red edge and ring on anyone coming for you', 0, 2),
  pct('roofStepBack', 'ROOFS STEP BACK', 'read', 'Day roofs darker and greyer (0% = as before)', 0, 2),
  // The camera trial (owner's choice on the phone); the code's values are today's camera.
  pct('cameraTilt', 'CAMERA TILT', 'camera', 'How far behind the camera sits, share of its height', 0.08, 0.4, { def: 0.12 }),
  pct('footHeight', 'ON-FOOT HEIGHT', 'camera', 'Camera height on foot', 0.7, 1.4),
  pct('fieldOfView', 'FIELD OF VIEW', 'camera', 'Lens width (100% = 45°)', 0.8, 1.3),
] as const satisfies readonly LookSpec[];

export type LookKey = (typeof LOOK_SPECS)[number]['key'];

/**
 * Sliders the world's shaders read (shaderLib `uLook`, vec4[4]): each slot
 * holds the value minus the code's (so an all-zero uniform is the code's
 * look), read in GLSL through its macro, e.g. LK_NEON = 1.0 + uLook[0].x.
 */
export const SHADER_LOOK: ReadonlyArray<readonly [LookKey, string]> = [
  ['neon', 'LK_NEON'],
  ['neonHalos', 'LK_HALOS'],
  ['windows', 'LK_WINDOWS'],
  ['wetSheen', 'LK_WET'],
  ['cloudShadow', 'LK_CLOUD'],
  ['cloudCover', 'LK_COVER'],
  ['flyerShadow', 'LK_FLYER'],
  ['glints', 'LK_GLINT'],
  ['dapple', 'LK_DAPPLE'],
  ['rainbow', 'LK_RAINBOW'],
  ['mistSpread', 'LK_MIST_SPREAD'],
  ['streetArt', 'LK_ART'],
  ['billboards', 'LK_BILLBOARD'],
  ['treeSway', 'LK_SWAY'],
  ['peopleRim', 'LK_RIM'],
  ['roofStepBack', 'LK_ROOF'],
];
/** Floats in `uLook`. */
export const SHADER_LOOK_FLOATS = 16;

/** Fill `out` (shaderLib uLook) from `v`: each slot the slider's distance from the code's value. */
export function writeShaderLook(v: Readonly<Record<LookKey, number>>, out: Float32Array): Float32Array {
  SHADER_LOOK.forEach(([key], i) => (out[i] = v[key] - lookSpec(key).def));
  return out;
}

/** GLSL: the uLook declaration and a macro per slider (1.0 at the code's look). */
export function shaderLookGlsl(): string {
  const swz = 'xyzw';
  const lines = SHADER_LOOK.map(([key, name], i) => `#define ${name} (${lookSpec(key).def.toFixed(1)} + uLook[${i >> 2}].${swz[i & 3]})`);
  return `uniform vec4 uLook[${SHADER_LOOK_FLOATS / 4}];\n${lines.join('\n')}\n`;
}
export type LookValues = Record<LookKey, number>;

const SPEC = new Map<string, LookSpec>(LOOK_SPECS.map((s) => [s.key, s]));

export function lookSpec(key: LookKey): LookSpec {
  return SPEC.get(key)!;
}

/** The code's values (every slider at 100%, hues at 0°). */
export const CODE_LOOK: Readonly<LookValues> = Object.freeze(Object.fromEntries(LOOK_SPECS.map((s) => [s.key, s.def])) as LookValues);

/** `v` clamped to the key's range and snapped to its step; anything but a finite number gives `fallback`. */
export function clampLook(key: LookKey, v: unknown, fallback: number = lookSpec(key).def): number {
  const s = lookSpec(key);
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const snapped = s.min + Math.round((v - s.min) / s.step) * s.step;
  const c = Math.min(s.max, Math.max(s.min, snapped));
  return Number(c.toFixed(s.step < 1 ? 2 : 0));
}

/** `raw`'s known keys, clamped, over `base` (unknown keys and bad values dropped). */
export function sanitiseLook(raw: unknown, base: Readonly<LookValues> = CODE_LOOK): LookValues {
  const out = { ...base };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const s of LOOK_SPECS) if (s.key in r) out[s.key] = clampLook(s.key, r[s.key], base[s.key]);
  return out;
}

/** A look.json's values over the code's (an unknown version, or no file, is the code's look). */
export function parseLookFile(raw: unknown): LookValues {
  if (!raw || typeof raw !== 'object') return { ...CODE_LOOK };
  const r = raw as { version?: unknown; look?: unknown };
  if (r.version !== LOOK_FILE_VERSION) return { ...CODE_LOOK };
  return sanitiseLook(r.look);
}

/**
 * look.json for `values`: only what differs from the code, in the panel's
 * order, one slider per line (so a commit's diff reads as what changed).
 */
export function serialiseLookFile(values: Readonly<LookValues>): string {
  const lines: string[] = [];
  for (const s of LOOK_SPECS) {
    const v = values[s.key];
    if (v !== s.def) lines.push(`    ${JSON.stringify(s.key)}: ${v}`);
  }
  const body = lines.length ? `{\n${lines.join(',\n')}\n  }` : '{}';
  return `{\n  "version": ${LOOK_FILE_VERSION},\n  "look": ${body}\n}\n`;
}

/** The slider's value as shown: "115%", "−8°". */
export function formatLook(key: LookKey, v: number): string {
  const s = lookSpec(key);
  if (s.unit === '°') return `${signed(Math.round(v))}°`;
  return s.def === 0 ? `${signed(Math.round(v * 100))}%` : `${Math.round(v * 100)}%`;
}

/** How far `v` is from the shipped value, as shown: "+15%", "−8°", or "" when it's the same. */
export function lookDistance(key: LookKey, v: number, shipped: number): string {
  const s = lookSpec(key);
  const d = s.unit === '%' ? Math.round((v - shipped) * 100) : Math.round(v - shipped);
  return d === 0 ? '' : `${signed(d)}${s.unit}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}

/**
 * The live look: the shipped look with the owner's values over it. One per
 * game (`lookTuning` below); a class so the tests can make their own.
 */
export class LookTuning {
  /** Live values every reader uses. */
  readonly look: LookValues;
  /** The shipped look (code + look.json): what each slider measures its distance from. */
  readonly shipped: Readonly<LookValues>;
  private readonly own = new Map<LookKey, number>();
  private store: KeyValueStore | null = null;
  /** The owner's values apply only while on (main: Settings → Test tools), like touch tuning. */
  private enabled = true;
  private readonly listeners: Array<(key: LookKey | null) => void> = [];

  constructor(shipped: Readonly<LookValues> = CODE_LOOK) {
    this.shipped = Object.freeze({ ...shipped });
    this.look = { ...shipped };
  }

  /** Read the owner's stored values (unknown keys and bad values dropped). */
  load(kv: KeyValueStore | null): void {
    this.store = kv;
    let raw: unknown = null;
    try {
      const text = kv?.getItem(LOOK_KEY);
      if (text) raw = JSON.parse(text);
    } catch {
      raw = null;
    }
    this.own.clear();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const r = raw as Record<string, unknown>;
      for (const s of LOOK_SPECS) {
        if (!(s.key in r)) continue;
        const v = clampLook(s.key, r[s.key], NaN);
        if (!Number.isNaN(v)) this.own.set(s.key, v);
      }
    }
    this.refill();
  }

  /** Off: the shipped look, whatever the owner set (kept for when it's on again). */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.refill();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** The owner's value for `key` (what the panel shows, even while off). */
  value(key: LookKey): number {
    return this.own.get(key) ?? this.shipped[key];
  }

  /** Set one slider (clamped); returns the value it took. */
  set(key: LookKey, v: number): number {
    const c = clampLook(key, v, this.value(key));
    if (c === this.shipped[key]) this.own.delete(key);
    else this.own.set(key, c);
    this.save();
    if (this.enabled && c !== this.look[key]) {
      this.look[key] = c;
      this.emit(key);
    }
    return c;
  }

  /** Back to the shipped value. */
  reset(key: LookKey): void {
    this.set(key, this.shipped[key]);
  }

  /** Every slider back to the shipped look. */
  resetAll(): void {
    this.own.clear();
    this.save();
    this.refill();
  }

  /** How many sliders the owner has off the shipped look. */
  get changed(): number {
    return this.own.size;
  }

  /** look.json for the owner's look (what EXPORT downloads). */
  exportFile(): string {
    const v = { ...this.shipped };
    for (const [k, x] of this.own) v[k] = x;
    return serialiseLookFile(v);
  }

  /** `fn(key)` after a slider moves (null: many at once). Returns an unsubscribe. */
  onChange(fn: (key: LookKey | null) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private save(): void {
    if (!this.store) return;
    try {
      this.store.setItem(LOOK_KEY, JSON.stringify(Object.fromEntries(this.own)));
    } catch {
      // Storage full or blocked: the look still applies for this session.
    }
  }

  private refill(): void {
    for (const s of LOOK_SPECS) this.look[s.key] = this.enabled ? this.value(s.key) : this.shipped[s.key];
    this.emit(null);
  }

  private emit(key: LookKey | null): void {
    for (const fn of this.listeners) fn(key);
  }
}
