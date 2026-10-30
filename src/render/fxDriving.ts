/**
 * Driving effects, per car, every frame: skid marks from the rear wheels when
 * a car slides, handbrakes, brakes hard or spins its wheels; tyre smoke on a
 * real slide (the player's drift smoke warms from white through gold to
 * pink as the drift's points pile up); dust off grass; wind streaks past the
 * player's car at speed; and smoke, flames, embers and a flickering fire glow
 * from damaged and burning cars. Also runs each car's body motion
 * (fxCarBody.ts). The decision logic (skidAmount, driftTint, isGrass) is
 * pure and unit-tested.
 */
import { VEHICLE_SPECS, forwardSpeed, lateralSpeed, speed, type VehicleArchetype, type VehicleControls } from '../entities/vehicle';
import type { Vehicle } from '../game/population';
import { damageStage } from '../systems/damage';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, type City } from '../world/city';
import type { Effects } from './effects';
import { RAMP_HEIGHT, RAMP_LENGTH } from '../world/ramps';
import { CarBody, applyBody } from './fxCarBody';
import { DECAL, type GroundDecals } from './fxDecals';

/** Rear axle (m behind the root, along the car) and half the track width, per model. */
const WHEELS: Record<VehicleArchetype, { rear: number; track: number }> = {
  sedan: { rear: 1.35, track: 0.78 },
  compact: { rear: 1.15, track: 0.74 },
  sports: { rear: 1.3, track: 0.8 },
  van: { rear: 1.55, track: 0.82 },
  police: { rear: 1.35, track: 0.8 },
  taxi: { rear: 1.35, track: 0.78 },
  pickup: { rear: 1.6, track: 0.82 },
  muscle: { rear: 1.42, track: 0.82 },
  limo: { rear: 2.3, track: 0.8 },
  police_suv: { rear: 1.45, track: 0.83 },
  swat: { rear: 1.85, track: 0.92 },
  ambulance: { rear: 1.75, track: 0.9 },
  firetruck: { rear: 2.7, track: 1.05 },
  garbage_truck: { rear: 2.7, track: 1.05 },
  tow_truck: { rear: 1.75, track: 0.92 },
  ice_cream_van: { rear: 1.65, track: 0.88 },
  bus: { rear: 3.6, track: 1.08 },
  // One track down the middle (both trails on top of each other read as one dark line).
  scooter: { rear: 0.6, track: 0 },
  cop_bike: { rear: 0.78, track: 0 },
};
const DEFAULT_WHEELS = WHEELS.sedan;
/** Skid ribbon width, m. */
const TYRE = 0.3;
/** Skid marks fade out over this long, s. */
const SKID_LIFE = 22;
/** A ribbon segment is laid every this far, m. */
const SEGMENT = 0.4;
/** Effects only run for cars this close to the action, m. */
const FX_RANGE = 110;
/** Most burning cars that get a fire glow in one frame. */
const MAX_FIRE_GLOWS = 12;
/** Nose-up pitch on a ramp's slope, rad. */
const RAMP_PITCH = -Math.atan2(RAMP_HEIGHT, RAMP_LENGTH);

/** What makes a skid. */
export interface SkidInput {
  /** Sideways slip speed, m/s (absolute). */
  slip: number;
  /** Ground speed, m/s. */
  speed: number;
  /** Forward speed, m/s (negative reversing). */
  forward: number;
  /** Smoothed acceleration along the car, m/s² (negative = braking). */
  accel: number;
  /** Handbrake held (player only). */
  handbrake: boolean;
  /** Throttle -1..1 (player only; 0 for AI). */
  throttle: number;
}

/**
 * How hard the rear tyres are skidding, 0..1: sliding sideways past ~3 m/s,
 * the handbrake at speed, braking harder than ~15 m/s², a launch with the
 * throttle floored (wheelspin), or a burnout (handbrake and throttle at a
 * standstill).
 */
