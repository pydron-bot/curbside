/**
 * The destruction test's styles and budgets (pure, no three.js). Where a
 * breach happens and how big it is is the simulation's call (systems/
 * breaches.ts) and the same on every device; this decides only how it is
 * shown: 'desktop' throws tens of small Rapier chunks that linger, 'phone' a
 * few big ones that sink away after a few seconds, 'low' no bodies at all
 * (the scar and the existing debris chips). 'auto' shows desktop on every
 * tier but 'low'; 'phone' stays as a forced style to compare against.
 */
import { DESTRUCTION_MODES, type DestructionMode } from '../core/settings';
import type { QualityTierName } from './quality';

export type DestructionStyle = 'off' | 'low' | 'phone' | 'desktop';

/**
 * Mode × tier → style. 'auto' is desktop on 'high' and 'medium' (an iPhone
 * 15 Pro on 'medium' held 60 fps with it) and scar-only on 'low', the tier
 * DynamicResolution drops a struggling device to with Graphics on Auto (the
 * default; a fixed Med / High never steps the tier, only resolution).
 * 'phone' / 'desktop' are forced on any tier.
 */
export function resolveStyle(mode: DestructionMode, tier: QualityTierName): DestructionStyle {
  if (mode === 'off') return 'off';
  if (mode === 'phone' || mode === 'desktop') return mode;
  return tier === 'low' ? 'low' : 'desktop';
}

/** Styles that throw Rapier bodies (and so need Rapier loaded). */
export const needsPhysics = (s: DestructionStyle): s is 'phone' | 'desktop' => s === 'phone' || s === 'desktop';

/**
 * ?destruction=<mode> for this session only (never saved), like ?debug. A
 * bare ?destruction means 'auto'; an unknown value is ignored.
 */
export function destructionFromUrl(search: string): DestructionMode | null {
  const q = new URLSearchParams(search);
  if (!q.has('destruction')) return null;
  const v = q.get('destruction') ?? '';
  if (v === '') return 'auto';
  return DESTRUCTION_MODES.includes(v as DestructionMode) ? (v as DestructionMode) : null;
}

export interface DustBudget {
  /** Soft puffs out of the crater. */
  puffs: number;
  /** Start and end size, m. */
  size0: number;
  size1: number;
  /** Life range, s. */
  lifeMin: number;
  lifeMax: number;
  /** Speed out of the face, m/s. */
  speedMin: number;
  speedMax: number;
  /** Low puffs in a ring at the foot of the wall. */
  ring: number;
  /** Big slow puffs that hang over the rubble and drift off (6–9 s). */
  haze: number;
}

export interface StyleBudget {
  /** Rapier chunks per breach: base + round(perStrength × strength). 0 = none. */
  chunksBase: number;
  chunksPerStrength: number;
  /** Chunk half-extent range, m. */
  halfMin: number;
  halfMax: number;
  /** Share of chunks that are thin plates (hy × 0.4). */
  slabShare: number;
  /** Share that are long thin shards (one side ×1.5, the others about halved). */
  shardShare: number;
  /** Share in the bare core's colour (concrete or brick) rather than the wall's. */
  coreShare: number;
  /** Share blackened by the fireball (on top of those born near the blast's centre). */
  scorchShare: number;
  /** Debris chips (the existing effects.debris pool, no physics) per breach: base + round(perStrength × strength). */
  chipsBase: number;
  chipsPerStrength: number;
  /** Chip size range, m (full extents). */
  chipMin: number;
  chipMax: number;
  /** Live bodies at most; a breach over it evicts the oldest (they sink away). */
  maxLive: number;
  /** A chunk's life on the rubble clock, s. */
  life: number;
  /** Sinking into the pavement after `life`, s; 0 = removed only once out of view instead. */
  sink: number;
  /** Force a chunk to sleep after this long awake with no car near, s. */
  sleepAfter: number;
  /** Kinematic car proxies at most. */
  proxies: number;
  /** Rubble casts sun shadows (one more draw call). */
  shadows: boolean;
  dust: DustBudget;
  /** The richer crater look (FINISH: parallax, slabs, hot rim). */
  richScar: boolean;
  /** Scars kept visible at once. */
  scarCap: number;
}

export const STYLE: Readonly<Record<'low' | 'phone' | 'desktop', StyleBudget>> = {
  desktop: {
    chunksBase: 12,
    chunksPerStrength: 24,
    halfMin: 0.07,
    halfMax: 0.2,
    slabShare: 0.3,
    shardShare: 0.2,
    coreShare: 0.3,
    scorchShare: 0.06,
    chipsBase: 0,
    chipsPerStrength: 0,
    chipMin: 0.15,
    chipMax: 0.35,
    maxLive: 200,
    life: 120,
    sink: 0,
    sleepAfter: 10,
    proxies: 6,
    shadows: true,
    dust: { puffs: 26, size0: 1.2, size1: 3.8, lifeMin: 2.5, lifeMax: 4.5, speedMin: 1, speedMax: 3, ring: 8, haze: 5 },
    richScar: true,
    scarCap: 32,
  },
  phone: {
    chunksBase: 3,
    chunksPerStrength: 4,
    halfMin: 0.2,
    halfMax: 0.42,
    slabShare: 0.25,
    shardShare: 0.25,
    // Big faces: more broken core and soot, so they read as rubble, not blocks.
    coreShare: 0.5,
    scorchShare: 0.15,
    chipsBase: 4,
    chipsPerStrength: 0,
    chipMin: 0.12,
    chipMax: 0.25,
    maxLive: 36,
    life: 7,
    sink: 0.6,
    sleepAfter: 10,
    proxies: 3,
    shadows: false,
    dust: { puffs: 7, size0: 0.8, size1: 2.2, lifeMin: 1, lifeMax: 1.6, speedMin: 0.8, speedMax: 2, ring: 0, haze: 0 },
    richScar: false,
    scarCap: 16,
  },
  low: {
    chunksBase: 0,
    chunksPerStrength: 0,
    halfMin: 0,
    halfMax: 0,
    slabShare: 0,
    shardShare: 0,
    coreShare: 0,
    scorchShare: 0,
    chipsBase: 4,
    chipsPerStrength: 6,
    chipMin: 0.15,
    chipMax: 0.35,
    maxLive: 0,
    life: 0,
    sink: 0,
    sleepAfter: 0,
    proxies: 0,
    shadows: false,
    dust: { puffs: 5, size0: 0.8, size1: 2, lifeMin: 1, lifeMax: 1.5, speedMin: 0.8, speedMax: 2, ring: 0, haze: 0 },
    richScar: false,
    scarCap: 16,
  },
};

/** Mesh and physics slots: desktop's live cap plus room for evicted chunks still sinking. */
export const RUBBLE_CAPACITY = 256;

/** Chunks a breach of `strength` (0..1) throws in `style`. */
export function chunkCount(b: StyleBudget, strength: number): number {
  return b.chunksBase + Math.round(b.chunksPerStrength * strength);
}

/** Debris chips (no physics) a breach of `strength` throws in `style`. */
export function chipCount(b: StyleBudget, strength: number): number {
  return b.chipsBase + Math.round(b.chipsPerStrength * strength);
}
