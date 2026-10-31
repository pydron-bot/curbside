/**
 * The destruction test, presentation side: listens for `breach` events (the
 * simulation decides where and how big, systems/breaches.ts) and shows them
 * in the style 'auto' picks for the live tier (desktop, or scar-only on
 * 'low') or the forced mode's: dust, Rapier rubble chunks (one instanced
 * batch), or debris chips where there is no physics. Rubble is
 * presentation only: cars push it (kinematic proxies), it never pushes
 * anything back, and nothing here writes to the simulation.
 *
 * The crater itself is drawn by the building shader (breachScars.ts): written
 * for every breach, near or far, and kept for the run.
 *
 * Rapier loads lazily (rubbleLoader.ts): at boot when the test is on, or when
 * it is switched on (on the paused Diagnostics sheet), never at a breach. A
 * breach before it is ready, or after it failed, gets the 'low' look.
 *
 * Rubble runs on its own fixed 1/60 clock fed with sim-scaled time (so pause,
 * cards and hit-stop freeze it too), at most two steps a frame.
 */
import { Color, type Scene } from 'three';
import type { EventBus, EventOf } from '../core/events';
import { onSettingsChange, settings, updateSettings, type DestructionMode } from '../core/settings';
import { TimingRing, emptyTiming, type TimingSummary } from '../core/timingRing';
import type { VehicleArchetype } from '../entities/vehicle';
import type { Vehicle } from '../game/population';
import type { BlastKind } from '../systems/damage';
import type { Breaches } from '../systems/breaches';
import { bodyOf } from '../systems/physics';
import { AWNING_DEPTH } from '../world/buildingPlans';
import type { Rect } from '../world/city';
import { wallColour } from '../world/cityMesh';
import {
  RUBBLE_CAPACITY,
  STYLE,
  chipCount,
  destructionFromUrl,
  needsPhysics,
  resolveStyle,
  type DestructionStyle,
  type StyleBudget,
} from './destructionStyle';
import { BreachScars } from './breachScars';
import type { Effects, Rgb } from './effects';
import { getQuality, onQualityChange, preferredTier } from './quality';
import { worldUniforms } from './shaderLib';
import { RubbleBatch, type RubbleSource } from './rubbleBatch';
import { loadRubblePhysics, rapier, type RapierState } from './rubbleLoader';
import type { RubbleWorld } from './rubblePhysics';
import { ChunkPlan, LIVE, PROXY_BODY, PROXY_CABIN, PROXY_IN, RubbleClock, RubbleSlots, SINKING, TONE_CORE, TONE_SCORCHED, planChunks } from './rubblePlan';
import type { CarDims } from './vehicleModels';

export type { RapierState } from './rubbleLoader';

/** Rubble gravity, m/s²: snappier than 9.81 seen from a 20–60 m camera (the debris chips use 24). */
const GRAVITY = 14;
/** Kinematic car proxies in the world (the most any style uses). */
const PROXIES = 6;
/** Cars this close to a live rubble site get a proxy, m. */
const PROXY_RANGE = 14;
/** Cars higher than this (a jump) don't touch rubble, m. */
const PROXY_MAX_Y = 1.5;
/** A proxy whose car moved further than this since the last step is teleported, not swept, m. */
const PROXY_JUMP = 5;
/**
 * A car proxy's body box reaches this far down, m: into the road, so no
 * chunk ends up between it and the ground (one wedged under a raised floor
 * never slept, and was squeezed down through the road).
 */
const PROXY_FLOOR = -0.1;
/** forceSleep spares chunks this close to a car that is moving, m. */
const STIR_RANGE = 6;
/** A car this fast near rubble gets two substeps a step, m/s. */
const FAST_PROXY = 20;
/**
 * Buildings this close to a breach become static boxes in the rubble world,
 * m. They stay until a fresh run or the test goes off: a long session
 * blowing walls across the city grows the set, bounded by the city's 1404
 * buildings (13 after a 92-breach barrage in one neighbourhood).
 */
const STATICS_RANGE = 16;
/** Breaches waiting to spawn their chunks (one spawns per frame; the oldest drops). */
const PENDING = 8;
/** Rubble sites (one per breach with live chunks) tracked for proxies. */
const SITES = 32;
/** A breach this far outside the last view throws no rubble or dust, m. */
const FAR_CUT = 20;
/** Chunks within the view plus this are drawn (their shadows reach in), m. */
const DRAW_MARGIN = 4;
/** Lifetimes are checked this often on the rubble clock, s. */
const TICK = 0.25;

/** A breach far off the map, for warmSpawn. */
const WARM_SITE = { x: 900, y: 1.2, z: 900, nx: 0, nz: 1, radius: 1.5, strength: 1, seed: 0.5, clear: 0 };

const CONCRETE = new Color('#8a867f');
const BRICK = new Color('#8c4a3a');
const DUST = 0.55;

export interface DestructionStats {
  mode: DestructionMode;
  source: 'setting' | 'url';
  /** What a breach right now would get (after any fallback). */
  style: DestructionStyle;
  rapier: RapierState;
  /** Rapier's download, import (from cache, behind a pause) and warm-up, ms. */
  loadMs: number;
  evalMs: number;
  warmMs: number;
  error: string | null;
  version: string | null;
  live: number;
  awake: number;
  sinking: number;
  drawn: number;
  proxies: number;
  statics: number;
  /** Craters drawn on the facades now (the newest scarCap of the run's). */
  scars: number;
  scarCap: number;
  /** Breaches shown this session. */
  breaches: number;
  /** Physics time per stepped frame (steps with their proxy moves, pose reads), ms. */
  stepAvg: number;
  stepP95: number;
  stepMax: number;
  /** Worst and p95 per-second average (read these when the timer is coarse), ms. */
  secAvgMax: number;
  secAvgP95: number;
  /** Stepped frames timed. */
  steps: number;
  /** Slowest and latest breach spawn (plan, statics, bodies), ms. */
  spawnMaxMs: number;
  spawnLastMs: number;
  timerMs: number;
}

