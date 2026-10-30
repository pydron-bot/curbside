/**
 * Traffic lights: which junctions have them, where the poles stand, and the
 * cycle they run. The same timing drives the lit lenses in the prop shader
 * (SIGNAL_GLSL, from the clock's time sent as a uniform) and, through
 * `at()`, the AI drivers who stop on red, so what you see is what traffic
 * does. Pure data and maths, no three.js.
 *
 * Each junction alternates its two roads: north-south green, amber, a
 * moment of all-red, then east-west the same. Junctions are offset from
 * each other so the city doesn't change in unison.
 */
import { BLOCK_SIZE, HALF_EXTENT } from './city';
import { DIRS, DIR_VEC, MAX_NODE, nodeValid, type Dir } from './roads';

export type Signal = 'red' | 'amber' | 'green';

/** One full cycle, s: each road gets GREEN, then AMBER, then ALL_RED before the other's turn. */
export const SIGNAL_CYCLE = 24;
const GREEN = 9;
const AMBER = 2;
/** A pole stands this far back from the junction centre along the road it faces, m (behind the stop line)... */
export const SIGNAL_BACK = 12.8;
/** ...this far to the right of the approaching lane's travel (the kerb line), m. */
export const SIGNAL_SIDE = 8.6;
/** Share of the inner junctions that have lights (the rest are left to give way). */
const SIGNAL_SHARE = 0.7;

/** Integer hash of a junction, 0..1 (deterministic, no RNG state). */
function junctionHash(ix: number, iz: number, salt: number): number {
  let h = Math.imul(ix + 101, 0x27d4eb2d) ^ Math.imul(iz + 307, 0x165667b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Does junction (ix, iz) have traffic lights? Inner junctions only, most of them. */
export function hasSignals(ix: number, iz: number): boolean {
  if (Math.abs(ix) >= MAX_NODE || Math.abs(iz) >= MAX_NODE) return false;
  return junctionHash(ix, iz, 0x5151) < SIGNAL_SHARE;
}

/** Junction (ix, iz)'s offset into the cycle, s. */
export function signalOffset(ix: number, iz: number): number {
  return Math.floor(junctionHash(ix, iz, 0x0ff5) * 8) * (SIGNAL_CYCLE / 8);
}

/** The light for one road (east-west or north-south) at `t` s into its junction's cycle. */
export function signalAt(eastWest: boolean, t: number): Signal {
  let u = t % SIGNAL_CYCLE;
  if (u < 0) u += SIGNAL_CYCLE;
  if (eastWest) u -= SIGNAL_CYCLE / 2;
  if (u < 0 || u >= SIGNAL_CYCLE / 2) return 'red';
  return u < GREEN ? 'green' : u < GREEN + AMBER ? 'amber' : 'red';
}

/** Is travel in `dir` along the east-west road? */
export const eastWest = (dir: Dir): boolean => dir === 1 || dir === 3;

/** A traffic light pole: where it stands, which way its lenses face, the road it controls. */
export interface SignalPole {
  x: number;
  z: number;
  /** Lens facing (vehicle convention): toward the traffic it controls. */
  heading: number;
  /** Cycle offset (signalOffset) and road (east-west or not) of the lenses' lights. */
  offset: number;
  eastWest: boolean;
}

/**
 * Every pole: one per approach at each signalled junction, on the kerb to
 * the right of the incoming lane just behind its stop line, facing the cars.
 */
export function signalPoles(): SignalPole[] {
  const out: SignalPole[] = [];
  for (let ix = -MAX_NODE; ix <= MAX_NODE; ix++) {
    for (let iz = -MAX_NODE; iz <= MAX_NODE; iz++) {
      if (!hasSignals(ix, iz)) continue;
      for (const d of DIRS) {
        const v = DIR_VEC[d];
        // Traffic arriving in direction d comes from the neighbour behind.
        if (!nodeValid(ix - v.x, iz - v.z)) continue;
        // Right of travel is (-v.z, v.x).
        const x = ix * BLOCK_SIZE - v.x * SIGNAL_BACK - v.z * SIGNAL_SIDE;
        const z = iz * BLOCK_SIZE - v.z * SIGNAL_BACK + v.x * SIGNAL_SIDE;
        if (Math.abs(x) > HALF_EXTENT || Math.abs(z) > HALF_EXTENT) continue;
        out.push({ x, z, heading: Math.atan2(-v.x, -v.z), offset: signalOffset(ix, iz), eastWest: eastWest(d) });
      }
    }
  }
  return out;
}

/** What AI drivers ask: the light facing them as they arrive at a junction. */
export interface SignalView {
  at(ix: number, iz: number, dir: Dir): Signal | null;
}

/**
 * The lights' clock, stepped with the simulation (so a paused or slowed
 * game holds them too); the renderer sends `time` to the prop shader.
 */
export class TrafficSignals implements SignalView {
  time = 0;

  step(dt: number): void {
    this.time += dt;
  }

  /** The light for traffic arriving at (ix, iz) travelling `dir`; null where there are none. */
  at(ix: number, iz: number, dir: Dir): Signal | null {
    if (!hasSignals(ix, iz)) return null;
    return signalAt(eastWest(dir), this.time + signalOffset(ix, iz));
  }
}

/**
 * The same cycle in GLSL: 0 red, 1 amber, 2 green for road `ew` (1 east-west)
 * at `t` s into the junction's cycle.
 */
export const SIGNAL_GLSL = /* glsl */ `
int ubSignal(float ew, float t) {
  float u = mod(t, ${SIGNAL_CYCLE.toFixed(1)}) - ew * ${(SIGNAL_CYCLE / 2).toFixed(1)};
  if (u < 0.0 || u >= ${(SIGNAL_CYCLE / 2).toFixed(1)}) return 0;
  return u < ${GREEN.toFixed(1)} ? 2 : (u < ${(GREEN + AMBER).toFixed(1)} ? 1 : 0);
}
`;
