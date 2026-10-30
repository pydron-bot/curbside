/**
 * Particle simulation as struct-of-arrays pools: every field is a typed array
 * indexed by particle, dead slots go on a free list, and nothing is allocated
 * per particle or per frame. Pure (no three.js) so it's unit-tested; the
 * render glue in effects.ts uploads what `write()` fills into one instanced
 * draw call per pool.
 *
 * A particle is a camera-facing quad: round (rotating) or stretched along a
 * world-space axis (sparks along their velocity, tracers along the shot).
 * Colour and opacity follow a ramp over its life, so smoke fades out instead
 * of shrinking and fire cools from white through yellow and orange to red.
 */

/** Colour/opacity over life. */
export const RAMP = {
  /** Constant colour; quick fade-in, fades out over the last 40%. */
  flat: 0,
  /** White → yellow → orange → red, times the particle's colour (intensity). */
  fire: 1,
  /** Constant shade; fades in, holds, fades out softly. */
  smoke: 2,
  /** White-hot → orange, fading linearly. */
  spark: 3,
  /** Orange glow that flickers and dies. */
  ember: 4,
  /** A bright pop: opacity falls off quadratically. */
  flash: 5,
} as const;
export type Ramp = (typeof RAMP)[keyof typeof RAMP];

/** Cells of the 4×4 sprite atlas (fxAtlas.ts draws them). */
export const FRAME = {
  puffA: 0,
  puffB: 1,
  puffC: 2,
  flame: 3,
  dot: 4,
  spark: 5,
  star: 6,
  ring: 7,
  streak: 8,
  muzzle: 9,
  soft: 10,
  dust: 11,
  puffD: 12,
} as const;
export type Frame = (typeof FRAME)[keyof typeof FRAME];

/** Behaviour flags. */
export const FLAG = {
  /** Quad stretched along the velocity (length = speed × stretch). */
  stretch: 1,
  /** Bounces off the ground (y = 0.05) instead of passing through. */
  bounce: 2,
  /** When it dies, `onDeath` is told (e.g. fire hands off to smoke). */
  handoff: 4,
  /** Doesn't move: the velocity only orients a stretched quad (flares, wind streaks). */
  still: 8,
} as const;

