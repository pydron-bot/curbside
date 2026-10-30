/**
 * The street's extra life on the screen, per frame, after the cars are
 * placed and their bodies posed (main.ts calls update() after fx.update()):
 *
 * - Two-wheelers lean into their turns (the whole bike and its rider roll
 *   about the bike's long axis, in proportion to the sideways acceleration:
 *   entities/vehicle.ts leanOf), and a crashed one lies on its side.
 * - Every bike with someone on it carries a rider from the character batch
 *   sitting on its `<arch>_seat` (vehicles.glb) and playing the Ride clip:
 *   the player on theirs, a pooled civilian on a scooter in traffic, an
 *   officer on a police bike.
 * - Ambulances and fire trucks on a call wail (their light bars flash
 *   through the car batch), and the ice cream van plays its chime now and
 *   then as it tours the streets.
 *
 * No simulation here: it reads the vehicles, the player and the police.
 */
import { Quaternion, Vector3 } from 'three';
import { MAX_LEAN, isBike, leanOf, type VehicleArchetype } from '../entities/vehicle';
import type { CharacterModel, Outfit } from '../render/characterModel';
import type { CarBatch } from '../render/vehicleBatch';
import { COP_OUTFIT } from '../systems/police';
import type { PoliceForce } from '../systems/police';
import type { Player } from './player';
import type { Vehicle } from './population';

/** Where the rider's hips sit, by bike (vehicles.glb `<arch>_seat`), until the GLB says otherwise. */
const SEAT_FALLBACK: Partial<Record<VehicleArchetype, readonly [number, number, number]>> = {
  scooter: [0, 0.75, -0.32],
  cop_bike: [0, 0.86, -0.28],
};
/** The Ride clip sits the hips this far above the character's root (docs/BLENDER_TODO.md §9), m. */
const RIDE_HIP = 0.75;
/** A tipped-over bike lies on its side: this roll, raised this much, rad / m. */
const TIPPED_ROLL = 1.38;
const TIPPED_LIFT = 0.28;
/** Sirens and chimes only for vehicles this close to the view's centre, m. */
const SOUND_RANGE = 150;
const CHIME_RANGE = 70;
/** The ice cream van's chime, every so often, s. */
const CHIME_EVERY = 9;
const RIDER_SHIRTS = ['#c94f4f', '#4f7cc9', '#5aa36a', '#d8d2c0', '#2f2f35', '#e08a3c', '#7d4fc9'];
const RIDER_SKIN = ['#e0ac84', '#c68e63', '#8d5a3b', '#f1c9a5', '#5e3b26'];

export interface StreetLifeDeps {
  vehicles: readonly Vehicle[];
  player: Player;
  playerModel: CharacterModel;
  police: PoliceForce;
  cars: CarBatch;
  /** A new character for a rider (added to the scene by the caller). */
  createRider(outfit: Outfit): CharacterModel;
  audio: {
    siren(id: string | number, x: number, z: number, on?: boolean, style?: 'twoTone' | 'wail' | 'yelp'): void;
    chime(x: number, z: number): void;
  };
}

export class StreetLife {
  /** Bikes with an NPC rider on, and the rider on each (parallel lists: no per-frame iterators). */
  private readonly riderBikes: Vehicle[] = [];
  private readonly riders: CharacterModel[] = [];
  private readonly spare: CharacterModel[] = [];
  private readonly lean = new WeakMap<Vehicle, number>();
  private readonly ids = new WeakMap<Vehicle, number>();
  private readonly chimeAt = new WeakMap<Vehicle, number>();
  private nextId = 1;
  private time = 0;
  private readonly seat = new Vector3();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly scale = new Vector3();
  private readonly seen = new Set<Vehicle>();

  constructor(private readonly d: StreetLifeDeps) {}

