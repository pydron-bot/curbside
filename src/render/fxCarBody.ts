/**
 * Car body motion for the renderer: the body leans out of turns, dips its
 * nose under braking and squats when it launches, jolts and squashes on
 * impacts, and hops and tumbles when a blast goes off under it. Purely
 * visual (the simulation stays flat 2D); the CarBatch draws each car from
 * its root's world matrix, so this only sets the root's pitch, roll, height
 * and scale after main.ts has placed it.
 *
 * Accelerations come from the change in velocity, smoothed, so it works the
 * same for the player, AI traffic and cars shoved by a blast.
 */
import { Spring } from './fxMotion';

/** The parts of a sim vehicle this reads. */
export interface BodySim {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
}

/** Roll (rad) per m/s² of sideways acceleration; lean is outward. */
const ROLL_PER_ACCEL = 0.0032;
/** Pitch (rad) per m/s² of forward acceleration; braking dips the nose. */
const PITCH_PER_ACCEL = 0.0024;
const MAX_ROLL = 0.11;
const MAX_PITCH = 0.08;
/** How quickly the velocity estimate follows (sets the acceleration smoothing), 1/s. */
const ACCEL_RATE = 9;
const GRAVITY = 22;
/** A jump this big between frames is a teleport (respawn, recycling), not motion. */
const TELEPORT = 12;

export class CarBody {
  /** Rotation about the car's left axis: positive dips the nose. */
  readonly pitch = new Spring(95, 9.5);
  /** Rotation about the car's forward axis: positive lifts the left side. */
  readonly roll = new Spring(95, 9.5);
  /** Vertical squash: scale.y = 1 + value (negative squashes). */
  readonly squash = new Spring(260, 11);
  /** Height above the ground from a blast hop, m. */
  hop = 0;
  hopVelocity = 0;
  private svx = 0;
  private svz = 0;
  private lastX = 0;
  private lastZ = 0;
  private tracked = false;

  /** Follow the sim one frame: lean from acceleration, settle the springs, fly any hop. */
  step(sim: BodySim, dt: number): void {
    if (dt <= 0) return;
    if (!this.tracked || Math.abs(sim.x - this.lastX) > TELEPORT || Math.abs(sim.z - this.lastZ) > TELEPORT) {
      this.reset(sim);
    }
    this.lastX = sim.x;
    this.lastZ = sim.z;
    // Smoothed velocity lags a steady acceleration a by a / rate: (v - smoothed) * rate ≈ a.
    const k = 1 - Math.exp(-ACCEL_RATE * dt);
    const ax = (sim.vx - this.svx) * ACCEL_RATE;
    const az = (sim.vz - this.svz) * ACCEL_RATE;
    this.svx += (sim.vx - this.svx) * k;
    this.svz += (sim.vz - this.svz) * k;
    const s = Math.sin(sim.heading);
    const c = Math.cos(sim.heading);
    const forward = ax * s + az * c;
    // The car's left axis is (cos h, -sin h).
    const left = ax * c - az * s;
    this.roll.target = clamp(left * ROLL_PER_ACCEL, MAX_ROLL);
    this.pitch.target = clamp(-forward * PITCH_PER_ACCEL, MAX_PITCH);
    this.roll.step(dt);
    this.pitch.step(dt);
    this.squash.step(dt);
    if (this.hop > 0 || this.hopVelocity > 0) {
      this.hopVelocity -= GRAVITY * dt;
      this.hop += this.hopVelocity * dt;
      if (this.hop <= 0) {
        this.hop = 0;
        // One small bounce, then it stays down.
        this.hopVelocity = this.hopVelocity < -3 ? -this.hopVelocity * 0.3 : 0;
        if (this.hopVelocity > 0) this.squash.kick(-1.2);
      }
    }
  }

