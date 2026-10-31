/**
 * The destruction test's rubble physics: one Rapier world holding only rubble
 * chunks, static boxes for the buildings near breaches, a ground slab, and a
 * pool of kinematic proxies that mirror nearby cars. This module is the lazy
 * chunk (rubbleLoader.ts imports it on demand), so nothing here loads unless
 * the test is on. No three.js: poses go into a Float32Array the batch reads.
 *
 * One-way coupling by construction: proxies are kinematic (infinite mass), so
 * rubble never moves them, and nothing here writes to a Vehicle. A Rapier
 * error poisons the world (a Rust panic leaves it throwing on every call),
 * so every entry point is guarded and `failed` turns true for good; the owner
 * then drops to scars and particles.
 */
import * as RAPIER from '@dimforge/rapier3d';

type RawBodies = RAPIER.World['bodies']['raw'];
type RawPipeline = RAPIER.World['physicsPipeline']['raw'];
type RawVector = ReturnType<typeof RAPIER.VectorOps.intoRaw>;

/** rubblePlan's PROXY_IN (importing it would split a chunk shared with the main bundle). */
const PROXY_IN = 14;
/** A parked proxy is only moved once its car has gone this far (squared, m²) or turned this much (rad) from it. */
const MOVE_EPS2 = 1e-4;
const TURN_EPS = 0.004;

// Interaction groups: membership in the high 16 bits, filter in the low.
const G_STATIC = 0x1;
const G_RUBBLE = 0x2;
const G_CAR = 0x4;
const groups = (member: number, filter: number): number => ((member & 0xffff) << 16) | (filter & 0xffff);
const STATIC_GROUPS = groups(G_STATIC, G_RUBBLE);
const CHUNK_GROUPS = groups(G_RUBBLE, G_STATIC | G_RUBBLE | G_CAR);
const PROXY_GROUPS = groups(G_CAR, G_RUBBLE);
/** Chunk velocity caps while a car is pushing them, m/s (otherwise a 30 m/s hit flings them 100 m+). */
const MAX_HORIZONTAL = 12;
const MAX_UP = 6;

export function rapierVersion(): string {
  return RAPIER.version();
}

/** Grow wasm memory once now, so it never grows mid-play (it never shrinks either). */
export function reserve(): void {
  RAPIER.reserveMemory(4 << 20);
}

export interface RubbleConfig {
  /** Chunk slots (the batch's capacity). */
  capacity: number;
  /** Kinematic car proxies. */
  proxies: number;
  /** m/s², down. */
  gravity: number;
}

