/**
 * Vehicle damage: impacts wear health down; below SMOKE_AT the car smokes,
 * below FIRE_AT it catches fire and burns down to an explosion, leaving a
 * wreck. Pure state, so it's unit-tested and the renderer just reads `stage`.
 *
 * Tuning: a car survives a couple of solid crashes (it smokes after one big
 * hit and burns only after real abuse); in a car-on-car crash the rammer
 * takes less than the car it hits, and the heavier car less than the lighter
 * one. Explosions set cars close by alight on a short fuse, so a jam still
 * goes up in a rippling chain, and hurt the rest by distance.
 */
export interface DamageState {
  health: number;
  maxHealth: number;
  burning: boolean;
  wrecked: boolean;
  /** Sim time the player last damaged it (rammed, shot, blew up next to it); -Infinity if never. */
  lastPlayerHit: number;
}

export type DamageStage = 'ok' | 'smoking' | 'burning' | 'wrecked';

/** Fractions of max health. */
export const SMOKE_AT = 0.6;
export const FIRE_AT = 0.2;
/** Health lost per second while on fire (as a fraction of max): ~4.5 s to get out from FIRE_AT. */
const BURN_RATE = 0.045;
/** A wreck counts as the player's doing if they hurt it within this many seconds. */
export const ATTRIBUTION_SECONDS = 10;
/** Impacts below this speed (m/s) are free: parking taps, scrapes, glancing touches. */
const IMPACT_THRESHOLD = 6;
const DAMAGE_PER_MS = 2.6;
/** In a car-on-car crash each car takes at least this share; the rest by who brought the speed. */
const RAMMER_SHARE = 0.4;
/** Landings softer than this (vertical m/s) are free; a car is built for a kerb, not a jump. */
const LANDING_THRESHOLD = 10;
const LANDING_PER_MS = 3;

export function createDamage(maxHealth = 100): DamageState {
  return { health: maxHealth, maxHealth, burning: false, wrecked: false, lastPlayerHit: -Infinity };
}

/** Remember that the player just hurt this vehicle (for blame when it blows up). */
export function markPlayerHit(d: DamageState, now: number): void {
  d.lastPlayerHit = now;
}

/** Did the player damage it recently enough to take the credit (or blame)? */
export function blamesPlayer(d: DamageState, now: number): boolean {
  return now - d.lastPlayerHit <= ATTRIBUTION_SECONDS;
}

/** Damage from hitting something at `impactSpeed` (m/s along the contact normal). */
export function impactDamage(impactSpeed: number): number {
  return Math.max(0, impactSpeed - IMPACT_THRESHOLD) * DAMAGE_PER_MS;
}

/**
 * One car's damage from a car-on-car crash: `own` and `other` are the
 * closing speed each car brought (CarContact.closingA/B), masses relative.
 * Ramming a parked car costs the rammer 40% of what the parked car takes; a
 * head-on between equals costs each 70%; a van shrugs off a compact.
 */
export function crashDamage(impact: number, own: number, other: number, ownMass = 1, otherMass = 1): number {
  const base = impactDamage(impact);
  if (base <= 0) return 0;
  const total = Math.max(0, own) + Math.max(0, other);
  const fromOther = total > 1e-6 ? Math.max(0, other) / total : 0.5;
  const mass = Math.min(1.4, Math.max(0.7, Math.sqrt(otherMass / ownMass)));
  return base * (RAMMER_SHARE + (1 - RAMMER_SHARE) * fromOther) * mass;
}

/** Damage from landing a jump with vertical speed `vy` (m/s, positive). */
export function landingDamage(vy: number): number {
  return Math.max(0, vy - LANDING_THRESHOLD) * LANDING_PER_MS;
}

export function applyDamage(d: DamageState, amount: number): void {
  if (d.wrecked || amount <= 0) return;
  d.health = Math.max(0, d.health - amount);
  if (d.health <= d.maxHealth * FIRE_AT) d.burning = true;
}

/**
 * Set it alight on a short fuse: burning, with at most `fuse` seconds of
 * burning left (a blast next to it). Chain reactions ripple through a jam.
 */
export function ignite(d: DamageState, fuse: number): void {
  if (d.wrecked) return;
  d.burning = true;
  d.health = Math.min(d.health, Math.max(0.001, fuse * d.maxHealth * BURN_RATE));
}

/** Burn down; returns true on the step the vehicle explodes. */
export function stepDamage(d: DamageState, dt: number): boolean {
  if (d.wrecked) return false;
  if (d.burning) d.health -= d.maxHealth * BURN_RATE * dt;
  if (d.health <= 0) {
    d.health = 0;
    d.burning = false;
    d.wrecked = true;
    return true;
  }
  return false;
}

export function damageStage(d: DamageState): DamageStage {
  if (d.wrecked) return 'wrecked';
  if (d.burning) return 'burning';
  if (d.health <= d.maxHealth * SMOKE_AT) return 'smoking';
  return 'ok';
}

/** Explosion falloff: full damage at the centre, none at `radius`. */
export function blastDamage(distance: number, radius = 9, max = 85): number {
  return distance >= radius ? 0 : max * (1 - distance / radius);
}

/** What a blast does: a car going up, a grenade, a rocket. */
export interface BlastSpec {
  /** Cars, people and the player inside this are hurt, m. */
  radius: number;
  /** Damage to a car at the centre (falls off to 0 at the radius). */
  carDamage: number;
  /** Cars this close (to their nearest part) catch fire on a short fuse, m. */
  igniteRadius: number;
  /** Damage to the player on foot at the centre. */
  playerDamage: number;
  /** Damage to a pedestrian at the centre (100 HP each). */
  pedDamage: number;
  /** Shove on cars at the centre, m/s. */
  push: number;
}

export const BLASTS = {
  car: { radius: 9, carDamage: 85, igniteRadius: 4.8, playerDamage: 60, pedDamage: 120, push: 9 },
  grenade: { radius: 8, carDamage: 105, igniteRadius: 3.2, playerDamage: 70, pedDamage: 150, push: 9 },
  rocket: { radius: 10, carDamage: 160, igniteRadius: 5.5, playerDamage: 90, pedDamage: 200, push: 13 },
} as const satisfies Record<string, BlastSpec>;

export type BlastKind = keyof typeof BLASTS;
