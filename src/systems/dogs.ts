/**
 * Stray dogs: a few per area trotting round the pavements, stopping to
 * sniff, and chasing anyone who runs past (a passer-by or the player) for
 * a short way, barking, before giving it up. Gunfire sends them running;
 * a car (or a blast, or a punch) knocks them over, and they get up and
 * bolt. Pure (no three.js), tested in tests/dogs.test.ts; the city's
 * scene (game/scenes/strayDogs.ts) feeds it the runners and cars, puts
 * dogs down out of view and draws them (render/atmosphereLook.ts).
 */
import { BLOCKS_PER_SIDE } from '../world/city';
import { blockAt, cornerPoint } from './crowd';
import { len2 } from '../core/len';

export type DogMode = 'trot' | 'sniff' | 'chase' | 'flee' | 'down';

export interface Dog {
  x: number;
  z: number;
  /** Facing (sin h, cos h), like everyone else. */
  heading: number;
  /** Ground speed now, m/s (the look's gait). */
  speed: number;
  mode: DogMode;
  /** Seconds left sniffing, chasing, fleeing or lying there. */
  timer: number;
  /** The pavement loop it trots: block and the corner it's heading for. */
  bx: number;
  bz: number;
  corner: number;
  clockwise: boolean;
  /** Off the walkers' line toward the kerb or the wall, m. */
  lane: number;
  /** Who it's after (a runner's `ref`), and where the chase began. */
  target: unknown;
  fromX: number;
  fromZ: number;
  /** Where it's fleeing from / was knocked from, unit. */
  awayX: number;
  awayZ: number;
  /** Seconds before it'll chase again, and to the next bark. */
  calm: number;
  barkIn: number;
  /** Gait phase, 0..1 a stride (the look swaps poses on it). */
  stride: number;
  /** Coat colour index (the look's palette). */
  coat: number;
}

/** Someone a dog might chase. */
export interface DogRunner {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Who it is (a ped's agent, the player): followed by identity. */
  ref: unknown;
}

/** A car that can knock a dog over. */
export interface DogCar {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Half its length and half its width, m. */
  reach: number;
  half: number;
}

export interface DogWorld {
  runners: readonly DogRunner[];
  cars: readonly DogCar[];
  /** Is there a wall (or a trunk) within `r` of (x, z)? */
  blocked(x: number, z: number, r: number): boolean;
}

/** What the pack tells the game: a bark, a yelp (hurt, or scared off). */
export interface DogHooks {
  bark(d: Dog): void;
  yelp(d: Dog): void;
}

// --- Tunables -------------------------------------------------------------
export const TROT = 1.5;
/** Faster than a running passer-by (5.2), a little slower than the player's sprint (6). */
export const CHASE_SPEED = 5.6;
export const FLEE_SPEED = 6.5;
/** Someone moving faster than this within CHASE_SIGHT gets chased (CHASE_CHANCE of the times it's seen). */
export const RUN_SPEED = 3.8;
export const CHASE_SIGHT = 8;
const CHASE_CHANCE = 0.75;
/** A chase lasts at most this long, s, or this far from where it began, m. */
export const CHASE_TIME = 3.5;
export const CHASE_LEASH = 22;
/** Not again for this long after one, s. */
const CHASE_COOLDOWN = 7;
/** Barks this often while chasing, s; stays this close at the heels, m. */
const BARK_EVERY = 0.45;
const HEEL = 1.1;
/** Sniffing: this likely per second of trotting, for this long, s. */
const SNIFF_RATE = 0.12;
const SNIFF = [1.5, 3.5] as const;
/** Gunfire within this sends them running for FLEE_TIME s; knocked over for DOWN_TIME s, then they bolt. */
export const SHOT_SCARE = 32;
export const FLEE_TIME = 4;
export const DOWN_TIME = [2.5, 4] as const;
/** A car faster than this touching a dog knocks it over, m/s. */
const CAR_KNOCK = 3.5;
/** Dog body radius, m. */
export const DOG_RADIUS = 0.35;
/** One stride, m (the look's gait). */
const STRIDE = 0.6;

export class DogPack {
  readonly dogs: Dog[] = [];
  private readonly spare: Dog[] = [];
  private readonly corner = { x: 0, z: 0 };

  constructor(
    private readonly rand: () => number,
    private readonly hooks: DogHooks,
  ) {}

  /** A dog on the pavement of block (bx, bz), at (x, z), heading for `corner`. */
  add(x: number, z: number, bx: number, bz: number, corner: number, coat: number): Dog {
    const r = this.rand;
    const d = this.spare.pop() ?? newDog();
    Object.assign(d, {
      x,
      z,
      heading: r() * Math.PI * 2,
      speed: 0,
      mode: 'trot',
      timer: 0,
      bx,
      bz,
      corner: corner & 3,
      clockwise: r() < 0.5,
      lane: (r() * 2 - 1) * 0.9,
      target: null,
      fromX: x,
      fromZ: z,
      awayX: 0,
      awayZ: 1,
      calm: 2,
      barkIn: 0,
      stride: r(),
      coat,
    } satisfies Dog);
    this.dogs.push(d);
    return d;
  }

