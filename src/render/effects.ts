import {
  AddEquation,
  CustomBlending,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  DynamicDrawUsage,
  type Scene,
  type Texture,
} from 'three';
import type { Rect } from '../world/city';
import { ATLAS_CELLS, createFxAtlas } from './fxAtlas';
import { Debris } from './fxDebris';
import { DECAL, GroundDecals } from './fxDecals';
import { FLAG, FRAME, InstanceBuffer, ParticlePool, RAMP, type Frame } from './fxParticles';
import { GLOW, type GlowShape, type GlowSprites } from './glowSprites';
import { getQuality } from './quality';
import { worldUniforms } from './shaderLib';

/** Tracer look per shooter: width (m), head speed (m/s), tint. */
export type TracerKind = 'pistol' | 'smg' | 'shotgun' | 'npc';
const TRACER: Record<TracerKind, { width: number; speed: number; r: number; g: number; b: number }> = {
  pistol: { width: 0.17, speed: 340, r: 2.4, g: 1.9, b: 1.1 },
  smg: { width: 0.13, speed: 380, r: 2.2, g: 1.7, b: 0.9 },
  shotgun: { width: 0.1, speed: 300, r: 2.2, g: 1.5, b: 0.7 },
  npc: { width: 0.13, speed: 260, r: 2.4, g: 0.9, b: 0.45 },
};
/** How long the glowing streak behind a tracer's head is, m. */
const TRACER_STREAK = 7;
/** Where bullets fly, m above the ground. */
const GUN_Y = 1.2;
const MAX_TRACERS = 64;
const MAX_LIGHTS = 48;

/** One debris/explosion colour (linear). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const CHARCOAL: Rgb = { r: 0.05, g: 0.045, b: 0.04 };

/**
 * Every particle effect in the game, in a handful of draw calls:
 *  - hot: fire, sparks, embers, flashes, tracers, speed streaks (light-like:
 *    mostly additive, so stacked flames glow yellow at the core rather than
 *    clipping to white);
 *  - soft: smoke, dust, tyre smoke (alpha-blended, drawn after the fire so
 *    smoke rolls over it);
 *  - debris: solid lit chunks, glass and shell casings;
 *  - decals: skid marks, scorches, pocks and scrapes on the ground.
 * Plus fake lights (ground flashes, shockwave rings, muzzle splashes) drawn
 * into the shared GlowSprites by drawLights(), so they cost no draw call.
 *
 * Particles are struct-of-arrays pools (fxParticles.ts) with per-instance
 * colour and opacity, so they fade and change colour over their life; counts
 * scale with the quality tier's particleScale. Nothing allocates per frame.
 */
export class Effects {
  readonly hot: ParticlePool;
  readonly soft: ParticlePool;
  readonly decals = new GroundDecals();
  readonly debris = new Debris(128);
  /** Global breeze smoke drifts with (m/s). */
  windX = 0.8;
  windZ = 0.15;
  private readonly hotOut: InstanceBuffer;
  private readonly softOut: InstanceBuffer;
  private readonly hotMesh: Mesh;
  private readonly softMesh: Mesh;
  private readonly atlas: Texture;
  // Tracers: struct-of-arrays too.
  private readonly tx0 = new Float32Array(MAX_TRACERS);
  private readonly tz0 = new Float32Array(MAX_TRACERS);
  private readonly tdx = new Float32Array(MAX_TRACERS);
  private readonly tdz = new Float32Array(MAX_TRACERS);
  private readonly tLen = new Float32Array(MAX_TRACERS);
  private readonly tHead = new Float32Array(MAX_TRACERS);
  private readonly tKind = new Uint8Array(MAX_TRACERS);
  private readonly tAlive = new Uint8Array(MAX_TRACERS);
  private tracerNext = 0;
  // Fake lights.
  private readonly lx = new Float32Array(MAX_LIGHTS);
  private readonly ly = new Float32Array(MAX_LIGHTS);
  private readonly lz = new Float32Array(MAX_LIGHTS);
  private readonly lr0 = new Float32Array(MAX_LIGHTS);
  private readonly lr1 = new Float32Array(MAX_LIGHTS);
  private readonly lcr = new Float32Array(MAX_LIGHTS);
  private readonly lcg = new Float32Array(MAX_LIGHTS);
  private readonly lcb = new Float32Array(MAX_LIGHTS);
  private readonly lAge = new Float32Array(MAX_LIGHTS);
  private readonly lLife = new Float32Array(MAX_LIGHTS);
  private readonly lShape = new Uint8Array(MAX_LIGHTS);
  private lightNext = 0;
  /** Sky light on smoke and dust (the soft particles), dimmer and cooler at night. */
  private readonly ambient = { value: { r: 1, g: 1, b: 1 } as Rgb };
  /** Explosions in the last moment: chain reactions share one budget. */
  private recentBooms = 0;