export function skidAmount(s: SkidInput): number {
  let a = 0;
  if (s.speed > 3) a = Math.max(a, (s.slip - 2.8) / 7);
  if (s.handbrake && s.speed > 4.5) a = Math.max(a, 0.55 + Math.min(0.45, s.slip / 12));
  if (s.speed > 5 && s.accel < -15) a = Math.max(a, (-s.accel - 15) / 12);
  if (s.throttle > 0.75 && s.forward > -0.5 && s.forward < 7 && s.accel > 9) a = Math.max(a, 0.5);
  // A burnout: held on the handbrake with the throttle floored, the rear wheels spin in place.
  if (s.handbrake && s.throttle > 0.5 && s.speed < 3) a = Math.max(a, 0.9);
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/**
 * Tyre-smoke colour for a drift worth `points`: pale grey, warming to gold
 * past ~150, then to hot pink past ~600. Writes linear rgb into out.
 */
export function driftTint(points: number, out: { r: number; g: number; b: number }): void {
  const grey = 0.78;
  if (points < 150) {
    out.r = out.g = out.b = grey;
    return;
  }
  if (points < 600) {
    const k = Math.min(1, (points - 150) / 300);
    out.r = grey + (1.0 - grey) * k;
    out.g = grey + (0.74 - grey) * k;
    out.b = grey + (0.36 - grey) * k;
    return;
  }
  const k = Math.min(1, (points - 600) / 500);
  out.r = 1.0;
  out.g = 0.74 + (0.38 - 0.74) * k;
  out.b = 0.36 + (0.78 - 0.36) * k;
}

/** Grass lots (parks) by block, for dust under the wheels. */
export class GrassMap {
  private readonly park = new Uint8Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);

  constructor(city: Pick<City, 'blocks'>) {
    for (const b of city.blocks) if (b.kind === 'park') this.park[b.bz * BLOCKS_PER_SIDE + b.bx] = 1;
  }

  /** Is (x, z) on a park's lawn (inside the sidewalks)? */
  isGrass(x: number, z: number): boolean {
    const gx = x + HALF_EXTENT;
    const gz = z + HALF_EXTENT;
    const bx = Math.floor(gx / BLOCK_SIZE);
    const bz = Math.floor(gz / BLOCK_SIZE);
    if (bx < 0 || bz < 0 || bx >= BLOCKS_PER_SIDE || bz >= BLOCKS_PER_SIDE) return false;
    if (!this.park[bz * BLOCKS_PER_SIDE + bx]) return false;
    const inset = ROAD_WIDTH / 2 + SIDEWALK;
    const lx = gx - bx * BLOCK_SIZE;
    const lz = gz - bz * BLOCK_SIZE;
    return lx > inset && lx < BLOCK_SIZE - inset && lz > inset && lz < BLOCK_SIZE - inset;
  }
}

/** One rear wheel's ribbon: continues from where the last segment ended so joints don't overlap. */
export class SkidTrail {
  private active = false;
  private hasEdges = false;
  private lx = 0;
  private lz = 0;
  private ax = 0;
  private az = 0;
  private bx = 0;
  private bz = 0;
  private along = 0;

  /** Feed the wheel's position and skid amount (0 ends the ribbon). */
  step(x: number, z: number, amount: number, decals: Pick<GroundDecals, 'segment'>): void {
    if (amount <= 0.02) {
      this.active = false;
      return;
    }
    if (!this.active) {
      this.active = true;
      this.hasEdges = false;
      this.lx = x;
      this.lz = z;
      return;
    }
    const dx = x - this.lx;
    const dz = z - this.lz;
    const d = Math.hypot(dx, dz);
    if (d < SEGMENT) return;
    if (d > 5) {
      // Teleported or thrown by a blast: start a new ribbon.
      this.active = false;
      return;
    }
    const px = (-dz / d) * TYRE * 0.5;
    const pz = (dx / d) * TYRE * 0.5;
    if (!this.hasEdges) {
      this.ax = this.lx + px;
      this.az = this.lz + pz;
      this.bx = this.lx - px;
      this.bz = this.lz - pz;
      this.hasEdges = true;
    }
    const cx = x - px;
    const cz = z - pz;
    const ex = x + px;
    const ez = z + pz;
    decals.segment(this.ax, this.az, this.bx, this.bz, cx, cz, ex, ez, this.along, this.along + d, 0.25 + amount * 0.55, SKID_LIFE);
    this.ax = ex;
    this.az = ez;
    this.bx = cx;
    this.bz = cz;
    this.lx = x;
    this.lz = z;
    this.along += d;
  }

