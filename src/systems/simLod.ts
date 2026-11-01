/**
 * Level of detail for the simulation: the street's ambient agents (traffic
 * drivers, passers-by, stray dogs) think every step only when the player
 * could see or reach them. Off screen within LOD_NEAR_RANGE they tick at
 * 15 Hz, further off at 5 Hz, each on its own round-robin bucket so the
 * work spreads evenly over the steps, and a tick integrates all the time
 * owed since the last one, so they cover the same ground. Anything that
 * can deal with the player (police, chasers, hostiles, anyone close) is
 * pinned at the full rate by the caller. Pure: tested in tests/simLod.test.ts.
 */
import type { Rect } from '../world/city';

/** Every step (60 Hz), every 4th (15 Hz), every 12th (5 Hz). */
export const LOD_FULL = 0;
export const LOD_NEAR = 1;
export const LOD_FAR = 2;
export type LodTier = typeof LOD_FULL | typeof LOD_NEAR | typeof LOD_FAR;
export const LOD_PERIOD: readonly number[] = [1, 4, 12];
/** Within this of the player everything runs every step, m (someone might be about to deal with you). */
export const LOD_CLOSE = 25;
/** Off screen within this of the player: 15 Hz; beyond, 5 Hz, m. */
export const LOD_NEAR_RANGE = 80;
/**
 * Back to every step this far outside the visible ground, m: a tick at 5 Hz
 * moves a runner a metre, so whoever comes into view has caught up well
 * before (the camera moves under a metre a step).
 */
export const LOD_VIEW_MARGIN = 10;

/** One agent's clock (kept on the agent). */
export interface SimClock {
  /** Its round-robin bucket. */
  slot: number;
  /** Sim time since its last tick, s. */
  owed: number;
  /** Time integrated this step (0: it skipped this one), s. */
  dt: number;
  /** The tier it ran on this step. */
  tier: LodTier;
}

/** Buckets handed out so far: each new clock takes the next, round the cycle. */
let slots = 0;
/** Steps in the bucket cycle: a multiple of every period. */
const CYCLE = 60;

/** A clock for a new agent, on the next bucket round. */
export function newSimClock(): SimClock {
  return { slot: slots++ % CYCLE, owed: 0, dt: 0, tier: LOD_FULL };
}

export class SimLod {
  /** Off: everything every step (A/B checks). */
  enabled = true;
  /** Agents ticked and skipped this step (diagnostics). */
  ticked = 0;
  skipped = 0;
  private step = 0;
  private x = 0;
  private z = 0;
  private readonly view: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

  /** Start a sim step: where the player (or the attract camera) is and what the camera sees. */
  begin(x: number, z: number, view: Rect): void {
    this.step = (this.step + 1) % CYCLE;
    this.x = x;
    this.z = z;
    const v = this.view;
    v.minX = view.minX - LOD_VIEW_MARGIN;
    v.minZ = view.minZ - LOD_VIEW_MARGIN;
    v.maxX = view.maxX + LOD_VIEW_MARGIN;
    v.maxZ = view.maxZ + LOD_VIEW_MARGIN;
    this.ticked = this.skipped = 0;
  }

  /** The tier for something at (x, z): full on screen (with the margin) or close, else by distance. */
  tier(x: number, z: number): LodTier {
    if (!this.enabled) return LOD_FULL;
    const v = this.view;
    if (x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ) return LOD_FULL;
    const d2 = (x - this.x) ** 2 + (z - this.z) ** 2;
    if (d2 < LOD_CLOSE * LOD_CLOSE) return LOD_FULL;
    return d2 < LOD_NEAR_RANGE * LOD_NEAR_RANGE ? LOD_NEAR : LOD_FAR;
  }

  /**
   * This step's share of `dt` for an agent on `tier` (`pinned`: full rate
   * whatever the tier): everything owed on its tick, else 0 (it skips).
   * Back at the full rate it settles at once, so nothing is owed much
   * longer than a slow tick (0.2 s).
   */
  due(c: SimClock, tier: LodTier, dt: number, pinned = false): number {
    if (pinned) tier = LOD_FULL;
    c.tier = tier;
    c.owed += dt;
    const period = LOD_PERIOD[tier];
    if (period > 1 && (this.step + c.slot) % period !== 0) {
      c.dt = 0;
      this.skipped++;
      return 0;
    }
    c.dt = c.owed;
    c.owed = 0;
    this.ticked++;
    return c.dt;
  }

  /** Tick now whatever the bucket (something came up between ticks): all that's owed. */
  settle(c: SimClock): number {
    c.dt = c.owed;
    c.owed = 0;
    this.ticked++;
    this.skipped--;
    return c.dt;
  }
}