export interface DestructionDeps {
  bus: EventBus;
  scene: Scene;
  effects: Effects;
  /** The sim's craters: buildings, static grid and building index come from it; reset when the test goes off. */
  breaches: Breaches;
  vehicles: readonly Vehicle[];
  playerCar(): Vehicle | null;
  /** DynamicResolution.holdOff: Rapier's load and warm-up must not count as slow frames. */
  holdOff(seconds: number): void;
  /** Look.setBreaches: the craters' building-shader variant on or off. */
  setBreaches(on: boolean): void;
  /** main's warmShaders, timed, then a redraw behind the pause card (the test switched on or off mid-session). */
  warmShaders(): void;
  /**
   * True while nobody is playing (paused, or behind the title): Rapier's
   * warm-up and the rubble world's creation wait for it, so resuming before
   * the download finishes never puts them mid-play.
   */
  quiet(): boolean;
  /** Diagnostics session events (optional). */
  log?(kind: string, detail?: string): void;
  /** Look.contactShadows: seats the phone style's chunks, which cast no sun shadow. */
  contactShadows?: { addFrom(src: Float32Array, o: number): void };
  /** A car model's size and top silhouette (vehicles.glb), for its rubble proxy; undefined before the models load. */
  carDims?(archetype: VehicleArchetype): CarDims | undefined;
}

type PhysicsModule = NonNullable<Awaited<ReturnType<typeof loadRubblePhysics>>>;

export class Destruction {
  readonly batch = new RubbleBatch(RUBBLE_CAPACITY);
  /** The craters' shader slots. */
  readonly scars = new BreachScars();
  private readonly slots: RubbleSlots;
  private readonly clock = new RubbleClock();
  private readonly timing = new TimingRing(600, 120);
  private readonly timingOut = emptyTiming();
  private world: RubbleWorld | null = null;
  private module: PhysicsModule | null = null;
  /** The pose array of the world chunks were last spawned in (kept after a failure, so sinking chunks still draw). */
  private pose: Float32Array | null = null;
  private ready: Promise<RapierState> | null = null;
  private urlMode: DestructionMode | null;
  private lastMode: DestructionMode;
  private runtimeError: string | null = null;
  private breachCount = 0;
  private spawnMaxMs = 0;
  private spawnLastMs = 0;
  private drawn = 0;
  private tickAt = 0;
  /** The budget of the latest breach that threw bodies (proxy count). */
  private bodies: StyleBudget = STYLE.phone;
  /** The style 'auto' resolved to at the last tier change (scars follow it). */
  private autoStyle: DestructionStyle;
  /** 1 for slots holding a desktop-style chunk: the batch casts sun shadows while any is alive. */
  private readonly deskBorn = new Uint8Array(RUBBLE_CAPACITY);
  /**
   * Bumped whenever what the batch draws may have changed (a spawn, a step,
   * a slot changing state); draw() re-uploads only then, so a settled pile
   * costs no upload.
   */
  private gen = 1;
  private drawnGen = 0;
  // Per slot: full extents (sx sy sz), colour, end-of-life fade, rubble site.
  private readonly size = new Float32Array(RUBBLE_CAPACITY * 3);
  private readonly colour = new Float32Array(RUBBLE_CAPACITY * 3);
  private readonly fade = new Float32Array(RUBBLE_CAPACITY);
  /** What the batch draws from (the pose array is the world's). */
  private readonly src: RubbleSource = { pose: new Float32Array(0), size: this.size, colour: this.colour, fade: this.fade };
  /** One contact pool's numbers for contactShadows.addFrom. */
  private readonly pool = new Float32Array(7);
  private readonly site = new Int16Array(RUBBLE_CAPACITY).fill(-1);
  // Rubble sites: where each breach's chunks came from, and how many are alive.
  private readonly siteX = new Float32Array(SITES);
  private readonly siteZ = new Float32Array(SITES);
  private readonly siteLive = new Int16Array(SITES);
  private nextSite = 0;
  // Breaches waiting to spawn (ring): x y z nx nz radius strength seed building style(1 phone, 2 desktop).
  private readonly pend = new Float64Array(PENDING * 10);
  private pendHead = 0;
  private pendCount = 0;
  private readonly plan = new ChunkPlan();
  private readonly planSite = { x: 0, y: 0, z: 0, nx: 0, nz: 0, radius: 0, strength: 0, seed: 0, clear: 0 };
  private readonly claimed = new Int32Array(64);
  private readonly blockers: Rect[] = [];
  // Proxies: the car each mirrors, and where it was last put.
  private readonly proxyCar: Array<Vehicle | null> = new Array<Vehicle | null>(PROXIES).fill(null);
  private readonly proxyX = new Float32Array(PROXIES);
  private readonly proxyZ = new Float32Array(PROXIES);
  private readonly candidate: Array<Vehicle | null> = new Array<Vehicle | null>(PROXIES).fill(null);
  private readonly candidateKey = new Float32Array(PROXIES);
  private readonly best = new Float64Array(1);
  private fastProxy = false;
  private readonly lastView: Rect = { minX: -Infinity, minZ: -Infinity, maxX: Infinity, maxZ: Infinity };
  private readonly tmp = new Color();
  /** The latest breach shown (tests aim the camera and crop screenshots with it). */
  readonly lastBreach = { x: 0, y: 0, z: 0, set: false };

