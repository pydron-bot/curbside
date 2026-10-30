/**
 * Pedestrian AI: stroll around block sidewalks, cross at crosswalks, dodge
 * speeding cars, get knocked over when hit, then get up and run.
 *
 * Police officers on foot are crowd peds too (role 'cop'), so they're drawn,
 * shot, punched and run over like anyone else. The police system steers
 * them: 'arrest' runs to a goal point (the player, or the driver's door of
 * their car), 'shoot' advances while firing. Cops don't scare and don't
 * hold grudges of their own.
 */
import { PLAYER_ON_FOOT, createPedState, stepPedestrian, type PedSpec, type PedState } from '../entities/pedestrian';
import { speed, type VehicleState } from '../entities/vehicle';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK } from '../world/city';
import { CAR_CIRCLE_RADIUS, PED_RADIUS, carCircles } from './physics';

export type PedMode = 'walk' | 'flee' | 'down' | 'fight' | 'shoot' | 'arrest';
export type PedRole = 'civilian' | 'cop';
/** How a ped reacts to being attacked. */
export type Temper = 'calm' | 'fighter' | 'armed';

/** Something a hostile ped did this step, for the game to resolve. */
export type CrowdEvent = { kind: 'punch' } | { kind: 'shoot'; dirX: number; dirZ: number };

/** Who hostile peds go after. */
export interface Target {
  x: number;
  z: number;
  /** Fighters can't punch someone in a car; shooters shoot the car. */
  inCar: boolean;
  alive: boolean;
}

export interface PedAgent {
  s: PedState;
  mode: PedMode;
  /** Current sidewalk block and the corner (0..3, clockwise from NW) being walked to. */
  bx: number;
  bz: number;
  corner: number;
  clockwise: boolean;
  /** Seconds left in flee/down. */
  timer: number;
  fleeX: number;
  fleeZ: number;
  /** 0..1 walking pace multiplier. */
  pace: number;
  temper: Temper;
  /** Set when attacked while down: turns hostile on getting up. */
  provoked: boolean;
  attackCooldown: number;
  role: PedRole;
  /** Where an officer in 'arrest' mode is running to. */
  goalX: number;
  goalZ: number;
}

export const NPC_SPEC: PedSpec = { ...PLAYER_ON_FOOT, walkSpeed: 2.2, runSpeed: 5.2 };
/** Chase speed for fighters: a little slower than a sprinting player, so you can escape. */
const FIGHTER_SPEC: PedSpec = { ...NPC_SPEC, runSpeed: 4.6 };
/** Officers on foot: quicker than a fighter, still slower than the player's 6 m/s sprint. */
export const COP_SPEC: PedSpec = { ...NPC_SPEC, runSpeed: 5 };
/** Officers fire less often than an armed civilian, but from further. */
const COP_SHOOT_EVERY = 1.5;
const COP_SHOOT_RANGE = 24;
/** An officer this close to their goal stops running, m. */
const ARREST_STOP = 0.6;
export const PUNCH_REACH = 1.3;
const PUNCH_EVERY = 1.0;
const SHOOT_EVERY = 1.1;
const SHOOT_RANGE = 22;
const HOSTILE_SECONDS = 15;
const GIVE_UP_DISTANCE = 40;

/** Sidewalk path: midway across the sidewalk, measured from the road centreline. */
const WALK_INSET = ROAD_WIDTH / 2 + SIDEWALK / 2;
const CROSS_CHANCE = 0.3;

export function cornerPoint(bx: number, bz: number, corner: number): { x: number; z: number } {
  const x0 = -HALF_EXTENT + bx * BLOCK_SIZE;
  const z0 = -HALF_EXTENT + bz * BLOCK_SIZE;
  const left = x0 + WALK_INSET;
  const right = x0 + BLOCK_SIZE - WALK_INSET;
  const top = z0 + WALK_INSET;
  const bottom = z0 + BLOCK_SIZE - WALK_INSET;
  return [
    { x: left, z: top },
    { x: right, z: top },
    { x: right, z: bottom },
    { x: left, z: bottom },
  ][corner & 3];
}

export function blockAt(x: number, z: number): { bx: number; bz: number } {
  const clamp = (v: number) => Math.max(0, Math.min(BLOCKS_PER_SIDE - 1, v));
  return {
    bx: clamp(Math.floor((x + HALF_EXTENT) / BLOCK_SIZE)),
    bz: clamp(Math.floor((z + HALF_EXTENT) / BLOCK_SIZE)),
  };
}