  reset(): void {
    this.active = false;
  }
}

/** Per-car effect state. */
interface CarFx {
  body: CarBody;
  left: SkidTrail;
  right: SkidTrail;
  /** Fractional particles owed (emission at a rate, frame-rate independent). */
  smokeDebt: number;
  fireDebt: number;
  dustDebt: number;
  /** Accel along the car (from the body's velocity tracking), m/s². */
  accel: number;
  svF: number;
}

/** A flickering fire glow to draw this frame. */
export interface FireGlows {
  count: number;
  x: Float32Array;
  z: Float32Array;
  k: Float32Array;
}

export class DrivingFx {
  readonly fires: FireGlows = {
    count: 0,
    x: new Float32Array(MAX_FIRE_GLOWS),
    z: new Float32Array(MAX_FIRE_GLOWS),
    k: new Float32Array(MAX_FIRE_GLOWS),
  };
  private readonly cars = new Map<Vehicle, CarFx>();
  private readonly grass: GrassMap;
  private readonly tint = { r: 0.78, g: 0.78, b: 0.78 };
  private readonly skid: SkidInput = { slip: 0, speed: 0, forward: 0, accel: 0, handbrake: false, throttle: 0 };
  private streakDebt = 0;
  private time = 0;

  constructor(
    private readonly fx: Effects,
    city: Pick<City, 'blocks'>,
  ) {
    this.grass = new GrassMap(city);
  }

  /** This car's body (created on first use), for impacts and blasts. */
  body(v: Vehicle): CarBody {
    return this.record(v).body;
  }

