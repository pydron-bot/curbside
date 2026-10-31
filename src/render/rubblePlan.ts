/**
 * The rubble's pure parts (no three.js, no Rapier), unit-tested: where each
 * chunk of a breach starts, how big it is and how it flies (seeded by the
 * breach, so the layout is the same everywhere even though the physics that
 * follows isn't); which mesh/physics slot each chunk lives in and when it
 * sinks away or is cleaned up; and the fixed-step clock rubble runs on.
 */
import type { Rect } from '../world/city';
import { mulberry32 } from '../world/random';
import type { StyleBudget } from './destructionStyle';
import { chunkCount } from './destructionStyle';

/** The breach fields a layout needs (the `breach` event has them all). */
export interface BreachSite {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  radius: number;
  strength: number;
  seed: number;
  /** Chunks start at least this far out of the face (past an awning under the crater), m. */
  clear?: number;
}

/**
 * Share of a breach's chunks that slump: they start in the crater's lower
 * half and barely leave the wall, so the pile lies at its foot; the rest
 * fly, most of them not far.
 */
export const SLUMP_SHARE = 0.6;

/** Chunk tones: the wall's own colour, bare concrete (or brick), scorched. */
export const TONE_WALL = 0;
export const TONE_CORE = 1;
export const TONE_SCORCHED = 2;

/** Most chunks one breach can plan (desktop's 36 plus headroom). */
export const MAX_PLANNED = 48;

/** A breach's chunks, struct-of-arrays and reused: start pose, half-extents, velocities, tone. */
export class ChunkPlan {
  count = 0;
  readonly px = new Float32Array(MAX_PLANNED);
  readonly py = new Float32Array(MAX_PLANNED);
  readonly pz = new Float32Array(MAX_PLANNED);
  readonly qx = new Float32Array(MAX_PLANNED);
  readonly qy = new Float32Array(MAX_PLANNED);
  readonly qz = new Float32Array(MAX_PLANNED);
  readonly qw = new Float32Array(MAX_PLANNED);
  readonly hx = new Float32Array(MAX_PLANNED);
  readonly hy = new Float32Array(MAX_PLANNED);
  readonly hz = new Float32Array(MAX_PLANNED);
  readonly vx = new Float32Array(MAX_PLANNED);
  readonly vy = new Float32Array(MAX_PLANNED);
  readonly vz = new Float32Array(MAX_PLANNED);
  readonly wx = new Float32Array(MAX_PLANNED);
  readonly wy = new Float32Array(MAX_PLANNED);
  readonly wz = new Float32Array(MAX_PLANNED);
  /** 0.35..0.85 brightness on the tone's colour. */
  readonly shade = new Float32Array(MAX_PLANNED);
  readonly tone = new Uint8Array(MAX_PLANNED);
}

