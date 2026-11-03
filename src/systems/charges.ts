/**
 * The sticky charge (W3-B): thrown like a grenade, it sticks to the first
 * car it touches (riding along wherever that car goes, a tow truck's hook
 * included) or lies where it lands, and nothing happens until the player
 * sets them all off at once with DETONATE, from anywhere, in a car or not.
 * Pure and tested (tests/charges.test.ts); game/combat.ts throws, sticks
 * and sets them off (a stuck one through the car's own ignite → wreck →
 * explosion sequence), main.ts keeps the cars carrying one from being
 * recycled, render/chargeLook.ts draws them.
 *
 * - MAX_CHARGES live at once; a throw past that is refused.
 * - A charge on a car that's wrecked some other way first goes up with it
 *   and the wreck is the player's (Combat.vehicleExploded).
 * - One lying on the road is forgotten once the player is FORGET_RANGE away.
 * - PARTING GIFT: a charge going off on a car someone else is driving with
 *   the player GIFT_RANGE away or more, or on the cash van or the Mayor's
 *   limo from anywhere.
 */
import { len2 } from '../core/len';
import type { VehicleArchetype } from '../entities/vehicle';

/** Most charges out (stuck or lying) at once. */
export const MAX_CHARGES = 3;
/** A charge lying on the road is cleaned up once the player is this far from it, m. */
export const FORGET_RANGE = 400;
/** PARTING GIFT on a driven car: the player at least this far from it, m. */
export const GIFT_RANGE = 30;
/** A stuck charge sits this high on the car at least, and at most, m (roof and boot lids). */
export const STUCK_LOW = 0.55;
export const STUCK_HIGH = 1.35;
/** A thrown charge sticks to a car body it comes within this of, m (it's sticky). */
export const STICK_MARGIN = 0.25;
/** A stuck charge's car blows on this short a fuse, s: a breath after the click. */
export const DETONATE_FUSE = 0.05;
/** The cash van's paint (game/scenes/cashRun.ts CASH_PAINT; a test keeps them equal). */
export const CASH_VAN_PAINT = '#4a5560';
/** The Mayor's pearl limo (s5 RIBBON CUTTING). */
export const LULL_LIMO_PAINT = '#ece6da';

/** What a charge can ride on: a car's pose. */
export interface Carrier {
  sim: { x: number; z: number; heading: number };
}

export interface Charge<C extends Carrier> {
  alive: boolean;
  /** The car it's stuck to, or null: lying on the road. */
  car: C | null;
  /** Where on the car, in its frame (across, up, along), m. */
  lx: number;
  ly: number;
  lz: number;
  /** Where it is now (stepped from the car's pose), m. */
  x: number;
  y: number;
  z: number;
  /** Seconds since it stuck or landed (the blink). */
  age: number;
  byPlayer: boolean;
}

export class Charges<C extends Carrier> {
  readonly list: Charge<C>[] = [];

  constructor() {
    for (let i = 0; i < MAX_CHARGES; i++) this.list.push({ alive: false, car: null, lx: 0, ly: 0, lz: 0, x: 0, y: 0, z: 0, age: 0, byPlayer: false });
  }

  /** How many are out. */
  get count(): number {
    let n = 0;
    for (const c of this.list) if (c.alive) n++;
    return n;
  }

  /** Any out (DETONATE shows)? */
  get live(): boolean {
    for (const c of this.list) if (c.alive) return true;
    return false;
  }

  /** No room for another. */
  get full(): boolean {
    return this.count >= MAX_CHARGES;
  }

  /** Stick one to `car` where it touched at (x, y, z). Null if full. */
  stick(car: C, x: number, y: number, z: number, byPlayer: boolean): Charge<C> | null {
    const c = this.take();
    if (!c) return null;
    const s = car.sim;
    const dx = x - s.x;
    const dz = z - s.z;
    const cos = Math.cos(s.heading);
    const sin = Math.sin(s.heading);
    // The car's across axis is (cos h, -sin h), its forward (sin h, cos h).
    c.lx = dx * cos - dz * sin;
    c.lz = dx * sin + dz * cos;
    c.ly = Math.min(STUCK_HIGH, Math.max(STUCK_LOW, y));
    c.car = car;
    c.byPlayer = byPlayer;
    place(c);
    return c;
  }

  /** Lay one on the road at (x, z). Null if full. */
  lay(x: number, z: number, byPlayer: boolean): Charge<C> | null {
    const c = this.take();
    if (!c) return null;
    c.car = null;
    c.lx = c.ly = c.lz = 0;
    c.x = x;
    c.y = 0.05;
    c.z = z;
    c.byPlayer = byPlayer;
    return c;
  }

