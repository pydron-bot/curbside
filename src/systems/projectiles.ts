/**
 * Things that fly: grenades (thrown in an arc, bounce, go off after a fuse),
 * molotovs (thrown, shatter on whatever they hit first into a patch of
 * burning fuel) and rockets (a slow, visible flight in a straight line that
 * blows up on the first thing it touches). Plus the fire patches molotovs
 * leave. Pure simulation in fixed pools (nothing allocated while playing);
 * the game resolves what explosions and fires do through ProjectileWorld,
 * the renderer reads the pools.
 */
import type { StaticGrid } from '../world/collision';

export type ProjectileKind = 'grenade' | 'molotov' | 'rocket';

export interface Projectile {
  kind: ProjectileKind;
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds since it was thrown or fired. */
  age: number;
  /** Grenades: seconds until it goes off. */
  fuse: number;
  /** Where a thrown one comes down first (for the landing marker), and its flight time. */
  landX: number;
  landZ: number;
  /** Rockets: metres flown. */
  flown: number;
  byPlayer: boolean;
  /** Spin for the renderer, radians. */
  spin: number;
}

export interface FirePatch {
  alive: boolean;
  x: number;
  z: number;
  radius: number;
  age: number;
  life: number;
  byPlayer: boolean;
}

/** What projectiles need from the game. */
export interface ProjectileWorld {
  grid: StaticGrid;
  /**
   * Does a rocket at (x, z) touch a car or a person (other than whoever fired
   * it)? Height is ignored: rockets fly at chest height.
   */
  rocketHits(x: number, z: number, radius: number, byPlayer: boolean): boolean;
  /** A thrown bottle at (x, z, y) touches a car body? */
  bottleHits(x: number, z: number, y: number): boolean;
  /** A grenade or rocket went off. */
  explode(kind: 'grenade' | 'rocket', x: number, z: number, byPlayer: boolean): void;
  /** A molotov burst into a fire patch. */
  ignite(x: number, z: number, byPlayer: boolean): void;
}

/** Gravity on thrown things, m/s² (a little heavy, so arcs read from above). */
export const THROW_GRAVITY = 20;
/** Hand height a throw leaves from, m. */
export const THROW_HEIGHT = 1.6;
/** Shortest throw, m (closer aims land here). */
export const MIN_THROW = 3;
/** A grenade goes off this long after the throw, s. */
export const GRENADE_FUSE = 2;
const GRENADE_RADIUS = 0.15;
const BOUNCE = 0.3;
const BOUNCE_FRICTION = 0.45;
const ROLL_FRICTION = 9;
/** Rockets: flight speed (m/s), the height they fly at (m) and hit radius (m). */
export const ROCKET_SPEED = 26;
export const ROCKET_HEIGHT = 1.2;
const ROCKET_RADIUS = 0.45;
/** Rockets that hit nothing go off at the end of their flight, m. */
export const MAX_ROCKET_FLIGHT = 75;
/** A molotov's fire: radius (m) and how long it burns (s). */
export const FIRE_RADIUS = 3.2;
export const FIRE_LIFE = 6;

const MAX_PROJECTILES = 24;
const MAX_FIRES = 8;

/** Launch velocity for a throw from (x, z) at hand height to land on (tx, tz); writes it into `out`. */
export function throwVelocity(
  x: number,
  z: number,
  tx: number,
  tz: number,
  out: { vx: number; vy: number; vz: number; time: number },
  g = THROW_GRAVITY,
  y0 = THROW_HEIGHT,
): void {
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz);
  // Longer throws loft higher: flight time grows with distance.
  const t = 0.45 + d * 0.03;
  out.time = t;
  out.vx = dx / t;
  out.vz = dz / t;
  out.vy = (-y0 + 0.5 * g * t * t) / t;
}

/**
 * Where a throw toward (aimX, aimZ) from (x, z) lands: the aim point,
 * clamped between MIN_THROW and `range` along the same line. Writes into out.
 */
export function throwTarget(x: number, z: number, aimX: number, aimZ: number, range: number, out: { x: number; z: number }): void {
  const dx = aimX - x;
  const dz = aimZ - z;
  const d = Math.hypot(dx, dz);
  const k = d < 1e-6 ? 0 : Math.min(range, Math.max(MIN_THROW, d)) / d;
  out.x = x + (d < 1e-6 ? 0 : dx * k);
  out.z = z + (d < 1e-6 ? MIN_THROW : dz * k);
}

const scratchPos = { x: 0, z: 0 };
const scratchThrow = { vx: 0, vy: 0, vz: 0, time: 0 };

export class Projectiles {
  readonly list: Projectile[] = [];
  readonly fires: FirePatch[] = [];