/** Distance from (x, z) to the rect (0 inside). */
function rectDistance(r: Rect, x: number, z: number): number {
  const dx = x < r.minX ? r.minX - x : x > r.maxX ? x - r.maxX : 0;
  const dz = z < r.minZ ? r.minZ - z : z > r.maxZ ? z - r.maxZ : 0;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Lays out a breach's chunks for `style`: blocks, plates and shards on the
 * crater disc, pushed out of the facade by their half-diagonal (a chunk
 * spawned inside the building box would be ejected violently) and past
 * `clear`, above the ground. Most slump to the foot of the wall; the rest
 * fly outward harder for a stronger blast, the heavy ones low. A chunk that
 * would start within its half-diagonal of a `blockers` rect (the building
 * across a narrow alley) is dropped. Seeded by the breach: no Math.random.
 */
export function planChunks(b: BreachSite, style: StyleBudget, out: ChunkPlan, blockers: readonly Rect[] = []): ChunkPlan {
  out.count = 0;
  const n = Math.min(MAX_PLANNED, chunkCount(style, b.strength));
  if (n <= 0) return out;
  const rand = mulberry32(Math.floor(b.seed * 4294967296));
  const r = b.radius;
  const s = b.strength;
  const clear = b.clear ?? 0;
  // Along the face (horizontal tangent).
  const tx = -b.nz;
  const tz = b.nx;
  for (let i = 0; i < n; i++) {
    const span = style.halfMax - style.halfMin;
    let hx = style.halfMin + span * rand();
    let hy = style.halfMin + span * rand();
    let hz = style.halfMin + span * rand();
    const shape = rand();
    if (shape < style.slabShare) hy *= 0.4;
    else if (shape < style.slabShare + style.shardShare) {
      // A shard: long one way, thin the others.
      const long = Math.min(1.3 * style.halfMax, 1.5 * (hx > hz ? hx : hz));
      if (rand() < 0.5) {
        hx = long;
        hz *= 0.5;
      } else {
        hz = long;
        hx *= 0.5;
      }
      hy *= 0.55;
    }
    const diag = Math.sqrt(hx * hx + hy * hy + hz * hz);
    const slump = rand() < SLUMP_SHARE;
    const du = (rand() * 2 - 1) * 0.75 * r;
    const dy = slump ? -(0.2 + 0.6 * rand()) * 0.85 * r : (rand() * 2 - 1) * 0.6 * r;
    const push = clear + diag + 0.05 + rand() * 0.3;
    const x = b.x + tx * du + b.nx * push;
    const z = b.z + tz * du + b.nz * push;
    const y = Math.max(diag + 0.02, b.y + dy);
    // Random orientation (uniform quaternion).
    const u1 = rand();
    const u2 = rand() * Math.PI * 2;
    const u3 = rand() * Math.PI * 2;
    const a = Math.sqrt(1 - u1);
    const c = Math.sqrt(u1);
    // Slumpers barely leave the wall; of the rest most drop near it and a few fly well out (squared: skewed slow).
    // Heavy chunks (the phone style's) fly slower and hardly hop: they land on the pavement, not round the player.
    const heavy = diag > 0.3;
    const k = rand();
    const out_ = slump ? (0.5 + 0.5 * s) * (0.1 + 0.4 * k) : (1 + 7 * s) * (0.15 + 1.05 * k * k) * (heavy ? 0.6 : 1);
    const side = (rand() * 2 - 1) * (slump ? 0.4 : heavy ? 1.5 : 2.5);
    const up = slump ? 0.1 + 0.4 * rand() : heavy ? 0.5 + 1.5 * rand() : 1 + 3 * rand();
    const spin = slump ? 2 : 6;
    const wx = (rand() * 2 - 1) * spin;
    const wy = (rand() * 2 - 1) * spin;
    const wz = (rand() * 2 - 1) * spin;
    const tone = rand();
    // Darker than the wall: lit from the open sky, a pale chunk outshone everything on the street at night.
    const shade = 0.35 + 0.5 * rand();
    let blocked = false;
    for (let k = 0; k < blockers.length; k++) {
      if (rectDistance(blockers[k], x, z) < diag + 0.05) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    const j = out.count++;
    out.px[j] = x;
    out.py[j] = y;
    out.pz[j] = z;
    out.qx[j] = a * Math.sin(u2);
    out.qy[j] = a * Math.cos(u2);
    out.qz[j] = c * Math.sin(u3);
    out.qw[j] = c * Math.cos(u3);
    out.hx[j] = hx;
    out.hy[j] = hy;
    out.hz[j] = hz;
    out.vx[j] = b.nx * out_ + tx * side;
    out.vy[j] = up;
    out.vz[j] = b.nz * out_ + tz * side;
    out.wx[j] = wx;
    out.wy[j] = wy;
    out.wz[j] = wz;
    out.shade[j] = shade;
    // Born close to the blast, or caught by the fireball: blackened.
    const scorched = du * du + dy * dy < 0.16 * r * r || tone < style.scorchShare;
    out.tone[j] = scorched ? TONE_SCORCHED : tone < style.scorchShare + style.coreShare ? TONE_CORE : TONE_WALL;
  }
  return out;
}

/**
 * Numbers per car proxy in RubbleWorld.proxyIn: x y z yaw, then the body
 * box and the cabin box, each half-extents x y z and centre height and
 * offset along the car (PROXY_BODY and PROXY_CABIN are where they start).
 */
export const PROXY_IN = 14;
export const PROXY_BODY = 4;
export const PROXY_CABIN = 9;

export const FREE = 0;
export const LIVE = 1;
export const SINKING = 2;

/** An evicted chunk (or one with no sink time of its own) sinks this long, s. */
export const EVICT_SINK = 0.6;

/** The lifetime knobs a claim takes from the style. */
export interface SlotBudget {
  maxLive: number;
  life: number;
  sink: number;
}

/**
 * Rubble slots (shared by the instance buffer and the physics world). A slot
 * is FREE, LIVE (has a body) or SINKING (body gone, pose frozen, the instance
 * slides into the pavement). Ages run on the rubble clock, so pause and
 * cards don't age rubble. Nothing pops out of existence on screen: evicted
 * chunks sink, and a chunk past its life with no sink time (desktop) is only
 * removed once out of view.
 */
export class RubbleSlots {
  readonly state: Uint8Array;
  /** Rubble-clock time the chunk spawned / started sinking, s. */
  readonly born: Float64Array;
  readonly sinkAt: Float64Array;
  readonly life: Float64Array;
  /** Sink time at end of life (0 = remove out of view); and of the sink in progress. */
  readonly sinkTime: Float64Array;
  readonly sinkDur: Float64Array;
  /** 1 while the slot was in the last view (the presenter writes it). */
  readonly seen: Uint8Array;
  live = 0;
  sinking = 0;

  /** `onRemove(slot)` is called whenever a LIVE slot loses its body (evicted, expired, cleared). */
  constructor(
    readonly capacity: number,
    private readonly onRemove: (slot: number) => void,
  ) {
    this.state = new Uint8Array(capacity);
    this.born = new Float64Array(capacity);
    this.sinkAt = new Float64Array(capacity);
    this.life = new Float64Array(capacity);
    this.sinkTime = new Float64Array(capacity);
    this.sinkDur = new Float64Array(capacity);
    this.seen = new Uint8Array(capacity);
  }

  /**
   * Claims up to `k` slots for a new breach's chunks (written to `out`; the
   * count is returned), first evicting LIVE chunks (the oldest off-screen,
   * then the oldest) so live + k stays within `b.maxLive`. Already over it
   * (the style dropped: a desktop pile meets a phone breach), at most `k`
   * go, so the old pile thins out breach by breach rather than crumbling
   * all at once. With no FREE slot left, the most-sunk SINKING slot is
   * reclaimed.
   */
  claim(k: number, b: SlotBudget, now: number, out: Int32Array): number {
    k = Math.min(k, b.maxLive, out.length);
    let evict = Math.min(this.live + k - b.maxLive, k);
    while (this.live > 0 && evict-- > 0) this.startSink(this.victim(), now, EVICT_SINK);
    let n = 0;
    while (n < k) {
      const i = this.freeSlot(now);
      if (i < 0) break;
      this.state[i] = LIVE;
      this.born[i] = now;
      this.life[i] = b.life;
      this.sinkTime[i] = b.sink;
      this.seen[i] = 1;
      this.live++;
      out[n++] = i;
    }
    return n;
  }

  /** Gives a claimed slot back unused (its body failed to spawn). */
  release(i: number): void {
    if (this.state[i] !== LIVE) return;
    this.state[i] = FREE;
    this.live--;
  }

  /** Every LIVE slot starts sinking now (physics failed: nothing may pop). */
  sinkAll(now: number): void {
    for (let i = 0; i < this.capacity; i++) if (this.state[i] === LIVE) this.startSink(i, now, EVICT_SINK);
  }

  /** Lifetimes: a LIVE chunk past its life sinks (or, with no sink time, goes once out of view); a sunk one is freed. */
  tick(now: number): void {
    for (let i = 0; i < this.capacity; i++) {
      const st = this.state[i];
      if (st === LIVE) {
        if (now - this.born[i] < this.life[i]) continue;
        if (this.sinkTime[i] > 0) this.startSink(i, now, this.sinkTime[i]);
        else if (!this.seen[i]) {
          this.onRemove(i);
          this.state[i] = FREE;
          this.live--;
        }
      } else if (st === SINKING && now - this.sinkAt[i] >= this.sinkDur[i]) {
        this.state[i] = FREE;
        this.sinking--;
      }
    }
  }

  /** 0..1 of the way into the pavement (0 for a LIVE slot). */
  sunk(i: number, now: number): number {
    if (this.state[i] !== SINKING) return 0;
    const t = (now - this.sinkAt[i]) / this.sinkDur[i];
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /** Everything gone (a fresh run, the test switched off): bodies removed first. */
  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.state[i] === LIVE) this.onRemove(i);
      this.state[i] = FREE;
    }
    this.live = 0;
    this.sinking = 0;
  }

  private startSink(i: number, now: number, dur: number): void {
    this.onRemove(i);
    this.state[i] = SINKING;
    this.sinkAt[i] = now;
    this.sinkDur[i] = dur > 0 ? dur : EVICT_SINK;
    this.live--;
    this.sinking++;
  }

  /** The LIVE slot to evict: the oldest off-screen one, else the oldest. */
  private victim(): number {
    let off = -1;
    let any = -1;
    for (let i = 0; i < this.capacity; i++) {
      if (this.state[i] !== LIVE) continue;
      if (any < 0 || this.born[i] < this.born[any]) any = i;
      if (!this.seen[i] && (off < 0 || this.born[i] < this.born[off])) off = i;
    }
    return off >= 0 ? off : any;
  }

  /** A FREE slot, else the most-sunk SINKING one (reclaimed), else -1. */
  private freeSlot(now: number): number {
    let best = -1;
    let bestSunk = -1;
    for (let i = 0; i < this.capacity; i++) {
      const st = this.state[i];
      if (st === FREE) return i;
      if (st === SINKING) {
        const s = this.sunk(i, now);
        if (s > bestSunk) {
          best = i;
          bestSunk = s;
        }
      }
    }
    if (best >= 0) {
      this.state[best] = FREE;
      this.sinking--;
    }
    return best;
  }
}

/**
 * Rubble's fixed-step clock: sim-scaled seconds in, whole 1/60 steps out,
 * at most `maxSteps` a frame (a stall's backlog is dropped, not caught up).
 * Pause, cards (sim scale 0) give no steps; hit-stop's slow sim accumulates
 * across frames into an occasional step.
 */
export class RubbleClock {
  private acc = 0;
  /** Rubble time stepped so far, s. */
  time = 0;

  constructor(
    readonly step = 1 / 60,
    readonly maxSteps = 2,
  ) {}

  /** Steps to run for `simDt` seconds of sim time. */
  advance(simDt: number): number {
    if (!(simDt > 0)) return 0;
    this.acc += simDt;
    let n = Math.floor(this.acc / this.step + 1e-6);
    if (n > this.maxSteps) {
      n = this.maxSteps;
      this.acc = 0;
    } else {
      this.acc -= n * this.step;
      if (this.acc < 0) this.acc = 0;
    }
    this.time += n * this.step;
    return n;
  }

  reset(): void {
    this.acc = 0;
  }
}
