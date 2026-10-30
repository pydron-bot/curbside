import { BoxGeometry, Color, InstancedMesh, Matrix4, OctahedronGeometry, Quaternion, Vector3, type Object3D } from 'three';
import type { Rect } from '../world/city';
import { GLOW, uploadRange, type GlowSprites } from './glowSprites';
import { createPickupMaterial } from './pickupMesh';
import type { WorldProps } from './worldProps';

/** Linear RGB triples for the activity markers. */
export type Rgb = readonly [number, number, number];
export const MARK = {
  frenzy: [0.75, 0.2, 1.0],
  gold: [1.0, 0.68, 0.08],
  phone: [0.2, 0.95, 0.75],
  safehouse: [0.3, 1.0, 0.45],
  docks: [1.0, 0.45, 0.08],
  race: [1.0, 0.15, 0.5],
  white: [1.0, 1.0, 1.0],
  taxi: [1.0, 0.72, 0.08],
  objective: [1.0, 0.8, 0.12],
  target: [1.0, 0.12, 0.18],
  package: [0.35, 1.0, 0.25],
} as const satisfies Record<string, Rgb>;

/** Props further than this outside the view aren't drawn, m. */
const MARGIN = 6;

/**
 * Solid props for the activities: spinning hidden packages and mission
 * parcels, frenzy gems. With props.glb / pickups.glb in, they're models in
 * the world props' `things` family (`model()`, and the payphones are static
 * landmarks there); until then, or without them, stand-ins: one instanced
 * box mesh (packages, parcels, payphone booths) and one instanced gem mesh.
 * Refilled every frame with only what's near the view, and not drawn at all
 * when nothing is, so they cost a draw call (and one in the shadow pass)
 * only while one is on screen. The stand-ins share the pickup crates'
 * material and program: nothing new to compile.
 */
export class ProgressProps {
  readonly boxes: InstancedMesh;
  readonly gems: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  private readonly colour = new Color();
  private nBoxes = 0;
  private nGems = 0;

  constructor(
    private readonly world: WorldProps | null = null,
    capacityBoxes = 64,
    capacityGems = 16,
  ) {
    const material = createPickupMaterial();
    this.boxes = new InstancedMesh(new BoxGeometry(1, 1, 1), material, capacityBoxes);
    this.gems = new InstancedMesh(new OctahedronGeometry(0.62), material, capacityGems);
    for (const mesh of [this.boxes, this.gems]) {
      // Instance colours exist from the start, so the program compiled at
      // warm-up is the one used later (adding them would recompile).
      mesh.setColorAt(0, this.colour.setRGB(1, 1, 1));
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
    }
    this.boxes.name = 'progress-boxes';
    this.gems.name = 'progress-gems';
  }

  get objects(): Object3D[] {
    return [this.boxes, this.gems];
  }

  /** Are the models in (draw with model(); else the box and gem stand-ins)? */
  get modelled(): boolean {
    return this.world?.loaded ?? false;
  }

  /**
   * A props.glb / pickups.glb model for this frame (see WorldProps.things):
   * `kind` is its root name, scaled uniformly, turned `yaw`; (r, g, b) tints
   * surfaces that take a tint (the frenzy gem), `glow` lights it in its own
   * colours.
   */
  model(kind: string, x: number, y: number, z: number, yaw: number, scale = 1, r = 1, g = 1, b = 1, glow = 0): void {
    this.world?.things.add(kind, x, y, z, yaw, scale, scale, scale, 0, glow, r, g, b);
  }

  begin(): void {
    this.nBoxes = 0;
    this.nGems = 0;
  }

  /** A box centred `y` up, sized (sx, sy, sz), turned `yaw`; colour is sRGB-ish 0..1. */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, r: number, g: number, b: number): void {
    if (this.nBoxes >= this.boxes.instanceMatrix.count) return;
    this.q.setFromAxisAngle(this.up, yaw);
    this.m.compose(this.pos.set(x, y, z), this.q, this.scale.set(sx, sy, sz));
    this.boxes.setMatrixAt(this.nBoxes, this.m);
    this.boxes.setColorAt(this.nBoxes, this.colour.setRGB(r, g, b));
    this.nBoxes++;
  }

  gem(x: number, y: number, z: number, size: number, yaw: number, r: number, g: number, b: number): void {
    if (this.nGems >= this.gems.instanceMatrix.count) return;
    this.q.setFromAxisAngle(this.up, yaw);
    this.m.compose(this.pos.set(x, y, z), this.q, this.scale.set(size, size * 1.3, size));
    this.gems.setMatrixAt(this.nGems, this.m);
    this.gems.setColorAt(this.nGems, this.colour.setRGB(r, g, b));
    this.nGems++;
  }

  end(): void {
    finish(this.boxes, this.nBoxes);
    finish(this.gems, this.nGems);
  }
}