  /**
   * Run every car's effects for one frame of effect time `dt`. `player` is
   * the car the player drives (its controls feed handbrake and wheelspin
   * marks, and its drift points colour the smoke); focus is the camera's.
   */
  update(
    dt: number,
    vehicles: ReadonlyArray<Vehicle>,
    player: Vehicle | null,
    controls: VehicleControls | null,
    driftPoints: number,
    focusX: number,
    focusZ: number,
  ): void {
    this.time += dt;
    this.fires.count = 0;
    const scale = this.fx.scale;
    const decals = this.fx.decals;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const root = v.mesh.root;
      const rec = this.record(v);
      const s = v.sim;
      // Body motion (also for far cars, so they don't snap when they come into view).
      rec.body.step(s, dt);
      applyBody(root, rec.body);
      // Up a ramp the nose lifts; in the air it follows the arc (nose up rising, down falling).
      if (s.y > 0) root.rotation.x += s.airborne ? Math.max(-0.35, Math.min(0.3, -s.vy * 0.03)) : RAMP_PITCH;
      if (dt <= 0) continue;
      const near = Math.abs(s.x - focusX) < FX_RANGE && Math.abs(s.z - focusZ) < FX_RANGE;
      // Forward acceleration, smoothed like the body's.
      const fwd = forwardSpeed(s);
      const k = 1 - Math.exp(-9 * dt);
      rec.accel = (fwd - rec.svF) * 9;
      rec.svF += (fwd - rec.svF) * k;
      if (!near || !root.visible) {
        rec.left.reset();
        rec.right.reset();
        continue;
      }
      this.damage(v, rec, dt, scale);
      // Wrecks and cars off the ground leave no marks.
      if (v.damage.wrecked || s.y > 0.05) {
        rec.left.reset();
        rec.right.reset();
        continue;
      }

      // --- Tyres ---
      const isPlayer = v === player;
      const sp = speed(s);
      const sk = this.skid;
      sk.slip = Math.abs(lateralSpeed(s));
      sk.speed = sp;
      sk.forward = fwd;
      sk.accel = rec.accel;
      sk.handbrake = isPlayer && controls !== null && controls.handbrake;
      sk.throttle = isPlayer && controls ? controls.throttle : 0;
      const amount = skidAmount(sk);
      const w = WHEELS[v.archetype] ?? DEFAULT_WHEELS;
      const sin = Math.sin(s.heading);
      const cos = Math.cos(s.heading);
      // Rear wheels: behind the centre, either side (left axis is (cos, -sin)).
      const rx = root.position.x - sin * w.rear;
      const rz = root.position.z - cos * w.rear;
      const lx = rx + cos * w.track;
      const lz = rz - sin * w.track;
      const qx = rx - cos * w.track;
      const qz = rz + sin * w.track;
      rec.left.step(lx, lz, amount, decals);
      // A bike has one rear wheel: one trail.
      rec.right.step(qx, qz, w.track > 0 ? amount : 0, decals);

      if (amount > 0.3) {
        const tintSmoke = isPlayer ? driftPoints : 0;
        driftTint(tintSmoke, this.tint);
        const heat = isPlayer ? Math.min(1, driftPoints / 800) : 0;
        rec.smokeDebt += dt * (10 + 22 * amount + 14 * heat) * scale;
        while (rec.smokeDebt >= 1) {
          rec.smokeDebt -= 1;
          const side = Math.random() < 0.5;
          this.fx.tyreSmoke(side ? lx : qx, side ? lz : qz, s.vx, s.vz, Math.min(1, amount + heat * 0.5), this.tint.r, this.tint.g, this.tint.b);
        }
      }
      if (sp > 4 && this.grass.isGrass(rx, rz)) {
        rec.dustDebt += dt * Math.min(30, sp * 1.2) * scale;
        while (rec.dustDebt >= 1) {
          rec.dustDebt -= 1;
          const side = Math.random() < 0.5;
          const i = this.fx.puff(side ? lx : qx, 0.3, side ? lz : qz, 0.46, 0.6, 2.4 + sp * 0.04, 0.5, -s.vx * 0.15, 0.7, -s.vz * 0.15, 1.1);
          if (i >= 0) {
            this.fx.soft.r[i] = 0.47;
            this.fx.soft.g[i] = 0.39;
            this.fx.soft.b[i] = 0.27;
          }
        }
      }
      if (isPlayer) this.speedStreaks(v, sp, dt, scale);
    }
  }

  /** A crash at (x, z): bodies of cars at the contact lurch, and a scrape is left on the road. */
  crash(vehicles: ReadonlyArray<Vehicle>, x: number, z: number, impact: number): Vehicle | null {
    let nearest: Vehicle | null = null;
    let best = 3.6;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const d = Math.hypot(v.sim.x - x, v.sim.z - z);
      if (d > 3.6) continue;
      this.record(v).body.impact(v.sim, x, z, impact);
      if (d < best) {
        best = d;
        nearest = v;
      }
    }
    if (impact > 4) {
      const a = Math.random() * Math.PI;
      const len = 0.6 + Math.min(2.2, impact * 0.08);
      const dx = Math.cos(a) * len;
      const dz = Math.sin(a) * len;
      const px = -Math.sin(a) * 0.06;
      const pz = Math.cos(a) * 0.06;
      this.fx.decals.segment(x - dx + px, z - dz + pz, x - dx - px, z - dz - pz, x + dx - px, z + dz - pz, x + dx + px, z + dz + pz, 0, len * 2, 0.55, 14, DECAL.scuff);
    }
    return nearest;
  }

  /** A blast at (x, z) of radius r: nearby bodies hop and tumble (the source car hardest). */
  blast(vehicles: ReadonlyArray<Vehicle>, x: number, z: number, r: number): void {
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const d = Math.hypot(v.sim.x - x, v.sim.z - z);
      if (d > r) continue;
      this.record(v).body.blast(v.sim, x, z, d < 0.5 ? 1 : 0.85 * (1 - d / r));
    }
  }

  /** Forget body motion and ribbons (a fresh run). */
  reset(): void {
    for (const rec of this.cars.values()) {
      rec.body.reset();
      rec.left.reset();
      rec.right.reset();
    }
  }

  /** Smoke from damaged cars, flames and a fire glow from burning ones, a smouldering wreck after. */
  private damage(v: Vehicle, rec: CarFx, dt: number, scale: number): void {
    const stage = damageStage(v.damage);
    if (stage === 'ok') return;
    const s = v.sim;
    const hoodX = v.mesh.root.position.x + Math.sin(s.heading) * 1.4;
    const hoodZ = v.mesh.root.position.z + Math.cos(s.heading) * 1.4;
    const hoodY = 1.25 + v.mesh.root.position.y;
    if (stage === 'smoking') {
      const hurt = 1 - v.damage.health / v.damage.maxHealth;
      rec.smokeDebt += dt * (8 + 16 * hurt) * scale;
      while (rec.smokeDebt >= 1) {
        rec.smokeDebt -= 1;
        this.fx.emitSmoke(hoodX, hoodZ, hoodY, 0.15 + hurt * 0.4);
      }
    } else if (stage === 'burning') {
      rec.fireDebt += dt * 42 * scale;
      while (rec.fireDebt >= 1) {
        rec.fireDebt -= 1;
        this.fx.emitFire(hoodX, hoodZ, hoodY);
      }
      rec.smokeDebt += dt * 15 * scale;
      while (rec.smokeDebt >= 1) {
        rec.smokeDebt -= 1;
        this.fx.emitSmoke(hoodX, hoodZ, hoodY + 1.2, 0.9);
      }
      if (Math.random() < dt * 6 * scale) this.fx.embers(hoodX, hoodZ, 1, 0.5, 2);
      this.addGlow(hoodX, hoodZ, 1);
    } else if (v.wreckAge < 25) {
      v.wreckAge += dt;
      const flames = Math.max(0, 1 - v.wreckAge / 6);
      rec.fireDebt += dt * 34 * flames * scale;
      while (rec.fireDebt >= 1) {
        rec.fireDebt -= 1;
        this.fx.emitFire(s.x + (Math.random() - 0.5) * 1.6, s.z + (Math.random() - 0.5) * 2.4, 1.1);
      }
      rec.smokeDebt += dt * (4 + 8 * flames) * scale;
      while (rec.smokeDebt >= 1) {
        rec.smokeDebt -= 1;
        this.fx.emitSmoke(s.x, s.z, 1.4, 0.75);
      }
      if (v.wreckAge < 10 && Math.random() < dt * 5 * scale) this.fx.embers(s.x, s.z, 1, 0.3, 1.5);
      if (flames > 0) this.addGlow(s.x, s.z, flames);
    }
  }

  private addGlow(x: number, z: number, k: number): void {
    const f = this.fires;
    if (f.count >= MAX_FIRE_GLOWS) return;
    // Two incommensurate flickers per fire, offset by position.
    const t = this.time;
    const flicker = 0.72 + 0.18 * Math.sin(t * 19 + x) + 0.1 * Math.sin(t * 31.7 + z * 1.3);
    const i = f.count++;
    f.x[i] = x;
    f.z[i] = z;
    f.k[i] = k * flicker;
  }

  /** Pale streaks hanging in the air beside the player's car above ~65% of its top speed. */
  private speedStreaks(v: Vehicle, sp: number, dt: number, scale: number): void {
    const top = VEHICLE_SPECS[v.archetype].maxSpeed;
    const over = (sp / top - 0.62) / 0.38;
    if (over <= 0) {
      this.streakDebt = 0;
      return;
    }
    const s = v.sim;
    const dx = s.vx / sp;
    const dz = s.vz / sp;
    this.streakDebt += dt * 55 * Math.min(1, over) * Math.max(0.5, scale);
    while (this.streakDebt >= 1) {
      this.streakDebt -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const off = side * (2.2 + Math.random() * 9);
      const ahead = 4 + Math.random() * 26;
      const x = v.mesh.root.position.x + dx * ahead - dz * off;
      const z = v.mesh.root.position.z + dz * ahead + dx * off;
      this.fx.streak(x, 1 + Math.random() * 4, z, dx, dz, 3 + Math.random() * 5, 0.12 + 0.2 * Math.min(1, over), 0.24);
    }
  }

  private record(v: Vehicle): CarFx {
    let rec = this.cars.get(v);
    if (!rec) {
      rec = { body: new CarBody(), left: new SkidTrail(), right: new SkidTrail(), smokeDebt: 0, fireDebt: 0, dustDebt: 0, accel: 0, svF: 0 };
      this.cars.set(v, rec);
    }
    return rec;
  }
}
