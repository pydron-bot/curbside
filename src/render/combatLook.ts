/**
 * What combat looks like beyond the shots and blasts FxDirector already
 * handles: grenades, molotov bottles and rockets in flight (one instanced
 * box mesh, one draw call only while something flies), the rocket's smoke
 * trail and flame, a grenade's blinking fuse light, the throw marker (a
 * landing ring and a dotted arc from the hand), the red lock-on ring under
 * the target, molotov fire patches and people on fire.
 *
 * Particles go through Effects' pools; rings, arcs, fire glows and the
 * projectiles' contact shadows go into the shared glow and shadow meshes
 * (no draw calls of their own). Nothing allocates per frame.
 */
import { BoxGeometry, Color, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, type Scene } from 'three';
import type { Combat } from '../game/combat';
import type { CrowdPed } from '../game/population';
import { GRENADE_FUSE, THROW_GRAVITY, THROW_HEIGHT, throwVelocity, type Projectile } from '../systems/projectiles';
import type { Rect } from '../world/city';
import type { Effects } from './effects';
import { GLOW, type GlowSprites } from './glowSprites';
import type { Look } from './look';
import { worldUniforms } from './shaderLib';

const CAPACITY = 24;
/** Dots in the throw arc preview. */
const ARC_DOTS = 9;

const GRENADE_COLOUR = new Color('#4b5a2a');
const BOTTLE_COLOUR = new Color('#c9822b');
const ROCKET_COLOUR = new Color('#6f7a4a');

export class CombatLook {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  /** Particles owed per projectile slot and per fire slot (emission at a rate). */
  private readonly debt = new Float32Array(CAPACITY);
  private readonly fireDebt = new Float32Array(16);
  private time = 0;
  private readonly arc = { vx: 0, vy: 0, vz: 0, time: 0 };

