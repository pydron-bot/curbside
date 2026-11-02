/**
 * What the stinger (W3-B, systems/stinger.ts) looks like: the one flat prop.
 * A black hinged strip with yellow hinge blocks and two rows of steel spikes,
 * built here (no GLB), drawn above life size across like the guns in hands
 * (a real one's 7 cm wide: a hair at 30 m up). Strips on the road unroll
 * from their middle as they land; one in flight is the strip folded up into
 * a tumbling block. One instanced mesh, one draw call only while a strip is
 * down or flying. Their contact shadows, a glint off the spikes (more at
 * night, in the headlights) and, while one is in hand, a ghost of where it
 * would lie go into the shared shadow and glow meshes. Nothing allocates per
 * frame.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Combat } from '../game/combat';
import { MAX_STINGERS, STINGER_LENGTH, STINGER_LIFE, STINGER_UNROLL, type StingerPlace } from '../systems/stinger';
import type { Rect } from '../world/city';
import { GLOW, uploadRange, type GlowSprites } from './glowSprites';
import type { Look } from './look';
import { worldUniforms } from './shaderLib';

/** Strips down plus a couple in the air. */
const CAPACITY = MAX_STINGERS + 2;
/** Drawn this wide across, m, and the carrier this thick. */
const WIDTH = 0.42;
const THICK = 0.04;
/** Hinged sections (a yellow block at each joint and end), and spikes per row per metre. */
const SECTIONS = 6;
const SPIKES_PER_M = 2.5;
/** Folded up in flight: this share of its length, this many times as thick. */
const FOLDED = 0.08;
const FOLDED_THICK = 5;
/** It fades into the road over its last this-many seconds. */
const FADE = 1;

const CARRIER = [0.06, 0.06, 0.065] as const;
const HINGE = [0.85, 0.62, 0.05] as const;
const STEEL = [0.72, 0.75, 0.8] as const;

/** Paint every vertex of `geo` one colour (linear rgb). */
function paint(geo: BufferGeometry, rgb: readonly [number, number, number]): BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  const n = flat.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  flat.setAttribute('color', new BufferAttribute(c, 3));
  flat.deleteAttribute('uv');
  return flat;
}

/** The strip, full length along local +X, lying on y = 0, spikes up. */
function stripGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const carrier = new BoxGeometry(STINGER_LENGTH, THICK, WIDTH * 0.7);
  carrier.translate(0, THICK / 2, 0);
  parts.push(paint(carrier, CARRIER));
  for (let i = 0; i <= SECTIONS; i++) {
    const hinge = new BoxGeometry(0.16, THICK * 1.6, WIDTH);
    hinge.translate((i / SECTIONS - 0.5) * (STINGER_LENGTH - 0.16), THICK * 0.8, 0);
    parts.push(paint(hinge, HINGE));
  }
  const n = Math.round(STINGER_LENGTH * SPIKES_PER_M);
  for (const row of [-0.1, 0.1]) {
    for (let i = 0; i < n; i++) {
      const spike = new ConeGeometry(0.045, 0.12, 4);
      // Rows staggered, so from above it's a sawtooth, not a ladder.
      const u = ((i + (row > 0 ? 0.75 : 0.25)) / n - 0.5) * STINGER_LENGTH;
      spike.translate(u, THICK + 0.06, row * WIDTH * 1.4);
      parts.push(paint(spike, STEEL));
    }
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged!;
}

export class StingerLook {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  private readonly aim: StingerPlace = { x: 0, z: 0, ax: 1, az: 0 };

  constructor(
    scene: Scene,
    look: Look,
    private readonly combat: Combat,
  ) {
    this.mesh = new InstancedMesh(stripGeometry(), new MeshLambertMaterial({ vertexColors: true }), CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'stingers';
    scene.add(this.mesh);
    look.addGlowSource((glows, view) => this.drawGlows(glows, view, look));
  }

  /** Per frame: place the strips down and the ones in flight. */
  update(): void {
    let n = 0;
    for (const st of this.combat.stingers.list) {
      if (!st.alive || n >= CAPACITY) continue;
      const unroll = Math.min(1, FOLDED + (1 - FOLDED) * (st.age / STINGER_UNROLL));
      // Settling into the road at the end rather than vanishing.
      const sink = Math.max(0, Math.min(1, (STINGER_LIFE - st.age) / FADE));
      this.e.set(0, Math.atan2(-st.az, st.ax), 0);
      this.put(n++, st.x, 0.01 - (1 - sink) * THICK * 2, st.z, unroll, unroll < 1 ? 1 + (FOLDED_THICK - 1) * (1 - unroll) : 1);
    }
    for (const p of this.combat.projectiles.list) {
      if (!p.alive || p.kind !== 'stinger' || n >= CAPACITY) continue;
      this.e.set(p.spin, Math.atan2(p.vx, p.vz), p.spin * 0.4);
      this.put(n++, p.x, p.y, p.z, FOLDED, FOLDED_THICK);
    }
    this.mesh.count = n;
    if (n > 0) uploadRange(this.mesh.instanceMatrix, n);
  }

  /** Instance `i` at (x, y, z) in `this.e`'s rotation, `along` of its length, `thick` times as thick. */
  private put(i: number, x: number, y: number, z: number, along: number, thick: number): void {
    this.q.setFromEuler(this.e);
    this.pos.set(x, y, z);
    this.scale.set(along, thick, 1);
    this.m.compose(this.pos, this.q, this.scale);
    this.mesh.setMatrixAt(i, this.m);
  }

  private drawGlows(glows: GlowSprites, view: Rect, look: Look): void {
    const t = worldUniforms.uTime.value;
    const night = worldUniforms.uNight.value;
    const shadows = look.contactShadows;
    const half = STINGER_LENGTH / 2;
    for (const st of this.combat.stingers.list) {
      if (!st.alive || st.x < view.minX - half || st.x > view.maxX + half || st.z < view.minZ - half || st.z > view.maxZ + half) continue;
      const unroll = Math.min(1, FOLDED + (1 - FOLDED) * (st.age / STINGER_UNROLL));
      const heading = Math.atan2(st.ax, st.az);
      shadows.add(st.x, st.z, heading, WIDTH * 0.5, half * unroll, 0.12, 0.4);
      // A glint running along the spikes now and then, brighter at night.
      const k = (0.25 + 0.75 * night) * Math.max(0, Math.sin(t * 1.7 + st.x * 0.3 + st.z * 0.2));
      if (k > 0.05 && unroll >= 1) {
        const u = Math.sin(t * 0.9 + st.z) * half * 0.8;
        glows.addFlat(st.x + st.ax * u, 0.14, st.z + st.az * u, 0, 0.5, 0.5, 1.2 * k, 1.25 * k, 1.35 * k, GLOW.disc);
      }
    }
    // In hand: a ghost of where it would lie (thrown, or dropped behind the car).
    if (this.combat.stingerAim(this.aim)) {
      const a = this.aim;
      const pulse = 0.55 + 0.25 * Math.sin(t * 7);
      glows.addFlat(a.x, 0.05, a.z, Math.atan2(a.ax, a.az), WIDTH * 0.9, STINGER_LENGTH, 1.3 * pulse, 0.95 * pulse, 0.2 * pulse, GLOW.bar);
    }
  }
}
