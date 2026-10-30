import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Rect } from '../world/city';
import type { Effects } from './effects';
import type { PropBatch } from './propBatch';
import { worldUniforms } from './shaderLib';
import type { WorldProps } from './worldProps';

/** Flying props at once (the oldest is dropped past this). */
const MAX_FLYERS = 24;
const FLY_LIFE = 2.6;
const GRAVITY = 22;
/** A burst hydrant gushes this long, s, emitting this many puffs a second. */
const SPRAY_SECONDS = 14;
const SPRAY_RATE = 28;
const MAX_SPRAYS = 6;

interface Flyer {
  kind: string;
  /** The props family that draws it (street furniture, or a roadblock's barrier from `things`). */
  family: PropBatch;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  age: number;
}

/**
 * What a car hitting street furniture looks like: the prop (hidden where it
 * stood) flies off as a copy of its model, tumbling and bouncing, then
 * shrinks away; a hydrant leaves a column of water gushing from its stump
 * for a while; a little dust and a few sparks off metal. The copies are
 * dynamic instances in the world props' street family (a roadblock's
 * sawhorse barrier in `things`; no extra draw call), the rest goes through
 * the shared particles.
 */
export class KnockFx {
  private readonly flyers: Flyer[] = [];
  private readonly sprays: Array<{ x: number; z: number; left: number; debt: number }> = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private lastTime = -1;

  constructor(
    private readonly props: WorldProps,
    private readonly effects: Effects,
  ) {}

  /** `kind` at (x, z) was hit by a car moving at (vx, vz). */
  hit(kind: string, x: number, z: number, vx: number, vz: number): void {
    const sp = Math.hypot(vx, vz);
    if (this.flyers.length >= MAX_FLYERS) this.flyers.shift();
    const light = kind === 'traffic_cone' || kind === 'trash_bin' || kind === 'newspaper_box';
    const k = light ? 0.95 : 0.7;
    const a = (Math.random() - 0.5) * 0.9;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const street = this.props.street;
    this.flyers.push({
      kind,
      family: street.kindOf(kind) >= 0 ? street : this.props.things,
      x,
      y: 0,
      z,
      vx: (vx * c - vz * sn) * k,
      vy: 3 + Math.min(7, sp * 0.25) + Math.random() * 2,
      vz: (vx * sn + vz * c) * k,
      rx: 0,
      ry: Math.random() * 6.3,
      rz: 0,
      wx: (Math.random() - 0.5) * 14,
      wy: (Math.random() - 0.5) * 8,
      wz: (Math.random() - 0.5) * 14,
      age: 0,
    });
    this.effects.dustRing(x, z, 6, 0.4, 2.5);
    if (kind !== 'traffic_cone' && kind !== 'bench') this.effects.sparks(x, 0.6, z, 6, 3, 8, vx / (sp || 1), vz / (sp || 1));
    if (kind === 'hydrant') {
      if (this.sprays.length >= MAX_SPRAYS) this.sprays.shift();
      this.sprays.push({ x, z, left: SPRAY_SECONDS, debt: 0 });
    }
  }

  /** Everything gone (a fresh run). */
  clear(): void {
    this.flyers.length = 0;
    this.sprays.length = 0;
  }

  /** Per frame, between the props' begin() and end() (a Look glow source): fly the copies, gush the hydrants. */
  update(view: Rect): void {
    const now = worldUniforms.uTime.value;
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.age += dt;
      if (f.age >= FLY_LIFE) {
        this.flyers.splice(i, 1);
        continue;
      }
      f.vy -= GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      if (f.y < 0) {
        f.y = 0;
        if (f.vy < -2) {
          f.vy = -f.vy * 0.3;
          f.wx *= 0.5;
          f.wz *= 0.5;
        } else f.vy = 0;
        const drag = Math.exp(-5 * dt);
        f.vx *= drag;
        f.vz *= drag;
      }
      // Tumbling in the air; on the ground it settles on its side.
      f.rx += f.wx * dt;
      f.ry += f.wy * dt;
      f.rz += f.wz * dt;
      if (f.y === 0 && f.vy === 0) {
        f.rx += (Math.PI / 2 - f.rx) * Math.min(1, dt * 8);
        f.wx *= Math.exp(-6 * dt);
        f.wz *= Math.exp(-6 * dt);
      }
      if (f.x < view.minX - 10 || f.x > view.maxX + 10 || f.z < view.minZ - 10 || f.z > view.maxZ + 10) continue;
      const t = f.age / FLY_LIFE;
      const shrink = t > 0.8 ? (1 - t) / 0.2 : 1;
      this.q.setFromEuler(this.e.set(f.rx, f.ry, f.rz));
      this.m.compose(this.p.set(f.x, f.y + 0.3, f.z), this.q, this.s.set(shrink, shrink, shrink));
      f.family.addMatrix(f.kind, this.m);
    }
    for (let i = this.sprays.length - 1; i >= 0; i--) {
      const s = this.sprays[i];
      s.left -= dt;
      if (s.left <= 0) {
        this.sprays.splice(i, 1);
        continue;
      }
      if (s.x < view.minX - 6 || s.x > view.maxX + 6 || s.z < view.minZ - 6 || s.z > view.maxZ + 6) continue;
      const strength = Math.min(1, s.left / 3);
      s.debt += dt * SPRAY_RATE * strength;
      while (s.debt >= 1) {
        s.debt -= 1;
        const a = Math.random() * Math.PI * 2;
        const out = 0.4 + Math.random() * 0.8;
        const p = this.effects.puff(s.x, 0.5, s.z, 0.9, 0.25, 1.1 + Math.random() * 0.6, 0.55, Math.cos(a) * out, 6 + Math.random() * 4 * strength, Math.sin(a) * out, 0.9 + Math.random() * 0.4);
        if (p >= 0) {
          // Water, not dust: cool white.
          this.effects.soft.r[p] = 0.78;
          this.effects.soft.g[p] = 0.88;
          this.effects.soft.b[p] = 1.0;
        }
      }
    }
  }
}