export function spawnPed(bx: number, bz: number, edge: number, t: number, rand: () => number): PedAgent {
  const a = cornerPoint(bx, bz, edge);
  const b = cornerPoint(bx, bz, edge + 1);
  const s = createPedState(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
  return {
    s,
    mode: 'walk',
    bx,
    bz,
    corner: (edge + 1) & 3,
    clockwise: true,
    timer: 0,
    fleeX: 0,
    fleeZ: 0,
    pace: 0.45 + rand() * 0.25,
    temper: rollTemper(rand),
    provoked: false,
    attackCooldown: 0,
    role: 'civilian',
    goalX: 0,
    goalZ: 0,
  };
}

export function rollTemper(rand: () => number): Temper {
  const r = rand();
  return r < 0.1 ? 'armed' : r < 0.3 ? 'fighter' : 'calm';
}

/**
 * React to an attack from (fromX, fromZ): calm peds run, fighters come at
 * you, armed peds shoot. A ped who's down reacts when they get up.
 */
export function provoke(p: PedAgent, fromX: number, fromZ: number): void {
  // The police system decides what officers do.
  if (p.role === 'cop') return;
  if (p.mode === 'down') {
    p.provoked = true;
    return;
  }
  if (p.temper === 'fighter') {
    p.mode = 'fight';
    p.timer = HOSTILE_SECONDS;
  } else if (p.temper === 'armed') {
    p.mode = 'shoot';
    p.timer = HOSTILE_SECONDS;
    p.attackCooldown = 0.6; // a beat before the first shot
  } else {
    scare(p, fromX, fromZ, 4);
  }
}

/** Knock a ped over, sliding away from a point (punch, explosion). */
export function knockDown(p: PedAgent, fromX: number, fromZ: number, push = 3, seconds = 2.5): void {
  const dx = p.s.x - fromX;
  const dz = p.s.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  p.mode = 'down';
  p.timer = seconds;
  p.s.vx = (dx / d) * push;
  p.s.vz = (dz / d) * push;
}

/** Make a ped run from a point (e.g. a carjacker) for a while. */
export function scare(p: PedAgent, fromX: number, fromZ: number, seconds = 4): void {
  if (p.mode === 'down' || p.mode === 'fight' || p.mode === 'shoot' || p.role === 'cop') return;
  const dx = p.s.x - fromX;
  const dz = p.s.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  p.mode = 'flee';
  p.timer = seconds;
  p.fleeX = dx / d;
  p.fleeZ = dz / d;
}

export function stepCrowdPed(
  p: PedAgent,
  vehicles: VehicleState[],
  rand: () => number,
  dt: number,
  target?: Target,
): CrowdEvent | null {
  p.attackCooldown = Math.max(0, p.attackCooldown - dt);
  // --- Hit or about to be hit by a car? ---
  for (const v of vehicles) {
    const sp = speed(v);
    if (sp < 3 || p.mode === 'down') continue;
    if (Math.abs(v.x - p.s.x) > 8 || Math.abs(v.z - p.s.z) > 8) {
      if (sp > 7) dodge(p, v, sp);
      continue;
    }
    const hit = touchesCar(p.s, v);
    if (hit && sp > 4) {
      p.mode = 'down';
      p.timer = 3;
      p.s.vx = v.vx * 0.6;
      p.s.vz = v.vz * 0.6;
      break;
    }
    if (sp > 7) dodge(p, v, sp);
  }

  if (p.mode === 'down') {
    const k = Math.exp(-4 * dt);
    p.s.vx *= k;
    p.s.vz *= k;
    p.s.x += p.s.vx * dt;
    p.s.z += p.s.vz * dt;
    if ((p.timer -= dt) <= 0) {
      if (p.role === 'cop') {
        // Back on their feet and back on the job.
        p.mode = 'arrest';
        p.timer = 3;
        return null;
      }
      p.mode = 'flee';
      p.timer = 3;
      const d = Math.hypot(p.s.vx, p.s.vz) || 1;
      p.fleeX = p.s.vx / d || 1;
      p.fleeZ = p.s.vz / d;
      if (p.provoked && target) {
        p.provoked = false;
        provoke(p, target.x, target.z);
      }
    }
    return null;
  }

  if (p.mode === 'fight' || p.mode === 'shoot') return stepHostile(p, target, dt);
  if (p.mode === 'arrest') {
    stepArrest(p, target, dt);
    return null;
  }

  if (p.mode === 'flee') {
    stepPedestrian(p.s, { x: p.fleeX, y: -p.fleeZ, sprint: true }, NPC_SPEC, dt);
    if ((p.timer -= dt) <= 0) resumeWalking(p);
    return null;
  }

  // --- Walking the sidewalk loop ---
  const corner = cornerPoint(p.bx, p.bz, p.corner);
  const dx = corner.x - p.s.x;
  const dz = corner.z - p.s.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.8) {
    arriveAtCorner(p, rand);
    return null;
  }
  stepPedestrian(p.s, { x: (dx / d) * p.pace, y: (-dz / d) * p.pace, sprint: false }, NPC_SPEC, dt);
  return null;
}

/** An officer running to their goal (the player, or a car door), then standing ready. */
function stepArrest(p: PedAgent, target: Target | undefined, dt: number): void {
  const dx = p.goalX - p.s.x;
  const dz = p.goalZ - p.s.z;
  const d = Math.hypot(dx, dz);
  if (d > ARREST_STOP) {
    stepPedestrian(p.s, { x: dx / d, y: -dz / d, sprint: d > 2.5 }, COP_SPEC, dt);
    return;
  }
  stepPedestrian(p.s, { x: 0, y: 0, sprint: false }, COP_SPEC, dt);
  if (target) p.s.heading = Math.atan2(target.x - p.s.x, target.z - p.s.z);
}

