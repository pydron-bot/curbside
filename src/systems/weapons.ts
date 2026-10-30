/**
 * Guns: specs, the player's arsenal, and hitscan tracing against peds,
 * vehicles, the player and buildings. Pure logic (no three.js).
 */
import type { Rect } from '../world/city';

export type WeaponKind = 'pistol' | 'smg' | 'shotgun';

export interface WeaponSpec {
  label: string;
  /** Damage per pellet to people (cars take a share, see VEHICLE_SHARE). */
  damage: number;
  pellets: number;
  /** Seconds between shots. */
  interval: number;
  /** Half-angle of random spread, radians. */
  spread: number;
  range: number;
  /** Ammo a pickup gives. */
  pickupAmmo: number;
  automatic: boolean;
}

export const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  pistol: { label: 'PISTOL', damage: 34, pellets: 1, interval: 0.32, spread: 0.03, range: 32, pickupAmmo: 24, automatic: false },
  smg: { label: 'SMG', damage: 14, pellets: 1, interval: 0.09, spread: 0.08, range: 28, pickupAmmo: 90, automatic: true },
  shotgun: { label: 'SHOTGUN', damage: 16, pellets: 7, interval: 0.85, spread: 0.2, range: 16, pickupAmmo: 12, automatic: false },
};

export const WEAPON_ORDER: WeaponKind[] = ['pistol', 'smg', 'shotgun'];
/** Fraction of a bullet's damage that applies to vehicles. */
export const VEHICLE_SHARE = 0.35;

export class Arsenal {
  ammo = new Map<WeaponKind, number>();
  /** null = fists. */
  current: WeaponKind | null = null;
  private cooldown = 0;

  pickUp(kind: WeaponKind): void {
    this.ammo.set(kind, (this.ammo.get(kind) ?? 0) + WEAPONS[kind].pickupAmmo);
    if (this.current === null) this.current = kind;
  }

  /** Cycle fists → owned guns → fists. */
  cycle(dir: 1 | -1 = 1): void {
    const options: Array<WeaponKind | null> = [null, ...WEAPON_ORDER.filter((k) => (this.ammo.get(k) ?? 0) > 0)];
    const i = options.indexOf(this.current);
    this.current = options[(i + dir + options.length) % options.length];
  }

  clear(): void {
    this.ammo.clear();
    this.current = null;
    this.cooldown = 0;
  }

  step(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  /** Spend a round if ready; returns the weapon fired, or null. */
  tryFire(): WeaponKind | null {
    const k = this.current;
    if (!k || this.cooldown > 0) return null;
    const left = this.ammo.get(k) ?? 0;
    if (left <= 0) return null;
    this.ammo.set(k, left - 1);
    this.cooldown = WEAPONS[k].interval;
    if (left - 1 === 0) this.current = this.nextLoaded(k); // out of ammo: switch to the next gun
    return k;
  }

  /** The next gun after `from` (wrapping) that still has ammo, or fists. */
  private nextLoaded(from: WeaponKind): WeaponKind | null {
    const start = WEAPON_ORDER.indexOf(from);
    for (let i = 1; i <= WEAPON_ORDER.length; i++) {
      const k = WEAPON_ORDER[(start + i) % WEAPON_ORDER.length];
      if ((this.ammo.get(k) ?? 0) > 0) return k;
    }
    return null;
  }
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** Distance along the ray (unit dir) to the circle, or Infinity. */
export function rayCircle(ox: number, oz: number, dx: number, dz: number, c: Circle): number {
  const fx = ox - c.x;
  const fz = oz - c.z;
  const b = fx * dx + fz * dz;
  const cc = fx * fx + fz * fz - c.r * c.r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : cc <= 0 ? 0 : Infinity;
}

/** Distance along the ray (unit dir) to the box, or Infinity (slab method). */
export function rayRect(ox: number, oz: number, dx: number, dz: number, r: Rect): number {
  let tmin = 0;
  let tmax = Infinity;
  for (const [o, d, lo, hi] of [
    [ox, dx, r.minX, r.maxX],
    [oz, dz, r.minZ, r.maxZ],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Unit direction toward the best target within `cone` radians of `heading`, else the heading itself. */
export function autoAim(
  ox: number,
  oz: number,
  heading: number,
  targets: Array<{ x: number; z: number }>,
  range: number,
  cone = 0.45,
): { x: number; z: number } {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  let best: { x: number; z: number } | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const dx = t.x - ox;
    const dz = t.z - oz;
    const d = Math.hypot(dx, dz);
    if (d < 0.3 || d > range) continue;
    const cos = (dx * fx + dz * fz) / d;
    if (cos < Math.cos(cone)) continue;
    const score = d * (2 - cos); // prefer close and centred
    if (score < bestScore) {
      bestScore = score;
      best = { x: dx / d, z: dz / d };
    }
  }
  return best ?? { x: fx, z: fz };
}
