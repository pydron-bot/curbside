/**
 * Pedestrian AI: stroll around block sidewalks, cross at crosswalks, dodge
 * speeding cars, get knocked over when hit, then get up and run.
 *
 * Police officers on foot are crowd peds too (role 'cop'), so they're drawn,
 * shot, punched and run over like anyone else. The police system steers
 * them: 'arrest' runs to a goal point (the player, or the driver's door of
 * their car), 'shoot' advances while firing. Cops don't scare and don't
 * hold grudges of their own.
 *
 * Everyone has hit points (PED_HP): bullets, punches, blasts and fire take
 * them off. A hit staggers (a beat with no moving or attacking); a big one,
 * or the third punch of a combo, knocks them over; at 0 HP they're knocked
 * out, down for KO_SECONDS, and then run (no grudge left in them). Police
 * officers take hits the same way.
 */
import { PLAYER_ON_FOOT, createPedState, stepPedestrian, type PedSpec, type PedState } from '../entities/pedestrian';
import { speed, type VehicleState } from '../entities/vehicle';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK } from '../world/city';
import { PED_RADIUS, bodyOf, carCircles } from './physics';

export type PedMode = 'walk' | 'flee' | 'down' | 'fight' | 'shoot' | 'arrest';
export type PedRole = 'civilian' | 'cop';
/** How a ped reacts to being attacked. */
export type Temper = 'calm' | 'fighter' | 'armed';

/** Something a hostile ped did this step, for the game to resolve. */
export type CrowdEvent =
  | { kind: 'punch' }
  | { kind: 'shoot'; dirX: number; dirZ: number }
  /** Knocked down by `car` this step (who's to blame is the caller's call). */
  | { kind: 'struck'; car: VehicleState };

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
  /** Hit points, 0..PED_HP. */
  hp: number;
  /** Seconds left reeling from a hit: no walking, no attacking. */
  stagger: number;
  /** Down because their HP ran out (knocked out), not just knocked over. */
  ko: boolean;
  /** Seconds left on fire (a molotov): running about in a panic. */
  burning: number;
  /** Seconds left crouched with their arms over their head (scared stiff), then they run. */
  cower: number;
}

/** Hit points everyone starts with. */
export const PED_HP = 100;
/** A hit staggers for this long, s, and pushes the next attack back as much. */
export const STAGGER_SECONDS = 0.3;
/** Knocked out (0 HP): down this long, s. */
export const KO_SECONDS = 8;
/** An ordinary knock-down (third punch, a blast's edge): down this long, s. */
export const KNOCKDOWN_SECONDS = 2.5;
/** Back up after a knockout with this much HP. */
const KO_RECOVER_HP = 50;

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

/**
 * A block's sidewalk corner, 0..3 clockwise from (left, top). Written into
 * `out` (the walking peds pass a shared one: this runs for each of them
 * every step, and must not allocate).
 */
export function cornerPoint(bx: number, bz: number, corner: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  const c = corner & 3;
  const x0 = -HALF_EXTENT + bx * BLOCK_SIZE;
  const z0 = -HALF_EXTENT + bz * BLOCK_SIZE;
  out.x = c === 1 || c === 2 ? x0 + BLOCK_SIZE - WALK_INSET : x0 + WALK_INSET;
  out.z = c >= 2 ? z0 + BLOCK_SIZE - WALK_INSET : z0 + WALK_INSET;
  return out;
}

/** cornerPoint's scratch for the per-step walk (read at once, never kept). */
const cornerAt = { x: 0, z: 0 };

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
    hp: PED_HP,
    stagger: 0,
    ko: false,
    burning: 0,
    cower: 0,
  };
}

/** What a hit did: nothing (already down), a stagger, a knock-down, or a knockout. */
export type HurtResult = 'none' | 'hit' | 'down' | 'ko';

/**
 * Take `damage` off a ped hit from (fromX, fromZ). 0 HP knocks them out
 * (down for KO_SECONDS, then they run); `knock` (push, m/s) knocks them over
 * anyway (the third punch, a blast); otherwise they stagger. Someone already
 * on the ground takes nothing more.
 */
