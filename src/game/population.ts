/**
 * Keeps the streets populated around the player: AI traffic and a sidewalk
 * crowd spawn out of view and are recycled once far away, so density stays
 * constant wherever you go.
 */
import type { ColorRepresentation, Scene } from 'three';
import type { PedState } from '../entities/pedestrian';
import { createVehicleState, type VehicleArchetype, type VehicleState } from '../entities/vehicle';
import type { CarMesh } from '../render/carMesh';
import { CharacterModel, type Outfit } from '../render/characterModel';
import { spawnPed, type PedAgent } from '../systems/crowd';
import type { DamageState } from '../systems/damage';
import { spawnAi, type AiDriver } from '../systems/traffic';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT } from '../world/city';
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
}

export interface CrowdPed {
  agent: PedAgent;
  prev: PedState;
  model: CharacterModel;
}

export const TRAFFIC_COUNT = 24;
export const CROWD_COUNT = 22;
const TRAFFIC_SPAWN = [90, 220] as const;
const TRAFFIC_DESPAWN = 280;
const CROWD_SPAWN = [45, 100] as const;
const CROWD_DESPAWN = 130;

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

const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length)];

function pickWeighted<T>(list: Array<[T, number]>, rand: () => number): T {
  let r = rand();
  for (const [v, w] of list) if ((r -= w) <= 0) return v;
  return list[list.length - 1][0];
}

export class Population {
  readonly crowd: CrowdPed[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly vehicles: Vehicle[],
    private readonly makeVehicle: (archetype: VehicleArchetype, paint: ColorRepresentation) => Vehicle,
    /** Restore a recycled vehicle (health, model) before it rejoins traffic. */
    private readonly resetVehicle: (v: Vehicle) => void,
    private readonly rand: () => number,
  ) {}

  /** Call a few times a second: tops up and recycles traffic and crowd. */
  maintain(px: number, pz: number, driving: Vehicle | null): void {
    // Traffic: recycle far-away AI cars (and wrecks) instead of creating new ones.
    let aiCount = 0;
    for (const v of this.vehicles) {
      const recyclable = v.ai || v.damage.wrecked;
      if (!recyclable || v === driving) continue;
      if (Math.hypot(v.sim.x - px, v.sim.z - pz) > TRAFFIC_DESPAWN) {
        if (this.placeAi(v, px, pz)) this.resetVehicle(v);
      }
      if (v.ai) aiCount++;
    }
    for (; aiCount < TRAFFIC_COUNT; aiCount++) {
      const archetype = pickWeighted(TRAFFIC_MIX, this.rand);
      const v = this.makeVehicle(archetype, LIVERY[archetype] ?? pick(PAINTS, this.rand));
      if (!this.placeAi(v, px, pz)) v.sim.x = 1e6; // try again next time it's far
    }

    // Crowd.
    for (let i = this.crowd.length - 1; i >= 0; i--) {
      const c = this.crowd[i];
      if (Math.hypot(c.agent.s.x - px, c.agent.s.z - pz) > CROWD_DESPAWN) {
        c.model.dispose();
        this.crowd.splice(i, 1);
      }
    }
    for (let tries = 0; this.crowd.length < CROWD_COUNT && tries < 20; tries++) {
      this.trySpawnPed(px, pz);
    }
  }

  /** Put an NPC on the pavement, e.g. a driver thrown out of their car. */
  addPed(agent: PedAgent): CrowdPed {
    const model = new CharacterModel('/assets/player.glb', this.randomOutfit());
    this.scene.add(model.root);
    const ped = { agent, prev: { ...agent.s }, model };
    this.crowd.push(ped);
    return ped;
  }

  private randomOutfit(): Outfit {
    const r = this.rand;
    return { shirt: pick(SHIRTS, r), pants: pick(PANTS, r), skin: pick(SKIN, r), hair: pick(HAIR, r) };
  }

  private placeAi(v: Vehicle, px: number, pz: number): boolean {
    for (let attempt = 0; attempt < 25; attempt++) {
      const ix = Math.round((px + (this.rand() * 2 - 1) * TRAFFIC_SPAWN[1]) / BLOCK_SIZE);
      const iz = Math.round((pz + (this.rand() * 2 - 1) * TRAFFIC_SPAWN[1]) / BLOCK_SIZE);
      if (Math.abs(ix) > MAX_NODE || Math.abs(iz) > MAX_NODE) continue;
      const spawned = spawnAi(ix, iz, pick(DIRS, this.rand), this.rand(), this.rand);
      if (!spawned) continue;
      const d = Math.hypot(spawned.x - px, spawned.z - pz);
      if (d < TRAFFIC_SPAWN[0] || d > TRAFFIC_SPAWN[1]) continue;
      if (this.vehicles.some((o) => o !== v && Math.hypot(o.sim.x - spawned.x, o.sim.z - spawned.z) < 10)) continue;
      Object.assign(v.sim, createVehicleState(spawned.x, spawned.z, spawned.heading));
      Object.assign(v.prev, v.sim);
      v.ai = spawned.driver;
      return true;
    }
    return false;
  }

  private trySpawnPed(px: number, pz: number) {
    const bx = Math.floor((px + HALF_EXTENT) / BLOCK_SIZE + (this.rand() * 2 - 1) * 2.5);
    const bz = Math.floor((pz + HALF_EXTENT) / BLOCK_SIZE + (this.rand() * 2 - 1) * 2.5);
    if (bx < 0 || bz < 0 || bx >= BLOCKS_PER_SIDE || bz >= BLOCKS_PER_SIDE) return;
    const agent = spawnPed(bx, bz, Math.floor(this.rand() * 4), this.rand(), this.rand);
    const d = Math.hypot(agent.s.x - px, agent.s.z - pz);
    if (d < CROWD_SPAWN[0] || d > CROWD_SPAWN[1]) return;
    this.addPed(agent);
  }
}