export class RubbleWorld {
  /** x y z qx qy qz qw per slot: the spawn pose, then refreshed for awake bodies after each step. */
  readonly pose: Float32Array;
  /** 1 while the slot holds a body. */
  readonly live: Uint8Array;
  /** 1 while the slot's body was awake after the last step. */
  readonly awakeFlag: Uint8Array;
  /** Slots holding a body. */
  private liveCount = 0;
  /** Awake chunks after the last step; with no proxy on, 0 means the step can be skipped. */
  awake = 0;
  failed = false;
  error: string | null = null;
  /** Building boxes registered. */
  statics = 0;
  /** Proxies enabled. */
  proxiesOn = 0;
  /**
   * Each proxy's car, written by the owner before setProxy(i): x y z yaw
   * (the car's pose, y at its wheels' contact), then its body box and its
   * cabin box, each half-extents x y z and centre height and offset along
   * the car (a cabin of half-height 0 is off). Through an array because V8
   * boxes each double passed to a call it doesn't inline.
   */
  readonly proxyIn: Float64Array;
  /** 1 for proxies that moved in a step since the owner last cleared it (forceSleep spares chunks near them). */
  readonly proxyStirred: Uint8Array;
  private readonly world: RAPIER.World;
  private readonly raw: RawBodies;
  // World.step's arguments, kept: it builds and frees a gravity RawVector (a wasm malloc and a FinalizationRegistry entry) every step.
  private readonly pipeline: RawPipeline;
  private readonly gravity: RawVector;
  private readonly stepArgs: [
    RAPIER.World['integrationParameters']['raw'],
    RAPIER.World['islands']['raw'],
    RAPIER.World['broadPhase']['raw'],
    RAPIER.World['narrowPhase']['raw'],
    RawBodies,
    RAPIER.World['colliders']['raw'],
    RAPIER.World['impulseJoints']['raw'],
    RAPIER.World['multibodyJoints']['raw'],
    RAPIER.World['ccdSolver']['raw'],
  ];
  private dt = 0;
  private readonly handle: Float64Array;
  /** Body handle → slot, for the active-island walk. */
  private readonly slotOf = new Map<number, number>();
  /** 1 for slots whose body was awake after the last step (readPoses). */
  private readonly active: Uint8Array;
  private readonly onActive = (h: number): void => {
    const slot = this.slotOf.get(h);
    if (slot !== undefined) this.active[slot] = 1;
  };
  private readonly buf = new Float32Array(4);
  private readonly proxyBody: RAPIER.RigidBody[] = [];
  /** Per proxy: the body box, then the cabin box. */
  private readonly proxyCol: RAPIER.Collider[] = [];
  private readonly proxyOn: Uint8Array;
  /**
   * Each proxy's pose as Rapier has it (x, y, z, yaw) and its car's latest.
   * A proxy only gets a kinematic target once its car has moved from it (a
   * parked car's sim wobbles by fractions of a millimetre, and any target
   * that moves wakes every chunk touching it: the pile would never sleep).
   */
  private readonly from: Float64Array;
  private readonly to: Float64Array;
  /** 1 for proxies swept in the current step. */
  private readonly moving: Uint8Array;
  private readonly staticKeys = new Map<number, number>();
  private readonly v = { x: 0, y: 0, z: 0 };
  private readonly q = { x: 0, y: 0, z: 0, w: 1 };

