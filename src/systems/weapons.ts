/**
 * Weapons: specs, the player's arsenal (ammo, cooldowns, spread bloom), and
 * the pure aiming maths: hitscan rays against peds, vehicles and buildings,
 * auto-aim, lock-on and drive-by targeting. No three.js.
 *
 * Guns are hitscan; grenades and molotovs are thrown and rockets fly
 * (systems/projectiles.ts). No reloading: ammo comes from crates. Each gun's
 * spread blooms as it fires and settles when it stops, so a held trigger
 * sprays and tapped shots land.
 */
import type { Rect } from '../world/city';

export type WeaponKind = 'pistol' | 'smg' | 'shotgun' | 'grenade' | 'molotov' | 'rocket';

/** How a weapon fires: hitscan bullets, a thrown arc, or a flying rocket. */
export type FireMode = 'gun' | 'throw' | 'launcher';

export interface WeaponSpec {
  label: string;
  mode: FireMode;
  /** Damage per pellet to people (100 HP each; cars take a share, see VEHICLE_SHARE). */
  damage: number;
  pellets: number;
  /** Seconds between shots. */
  interval: number;
  /** Half-angle of random spread when settled, radians. */
  spread: number;
  /** Spread added per shot (bloom), radians... */
  bloom: number;
  /** ...up to this much extra... */
  bloomMax: number;
  /** ...recovering at this rate, radians per second. */
  recover: number;
  /** Bullets: how far they reach. Thrown: the longest throw. Rockets: how far they fly. m. */
  range: number;
  /** Ammo a pickup gives. */
  pickupAmmo: number;
  /** Most ammo you can carry. */
  maxAmmo: number;
  automatic: boolean;
  /** Can be fired out of a car window. */
  driveBy: boolean;
}

export const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  pistol: {
    label: 'PISTOL',
    mode: 'gun',
    damage: 34,
    pellets: 1,
    interval: 0.3,
    spread: 0.025,
    bloom: 0.04,
    bloomMax: 0.12,
    recover: 0.1,
    range: 32,
    pickupAmmo: 24,
    maxAmmo: 120,
    automatic: false,
    driveBy: true,
  },
  smg: {
    label: 'SMG',
    mode: 'gun',
    damage: 15,
    pellets: 1,
    interval: 0.09,
    spread: 0.045,
    bloom: 0.03,
    bloomMax: 0.15,
    recover: 0.18,
    range: 28,
    pickupAmmo: 90,
    maxAmmo: 300,
    automatic: true,
    driveBy: true,
  },
  shotgun: {
    label: 'SHOTGUN',
    mode: 'gun',
    damage: 16,
    pellets: 7,
    interval: 0.85,
    spread: 0.2,
    bloom: 0.04,
    bloomMax: 0.08,
    recover: 0.2,
    range: 16,
    pickupAmmo: 12,
    maxAmmo: 48,
    automatic: false,
    driveBy: false,
  },
  grenade: {
    label: 'GRENADE',
    mode: 'throw',
    damage: 0,
    pellets: 1,
    interval: 0.8,
    spread: 0,
    bloom: 0,
    bloomMax: 0,
    recover: 1,
    range: 20,
    pickupAmmo: 4,
    maxAmmo: 12,
    automatic: false,
    driveBy: false,
  },
  molotov: {
    label: 'MOLOTOV',
    mode: 'throw',
    damage: 0,
    pellets: 1,
    interval: 0.8,
    spread: 0,
    bloom: 0,
    bloomMax: 0,
    recover: 1,
    range: 18,
    pickupAmmo: 3,
    maxAmmo: 10,
    automatic: false,
    driveBy: false,
  },
  rocket: {
    label: 'ROCKETS',
    mode: 'launcher',
    damage: 0,
    pellets: 1,
    interval: 1.3,
    spread: 0.01,
    bloom: 0,
    bloomMax: 0,
    recover: 1,
    range: 75,
    pickupAmmo: 3,
    maxAmmo: 8,
    automatic: false,
    driveBy: false,
  },
};

