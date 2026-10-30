/**
 * Weapon, ammo, armour and health crates on the sidewalks. Positions come
 * from the city seed so they're in the same places every game; taken crates
 * respawn. Grenades, molotovs and above all rockets are rare; a few starter
 * crates sit by the spawn corner.
 */
import { cornerPoint } from '../systems/crowd';
import { WEAPONS, type WeaponKind } from '../systems/weapons';
import { BLOCKS_PER_SIDE } from './city';
import { mulberry32 } from './random';

export type PickupKind = WeaponKind | 'health' | 'armour' | 'ammo';

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
export const ARMOUR_PICKUP = 50;

const KINDS: Array<[PickupKind, number]> = [
  ['pistol', 0.21],
  ['smg', 0.14],
  ['shotgun', 0.12],
  ['health', 0.17],
  ['armour', 0.1],
  ['ammo', 0.1],
  ['grenade', 0.07],
  ['molotov', 0.05],
  ['rocket', 0.04],
];

/** The feed line for picking one up. */
export function pickupLabel(kind: PickupKind): string {
  if (kind === 'health') return '+ HEALTH';
  if (kind === 'armour') return '+ ARMOUR';
  if (kind === 'ammo') return '+ AMMO';
  return `+ ${WEAPONS[kind].label}`;
}

export function generatePickups(seed: number, count = 56): Pickup[] {
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
  // Something to play with right at the start: a pistol and, round the
  // corner, grenades and armour (clear of the safehouse door at 16.5 m).
  const starters: Array<[PickupKind, number, number]> = [
    ['pistol', 6, 0],
    ['grenade', 0, 14],
    ['armour', 22, 0],
  ];
  for (const [kind, dx, dz] of starters) {
    const at = cornerPoint(8, 8, 0);
    out.push({ x: at.x + dx, z: at.z + dz, kind, respawnAt: 0 });
  }
  return out;
}

/** The available pickup within reach of (x, z), if any. */
export function pickupAt(pickups: Pickup[], x: number, z: number): Pickup | null {
  // Squared distances: this runs over every crate each step (Math.hypot isn't inlined).
  for (const p of pickups) {
    if (p.respawnAt !== 0) continue;
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) return p;
  }
  return null;
}

/** Bring back crates whose respawn time has passed. */
export function respawnPickups(pickups: Pickup[], now: number): void {
  for (const p of pickups) if (p.respawnAt > 0 && now >= p.respawnAt) p.respawnAt = 0;
}