  constructor(private readonly d: DestructionDeps) {
    this.urlMode = destructionFromUrl(typeof location !== 'undefined' ? location.search : '');
    this.lastMode = this.mode;
    this.slots = new RubbleSlots(RUBBLE_CAPACITY, (i) => this.removeBody(i));
    d.scene.add(this.batch.mesh);
    // Before the first frame, so the boot warm-up compiles the variant the city will draw with.
    d.setBreaches(this.lastMode !== 'off');
    d.bus.on('breach', (e) => this.onBreach(e));
    onSettingsChange(() => {
      const m = this.mode;
      if (m !== this.lastMode) this.modeChanged(this.lastMode, m);
      // Any settings change (a quality preset too) may now want physics.
      this.preload();
    });
    this.autoStyle = resolveStyle('auto', getQuality().name);
    // 'auto' follows the live tier: DynamicResolution stepping down to 'low' (or back up) restyles the
    // scars already on the walls; 'medium' ↔ 'high' is desktop either way and changes nothing.
    onQualityChange((tier) => {
      const style = resolveStyle('auto', tier.name);
      if (style === this.autoStyle) return;
      this.autoStyle = style;
      if (this.mode === 'auto') this.restyleScars(style);
    });
  }

  /** The effective mode: ?destruction for this session, else the setting. */
  get mode(): DestructionMode {
    return this.urlMode ?? settings.destruction;
  }

  /** Switch the test (the Diagnostics pads): saved, and the URL override is dropped. */
  setMode(m: DestructionMode): void {
    const before = this.mode;
    this.urlMode = null;
    if (settings.destruction !== m) updateSettings({ destruction: m });
    else if (before !== m) {
      this.modeChanged(before, m);
      this.preload();
    }
  }

  /** Loads Rapier if the mode, on the player's preferred tier, throws bodies. Idempotent; never at a breach. */
  preload(): void {
    if (this.ready || !needsPhysics(resolveStyle(this.mode, preferredTier()))) return;
    // The load, the cold first step and the warm-up all happen behind the title or the pause card.
    this.d.holdOff(3);
    this.ready = loadRubblePhysics(this.whenQuiet).then((m) => {
      if (m) {
        this.module = m;
        this.ensureWorld();
        this.d.log?.('rapier', `ready ${Math.round(rapier.loadMs)}+${Math.round(rapier.evalMs)}+${Math.round(rapier.warmMs)} ms`);
      } else this.d.log?.('rapier', `failed ${rapier.error ?? ''}`);
      this.d.holdOff(2);
      return this.rapierState;
    });
  }

  /** Resolves on the first check (every 100 ms) that finds nobody playing; DynamicResolution ignores what follows. */
  private readonly whenQuiet = (): Promise<void> =>
    new Promise((resolve) => {
      const check = () => {
        if (this.d.quiet()) {
          this.d.holdOff(2);
          resolve();
        } else setTimeout(check, 100);
      };
      check();
    });

  /** Resolves once loading settles; 'idle' when nothing needs to load. */
  whenReady(): Promise<RapierState> {
    return this.ready ?? Promise.resolve(this.rapierState);
  }

  /** The pose array (x y z qx qy qz qw per slot) chunks are drawn from, for tests. */
  get poses(): Float32Array | null {
    return this.pose;
  }

  /** Per frame after the simulation, with sim-scaled seconds: spawn, proxies, steps, lifetimes. */
  update(simDt: number): void {
    const slots = this.slots;
    if (this.pendCount === 0 && slots.live === 0 && slots.sinking === 0) {
      this.clock.advance(simDt);
      return;
    }
    if (this.pendCount > 0) {
      this.spawnPending();
      this.gen++;
    }
    const steps = this.clock.advance(simDt);
    const w = this.world;
    if (steps > 0 && w && !w.failed) {
      if (slots.live > 0) this.assignProxies(w);
      else this.parkProxies(w);
      // Nothing awake and no car moving near it: a step would change nothing (and the clock read allocates in V8).
      if (w.awake > 0 || w.proxyMoved) {
        const t0 = performance.now();
        // Poses are read only for bodies awake before or after a step: a car driving past a sleeping pile changes none.
        let moved = w.awake > 0;
        let stepped = 0;
        for (let s = 0; s < steps; s++) {
          if (w.awake === 0 && !w.proxyMoved) break;
          w.step(this.clock.step, this.fastProxy ? 2 : 1, w.proxiesOn > 0);
          stepped++;
          if (w.awake > 0) moved = true;
        }
        this.timing.sample(performance.now() - t0, stepped * this.clock.step);
        if (moved) this.gen++;
      }
      if (w.failed) this.physicsFailed(w);
    }
    const now = this.clock.time;
    if (now - this.tickAt >= TICK) {
      this.tickAt = now;
      const before = slots.live * 1024 + slots.sinking;
      slots.tick(now);
      if (slots.live * 1024 + slots.sinking !== before) {
        this.gen++;
        this.updateShadows();
      }
      this.forceSleep(now);
      // A removal or a forced sleep can throw too.
      const fw = this.world;
      if (fw && fw.failed) this.physicsFailed(fw);
    }
  }

  /**
   * The colour of the wall a `kind` blast at (x, z) will breach, scorched
   * (into `out`), or false when it breaches none: the blast's flying panels
   * read as wall rather than charcoal car body.
   */
  blastPaint(kind: BlastKind, x: number, z: number, out: Rgb): boolean {
    if (this.mode === 'off') return false;
    const p = this.d.breaches.probe(kind, x, z);
    if (!p) return false;
    const c = this.wallLinear(p.building, this.tmp);
    out.r = c.r * 0.7;
    out.g = c.g * 0.7;
    out.b = c.b * 0.7;
    return true;
  }

