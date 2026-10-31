import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ContactShadows } from '../src/render/contactShadows';
import { RubbleBatch, chunkGeometry } from '../src/render/rubbleBatch';

describe('chunkGeometry', () => {
  const geo = chunkGeometry();
  const pos = geo.getAttribute('position');

  it('fills the unit box exactly (so a chunk fills its Rapier cuboid)', () => {
    const box = geo.boundingBox!;
    for (const k of ['x', 'y', 'z'] as const) {
      expect(box.min[k]).toBeCloseTo(-0.5, 6);
      expect(box.max[k]).toBeCloseTo(0.5, 6);
    }
  });

  it('is a closed shell wound outward: 56 triangles, every edge shared once each way, positive volume', () => {
    expect(pos.count).toBe(56 * 3);
    const key = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => v.toFixed(5)).join(',');
    const edges = new Map<string, number>();
    let volume = 0;
    for (let t = 0; t < pos.count; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = key(t + e);
        const b = key(t + ((e + 1) % 3));
        edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? 0) + 1);
      }
      const [ax, ay, az] = [pos.getX(t), pos.getY(t), pos.getZ(t)];
      const [bx, by, bz] = [pos.getX(t + 1), pos.getY(t + 1), pos.getZ(t + 1)];
      const [cx, cy, cz] = [pos.getX(t + 2), pos.getY(t + 2), pos.getZ(t + 2)];
      volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    }
    for (const [edge, n] of edges) {
      expect(n, edge).toBe(1);
      const [a, b] = edge.split('|');
      expect(edges.get(`${b}|${a}`), edge).toBe(1);
    }
    // Rough, not a box: well under the unit cube, well over a sliver.
    expect(volume).toBeGreaterThan(0.5);
    expect(volume).toBeLessThan(0.9);
  });

  it('no face is one flat facet: every triangle is shaded its own way', () => {
    const nrm = geo.getAttribute('normal');
    const seen = new Set<string>();
    for (let t = 0; t < nrm.count; t += 3) {
      seen.add([nrm.getX(t), nrm.getY(t), nrm.getZ(t)].map((v) => v.toFixed(2)).join(','));
      // Each still faces outward-ish: within ~40° of its triangle's true normal.
      const a = new Vector3(pos.getX(t), pos.getY(t), pos.getZ(t));
      const b = new Vector3(pos.getX(t + 1), pos.getY(t + 1), pos.getZ(t + 1));
      const c = new Vector3(pos.getX(t + 2), pos.getY(t + 2), pos.getZ(t + 2));
      const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      expect(n.dot(new Vector3(nrm.getX(t), nrm.getY(t), nrm.getZ(t)))).toBeGreaterThan(0.75);
    }
    expect(seen.size).toBe(56);
  });
});

describe('RubbleBatch.add', () => {
  const batch = new RubbleBatch(4);
  const q = new Quaternion().setFromEuler(new Euler(0.4, 1.1, -0.7));
  const src = {
    pose: new Float32Array([1, 2, 3, q.x, q.y, q.z, q.w]),
    size: new Float32Array([0.6, 0.3, 0.9]),
    colour: new Float32Array([0.5, 0.4, 0.3]),
    fade: new Float32Array([0]),
  };
  const drawn = () => new Matrix4().fromArray(batch.mesh.instanceMatrix.array as Float32Array, 0);
  /** The lowest point of the unit box under a matrix. */
  const bottom = (m: Matrix4) => {
    let lo = Infinity;
    for (let c = 0; c < 8; c++) lo = Math.min(lo, new Vector3(c & 1 ? 0.5 : -0.5, c & 2 ? 0.5 : -0.5, c & 4 ? 0.5 : -0.5).applyMatrix4(m).y);
    return lo;
  };

  it('composes pose and size like Matrix4.compose', () => {
    batch.begin();
    batch.add(src, 0);
    batch.end();
    const want = new Matrix4().compose(new Vector3(1, 2, 3), q, new Vector3(0.6, 0.3, 0.9));
    drawn().elements.forEach((v, i) => expect(v).toBeCloseTo(want.elements[i], 5));
    expect(batch.count).toBe(1);
    expect(Array.from((batch.mesh.instanceColor!.array as Float32Array).slice(0, 3))).toEqual(Array.from(src.colour));
  });

  /** The highest point of the unit box under a matrix. */
  const top = (m: Matrix4) => {
    let hi = -Infinity;
    for (let c = 0; c < 8; c++) hi = Math.max(hi, new Vector3(c & 1 ? 0.5 : -0.5, c & 2 ? 0.5 : -0.5, c & 4 ? 0.5 : -0.5).applyMatrix4(m).y);
    return hi;
  };
  const xExtent = (m: Matrix4) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let c = 0; c < 8; c++) {
      const x = new Vector3(c & 1 ? 0.5 : -0.5, c & 2 ? 0.5 : -0.5, c & 4 ? 0.5 : -0.5).applyMatrix4(m).x;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    return hi - lo;
  };

  it('fading crumbles it: settles and darkens, then flattens faster than it shrinks, its bottom on the ground', () => {
    batch.begin();
    batch.add(src, 0);
    const whole = drawn();
    const h = top(whole) - bottom(whole);
    const w = xExtent(whole);
    src.fade[0] = 0.5;
    batch.begin();
    batch.add(src, 0);
    let m = drawn();
    expect(bottom(m)).toBeCloseTo(bottom(whole) - 0.04, 5);
    expect(top(m) - bottom(m)).toBeCloseTo(h, 5);
    expect((batch.mesh.instanceColor!.array as Float32Array)[0]).toBeCloseTo(0.5 * 0.45, 5);
    src.fade[0] = 0.75;
    batch.begin();
    batch.add(src, 0);
    m = drawn();
    expect(bottom(m)).toBeCloseTo(bottom(whole) - 0.04, 5);
    expect(top(m) - bottom(m)).toBeCloseTo(h * 0.25, 5);
    expect(xExtent(m)).toBeCloseTo(w * 0.5, 5);
    src.fade[0] = 0;
  });

  it('hold keeps the last frame drawn and uploads nothing', () => {
    batch.begin();
    batch.add(src, 0);
    batch.end();
    const v = batch.mesh.instanceMatrix.version;
    batch.hold();
    expect(batch.count).toBe(1);
    expect(batch.mesh.visible).toBe(true);
    expect(batch.mesh.instanceMatrix.version).toBe(v);
  });
});

describe('ContactShadows.addFrom', () => {
  it('writes what add() writes', () => {
    const a = new ContactShadows(2);
    const b = new ContactShadows(2);
    const v = [3.5, -2, 0.8, 0.4, 0.7, 0.18, 0.45];
    a.begin();
    a.add(v[0], v[1], v[2], v[3], v[4], v[5], v[6]);
    b.begin();
    b.addFrom(new Float32Array(v), 0);
    const am = a.mesh.instanceMatrix.array as Float32Array;
    const bm = b.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < 16; i++) expect(bm[i]).toBeCloseTo(am[i], 5);
    const as = a.mesh.geometry.getAttribute('aShape').array as Float32Array;
    const bs = b.mesh.geometry.getAttribute('aShape').array as Float32Array;
    for (let i = 0; i < 4; i++) expect(bs[i]).toBeCloseTo(as[i], 6);
  });
});