export const WEAPON_ORDER: WeaponKind[] = ['pistol', 'smg', 'shotgun', 'grenade', 'molotov', 'rocket'];
/** Guns that bullets come out of (an ammo crate tops these up). */
export const GUNS: readonly WeaponKind[] = ['pistol', 'smg', 'shotgun'];
/** Fraction of a bullet's damage that applies to vehicles. */
export const VEHICLE_SHARE = 0.35;
/** Drive-bys spray: spread × this out of a moving car's window. */
export const DRIVE_BY_SPREAD = 1.5;

export class Arsenal {
  ammo = new Map<WeaponKind, number>();
  /** null = fists. */
  current: WeaponKind | null = null;
  /** Extra spread from recent firing (radians), for the current weapon. */
  bloom = 0;
  private cooldown = 0;

  /** Take a weapon pickup: its ammo (up to the cap), and draw it if empty-handed. */
  pickUp(kind: WeaponKind): void {
    const spec = WEAPONS[kind];
    this.ammo.set(kind, Math.min(spec.maxAmmo, (this.ammo.get(kind) ?? 0) + spec.pickupAmmo));
    if (this.current === null) this.current = kind;
  }

  /**
   * An ammo crate: half a pickup's worth for every gun owned (at least a
   * pistol's clip if none). Returns false when every gun is already full.
   */
  addAmmo(): boolean {
    let owned = false;
    let took = false;
    for (const k of GUNS) {
      const have = this.ammo.get(k) ?? 0;
      if (have <= 0) continue;
      owned = true;
      const spec = WEAPONS[k];
      const next = Math.min(spec.maxAmmo, have + Math.ceil(spec.pickupAmmo / 2));
      if (next > have) took = true;
      this.ammo.set(k, next);
    }
    if (!owned) {
      this.pickUp('pistol');
      return true;
    }
    return took;
  }

  /** Has ammo for this weapon. */
  has(kind: WeaponKind): boolean {
    return (this.ammo.get(kind) ?? 0) > 0;
  }

  /**
   * Cycle fists → owned weapons → fists. `allow` narrows the choice (in a
   * car: only what fires out of a window).
   */
  cycle(dir: 1 | -1 = 1, allow: (k: WeaponKind) => boolean = () => true): void {
    const options: Array<WeaponKind | null> = [null, ...WEAPON_ORDER.filter((k) => this.has(k) && allow(k))];
    const i = options.indexOf(this.current);
    // Holding something not on offer (a grenade, getting into a car): start from fists.
    const from = i < 0 ? 0 : i;
    this.current = options[(from + dir + options.length) % options.length];
    this.bloom = 0;
  }

  clear(): void {
    this.ammo.clear();
    this.current = null;
    this.cooldown = 0;
    this.bloom = 0;
  }

  step(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const k = this.current;
    this.bloom = k ? Math.max(0, this.bloom - WEAPONS[k].recover * dt) : 0;
  }

  /** Spread to fire with now: the weapon's own plus bloom, radians. */
  get spread(): number {
    const k = this.current;
    return k ? WEAPONS[k].spread + this.bloom : 0;
  }

  /** Ready to fire (cooled down, loaded)? */
  get ready(): boolean {
    const k = this.current;
    return k !== null && this.cooldown <= 0 && this.has(k);
  }

  /** Spend a round if ready; returns the weapon fired, or null. Fire before reading spread for the next. */
  tryFire(): WeaponKind | null {
    const k = this.current;
    if (!k || this.cooldown > 0) return null;
    const left = this.ammo.get(k) ?? 0;
    if (left <= 0) return null;
    this.ammo.set(k, left - 1);
    const spec = WEAPONS[k];
    this.cooldown = spec.interval;
    this.bloom = Math.min(spec.bloomMax, this.bloom + spec.bloom);
    if (left - 1 === 0) this.current = this.nextLoaded(k); // out of ammo: switch to the next weapon
    return k;
  }