  constructor(scene: Scene, hotCapacity = 900, softCapacity = 700) {
    this.hot = new ParticlePool(hotCapacity);
    this.soft = new ParticlePool(softCapacity);
    // Fire that burns out rolls on as smoke.
    this.hot.onDeath = (pool, i) => this.fireToSmoke(pool, i);
    this.hotOut = new InstanceBuffer(hotCapacity + MAX_TRACERS);
    this.softOut = new InstanceBuffer(softCapacity);
    this.atlas = createFxAtlas();
    // Fire, sparks and flashes are their own light: full brightness day and night.
    this.hotMesh = particleMesh(this.hotOut, this.atlas, { value: { r: 1, g: 1, b: 1 } }, 'fxHot');
    this.softMesh = particleMesh(this.softOut, this.atlas, this.ambient, 'fxSoft');
    // Fire first, smoke over it, both after every other transparent.
    this.hotMesh.renderOrder = 3;
    this.softMesh.renderOrder = 4;
    for (let i = 0; i < MAX_LIGHTS; i++) this.lLife[i] = 0;
    scene.add(this.hotMesh, this.softMesh, this.decals.mesh, this.debris.mesh);
  }

  /** Particle budget multiplier for the current tier (fewer on phones). */
  get scale(): number {
    return getQuality().particleScale;
  }

  // --- The original API (kept for existing callers) -------------------------

  /** A puff of smoke rising from (x, y, z); dark 0 = pale grey, 1 = black. */
  emitSmoke(x: number, z: number, y: number, dark = 0.5): void {
    const i = this.soft.spawn(
      x + (Math.random() - 0.5) * 0.6,
      y,
      z + (Math.random() - 0.5) * 0.6,
      this.windX + (Math.random() - 0.5) * 0.6,
      0.9 + Math.random() * 0.7,
      this.windZ + (Math.random() - 0.5) * 0.6,
      1.8 + Math.random() * 1.2,
      0.8 + Math.random() * 0.3,
      2.6 + Math.random() * 1.2,
      RAMP.smoke,
      puffFrame(),
    );
    if (i < 0) return;
    const shade = 0.5 - dark * 0.43 + Math.random() * 0.06;
    this.soft.r[i] = shade;
    this.soft.g[i] = shade;
    this.soft.b[i] = shade * 1.03;
    this.soft.alpha[i] = 0.55 + dark * 0.25;
    this.soft.spin[i] = (Math.random() - 0.5) * 0.8;
    this.soft.drag[i] = 0.4;
  }

  /** A lick of flame at (x, y, z) (burning cars, small muzzle-like puffs). */
  emitFire(x: number, z: number, y: number): void {
    const i = this.hot.spawn(
      x + (Math.random() - 0.5) * 1.0,
      y,
      z + (Math.random() - 0.5) * 1.4,
      this.windX * 0.4 + (Math.random() - 0.5) * 0.4,
      2.2 + Math.random() * 1.6,
      (Math.random() - 0.5) * 0.4,
      0.35 + Math.random() * 0.3,
      0.9 + Math.random() * 0.5,
      0.35,
      RAMP.fire,
      FRAME.flame,
    );
    if (i < 0) return;
    const k = 1.35 + Math.random() * 0.6;
    this.hot.r[i] = k;
    this.hot.g[i] = k;
    this.hot.b[i] = k;
    this.hot.add[i] = 0.5;
    this.hot.alpha[i] = 0.9;
    this.hot.spin[i] = (Math.random() - 0.5) * 3;
  }

