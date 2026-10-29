/**
 * Vehicle damage: impacts wear health down; below SMOKE_AT the car smokes,
 * below FIRE_AT it catches fire and burns down to an explosion, leaving a
 * wreck. Pure state, so it's unit-tested and the renderer just reads `stage`.
 */
export interface DamageState {
  health: number;
  maxHealth: number;
  burning: boolean;
  wrecked: boolean;
}

export type DamageStage = 'ok' | 'smoking' | 'burning' | 'wrecked';

/** Fractions of max health. */
export const SMOKE_AT = 0.6;
export const FIRE_AT = 0.25;
/** Health lost per second while on fire (as a fraction of max). */
const BURN_RATE = 0.06;
/** Impacts below this speed (m/s) are free: parking taps, scrapes. */
const IMPACT_THRESHOLD = 4;
const DAMAGE_PER_MS = 5;

export function createDamage(maxHealth = 100): DamageState {
  return { health: maxHealth, maxHealth, burning: false, wrecked: false };
}

export function impactDamage(impactSpeed: number): number {
  return Math.max(0, impactSpeed - IMPACT_THRESHOLD) * DAMAGE_PER_MS;
}

export function applyDamage(d: DamageState, amount: number): void {
  if (d.wrecked || amount <= 0) return;
  d.health = Math.max(0, d.health - amount);
  if (d.health <= d.maxHealth * FIRE_AT) d.burning = true;
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
export function blastDamage(distance: number, radius = 9, max = 70): number {
  return distance >= radius ? 0 : max * (1 - distance / radius);
}