  /** Test hook: `seconds` of rubble time now, in fixed 1/60 updates (no render). */
  settle(seconds: number): void {
    for (let t = 0; t < seconds * 60 - 1e-6; t++) this.update(1 / 60);
  }

  /** Glow source, once per rendered frame: cull and write the instances. */
  draw(view: Rect): void {
    const lv = this.lastView;
    lv.minX = view.minX;
    lv.minZ = view.minZ;
    lv.maxX = view.maxX;
    lv.maxZ = view.maxZ;
    const batch = this.batch;
    const slots = this.slots;
    const pose = this.pose;
    if (!pose || slots.live + slots.sinking === 0) {
      batch.begin();
      batch.end();
      this.drawn = 0;
      return;
    }
    const x0 = view.minX - DRAW_MARGIN;
    const x1 = view.maxX + DRAW_MARGIN;
    const z0 = view.minZ - DRAW_MARGIN;
    const z1 = view.maxZ + DRAW_MARGIN;
    // Which chunks are in view; a pile that hasn't moved, with the same chunks in view, keeps last frame's buffers.
    let dirty = this.gen !== this.drawnGen || slots.sinking > 0;
    for (let i = 0; i < RUBBLE_CAPACITY; i++) {
      const st = slots.state[i];
      if (st !== LIVE && st !== SINKING) continue;
      const x = pose[i * 7];
      const z = pose[i * 7 + 2];
      const seen = x >= x0 && x <= x1 && z >= z0 && z <= z1 ? 1 : 0;
      if (slots.seen[i] !== seen) {
        slots.seen[i] = seen;
        dirty = true;
      }
    }
    const pools = batch.mesh.castShadow ? undefined : this.d.contactShadows;
    if (!dirty && !pools) {
      batch.hold();
      return;
    }
    this.drawnGen = this.gen;
    if (dirty) batch.begin();
    const now = this.clock.time;
    const src = this.src;
    src.pose = pose;
    const fade = this.fade;
    let n = 0;
    for (let i = 0; i < RUBBLE_CAPACITY; i++) {
      const st = slots.state[i];
      if ((st !== LIVE && st !== SINKING) || !slots.seen[i]) continue;
      const p = i * 7;
      // Its end: it crumbles onto the pavement (settles, darkens, flattens and shrinks), then is gone.
      let f = 0;
      if (st === SINKING) {
        f = (now - slots.sinkAt[i]) / slots.sinkDur[i];
        if (f >= 1) continue; // freed at the next tick
        if (f < 0) f = 0;
      }
      if (dirty) {
        fade[i] = f;
        batch.add(src, i);
      }
      n++;
      if (pools) {
        const x = pose[p];
        const z = pose[p + 2];
        // A soft pool under the chunk, along its local +Z, fading as it flies up or crumbles.
        const k = i * 3;
        const lift = Math.max(0, pose[p + 1] - this.size[k + 1] * 0.5);
        if (lift < 1.5) {
          const qx = pose[p + 3];
          const qy = pose[p + 4];
          const qz = pose[p + 5];
          const qw = pose[p + 6];
          const keep = 1 - f;
          const pl = this.pool;
          pl[0] = x;
          pl[1] = z;
          pl[2] = Math.atan2(2 * (qx * qz + qw * qy), 1 - 2 * (qx * qx + qy * qy));
          pl[3] = this.size[k] * 0.45 * keep;
          pl[4] = this.size[k + 2] * 0.45 * keep;
          pl[5] = 0.18;
          pl[6] = 0.6 * (1 - lift / 1.5) * keep;
          pools.addFrom(pl, 0);
        }
      }
    }
    this.drawn = n;
    if (dirty) batch.end();
    else batch.hold();
  }

  /** A fresh run (or the test switched off): bodies, building boxes, waiting breaches. Timings and counters stay. */
  clear(): void {
    this.pendCount = 0;
    this.slots.clear();
    this.deskBorn.fill(0);
    this.gen++;
    this.world?.clear();
    this.siteLive.fill(0);
    this.site.fill(-1);
    for (let i = 0; i < PROXIES; i++) this.proxyCar[i] = null;
    this.lastBreach.set = false;
    this.scars.clear();
  }

  stats(out: DestructionStats = emptyStats()): DestructionStats {
    const t = this.timing.summarize(this.timingOut);
    const w = this.world;
    out.mode = this.mode;
    out.source = this.urlMode !== null ? 'url' : 'setting';
    out.style = this.styleNow();
    out.rapier = this.rapierState;
    out.loadMs = rapier.loadMs;
    out.evalMs = rapier.evalMs;
    out.warmMs = rapier.warmMs;
    out.error = this.runtimeError ?? rapier.error;
    out.version = rapier.version;
    out.live = this.slots.live;
    out.awake = w ? w.awake : 0;
    out.sinking = this.slots.sinking;
    out.drawn = this.drawn;
    out.proxies = w ? w.proxiesOn : 0;
    out.statics = w ? w.statics : 0;
    out.scars = this.scars.visible;
    out.scarCap = this.mode === 'off' ? 0 : this.scarBudget(resolveStyle(this.mode, getQuality().name)).scarCap;
    out.breaches = this.breachCount;
    out.stepAvg = t.avg;
    out.stepP95 = t.p95;
    out.stepMax = t.max;
    out.secAvgMax = t.secAvgMax;
    out.secAvgP95 = t.secAvgP95;
    out.steps = t.total;
    out.spawnMaxMs = this.spawnMaxMs;
    out.spawnLastMs = this.spawnLastMs;
    out.timerMs = rapier.timerMs;
    return out;
  }

