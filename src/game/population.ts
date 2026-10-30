/**
 * Keeps the streets populated around the player: AI traffic and a sidewalk
 * crowd spawn just out of view and are recycled once far away and off-screen,
 * so density stays constant wherever you go and nothing pops in or out in
 * front of the camera.
 *
 * Everything is recycled rather than rebuilt: retired cars wait in a spare
 * pool (hidden) and come back as new traffic, ped models are pooled, and the
 * number of live cars is bounded however many get carjacked or abandoned.
 * Pure logic (three.js only as types), so it's tested with fakes.
 */
import type { ColorRepresentation } from 'three';
import type { PedState } from '../entities/pedestrian';
import { createVehicleState, type VehicleArchetype, type VehicleState } from '../entities/vehicle';
import type { CarMesh } from '../render/carMesh';
import type { CharacterModel, Outfit } from '../render/characterModel';
import { cornerPoint, spawnPed, type PedAgent } from '../systems/crowd';
import type { DamageState } from '../systems/damage';
import { isHopeless, spawnAi, type AiDriver } from '../systems/traffic';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, type Rect } from '../world/city';
import { DIRS, MAX_NODE } from '../world/roads';

export interface Vehicle {
  archetype: VehicleArchetype;
  paint: ColorRepresentation;
  sim: VehicleState;
  prev: VehicleState;
  mesh: CarMesh;
  /** Set while an NPC is driving it. */
  ai: AiDriver | null;
  damage: DamageState;
  /** Seconds since it blew up (for lingering smoke). */
  wreckAge: number;
  /** Showing the burnt-out look; must be restored before the car is reused. */
  charred: boolean;
}

export interface CrowdPed {
  agent: PedAgent;
  prev: PedState;
  model: CharacterModel;
}

// --- Tunables -------------------------------------------------------------
/** AI cars kept around the player (scaled by the quality tier). */
export const TRAFFIC_COUNT = 24;
/** Sidewalk peds kept around the player (scaled by the quality tier). */
export const CROWD_COUNT = 22;
/** Traffic appears this far from the player, m (always off-screen). */
export const TRAFFIC_SPAWN = [70, 160] as const;
/** First fill: closer, so the opening screen already has cars about. */
export const TRAFFIC_SEED_SPAWN = [40, 160] as const;
/** Cars further than this (and off-screen) are recycled, m. */
export const TRAFFIC_DESPAWN = 200;
/** Share of traffic spawns placed ahead of the player's direction of travel. */
export const TRAFFIC_AHEAD_BIAS = 0.7;
/** Half-angle of the "ahead" cone, radians. */
const AHEAD_SPREAD = Math.PI / 3;
/** Crowd appears this far from the player, m (always off-screen). */
export const CROWD_SPAWN = [25, 60] as const;
export const CROWD_SEED_SPAWN = [20, 60] as const;
/** Peds further than this (and off-screen) are recycled, m. */
export const CROWD_DESPAWN = 80;
/** Peds spawn in little groups... */
export const CROWD_CLUSTER = [2, 4] as const;
/** ...about half of them gathered at street corners. */
export const CORNER_SHARE = 0.5;
/** Parked, abandoned and wrecked cars kept at most; older ones are recycled off-screen. */
export const MAX_IDLE_VEHICLES = 8;
/** Spawns stay this far outside the visible ground rectangle, m. */
export const VIEW_MARGIN = 6;
/** New traffic placed per maintain() call (outside the seed pass), to spread the cost. */
const TRAFFIC_SPAWNS_PER_CALL = 4;
const CROWD_TRIES_PER_CALL = 24;
/** Pooled ped models kept for reuse; extras are disposed. */
const MAX_SPARE_MODELS = 40;
/** Minimum gap between a new car and any other, m. */
const SPAWN_GAP = 10;

const TRAFFIC_MIX: Array<[VehicleArchetype, number]> = [
  ['sedan', 0.3],
  ['compact', 0.22],
  ['taxi', 0.14],
  ['pickup', 0.12],
  ['van', 0.12],
  ['sports', 0.1],
];
/** Archetypes with a fixed livery rather than a random paint job. */
const LIVERY: Partial<Record<VehicleArchetype, string>> = { taxi: '#f2c12e' };
const PAINTS = ['#c8342b', '#2f6fc0', '#d9d6cc', '#e8b923', '#3d7a4a', '#1f2328', '#8a8f96', '#7a2f5a', '#c86a2b'];
const SHIRTS = ['#c94f4f', '#4f7cc9', '#5aa36a', '#d8d2c0', '#2f2f35', '#a0662f', '#7d4fc9', '#e08a3c'];
const PANTS = ['#2e3a5c', '#3b3b3b', '#6b5a45', '#1f2a24', '#59606b'];
const SKIN = ['#e0ac84', '#c68e63', '#8d5a3b', '#f1c9a5', '#5e3b26'];
const HAIR = ['#281c16', '#5a3a22', '#bfa06a', '#1a1a1a', '#8c8c8c', '#7a3a1a'];

