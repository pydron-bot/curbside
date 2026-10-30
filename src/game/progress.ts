/**
 * The career: cash, lifetime stats, best scores, medals, collectibles and
 * purchases over the persistent save (progressSave.ts). Everything that pays
 * or charges goes through earn() / spend(), which keep the lifetime totals
 * and tell listeners (the cash readout) what changed. Saves are batched: a
 * change marks the save dirty and step() writes it within a few seconds;
 * flush() writes now (pause, app switch, the end of an activity).
 *
 * Lifetime stats count bus events while play is live (not behind the title).
 * Pure logic (no three.js, no DOM), unit-tested.
 */
import type { EventBus } from '../core/events';
import { BUST_FINE } from './heat';
import { MEDALS, defaultSave, loadSave, storeSave, type Medal, type SaveData, type SaveStorage } from './progressSave';

/** Getting WASTED: the hospital's bill (or whatever you have). */
export const HOSPITAL_BILL = 200;
/** A bust fines this much cash at most (the share is BUST_FINE, as for the score). */
export const BUST_FINE_CAP = 1500;
/** Write a dirty save at most this often, s. */
const SAVE_EVERY = 4;

/** A change in cash: positive earned, negative spent. */
export interface CashChange {
  amount: number;
  total: number;
  /** What for: 'chain', 'frenzy', 'package', 'shop', 'hospital', ... */
  reason: string;
}

/** The hospital bill for someone holding `cash`. */
export function hospitalBill(cash: number): number {
  return Math.min(Math.max(0, cash), HOSPITAL_BILL);
}

/** The cash fine for an arrest: the same share as the score's, capped. */
export function bustFine(cash: number): number {
  return Math.min(BUST_FINE_CAP, Math.round(Math.max(0, cash) * BUST_FINE));
}

/** Is `a` a better medal than `b` (or b none)? */
export function betterMedal(a: Medal | null | undefined, b: Medal | null | undefined): boolean {
  if (!a) return false;
  return !b || MEDALS.indexOf(a) > MEDALS.indexOf(b);
}

export class Progress {
  readonly data: SaveData;
  private readonly listeners: Array<(c: CashChange) => void> = [];
  private dirty = false;
  private saveIn = SAVE_EVERY;

  constructor(
    data: SaveData | null = null,
    private readonly store: SaveStorage | null | undefined = undefined,
  ) {
    this.data = data ?? (store === undefined ? loadSave() : store ? loadSave(store) : defaultSave());
  }

  get cash(): number {
    return this.data.cash;
  }

  get stats() {
    return this.data.stats;
  }

  /** Listen for cash changes. Returns an unsubscribe function. */
  onCash(fn: (c: CashChange) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Pay the player (rounded down; nothing for 0 or less). Returns what was paid. */
  earn(amount: number, reason: string): number {
    const n = Math.floor(amount);
    if (!(n > 0)) return 0;
    this.data.cash += n;
    this.data.stats.cashEarned += n;
    this.changed(n, reason);
    return n;
  }

  /** Charge `cost` if they can afford it; false (and nothing taken) if not. */
  spend(cost: number, reason: string): boolean {
    const n = Math.max(0, Math.ceil(cost));
    if (n > this.data.cash) return false;
    if (n === 0) return true;
    this.data.cash -= n;
    this.data.stats.cashSpent += n;
    this.changed(-n, reason);
    return true;
  }

  /** Take up to `amount` (a bill or fine they can't refuse). Returns what was taken. */
  charge(amount: number, reason: string): number {
    const n = Math.min(this.data.cash, Math.max(0, Math.round(amount)));
    if (n <= 0) return 0;
    this.data.cash -= n;
    this.data.stats.cashSpent += n;
    this.changed(-n, reason);
    return n;
  }

  has(unlock: string): boolean {
    return this.data.unlocks.includes(unlock);
  }

  unlock(id: string): boolean {
    if (this.has(id)) return false;
    this.data.unlocks.push(id);
    this.markDirty();
    return true;
  }

  best(mode: string): number {
    return this.data.best[mode] ?? 0;
  }

  /** Record a finished score for `mode`; true if it's a new best. */
  recordBest(mode: string, score: number): boolean {
    if (score <= this.best(mode)) return false;
    this.data.best[mode] = Math.floor(score);
    this.markDirty();
    return true;
  }

  medal(id: string): Medal | null {
    return this.data.medals[id] ?? null;
  }

  /** Record a medal; true if it beats the one held. */
  recordMedal(id: string, medal: Medal | null): boolean {
    if (!betterMedal(medal, this.medal(id))) return false;
    this.data.medals[id] = medal!;
    this.markDirty();
    return true;
  }

  /** Mark a string id done in one of the save's lists; true if it's new. */
  complete(list: 'frenzies' | 'missions', id: string): boolean {
    const l = this.data[list];
    if (l.includes(id)) return false;
    l.push(id);
    this.markDirty();
    return true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Per sim step: count play time, write a dirty save every few seconds. */
  step(dt: number): void {
    this.data.stats.playTime += dt;
    if ((this.saveIn -= dt) > 0) return;
    this.saveIn = SAVE_EVERY;
    if (this.dirty) this.flush();
  }

  /** Write the save now if anything changed. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.store === null) return;
    storeSave(this.data, this.store);
  }

  /**
   * Count lifetime stats from the bus while `live()` (in play, not behind
   * the title). Returns an unsubscribe function.
   */
  track(bus: EventBus, live: () => boolean): () => void {
    const s = this.data.stats;
    const offs = [
      bus.on('award', (e) => {
        if (!live()) return;
        s.chaosPoints += e.award.points;
        s.bestCombo = Math.max(s.bestCombo, Math.min(10, e.award.multiplier + 1));
        this.dirty = true;
      }),
      bus.on('pedDown', (e) => {
        if (live() && e.byPlayer && !e.isPlayer) s.knockouts++;
      }),
      bus.on('explosion', (e) => {
        if (live() && e.byPlayer && !e.ownCar) s.carsWrecked++;
      }),
      bus.on('carjack', () => {
        if (live()) s.carjacks++;
      }),
      bus.on('playerDied', () => {
        if (!live()) return;
        s.wasted++;
        this.dirty = true;
      }),
      bus.on('busted', () => {
        if (!live()) return;
        s.busted++;
        this.dirty = true;
      }),
      bus.on('wanted', (e) => {
        if (live()) s.maxStars = Math.max(s.maxStars, e.level);
      }),
    ];
    return () => offs.forEach((off) => off());
  }

  private changed(amount: number, reason: string): void {
    this.markDirty();
    const c: CashChange = { amount, total: this.data.cash, reason };
    for (const fn of this.listeners) fn(c);
  }
}