  /** The perf overlay's rubble line ('' when the test is off). */
  overlayText(): string {
    if (this.mode === 'off') return '';
    const t: TimingSummary = this.timing.summarize(this.timingOut);
    const q = rapier.timerMs >= 0.5 ? ' (q)' : '';
    return ` · rubble ${this.slots.live} · phys ${t.avg.toFixed(2)}/${t.p95.toFixed(2)}${q} ms`;
  }

  // --- Internals -------------------------------------------------------------

  private get rapierState(): RapierState {
    if (rapier.state === 'ready' && (this.runtimeError !== null || (this.world !== null && this.world.failed))) return 'failed';
    return rapier.state;
  }

  /** The style a breach now would be shown in: the mode on the live tier, 'low' without working physics. */
  private styleNow(): DestructionStyle {
    const s = resolveStyle(this.mode, getQuality().name);
    if (needsPhysics(s) && (!this.world || this.world.failed)) return 'low';
    return s;
  }

  private ensureWorld(): void {
    if (this.world || !this.module || this.mode === 'off' || this.runtimeError !== null) return;
    try {
      this.world = new this.module.RubbleWorld({ capacity: RUBBLE_CAPACITY, proxies: PROXIES, gravity: GRAVITY });
      this.pose = this.world.pose;
      this.warmSpawn(this.world);
    } catch (e) {
      this.runtimeError = e instanceof Error ? e.message : String(e);
      console.warn('Rubble world could not be created', e);
    }
  }

  /**
   * One desktop breach's spawn path, run and undone now (behind the title or
   * the pause card), so the first real breach pays no lazy compiles: it was
   * ~5x slower than later ones in Chromium (8.4 against 1.9 ms for 34 chunks).
   */
  private warmSpawn(w: RubbleWorld): void {
    const plan = planChunks(WARM_SITE, STYLE.desktop, this.plan);
    const n = this.slots.claim(plan.count, STYLE.desktop, this.clock.time, this.claimed);
    for (let j = 0; j < n; j++) {
      const i = this.claimed[j];
      w.spawnAt(i, plan.px[j], plan.py[j], plan.pz[j], plan.qx[j], plan.qy[j], plan.qz[j], plan.qw[j], plan.hx[j], plan.hy[j], plan.hz[j], plan.vx[j], plan.vy[j], plan.vz[j], plan.wx[j], plan.wy[j], plan.wz[j]);
    }
    // One step too: the new world's first contacts are slower than its later ones.
    w.step(this.clock.step, 1, false);
    for (let j = 0; j < n; j++) {
      w.remove(this.claimed[j]);
      this.slots.release(this.claimed[j]);
    }
    this.wallLinear(0, this.tmp);
  }

  private modeChanged(from: DestructionMode, to: DestructionMode): void {
    this.lastMode = to;
    const style = resolveStyle(to, getQuality().name);
    this.d.log?.('destruction', `${to} ${style}`);
    if (to === 'off') {
      this.clear();
      this.d.breaches.reset();
      this.world?.dispose();
      this.world = null;
      // Back to the city's original program. A session that booted with the
      // test on never compiled it, so warm up now, behind the card.
      this.d.setBreaches(false);
      this.d.warmShaders();
      return;
    }
    if (from === 'off') {
      this.d.setBreaches(true);
      this.ensureWorld();
      // The craters' shader variant compiles now, behind the pause card (the sheet is open).
      this.d.warmShaders();
    }
    this.restyleScars(style);
  }

  /** Scars already on the walls take `style`'s look and budget. */
  private restyleScars(style: DestructionStyle): void {
    const b = this.scarBudget(style);
    this.scars.restyle(b.richScar);
    this.scars.setCap(b.scarCap);
  }

  /** Sun shadows while any desktop chunk is alive (a phone breach after switching from DESKTOP doesn't flip the pile's). */
  private updateShadows(): void {
    let desk = false;
    const st = this.slots.state;
    for (let i = 0; i < RUBBLE_CAPACITY && !desk; i++) if (this.deskBorn[i] && (st[i] === LIVE || st[i] === SINKING)) desk = true;
    this.batch.shadows = desk;
  }

  /** The scar look and cap for a style ('off' never shows any). */
  private scarBudget(style: DestructionStyle): StyleBudget {
    return style === 'desktop' ? STYLE.desktop : style === 'phone' ? STYLE.phone : STYLE.low;
  }

  private onBreach(e: EventOf<'breach'>): void {
    const style = resolveStyle(this.mode, getQuality().name);
    if (style === 'off') return;
    this.breachCount++;
    // The scar is always written (a crater down the street is there when you get there).
    const sb = this.scarBudget(style);
    this.scars.setCap(sb.scarCap);
    this.scars.write(e.slot, e.x, e.y, e.z, e.radius, e.side, e.depth, e.seed, sb.richScar, worldUniforms.uTime.value);
    const v = this.lastView;
    if (e.x < v.minX - FAR_CUT || e.x > v.maxX + FAR_CUT || e.z < v.minZ - FAR_CUT || e.z > v.maxZ + FAR_CUT) return;
    this.lastBreach.x = e.x;
    this.lastBreach.y = e.y;
    this.lastBreach.z = e.z;
    this.lastBreach.set = true;
    const w = this.world;
    // Not ready (still loading, failed, or the tier asks for none): the scar and chips only.
    const shown: DestructionStyle = needsPhysics(style) && w && !w.failed ? style : 'low';
    const b = shown === 'low' ? STYLE.low : STYLE[shown === 'desktop' ? 'desktop' : 'phone'];
    const wall = this.wallLinear(e.building, this.tmp);
    this.dust(e, b, wall);
    if (shown === 'low') {
      this.chips(e, b, chipCount(b, e.strength), wall);
      return;
    }
    if (b.chipsBase > 0) this.chips(e, b, chipCount(b, e.strength), wall);
    this.bodies = b;
    this.queue(e, shown === 'desktop' ? 2 : 1);
  }