  /**
   * A car exploding at (x, z): flash, shockwave, fireball rolling into a
   * column of smoke, sparks, embers, flying panels in `paint`, and a scorch.
   * Several at once (a chain reaction) share a budget.
   */
  explode(x: number, z: number, paint: Rgb = CHARCOAL): void {
    this.recentBooms += 1;
    const budget = this.scale / Math.max(1, this.recentBooms * 0.6);
    const n = (count: number) => Math.max(1, Math.round(count * budget));
    // Overlapping blasts in a chain add up: each extra one's lights and fire
    // are dimmer and its fire covers more and adds less, so a stack settles
    // on deep orange instead of summing to a white wall (worst with bloom).
    const glow = 1 / Math.max(1, this.recentBooms);
    const heat = 0.6 + 0.4 * glow;

    // Flash on the ground and a shockwave ring out to the blast radius (9 m).
    this.light(x, 0.12, z, 2.5, 12, 2.1 * glow, 1.25 * glow, 0.5 * glow, 0.34, GLOW.disc);
    this.light(x, 0.1, z, 1.5, 9.5, 1.9 * glow, 1.15 * glow, 0.55 * glow, 0.38, GLOW.ring);
    this.light(x, 0.1, z, 1, 11.5, 0.5 * glow, 0.36 * glow, 0.24 * glow, 0.45, GLOW.ring);
    // A brief white pop high over the car (draws over its roof); once per chain, or they stack to white.
    if (this.recentBooms < 1.5) this.flare(x, 2.8, z, 4.6, 0.12, 2, 1.7, 1.2);

    // Fireball: a few big slow balls (above the roof, so the body can't hide
    // them) and a spray of fast ones.
    for (let k = n(12); k > 0; k--) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3.5;
      const i = this.hot.spawn(
        x + Math.cos(a) * 0.8,
        1.9 + Math.random() * 1.2,
        z + Math.sin(a) * 0.8,
        Math.cos(a) * sp,
        2.5 + Math.random() * 3,
        Math.sin(a) * sp,
        0.7 + Math.random() * 0.5,
        2.8 + Math.random() * 1.2,
        5 + Math.random() * 2.2,
        RAMP.fire,
        FRAME.flame,
      );
      if (i < 0) break;
      this.fireLook(i, 1.75 * heat, 0.38 * glow);
      this.hot.flags[i] = FLAG.handoff;
      this.hot.drag[i] = 1.6;
    }
    for (let k = n(36); k > 0; k--) {
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 11;
      const i = this.hot.spawn(
        x,
        1.8 + Math.random(),
        z,
        Math.cos(a) * sp,
        1.5 + Math.random() * 5,
        Math.sin(a) * sp,
        0.3 + Math.random() * 0.35,
        1.2 + Math.random() * 0.9,
        2 + Math.random(),
        RAMP.fire,
        Math.random() < 0.5 ? FRAME.flame : FRAME.puffB,
      );
      if (i < 0) break;
      this.fireLook(i, 1.55 * heat, 0.45 * glow);
      this.hot.drag[i] = 3.2;
      if (Math.random() < 0.35) this.hot.flags[i] = FLAG.handoff;
    }
    // Rising column of dark smoke that spreads into a cap.
    for (let k = n(14); k > 0; k--) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.5;
      const i = this.soft.spawn(
        x + Math.cos(a) * r,
        2 + Math.random() * 2,
        z + Math.sin(a) * r,
        Math.cos(a) * 1.5 + this.windX,
        4.5 + Math.random() * 3,
        Math.sin(a) * 1.5 + this.windZ,
        2.6 + Math.random() * 1.6,
        2.4,
        6.5 + Math.random() * 3,
        RAMP.smoke,
        puffFrame(),
      );
      if (i < 0) break;
      const shade = 0.06 + Math.random() * 0.07;
      this.smokeLook(i, shade, 0.85);
      this.soft.drag[i] = 0.9;
    }
    // Dust kicked out along the ground by the shockwave.
    for (let k = n(14); k > 0; k--) {
      const a = (k / 14) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 9 + Math.random() * 5;
      const i = this.soft.spawn(x + Math.cos(a) * 1.5, 0.5, z + Math.sin(a) * 1.5, Math.cos(a) * sp, 0.6, Math.sin(a) * sp, 0.9 + Math.random() * 0.5, 1.5, 4.5, RAMP.smoke, FRAME.dust);
      if (i < 0) break;
      this.smokeLook(i, 0.38, 0.4);
      this.soft.r[i] = 0.42;
      this.soft.g[i] = 0.37;
      this.soft.b[i] = 0.31;
      this.soft.drag[i] = 3.5;
    }
    this.sparks(x, 1.4, z, n(28), 12, 26, 0, 0);
    this.embers(x, z, n(22), 2.5, 7);

    // Panels in the car's colour, dark chunks, glass. Debris is one instanced
    // draw whatever the count, so it isn't cut on phones: 12 for a lone blast,
    // fewer per car in a chain.
    const pieces = Math.max(4, Math.round(12 / Math.max(1, this.recentBooms * 0.6)));
    for (let k = 0; k < pieces; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 8;
      const own = k % 3 !== 2;
      const c = own ? paint : CHARCOAL;
      const w = own ? 0.5 + Math.random() * 0.6 : 0.25 + Math.random() * 0.35;
      this.debris.throw(
        x + Math.cos(a) * 0.8,
        1.2,
        z + Math.sin(a) * 0.8,
        Math.cos(a) * sp,
        6 + Math.random() * 9,
        Math.sin(a) * sp,
        w,
        own ? 0.06 : 0.2 + Math.random() * 0.2,
        own ? 0.4 + Math.random() * 0.5 : 0.25 + Math.random() * 0.3,
        c.r,
        c.g,
        c.b,
        5 + Math.random() * 4,
        9,
      );
    }
    this.glass(x, 1.1, z, n(8), 6);
    this.decals.stamp(x, z, 4.2 + Math.random() * 0.8, Math.random() * 6.3, 0.92, 75, DECAL.scorch);
  }

  /** A tracer from the muzzle (x1, z1) to where the bullet stopped (x2, z2). */
  tracer(x1: number, z1: number, x2: number, z2: number, kind: TracerKind = 'pistol'): void {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return;
    const i = this.tracerNext;
    this.tracerNext = (i + 1) % MAX_TRACERS;
    this.tAlive[i] = 1;
    this.tx0[i] = x1;
    this.tz0[i] = z1;
    this.tdx[i] = dx / len;
    this.tdz[i] = dz / len;
    this.tLen[i] = len;
    // Born a little way out of the barrel so the first frame already shows a streak.
    this.tHead[i] = Math.min(len, 2.5);
    this.tKind[i] = kindIndex(kind);
  }

  // --- New primitives -------------------------------------------------------

  /**
   * `count` sparks from (x, y, z) at speeds lo..hi, thrown around (dirX,
   * dirZ) (zero for all directions), streaked along their flight.
   */
  sparks(x: number, y: number, z: number, count: number, lo: number, hi: number, dirX: number, dirZ: number): void {
    const dl = Math.hypot(dirX, dirZ);
    for (let k = 0; k < count; k++) {
      let a = Math.random() * Math.PI * 2;
      if (dl > 0) a = Math.atan2(dirZ, dirX) + (Math.random() - 0.5) * 2.2;
      const sp = lo + Math.random() * (hi - lo);
      const up = 0.15 + Math.random() * 0.6;
      const i = this.hot.spawn(x, y, z, Math.cos(a) * sp, sp * up, Math.sin(a) * sp, 0.22 + Math.random() * 0.4, 0.1 + Math.random() * 0.06, 0.06, RAMP.spark, FRAME.spark);
      if (i < 0) return;
      this.hot.flags[i] = FLAG.stretch | FLAG.bounce;
      this.hot.stretch[i] = 0.028;
      this.hot.gravity[i] = 22;
      this.hot.drag[i] = 1.2;
      this.hot.add[i] = 1;
      const k2 = 2.2 + Math.random();
      this.hot.r[i] = k2;
      this.hot.g[i] = k2;
      this.hot.b[i] = k2;
    }
  }

  /** Glowing embers drifting up and off with the wind, flickering out. */
  embers(x: number, z: number, count: number, lo: number, hi: number): void {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = lo + Math.random() * (hi - lo);
      const i = this.hot.spawn(x, 1.5 + Math.random(), z, Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp, 1.4 + Math.random() * 1.8, 0.16 + Math.random() * 0.12, 0.08, RAMP.ember, FRAME.dot);
      if (i < 0) return;
      this.hot.gravity[i] = -0.8; // buoyant
      this.hot.drag[i] = 1.6;
      this.hot.add[i] = 1;
      const k2 = 2 + Math.random();
      this.hot.r[i] = k2;
      this.hot.g[i] = k2;
      this.hot.b[i] = k2;
    }
  }

  /** Small glass chips (tiny bright boxes) and a few glints. */
  glass(x: number, y: number, z: number, count: number, speed: number): void {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      const s = 0.07 + Math.random() * 0.08;
      this.debris.throw(x, y, z, Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp, s, 0.02, s * 1.4, 0.55, 0.75, 0.85, 2.5 + Math.random() * 2, 14, 0.25);
    }
    for (let k = Math.min(4, count); k > 0; k--) {
      const i = this.hot.spawn(x + (Math.random() - 0.5) * 1.2, y + 0.3, z + (Math.random() - 0.5) * 1.2, 0, 0, 0, 0.12 + Math.random() * 0.1, 0.5, 0.2, RAMP.flash, FRAME.star);
      if (i < 0) return;
      this.hot.add[i] = 1;
      this.hot.r[i] = 1.6;
      this.hot.g[i] = 1.8;
      this.hot.b[i] = 2;
    }
  }

  /**
   * A muzzle flash at (x, z) aimed along (dirX, dirZ): a flare turned to the
   * aim, a star pop at the barrel, a wisp of smoke and a warm splash of light
   * on the ground. `power` 0.6 (NPC) .. 1.6 (shotgun).
   */
  muzzleFlash(x: number, z: number, dirX: number, dirZ: number, power = 1): void {
    const len = 0.9 + 0.7 * power;
    const w = 0.42 + 0.3 * power;
    let i = this.hot.spawn(x + dirX * (len * 0.5 - 0.1), GUN_Y, z + dirZ * (len * 0.5 - 0.1), 0, 0, 0, 0.06, w, w * 0.8, RAMP.flash, FRAME.muzzle);
    if (i >= 0) {
      // A stretched quad's axis is its velocity times stretch: point it along the aim.
      this.hot.flags[i] = FLAG.stretch | FLAG.still;
      this.hot.vx[i] = dirX;
      this.hot.vz[i] = dirZ;
      this.hot.stretch[i] = Math.max(0.05, len - w);
      this.hot.add[i] = 0.85;
      this.hot.r[i] = 3;
      this.hot.g[i] = 2.3;
      this.hot.b[i] = 1.2;
    }
    i = this.hot.spawn(x, GUN_Y, z, 0, 0, 0, 0.05, 0.55 * power + 0.3, 0.35, RAMP.flash, FRAME.star);
    if (i >= 0) {
      this.hot.add[i] = 1;
      this.hot.r[i] = 3;
      this.hot.g[i] = 2.6;
      this.hot.b[i] = 1.9;
    }
    const s = this.soft.spawn(x + dirX * 0.4, GUN_Y, z + dirZ * 0.4, dirX * 2.2 + this.windX * 0.3, 0.6, dirZ * 2.2, 0.5 + Math.random() * 0.3, 0.3, 1 + 0.4 * power, RAMP.smoke, FRAME.puffC);
    if (s >= 0) this.smokeLook(s, 0.6, 0.28);
    // Big enough to read as light on the street, not so bright that a shotgun at night blooms into a white ball.
    this.light(x + dirX * 0.8, 0.1, z + dirZ * 0.8, 2.4 + power * 0.8, 3 + power * 0.8, 1.2 * power, 0.75 * power, 0.35 * power, 0.07, GLOW.disc);
  }

  /** Where a bullet stopped: sparks off metal and walls, dust (and a pock) on the ground. */
  impact(x: number, z: number, target: 'ped' | 'vehicle' | 'player' | 'wall' | 'none', fromX: number, fromZ: number): void {
    const dx = fromX - x;
    const dz = fromZ - z;
    const d = Math.hypot(dx, dz) || 1;
    // Bounce back toward the shooter.
    const bx = dx / d;
    const bz = dz / d;
    const sc = this.scale;
    if (target === 'vehicle' || target === 'wall') {
      this.sparks(x, GUN_Y, z, Math.max(2, Math.round((target === 'vehicle' ? 7 : 5) * sc)), 5, 13, bx, bz);
      this.flare(x, GUN_Y, z, 0.7, 0.06, 2.4, 2, 1.4);
      this.puff(x + bx * 0.2, GUN_Y, z + bz * 0.2, target === 'wall' ? 0.5 : 0.35, 0.6, 1.4, 0.4);
    } else if (target === 'none') {
      this.puff(x, 0.25, z, 0.45, 0.45, 1.3, 0.55);
      this.decals.stamp(x, z, 0.18, Math.random() * 6.3, 0.75, 12, DECAL.pock);
    } else {
      // A person: a white pop (the body flashes too) and a little dust.
      this.flare(x, 1.1, z, 0.9, 0.08, 2.2, 2.2, 2.2);
      this.puff(x, 0.9, z, 0.62, 0.4, 1.1, 0.3);
    }
  }

  /**
   * A puff of dust or smoke: `shade` grey level, `size0`→`size1` m, opacity
   * `alpha`; drifts gently.
   */
  puff(x: number, y: number, z: number, shade: number, size0: number, size1: number, alpha: number, vx = 0, vy = 0.4, vz = 0, life = 0.9): number {
    const i = this.soft.spawn(x, y, z, vx + (Math.random() - 0.5) * 0.5, vy, vz + (Math.random() - 0.5) * 0.5, life * (0.8 + Math.random() * 0.4), size0, size1, RAMP.smoke, FRAME.dust);
    if (i < 0) return -1;
    this.smokeLook(i, shade, alpha);
    this.soft.r[i] = shade * 1.06;
    this.soft.b[i] = shade * 0.9;
    this.soft.drag[i] = 2;
    return i;
  }

  /** A ring of low dust spreading from (x, z) (someone hitting the ground, a landing). */
  dustRing(x: number, z: number, count: number, radius: number, speed: number): void {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + Math.random() * 0.5;
      this.puff(x + Math.cos(a) * radius, 0.3, z + Math.sin(a) * radius, 0.55, 0.5, 1.6, 0.45, Math.cos(a) * speed, 0.3, Math.sin(a) * speed, 0.7);
    }
  }

  /** Tyre smoke at a wheel: `amount` 0..1 sets size and density; colour tinted (r, g, b). */
  tyreSmoke(x: number, z: number, vx: number, vz: number, amount: number, r: number, g: number, b: number): void {
    const i = this.soft.spawn(
      x + (Math.random() - 0.5) * 0.4,
      0.35,
      z + (Math.random() - 0.5) * 0.4,
      vx * 0.25 + this.windX * 0.6 + (Math.random() - 0.5),
      0.5 + Math.random() * 0.6,
      vz * 0.25 + this.windZ * 0.6 + (Math.random() - 0.5),
      1.1 + amount * 1.1 + Math.random() * 0.4,
      0.7,
      2.4 + amount * 2.4,
      RAMP.smoke,
      puffFrame(),
    );
    if (i < 0) return;
    this.soft.r[i] = r;
    this.soft.g[i] = g;
    this.soft.b[i] = b;
    this.soft.alpha[i] = 0.3 + amount * 0.35;
    this.soft.drag[i] = 1.4;
    this.soft.spin[i] = (Math.random() - 0.5) * 1.2;
  }

  /**
   * A pale wind streak hanging in the air at (x, y, z), stretched along
   * (dx, dz) × length, `width` m across (≥ ~0.1 to stay a solid pixel wide
   * on a phone at driving height).
   */
  streak(x: number, y: number, z: number, dx: number, dz: number, length: number, alpha: number, life = 0.28, width = 0.11): void {
    const i = this.hot.spawn(x, y, z, dx, 0, dz, life, width, width * 0.7, RAMP.flat, FRAME.spark);
    if (i < 0) return;
    // Velocity only orients it: it hangs still, so the car sweeps past it.
    this.hot.flags[i] = FLAG.stretch | FLAG.still;
    this.hot.stretch[i] = length;
    this.hot.add[i] = 1;
    this.hot.alpha[i] = alpha;
    this.hot.r[i] = 1.4;
    this.hot.g[i] = 1.5;
    this.hot.b[i] = 1.7;
  }

  /**
   * A sparkly burst at (x, z) in colour (r, g, b) (pickups, combo
   * milestones): stars thrown up and out, a ring expanding on the ground.
   */
  burst(x: number, z: number, r: number, g: number, b: number, count: number, radius: number): void {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      const i = this.hot.spawn(x, 0.8 + Math.random() * 0.6, z, Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp, 0.5 + Math.random() * 0.4, 0.35 + Math.random() * 0.3, 0.1, RAMP.flat, k % 3 === 0 ? FRAME.star : FRAME.dot);
      if (i < 0) break;
      this.hot.gravity[i] = 7;
      this.hot.drag[i] = 1.5;
      this.hot.add[i] = 1;
      this.hot.spin[i] = (Math.random() - 0.5) * 8;
      this.hot.r[i] = r * 1.8;
      this.hot.g[i] = g * 1.8;
      this.hot.b[i] = b * 1.8;
    }
    this.light(x, 0.1, z, 0.5, radius, r * 1.2, g * 1.2, b * 1.2, 0.45, GLOW.ring);
    // The fill under it dims as it grows, or a big burst floods the street.
    const fill = 0.5 * Math.min(1, 3 / radius);
    this.light(x, 0.1, z, radius * 0.5, radius * 0.8, r * fill, g * fill, b * fill, 0.3, GLOW.disc);
  }

  /** A short bright billboard pop (star) at (x, y, z) of `size` m, lasting `life` s. */
  flare(x: number, y: number, z: number, size: number, life: number, r: number, g: number, b: number): void {
    const i = this.hot.spawn(x, y, z, 0, 0, 0, life, size, size * 1.3, RAMP.flash, FRAME.star);
    if (i < 0) return;
    this.hot.add[i] = 1;
    this.hot.r[i] = r;
    this.hot.g[i] = g;
    this.hot.b[i] = b;
  }

  /**
   * A faked light on the ground at (x, y, z): radius r0 → r1 over `life`
   * seconds, colour (linear, added), disc or ring. Drawn by drawLights().
   */
  light(x: number, y: number, z: number, r0: number, r1: number, r: number, g: number, b: number, life: number, shape: number): void {
    // Take a free slot, else the next one round.
    let i = -1;
    for (let k = 0; k < MAX_LIGHTS; k++) {
      const j = (this.lightNext + k) % MAX_LIGHTS;
      if (this.lAge[j] >= this.lLife[j]) {
        i = j;
        break;
      }
    }
    if (i < 0) i = this.lightNext;
    this.lightNext = (i + 1) % MAX_LIGHTS;
    this.lx[i] = x;
    this.ly[i] = y;
    this.lz[i] = z;
    this.lr0[i] = r0;
    this.lr1[i] = r1;
    this.lcr[i] = r;
    this.lcg[i] = g;
    this.lcb[i] = b;
    this.lAge[i] = 0;
    this.lLife[i] = life;
    this.lShape[i] = shape;
  }

  /** Glow source: draw the live fake lights inside the view (no draw call of its own). */
  drawLights(glows: GlowSprites, view: Rect): void {
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const life = this.lLife[i];
      if (this.lAge[i] >= life) continue;
      const x = this.lx[i];
      const z = this.lz[i];
      const r1 = this.lr1[i];
      if (x < view.minX - r1 || x > view.maxX + r1 || z < view.minZ - r1 || z > view.maxZ + r1) continue;
      const t = this.lAge[i] / life;
      const grow = 1 - (1 - t) * (1 - t) * (1 - t);
      const radius = this.lr0[i] + (r1 - this.lr0[i]) * grow;
      const ring = this.lShape[i] === GLOW.ring;
      // Rings fade as fast as discs: one that lingers once it has spread
      // leaves a band of light on a dark street (worse with a chain's overlaps).
      const k = (1 - t) * (1 - t);
      // The ring shape sits at 0.82 of the quad's half-size.
      const size = ring ? (radius * 2) / 0.82 : radius * 2;
      glows.addFlat(x, this.ly[i], z, 0, size, size, this.lcr[i] * k, this.lcg[i] * k, this.lcb[i] * k, this.lShape[i] as GlowShape);
    }
  }

  /** Drop everything in flight (a fresh run, the title). Ground marks stay unless `marks`. */
  clear(marks = false): void {
    this.hot.clear();
    this.soft.clear();
    this.debris.clear();
    this.tAlive.fill(0);
    for (let i = 0; i < MAX_LIGHTS; i++) this.lAge[i] = this.lLife[i];
    if (marks) this.decals.clear();
  }

  update(dt: number): void {
    // Smoke and dust are lit by the sky: dim and cool them at night.
    const night = worldUniforms.uNight.value;
    const amb = this.ambient.value;
    amb.r = 1 - 0.74 * night;
    amb.g = 1 - 0.7 * night;
    amb.b = 1 - 0.6 * night;
    this.recentBooms = Math.max(0, this.recentBooms - dt * 4);
    this.hot.step(dt);
    this.soft.step(dt);
    this.debris.update(dt);
    this.decals.update(dt);
    for (let i = 0; i < MAX_LIGHTS; i++) if (this.lAge[i] < this.lLife[i]) this.lAge[i] += dt;

    this.hotOut.reset();
    this.hot.write(this.hotOut);
    this.writeTracers(dt);
    this.softOut.reset();
    this.soft.write(this.softOut);
    upload(this.hotMesh, this.hotOut);
    upload(this.softMesh, this.softOut);
  }

  /** Advance tracers and append them to the hot instances as stretched quads. */
  private writeTracers(dt: number): void {
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (!this.tAlive[i]) continue;
      const spec = TRACER_SPECS[this.tKind[i]];
      const len = this.tLen[i];
      const head = this.tHead[i] + spec.speed * dt;
      // The head stops at the target; the streak behind it catches up, then it's gone.
      if (head - TRACER_STREAK >= len) {
        this.tAlive[i] = 0;
        continue;
      }
      this.tHead[i] = head;
      const h = Math.min(head, len);
      const t = Math.max(0, head - TRACER_STREAK);
      const seg = h - t;
      const mid = (h + t) / 2;
      const dx = this.tdx[i];
      const dz = this.tdz[i];
      // Fades as the tail reaches the target.
      const fade = head > len ? 1 - (head - len) / TRACER_STREAK : 1;
      const w = spec.width;
      this.hotOut.push(
        this.tx0[i] + dx * mid,
        GUN_Y,
        this.tz0[i] + dz * mid,
        w,
        dx * Math.max(0.01, seg - w),
        0,
        dz * Math.max(0.01, seg - w),
        0,
        spec.r,
        spec.g,
        spec.b,
        0.95 * fade,
        FRAME.streak,
        1,
      );
    }
  }

  /** A burnt-out fire particle hands off to a smoke puff where it died. */
  private fireToSmoke(pool: ParticlePool, i: number): void {
    const j = this.soft.spawn(
      pool.x[i],
      pool.y[i] + 0.4,
      pool.z[i],
      pool.vx[i] * 0.4 + this.windX,
      1.6 + Math.random() * 1.5,
      pool.vz[i] * 0.4 + this.windZ,
      1.8 + Math.random() * 1.4,
      pool.size1[i] * 0.8,
      pool.size1[i] * 1.9,
      RAMP.smoke,
      puffFrame(),
    );
    if (j < 0) return;
    this.smokeLook(j, 0.07 + Math.random() * 0.06, 0.75);
    this.soft.drag[j] = 0.8;
  }

  private fireLook(i: number, intensity: number, add: number): void {
    const k = intensity * (0.85 + Math.random() * 0.3);
    this.hot.r[i] = k;
    this.hot.g[i] = k;
    this.hot.b[i] = k;
    this.hot.add[i] = add;
    this.hot.spin[i] = (Math.random() - 0.5) * 2.5;
  }

  private smokeLook(i: number, shade: number, alpha: number): void {
    this.soft.r[i] = shade;
    this.soft.g[i] = shade;
    this.soft.b[i] = shade * 1.04;
    this.soft.alpha[i] = alpha;
    this.soft.spin[i] = (Math.random() - 0.5) * 0.9;
  }
}