  /** The best gun that fires out of a car window, if any (SMG first). */
  driveByGun(): WeaponKind | null {
    for (let i = WEAPON_ORDER.length - 1; i >= 0; i--) {
      const k = WEAPON_ORDER[i];
      if (WEAPONS[k].driveBy && this.has(k)) return k;
    }
    return null;
  }

  /** The next weapon after `from` (wrapping) that still has ammo, or fists. */
  private nextLoaded(from: WeaponKind): WeaponKind | null {
    const start = WEAPON_ORDER.indexOf(from);
    for (let i = 1; i <= WEAPON_ORDER.length; i++) {
      const k = WEAPON_ORDER[(start + i) % WEAPON_ORDER.length];
      if (this.has(k)) return k;
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

/** Something to lock on to: where it is and whether it's fighting the player. */
export interface LockCandidate {
  x: number;
  z: number;
  /** Attacking the player (a fighter, a shooter, police after them): locked first. */
  hostile: boolean;
}

/** Without a deliberate aim, a non-hostile target must be within this half-angle of the facing (a 90° cone). */
export const LOCK_CONE = Math.PI / 4;

/**
 * Lock-on while firing: the index of the target to turn to, or -1. Hostiles
 * come first, at any angle within range (nearest, favouring ones in front);
 * failing that the best target within LOCK_CONE of `heading`. With a
 * deliberate aim (`aimCone` > 0, stick or mouse) only targets within that
 * half-angle of the aim count, hostiles still first.
 */
export function lockTarget(
  ox: number,
  oz: number,
  heading: number,
  targets: ArrayLike<LockCandidate>,
  count: number,
  range: number,
  aimCone = 0,
): number {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const coneCos = Math.cos(aimCone > 0 ? aimCone : LOCK_CONE);
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < count; i++) {
    const t = targets[i];
    const dx = t.x - ox;
    const dz = t.z - oz;
    const d = Math.hypot(dx, dz);
    if (d < 0.3 || d > range) continue;
    const cos = (dx * fx + dz * fz) / d;
    const anyAngle = t.hostile && aimCone <= 0;
    if (!anyAngle && cos < coneCos) continue;
    // Hostiles always beat bystanders; then close and centred.
    const score = d * (2 - cos) + (t.hostile ? 0 : 1000);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Drive-bys aim within this half-angle of straight out of either side window. */
export const DRIVE_BY_CONE = 1.2;

/**
 * Drive-by targeting from a car at (x, z) facing `heading`: the best target
 * within DRIVE_BY_CONE of straight out of a side window (hostiles first,
 * then close and square to the window), within range. `side` 1 looks only
 * out of the left (driver's) window, -1 only the right, 0 either. Writes the
 * unit direction into `out` and returns the target's index, or -1 (out then
 * points straight out of that window; the driver's for 0).
 */
export function driveByAim(
  x: number,
  z: number,
  heading: number,
  targets: ArrayLike<LockCandidate>,
  count: number,
  range: number,
  out: { x: number; z: number },
  side: -1 | 0 | 1 = 0,
): number {
  // The car's left axis is (cos h, -sin h).
  const lx = Math.cos(heading);
  const lz = -Math.sin(heading);
  const coneCos = Math.cos(DRIVE_BY_CONE);
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < count; i++) {
    const t = targets[i];
    const dx = t.x - x;
    const dz = t.z - z;
    const d = Math.hypot(dx, dz);
    if (d < 1.5 || d > range) continue;
    const across = (dx * lx + dz * lz) / d; // +1 straight out of the left window, -1 the right
    if (side !== 0 && across * side <= 0) continue;
    const square = Math.abs(across);
    if (square < coneCos) continue;
    const score = d * (2 - square) * (t.hostile ? 0.5 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = i;
      out.x = dx / d;
      out.z = dz / d;
    }
  }
  if (best < 0) {
    const k = side === -1 ? -1 : 1;
    out.x = lx * k;
    out.z = lz * k;
  }
  return best;
}