  /** Take a dog off the street (far off, or a fresh run). */
  remove(d: Dog): void {
    const i = this.dogs.indexOf(d);
    if (i < 0) return;
    this.dogs.splice(i, 1);
    d.target = null;
    this.spare.push(d);
  }

  clear(): void {
    for (const d of this.dogs) {
      d.target = null;
      this.spare.push(d);
    }
    this.dogs.length = 0;
  }

  /** A gun went off (or a blast) at (x, z): every dog within `radius` runs from it. */
  startle(x: number, z: number, radius = SHOT_SCARE): void {
    for (const d of this.dogs) {
      if (d.mode === 'down' || len2(d.x - x, d.z - z) > radius) continue;
      if (d.mode !== 'flee') this.hooks.yelp(d);
      this.flee(d, x, z, FLEE_TIME);
    }
  }

  /** Knock over every dog within `radius` of (x, z) (a blast, a punch): down, then they bolt. */
  knock(x: number, z: number, radius: number): number {
    let n = 0;
    for (const d of this.dogs) {
      if (d.mode === 'down' || len2(d.x - x, d.z - z) > radius) continue;
      this.down(d, x, z);
      n++;
    }
    return n;
  }

  step(dt: number, w: DogWorld): void {
    for (const d of this.dogs) {
      d.calm = Math.max(0, d.calm - dt);
      this.hitByCar(d, w);
      switch (d.mode) {
        case 'down':
          d.speed = 0;
          if ((d.timer -= dt) <= 0) this.flee(d, d.x - d.awayX, d.z - d.awayZ, 2.5);
          break;
        case 'flee':
          this.move(d, d.awayX, d.awayZ, FLEE_SPEED, dt, w);
          if ((d.timer -= dt) <= 0) this.resume(d);
          break;
        case 'chase':
          this.chase(d, dt, w);
          break;
        case 'sniff':
          d.speed = 0;
          if ((d.timer -= dt) <= 0) d.mode = 'trot';
          this.spot(d, w);
          break;
        default:
          this.trot(d, dt, w);
          this.spot(d, w);
      }
      if (d.speed > 0) d.stride = (d.stride + (d.speed * dt) / STRIDE) % 1;
    }
  }

  // --- Internals ------------------------------------------------------------------

  /** Someone running past within sight: after them. */
  private spot(d: Dog, w: DogWorld): void {
    if (d.calm > 0) return;
    for (const r of w.runners) {
      const sp = len2(r.vx, r.vz);
      if (sp < RUN_SPEED || len2(r.x - d.x, r.z - d.z) > CHASE_SIGHT) continue;
      // Seen once per runner pass: a miss calms it for a moment.
      if (this.rand() > CHASE_CHANCE) {
        d.calm = 1.5;
        return;
      }
      d.mode = 'chase';
      d.target = r.ref;
      d.timer = CHASE_TIME;
      d.fromX = d.x;
      d.fromZ = d.z;
      d.barkIn = 0;
      return;
    }
  }

  private chase(d: Dog, dt: number, w: DogWorld): void {
    let t: DogRunner | null = null;
    for (const r of w.runners) {
      if (r.ref === d.target) {
        t = r;
        break;
      }
    }
    d.timer -= dt;
    if (!t || d.timer <= 0 || len2(d.x - d.fromX, d.z - d.fromZ) > CHASE_LEASH) {
      d.target = null;
      d.calm = CHASE_COOLDOWN;
      this.resume(d);
      return;
    }
    if ((d.barkIn -= dt) <= 0) {
      d.barkIn = BARK_EVERY * (0.8 + this.rand() * 0.5);
      this.hooks.bark(d);
    }
    const dx = t.x - d.x;
    const dz = t.z - d.z;
    const dist = len2(dx, dz);
    if (dist < HEEL) {
      // At their heels: keep pace, snapping.
      d.heading = Math.atan2(dx, dz);
      d.speed = Math.min(CHASE_SPEED, len2(t.vx, t.vz));
      d.x += t.vx * dt;
      d.z += t.vz * dt;
      return;
    }
    this.move(d, dx / dist, dz / dist, CHASE_SPEED, dt, w);
  }

  /** Round the block's pavement at a trot, now and then over the road to the next, or a sniff. */
  private trot(d: Dog, dt: number, w: DogWorld): void {
    const c = cornerPoint(d.bx, d.bz, d.corner, this.corner);
    // Off the walkers' line: shift toward the kerb or the wall (perpendicular to the way it's going).
    let dx = c.x - d.x;
    let dz = c.z - d.z;
    let dist = len2(dx, dz);
    if (dist > 2) {
      const px = -dz / dist;
      const pz = dx / dist;
      dx += px * d.lane;
      dz += pz * d.lane;
      dist = len2(dx, dz);
    }
    if (dist < 0.8) {
      this.arrive(d);
      return;
    }
    this.move(d, dx / dist, dz / dist, TROT, dt, w);
    if (this.rand() < SNIFF_RATE * dt) {
      d.mode = 'sniff';
      d.timer = SNIFF[0] + this.rand() * (SNIFF[1] - SNIFF[0]);
      d.speed = 0;
    }
  }