  update(dt: number, focusX: number, focusZ: number, playing: boolean): void {
    this.time += dt;
    const d = this.d;
    const seen = this.seen;
    seen.clear();
    const playerBike = d.player.driving && isBike(d.player.driving.archetype) ? d.player.driving : null;
    d.playerModel.riding = playerBike !== null;
    for (const v of d.vehicles) {
      const near = Math.abs(v.sim.x - focusX) < SOUND_RANGE && Math.abs(v.sim.z - focusZ) < SOUND_RANGE;
      // Negative ids: clear of the police units' (positive) siren ids, and no string per frame.
      if (v.emergency && v.ai && !v.damage.wrecked && near && playing) d.audio.siren(-this.idOf(v), v.sim.x, v.sim.z, true, 'wail');
      if (v.archetype === 'ice_cream_van' && v.ai && !v.damage.burning && playing) this.chime(v, focusX, focusZ);
      if (!isBike(v.archetype) || !v.mesh.root.visible) continue;
      const root = v.mesh.root;
      if (v.tipped) {
        root.rotation.z = TIPPED_ROLL;
        root.position.y = TIPPED_LIFT;
        this.lean.set(v, 0);
        continue;
      }
      // Lean into the turn, smoothed (the sim's yaw rate steps).
      const target = v.damage.wrecked ? 0 : leanOf(v.sim);
      const was = this.lean.get(v) ?? 0;
      const lean = was + (target - was) * Math.min(1, dt * 10);
      this.lean.set(v, lean);
      root.rotation.z = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, lean));
      root.updateMatrixWorld(true);
      if (v === playerBike) {
        d.playerModel.root.visible = true;
        this.sit(d.playerModel, v);
        continue;
      }
      if (!this.hasRider(v)) continue;
      seen.add(v);
      const k = this.riderBikes.indexOf(v);
      let rider = k >= 0 ? this.riders[k] : null;
      if (!rider) {
        rider = this.spare.pop() ?? d.createRider(this.outfitFor(v));
        rider.setOutfit(this.outfitFor(v));
        rider.root.visible = true;
        rider.riding = true;
        this.riderBikes.push(v);
        this.riders.push(rider);
      }
      this.sit(rider, v);
      rider.update(dt, 0, false);
    }
    // Riders whose bike lost them (thrown off, recycled, parked) go back to the pool.
    for (let i = this.riderBikes.length - 1; i >= 0; i--) {
      if (seen.has(this.riderBikes[i])) continue;
      const rider = this.riders[i];
      rider.root.visible = false;
      this.spare.push(rider);
      this.riderBikes.splice(i, 1);
      this.riders.splice(i, 1);
    }
  }

  /** Is an NPC riding this bike: a scooter in traffic, or an officer still aboard a police bike? */
  private hasRider(v: Vehicle): boolean {
    if (v.damage.wrecked || v.damage.burning) return false;
    const unit = this.d.police.unitOf(v);
    if (unit) return unit.aboard > 0;
    return v.ai !== null;
  }

  private outfitFor(v: Vehicle): Outfit {
    if (v.archetype === 'cop_bike') return { ...COP_OUTFIT, skin: RIDER_SKIN[this.idOf(v) % RIDER_SKIN.length] };
    const k = this.idOf(v);
    return { shirt: RIDER_SHIRTS[k % RIDER_SHIRTS.length], skin: RIDER_SKIN[(k * 7) % RIDER_SKIN.length] };
  }

  /** Put `model` on `v`'s seat: the bike's pose, the hips at the seat (the Ride clip's own height off the root). */
  private sit(model: CharacterModel, v: Vehicle): void {
    const s = this.d.cars.seat(v.archetype) ?? SEAT_FALLBACK[v.archetype];
    const root = v.mesh.root;
    if (!s) return;
    this.seat.set(s[0], s[1] - RIDE_HIP, s[2]);
    root.matrixWorld.decompose(this.p, this.q, this.scale);
    this.seat.applyQuaternion(this.q).add(this.p);
    model.root.position.copy(this.seat);
    model.root.quaternion.copy(this.q);
  }

  private chime(v: Vehicle, fx: number, fz: number): void {
    if (Math.abs(v.sim.x - fx) > CHIME_RANGE || Math.abs(v.sim.z - fz) > CHIME_RANGE) return;
    const next = this.chimeAt.get(v);
    if (next === undefined) {
      // The first one soon after it comes near, not all vans in step.
      this.chimeAt.set(v, this.time + 1 + (this.idOf(v) % 5));
      return;
    }
    if (this.time < next) return;
    this.chimeAt.set(v, this.time + CHIME_EVERY);
    this.d.audio.chime(v.sim.x, v.sim.z);
  }

  private idOf(v: Vehicle): number {
    let id = this.ids.get(v);
    if (id === undefined) this.ids.set(v, (id = this.nextId++));
    return id;
  }
}