  constructor() {
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      this.list.push({ kind: 'grenade', alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, fuse: 0, landX: 0, landZ: 0, flown: 0, byPlayer: false, spin: 0 });
    }
    for (let i = 0; i < MAX_FIRES; i++) this.fires.push({ alive: false, x: 0, z: 0, radius: 0, age: 0, life: 0, byPlayer: false });
  }

  /** Throw a grenade or molotov from (x, z) to land on (tx, tz). */
  throw(kind: 'grenade' | 'molotov', x: number, z: number, tx: number, tz: number, byPlayer: boolean): Projectile | null {
    const p = this.take();
    if (!p) return null;
    throwVelocity(x, z, tx, tz, scratchThrow);
    this.reset(p, kind, x, THROW_HEIGHT, z, byPlayer);
    p.vx = scratchThrow.vx;
    p.vy = scratchThrow.vy;
    p.vz = scratchThrow.vz;
    p.fuse = GRENADE_FUSE;
    p.landX = tx;
    p.landZ = tz;
    return p;
  }

  /** Fire a rocket from (x, z) along unit (dx, dz). */
  fireRocket(x: number, z: number, dx: number, dz: number, byPlayer: boolean): Projectile | null {
    const p = this.take();
    if (!p) return null;
    this.reset(p, 'rocket', x, ROCKET_HEIGHT, z, byPlayer);
    p.vx = dx * ROCKET_SPEED;
    p.vz = dz * ROCKET_SPEED;
    return p;
  }

  /** Light a fire patch at (x, z) (also what a molotov does when it bursts). */
  addFire(x: number, z: number, byPlayer: boolean, radius = FIRE_RADIUS, life = FIRE_LIFE): FirePatch {
    let f = this.fires.find((q) => !q.alive);
    if (!f) {
      // Full: the oldest fire makes way.
      f = this.fires[0];
      for (const q of this.fires) if (q.age > f.age) f = q;
    }
    f.alive = true;
    f.x = x;
    f.z = z;
    f.radius = radius;
    f.age = 0;
    f.life = life;
    f.byPlayer = byPlayer;
    return f;
  }

  /** Any projectile in flight or fire burning? */
  get active(): boolean {
    for (const p of this.list) if (p.alive) return true;
    for (const f of this.fires) if (f.alive) return true;
    return false;
  }

  /** Drop everything (a fresh run, the title). */
  clear(): void {
    for (const p of this.list) p.alive = false;
    for (const f of this.fires) f.alive = false;
  }

  step(dt: number, world: ProjectileWorld): void {
    for (const p of this.list) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.kind === 'rocket') this.stepRocket(p, dt, world);
      else this.stepThrown(p, dt, world);
    }
    for (const f of this.fires) {
      if (!f.alive) continue;
      f.age += dt;
      if (f.age >= f.life) f.alive = false;
    }
  }

  private stepRocket(p: Projectile, dt: number, world: ProjectileWorld): void {
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.flown += ROCKET_SPEED * dt;
    p.spin += dt * 14;
    scratchPos.x = p.x;
    scratchPos.z = p.z;
    const wall = world.grid.resolveCircle(scratchPos, 0.2);
    if (wall || p.flown >= MAX_ROCKET_FLIGHT || world.rocketHits(p.x, p.z, ROCKET_RADIUS, p.byPlayer)) {
      p.alive = false;
      world.explode('rocket', p.x, p.z, p.byPlayer);
    }
  }

  private stepThrown(p: Projectile, dt: number, world: ProjectileWorld): void {
    const molotov = p.kind === 'molotov';
    p.vy -= THROW_GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    const airborne = p.y > GRENADE_RADIUS + 0.01 || p.vy > 0;
    p.spin += dt * (airborne ? 12 : Math.hypot(p.vx, p.vz) * 4);
    // Walls: a bottle shatters, a grenade bounces off.
    scratchPos.x = p.x;
    scratchPos.z = p.z;
    const wall = world.grid.resolveCircle(scratchPos, GRENADE_RADIUS);
    if (wall) {
      if (molotov) return this.burst(p, world);
      p.x = scratchPos.x;
      p.z = scratchPos.z;
      const vn = p.vx * wall.nx + p.vz * wall.nz;
      if (vn < 0) {
        p.vx -= (1 + BOUNCE) * vn * wall.nx;
        p.vz -= (1 + BOUNCE) * vn * wall.nz;
      }
    }
    if (molotov && world.bottleHits(p.x, p.z, p.y)) return this.burst(p, world);
    // The ground.
    if (p.y <= GRENADE_RADIUS) {
      if (molotov) return this.burst(p, world);
      p.y = GRENADE_RADIUS;
      if (p.vy < -1.5) {
        p.vy = -p.vy * BOUNCE;
        p.vx *= BOUNCE_FRICTION;
        p.vz *= BOUNCE_FRICTION;
      } else {
        // Rolling to a stop.
        p.vy = 0;
        const sp = Math.hypot(p.vx, p.vz);
        const k = sp > 1e-6 ? Math.max(0, sp - ROLL_FRICTION * dt) / sp : 0;
        p.vx *= k;
        p.vz *= k;
      }
    }
    if (!molotov && (p.fuse -= dt) <= 0) {
      p.alive = false;
      world.explode('grenade', p.x, p.z, p.byPlayer);
    }
  }

  private burst(p: Projectile, world: ProjectileWorld): void {
    p.alive = false;
    this.addFire(p.x, p.z, p.byPlayer);
    world.ignite(p.x, p.z, p.byPlayer);
  }

  private take(): Projectile | null {
    for (const p of this.list) if (!p.alive) return p;
    return null;
  }

  private reset(p: Projectile, kind: ProjectileKind, x: number, y: number, z: number, byPlayer: boolean): void {
    p.kind = kind;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = p.vy = p.vz = 0;
    p.age = 0;
    p.fuse = 0;
    p.landX = x;
    p.landZ = z;
    p.flown = 0;
    p.byPlayer = byPlayer;
    p.spin = 0;
  }
}