  /**
   * Dust out of the crater, tinted by the wall (brick dust is red): a cloud,
   * a ring at the foot and a haze that hangs over the rubble in the desktop
   * style; a short puff in the phone style.
   */
  private dust(e: EventOf<'breach'>, b: StyleBudget, wall: Color): void {
    const fx = this.d.effects;
    const dust = b.dust;
    const tx = -e.nz;
    const tz = e.nx;
    for (let i = 0; i < dust.puffs; i++) {
      const u = (Math.random() * 2 - 1) * e.radius;
      const h = (Math.random() * 2 - 1) * e.radius * 0.6;
      const sp = dust.speedMin + Math.random() * (dust.speedMax - dust.speedMin);
      const life = dust.lifeMin + Math.random() * (dust.lifeMax - dust.lifeMin);
      this.tint(fx.puff(e.x + tx * u + e.nx * 0.4, Math.max(0.3, e.y + h), e.z + tz * u + e.nz * 0.4, DUST, dust.size0, dust.size1, 0.55, e.nx * sp, 0.5 + Math.random(), e.nz * sp, life), wall);
    }
    if (dust.ring > 0) fx.dustRing(e.x + e.nx * 1.2, e.z + e.nz * 1.2, dust.ring, 1, 3);
    for (let i = 0; i < dust.haze; i++) {
      const u = (Math.random() * 2 - 1) * (e.radius + 2);
      const out = 1.5 + Math.random() * 3.5;
      const vx = e.nx * 0.4 + fx.windX * 0.5;
      const vz = e.nz * 0.4 + fx.windZ * 0.5;
      this.tint(fx.puff(e.x + tx * u + e.nx * out, 0.5 + Math.random() * 0.8, e.z + tz * u + e.nz * out, DUST, 2.5, 6, 0.3, vx, 0.12, vz, 6 + Math.random() * 3), wall);
    }
  }

  /** A third of the wall's colour into a dust puff (index from effects.puff; -1 when the pool is full). */
  private tint(i: number, wall: Color): void {
    if (i < 0) return;
    const p = this.d.effects.soft;
    p.r[i] = p.r[i] * 0.7 + wall.r * 0.3;
    p.g[i] = p.g[i] * 0.7 + wall.g * 0.3;
    p.b[i] = p.b[i] * 0.7 + wall.b * 0.3;
  }

  /** Debris chips (the existing pool, no physics) in the wall's colour. */
  private chips(e: EventOf<'breach'>, b: StyleBudget, n: number, wall: Color): void {
    const tx = -e.nz;
    const tz = e.nx;
    for (let i = 0; i < n; i++) {
      const u = (Math.random() * 2 - 1) * e.radius * 0.7;
      const out = 3 + 6 * e.strength * (0.6 + 0.6 * Math.random());
      const side = (Math.random() * 2 - 1) * 2.5;
      const s = b.chipMin + Math.random() * (b.chipMax - b.chipMin);
      const k = (0.7 + 0.3 * Math.random()) * (Math.random() < 0.3 ? 0.45 : 1);
      this.d.effects.debris.throw(
        e.x + tx * u + e.nx * 0.4,
        e.y,
        e.z + tz * u + e.nz * 0.4,
        e.nx * out + tx * side,
        2 + 3 * Math.random(),
        e.nz * out + tz * side,
        s,
        s * (0.5 + 0.5 * Math.random()),
        s * (0.7 + 0.3 * Math.random()),
        wall.r * k,
        wall.g * k,
        wall.b * k,
        3,
        8,
      );
    }
  }

  /** The breached building's wall colour, linear. */
  private wallLinear(building: number, out: Color): Color {
    const bd = this.d.breaches.buildings[building];
    return bd ? wallColour(bd.district, bd.tint, out) : out.copy(CONCRETE);
  }

  private queue(e: EventOf<'breach'>, style: 1 | 2): void {
    if (this.pendCount === PENDING) {
      this.pendHead = (this.pendHead + 1) % PENDING; // the oldest drops
      this.pendCount--;
    }
    const k = ((this.pendHead + this.pendCount) % PENDING) * 10;
    const p = this.pend;
    p[k] = e.x;
    p[k + 1] = e.y;
    p[k + 2] = e.z;
    p[k + 3] = e.nx;
    p[k + 4] = e.nz;
    p[k + 5] = e.radius;
    p[k + 6] = e.strength;
    p[k + 7] = e.seed;
    p[k + 8] = e.building;
    p[k + 9] = style;
    this.pendCount++;
  }

