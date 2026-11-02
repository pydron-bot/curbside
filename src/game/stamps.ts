/**
 * Named mayhem on the bus: feeds the player's chaos to the stamp detector
 * (systems/stamps.ts has the rules and the table), and once a frame emits
 * the one stamp the arbiter lets through as a `stamp` event. The HUD draws
 * it (ui/stampHud.ts), the fx director freezes the frame for it, audio
 * plays its sting and passers-by in view film it (scenes/witnesses.ts).
 * Other systems name a moment with show(id) (the chase handoff's TAKE THE
 * HEAT); force(id) skips the cooldown (__ub.stamp, the smoke test).
 */
import type { EventBus, GameEvent } from '../core/events';
import type { VehicleArchetype } from '../entities/vehicle';
import { StampArbiter, StampDetector, type StampId } from '../systems/stamps';

export interface StampDeps {
  bus: EventBus;
  /** Sim time, s. */
  now: () => number;
  /** In play, alive and free: no stamps behind the title or on WASTED/BUSTED. */
  live: () => boolean;
  /** The player's vehicle, null on foot. */
  driving: () => VehicleArchetype | null;
  /** Where the player is (the stamp's event carries it). */
  position: () => { x: number; z: number };
}

/** The events the detector reads. */
const FEEDS = ['explosion', 'award', 'crash', 'pedDown', 'wanted', 'stunt', 'street', 'respawn', 'busted'] as const;

export class Stamps {
  readonly detector = new StampDetector();
  readonly arbiter = new StampArbiter();
  private forced: StampId | null = null;

  constructor(private readonly d: StampDeps) {
    const feed = (e: GameEvent) => this.feed(e);
    for (const type of FEEDS) d.bus.on(type, feed);
  }

  /** Name a moment: shown if the cooldown allows (a heavier one wins). */
  show(id: StampId): void {
    if (this.d.live()) this.arbiter.offer(id, this.d.now());
  }

  /** Show `id` on the next step whatever the cooldown (debug, smoke test). */
  force(id: StampId): void {
    this.forced = id;
  }

  /** Once a frame: emit the stamp that's due, if any. */
  step(): void {
    // Not in play: nothing is used up (a forced one is dropped), so the cooldown isn't spent on a stamp nobody saw.
    if (!this.d.live()) {
      this.forced = null;
      return;
    }
    const now = this.d.now();
    let id = this.arbiter.step(now);
    if (this.forced !== null) {
      id = this.forced;
      this.forced = null;
      this.arbiter.shown = id;
      this.arbiter.shownAt = now;
    }
    if (id === null) return;
    const at = this.d.position();
    this.d.bus.emit({ type: 'stamp', id, x: at.x, z: at.z });
  }

  /** A fresh run or the title: nothing half-counted carries over. */
  reset(): void {
    this.detector.reset();
    this.arbiter.reset();
    this.forced = null;
  }

  private feed(e: GameEvent): void {
    // A new life starts with a clean slate (nothing waiting to show either).
    if (e.type === 'respawn') return this.reset();
    if (!this.d.live() && e.type !== 'busted') return;
    this.detector.driving = this.d.driving();
    const id = this.detector.handle(e, this.d.now());
    if (id !== null) this.arbiter.offer(id, this.d.now());
  }
}
