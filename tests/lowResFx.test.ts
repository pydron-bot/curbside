import { Matrix4, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import {
  SWITCH_ON,
  TILES_X,
  TILES_Y,
  coverShare,
  emptyCover,
  lowResCost,
  lowResPays,
  lowResSize,
  occluderChunks,
  particleCover,
} from '../src/render/lowResFxPlan';
import { QUALITY_TIERS } from '../src/render/quality';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Instance arrays for particles given as [x, y, z, size, stretch x, y, z]. */
function instances(...ps: number[][]) {
  const pos = new Float32Array(ps.length * 4);
  const axis = new Float32Array(ps.length * 4);
  ps.forEach(([x, y, z, size, ax = 0, ay = 0, az = 0], i) => {
    pos.set([x, y, z, size], i * 4);
    axis.set([ax, ay, az, 0], i * 4);
  });
  return { pos, axis, count: ps.length };
}

function covered(c: ReturnType<typeof emptyCover>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  c.tiles.forEach((t, i) => t && out.push([i % TILES_X, Math.floor(i / TILES_X)]));
  return out;
}

describe('low-resolution soft particles: target size', () => {
  it('scales the drawing buffer, rounding up, never below 1×1', () => {
    const s = { width: 0, height: 0 };
    expect(lowResSize(1278, 590, 0.5, s)).toEqual({ width: 639, height: 295 });
    expect(lowResSize(1065, 491, 0.5, s)).toEqual({ width: 533, height: 246 });
    expect(lowResSize(1065, 491, 0.25, s)).toEqual({ width: 267, height: 123 });
    expect(lowResSize(1, 1, 0.25, s)).toEqual({ width: 1, height: 1 });
    expect(lowResSize(0, 0, 0.5, s)).toEqual({ width: 1, height: 1 });
  });

  it('high keeps smoke with the scene; the phone tiers draw it at half resolution', () => {
    expect(QUALITY_TIERS.high.fxScale).toBe(1);
    expect(QUALITY_TIERS.medium.fxScale).toBe(0.5);
    for (const t of Object.values(QUALITY_TIERS)) expect(t.fxScale).toBeGreaterThan(0);
  });
});

describe('low-resolution soft particles: screen cover', () => {
  it('marks the tiles a particle overlaps and counts its fill', () => {
    const c = emptyCover();
    const { pos, axis, count } = instances([0, 0, 0, 0.25]);
    particleCover(pos, axis, count, IDENTITY, 1, 1, c);
    // Corners at radius 0.177 in any turn: NDC ±0.177, tiles 6..9 across, 3..4 up.
    const t = covered(c);
    expect(t.length).toBe(4 * 2);
    expect(Math.min(...t.map((x) => x[0]))).toBe(6);
    expect(Math.max(...t.map((x) => x[0]))).toBe(9);
    expect(Math.min(...t.map((x) => x[1]))).toBe(3);
    expect(Math.max(...t.map((x) => x[1]))).toBe(4);
    expect(coverShare(c)).toBeCloseTo(8 / (TILES_X * TILES_Y));
    expect(c.fill).toBeCloseTo((0.25 * 0.25) / 4);
  });

  it('a stretched particle reaches further along its axis and fills more', () => {
    const a = emptyCover();
    const b = emptyCover();
    const p = instances([0, 0, 0, 0.1]);
    const q = instances([0, 0, 0, 0.1, 0.6, 0, 0]);
    particleCover(p.pos, p.axis, 1, IDENTITY, 1, 1, a);
    particleCover(q.pos, q.axis, 1, IDENTITY, 1, 1, b);
    expect(b.covered).toBeGreaterThan(a.covered);
    expect(b.fill).toBeCloseTo((0.1 * 0.7) / 4);
  });

  it('skips particles off screen and clears the last frame', () => {
    const c = emptyCover();
    const on = instances([0.95, -0.95, 0, 0.02]);
    particleCover(on.pos, on.axis, 1, IDENTITY, 1, 1, c);
    expect(covered(c)).toEqual([[15, 0]]);
    const off = instances([3, 0, 0, 0.5], [0, -2, 0, 0.5]);
    particleCover(off.pos, off.axis, off.count, IDENTITY, 1, 1, c);
    expect(c.covered).toBe(0);
    expect(c.fill).toBe(0);
  });

  it('one at the camera covers everything', () => {
    const c = emptyCover();
    // w = 0: at the camera plane.
    const m = [...IDENTITY];
    m[15] = 0;
    const p = instances([0, 0, 0, 1]);
    particleCover(p.pos, p.axis, 1, m, 1, 1, c);
    expect(c.covered).toBe(TILES_X * TILES_Y);
    expect(coverShare(c)).toBe(1);
  });

  it("measures fill through a real camera: a quad's share of the visible ground", () => {
    const cam = new PerspectiveCamera(45, 852 / 393, 1, 400);
    cam.position.set(0, 20, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const vp = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const c = emptyCover();
    const p = instances([0, 0, 0, 4]);
    const e = cam.projectionMatrix.elements;
    particleCover(p.pos, p.axis, 1, vp.elements, e[0], e[5], c);
    const h = 2 * 20 * Math.tan((45 * Math.PI) / 360);
    const w = h * (852 / 393);
    expect(c.fill).toBeCloseTo((4 * 4) / (w * h), 4);
    // In the middle of the screen, a few tiles each way.
    expect(c.covered).toBeGreaterThan(1);
    expect(c.covered).toBeLessThanOrEqual(16);
  });
});

describe('low-resolution soft particles: when it pays', () => {
  it('never at full scale or with nothing to draw', () => {
    expect(lowResPays(5, 0.5, 1, false)).toBe(false);
    expect(lowResPays(0, 0, 0.5, true)).toBe(false);
  });

  it('heavy smoke goes offscreen, even over the whole screen', () => {
    // A chain's smoke: ~6 screens deep across the view.
    expect(lowResPays(6, 1, 0.5, false)).toBe(true);
    expect(lowResCost(6, 1, 0.5)).toBeLessThan(6 * 0.55);
    // A burning car's column in a corner.
    expect(lowResPays(0.5, 0.1, 0.5, false)).toBe(true);
  });

  it('thin smoke spread wide stays with the scene', () => {
    // A tyre-smoke trail across the view: the composite would cost more than it saves.
    expect(lowResPays(0.3, 0.4, 0.5, false)).toBe(false);
    expect(lowResPays(1, 1, 0.5, false)).toBe(false);
  });

  it('switches with hysteresis, so it does not flip every frame', () => {
    // A screen of smoke over 55% of the screen: between the on and off thresholds.
    expect(lowResCost(1, 0.55, 0.5)).toBeGreaterThan(SWITCH_ON);
    expect(lowResCost(1, 0.55, 0.5)).toBeLessThan(1);
    expect(lowResPays(1, 0.55, 0.5, false)).toBe(false);
    expect(lowResPays(1, 0.55, 0.5, true)).toBe(true);
  });
});

describe('occluder chunks (W3-A)', () => {
  it('groups buildings by the 256 m chunk their middle is in, every building once', () => {
    const box = (x: number, z: number) => ({ minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2, height: 6 });
    const bs = [box(10, 10), box(250, 20), box(260, 20), box(-10, 10), box(-300, -700)];
    const chunks = occluderChunks(bs);
    expect(chunks.flat()).toHaveLength(bs.length);
    expect(chunks.map((c) => c.length).sort()).toEqual([1, 1, 1, 2]);
    expect(chunks.find((c) => c.includes(bs[0]))).toContain(bs[1]);
  });
});