  /** One waiting breach's chunks into the world (one per frame keeps a chain's spawn cost spread). */
  private spawnPending(): void {
    const k = this.pendHead * 10;
    this.pendHead = (this.pendHead + 1) % PENDING;
    this.pendCount--;
    const w = this.world;
    if (!w || w.failed) return;
    const t0 = performance.now();
    const p = this.pend;
    const site = this.planSite;
    site.x = p[k];
    site.y = p[k + 1];
    site.z = p[k + 2];
    site.nx = p[k + 3];
    site.nz = p[k + 4];
    site.radius = p[k + 5];
    site.strength = p[k + 6];
    site.seed = p[k + 7];
    const building = p[k + 8];
    const b = p[k + 9] === 2 ? STYLE.desktop : STYLE.phone;
    const bs = this.d.breaches;
    // A crater raised over an awning: its chunks start past the awning (they would fall through it).
    const side = site.nz < 0 ? 0 : site.nx > 0 ? 1 : site.nz > 0 ? 2 : 3;
    site.clear = bs.underAwning(building, side, side === 0 || side === 2 ? site.x : site.z, site.radius) ? AWNING_DEPTH + 0.1 : 0;
    // Nearby buildings: static boxes for the chunks to land against, and blockers they mustn't start inside.
    const near = bs.grid.near(site.x, site.z, STATICS_RANGE);
    const blockers = this.blockers;
    blockers.length = 0;
    for (let i = 0; i < near.length; i++) {
      const r = near[i];
      const bi = bs.index.get(r);
      if (bi === undefined) continue;
      blockers.push(r);
      w.addStaticBox(bi, r.minX, r.minZ, r.maxX, r.maxZ, bs.buildings[bi].height);
    }
    const plan = planChunks(site, b, this.plan, blockers);
    const now = this.clock.time;
    const n = this.slots.claim(plan.count, b, now, this.claimed);
    const si = this.claimSite(site.x, site.z);
    const wall = this.wallLinear(building, this.tmp);
    const district = bs.buildings[building]?.district;
    const core = district === 'oldtown' || district === 'residential' ? BRICK : CONCRETE;
    for (let j = 0; j < n; j++) {
      const slot = this.claimed[j];
      if (!w.spawnAt(slot, plan.px[j], plan.py[j], plan.pz[j], plan.qx[j], plan.qy[j], plan.qz[j], plan.qw[j], plan.hx[j], plan.hy[j], plan.hz[j], plan.vx[j], plan.vy[j], plan.vz[j], plan.wx[j], plan.wy[j], plan.wz[j])) {
        this.slots.release(slot);
        continue;
      }
      const s3 = slot * 3;
      this.size[s3] = plan.hx[j] * 2;
      this.size[s3 + 1] = plan.hy[j] * 2;
      this.size[s3 + 2] = plan.hz[j] * 2;
      const tone = plan.tone[j];
      const c = tone === TONE_CORE ? core : wall;
      const shade = plan.shade[j] * (tone === TONE_SCORCHED ? 0.3 : 1);
      this.colour[s3] = c.r * shade;
      this.colour[s3 + 1] = c.g * shade;
      this.colour[s3 + 2] = c.b * shade;
      this.site[slot] = si;
      this.siteLive[si]++;
      this.deskBorn[slot] = b.shadows ? 1 : 0;
    }
    this.updateShadows();
    const ms = performance.now() - t0;
    this.spawnLastMs = ms;
    if (ms > this.spawnMaxMs) this.spawnMaxMs = ms;
    if (w.failed) this.physicsFailed(w);
  }

  /** A site slot for a breach's chunks: one with nothing alive, else the next in turn. */
  private claimSite(x: number, z: number): number {
    let si = -1;
    for (let k = 0; k < SITES; k++) {
      const i = (this.nextSite + k) % SITES;
      if (this.siteLive[i] === 0) {
        si = i;
        break;
      }
    }
    if (si < 0) si = this.nextSite;
    this.nextSite = (si + 1) % SITES;
    this.siteX[si] = x;
    this.siteZ[si] = z;
    return si;
  }

  /** A LIVE slot lost its body (evicted, expired, cleared). */
  private removeBody(i: number): void {
    this.world?.remove(i);
    const si = this.site[i];
    if (si >= 0 && this.siteLive[si] > 0) this.siteLive[si]--;
    this.site[i] = -1;
  }

  /**
   * Cars near live rubble get a kinematic proxy: the player's car first, then
   * the nearest, up to the style's count. Read from the cars' current sim
   * state; nothing is written back.
   */
  private assignProxies(w: RubbleWorld): void {
    const cap = Math.min(PROXIES, this.bodies.proxies);
    const cand = this.candidate;
    const key = this.candidateKey;
    let nc = 0;
    const player = this.d.playerCar();
    const vehicles = this.d.vehicles;
    for (let vi = 0; vi < vehicles.length; vi++) {
      const v = vehicles[vi];
      const vx = v.sim.x;
      const vz = v.sim.z;
      if (v.sim.y >= PROXY_MAX_Y) continue;
      // Nearest site with live chunks, squared. Inline, and kept in a typed
      // array: a call, or a float carried round the loop, may box in V8.
      const best = this.best;
      best[0] = Infinity;
      for (let i = 0; i < SITES; i++) {
        if (this.siteLive[i] === 0) continue;
        const dx = this.siteX[i] - vx;
        const dz = this.siteZ[i] - vz;
        const d = dx * dx + dz * dz;
        if (d < best[0]) best[0] = d;
      }
      const d2 = best[0];
      if (d2 > PROXY_RANGE * PROXY_RANGE) continue;
      const kk = v === player ? -1 : d2;
      // Insertion into the best `cap` so far (no sort callback, no arrays).
      let j = nc < cap ? nc++ : cap;
      if (j === cap && kk >= key[cap - 1]) continue;
      if (j === cap) j = cap - 1;
      while (j > 0 && key[j - 1] > kk) {
        cand[j] = cand[j - 1];
        key[j] = key[j - 1];
        j--;
      }
      cand[j] = v;
      key[j] = kk;
    }
    // Park proxies whose car is no longer chosen.
    for (let i = 0; i < PROXIES; i++) {
      const car = this.proxyCar[i];
      if (!car) continue;
      let kept = false;
      for (let c = 0; c < nc; c++) if (cand[c] === car) kept = true;
      if (!kept) {
        this.proxyCar[i] = null;
        w.parkProxy(i);
      }
    }
    let fast = false;
    for (let c = 0; c < nc; c++) {
      const v = cand[c]!;
      let i = this.proxyCar.indexOf(v);
      let assign = false;
      if (i < 0) {
        i = this.proxyCar.indexOf(null);
        if (i < 0) break;
        this.proxyCar[i] = v;
        assign = true;
      }
      const s = v.sim;
      const dx = s.x - this.proxyX[i];
      const dz = s.z - this.proxyZ[i];
      if (dx * dx + dz * dz > PROXY_JUMP * PROXY_JUMP) assign = true;
      this.proxyX[i] = s.x;
      this.proxyZ[i] = s.z;
      const pin = w.proxyIn;
      const pk = i * PROXY_IN;
      pin[pk] = s.x;
      pin[pk + 1] = s.y;
      pin[pk + 2] = s.z;
      pin[pk + 3] = s.heading;
      if (assign) this.proxyShape(v, pin, pk);
      w.setProxy(i, assign);
      if (s.vx * s.vx + s.vz * s.vz > FAST_PROXY * FAST_PROXY) fast = true;
    }
    for (let c = 0; c < nc; c++) cand[c] = null;
    this.fastProxy = fast;
  }

