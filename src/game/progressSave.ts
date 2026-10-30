/**
 * The persistent save: cash, lifetime stats, best scores per mode, medals,
 * collectibles found, activities completed and purchases. One versioned JSON
 * record in localStorage (`curbside.save`). Loading never throws: missing,
 * blocked or corrupt storage gives a fresh save (a corrupt record is kept
 * aside as `curbside.save.corrupt` rather than silently overwritten), and
 * every field is sanitised, so a hand-edited or half-written save can't put
 * NaN cash or a string medal into the game. Pure logic (storage is passed
 * in), unit-tested.
 */

export const SAVE_KEY = 'curbside.save';
export const SAVE_VERSION = 1;
/** Where the free-roam best score lived before the save existed. */
const LEGACY_BEST_KEY = 'curbside.best';

export type Medal = 'bronze' | 'silver' | 'gold';
export const MEDALS: readonly Medal[] = ['bronze', 'silver', 'gold'];

/** Whole-career counters, shown on the PROGRESS page. */
export interface LifetimeStats {
  /** Seconds actually played (not paused, not the title). */
  playTime: number;
  /** Chaos points scored, every mode. */
  chaosPoints: number;
  cashEarned: number;
  cashSpent: number;
  /** The most cash a single chain banked. */
  bestChain: number;
  bestCombo: number;
  knockouts: number;
  carsWrecked: number;
  carjacks: number;
  wasted: number;
  busted: number;
  /** Highest wanted level reached. */
  maxStars: number;
  fares: number;
  exportsDelivered: number;
}

export interface SaveData {
  v: number;
  cash: number;
  stats: LifetimeStats;
  /** Best score per mode id ('free', 'chaosRun'). */
  best: Record<string, number>;
  /** Best medal per activity id ('chaosRun', 'race-harbour', ...). */
  medals: Record<string, Medal>;
  /** Best race times, seconds, per race id. */
  raceTimes: Record<string, number>;
  /** Indices of hidden packages found. */
  packages: number[];
  /** Frenzy ids beaten. */
  frenzies: string[];
  /** Export orders delivered from the current list, and lists finished. */
  exports: { done: string[]; lists: number };
  taxi: { bestStreak: number };
  /** Story missions passed, by id. */
  missions: string[];
  /** Purchases and perks ('scanner', 'armour', ...). */
  unlocks: string[];
}

export function defaultStats(): LifetimeStats {
  return {
    playTime: 0,
    chaosPoints: 0,
    cashEarned: 0,
    cashSpent: 0,
    bestChain: 0,
    bestCombo: 1,
    knockouts: 0,
    carsWrecked: 0,
    carjacks: 0,
    wasted: 0,
    busted: 0,
    maxStars: 0,
    fares: 0,
    exportsDelivered: 0,
  };
}

export function defaultSave(): SaveData {
  return {
    v: SAVE_VERSION,
    cash: 0,
    stats: defaultStats(),
    best: { free: 0 },
    medals: {},
    raceTimes: {},
    packages: [],
    frenzies: [],
    exports: { done: [], lists: 0 },
    taxi: { bestStreak: 0 },
    missions: [],
    unlocks: [],
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A finite number ≥ 0 (whole if `int`), else `fallback`. */
function num(v: unknown, fallback = 0, int = true): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return fallback;
  return int ? Math.floor(v) : v;
}
const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string'))] : []);
function numberMap(v: unknown, int = true): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, n] of Object.entries(v)) {
    const x = num(n, -1, int);
    if (x >= 0) out[k] = x;
  }
  return out;
}

/**
 * Any parsed JSON (or nothing) → a valid current-version save. Unknown or
 * broken fields fall back to their defaults one by one, so a single bad
 * value doesn't cost the whole save. A save from a newer build keeps the
 * fields this one understands.
 */
export function migrateSave(raw: unknown, legacyBest = 0): SaveData {
  const save = defaultSave();
  if (isObj(raw)) {
    save.cash = num(raw.cash);
    const stats = isObj(raw.stats) ? raw.stats : {};
    const s = save.stats as unknown as Record<string, number>;
    for (const key of Object.keys(s)) s[key] = num(stats[key], s[key], key !== 'playTime');
    save.best = numberMap(raw.best);
    if (isObj(raw.medals)) {
      for (const [k, m] of Object.entries(raw.medals)) if (MEDALS.includes(m as Medal)) save.medals[k] = m as Medal;
    }
    save.raceTimes = numberMap(raw.raceTimes, false);
    if (Array.isArray(raw.packages)) {
      save.packages = [...new Set(raw.packages.filter((i): i is number => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b);
    }
    save.frenzies = strings(raw.frenzies);
    if (isObj(raw.exports)) save.exports = { done: strings(raw.exports.done), lists: num(raw.exports.lists) };
    if (isObj(raw.taxi)) save.taxi = { bestStreak: num(raw.taxi.bestStreak) };
    save.missions = strings(raw.missions);
    save.unlocks = strings(raw.unlocks);
  }
  // The free-roam best predates the save: carry it over.
  save.best.free = Math.max(save.best.free ?? 0, num(legacyBest));
  save.v = SAVE_VERSION;
  return save;
}

/** The bits of the Storage API the save needs (localStorage, or a fake in tests). */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): SaveStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // blocked (some private modes throw on access)
  }
}

/** Read the save; never throws. */
export function loadSave(store: SaveStorage | null = storage()): SaveData {
  if (!store) return defaultSave();
  let legacy = 0;
  try {
    legacy = Number(store.getItem(LEGACY_BEST_KEY)) || 0;
  } catch {
    // Ignore: no legacy best.
  }
  let text: string | null = null;
  try {
    text = store.getItem(SAVE_KEY);
  } catch {
    return migrateSave(null, legacy);
  }
  if (!text) return migrateSave(null, legacy);
  try {
    return migrateSave(JSON.parse(text), legacy);
  } catch {
    // Corrupt: keep it aside for a human to look at, start fresh.
    try {
      store.setItem(`${SAVE_KEY}.corrupt`, text);
    } catch {
      // Full or blocked: nothing more to do.
    }
    return migrateSave(null, legacy);
  }
}

/** Write the save; false if storage is unavailable or full. */
export function storeSave(save: SaveData, store: SaveStorage | null = storage()): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false; // private mode / quota: progress lasts this session only
  }
}