export function hurtPed(p: PedAgent, damage: number, fromX: number, fromZ: number, knock = 0): HurtResult {
  if (p.mode === 'down' || damage <= 0) return 'none';
  p.hp = Math.max(0, p.hp - damage);
  p.cower = 0;
  if (p.hp <= 0) {
    knockDown(p, fromX, fromZ, Math.max(3, knock), KO_SECONDS);
    p.ko = true;
    p.provoked = false;
    p.stagger = 0;
    return 'ko';
  }
  if (knock > 0) {
    knockDown(p, fromX, fromZ, knock, KNOCKDOWN_SECONDS);
    p.stagger = 0;
    return 'down';
  }
  p.stagger = STAGGER_SECONDS;
  p.attackCooldown += STAGGER_SECONDS;
  // A small shove away from the hit.
  const dx = p.s.x - fromX;
  const dz = p.s.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  p.s.vx = (dx / d) * 1.6;
  p.s.vz = (dz / d) * 1.6;
  return 'hit';
}

/** Set a ped alight for `seconds` (a molotov's fire): they run about in a panic. */
export function setAlight(p: PedAgent, seconds: number): void {
  p.burning = Math.max(p.burning, seconds);
  p.cower = 0;
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
  p.cower = 0;
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
  // Bowled over backwards: facing whatever hit them (already lying there, they don't spin round).
  if (p.mode !== 'down') p.s.heading = Math.atan2(-dx, -dz);
  p.mode = 'down';
  p.timer = seconds;
  p.cower = 0;
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

/**
 * Scared stiff (gunfire right beside them): crouch with arms over the head
 * for `seconds`, then run from (fromX, fromZ). Only calm civilians freeze.
 */
export function cower(p: PedAgent, fromX: number, fromZ: number, seconds: number): void {
  if (p.mode === 'down' || p.mode === 'fight' || p.mode === 'shoot' || p.role === 'cop' || p.burning > 0) return;
  scare(p, fromX, fromZ, seconds + 3);
  p.cower = Math.max(p.cower, seconds);
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
  let struck: VehicleState | null = null;
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
      p.cower = 0;
      // Thrown back along the car's path, facing it.
      p.s.heading = Math.atan2(-v.vx, -v.vz);
      p.s.vx = v.vx * 0.6;
      p.s.vz = v.vz * 0.6;
      p.stagger = 0;
      // Hit hard enough, it's a knockout: down for longer, no fight left after.
      p.hp = Math.max(0, p.hp - sp * 5);
      if (p.hp <= 0) {
        p.ko = true;
        p.provoked = false;
        p.timer = KO_SECONDS;
      }
      struck = v;
      break;
    }
    if (sp > 7) dodge(p, v, sp);
  }

  if (p.mode === 'down') {
    p.burning = Math.max(0, p.burning - dt);
    const k = Math.exp(-4 * dt);
    p.s.vx *= k;
    p.s.vz *= k;
    p.s.x += p.s.vx * dt;
    p.s.z += p.s.vz * dt;
    if ((p.timer -= dt) <= 0) {
      if (p.ko) {
        // Coming round from a knockout: shaken, and in no mood for a rematch.
        p.ko = false;
        p.hp = Math.max(p.hp, KO_RECOVER_HP);
        p.provoked = false;
      }
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
    // Only the car that hit them is to blame (the caller decides whose it was).
    return struck ? { kind: 'struck', car: struck } : null;
  }

  // Reeling from a hit: slide to a stop, no walking, no attacking.
  if (p.stagger > 0) {
    p.stagger = Math.max(0, p.stagger - dt);
    const k = Math.exp(-8 * dt);
    p.s.vx *= k;
    p.s.vz *= k;
    p.s.x += p.s.vx * dt;
    p.s.z += p.s.vz * dt;
    return null;
  }

  // On fire: run about blindly, swerving, until it goes out.
  if (p.burning > 0) {
    p.burning = Math.max(0, p.burning - dt);
    if (p.mode !== 'flee' || rand() < dt * 3) {
      const a = rand() * Math.PI * 2;
      p.mode = 'flee';
      p.fleeX = Math.cos(a);
      p.fleeZ = Math.sin(a);
    }
    p.timer = Math.max(p.timer, 1);
    stepPedestrian(p.s, move(p.fleeX, -p.fleeZ, true), NPC_SPEC, dt);
    return null;
  }

  if (p.mode === 'fight' || p.mode === 'shoot') return stepHostile(p, target, dt);
  if (p.mode === 'arrest') {
    stepArrest(p, target, dt);
    return null;
  }

  if (p.mode === 'flee' && p.cower > 0) {
    // Crouched where they stand until it passes (then the flee below takes over).
    p.cower = Math.max(0, p.cower - dt);
    stepPedestrian(p.s, move(0, 0, false), NPC_SPEC, dt);
    return null;
  }

  if (p.mode === 'flee') {
    stepPedestrian(p.s, move(p.fleeX, -p.fleeZ, true), NPC_SPEC, dt);
    if ((p.timer -= dt) <= 0) resumeWalking(p);
    return null;
  }

  // --- Walking the sidewalk loop ---
  cornerPoint(p.bx, p.bz, p.corner, cornerAt);
  const dx = cornerAt.x - p.s.x;
  const dz = cornerAt.z - p.s.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.8) {
    arriveAtCorner(p, rand);
    return null;
  }
  stepPedestrian(p.s, move((dx / d) * p.pace, (-dz / d) * p.pace, false), NPC_SPEC, dt);
  return null;
}

