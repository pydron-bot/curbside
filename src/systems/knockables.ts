/**
 * Street furniture a car knocks flying instead of stopping dead at:
 * hydrants, bins, newspaper boxes, mailboxes, benches, cones. Each step,
 * every moving car's body is checked against the few within reach (a
 * bucket grid); one it touches is knocked (the car loses a little speed,
 * more for a bench) and reported, and it comes back a minute later once
 * nobody's looking. Standing ones are solid to people (collidePed), who
 * only bump into them. Pure logic, no three.js: the game hides the prop and
 * throws a copy of it (render/knockFx.ts).
 */
import { PED_RADIUS, bodyOf } from './physics';
import type { PedState } from '../entities/pedestrian';
import type { VehicleState } from '../entities/vehicle';
import type { Rect } from '../world/city';

export interface KnockableItem {
  /** The caller's id for it (the renderer's handle). */
  id: number;
  kind: string;
  x: number;
  z: number;
  radius: number;
  /** Half-sizes of its box (benches): people collide with this instead of the radius, m. */
  hx?: number;
  hz?: number;
}

/** Slower than this (m/s) a car just nudges things (and stops against nothing: they're not solid). */
export const KNOCK_SPEED = 3;
/** A knocked prop is back this long after, once out of view, s. */
export const KNOCK_RESPAWN = 60;
/** Share of a car's speed a knock costs it. */
const DRAG: Readonly<Record<string, number>> = { bench: 0.12, mailbox: 0.06, newspaper_box: 0.05, hydrant: 0.05, trash_bin: 0.04, traffic_cone: 0.01 };
const CELL = 16;

export class Knockables {
  private readonly items: KnockableItem[];
  private readonly knockedAt: Float64Array;
  private readonly cells = new Map<number, number[]>();
  /** Sim time, s (stepped by step()). */
  private time = 0;

  constructor(items: readonly KnockableItem[]) {
    this.items = items.slice();
    this.knockedAt = new Float64Array(this.items.length).fill(-1);
    this.items.forEach((k, i) => {
      const key = cellKey(Math.floor(k.x / CELL), Math.floor(k.z / CELL));
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(i);
    });
  }

  get count(): number {
    return this.items.length;
  }

  /** Is the item with this id lying knocked over? */
  isKnocked(id: number): boolean {
    const i = this.items.findIndex((k) => k.id === id);
    return i >= 0 && this.knockedAt[i] >= 0;
  }