/** Where `write()` puts each live particle: one instance per particle. */
export interface ParticleSink {
  /**
   * Append one quad: centre and size (m), stretch axis (world, its length is
   * the stretch in m; zero for a round quad) and rotation (rad), straight
   * colour (linear, may exceed 1) and opacity, atlas frame, and how additive
   * it is (0 = alpha over, 1 = pure light).
   */
  push(
    x: number,
    y: number,
    z: number,
    size: number,
    ax: number,
    ay: number,
    az: number,
    rot: number,
    r: number,
    g: number,
    b: number,
    a: number,
    frame: number,
    add: number,
  ): boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Fire colour at life fraction t (linear RGB) into out[0..2]. */
export function fireColour(t: number, out: Float32Array | number[]): void {
  // Keys: white-yellow, yellow, orange, red, dark red.
  let r: number, g: number, b: number;
  if (t < 0.12) {
    const k = t / 0.12;
    r = 1;
    g = 0.9 - 0.12 * k;
    b = 0.55 - 0.25 * k;
  } else if (t < 0.4) {
    const k = (t - 0.12) / 0.28;
    r = 1;
    g = 0.78 - 0.38 * k;
    b = 0.3 - 0.23 * k;
  } else if (t < 0.72) {
    const k = (t - 0.4) / 0.32;
    r = 1 - 0.38 * k;
    g = 0.4 - 0.27 * k;
    b = 0.07 - 0.04 * k;
  } else {
    const k = clamp01((t - 0.72) / 0.28);
    r = 0.62 - 0.4 * k;
    g = 0.13 - 0.08 * k;
    b = 0.03;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
}

/** Opacity of a particle on `ramp` at life fraction t (`seed` decorrelates flicker). */
export function rampAlpha(ramp: number, t: number, age: number, seed: number): number {
  switch (ramp) {
    case RAMP.fire:
      return smooth(0, 0.06, t) * (1 - smooth(0.5, 1, t));
    case RAMP.smoke:
      return smooth(0, 0.14, t) * (1 - smooth(0.4, 1, t));
    case RAMP.spark:
      return 1 - t;
    case RAMP.ember:
      return (1 - smooth(0.55, 1, t)) * (0.55 + 0.45 * Math.sin(age * 23 + seed * 7.1));
    case RAMP.flash:
      return (1 - t) * (1 - t);
    default:
      return smooth(0, 0.08, t) * (1 - smooth(0.6, 1, t));
  }
}

/**
 * One pool of particles. Spawn with `spawn()` (returns the slot, or -1 when
 * full), adjust optional fields straight on the arrays, `step(dt)` every
 * frame, `write(sink)` to draw.
 */
export class ParticlePool {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  /** Size (m) at birth and at death; eased between. */
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  /** Velocity damping, 1/s. */
  readonly drag: Float32Array;
  /** Downward acceleration, m/s² (negative rises: buoyant smoke). */
  readonly gravity: Float32Array;
  /** Stretch: seconds of velocity the quad spans (with FLAG.stretch). */
  readonly stretch: Float32Array;
  /** Colour (or, for RAMP.fire/spark, an intensity tint on the ramp). */
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  /** Peak opacity. */
  readonly alpha: Float32Array;
  /** 0 = alpha blended, 1 = additive light. */
  readonly add: Float32Array;
  readonly frame: Uint8Array;
  readonly ramp: Uint8Array;
  readonly flags: Uint8Array;
  readonly alive: Uint8Array;
  /** Called (no allocation) as a FLAG.handoff particle dies. */
  onDeath: ((pool: ParticlePool, i: number) => void) | null = null;
  private readonly free: Int32Array;
  private freeCount = 0;
  /** One past the highest slot in use since the pool was last empty: step/write scan up to here. */
  private top = 0;
  private live = 0;
  private readonly colour = new Float32Array(3);

  constructor(readonly capacity: number) {
    const f = () => new Float32Array(capacity);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.size0 = f();
    this.size1 = f();
    this.rot = f();
    this.spin = f();
    this.drag = f();
    this.gravity = f();
    this.stretch = f();
    this.r = f();
    this.g = f();
    this.b = f();
    this.alpha = f();
    this.add = f();
    this.frame = new Uint8Array(capacity);
    this.ramp = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.free = new Int32Array(capacity);
  }

  /** Live particles. */
  get count(): number {
    return this.live;
  }

  /** 0..1 how full the pool is (emitters back off as it fills). */
  get load(): number {
    return this.live / this.capacity;
  }

  /**
   * A new particle with sensible defaults (white, opaque, no drag, gravity,
   * spin or stretch; random rotation). Returns its slot, or -1 if the pool is
   * full (the particle is simply dropped).
   */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    ramp: Ramp,
    frame: Frame,
  ): number {
    let i: number;
    if (this.freeCount > 0) i = this.free[--this.freeCount];
    else if (this.top < this.capacity) i = this.top++;
    else return -1;
    this.alive[i] = 1;
    this.live++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = Math.max(1e-3, life);
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = 0;
    this.drag[i] = 0;
    this.gravity[i] = 0;
    this.stretch[i] = 0;
    this.r[i] = 1;
    this.g[i] = 1;
    this.b[i] = 1;
    this.alpha[i] = 1;
    this.add[i] = 0;
    this.frame[i] = frame;
    this.ramp[i] = ramp;
    this.flags[i] = 0;
    return i;
  }

  /** Remove every particle. */
  clear(): void {
    this.alive.fill(0);
    this.top = 0;
    this.freeCount = 0;
    this.live = 0;
  }

  /** Age, move and retire particles. */
  step(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < this.top; i++) {
      if (!this.alive[i]) continue;
      const age = this.age[i] + dt;
      if (age >= this.life[i]) {
        this.age[i] = this.life[i];
        if (this.flags[i] & FLAG.handoff && this.onDeath) this.onDeath(this, i);
        this.kill(i);
        continue;
      }
      this.age[i] = age;
      this.rot[i] += this.spin[i] * dt;
      if (this.flags[i] & FLAG.still) continue;
      const k = 1 / (1 + this.drag[i] * dt);
      let vx = this.vx[i] * k;
      let vy = (this.vy[i] - this.gravity[i] * dt) * k;
      let vz = this.vz[i] * k;
      let y = this.y[i] + vy * dt;
      if (this.flags[i] & FLAG.bounce && y < 0.05) {
        y = 0.05;
        vy = Math.abs(vy) * 0.35;
        vx *= 0.55;
        vz *= 0.55;
        this.spin[i] *= 0.5;
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      this.x[i] += vx * dt;
      this.y[i] = y;
      this.z[i] += vz * dt;
    }
    // Empty again: scan nothing until the next burst.
    if (this.live === 0) {
      this.top = 0;
      this.freeCount = 0;
    }
  }

  /** Push every live particle into `sink`. Returns how many went in. */
  write(sink: ParticleSink): number {
    let n = 0;
    const c = this.colour;
    for (let i = 0; i < this.top; i++) {
      if (!this.alive[i]) continue;
      const t = this.age[i] / this.life[i];
      const ramp = this.ramp[i];
      const a = this.alpha[i] * rampAlpha(ramp, t, this.age[i], i);
      if (a <= 0.003) continue;
      // Ease-out growth: puffs billow fast, then drift.
      const e = 1 - (1 - t) * (1 - t);
      const size = this.size0[i] + (this.size1[i] - this.size0[i]) * e;
      let r = this.r[i];
      let g = this.g[i];
      let b = this.b[i];
      if (ramp === RAMP.fire) {
        fireColour(t, c);
        r *= c[0];
        g *= c[1];
        b *= c[2];
      } else if (ramp === RAMP.spark) {
        fireColour(0.1 + t * 0.45, c);
        r *= c[0];
        g *= c[1];
        b *= c[2];
      } else if (ramp === RAMP.ember) {
        fireColour(0.35 + t * 0.4, c);
        r *= c[0];
        g *= c[1];
        b *= c[2];
      }
      let ax = 0;
      let ay = 0;
      let az = 0;
      if (this.flags[i] & FLAG.stretch) {
        const s = this.stretch[i];
        ax = this.vx[i] * s;
        ay = this.vy[i] * s;
        az = this.vz[i] * s;
      }
      if (!sink.push(this.x[i], this.y[i], this.z[i], size, ax, ay, az, this.rot[i], r, g, b, a, this.frame[i], this.add[i])) break;
      n++;
    }
    return n;
  }

  private kill(i: number): void {
    this.alive[i] = 0;
    this.live--;
    this.free[this.freeCount++] = i;
  }
}

/**
 * Instance buffers for one particle draw call, in the layout the particle
 * shader reads: pos (xyz, size), axis (xyz, rotation), colour (rgba),
 * fx (atlas frame, additive share). Pure arrays; effects.ts wraps them in
 * InstancedBufferAttributes.
 */
export class InstanceBuffer implements ParticleSink {
  readonly pos: Float32Array;
  readonly axis: Float32Array;
  readonly colour: Float32Array;
  readonly fx: Float32Array;
  count = 0;

  constructor(readonly capacity: number) {
    this.pos = new Float32Array(capacity * 4);
    this.axis = new Float32Array(capacity * 4);
    this.colour = new Float32Array(capacity * 4);
    this.fx = new Float32Array(capacity * 2);
  }

  reset(): void {
    this.count = 0;
  }

  push(
    x: number,
    y: number,
    z: number,
    size: number,
    ax: number,
    ay: number,
    az: number,
    rot: number,
    r: number,
    g: number,
    b: number,
    a: number,
    frame: number,
    add: number,
  ): boolean {
    if (this.count >= this.capacity) return false;
    const i = this.count++;
    const o = i * 4;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.pos[o + 3] = size;
    this.axis[o] = ax;
    this.axis[o + 1] = ay;
    this.axis[o + 2] = az;
    this.axis[o + 3] = rot;
    this.colour[o] = r;
    this.colour[o + 1] = g;
    this.colour[o + 2] = b;
    this.colour[o + 3] = a;
    this.fx[i * 2] = frame;
    this.fx[i * 2 + 1] = add;
    return true;
  }
}