const TRACER_KINDS: TracerKind[] = ['pistol', 'smg', 'shotgun', 'npc'];
const TRACER_SPECS = TRACER_KINDS.map((k) => TRACER[k]);
function kindIndex(kind: TracerKind): number {
  return TRACER_KINDS.indexOf(kind);
}

function puffFrame(): Frame {
  const r = Math.random();
  return r < 0.25 ? FRAME.puffA : r < 0.5 ? FRAME.puffB : r < 0.75 ? FRAME.puffD : FRAME.puffC;
}

/** Upload the filled part of a particle mesh's instance buffers. */
function upload(mesh: Mesh, out: InstanceBuffer): void {
  const geo = mesh.geometry as InstancedBufferGeometry;
  const n = out.count;
  geo.instanceCount = n;
  mesh.visible = n > 0;
  if (n === 0) return;
  for (let k = 0; k < INSTANCE_ATTRIBUTES.length; k++) {
    const a = geo.getAttribute(INSTANCE_ATTRIBUTES[k]) as InstancedBufferAttribute;
    a.clearUpdateRanges();
    a.addUpdateRange(0, n * a.itemSize);
    a.needsUpdate = true;
  }
}

const INSTANCE_ATTRIBUTES = ['iPos', 'iAxis', 'iCol', 'iFx'] as const;