  /**
   * One sim step: cars moving faster than KNOCK_SPEED knock what their body
   * touches; `onKnock(item, car)` hears about each (after the car is slowed).
   */
  step(cars: readonly VehicleState[], dt: number, onKnock: (item: KnockableItem, car: VehicleState) => void): void {
    const now = (this.time += dt);
    for (const s of cars) {
      if (s.y > 0.6) continue;
      const v2 = s.vx * s.vx + s.vz * s.vz;
      if (v2 < KNOCK_SPEED * KNOCK_SPEED) continue;
      const body = bodyOf(s);
      const cx0 = Math.floor((s.x - body.reach - 1) / CELL);
      const cz0 = Math.floor((s.z - body.reach - 1) / CELL);
      const cx1 = Math.floor((s.x + body.reach + 1) / CELL);
      const cz1 = Math.floor((s.z + body.reach + 1) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const list = this.cells.get(cellKey(cx, cz));
          if (!list) continue;
          for (const i of list) {
            if (this.knockedAt[i] >= 0) continue;
            if (this.touches(s, this.items[i], body.radius)) {
              this.knockedAt[i] = now;
              const keep = 1 - (DRAG[this.items[i].kind] ?? 0.04);
              s.vx *= keep;
              s.vz *= keep;
              onKnock(this.items[i], s);
            }
          }
        }
      }
    }
  }

  /**
   * Keep a person out of the standing furniture around them (a bench by its
   * box, the rest by their radius): pushed clear, with their speed into it
   * removed. People don't knock things over. Allocates nothing.
   */
  collidePed(p: PedState, radius = PED_RADIUS): void {
    const cx0 = Math.floor((p.x - radius - 1) / CELL);
    const cz0 = Math.floor((p.z - radius - 1) / CELL);
    const cx1 = Math.floor((p.x + radius + 1) / CELL);
    const cz1 = Math.floor((p.z + radius + 1) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.cells.get(cellKey(cx, cz));
        if (!list) continue;
        for (let j = 0; j < list.length; j++) {
          const i = list[j];
          if (this.knockedAt[i] >= 0) continue;
          const k = this.items[i];
          let nx: number;
          let nz: number;
          let depth: number;
          if (k.hx !== undefined && k.hz !== undefined) {
            const dx = p.x - Math.max(k.x - k.hx, Math.min(p.x, k.x + k.hx));
            const dz = p.z - Math.max(k.z - k.hz, Math.min(p.z, k.z + k.hz));
            const d2 = dx * dx + dz * dz;
            if (d2 >= radius * radius) continue;
            if (d2 > 1e-12) {
              const d = Math.sqrt(d2);
              nx = dx / d;
              nz = dz / d;
              depth = radius - d;
            } else {
              // Centre inside the box: out through the nearer side.
              const ox = k.hx - Math.abs(p.x - k.x);
              const oz = k.hz - Math.abs(p.z - k.z);
              nx = ox < oz ? (p.x < k.x ? -1 : 1) : 0;
              nz = ox < oz ? 0 : p.z < k.z ? -1 : 1;
              depth = Math.min(ox, oz) + radius;
            }
          } else {
            const dx = p.x - k.x;
            const dz = p.z - k.z;
            const reach = radius + k.radius;
            const d2 = dx * dx + dz * dz;
            if (d2 >= reach * reach) continue;
            const d = Math.sqrt(d2);
            nx = d > 1e-6 ? dx / d : 1;
            nz = d > 1e-6 ? dz / d : 0;
            depth = reach - d;
          }
          p.x += nx * depth;
          p.z += nz * depth;
          const vn = p.vx * nx + p.vz * nz;
          if (vn < 0) {
            p.vx -= vn * nx;
            p.vz -= vn * nz;
          }
        }
      }
    }
  }

  /**
   * Put back what was knocked over more than KNOCK_RESPAWN ago and is out of
   * `view` (grown by a margin), calling `onRestore` for each.
   */
  restore(view: Rect, onRestore: (item: KnockableItem) => void): void {
    for (let i = 0; i < this.items.length; i++) {
      const t = this.knockedAt[i];
      if (t < 0 || this.time - t < KNOCK_RESPAWN) continue;
      const k = this.items[i];
      if (k.x > view.minX - 8 && k.x < view.maxX + 8 && k.z > view.minZ - 8 && k.z < view.maxZ + 8) continue;
      this.knockedAt[i] = -1;
      onRestore(k);
    }
  }

  /** Everything back up (a fresh run). */
  reset(onRestore: (item: KnockableItem) => void): void {
    for (let i = 0; i < this.items.length; i++) {
      if (this.knockedAt[i] < 0) continue;
      this.knockedAt[i] = -1;
      onRestore(this.items[i]);
    }
  }

  private touches(s: VehicleState, k: KnockableItem, radius: number): boolean {
    const reach = radius + k.radius;
    const body = bodyOf(s);
    if (Math.abs(s.x - k.x) > body.reach + k.radius || Math.abs(s.z - k.z) > body.reach + k.radius) return false;
    const offsets = body.offsets;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    for (let j = 0; j < offsets.length; j++) {
      const dx = s.x + fx * offsets[j] - k.x;
      const dz = s.z + fz * offsets[j] - k.z;
      if (dx * dx + dz * dz < reach * reach) return true;
    }
    return false;
  }
}

function cellKey(cx: number, cz: number): number {
  return ((cx + 32768) << 16) | (cz + 32768);
}