/** Reused stick input for officers (they step every frame; no garbage). */
const copMove = { x: 0, y: 0, sprint: false };
/** Reused stick input for everyone else: `move(x, y, sprint)` fills and returns it. */
const moveIn = { x: 0, y: 0, sprint: false };
function move(x: number, y: number, sprint: boolean): typeof moveIn {
  moveIn.x = x;
  moveIn.y = y;
  moveIn.sprint = sprint;
  return moveIn;
}

/** An officer running to their goal (the player, or a car door), then standing ready. */
function stepArrest(p: PedAgent, target: Target | undefined, dt: number): void {
  const dx = p.goalX - p.s.x;
  const dz = p.goalZ - p.s.z;
  const d = Math.hypot(dx, dz);
  const run = d > ARREST_STOP;
  copMove.x = run ? dx / d : 0;
  copMove.y = run ? -dz / d : 0;
  copMove.sprint = d > 2.5;
  stepPedestrian(p.s, copMove, COP_SPEC, dt);
  if (run) return;
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

  if (p.mode === 'fight') {
    if (d > PUNCH_REACH) {
      stepPedestrian(p.s, move(ux, -uz, true), FIGHTER_SPEC, dt);
      return null;
    }
    stepPedestrian(p.s, move(0, 0, false), NPC_SPEC, dt);
    p.s.heading = Math.atan2(ux, uz);
    if (p.attackCooldown > 0) return null;
    p.attackCooldown = PUNCH_EVERY;
    return { kind: 'punch' };
  }

  // Shooter: hold a middle distance, face the target, fire on a cadence.
  // Officers keep advancing instead (they want the arrest), at a run when far.
  if (cop) {
    copMove.x = d > 3 ? ux * 0.8 : 0;
    copMove.y = d > 3 ? -uz * 0.8 : 0;
    copMove.sprint = d > 16;
    stepPedestrian(p.s, copMove, COP_SPEC, dt);
  }
  else if (d > 12) stepPedestrian(p.s, move(ux * 0.8, -uz * 0.8, false), NPC_SPEC, dt);
  else if (d < 6) stepPedestrian(p.s, move(-ux * 0.6, uz * 0.6, false), NPC_SPEC, dt);
  else stepPedestrian(p.s, move(0, 0, false), NPC_SPEC, dt);
  p.s.heading = Math.atan2(ux, uz);
  if (p.attackCooldown > 0 || d > (cop ? COP_SHOOT_RANGE : SHOOT_RANGE)) return null;
  p.attackCooldown = cop ? COP_SHOOT_EVERY : SHOOT_EVERY;
  return { kind: 'shoot', dirX: ux, dirZ: uz };
}

/** Reused for each car's collision circles (carCircles resizes it to the body). */
const circles: Array<{ x: number; z: number }> = [];

/** Is the ped within reach of any of the car's collision circles? */
function touchesCar(s: PedState, v: VehicleState): boolean {
  const reach = bodyOf(v).radius + PED_RADIUS + 0.1;
  for (const c of carCircles(v, circles)) {
    const dx = c.x - s.x;
    const dz = c.z - s.z;
    if (dx * dx + dz * dz < reach * reach) return true;
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
  // Leap sideways, away from the car's path (even out of a crouch).
  const side = lateral >= 0 ? 1 : -1;
  p.cower = 0;
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
    const pt = cornerPoint(bx, bz, c, cornerAt);
    const dd = Math.hypot(pt.x - p.s.x, pt.z - p.s.z);
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  p.corner = best;
  p.mode = 'walk';
  p.cower = 0;
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