  /** Is a charge riding on `car`? */
  carries(car: C): boolean {
    for (const c of this.list) if (c.alive && c.car === car) return true;
    return false;
  }

  /** The cars carrying one, pushed onto `out` (the keep guard). */
  cars(out: C[]): C[] {
    for (const c of this.list) if (c.alive && c.car !== null && !out.includes(c.car)) out.push(c.car);
    return out;
  }

  /** Take every charge off `car` (it went up anyway); how many there were. */
  release(car: C): number {
    let n = 0;
    for (const c of this.list) {
      if (c.alive && c.car === car) {
        c.alive = false;
        c.car = null;
        n++;
      }
    }
    return n;
  }

  /**
   * Per step: stuck ones follow their car; ones lying on the road with the
   * player FORGET_RANGE away are cleaned up; one whose car has gone
   * (`present` false: retired by its own system) goes with it.
   */
  step(dt: number, playerX: number, playerZ: number, present: (car: C) => boolean): void {
    for (const c of this.list) {
      if (!c.alive) continue;
      c.age += dt;
      if (c.car) {
        if (!present(c.car)) {
          c.alive = false;
          c.car = null;
          continue;
        }
        place(c);
      } else if (len2(c.x - playerX, c.z - playerZ) >= FORGET_RANGE) c.alive = false;
    }
  }

  /** DETONATE: every live charge into `out` (copies), and none left. */
  detonateAll(out: Array<Charge<C>>): Array<Charge<C>> {
    out.length = 0;
    for (const c of this.list) {
      if (!c.alive) continue;
      out.push({ ...c });
      c.alive = false;
      c.car = null;
    }
    return out;
  }

  clear(): void {
    for (const c of this.list) {
      c.alive = false;
      c.car = null;
    }
  }

  private take(): Charge<C> | null {
    for (const c of this.list) {
      if (!c.alive) {
        c.alive = true;
        c.age = 0;
        return c;
      }
    }
    return null;
  }
}

/** A stuck charge's world position from its car's pose. */
function place<C extends Carrier>(c: Charge<C>): void {
  const s = c.car!.sim;
  const cos = Math.cos(s.heading);
  const sin = Math.sin(s.heading);
  c.x = s.x + c.lx * cos + c.lz * sin;
  c.z = s.z - c.lx * sin + c.lz * cos;
  c.y = c.ly;
}

/** The two cars that always earn PARTING GIFT. */
export type ChargePrize = 'cashVan' | 'limo';

/** Is this the cash van or the Mayor's limo? */
export function prizeOf(archetype: VehicleArchetype, paint: unknown): ChargePrize | null {
  const p = typeof paint === 'string' ? paint.toLowerCase() : null;
  if (archetype === 'van' && p === CASH_VAN_PAINT) return 'cashVan';
  if (archetype === 'limo' && p === LULL_LIMO_PAINT) return 'limo';
  return null;
}

/** What PARTING GIFT reads off a charge going up on a car. */
export interface GiftCheck {
  /** Someone other than the player was driving it. */
  driven: boolean;
  /** The player's distance from it, m. */
  distance: number;
  prize: ChargePrize | null;
}

/** Does this blast earn PARTING GIFT? */
export function partingGift(g: GiftCheck): boolean {
  return g.prize !== null || (g.driven && g.distance >= GIFT_RANGE);
}

/** Where the game is, for DETONATE. */
export interface DetonateGate {
  paused: boolean;
  /** The title (attract mode) is up. */
  title: boolean;
  /** Observe mode's free camera. */
  observing: boolean;
  /** A menu or panel takes the input (the TEST sheet, the map editor, Settings). */
  menu: boolean;
  /** A card over play (results, a call, the shop). */
  blocked: boolean;
  /** The player is alive and not arrested. */
  alive: boolean;
}

/** DETONATE only in play: never on the title, paused, in menus or panels, observing, under a card, or dead. */
export function canDetonate(g: DetonateGate): boolean {
  return !g.paused && !g.title && !g.observing && !g.menu && !g.blocked && g.alive;
}

/** The one-time nudge when the first charge is out: how to set it off on the device in use. */
export function detonateHint(device: 'keyboard' | 'touch' | 'gamepad'): string {
  return device === 'touch' ? 'BOOM SETS IT OFF' : device === 'gamepad' ? 'D-PAD ↓ SETS IT OFF' : 'G SETS IT OFF';
}
