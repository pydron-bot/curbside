/**
 * The air horn (W3-B): a weapon held and aimed like a gun whose every use
 * (a canister of blasts, topped up like ammo) is one short cone of noise.
 * Non-lethal: nobody's hurt and nobody's knocked down. Pure and tested
 * (tests/airHorn.test.ts); game/combat.ts blowHorn() applies it and
 * reports the `airHorn` event, which the alarms (scenes/alarms.ts: the
 * DOMINO chain), heat (a nuisance), the scanner, pigeons, dogs, audio and
 * effects pick up.
 *
 * - **The cone** is the hose's (serviceTools coneHit), wider and shorter,
 *   and walls block it: someone round a corner doesn't hear it in the face.
 * - **People** in it: right in front they reel (a stagger) and cover their
 *   ears; within HORN_EARS they cover their ears a beat, then run; further
 *   off they just scatter. Police and anyone fighting stand their ground.
 * - **Drivers** in it stamp on the brake (some jerk the wheel), sit stalled
 *   a moment and honk back (traffic.ts startleDriver).
 */
import { len2 } from '../core/len';
import { cower, scare, type PedAgent } from './crowd';
import { clipJet, coneHit } from './serviceTools';
import { startleDriver, type AiDriver } from './traffic';
import { WEAPONS } from './weapons';

/** How far the blast carries, m (the weapon's range). */
export const HORN_RANGE = WEAPONS.horn.range;
/** Half the cone's angle, rad (~29°): a lot wider than the hose's jet. */
export const HORN_HALF_ANGLE = 0.5;
/** Closer than this, m, people reel back (a stagger this long, s, pushed this fast, m/s)... */
export const HORN_REEL = 2.5;
export const HORN_REEL_SECONDS = 0.45;
export const HORN_REEL_PUSH = 1.6;
/** ...closer than this, m, they cover their ears this long, s, before they run... */
export const HORN_EARS = 8;
export const HORN_EARS_SECONDS = 0.7;
/** ...and the rest scatter for this long, s. */
export const HORN_FLEE_SECONDS = 4;
/** Drivers in the cone brake and sit stalled this long, s; this share also jerk the wheel this far. */
export const HORN_STALL: readonly [number, number] = [0.8, 2];
export const HORN_SWERVE_CHANCE = 0.4;
export const HORN_SWERVE = 0.6;
/**
 * A blast that sets alarms off starts a chain (DOMINO ×2 for the alarm) at
 * most once in this long, s (scenes/alarms.ts's 'airHorn' clock, LOUD).
 */
export const HORN_CHAIN_EVERY: readonly [number, number] = [40, 70];

/** How far down the blast from (ox, oz) along unit (dx, dz) a thing at (px, pz), radius r, is hit, or -1. */
export function hornHit(ox: number, oz: number, dx: number, dz: number, px: number, pz: number, r: number, range = HORN_RANGE): number {
  return coneHit(ox, oz, dx, dz, px, pz, r, range, HORN_HALF_ANGLE);
}

/** Can the blast from (ox, oz) reach a thing at (px, pz) of radius r without a wall (`rects`) in the way? */
export function hornClear(
  rects: readonly { minX: number; minZ: number; maxX: number; maxZ: number }[],
  ox: number,
  oz: number,
  px: number,
  pz: number,
  r: number,
): boolean {
  const d = len2(px - ox, pz - oz);
  if (d < 0.5) return true;
  return clipJet(rects, ox, oz, (px - ox) / d, (pz - oz) / d, d) >= d - r - 0.1;
}

export type Startle = 'none' | 'reel' | 'ears' | 'flee';

/** What the blast does to someone `along` m down it (police, fighters, the fallen and the burning: nothing). */
export function startleFor(p: PedAgent, along: number): Startle {
  if (p.mode === 'down' || p.mode === 'fight' || p.mode === 'shoot' || p.role === 'cop' || p.burning > 0) return 'none';
  return along < HORN_REEL ? 'reel' : along < HORN_EARS ? 'ears' : 'flee';
}

/** Startle someone `along` m down a blast from (ox, oz): reel, cover their ears, run. Returns what it did. */
export function startle(p: PedAgent, ox: number, oz: number, along: number): Startle {
  const s = startleFor(p, along);
  if (s === 'none') return s;
  if (s === 'flee') {
    scare(p, ox, oz, HORN_FLEE_SECONDS);
    return s;
  }
  cower(p, ox, oz, HORN_EARS_SECONDS);
  if (s === 'reel') {
    const dx = p.s.x - ox;
    const dz = p.s.z - oz;
    const d = len2(dx, dz) || 1;
    p.stagger = Math.max(p.stagger, HORN_REEL_SECONDS);
    p.s.vx = (dx / d) * HORN_REEL_PUSH;
    p.s.vz = (dz / d) * HORN_REEL_PUSH;
  }
  return s;
}

/** A driver in the blast: brakes and stalls a while, some swerving. */
export function startleDriverByHorn(ai: AiDriver, rand: () => number): void {
  const seconds = HORN_STALL[0] + rand() * (HORN_STALL[1] - HORN_STALL[0]);
  const swerve = rand() < HORN_SWERVE_CHANCE ? (rand() < 0.5 ? -HORN_SWERVE : HORN_SWERVE) : 0;
  startleDriver(ai, seconds, swerve);
}
