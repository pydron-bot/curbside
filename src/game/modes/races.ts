/**
 * CHECKPOINT RACES: six courses through the road grid, authored as lists of
 * intersections (node (ix, iz) is the crossing at world (ix·64, iz·64)).
 * Drive into the chequered start in a car, 3-2-1, then through each
 * checkpoint in turn; medals are against a developer time computed from the
 * course (straights at speed, a cost per corner). Pure logic, unit-tested.
 */
import { BLOCK_SIZE } from '../../world/city';
import { MAX_NODE, dirHeading, lanePoint, type Dir } from '../../world/roads';
import type { Medal } from '../progressSave';

export interface RaceDef {
  id: string;
  name: string;
  /** Intersections, start first; consecutive nodes share a road (same ix or iz). */
  nodes: ReadonlyArray<readonly [number, number]>;
}

export const RACES: readonly RaceDef[] = [
  {
    id: 'race-downtown',
    name: 'DOWNTOWN DASH',
    nodes: [[0, -1], [0, -3], [2, -3], [2, -1], [3, -1], [3, 1], [1, 1], [1, 3], [-1, 3], [-1, 1]],
  },
  {
    id: 'race-harbour',
    name: 'HARBOUR LOOP',
    nodes: [[3, 3], [6, 3], [6, 5], [4, 5], [4, 7], [7, 7], [7, 4], [8, 4], [8, 8], [5, 8], [5, 6], [3, 6]],
  },
  {
    id: 'race-oldtown',
    name: 'OLD TOWN SCRAMBLE',
    // Up x = -5, not -6: a stunt ramp faces south on -6 just short of (-6, -6), its solid back to the race.
    nodes: [[-2, -2], [-2, -5], [-4, -5], [-4, -3], [-5, -3], [-5, -6], [-2, -6], [-2, -7], [-7, -7]],
  },
  {
    id: 'race-arts',
    name: 'NEON NIGHTS',
    nodes: [[2, -4], [5, -4], [5, -6], [3, -6], [3, -7], [6, -7], [6, -5], [7, -5], [7, -2], [4, -2]],
  },
  {
    id: 'race-suburbs',
    name: 'CUL-DE-SAC CRAWL',
    nodes: [[-2, 2], [-2, 5], [-5, 5], [-5, 3], [-7, 3], [-7, 6], [-4, 6], [-4, 7], [-1, 7]],
  },
  {
    id: 'race-ring',
    name: 'RING ROAD RUN',
    nodes: [[0, 8], [4, 8], [8, 8], [8, 4], [8, 0], [8, -4], [8, -8], [4, -8], [0, -8]],
  },
];

/** Pass a checkpoint within this distance of the crossing's centre, m. */
export const CHECKPOINT_RADIUS = 10;
/** Start: stop in the chequered box (this close to the start crossing), m. */
export const START_RADIUS = 7;
export const RACE_COUNTDOWN = 3;
/** The grid is this far back from the start crossing's centre, m. */
const GRID_BACK = 9;
/** Medal times as multiples of the developer time. */
export const MEDAL_FACTORS: Readonly<Record<Medal, number>> = { gold: 1.05, silver: 1.2, bronze: 1.4 };
export const MEDAL_PAY: Readonly<Record<Medal, number>> = { gold: 800, silver: 400, bronze: 200 };
/** Slower than this × the developer time and the race is lost. */
export const GIVE_UP_FACTOR = 2.5;
/** Developer pace: straights at this speed (m/s), plus a cost per corner (s) and the launch. */
const DEV_SPEED = 36;
const DEV_CORNER = 1.2;
const DEV_LAUNCH = 2;

export const nodeX = (n: readonly [number, number]) => n[0] * BLOCK_SIZE;
export const nodeZ = (n: readonly [number, number]) => n[1] * BLOCK_SIZE;

/** Is the course drivable: on the map, at least 8 nodes, each leg along one road? */
export function validCourse(r: RaceDef): boolean {
  if (r.nodes.length < 8 || r.nodes.length > 12) return false;
  for (let i = 0; i < r.nodes.length; i++) {
    const [x, z] = r.nodes[i];
    if (Math.abs(x) > MAX_NODE || Math.abs(z) > MAX_NODE) return false;
    if (i === 0) continue;
    const [px, pz] = r.nodes[i - 1];
    if ((x !== px) === (z !== pz)) return false; // diagonal, or no move at all
  }
  return true;
}