function stepHostile(p: PedAgent, target: Target | undefined, dt: number): CrowdEvent | null {
  p.timer -= dt;
  const dx = target ? target.x - p.s.x : 0;
  const dz = target ? target.z - p.s.z : 0;
  const d = Math.hypot(dx, dz);
  const cop = p.role === 'cop';
  // Officers stay on the job until the police system stands them down.
  const done = !target || !target.alive || (!cop && (p.timer <= 0 || d > GIVE_UP_DISTANCE));
  if (done || (p.mode === 'fight' && target!.inCar)) {
    resumeWalking(p);
    return null;
  }
  const ux = dx / (d || 1);
  const uz = dz / (d || 1);
  const still = { x: 0, y: 0, sprint: false };

  if (p.mode === 'fight') {
    if (d > PUNCH_REACH) {
      stepPedestrian(p.s, { x: ux, y: -uz, sprint: true }, FIGHTER_SPEC, dt);
      return null;
    }
    stepPedestrian(p.s, still, NPC_SPEC, dt);
    p.s.heading = Math.atan2(ux, uz);
    if (p.attackCooldown > 0) return null;
    p.attackCooldown = PUNCH_EVERY;
    return { kind: 'punch' };
  }

  // Shooter: hold a middle distance, face the target, fire on a cadence.
  // Officers advance instead of backing off (they want the arrest).
  if (d > 12) stepPedestrian(p.s, { x: ux * 0.8, y: -uz * 0.8, sprint: cop && d > 20 }, cop ? COP_SPEC : NPC_SPEC, dt);
  else if (d < 6 && !cop) stepPedestrian(p.s, { x: -ux * 0.6, y: uz * 0.6, sprint: false }, NPC_SPEC, dt);
  else stepPedestrian(p.s, still, NPC_SPEC, dt);
  p.s.heading = Math.atan2(ux, uz);
  if (p.attackCooldown > 0 || d > (cop ? COP_SHOOT_RANGE : SHOOT_RANGE)) return null;
  p.attackCooldown = cop ? COP_SHOOT_EVERY : SHOOT_EVERY;
  return { kind: 'shoot', dirX: ux, dirZ: uz };
}

const circles = [
  { x: 0, z: 0 },
  { x: 0, z: 0 },
  { x: 0, z: 0 },
];

/** Is the ped within reach of any of the car's collision circles? */
function touchesCar(s: PedState, v: VehicleState): boolean {
  for (const c of carCircles(v, circles)) {
    if (Math.hypot(c.x - s.x, c.z - s.z) < CAR_CIRCLE_RADIUS + PED_RADIUS + 0.1) return true;
  }
  return false;
}

function dodge(p: PedAgent, v: VehicleState, sp: number) {
  if (p.mode === 'fight' || p.mode === 'shoot') return; // too angry to notice
  const fx = v.vx / sp;
  const fz = v.vz / sp;
  const rx = p.s.x - v.x;
  const rz = p.s.z - v.z;
  const along = rx * fx + rz * fz;
  if (along < 0 || along > 16) return;
  const lateral = rx * fz - rz * fx; // signed: which side of the car's path
  if (Math.abs(lateral) > 3) return;
  // Leap sideways, away from the car's path.
  const side = lateral >= 0 ? 1 : -1;
  p.mode = 'flee';
  p.timer = 1.5;
  p.fleeX = fz * side;
  p.fleeZ = -fx * side;
}

/** Calm down and head back to the sidewalk loop. */
export function resumeWalking(p: PedAgent) {
  const { bx, bz } = blockAt(p.s.x, p.s.z);
  p.bx = bx;
  p.bz = bz;
  // Head for the closest corner of whatever block we ended up beside.
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < 4; c++) {
    const pt = cornerPoint(bx, bz, c);
    const dd = Math.hypot(pt.x - p.s.x, pt.z - p.s.z);
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  p.corner = best;
  p.mode = 'walk';
}

/** At a corner: maybe cross to the neighbouring block, else carry on round. */
function arriveAtCorner(p: PedAgent, rand: () => number) {
  if (rand() < CROSS_CHANCE) {
    // Corners: 0 NW, 1 NE, 2 SE, 3 SW. Horizontal crossing mirrors 0<->1, 3<->2.
    const horizontal = rand() < 0.5;
    const c = p.corner;
    let nbx = p.bx;
    let nbz = p.bz;
    let nc = c;
    if (horizontal) {
      const east = c === 1 || c === 2;
      nbx += east ? 1 : -1;
      nc = [1, 0, 3, 2][c];
    } else {
      const south = c === 2 || c === 3;
      nbz += south ? 1 : -1;
      nc = [3, 2, 1, 0][c];
    }
    if (nbx >= 0 && nbx < BLOCKS_PER_SIDE && nbz >= 0 && nbz < BLOCKS_PER_SIDE) {
      p.bx = nbx;
      p.bz = nbz;
      p.corner = nc;
      return;
    }
  }
  p.corner = (p.corner + (p.clockwise ? 1 : 3)) & 3;
  if (rand() < 0.1) p.clockwise = !p.clockwise;
}
