/**
 * Pigeons: little flocks pecking about plazas, parks and pavements near the
 * player that scatter when a car comes through, someone runs at them, you
 * walk right up, or a gun goes off. Each bird takes off on its own beat,
 * flaps up and away from whatever spooked it, and dwindles out of sight;
 * new flocks settle somewhere out of view. Pure ambient life: nothing in
 * the game reacts to them. No three.js (render/pigeonMesh.ts draws them).
 */
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, type BlockKind, type Rect } from '../world/city';

export type PigeonState = 'ground' | 'fly';

export interface Pigeon {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Facing (sin h, cos h). */
  heading: number;
  state: PigeonState;
  /** Seconds until it takes off, once its flock is spooked (each its own beat). */
  delay: number;
  /** Wing beat phase, 0..1 (the Flap clip's time / its length). */
  flap: number;
  /** Wings spread 0 (folded, on the ground) .. 1 (flapping). */
  spread: number;
  /** Nose-down tilt, radians (pecking on the ground, diving or climbing in the air). */
  pitch: number;
  /** Seconds left in the current peck (it bobs down and up). */
  peck: number;
  /** Seconds until the next little walk or peck. */
  idle: number;
  /** Seconds in the air. */
  airborne: number;
  /** The height it levels off at, m. */
  cruise: number;
  /** Drawn size 0..1 (shrinks to nothing as it flies off). */
  scale: number;
}

export interface Flock {
  x: number;
  z: number;
  birds: Pigeon[];
  spooked: boolean;
}

/** Something that can spook a flock this step. */
export interface PigeonThreat {
  x: number;
  z: number;
  /** Ground speed, m/s. */
  speed: number;
  /** A car (wider reach than someone on foot). */
  car: boolean;
  /** The player (walking right up to them scares them too). */
  player: boolean;
}

export interface PigeonWorld {
  /** What the camera sees: flocks only settle (and vanish) outside it. */
  view: Rect;
  /** Centre of the action (the player or the camera). */
  x: number;
  z: number;
  threats: readonly PigeonThreat[];
}

/** Where pigeons like to be: open ground of parks and plazas, else pavement. */
export interface PigeonGround {
  kindAt(bx: number, bz: number): BlockKind;
  /** Is there something solid within `r` of (x, z) (a tree trunk, a wall)? */
  blocked(x: number, z: number, r: number): boolean;
}

// --- Tunables -------------------------------------------------------------
/** Flocks kept around the action, and birds per flock. */
export const MAX_FLOCKS = 3;
export const FLOCK_SIZE = [5, 9] as const;
/** New flocks settle this far from the action, m (and always out of view)... */
export const SETTLE_RANGE = [18, 48] as const;
/** ...and those left this far behind are dropped, m. */
export const FLOCK_DROP = 80;
/** A new flock may settle this often, s. */
const SETTLE_EVERY = 2.5;
/** Spooked by: a car faster than this within CAR_REACH; anyone running within RUN_REACH; the player within WALK_UP. */
const CAR_SPOOK_SPEED = 3;
const CAR_REACH = 8;
const RUN_SPOOK_SPEED = 3.2;
const RUN_REACH = 4.5;
const WALK_UP = 2.2;
/** Take-off: staggered over this long (s), up at CLIMB m/s to CRUISE m, away at FLY m/s. */
const TAKEOFF_SPREAD = 0.35;
const CLIMB = [3.2, 4.4] as const;
const CRUISE = [5.5, 9] as const;
const FLY = [5, 7.5] as const;
/** In the air this long they shrink out of sight over FADE seconds. */
const FLIGHT = 3.2;
const FADE = 0.7;
/** One wing beat (the Flap clip), s. */
export const FLAP_SECONDS = 0.25;
/** Pecking about: walking pace, m/s; how long a peck takes, s. */
const WALK = 0.45;
const PECK = 0.32;

const WALK_INSET = ROAD_WIDTH / 2 + SIDEWALK / 2;

export class Pigeons {
  readonly flocks: Flock[] = [];
  /** Birds no flock owns any more (flying off), until they've dwindled away. */
  readonly leaving: Pigeon[] = [];
  private settleIn = 0;
  private readonly spare: Pigeon[] = [];

  constructor(
    private readonly ground: PigeonGround,
    private readonly rand: () => number,
  ) {}

  /** Every bird alive (flock or leaving), for drawing. Fills `out` (cleared first). */
  collect(out: Pigeon[]): Pigeon[] {
    out.length = 0;
    for (const f of this.flocks) for (const b of f.birds) out.push(b);
    for (const b of this.leaving) out.push(b);
    return out;
  }

  /** Scare every flock within `radius` of (x, z) (a gunshot, a blast). */
  startle(x: number, z: number, radius: number): void {
    for (const f of this.flocks) {
      if (!f.spooked && Math.hypot(f.x - x, f.z - z) < radius) this.spook(f, x, z);
    }
  }