  constructor(
    scene: Scene,
    look: Look,
    private readonly effects: Effects,
    private readonly combat: Combat,
    private readonly crowd: readonly CrowdPed[],
    private readonly player: { readonly ped: { x: number; z: number }; driving: unknown },
  ) {
    const material = new MeshLambertMaterial();
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, CAPACITY);
    // Colour every slot now so the instance-colour attribute (and its shader
    // variant) exists from the first compile, not from the first throw.
    for (let i = 0; i < CAPACITY; i++) this.mesh.setColorAt(i, GRENADE_COLOUR);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'projectiles';
    scene.add(this.mesh);
    look.addGlowSource((glows, view) => this.drawGlows(glows, view, look));
  }

  /** Per frame (effect time): place what flies, and emit trails and flames. */
  update(dt: number): void {
    this.time += dt;
    const fx = this.effects;
    const scale = fx.scale;
    let n = 0;
    const list = this.combat.projectiles.list;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.alive) {
        this.debt[i] = 0;
        continue;
      }
      this.place(p, n++);
      if (dt <= 0) continue;
      if (p.kind === 'rocket') {
        const sp = Math.hypot(p.vx, p.vz) || 1;
        const bx = p.x - (p.vx / sp) * 0.6;
        const bz = p.z - (p.vz / sp) * 0.6;
        // A hot tail flame every frame, a smoke trail at a rate.
        fx.flare(bx, p.y, bz, 0.55, 0.05, 2.8, 1.8, 0.7);
        this.debt[i] += dt * 55 * Math.max(0.5, scale);
        while (this.debt[i] >= 1) {
          this.debt[i] -= 1;
          fx.puff(bx, p.y, bz, 0.78, 0.35, 1.8, 0.55, -p.vx * 0.04, 0.5, -p.vz * 0.04, 1.6);
        }
      } else if (p.kind === 'molotov') {
        this.debt[i] += dt * 30 * scale;
        while (this.debt[i] >= 1) {
          this.debt[i] -= 1;
          fx.flare(p.x, p.y + 0.25, p.z, 0.4, 0.08, 2.6, 1.4, 0.4);
        }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = n > 0;
    if (this.mesh.instanceColor && n > 0) {
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, n * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
    if (dt <= 0) return;

    // Fire patches: flames over the area, a little smoke, more while fresh.
    const fires = this.combat.projectiles.fires;
    for (let i = 0; i < fires.length; i++) {
      const f = fires[i];
      if (!f.alive) {
        this.fireDebt[i] = 0;
        continue;
      }
      const left = 1 - f.age / f.life;
      const r = f.radius * Math.min(1, 0.4 + f.age * 3);
      this.fireDebt[i] += dt * (16 + 26 * left) * r * 0.5 * scale;
      while (this.fireDebt[i] >= 1) {
        this.fireDebt[i] -= 1;
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * r * 0.85;
        if (Math.random() < 0.12) fx.emitSmoke(f.x + Math.cos(a) * d, f.z + Math.sin(a) * d, 0.6, 0.7);
        else fx.emitFire(f.x + Math.cos(a) * d, f.z + Math.sin(a) * d, 0.15);
      }
    }
    // People on fire.
    const rate = dt * 22 * scale;
    for (const c of this.crowd) {
      if (c.agent.burning > 0 && Math.random() < rate) fx.emitFire(c.agent.s.x, c.agent.s.z, c.agent.mode === 'down' ? 0.3 : 0.9);
    }
  }

  /** Write one projectile's transform and colour into instance `i`. */
  private place(p: Projectile, i: number): void {
    const sp = Math.hypot(p.vx, p.vz);
    const yaw = sp > 0.01 ? Math.atan2(p.vx, p.vz) : 0;
    if (p.kind === 'rocket') {
      this.e.set(0, yaw, p.spin);
      this.scale.set(0.22, 0.22, 0.95);
      this.mesh.setColorAt(i, ROCKET_COLOUR);
    } else if (p.kind === 'molotov') {
      // Tumbling end over end.
      this.e.set(p.spin, yaw, 0);
      this.scale.set(0.17, 0.17, 0.42);
      this.mesh.setColorAt(i, BOTTLE_COLOUR);
    } else {
      this.e.set(p.spin, yaw, p.spin * 0.6);
      this.scale.set(0.3, 0.3, 0.36);
      this.mesh.setColorAt(i, GRENADE_COLOUR);
    }
    this.q.setFromEuler(this.e);
    this.pos.set(p.x, p.y, p.z);
    this.m.compose(this.pos, this.q, this.scale);
    this.mesh.setMatrixAt(i, this.m);
  }

  private drawGlows(glows: GlowSprites, view: Rect, look: Look): void {
    const t = worldUniforms.uTime.value;
    const night = worldUniforms.uNight.value;
    const c = this.combat;
    // The throw marker: a landing ring and a dotted arc from the hand.
    if (c.marker.show && !this.player.driving) {
      // Orange; red and quicker when a wall cuts the throw short.
      const blocked = c.marker.blocked;
      const pulse = 0.5 + 0.5 * Math.sin(t * (blocked ? 16 : 9));
      const k = 0.75 + 0.35 * pulse;
      const r = blocked ? 2 : 1.6;
      const g = blocked ? 0.12 : 0.55;
      glows.addFlat(c.marker.x, 0.06, c.marker.z, t * 2, 2.6, 2.6, r * k, g * k, 0.2 * k, GLOW.ring);
      glows.addFlat(c.marker.x, 0.05, c.marker.z, 0, 1.2, 1.2, 0.9 * k, g * 0.55 * k, 0.1 * k, GLOW.disc);
      const p = this.player.ped;
      throwVelocity(p.x, p.z, c.marker.x, c.marker.z, this.arc);
      for (let i = 1; i < ARC_DOTS; i++) {
        const s = (i / ARC_DOTS) * this.arc.time;
        const y = THROW_HEIGHT + this.arc.vy * s - 0.5 * THROW_GRAVITY * s * s;
        const a = 0.55 + 0.45 * Math.sin(t * 10 - i * 0.8);
        glows.addFlat(p.x + this.arc.vx * s, Math.max(0.1, y), p.z + this.arc.vz * s, 0, 0.32, 0.32, 1.4 * a, 0.9 * a, 0.5 * a, GLOW.disc);
      }
    }
    // Lock-on: a red ring under the target.
    const lock = c.lock;
    if (lock) {
      const s = lock.agent.s;
      const k = 0.8 + 0.2 * Math.sin(t * 12);
      glows.addFlat(s.x, 0.06, s.z, -t * 3, 1.9, 1.9, 2.2 * k, 0.25 * k, 0.2 * k, GLOW.ring);
    }
    // Fire patches glow, flickering; brighter at night.
    const strength = 0.55 + 0.7 * night;
    for (const f of c.projectiles.fires) {
      if (!f.alive || f.x < view.minX - 8 || f.x > view.maxX + 8 || f.z < view.minZ - 8 || f.z > view.maxZ + 8) continue;
      const left = 1 - f.age / f.life;
      const flicker = 0.75 + 0.15 * Math.sin(t * 21 + f.x) + 0.1 * Math.sin(t * 33 + f.z);
      const k = strength * flicker * Math.min(1, left * 3);
      const size = f.radius * 2.6;
      glows.addFlat(f.x, 0.08, f.z, 0, size, size, 1.1 * k, 0.45 * k, 0.1 * k, GLOW.disc);
    }
    // Things in flight: a shadow on the ground (shrinking with height), the
    // rocket's light, a grenade's fuse blinking faster as it runs down.
    const shadows = look.contactShadows;
    for (const p of c.projectiles.list) {
      if (!p.alive) continue;
      const fade = 1 / (1 + p.y * 0.5);
      const r = p.kind === 'rocket' ? 0.18 : 0.14;
      shadows.add(p.x, p.z, Math.atan2(p.vx, p.vz), r, p.kind === 'rocket' ? 0.45 : r, 0.15, 0.55 * fade);
      if (p.kind === 'rocket') {
        glows.addFlat(p.x, 0.1, p.z, 0, 4, 4, 1.4, 0.75, 0.3, GLOW.disc);
      } else if (p.kind === 'grenade') {
        const rate = 3 + (1 - Math.max(0, p.fuse) / GRENADE_FUSE) * 12;
        if (Math.sin(this.time * rate * Math.PI * 2) > 0.3) glows.addFlat(p.x, p.y + 0.2, p.z, 0, 0.5, 0.5, 2.4, 0.3, 0.2, GLOW.disc);
      }
    }
  }
}
