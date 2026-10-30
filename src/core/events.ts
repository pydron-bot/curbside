/**
 * Game-wide event bus. The simulation emits what happened (a crash, a shot, an
 * explosion); presentation layers — audio, effects, HUD, heat, missions —
 * subscribe instead of being called from inside main.ts. Synchronous and
 * allocation-light: listeners run immediately, in subscription order.
 */
import type { VehicleArchetype } from '../entities/vehicle';
import type { Award } from '../systems/score';
import type { WeaponKind } from '../systems/weapons';
import type { PickupKind } from '../world/pickups';

export type GameEvent =
  /**
   * A car hit a wall/obstacle or another car (closing speed above a small
   * threshold). impact = closing speed, m/s; (x, z) is the point of contact.
   */
  | { type: 'crash'; x: number; z: number; impact: number; against: 'static' | 'vehicle'; involvesPlayer: boolean }
  /**
   * A vehicle blew up. byPlayer: the player was driving it or hurt it in the
   * last few seconds (directly or with another blast). ownCar: it was the car
   * the player was in.
   */
  | {
      type: 'explosion';
      x: number;
      z: number;
      /** Distance from the camera focus, m. */
      distance: number;
      byPlayer: boolean;
      ownCar?: boolean;
    }
  /** A gun went off at (x, z) (the muzzle). weapon is null for NPC guns. */
  | { type: 'shot'; x: number; z: number; dirX: number; dirZ: number; weapon: WeaponKind | null; byPlayer: boolean }
  /**
   * Where a bullet (one pellet) stopped and what it hit; (fromX, fromZ) is the
   * muzzle it left, for tracers.
   */
  | {
      type: 'bulletHit';
      x: number;
      z: number;
      target: 'ped' | 'vehicle' | 'player' | 'wall' | 'none';
      fromX?: number;
      fromZ?: number;
      byPlayer?: boolean;
    }
  /** A punch was thrown from (x, z); hit = it connected. */
  | { type: 'punch'; x: number; z: number; hit: boolean; byPlayer: boolean }
  /** A pedestrian (or the player, isPlayer) was knocked over. */
  | {
      type: 'pedDown';
      x: number;
      z: number;
      cause: 'vehicle' | 'punch' | 'shot' | 'blast';
      byPlayer: boolean;
      isPlayer?: boolean;
    }
  | { type: 'carjack'; x: number; z: number }
  | { type: 'enterVehicle'; archetype: VehicleArchetype }
  | { type: 'exitVehicle'; archetype: VehicleArchetype }
  | { type: 'pickup'; kind: PickupKind; x: number; z: number }
  /** Points scored (every award, including banked drifts). */
  | { type: 'award'; award: Award }
  /** The player's selected weapon changed (null = fists), for any reason. */
  | { type: 'weaponSwitch'; weapon: WeaponKind | null }
  | { type: 'playerHurt'; amount: number; health: number }
  | { type: 'playerDied' }
  | { type: 'respawn' }
  /** The game was paused or resumed (menu, app switch, lost graphics context). */
  | { type: 'pause'; paused: boolean };

export type GameEventType = GameEvent['type'];
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

type Listener<T extends GameEventType> = (e: EventOf<T>) => void;

export class EventBus {
  /**
   * Listener lists are copy-on-write: (un)subscribing swaps in a new array,
   * so a listener that unsubscribes (or subscribes another) mid-emit can't
   * make the current emit skip or double-run anyone, and emit never allocates.
   */
  private readonly byType = new Map<GameEventType, ReadonlyArray<(e: GameEvent) => void>>();
  private any: ReadonlyArray<(e: GameEvent) => void> = [];

  /** Subscribe to one event type. Returns an unsubscribe function. */
  on<T extends GameEventType>(type: T, fn: Listener<T>): () => void {
    const wrapped = fn as (e: GameEvent) => void;
    this.byType.set(type, [...(this.byType.get(type) ?? []), wrapped]);
    return () => {
      const list = this.byType.get(type);
      if (list) this.byType.set(type, list.filter((f) => f !== wrapped));
    };
  }

  /** Subscribe to every event. Returns an unsubscribe function. */
  onAny(fn: (e: GameEvent) => void): () => void {
    this.any = [...this.any, fn];
    return () => {
      this.any = this.any.filter((f) => f !== fn);
    };
  }

  emit(e: GameEvent): void {
    const list = this.byType.get(e.type);
    if (list) for (const fn of list) fn(e);
    for (const fn of this.any) fn(e);
  }

  /** Drop every listener (tests). */
  clear(): void {
    this.byType.clear();
    this.any = [];
  }
}

/** The one bus the game uses. */
export const events = new EventBus();