/** Course length, m. */
export function courseLength(r: RaceDef): number {
  let d = 0;
  for (let i = 1; i < r.nodes.length; i++) {
    d += (Math.abs(r.nodes[i][0] - r.nodes[i - 1][0]) + Math.abs(r.nodes[i][1] - r.nodes[i - 1][1])) * BLOCK_SIZE;
  }
  return d;
}

/** Corners on the course (a change of direction at a checkpoint). */
export function courseCorners(r: RaceDef): number {
  let n = 0;
  for (let i = 1; i < r.nodes.length - 1; i++) {
    const ax = Math.sign(r.nodes[i][0] - r.nodes[i - 1][0]);
    const az = Math.sign(r.nodes[i][1] - r.nodes[i - 1][1]);
    const bx = Math.sign(r.nodes[i + 1][0] - r.nodes[i][0]);
    const bz = Math.sign(r.nodes[i + 1][1] - r.nodes[i][1]);
    if (ax !== bx || az !== bz) n++;
  }
  return n;
}

/** The developer time for a course, s (one decimal). */
export function devTime(r: RaceDef): number {
  return Math.round((DEV_LAUNCH + courseLength(r) / DEV_SPEED + courseCorners(r) * DEV_CORNER) * 10) / 10;
}

export function raceMedal(time: number, dev: number): Medal | null {
  if (time <= dev * MEDAL_FACTORS.gold) return 'gold';
  if (time <= dev * MEDAL_FACTORS.silver) return 'silver';
  if (time <= dev * MEDAL_FACTORS.bronze) return 'bronze';
  return null;
}

/** Road direction from node a toward node b. */
export function legDir(a: readonly [number, number], b: readonly [number, number]): Dir {
  if (b[0] > a[0]) return 1;
  if (b[0] < a[0]) return 3;
  return b[1] > a[1] ? 2 : 0;
}

/** Where the car lines up: the right-hand lane just before the start crossing, facing the first leg. */
export function startGrid(r: RaceDef): { x: number; z: number; heading: number } {
  const [a, b] = r.nodes;
  const d = legDir(a, b);
  const p = lanePoint(a[0], a[1], d, -GRID_BACK);
  return { x: p.x, z: p.z, heading: dirHeading(d) };
}

export type RacePhase = 'countdown' | 'live' | 'finished' | 'failed';

/** One attempt at a course. Checkpoints are nodes[1..]; the last one is the finish. */
export class RaceRun {
  phase: RacePhase = 'countdown';
  countdown = RACE_COUNTDOWN;
  time = 0;
  /** Index into def.nodes of the checkpoint to reach next. */
  next = 1;
  readonly dev: number;

  constructor(readonly def: RaceDef) {
    this.dev = devTime(def);
  }

  get checkpoints(): number {
    return this.def.nodes.length - 1;
  }

  /** Checkpoints passed so far. */
  get passed(): number {
    return this.next - 1;
  }

  /**
   * Advance with the car at (x, z). Returns 'checkpoint' or 'finish' on a
   * pass this step, 'timeout' when it's hopeless, else null.
   */
  step(dt: number, x: number, z: number): 'checkpoint' | 'finish' | 'timeout' | null {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'live';
      return null;
    }
    if (this.phase !== 'live') return null;
    this.time += dt;
    const n = this.def.nodes[this.next];
    if (Math.hypot(x - nodeX(n), z - nodeZ(n)) < CHECKPOINT_RADIUS) {
      this.next++;
      if (this.next >= this.def.nodes.length) {
        this.phase = 'finished';
        return 'finish';
      }
      return 'checkpoint';
    }
    if (this.time > this.dev * GIVE_UP_FACTOR) {
      this.phase = 'failed';
      return 'timeout';
    }
    return null;
  }

  fail(): void {
    if (this.phase === 'countdown' || this.phase === 'live') this.phase = 'failed';
  }
}

/** Race time as "1:02.3". */
export function formatRaceTime(t: number): string {
  const tenths = Math.max(0, Math.floor(t * 10));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}
