/**
 * Pedestrian AI: stroll around block sidewalks, cross at crosswalks, dodge
 * speeding cars, get knocked over when hit, then get up and run.
 */
import { PLAYER_ON_FOOT, createPedState, stepPedestrian, type PedSpec, type PedState } from '../entities/pedestrian';
import { speed, type VehicleState } from '../entities/vehicle';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK } from '../world/city';
import { CAR_CIRCLE_RADIUS, PED_RADIUS, carCircles } from './physics';

export type PedMode = 'walk' | 'flee' | 'down';

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
}

export const NPC_SPEC: PedSpec = { ...PLAYER_ON_FOOT, walkSpeed: 2.2, runSpeed: 5.2 };

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
  };
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
  if (p.mode === 'down') return;
  const dx = p.s.x - fromX;
  const dz = p.s.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  p.mode = 'flee';
  p.timer = seconds;
  p.fleeX = dx / d;
  p.fleeZ = dz / d;
}

export function stepCrowdPed(p: PedAgent, vehicles: VehicleState[], rand: () => number, dt: number): void {
  // --- Hit or about to be hit by a car? ---
  for (const v of vehicles) {
    const sp = speed(v);
    if (sp < 3 || p.mode === 'down') continue;
    if (Math.abs(v.x - p.s.x) > 8 || Math.abs(v.z - p.s.z) > 8) {
      if (sp > 7) dodge(p, v, sp);
      continue;
    }
    const hit = carCircles(v).some((c) => Math.hypot(c.x - p.s.x, c.z - p.s.z) < CAR_CIRCLE_RADIUS + PED_RADIUS + 0.1);
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
      p.mode = 'flee';
      p.timer = 3;
      const d = Math.hypot(p.s.vx, p.s.vz) || 1;
      p.fleeX = p.s.vx / d || 1;
      p.fleeZ = p.s.vz / d;
    }
    return;
  }

  if (p.mode === 'flee') {
    stepPedestrian(p.s, { x: p.fleeX, y: -p.fleeZ, sprint: true }, NPC_SPEC, dt);
    if ((p.timer -= dt) <= 0) resumeWalking(p);
    return;
  }

  // --- Walking the sidewalk loop ---
  const target = cornerPoint(p.bx, p.bz, p.corner);
  const dx = target.x - p.s.x;
  const dz = target.z - p.s.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.8) {
    arriveAtCorner(p, rand);
    return;
  }
  stepPedestrian(p.s, { x: (dx / d) * p.pace, y: (-dz / d) * p.pace, sprint: false }, NPC_SPEC, dt);
}

function dodge(p: PedAgent, v: VehicleState, sp: number) {
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

function resumeWalking(p: PedAgent) {
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
