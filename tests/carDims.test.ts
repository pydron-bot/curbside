import { BoxGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { dimsOf } from '../src/render/vehicleModels';

/** A box from (x0, y0, z0) to (x1, y1, z1), non-indexed like a merged car. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  return new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toNonIndexed();
}

describe('dimsOf: the top silhouette (rubble proxies rest chunks on it)', () => {
  it('a saloon: the hood line from its nose, the cabin where it rises above that', () => {
    // vehicles.glb's sedan: body to 0.94 m over ±2.2 m, cabin to 1.52 m over −1.3..0.9.
    const d = dimsOf(mergeGeometries([box(-0.95, 0.32, -2.2, 0.95, 0.94, 2.2), box(-0.8, 0.94, -1.3, 0.8, 1.52, 0.9)])!);
    expect(d.halfWidth).toBeCloseTo(0.95, 6);
    expect(d.front).toBeCloseTo(2.2, 6);
    expect(d.rear).toBeCloseTo(2.2, 6);
    expect(d.height).toBeCloseTo(1.52, 6);
    expect(d.hood).toBeCloseTo(0.94, 6);
    expect(d.cabinFrom).toBeCloseTo(-1.3, 6);
    expect(d.cabinTo).toBeCloseTo(0.9, 6);
  });

  it('a van or a bus, tall to its nose: all hood, no cabin', () => {
    const d = dimsOf(box(-1.2, 0.3, -5, 1.2, 3.1, 5));
    expect(d.hood).toBeCloseTo(3.1, 6);
    expect(d.cabinTo - d.cabinFrom).toBe(0);
  });
});
