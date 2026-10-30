/**
 * Per-life statistics for the WASTED screen: how long you lasted, how many
 * people you knocked down and cars you wrecked, carjacks and the best combo.
 * Fed by game events; `tick` counts time actually played (the caller skips
 * pauses and the title screen). Pure logic.
 */
import type { EventBus } from '../core/events';

export interface RunStatsSnapshot {
  timeAlive: number;
  knockouts: number;
  carsWrecked: number;
  carjacks: number;
  bestCombo: number;
}

export class RunStats implements RunStatsSnapshot {
  timeAlive = 0;
  knockouts = 0;
  carsWrecked = 0;
  carjacks = 0;
  bestCombo = 1;
  private alive = true;

  constructor(bus: EventBus) {
    bus.on('pedDown', (e) => {
      if (e.byPlayer && !e.isPlayer && this.alive) this.knockouts++;
    });
    bus.on('explosion', (e) => {
      if (e.byPlayer && this.alive) this.carsWrecked++;
    });
    bus.on('carjack', () => {
      if (this.alive) this.carjacks++;
    });
    bus.on('award', (e) => {
      if (this.alive) this.bestCombo = Math.max(this.bestCombo, e.award.multiplier);
    });
    bus.on('playerDied', () => (this.alive = false));
    bus.on('respawn', () => this.reset());
  }

  /** Count `dt` seconds of play toward this life. */
  tick(dt: number): void {
    if (this.alive) this.timeAlive += dt;
  }

  reset(): void {
    this.timeAlive = 0;
    this.knockouts = 0;
    this.carsWrecked = 0;
    this.carjacks = 0;
    this.bestCombo = 1;
    this.alive = true;
  }
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