  /**
   * A car's proxy boxes into proxyIn at `pk`: its body up to the hood line
   * and its cabin over it, from the model (vehicles.glb), else from the
   * sim's collision circles with a saloon's heights.
   */
  private proxyShape(v: Vehicle, pin: Float64Array, pk: number): void {
    const m = this.d.carDims?.(v.archetype);
    let halfW: number;
    let front: number;
    let rear: number;
    let hood: number;
    let roof: number;
    let cabinFrom: number;
    let cabinTo: number;
    if (m) {
      halfW = m.halfWidth;
      front = m.front;
      rear = m.rear;
      hood = m.hood;
      roof = m.height;
      cabinFrom = m.cabinFrom;
      cabinTo = m.cabinTo;
    } else {
      const body = bodyOf(v.sim);
      const offs = body.offsets;
      let lo = offs[0];
      let hi = offs[0];
      for (let o = 1; o < offs.length; o++) {
        if (offs[o] < lo) lo = offs[o];
        if (offs[o] > hi) hi = offs[o];
      }
      halfW = body.radius;
      front = hi + body.radius;
      rear = body.radius - lo;
      hood = 0.95;
      roof = 1.5;
      cabinFrom = lo * 0.6;
      cabinTo = hi * 0.4;
    }
    hood = Math.max(0.3, hood);
    const b = pk + PROXY_BODY;
    pin[b] = halfW;
    pin[b + 1] = (hood - PROXY_FLOOR) / 2;
    pin[b + 2] = (front + rear) / 2;
    pin[b + 3] = (hood + PROXY_FLOOR) / 2;
    pin[b + 4] = (front - rear) / 2;
    const c = pk + PROXY_CABIN;
    const on = roof > hood + 0.05 && cabinTo > cabinFrom;
    pin[c] = halfW * 0.85;
    pin[c + 1] = on ? (roof - hood) / 2 : 0;
    pin[c + 2] = (cabinTo - cabinFrom) / 2;
    pin[c + 3] = (roof + hood) / 2;
    pin[c + 4] = (cabinTo + cabinFrom) / 2;
  }

  private parkProxies(w: RubbleWorld): void {
    for (let i = 0; i < PROXIES; i++) {
      if (!this.proxyCar[i]) continue;
      this.proxyCar[i] = null;
      w.parkProxy(i);
    }
    this.fastProxy = false;
  }

  /** Chunks still tumbling long after their breach with no moving car near are put to sleep. */
  private forceSleep(now: number): void {
    const w = this.world;
    if (!w || w.failed) return;
    if (w.awake > 0) {
      const slots = this.slots;
      const pose = this.pose!;
      for (let i = 0; i < RUBBLE_CAPACITY; i++) {
        if (slots.state[i] !== LIVE || !w.awakeFlag[i] || now - slots.born[i] < STYLE.desktop.sleepAfter) continue;
        if (!w.stirredNear(pose[i * 7], pose[i * 7 + 2], STIR_RANGE)) w.sleepSlot(i);
      }
    }
    w.proxyStirred.fill(0);
  }

  /** Rapier threw mid-play: everything alive sinks away (nothing pops), and breaches fall back to 'low'. */
  private physicsFailed(w: RubbleWorld): void {
    this.runtimeError = w.error ?? 'rubble physics failed';
    this.d.log?.('rapier', `failed ${this.runtimeError}`);
    this.slots.sinkAll(this.clock.time);
    this.gen++;
    for (let i = 0; i < PROXIES; i++) this.proxyCar[i] = null;
    this.world = null;
  }
}

export function emptyStats(): DestructionStats {
  return {
    mode: 'off',
    source: 'setting',
    style: 'off',
    rapier: 'idle',
    loadMs: 0,
    evalMs: 0,
    warmMs: 0,
    error: null,
    version: null,
    live: 0,
    awake: 0,
    sinking: 0,
    drawn: 0,
    proxies: 0,
    statics: 0,
    scars: 0,
    scarCap: 0,
    breaches: 0,
    stepAvg: 0,
    stepP95: 0,
    stepMax: 0,
    secAvgMax: 0,
    secAvgP95: 0,
    steps: 0,
    spawnMaxMs: 0,
    spawnLastMs: 0,
    timerMs: 0,
  };
}