function finish(mesh: InstancedMesh, n: number): void {
  mesh.count = n;
  mesh.visible = n > 0;
  if (n === 0) return;
  uploadRange(mesh.instanceMatrix, n);
  if (mesh.instanceColor) uploadRange(mesh.instanceColor, n);
}

/** Is (x, z) within the view grown by `margin`? */
export function nearView(x: number, z: number, view: Rect, margin = MARGIN): boolean {
  return x > view.minX - margin && x < view.maxX + margin && z > view.minZ - margin && z < view.maxZ + margin;
}

/** A pulsing ring on the ground with a soft wash inside. */
export function groundRing(g: GlowSprites, x: number, z: number, size: number, c: Rgb, k: number, spin = 0): void {
  g.addFlat(x, 0.06, z, spin, size, size, c[0] * k, c[1] * k, c[2] * k, GLOW.ring);
  g.addFlat(x, 0.05, z, 0, size * 1.1, size * 1.1, c[0] * k * 0.22, c[1] * k * 0.22, c[2] * k * 0.22, GLOW.disc);
}

/** A light shaft standing on (x, z): two crossed upright quads so it reads from any angle. */
export function beacon(g: GlowSprites, x: number, z: number, width: number, height: number, c: Rgb, k: number, yaw = 0.6): void {
  g.addUpright(x, 0, z, yaw, width, height, c[0] * k, c[1] * k, c[2] * k, GLOW.beam);
  g.addUpright(x, 0, z, yaw + Math.PI / 2, width, height, c[0] * k, c[1] * k, c[2] * k, GLOW.beam);
}

/**
 * A race checkpoint: a ring across the road with a pillar of light either
 * side (a gate seen from above), `heading` the way through.
 */
export function gate(g: GlowSprites, x: number, z: number, heading: number, width: number, c: Rgb, k: number, t: number): void {
  const ax = Math.cos(heading);
  const az = -Math.sin(heading);
  const half = width / 2;
  groundRing(g, x, z, width * 1.05, c, k, t * 0.5);
  for (let side = -1; side <= 1; side += 2) beacon(g, x + ax * half * side, z + az * half * side, 1.4, 12, c, k * 0.9);
  g.addFlat(x, 0.07, z, heading + Math.PI / 2, 0.6, width, c[0] * k * 0.7, c[1] * k * 0.7, c[2] * k * 0.7, GLOW.bar);
}

/** A chequered start line across the road (white squares in two rows), `heading` the way out. */
export function chequer(g: GlowSprites, x: number, z: number, heading: number, width: number, k: number): void {
  const ax = Math.cos(heading);
  const az = -Math.sin(heading);
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const n = 8;
  const cell = width / n;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < n; i++) {
      if ((i + row) % 2) continue;
      const a = (i + 0.5) * cell - width / 2;
      const b = (row - 0.5) * cell;
      g.addFlat(x + ax * a + fx * b, 0.06, z + az * a + fz * b, heading, cell * 0.95, cell * 0.95, k, k, k, GLOW.bar);
    }
  }
}

/** Chevrons marching along `heading` toward (x, z): "this way in". */
export function chevrons(g: GlowSprites, x: number, z: number, heading: number, c: Rgb, k: number, t: number, length = 6): void {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  for (let i = 0; i < 3; i++) {
    const phase = (t * 1.1 + i / 3) % 1;
    const along = -length + phase * length;
    const a = Math.sin(phase * Math.PI) * k;
    g.addFlat(x + fx * along, 0.07, z + fz * along, heading, 1.5, 1.1, c[0] * a, c[1] * a, c[2] * a, GLOW.chevron);
  }
}
