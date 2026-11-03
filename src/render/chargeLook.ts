/**
 * What the sticky charge (W3-B, systems/charges.ts) looks like out of the
 * hand: a dark brick with a red detonator box, built here until Blender's
 * `charge_stuck` arrives (BLENDER_TODO §15), drawn well above life size (a
 * real one is 16 cm: nothing at 30 m up) so it reads on a roof at 852×340.
 * A stuck one sits on its car as drawn this frame (the interpolated pose,
 * so it doesn't shiver on a fast car): on the roof over the cabin, else on
 * the bonnet or boot lid at the hood line. One in flight tumbles. One
 * instanced mesh (the stingers' material, so no new program), one draw call
 * only while a charge is out or flying; the blinking red light and a ring
 * round a car that carries one go into the shared glow mesh, the brick's
 * shadow into the contact shadows. Nothing allocates per frame.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, type Scene } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Combat } from '../game/combat';
import { MAX_CHARGES } from '../systems/charges';
import type { Rect } from '../world/city';
import { GLOW, uploadRange, type GlowSprites } from './glowSprites';
import type { Look } from './look';
import { worldUniforms } from './shaderLib';

/** Out plus a couple in the air. */
const CAPACITY = MAX_CHARGES + 2;
/** Drawn this many times life size. */
const SCALE = 3;
/** The brick, m (life size): across, high, along. */
const BRICK = [0.16, 0.07, 0.11] as const;
/** The light blinks this often, Hz. */
const BLINK = 1.6;

const BODY = [0.07, 0.075, 0.08] as const;
const TAPE = [0.55, 0.5, 0.42] as const;
const BOX = [0.85, 0.08, 0.05] as const;

function paint(geo: BufferGeometry, rgb: readonly [number, number, number]): BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  const n = flat.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  flat.setAttribute('color', new BufferAttribute(c, 3));
  flat.deleteAttribute('uv');
  return flat;
}

/** The charge at life size, sitting on y = 0, long side across (local X). */
function chargeGeometry(): BufferGeometry {
  const [w, h, l] = BRICK;
  const parts = [
    paint(new BoxGeometry(w, h, l).translate(0, h / 2, 0), BODY),
    // A band of tape round the middle, and the detonator box on top.
    paint(new BoxGeometry(w * 0.22, h * 1.06, l * 1.06).translate(-w * 0.18, h / 2, 0), TAPE),
    paint(new BoxGeometry(w * 0.32, h * 0.45, l * 0.5).translate(w * 0.2, h * 1.2, 0), BOX),
  ];
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged!;
}

export class ChargeLook {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private readonly pos = new Vector3();
  private readonly scale = new Vector3(SCALE, SCALE, SCALE);
  /** Where each live charge was drawn this frame (x, y, z, yaw), for the glows. */
  private readonly drawn = new Float32Array(CAPACITY * 4);
  private drawnCount = 0;

  constructor(
    scene: Scene,
    private readonly look: Look,
    private readonly combat: Combat,
  ) {
    this.mesh = new InstancedMesh(chargeGeometry(), new MeshLambertMaterial({ vertexColors: true }), CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'charges';
    scene.add(this.mesh);
    look.addGlowSource((glows, view) => this.drawGlows(glows, view));
  }

  /** Per frame, after the cars' render poses are set: charges on cars, on the road, in flight. */
  update(): void {
    let n = 0;
    let lit = 0;
    for (const c of this.combat.charges.list) {
      if (!c.alive || n >= CAPACITY) continue;
      let x = c.x;
      let y = c.y;
      let z = c.z;
      let yaw = 0;
      const v = c.car;
      if (v) {
        const root = v.mesh.root;
        yaw = root.rotation.y;
        const d = this.look.cars.dims(v.archetype);
        // Seated on the model: inside its outline, on the roof over the cabin, else at the hood line.
        let lx = c.lx;
        let lz = c.lz;
        let top = 1.5;
        if (d) {
          lx = Math.max(-d.halfWidth * 0.6, Math.min(d.halfWidth * 0.6, lx));
          lz = Math.max(-d.rear * 0.85, Math.min(d.front * 0.85, lz));
          top = lz >= d.cabinFrom && lz <= d.cabinTo ? d.height : d.hood;
        }
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        x = root.position.x + lx * cos + lz * sin;
        z = root.position.z - lx * sin + lz * cos;
        y = root.position.y + top;
      }
      this.e.set(0, yaw, 0);
      this.put(n++, x, y, z);
      const k = lit++ * 4;
      this.drawn[k] = x;
      this.drawn[k + 1] = y;
      this.drawn[k + 2] = z;
      this.drawn[k + 3] = v ? 1 : 0;
    }
    this.drawnCount = lit;
    for (const p of this.combat.projectiles.list) {
      if (!p.alive || p.kind !== 'charge' || n >= CAPACITY) continue;
      this.e.set(p.spin, Math.atan2(p.vx, p.vz), p.spin * 0.5);
      this.put(n++, p.x, p.y, p.z);
    }
    this.mesh.count = n;
    if (n > 0) uploadRange(this.mesh.instanceMatrix, n);
  }

  private put(i: number, x: number, y: number, z: number): void {
    this.q.setFromEuler(this.e);
    this.pos.set(x, y, z);
    this.m.compose(this.pos, this.q, this.scale);
    this.mesh.setMatrixAt(i, this.m);
  }

  /** The blinking light on each charge, a ring under a car that carries one, the brick's shadow on the road. */
  private drawGlows(glows: GlowSprites, view: Rect): void {
    const n = this.drawnCount;
    if (n === 0) return;
    const t = worldUniforms.uTime.value;
    const on = (t * BLINK) % 1 < 0.45;
    const shadows = this.look.contactShadows;
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      const x = this.drawn[k];
      const y = this.drawn[k + 1];
      const z = this.drawn[k + 2];
      if (x < view.minX - 3 || x > view.maxX + 3 || z < view.minZ - 3 || z > view.maxZ + 3) continue;
      const onCar = this.drawn[k + 3] > 0;
      const top = y + BRICK[1] * SCALE * 1.45;
      if (on) glows.addFlat(x, top, z, 0, 0.9, 0.9, 2.2, 0.25, 0.15, GLOW.disc);
      // A faint red ring on the road round the car (or the charge) so it's found at a glance.
      const pulse = 0.35 + 0.25 * Math.sin(t * BLINK * Math.PI * 2);
      glows.addFlat(x, 0.06, z, 0, onCar ? 4.2 : 1.8, onCar ? 4.2 : 1.8, 0.9 * pulse, 0.12 * pulse, 0.08 * pulse, GLOW.ring);
      if (!onCar) shadows.add(x, z, 0, BRICK[0] * SCALE * 0.6, BRICK[2] * SCALE * 0.6, 0.12, 0.35);
    }
  }
}