/** Sidewalk path inset from the road centreline, as in crowd.ts. */
const WALK_INSET = ROAD_WIDTH / 2 + SIDEWALK / 2;
const EDGE_LENGTH = BLOCK_SIZE - 2 * WALK_INSET;

const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length)];

function pickWeighted<T>(list: Array<[T, number]>, rand: () => number): T {
  let r = rand();
  for (const [v, w] of list) if ((r -= w) <= 0) return v;
  return list[list.length - 1][0];
}

/** Is (x, z) inside `r` grown by `margin`? */
export function inRect(x: number, z: number, r: Rect, margin = 0): boolean {
  return x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin;
}

export interface PopulationHooks {
  /** Build a car (meshes added to the scene). Population puts it in the list. */
  createVehicle(archetype: VehicleArchetype, paint: ColorRepresentation): Vehicle;
  /**
   * Ready a recycled car for traffic: restore health, and its looks if it was
   * charred or `restyled` (archetype/paint changed).
   */
  resetVehicle(v: Vehicle, restyled: boolean): void;
  /** Build a ped model (added to the scene). */
  createPedModel(outfit: Outfit): CharacterModel;
}

export interface MaintainContext {
  /** Player position: the centre of the spawn rings. */
  x: number;
  z: number;
  /** Player velocity, to put traffic where they're heading. */
  vx: number;
  vz: number;
  /** Ground rectangle the camera sees: nothing spawns or vanishes inside it. */
  view: Rect;
  /** Never recycled: the player's car and the one they just left. */
  keep: ReadonlyArray<Vehicle | null>;
  /** Quality-tier multipliers on TRAFFIC_COUNT / CROWD_COUNT. */
  trafficScale?: number;
  crowdScale?: number;
  /** First fill (game start, respawn): closer rings, no per-call limits. */
  seed?: boolean;
}

export class Population {
  readonly crowd: CrowdPed[] = [];
  /** Retired cars waiting to come back as traffic (hidden, not in `vehicles`). */
  private readonly spareVehicles: Vehicle[] = [];
  private readonly spareModels: CharacterModel[] = [];
  private readonly idle: Vehicle[] = [];
  private created = 0;

  constructor(
    private readonly vehicles: Vehicle[],
    private readonly hooks: PopulationHooks,
    private readonly rand: () => number,
  ) {}

  /** Counts for debugging and tests. */
  get stats() {
    return {
      vehicles: this.vehicles.length,
      spareVehicles: this.spareVehicles.length,
      vehiclesCreated: this.created,
      crowd: this.crowd.length,
      spareModels: this.spareModels.length,
    };
  }

  /** Retired cars waiting in the pool (hidden; they still need dressing when models load). */
  get spares(): readonly Vehicle[] {
    return this.spareVehicles;
  }

  /** Hard ceiling on live cars for a given traffic target. */
  static maxVehicles(trafficTarget = TRAFFIC_COUNT): number {
    return trafficTarget + MAX_IDLE_VEHICLES + 4;
  }

  /** Call a few times a second: recycles far cars/peds and tops both back up. */
  maintain(ctx: MaintainContext): void {
    this.maintainTraffic(ctx);
    this.maintainCrowd(ctx);
  }

  /** Put an NPC on the pavement, e.g. a driver thrown out of their car. */
  addPed(agent: PedAgent): CrowdPed {
    let model = this.spareModels.pop();
    if (model) model.root.visible = true;
    else model = this.hooks.createPedModel(this.randomOutfit());
    const ped = { agent, prev: { ...agent.s }, model };
    this.crowd.push(ped);
    return ped;
  }

  // --- Traffic ------------------------------------------------------------

  private maintainTraffic(ctx: MaintainContext): void {
    const vehicles = this.vehicles;
    const target = Math.round(TRAFFIC_COUNT * (ctx.trafficScale ?? 1));
    const idle = this.idle;
    idle.length = 0;
    let aiCount = 0;
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const v = vehicles[i];
      if (ctx.keep.includes(v)) continue;
      const visible = inRect(v.sim.x, v.sim.z, ctx.view, 2);
      const far = Math.hypot(v.sim.x - ctx.x, v.sim.z - ctx.z) > TRAFFIC_DESPAWN;
      if (!visible && (far || (v.ai !== null && isHopeless(v.ai)))) {
        this.retire(i);
        continue;
      }
      if (v.ai) aiCount++;
      else idle.push(v);
    }