  /**
   * A hit at world (x, z) of `strength` (closing speed, m/s): the body
   * lurches away from the contact and squashes.
   */
  impact(sim: BodySim, x: number, z: number, strength: number): void {
    const dx = x - sim.x;
    const dz = z - sim.z;
    const s = Math.sin(sim.heading);
    const c = Math.cos(sim.heading);
    const d = Math.hypot(dx, dz) || 1;
    const along = (dx * s + dz * c) / d;
    const side = (dx * c - dz * s) / d;
    const k = Math.min(1, strength / 25);
    // Hit on the left (side > 0): the roof sways right, i.e. the left lifts.
    this.roll.kick(side * k * 2.2);
    // Hit at the nose: the nose kicks up a touch (the sim's deceleration dips it after).
    this.pitch.kick(-along * k * 1.4);
    this.squash.kick(-k * 2.2);
  }

  /**
   * A blast at (x, z): up and away, tumbling. `power` 0..1 (1 = the car that
   * blew up, or right next to it).
   */
  blast(sim: BodySim, x: number, z: number, power: number): void {
    if (power <= 0) return;
    const dx = sim.x - x;
    const dz = sim.z - z;
    const d = Math.hypot(dx, dz);
    const s = Math.sin(sim.heading);
    const c = Math.cos(sim.heading);
    // Direction away from the blast in car space (random when it's the car itself).
    const a = d > 0.3 ? 0 : Math.random() * Math.PI * 2;
    const ux = d > 0.3 ? dx / d : Math.cos(a);
    const uz = d > 0.3 ? dz / d : Math.sin(a);
    const along = ux * s + uz * c;
    const side = ux * c - uz * s;
    this.hopVelocity = Math.max(this.hopVelocity, 2 + 4.5 * power);
    this.hop = Math.max(this.hop, 0.01);
    // The near side lifts: pushed toward +side means the far (-side) edge digs in.
    this.roll.kick(-side * power * 4.5 + (Math.random() - 0.5) * power);
    this.pitch.kick(along * power * 3.5 + (Math.random() - 0.5) * power);
    this.squash.kick(power * 1.5);
  }

  /** Coming down from a jump at `impact` m/s: the body slams down and bounces on its springs. */
  land(impact: number): void {
    const k = Math.min(1, impact / 14);
    this.squash.kick(-k * 3);
    this.pitch.kick(k * 0.8 * (Math.random() < 0.5 ? 1 : -1));
  }

  reset(sim?: BodySim): void {
    this.pitch.reset();
    this.roll.reset();
    this.squash.reset();
    this.hop = 0;
    this.hopVelocity = 0;
    this.svx = sim ? sim.vx : 0;
    this.svz = sim ? sim.vz : 0;
    this.lastX = sim ? sim.x : 0;
    this.lastZ = sim ? sim.z : 0;
    this.tracked = sim !== undefined;
  }

  /**
   * Height to raise the root so the lowest corner of the tilted body stays
   * at the ground (the root pivots at the ground centre), plus any hop.
   */
  lift(halfLength = 2.2, halfWidth = 0.95): number {
    return this.hop + Math.abs(this.pitch.value) * halfLength * 0.5 + Math.abs(this.roll.value) * halfWidth * 0.5;
  }
}

/** The bits of an Object3D the body writes (three's Object3D fits). */
export interface BodyRoot {
  position: { y: number };
  rotation: { x: number; z: number; order: string };
  scale: { set(x: number, y: number, z: number): unknown };
}

/**
 * Write a body's pose onto a car root that main.ts has already placed
 * (position, rotation.y) this frame: call once per frame. Euler order YXZ: heading first, then pitch
 * about the car's own left axis, then roll about its own forward axis.
 */
export function applyBody(root: BodyRoot, body: CarBody): void {
  if (root.rotation.order !== 'YXZ') root.rotation.order = 'YXZ';
  root.rotation.x = clamp(body.pitch.value, 0.6);
  root.rotation.z = clamp(body.roll.value, 0.6);
  // On top of the height main.ts placed it at (a ramp, a jump).
  root.position.y += body.lift();
  const sq = Math.max(-0.25, Math.min(0.25, body.squash.value));
  root.scale.set(1 - sq * 0.4, 1 + sq, 1 - sq * 0.4);
}

function clamp(v: number, m: number): number {
  return v < -m ? -m : v > m ? m : v;
}
