/**
 * Weapon and health crates on the sidewalks. Positions come from the city
 * seed so they're in the same places every game; taken crates respawn.
 */
import { cornerPoint } from '../systems/crowd';
import type { WeaponKind } from '../systems/weapons';
import { BLOCKS_PER_SIDE } from './city';
import { mulberry32 } from './random';

export type PickupKind = WeaponKind | 'health';

export interface Pickup {
  x: number;
  z: number;
  kind: PickupKind;
  /** Sim time when it comes back, or 0 if it's available. */
  respawnAt: number;
}

export const PICKUP_RADIUS = 1.4;
export const PICKUP_RESPAWN = 30;
export const HEALTH_PICKUP = 50;

const KINDS: Array<[PickupKind, number]> = [
  ['pistol', 0.35],
  ['smg', 0.22],
  ['shotgun', 0.18],
  ['health', 0.25],
];

export function generatePickups(seed: number, count = 48): Pickup[] {
  const rand = mulberry32(seed ^ 0x51ed);
  const out: Pickup[] = [];
  for (let i = 0; i < count; i++) {
    const bx = Math.floor(rand() * BLOCKS_PER_SIDE);
    const bz = Math.floor(rand() * BLOCKS_PER_SIDE);
    const edge = Math.floor(rand() * 4);
    const a = cornerPoint(bx, bz, edge);
    const b = cornerPoint(bx, bz, edge + 1);
    const t = 0.25 + rand() * 0.5;
    let r = rand();
    let kind: PickupKind = 'pistol';
    for (const [k, w] of KINDS) if ((r -= w) <= 0) { kind = k; break; }
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, kind, respawnAt: 0 });
  }
  // Something to play with right at the start.
  out.push({ ...cornerPoint(8, 8, 0), kind: 'pistol', respawnAt: 0 });
  out[out.length - 1].x += 6;
  return out;
}

/** The available pickup within reach of (x, z), if any. */
export function pickupAt(pickups: Pickup[], x: number, z: number): Pickup | null {
  for (const p of pickups) {
    if (p.respawnAt === 0 && Math.hypot(p.x - x, p.z - z) < PICKUP_RADIUS) return p;
  }
  return null;
}

/** Bring back crates whose respawn time has passed. */
export function respawnPickups(pickups: Pickup[], now: number): void {
  for (const p of pickups) if (p.respawnAt > 0 && now >= p.respawnAt) p.respawnAt = 0;
}