    // Too many parked / abandoned / wrecked cars: recycle the furthest unseen ones.
    if (idle.length > MAX_IDLE_VEHICLES) {
      idle.sort((a, b) => dist2(b.sim, ctx) - dist2(a.sim, ctx));
      let excess = idle.length - MAX_IDLE_VEHICLES;
      for (const v of idle) {
        if (excess <= 0) break;
        if (inRect(v.sim.x, v.sim.z, ctx.view, 2)) continue;
        this.retire(vehicles.indexOf(v));
        excess--;
      }
    }

    // Top up traffic, reusing retired cars before building new ones.
    const max = Population.maxVehicles(target);
    let budget = ctx.seed ? Infinity : TRAFFIC_SPAWNS_PER_CALL;
    let failures = 0;
    while (aiCount < target && vehicles.length < max && budget > 0 && failures < 3) {
      const reused = this.spareVehicles.pop();
      const v = reused ?? this.newVehicle();
      if (!this.placeAi(v, ctx)) {
        this.spareVehicles.push(v); // try again next time
        failures++;
        continue;
      }
      if (reused) this.refresh(v);
      v.mesh.root.visible = true;
      vehicles.push(v);
      aiCount++;
      budget--;
    }
  }

  private newVehicle(): Vehicle {
    const archetype = pickWeighted(TRAFFIC_MIX, this.rand);
    const v = this.hooks.createVehicle(archetype, LIVERY[archetype] ?? pick(PAINTS, this.rand));
    v.mesh.root.visible = false;
    this.created++;
    return v;
  }

  /** Take a car out of play: hidden, driverless, waiting in the spare pool. */
  private retire(index: number): void {
    const v = this.vehicles[index];
    this.vehicles.splice(index, 1);
    v.ai = null;
    v.mesh.root.visible = false;
    v.sim.vx = v.sim.vz = v.sim.yawRate = 0;
    this.spareVehicles.push(v);
  }

  /** A retired car rejoining traffic: wrecks and odd ones (police) come back as a different car. */
  private refresh(v: Vehicle): void {
    const restyle = v.charred || !TRAFFIC_MIX.some(([a]) => a === v.archetype);
    if (restyle) {
      v.archetype = pickWeighted(TRAFFIC_MIX, this.rand);
      v.paint = LIVERY[v.archetype] ?? pick(PAINTS, this.rand);
    }
    this.hooks.resetVehicle(v, restyle);
  }

  private placeAi(v: Vehicle, ctx: MaintainContext): boolean {
    const [lo, hi] = ctx.seed ? TRAFFIC_SEED_SPAWN : TRAFFIC_SPAWN;
    const speed = Math.hypot(ctx.vx, ctx.vz);
    const heading = Math.atan2(ctx.vz, ctx.vx);
    for (let attempt = 0; attempt < 25; attempt++) {
      const ahead = speed > 3 && this.rand() < TRAFFIC_AHEAD_BIAS;
      const a = ahead ? heading + (this.rand() * 2 - 1) * AHEAD_SPREAD : this.rand() * Math.PI * 2;
      const r = lo + this.rand() * (hi - lo);
      const ix = Math.round((ctx.x + Math.cos(a) * r) / BLOCK_SIZE);
      const iz = Math.round((ctx.z + Math.sin(a) * r) / BLOCK_SIZE);
      if (Math.abs(ix) > MAX_NODE || Math.abs(iz) > MAX_NODE) continue;
      const spawned = spawnAi(ix, iz, pick(DIRS, this.rand), this.rand(), this.rand);
      if (!spawned) continue;
      const d = Math.hypot(spawned.x - ctx.x, spawned.z - ctx.z);
      if (d < lo || d > hi) continue;
      if (inRect(spawned.x, spawned.z, ctx.view, VIEW_MARGIN)) continue;
      if (this.crowded(spawned.x, spawned.z, v)) continue;
      Object.assign(v.sim, createVehicleState(spawned.x, spawned.z, spawned.heading));
      Object.assign(v.prev, v.sim);
      v.ai = spawned.driver;
      return true;
    }
    return false;
  }

  private crowded(x: number, z: number, self: Vehicle): boolean {
    for (const o of this.vehicles) {
      if (o !== self && Math.abs(o.sim.x - x) < SPAWN_GAP && Math.abs(o.sim.z - z) < SPAWN_GAP) return true;
    }
    return false;
  }

  // --- Crowd --------------------------------------------------------------

  private maintainCrowd(ctx: MaintainContext): void {
    for (let i = this.crowd.length - 1; i >= 0; i--) {
      const s = this.crowd[i].agent.s;
      if (Math.hypot(s.x - ctx.x, s.z - ctx.z) > CROWD_DESPAWN && !inRect(s.x, s.z, ctx.view, 2)) this.removePed(i);
    }
    const target = Math.round(CROWD_COUNT * (ctx.crowdScale ?? 1));
    const tries = ctx.seed ? 200 : CROWD_TRIES_PER_CALL;
    for (let t = 0; this.crowd.length < target && t < tries; t++) this.trySpawnCluster(ctx, target);
  }

  private removePed(index: number): void {
    const { model } = this.crowd[index];
    this.crowd.splice(index, 1);
    if (this.spareModels.length < MAX_SPARE_MODELS) {
      model.root.visible = false;
      this.spareModels.push(model);
    } else {
      model.dispose();
    }
  }

  /**
   * A little group (2–4) on a sidewalk somewhere in the spawn ring, out of
   * view: at a street corner about half the time, else mid-block.
   */
  private trySpawnCluster(ctx: MaintainContext, target: number): void {
    const [lo, hi] = ctx.seed ? CROWD_SEED_SPAWN : CROWD_SPAWN;
    const a = this.rand() * Math.PI * 2;
    const r = lo + this.rand() * (hi - lo);
    const tx = ctx.x + Math.cos(a) * r;
    const tz = ctx.z + Math.sin(a) * r;
    const bx = Math.floor((tx + HALF_EXTENT) / BLOCK_SIZE);
    const bz = Math.floor((tz + HALF_EXTENT) / BLOCK_SIZE);
    if (bx < 0 || bz < 0 || bx >= BLOCKS_PER_SIDE || bz >= BLOCKS_PER_SIDE) return;

    // Nearest point on the block's sidewalk loop, as (edge, t along it).
    const nw = cornerPoint(bx, bz, 0);
    const se = cornerPoint(bx, bz, 2);
    const cx = Math.max(nw.x, Math.min(se.x, tx));
    const cz = Math.max(nw.z, Math.min(se.z, tz));
    const gaps = [cz - nw.z, se.x - cx, se.z - cz, cx - nw.x]; // top, right, bottom, left
    let edge = 0;
    for (let e = 1; e < 4; e++) if (gaps[e] < gaps[edge]) edge = e;
    // Edges run clockwise: 0 NW→NE, 1 NE→SE, 2 SE→SW, 3 SW→NW.
    let t = [cx - nw.x, cz - nw.z, se.x - cx, se.z - cz][edge] / EDGE_LENGTH;
    if (this.rand() < CORNER_SHARE) t = t < 0.5 ? 0.04 : 0.96; // gather at the corner
    const from = cornerPoint(bx, bz, edge);
    const to = cornerPoint(bx, bz, edge + 1);
    const ax = from.x + (to.x - from.x) * t;
    const az = from.z + (to.z - from.z) * t;
    const d = Math.hypot(ax - ctx.x, az - ctx.z);
    if (d < lo - 2 || d > hi + 4) return;
    // The group spreads a few metres either way.
    if (inRect(ax, az, ctx.view, VIEW_MARGIN + 4)) return;

    const [cmin, cmax] = CROWD_CLUSTER;
    const n = Math.min(target - this.crowd.length, cmin + Math.floor(this.rand() * (cmax - cmin + 1)));
    const runsAlongZ = edge === 1 || edge === 3;
    for (let i = 0; i < n; i++) {
      // A pace or so apart along the sidewalk...
      const along = ((i - (n - 1) / 2) * 1.3 + (this.rand() - 0.5) * 0.6) / EDGE_LENGTH;
      const agent = spawnPed(bx, bz, edge, Math.max(0.01, Math.min(0.99, t + along)), this.rand);
      if (this.rand() < 0.5) {
        // ...some walking the other way round the block...
        agent.corner = edge;
        agent.clockwise = false;
      }
      // ...and spread across it so they don't walk in single file.
      const jitter = (this.rand() * 2 - 1) * 0.6;
      if (runsAlongZ) agent.s.x += jitter;
      else agent.s.z += jitter;
      this.addPed(agent);
    }
  }

  private randomOutfit(): Outfit {
    const r = this.rand;
    return { shirt: pick(SHIRTS, r), pants: pick(PANTS, r), skin: pick(SKIN, r), hair: pick(HAIR, r) };
  }
}

function dist2(s: { x: number; z: number }, c: { x: number; z: number }): number {
  return (s.x - c.x) ** 2 + (s.z - c.z) ** 2;
}
