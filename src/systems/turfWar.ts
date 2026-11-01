/**
 * Gang turf flare-ups, the rules (game/scenes/turfWar.ts runs them): where
 * two crews' turfs meet, which crew holds each district, and how a
 * skirmish goes: who the player has turned against, who's still in it,
 * when it's over. Pure (no three.js), tested in tests/turfWar.test.ts.
 *
 * The gangs with respect (game/gangs.ts GANGS: the VIPERS on the Neon
 * Mile) are one side; the crews of the districts round them (RIVALS, no
 * hangouts or respect of their own, just colours) the other. A skirmish
 * only starts on a border where one of GANGS' turfs meets a rival's.
 */
import { GANGS, gangOn, type GangDef } from '../game/gangs';
import { BLOCKS_PER_SIDE } from '../world/city';
import { districtOf, type District } from '../world/districts';
import { cornerPoint } from './crowd';

/** A crew in a turf war: a gang with respect (GANGS) or a rival crew. */
export type Crew = Pick<GangDef, 'id' | 'name' | 'turf' | 'shirt' | 'pants' | 'bodies'>;

/** The crews next door to the gangs' turf: colours only (no hangouts, no respect). */
export const RIVALS: readonly Crew[] = [
  { id: 'cobble-kings', name: 'COBBLE KINGS', turf: 'oldtown', shirt: '#c8262c', pants: '#2a2622', bodies: ['ped_stocky', 'ped_coat', 'ped_slim'] },
  { id: 'dock-rats', name: 'DOCK RATS', turf: 'industrial', shirt: '#f08a1c', pants: '#2e3a4c', bodies: ['ped_stocky', 'ped_slim', 'ped_coat'] },
  { id: 'glass-boys', name: 'GLASS BOYS', turf: 'downtown', shirt: '#e8e8ee', pants: '#1c2a44', bodies: ['ped_slim', 'ped_coat', 'ped_stocky'] },
];

/** The crew whose turf `district` is (a gang with respect first), if any. */
export function crewOn(district: District): Crew | null {
  return gangOn(district) ?? RIVALS.find((c) => c.turf === district) ?? null;
}

/** Is `crew` one of the gangs with respect (game/gangs.ts GANGS)? */
export function isGang(crew: Crew): boolean {
  return GANGS.some((g) => g.id === crew.id);
}

/**
 * A place two crews' turfs meet: the middle of the pavement of a `home`
 * block's edge that faces the `away` crew's block across the road.
 */
export interface TurfBorder {
  x: number;
  z: number;
  /** Along that pavement, unit (the two sides square up along it). */
  alongX: number;
  alongZ: number;
  home: Crew;
  away: Crew;
}

/** Every border between a gang's turf and a rival's, both ways round (each block edge facing the other's). */
export function turfBorders(district: (bx: number, bz: number) => District = districtOf): TurfBorder[] {
  const out: TurfBorder[] = [];
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  // Edge facing each neighbour (edges run clockwise: 0 north, 1 east, 2 south, 3 west).
  const sides: ReadonlyArray<readonly [number, number, number]> = [
    [0, -1, 0],
    [1, 0, 1],
    [0, 1, 2],
    [-1, 0, 3],
  ];
  for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
    for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
      const home = crewOn(district(bx, bz));
      if (!home) continue;
      for (const [dx, dz, edge] of sides) {
        const nx = bx + dx;
        const nz = bz + dz;
        if (nx < 0 || nz < 0 || nx >= BLOCKS_PER_SIDE || nz >= BLOCKS_PER_SIDE) continue;
        const away = crewOn(district(nx, nz));
        if (!away || away.id === home.id || (!isGang(home) && !isGang(away))) continue;
        cornerPoint(bx, bz, edge, a);
        cornerPoint(bx, bz, edge + 1, b);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, alongX: (b.x - a.x) / len, alongZ: (b.z - a.z) / len, home, away });
      }
    }
  }
  return out;
}

// --- A skirmish ---------------------------------------------------------------

export type Side = 0 | 1;

/** Members a side brings, and the share of skirmishes where one on each side has a gun. */
export const CREW_SIZE = [2, 4] as const;
export const GUN_CHANCE = 0.3;
/** Someone this hurt (HP) may run for it (FLEE_CHANCE, judged once). */
export const FLEE_HP = 35;
export const FLEE_CHANCE = 0.5;
/** A skirmish is called off after this long, s, whatever's going on. */
export const SKIRMISH_TIME = 75;

export interface Skirmish {
  /** Has the player hit someone on side 0 / side 1 (that side's turned on them)? */
  foe: [boolean, boolean];
}

export function createSkirmish(): Skirmish {
  return { foe: [false, false] };
}

/**
 * The player hit someone on `side`: that side turns on them; the first
 * side they hit makes the other their friend for the rest of the skirmish.
 * Returns true if this changed anything.
 */
export function playerStrikes(s: Skirmish, side: Side): boolean {
  if (s.foe[side]) return false;
  s.foe[side] = true;
  return true;
}

/** Does `side` stand with the player (they hit only the other side)? */
export function friendly(s: Skirmish, side: Side): boolean {
  return !s.foe[side] && s.foe[(1 - side) as Side];
}

/**
 * Who's won, from how many are still in it on each side (on their feet, or
 * only knocked over: not knocked out, not run off): the side left standing,
 * 'none' if neither is, or null while both are.
 */
export function outcome(standing0: number, standing1: number): Side | 'none' | null {
  if (standing0 > 0 && standing1 > 0) return null;
  if (standing0 === 0 && standing1 === 0) return 'none';
  return standing0 > 0 ? 0 : 1;
}

/**
 * Is it over? Once a side has won, it's over unless the winners have the
 * player to settle with (they're the player's foes and the player's still
 * close and alive); and always once it has run SKIRMISH_TIME.
 */
export function over(s: Skirmish, standing0: number, standing1: number, playerNear: boolean, age: number): boolean {
  if (age > SKIRMISH_TIME) return true;
  const o = outcome(standing0, standing1);
  if (o === null) return false;
  if (o === 'none') return true;
  return !(s.foe[o] && playerNear);
}

/** Does someone this hurt run for it? (`roll`: a uniform random number, judged once.) */
export function runsFor(hp: number, roll: number): boolean {
  return hp < FLEE_HP && roll < FLEE_CHANCE;
}