  /** Drop everything (a fresh run). */
  clear(): void {
    for (const f of this.flocks) for (const b of f.birds) this.spare.push(b);
    for (const b of this.leaving) this.spare.push(b);
    this.flocks.length = 0;
    this.leaving.length = 0;
    this.settleIn = 0;
  }

  step(dt: number, w: PigeonWorld): void {
    // Spooked by what comes close.
    for (const f of this.flocks) {
      if (f.spooked) continue;
      for (const t of w.threats) {
        const d = Math.hypot(t.x - f.x, t.z - f.z);
        const scared =
          (t.car && t.speed > CAR_SPOOK_SPEED && d < CAR_REACH) ||
          (!t.car && t.speed > RUN_SPOOK_SPEED && d < RUN_REACH) ||
          (t.player && d < WALK_UP);
        if (scared) {
          this.spook(f, t.x, t.z);
          break;
        }
      }
    }
    for (const f of this.flocks) for (const b of f.birds) this.stepBird(b, f, dt);
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const b = this.leaving[i];
      this.stepBird(b, null, dt);
      if (b.scale <= 0) {
        this.leaving.splice(i, 1);
        this.spare.push(b);
      }
    }
    // A spooked flock is gone once its last bird has taken off; far ones are dropped.
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const f = this.flocks[i];
      const far = Math.hypot(f.x - w.x, f.z - w.z) > FLOCK_DROP && !inRect(f.x, f.z, w.view, 4);
      if (f.spooked && allFlying(f)) {
        for (const b of f.birds) this.leaving.push(b);
        this.flocks.splice(i, 1);
      } else if (far) {
        for (const b of f.birds) this.spare.push(b);
        this.flocks.splice(i, 1);
      }
    }
    if ((this.settleIn -= dt) <= 0 && this.flocks.length < MAX_FLOCKS) {
      this.settleIn = SETTLE_EVERY;
      this.settle(w);
    }
  }

  private spook(f: Flock, fromX: number, fromZ: number): void {
    f.spooked = true;
    const r = this.rand;
    const away = Math.atan2(f.x - fromX, f.z - fromZ);
    for (const b of f.birds) {
      b.delay = r() * TAKEOFF_SPREAD;
      // Away from the scare, fanning out.
      const h = away + (r() * 2 - 1) * 0.9;
      const sp = FLY[0] + r() * (FLY[1] - FLY[0]);
      b.vx = Math.sin(h) * sp;
      b.vz = Math.cos(h) * sp;
      b.vy = CLIMB[0] + r() * (CLIMB[1] - CLIMB[0]);
      b.cruise = CRUISE[0] + r() * (CRUISE[1] - CRUISE[0]);
    }
  }

  private stepBird(b: Pigeon, f: Flock | null, dt: number): void {
    const r = this.rand;
    if (b.state === 'ground') {
      if (f?.spooked && (b.delay -= dt) <= 0) {
        b.state = 'fly';
        b.heading = Math.atan2(b.vx, b.vz);
        b.peck = 0;
        return;
      }
      // Pecking about: a few steps somewhere, a peck, a pause.
      b.peck = Math.max(0, b.peck - dt);
      b.pitch = b.peck > 0 ? 0.65 * Math.sin((1 - b.peck / PECK) * Math.PI) : 0;
      if ((b.idle -= dt) <= 0) {
        if (r() < 0.55) {
          b.peck = PECK;
          b.idle = 0.4 + r() * 1.2;
        } else {
          b.heading += (r() * 2 - 1) * 1.6;
          b.idle = 0.5 + r() * 1.5;
        }
      }
      const walking = b.idle > 0.4 && b.peck <= 0;
      const pace = walking ? WALK : 0;
      b.x += Math.sin(b.heading) * pace * dt;
      b.z += Math.cos(b.heading) * pace * dt;
      // Stay with the flock.
      if (f) {
        const dx = b.x - f.x;
        const dz = b.z - f.z;
        if (dx * dx + dz * dz > 6.25) b.heading = Math.atan2(-dx, -dz);
      }
      b.y = walking ? Math.abs(Math.sin(b.idle * 18)) * 0.03 : 0;
      b.spread = Math.max(0, b.spread - dt * 6);
      b.flap = (b.flap + dt / FLAP_SECONDS) % 1;
      return;
    }
    // Flying: climb to a cruising height, level off, flap, then dwindle away.
    b.airborne += dt;
    b.spread = Math.min(1, b.spread + dt * 10);
    if (b.y > b.cruise) b.vy += (0.3 - b.vy) * Math.min(1, dt * 2);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.heading = Math.atan2(b.vx, b.vz);
    b.pitch = -Math.atan2(b.vy, Math.hypot(b.vx, b.vz)) * 0.6;
    // Beat faster climbing out, then a little slower.
    b.flap = (b.flap + (dt / FLAP_SECONDS) * (b.vy > 1 ? 1.15 : 0.85)) % 1;
    if (b.airborne > FLIGHT) b.scale = Math.max(0, b.scale - dt / FADE);
  }

  /** A new flock somewhere near the action, out of view, on open ground or pavement. */
  private settle(w: PigeonWorld): void {
    const r = this.rand;
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = r() * Math.PI * 2;
      const d = SETTLE_RANGE[0] + r() * (SETTLE_RANGE[1] - SETTLE_RANGE[0]);
      const tx = w.x + Math.sin(a) * d;
      const tz = w.z + Math.cos(a) * d;
      const spot = this.spotNear(tx, tz);
      if (!spot || inRect(spot.x, spot.z, w.view, 4)) continue;
      if (this.flocks.some((f) => Math.hypot(f.x - spot.x, f.z - spot.z) < 15)) continue;
      const flock: Flock = { x: spot.x, z: spot.z, birds: [], spooked: false };
      const n = FLOCK_SIZE[0] + Math.floor(r() * (FLOCK_SIZE[1] - FLOCK_SIZE[0] + 1));
      for (let i = 0; i < n; i++) {
        const b = this.spare.pop() ?? newBird();
        const ox = (r() * 2 - 1) * (spot.open ? 2.2 : 1.6);
        const oz = (r() * 2 - 1) * (spot.open ? 2.2 : 0.5);
        // On pavement, strung out along the kerb.
        Object.assign(b, {
          x: spot.x + (spot.alongX ? ox : oz),
          y: 0,
          z: spot.z + (spot.alongX ? oz : ox),
          vx: 0,
          vy: 0,
          vz: 0,
          heading: r() * Math.PI * 2,
          state: 'ground',
          delay: 0,
          flap: r(),
          spread: 0,
          pitch: 0,
          peck: 0,
          idle: r() * 1.5,
          airborne: 0,
          cruise: CRUISE[0],
          scale: 1,
        } satisfies Pigeon);
        flock.birds.push(b);
      }
      this.flocks.push(flock);
      return;
    }
  }

  /**
   * Somewhere to land near (x, z): open ground inside a park or plaza, else
   * the kerb side of the pavement (clear of the walkers' line).
   */
  private spotNear(x: number, z: number): { x: number; z: number; open: boolean; alongX: boolean } | null {
    const bx = Math.floor((x + HALF_EXTENT) / BLOCK_SIZE);
    const bz = Math.floor((z + HALF_EXTENT) / BLOCK_SIZE);
    if (bx < 0 || bz < 0 || bx >= BLOCKS_PER_SIDE || bz >= BLOCKS_PER_SIDE) return null;
    const x0 = -HALF_EXTENT + bx * BLOCK_SIZE;
    const z0 = -HALF_EXTENT + bz * BLOCK_SIZE;
    if (this.ground.kindAt(bx, bz) !== 'buildings') {
      const inset = ROAD_WIDTH / 2 + SIDEWALK + 4;
      const px = Math.min(x0 + BLOCK_SIZE - inset, Math.max(x0 + inset, x));
      const pz = Math.min(z0 + BLOCK_SIZE - inset, Math.max(z0 + inset, z));
      return this.ground.blocked(px, pz, 2.5) ? null : { x: px, z: pz, open: true, alongX: true };
    }
    // The pavement edge nearest (x, z), on the kerb side of the walking line.
    const kerb = WALK_INSET - 0.9;
    const edges = [
      { x, z: z0 + kerb, alongX: true },
      { x, z: z0 + BLOCK_SIZE - kerb, alongX: true },
      { x: x0 + kerb, z, alongX: false },
      { x: x0 + BLOCK_SIZE - kerb, z, alongX: false },
    ];
    let best = edges[0];
    let bestD = Infinity;
    for (const e of edges) {
      const d = Math.abs(e.alongX ? e.z - z : e.x - x);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    // Not at a corner (crossings), and nothing solid there.
    const lo = WALK_INSET + 4;
    const hi = BLOCK_SIZE - WALK_INSET - 4;
    if (best.alongX) best.x = Math.min(x0 + hi, Math.max(x0 + lo, best.x));
    else best.z = Math.min(z0 + hi, Math.max(z0 + lo, best.z));
    return this.ground.blocked(best.x, best.z, 1.2) ? null : { x: best.x, z: best.z, open: false, alongX: best.alongX };
  }
}

function newBird(): Pigeon {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, state: 'ground', delay: 0, flap: 0, spread: 0, pitch: 0, peck: 0, idle: 0, airborne: 0, cruise: CRUISE[0], scale: 1 };
}

function allFlying(f: Flock): boolean {
  for (const b of f.birds) if (b.state !== 'fly') return false;
  return true;
}

function inRect(x: number, z: number, r: Rect, margin: number): boolean {
  return x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin;
}