  constructor(cfg: RubbleConfig) {
    const world = new RAPIER.World({ x: 0, y: -cfg.gravity, z: 0 });
    this.world = world;
    this.raw = world.bodies.raw;
    this.pipeline = world.physicsPipeline.raw;
    this.gravity = RAPIER.VectorOps.intoRaw(world.gravity);
    this.stepArgs = [
      world.integrationParameters.raw,
      world.islands.raw,
      world.broadPhase.raw,
      world.narrowPhase.raw,
      world.bodies.raw,
      world.colliders.raw,
      world.impulseJoints.raw,
      world.multibodyJoints.raw,
      world.ccdSolver.raw,
    ];
    this.pose = new Float32Array(cfg.capacity * 7);
    this.live = new Uint8Array(cfg.capacity);
    this.awakeFlag = new Uint8Array(cfg.capacity);
    this.active = new Uint8Array(cfg.capacity);
    this.handle = new Float64Array(cfg.capacity);
    this.proxyIn = new Float64Array(cfg.proxies * PROXY_IN);
    this.proxyStirred = new Uint8Array(cfg.proxies);
    this.proxyOn = new Uint8Array(cfg.proxies);
    this.moving = new Uint8Array(cfg.proxies);
    this.from = new Float64Array(cfg.proxies * 4);
    this.to = new Float64Array(cfg.proxies * 4);
    // The ground: one slab under the whole city, top at y = 0.
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(700, 1, 700).setTranslation(0, -1, 0).setCollisionGroups(STATIC_GROUPS).setFriction(0.9));
    // Each car is two boxes, its body up to the hood line and its cabin, sized on assignment: a single
    // capsule stood 0.7 m proud of a sedan's hood and boot, and its round underside wedged chunks against the road.
    for (let i = 0; i < cfg.proxies; i++) {
      const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setEnabled(false).setSoftCcdPrediction(1));
      for (let k = 0; k < 2; k++) {
        const c = RAPIER.ColliderDesc.cuboid(0.9, 0.4, 2).setFriction(0).setRestitution(0).setCollisionGroups(PROXY_GROUPS);
        this.proxyCol.push(this.world.createCollider(c, b));
      }
      this.proxyBody.push(b);
    }
  }

  get capacity(): number {
    return this.live.length;
  }

  /** A chunk (cuboid of half-extents h) into `slot` (chosen by RubbleSlots). Allocates: per breach, not per frame. */
  spawnAt(
    slot: number,
    x: number,
    y: number,
    z: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    hx: number,
    hy: number,
    hz: number,
    vx: number,
    vy: number,
    vz: number,
    wx: number,
    wy: number,
    wz: number,
  ): boolean {
    if (this.failed || this.live[slot]) return false;
    try {
      const q = this.q;
      q.x = qx;
      q.y = qy;
      q.z = qz;
      q.w = qw;
      const v = this.v;
      v.x = wx;
      v.y = wy;
      v.z = wz;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(q).setLinvel(vx, vy, vz).setAngvel(v).setLinearDamping(0.3).setAngularDamping(0.8),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setDensity(2.4).setFriction(0.8).setRestitution(0.1).setCollisionGroups(CHUNK_GROUPS),
        body,
      );
      this.handle[slot] = body.handle;
      this.slotOf.set(body.handle, slot);
      this.live[slot] = 1;
      this.liveCount++;
      this.awakeFlag[slot] = 1;
      this.awake++;
      // Drawn straight away (hit-stop or a card may hold the first step back): never a stale pose.
      const p = slot * 7;
      this.pose[p] = x;
      this.pose[p + 1] = y;
      this.pose[p + 2] = z;
      this.pose[p + 3] = qx;
      this.pose[p + 4] = qy;
      this.pose[p + 5] = qz;
      this.pose[p + 6] = qw;
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  remove(slot: number): void {
    if (!this.live[slot]) return;
    // Clear first and never touch the handle again: a removed handle panics and poisons the world.
    this.live[slot] = 0;
    this.liveCount--;
    if (this.awakeFlag[slot]) this.awake--;
    this.awakeFlag[slot] = 0;
    this.slotOf.delete(this.handle[slot]);
    if (this.failed) return;
    try {
      this.world.removeRigidBody(this.world.getRigidBody(this.handle[slot]));
    } catch (e) {
      this.fail(e);
    }
  }

  /** A building as a static box (minX..maxX, 0..height, minZ..maxZ), keyed by building index; once per key. */
  addStaticBox(key: number, minX: number, minZ: number, maxX: number, maxZ: number, height: number): void {
    if (this.failed || this.staticKeys.has(key)) return;
    try {
      const hx = (maxX - minX) / 2;
      const hy = height / 2;
      const hz = (maxZ - minZ) / 2;
      const c = this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(minX + hx, hy, minZ + hz).setCollisionGroups(STATIC_GROUPS));
      this.staticKeys.set(key, c.handle);
      this.statics++;
    } catch (e) {
      this.fail(e);
    }
  }

  /**
   * Mirrors a car into proxy i from proxyIn: its body and cabin boxes at
   * (x, y, z) facing yaw (the game's heading). `assign` on the first frame
   * after (re)assignment or a jump in position: it is resized and teleported
   * rather than swept from its stale spot (a sweep would fling everything).
   */
  setProxy(i: number, assign: boolean): void {
    if (this.failed) return;
    const src = this.proxyIn;
    const p = i * PROXY_IN;
    const x = src[p];
    const y = src[p + 1];
    const z = src[p + 2];
    const yaw = src[p + 3];
    const k = i * 4;
    const to = this.to;
    to[k] = x;
    to[k + 1] = y;
    to[k + 2] = z;
    to[k + 3] = yaw;
    if (!assign && this.proxyOn[i]) return;
    try {
      const b = this.proxyBody[i];
      if (!this.proxyOn[i]) {
        this.proxyOn[i] = 1;
        this.proxiesOn++;
        b.setEnabled(true);
      }
      // These allocate; only on (re)assignment.
      for (let k = 0; k < 2; k++) {
        const c = this.proxyCol[i * 2 + k];
        const o = p + 4 + k * 5;
        const on = src[o + 1] > 0;
        c.setEnabled(on);
        if (!on) continue;
        c.setHalfExtents({ x: src[o], y: src[o + 1], z: src[o + 2] });
        c.setTranslationWrtParent({ x: 0, y: src[o + 3], z: src[o + 4] });
      }
      this.setPose(x, y, z, yaw);
      b.setTranslation(this.v, false);
      b.setRotation(this.q, false);
      const from = this.from;
      from[k] = x;
      from[k + 1] = y;
      from[k + 2] = z;
      from[k + 3] = yaw;
    } catch (e) {
      this.fail(e);
    }
  }

  parkProxy(i: number): void {
    if (!this.proxyOn[i]) return;
    this.proxyOn[i] = 0;
    this.proxiesOn--;
    if (this.failed) return;
    try {
      this.proxyBody[i].setEnabled(false);
    } catch (e) {
      this.fail(e);
    }
  }

  isProxyOn(i: number): boolean {
    return this.proxyOn[i] === 1;
  }

  /**
   * An enabled proxy's car is more than ~1 cm (or turned) from it. With
   * nothing awake and no proxy to move, a step changes nothing: skip it (a
   * car parked by a settled pile would otherwise step it for its whole life).
   */
  get proxyMoved(): boolean {
    for (let i = 0; i < this.proxyOn.length; i++) if (this.proxyOn[i] && this.carMoved(i)) return true;
    return false;
  }

  /** Proxy i's car is more than ~1 cm from it, or turned (0.004 rad swings a car's nose ~1 cm). */
  private carMoved(i: number): boolean {
    const from = this.from;
    const to = this.to;
    const k = i * 4;
    const dx = to[k] - from[k];
    const dy = to[k + 1] - from[k + 1];
    const dz = to[k + 2] - from[k + 2];
    if (dx * dx + dy * dy + dz * dz > MOVE_EPS2) return true;
    let dyaw = to[k + 3] - from[k + 3];
    dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
    return dyaw > TURN_EPS || dyaw < -TURN_EPS;
  }

  /** An enabled proxy that moved since proxyStirred was last cleared is within `r` m of (x, z). */
  stirredNear(x: number, z: number, r: number): boolean {
    const to = this.to;
    for (let i = 0; i < this.proxyOn.length; i++) {
      if (!this.proxyOn[i] || !this.proxyStirred[i]) continue;
      const dx = to[i * 4] - x;
      const dz = to[i * 4 + 2] - z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /**
   * One rubble step of `dt` in `substeps` (2 while a fast car is near), the
   * proxies moved along their path a share per substep; then the poses of
   * bodies that are awake, or fell asleep in this step. `clamp`: cap chunk
   * speeds (a car is pushing them).
   */
  step(dt: number, substeps: number, clamp: boolean): void {
    if (this.failed) return;
    try {
      const h = dt / substeps;
      // The setter boxes a double per call in V8: only when it changes.
      if (h !== this.dt) {
        this.dt = h;
        this.world.timestep = h;
      }
      const a = this.stepArgs;
      let moving = 0;
      for (let i = 0; i < this.proxyOn.length; i++) {
        const m = this.proxyOn[i] && this.carMoved(i) ? 1 : 0;
        this.moving[i] = m;
        if (m) this.proxyStirred[i] = 1;
        moving += m;
      }
      for (let s = 1; s <= substeps; s++) {
        if (moving > 0) this.moveProxies(s / substeps);
        // World.step without its per-step gravity vector (no event queue, no hooks).
        this.pipeline.step(this.gravity, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]);
      }
      const from = this.from;
      const to = this.to;
      for (let i = 0; i < this.moving.length; i++) {
        if (!this.moving[i]) continue;
        for (let k = i * 4; k < i * 4 + 4; k++) from[k] = to[k];
      }
      this.readPoses(clamp);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Put an awake chunk to sleep now (it has been tumbling too long with nothing near). */
  sleepSlot(slot: number): void {
    if (this.failed || !this.live[slot]) return;
    try {
      this.raw.rbSleep(this.handle[slot]);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Every chunk and building box gone, proxies parked (a fresh run, the test switched off). */
  clear(): void {
    for (let i = 0; i < this.live.length; i++) this.remove(i);
    for (let i = 0; i < this.proxyOn.length; i++) this.parkProxy(i);
    if (!this.failed) {
      try {
        for (const h of this.staticKeys.values()) this.world.removeCollider(this.world.getCollider(h), false);
      } catch (e) {
        this.fail(e);
      }
    }
    this.staticKeys.clear();
    this.statics = 0;
    this.awake = 0;
  }

  dispose(): void {
    this.live.fill(0);
    this.liveCount = 0;
    this.awakeFlag.fill(0);
    this.awake = 0;
    this.slotOf.clear();
    try {
      this.gravity.free();
      this.world.free();
    } catch {
      // Already broken.
    }
  }

  private setPose(x: number, y: number, z: number, yaw: number): void {
    const v = this.v;
    v.x = x;
    v.y = y;
    v.z = z;
    const q = this.q;
    q.x = 0;
    q.y = Math.sin(yaw / 2);
    q.z = 0;
    q.w = Math.cos(yaw / 2);
  }

  /** Each moving proxy's kinematic target: share `t` of the way from its pose to its car's. */
  private moveProxies(t: number): void {
    const from = this.from;
    const to = this.to;
    for (let i = 0; i < this.moving.length; i++) {
      if (!this.moving[i]) continue;
      const k = i * 4;
      let dyaw = to[k + 3] - from[k + 3];
      // The short way round.
      dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
      this.setPose(from[k] + (to[k] - from[k]) * t, from[k + 1] + (to[k + 1] - from[k + 1]) * t, from[k + 2] + (to[k + 2] - from[k + 2]) * t, from[k + 3] + dyaw * t);
      const b = this.proxyBody[i];
      b.setNextKinematicTranslation(this.v);
      b.setNextKinematicRotation(this.q);
    }
  }

  /**
   * Which bodies are awake: with few awake, Rapier's active islands (one
   * callback each, ~56 B in wasm-bindgen's glue), so a settled pile costs
   * nothing to read while a car pushes past it; with most awake (a fresh
   * breach), asking each live body (a boxed handle, 16 B). Then the poses of
   * the awake ones. What still allocates in V8, all bounded and gone once the
   * rubble sleeps and no car moves near it (the owner skips those steps):
   * every Rapier call taking a handle or a float boxes it (the pose reads
   * ~112 B per awake body per step, moving proxies ~6 calls per moving car
   * per substep), and Rapier's step reads performance.now() through
   * wasm-bindgen a few times. None expected in JSC (NaN-boxed). Reading the
   * wasm heap directly would be zero-garbage but depends on this binary's
   * struct layout.
   */
  private readPoses(clamp: boolean): void {
    const raw = this.raw;
    const buf = this.buf;
    const pose = this.pose;
    const live = this.live;
    const active = this.active;
    if (this.awake * 4 < this.liveCount) {
      active.fill(0);
      this.stepArgs[1].forEachActiveRigidBodyHandle(this.onActive);
    } else {
      for (let i = 0; i < live.length; i++) if (live[i]) active[i] = raw.rbIsSleeping(this.handle[i]) ? 0 : 1;
    }
    let awake = 0;
    for (let i = 0; i < live.length; i++) {
      if (!live[i]) continue;
      const on = active[i];
      // Bodies that fell asleep this step still get their last integration read.
      if (!on && !this.awakeFlag[i]) continue;
      this.awakeFlag[i] = on;
      if (on) awake++;
      const h = this.handle[i];
      const p = i * 7;
      raw.rbTranslation(h, buf);
      pose[p] = buf[0];
      pose[p + 1] = buf[1];
      pose[p + 2] = buf[2];
      raw.rbRotation(h, buf);
      pose[p + 3] = buf[0];
      pose[p + 4] = buf[1];
      pose[p + 5] = buf[2];
      pose[p + 6] = buf[3];
      if (clamp && on) this.clampSpeed(h);
    }
    this.awake = awake;
  }

  /** setLinvel allocates a RawVector: rare (only chunks a car is flinging). */
  private clampSpeed(h: number): void {
    const buf = this.buf;
    this.raw.rbLinvel(h, buf);
    const vx = buf[0];
    const vy = buf[1];
    const vz = buf[2];
    const hs = Math.sqrt(vx * vx + vz * vz);
    if (hs <= MAX_HORIZONTAL && vy <= MAX_UP) return;
    const k = hs > MAX_HORIZONTAL ? MAX_HORIZONTAL / hs : 1;
    const v = this.v;
    v.x = vx * k;
    v.y = vy > MAX_UP ? MAX_UP : vy;
    v.z = vz * k;
    this.world.getRigidBody(h).setLinvel(v, false);
  }

  private fail(e: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.error = e instanceof Error ? e.message : String(e);
    console.warn('Rubble physics failed; falling back to scars and particles', e);
    this.dispose();
  }
}

/**
 * Runs a throwaway world through every code path a breach uses (cuboids on
 * the ground, a building box and each other, sleeping, a car proxy of two
 * boxes assigned, swept through the pile, parked, then reassigned without a
 * cabin, the speed clamp, removal), so the
 * first real step isn't the 35–42 ms cold one: wasm functions compile lazily
 * on first call. `slice` yields between batches of steps (and may wait for a
 * pause). Returns the ms spent working, not waiting.
 */
export async function warmUp(slice: () => Promise<void>, gravity = 14): Promise<number> {
  let busy = 0;
  let t0 = performance.now();
  const w = new RubbleWorld({ capacity: 40, proxies: 1, gravity });
  try {
    w.addStaticBox(0, -10, -6, 10, -1, 8);
    for (let i = 0; i < 30; i++) {
      const a = i * 2.39996;
      w.spawnAt(i, Math.sin(a) * 2, 1 + (i % 5) * 0.5, -0.5 + (i % 3) * 0.6, 0, Math.sin(a / 2), 0, Math.cos(a / 2), 0.15, 0.08 + (i % 4) * 0.04, 0.2, Math.cos(a) * 3, 2, 2 + (i % 4), 3, -2, 1);
    }
    const car = w.proxyIn;
    car.set([-8, 0, 4, Math.PI / 2, 0.95, 0.52, 2.2, 0.42, 0, 0.8, 0.3, 1.1, 1.24, -0.2]);
    for (let s = 0; s < 120 && !w.failed; s++) {
      if (s > 60 && s < 100) {
        car[0] = -8 + (s - 60) * 0.5;
        car[2] = 4 - (s - 60) * 0.05;
      }
      // A van-like box with no cabin, reassigned.
      if (s === 110) car[9] = 0;
      if (s >= 60) w.setProxy(0, s === 60 || s === 110);
      w.step(1 / 60, s > 90 ? 2 : 1, s > 60);
      if (s === 30) w.sleepSlot(0);
      if (s === 100) for (let i = 0; i < 10; i++) w.remove(i);
      if (s % 10 === 9) {
        busy += performance.now() - t0;
        await slice();
        t0 = performance.now();
      }
    }
    w.parkProxy(0);
    w.clear();
    if (w.failed) throw new Error(w.error ?? 'rubble warm-up failed');
  } finally {
    w.dispose();
  }
  return busy + performance.now() - t0;
}
