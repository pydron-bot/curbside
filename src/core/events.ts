/**
 * Game-wide event bus. The simulation emits what happened (a crash, a shot, an
 * explosion); presentation layers — audio, effects, HUD, heat, missions —
 * subscribe instead of being called from inside main.ts. Synchronous and
 * allocation-light: listeners run immediately, in subscription order.
 */
import type { VehicleArchetype } from '../entities/vehicle';
import type { Award } from '../systems/score';
import type { WantedReason } from '../systems/wanted';
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
   * the player was in (or bailed out of while it burned).
   */
  | {
      type: 'explosion';
      x: number;
      z: number;
      /** Distance from the camera focus, m. */
      distance: number;
      byPlayer: boolean;
      ownCar?: boolean;
      /** It was a police car (a unit's, or the police model). */
      police?: boolean;
      /** What blew up: a car (the default), a grenade or a rocket. */
      source?: 'vehicle' | 'grenade' | 'rocket';
    }
  /**
   * A gun went off at (x, z) (the muzzle). weapon is null for NPC guns;
   * 'rocket' is a rocket leaving the launcher. driveBy: out of a car window.
   */
  | { type: 'shot'; x: number; z: number; dirX: number; dirZ: number; weapon: WeaponKind | null; byPlayer: boolean; driveBy?: boolean }
  /** A grenade or molotov was thrown from (x, z) toward (toX, toZ). */
  | { type: 'throw'; x: number; z: number; toX: number; toZ: number; weapon: 'grenade' | 'molotov'; byPlayer: boolean }
  /** A molotov burst: a patch of fire of `radius` m at (x, z). */
  | { type: 'ignite'; x: number; z: number; radius: number; byPlayer: boolean }
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
      /** The vehicle hit was a police car. */
      police?: boolean;
    }
  /**
   * A punch was thrown from (x, z); hit = it connected. combo: the player's
   * combo step (0, 1 jabs, 2 the knock-down hook).
   */
  | { type: 'punch'; x: number; z: number; hit: boolean; byPlayer: boolean; combo?: number }
  /** A pedestrian (or the player, isPlayer) was knocked over. */
  | {
      type: 'pedDown';
      x: number;
      z: number;
      cause: 'vehicle' | 'punch' | 'shot' | 'blast' | 'fire';
      /** Knocked out (0 HP: down for long, then they run), not just knocked over. */
      ko?: boolean;
      byPlayer: boolean;
      isPlayer?: boolean;
      /** The one knocked over was a police officer. */
      cop?: boolean;
    }
  | { type: 'carjack'; x: number; z: number }
  /** police: the car belongs to the police (a unit's, or the police model). */
  | { type: 'enterVehicle'; archetype: VehicleArchetype; police?: boolean }
  | { type: 'exitVehicle'; archetype: VehicleArchetype }
  | { type: 'pickup'; kind: PickupKind; x: number; z: number }
  /** Points scored (every award, including banked drifts). */
  | { type: 'award'; award: Award }
  /** The player's selected weapon changed (null = fists), for any reason. */
  | { type: 'weaponSwitch'; weapon: WeaponKind | null }
  /**
   * The player took `amount` damage: `absorbed` of it went into body armour
   * (`armour` left), the rest off `health`.
   */
  | { type: 'playerHurt'; amount: number; health: number; armour: number; absorbed: number }
  | { type: 'playerDied' }
  | { type: 'respawn' }
  /**
   * The wanted level (stars, 0..5) changed: up for a witnessed crime, down one
   * star at a time while evading, or straight to 0 (evaded, resprayed,
   * busted, died, a fresh run).
   */
  | { type: 'wanted'; level: number; prev: number; reason: WantedReason }
  /** The police arrested the player; `fine` points came off the run score. */
  | { type: 'busted'; fine: number }
  /** A driver leant on the horn at (x, z) (blocked by the player, panicking). */
  | { type: 'horn'; x: number; z: number; duration: number }
  /** A car was resprayed at a Pay 'n' Spray; `cleared`: it lost the police too. */
  | { type: 'respray'; x: number; z: number; cleared: boolean }
  /**
   * A car took off from a ramp at (x, z) at `speed` m/s; `airtime` is the
   * flight time to expect (s). involvesPlayer: it's the player's car.
   */
  | { type: 'jump'; x: number; z: number; speed: number; airtime: number; involvesPlayer: boolean }
  /** A car came down at (x, z) at `impact` m/s (vertical). */
  | { type: 'land'; x: number; z: number; impact: number; involvesPlayer: boolean }
  /** The player landed a jump worth a STUNT award (see systems/stunts.ts). */
  | { type: 'stunt'; x: number; z: number; airtime: number; distance: number; spin: number; points: number; label: string }
  /** The player's nitro lit (on) or went out (off), at (x, z). */
  | { type: 'boost'; on: boolean; x: number; z: number }
  /** The game was paused or resumed (menu, app switch, lost graphics context). */
  | { type: 'pause'; paused: boolean }
  /**
   * Something worth a cheer was won at (x, z): a story mission passed, a
   * Chaos Run with a medal. Whoever is on foot there (the player, the story
   * characters) cheers.
   */
  | { type: 'celebrate'; x: number; z: number };

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
