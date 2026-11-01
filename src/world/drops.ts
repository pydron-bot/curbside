/**
 * Guns dropped in the street: someone armed (a gang member, an armed
 * passer-by, an officer, a suspect) who is knocked out lets go of their
 * weapon, and it lies where they fell for the player to pick up, like a
 * crate that doesn't come back. A fixed pool: the oldest goes when it's
 * full, and each one lasts DROP_LIFE seconds. Pure logic.
 */
import type { WeaponKind } from '../systems/weapons';

export interface Drop {
  kind: WeaponKind;
  x: number;
  z: number;
  /** Sim time it was dropped, s. */
  at: number;
  alive: boolean;
}

/** Most drops lying about at once. */
export const MAX_DROPS = 8;
/** A drop lies this long before it's gone, s. */
export const DROP_LIFE = 45;
/** Walk this close to pick one up, m (a little tighter than a crate). */
export const DROP_RADIUS = 1.2;

export class WeaponDrops {
  readonly list: Drop[] = [];

  constructor(capacity = MAX_DROPS) {
    for (let i = 0; i < capacity; i++) this.list.push({ kind: 'pistol', x: 0, z: 0, at: 0, alive: false });
  }

  /** Something lands at (x, z) at sim time `now` (the oldest goes if the pool is full). */
  drop(kind: WeaponKind, x: number, z: number, now: number): Drop {
    let slot = this.list[0];
    for (const d of this.list) {
      if (!d.alive) {
        slot = d;
        break;
      }
      if (d.at < slot.at) slot = d;
    }
    slot.kind = kind;
    slot.x = x;
    slot.z = z;
    slot.at = now;
    slot.alive = true;
    return slot;
  }

  /** Age them out. */
  step(now: number): void {
    for (const d of this.list) if (d.alive && now - d.at > DROP_LIFE) d.alive = false;
  }

  /** The drop within reach of (x, z), if any (not taken: see take()). */
  at(x: number, z: number): Drop | null {
    for (const d of this.list) {
      if (!d.alive) continue;
      const dx = d.x - x;
      const dz = d.z - z;
      if (dx * dx + dz * dz < DROP_RADIUS * DROP_RADIUS) return d;
    }
    return null;
  }

  take(d: Drop): void {
    d.alive = false;
  }

  /** How many are lying about. */
  get count(): number {
    let n = 0;
    for (const d of this.list) if (d.alive) n++;
    return n;
  }

  clear(): void {
    for (const d of this.list) d.alive = false;
  }
}