  /** At a corner: maybe over to the next block, else on round. */
  private arrive(d: Dog): void {
    const r = this.rand;
    if (r() < 0.25) {
      const horizontal = r() < 0.5;
      const c = d.corner;
      let nbx = d.bx;
      let nbz = d.bz;
      let nc: number;
      if (horizontal) {
        nbx += c === 1 || c === 2 ? 1 : -1;
        nc = [1, 0, 3, 2][c];
      } else {
        nbz += c === 2 || c === 3 ? 1 : -1;
        nc = [3, 2, 1, 0][c];
      }
      if (nbx >= 0 && nbx < BLOCKS_PER_SIDE && nbz >= 0 && nbz < BLOCKS_PER_SIDE) {
        d.bx = nbx;
        d.bz = nbz;
        d.corner = nc;
        return;
      }
    }
    d.corner = (d.corner + (d.clockwise ? 1 : 3)) & 3;
  }

  /** Step along unit (ux, uz) at `speed`, stopping short of walls. */
  private move(d: Dog, ux: number, uz: number, speed: number, dt: number, w: DogWorld): void {
    d.heading = Math.atan2(ux, uz);
    const nx = d.x + ux * speed * dt;
    const nz = d.z + uz * speed * dt;
    if (w.blocked(nx, nz, DOG_RADIUS)) {
      // Slide along whichever axis is clear.
      if (!w.blocked(nx, d.z, DOG_RADIUS)) d.x = nx;
      else if (!w.blocked(d.x, nz, DOG_RADIUS)) d.z = nz;
      d.speed = speed * 0.5;
      return;
    }
    d.x = nx;
    d.z = nz;
    d.speed = speed;
  }

  private hitByCar(d: Dog, w: DogWorld): void {
    if (d.mode === 'down') return;
    for (const c of w.cars) {
      const reach = c.reach + DOG_RADIUS;
      if (Math.abs(c.x - d.x) > reach || Math.abs(c.z - d.z) > reach) continue;
      const sp = len2(c.vx, c.vz);
      if (sp < CAR_KNOCK) continue;
      // In the car's footprint (its length along the way it's going, its width across).
      const rx = d.x - c.x;
      const rz = d.z - c.z;
      const along = (rx * c.vx + rz * c.vz) / sp;
      const across = (rx * c.vz - rz * c.vx) / sp;
      if (Math.abs(along) > reach || Math.abs(across) > c.half + DOG_RADIUS) continue;
      this.down(d, d.x - c.vx, d.z - c.vz);
      // Thrown clear along the car's way.
      d.x += (c.vx / sp) * 1.2;
      d.z += (c.vz / sp) * 1.2;
      return;
    }
  }

  private down(d: Dog, fromX: number, fromZ: number): void {
    const dx = d.x - fromX;
    const dz = d.z - fromZ;
    const dist = len2(dx, dz) || 1;
    d.mode = 'down';
    d.timer = DOWN_TIME[0] + this.rand() * (DOWN_TIME[1] - DOWN_TIME[0]);
    d.awayX = dx / dist;
    d.awayZ = dz / dist;
    d.target = null;
    d.speed = 0;
    this.hooks.yelp(d);
  }

  private flee(d: Dog, fromX: number, fromZ: number, seconds: number): void {
    const dx = d.x - fromX;
    const dz = d.z - fromZ;
    const dist = len2(dx, dz) || 1;
    d.mode = 'flee';
    d.timer = seconds;
    d.awayX = dx / dist;
    d.awayZ = dz / dist;
    d.target = null;
    d.calm = CHASE_COOLDOWN;
  }

  /** Back to the pavement loop: the nearest corner of whatever block it's beside. */
  private resume(d: Dog): void {
    const { bx, bz } = blockAt(d.x, d.z);
    d.bx = bx;
    d.bz = bz;
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < 4; c++) {
      const p = cornerPoint(bx, bz, c, this.corner);
      const dd = len2(p.x - d.x, p.z - d.z);
      if (dd < bestD) {
        bestD = dd;
        best = c;
      }
    }
    d.corner = best;
    d.mode = 'trot';
  }
}

function newDog(): Dog {
  return {
    x: 0,
    z: 0,
    heading: 0,
    speed: 0,
    mode: 'trot',
    timer: 0,
    bx: 0,
    bz: 0,
    corner: 0,
    clockwise: true,
    lane: 0,
    target: null,
    fromX: 0,
    fromZ: 0,
    awayX: 0,
    awayZ: 1,
    calm: 0,
    barkIn: 0,
    stride: 0,
    coat: 0,
  };
}