/**
 * A camera-facing particle quad mesh over `out`'s arrays. Blending is
 * premultiplied: rgb·a is added and a·(1 − add) of what's behind is covered,
 * so one material does both smoke (add 0) and light (add 1). Tone mapping
 * and the output colour space run here like in any built-in material.
 */
function particleMesh(out: InstanceBuffer, atlas: Texture, ambient: { value: Rgb }, name: string): Mesh {
  const plane = new PlaneGeometry(1, 1);
  const geo = new InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.getAttribute('position'));
  geo.setAttribute('uv', plane.getAttribute('uv'));
  const attr = (array: Float32Array, size: number) => new InstancedBufferAttribute(array, size).setUsage(DynamicDrawUsage);
  geo.setAttribute('iPos', attr(out.pos, 4));
  geo.setAttribute('iAxis', attr(out.axis, 4));
  geo.setAttribute('iCol', attr(out.colour, 4));
  geo.setAttribute('iFx', attr(out.fx, 2));
  geo.instanceCount = 0;
  const material = new ShaderMaterial({
    uniforms: { map: { value: atlas }, uAmbient: ambient },
    vertexShader: /* glsl */ `
      attribute vec4 iPos;
      attribute vec4 iAxis;
      attribute vec4 iCol;
      attribute vec2 iFx;
      varying vec2 vUv;
      varying vec4 vCol;
      varying float vAdd;
      void main() {
        vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
        float size = iPos.w;
        vec2 corner = position.xy;
        // Stretched along the axis as seen on screen, or a turned square.
        vec3 axis = mat3(viewMatrix) * iAxis.xyz;
        float len = length(axis.xy);
        vec2 offset;
        if (len > 1e-4) {
          vec2 dir = axis.xy / len;
          // Clockwise of dir, so (across, dir) keeps the quad's winding
          // counter-clockwise: the other way round it faces away and is culled.
          vec2 across = vec2(dir.y, -dir.x);
          offset = dir * corner.y * (len + size) + across * corner.x * size;
        } else {
          float c = cos(iAxis.w);
          float s = sin(iAxis.w);
          offset = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
        }
        mv.xy += offset;
        gl_Position = projectionMatrix * mv;
        float f = iFx.x;
        vec2 cell = vec2(mod(f, ${ATLAS_CELLS.toFixed(1)}), ${(ATLAS_CELLS - 1).toFixed(1)} - floor(f / ${ATLAS_CELLS.toFixed(1)}));
        vUv = (cell + uv) / ${ATLAS_CELLS.toFixed(1)};
        vCol = iCol;
        vAdd = iFx.y;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 uAmbient;
      varying vec2 vUv;
      varying vec4 vCol;
      varying float vAdd;
      void main() {
        vec4 tex = texture2D(map, vUv);
        float a = tex.a * vCol.a;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol.rgb * tex.rgb * uAmbient, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - vAdd));
      }`,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false; // particles move; culled by being few
  mesh.visible = false;
  mesh.name = name;
  return mesh;
}
