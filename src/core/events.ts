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
  /** A car hit a wall/obstacle or another car. impact = closing speed, m/s. */
  | { type: 'crash'; x: number; z: number; impact: number; against: 'static' | 'vehicle'; involvesPlayer: boolean }
  | { type: 'explosion'; x: number; z: number; /** Distance from the camera focus, m. */ distance: number; byPlayer: boolean }
  /** A gun went off. weapon is null for NPC guns. */
  | { type: 'shot'; x: number; z: number; dirX: number; dirZ: number; weapon: WeaponKind | null; byPlayer: boolean }
  /** Where a bullet stopped and what it hit. */
  | { type: 'bulletHit'; x: number; z: number; target: 'ped' | 'vehicle' | 'player' | 'wall' | 'none' }
  | { type: 'punch'; x: number; z: number; hit: boolean; byPlayer: boolean }
  /** A pedestrian (or the player) was knocked over. */
  | { type: 'pedDown'; x: number; z: number; cause: 'vehicle' | 'punch' | 'shot' | 'blast'; byPlayer: boolean }
  | { type: 'carjack'; x: number; z: number }
  | { type: 'enterVehicle'; archetype: VehicleArchetype }
  | { type: 'exitVehicle'; archetype: VehicleArchetype }
  | { type: 'pickup'; kind: PickupKind; x: number; z: number }
  | { type: 'award'; award: Award }
  | { type: 'weaponSwitch'; weapon: WeaponKind | null }
  | { type: 'playerHurt'; amount: number; health: number }
  | { type: 'playerDied' }
  | { type: 'respawn' };

export type GameEventType = GameEvent['type'];
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

type Listener<T extends GameEventType> = (e: EventOf<T>) => void;

export class EventBus {
  private readonly byType = new Map<GameEventType, Array<(e: GameEvent) => void>>();
  private readonly any: Array<(e: GameEvent) => void> = [];

  /** Subscribe to one event type. Returns an unsubscribe function. */
  on<T extends GameEventType>(type: T, fn: Listener<T>): () => void {
    let list = this.byType.get(type);
    if (!list) this.byType.set(type, (list = []));
    const wrapped = fn as (e: GameEvent) => void;
    list.push(wrapped);
    return () => {
      const i = list!.indexOf(wrapped);
      if (i >= 0) list!.splice(i, 1);
    };
  }

  /** Subscribe to every event. Returns an unsubscribe function. */
  onAny(fn: (e: GameEvent) => void): () => void {
    this.any.push(fn);
    return () => {
      const i = this.any.indexOf(fn);
      if (i >= 0) this.any.splice(i, 1);
    };
  }

  emit(e: GameEvent): void {
    const list = this.byType.get(e.type);
    if (list) for (const fn of list) fn(e);
    for (const fn of this.any) fn(e);
  }
}

/** The one bus the game uses. */
export const events = new EventBus();
