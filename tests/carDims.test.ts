import { BoxGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { PART, tagCarGeometry } from '../src/render/carMesh';
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

  it('the headlights: where the tagged lamps sit, else most of the half-width', () => {
    const white = new Color(1, 1, 1);
    const body = tagCarGeometry(box(-0.95, 0.3, -2.2, 0.95, 0.9, 2.2), white, PART.paint, null);
    const lamp = (x: number) => tagCarGeometry(box(x - 0.2, 0.6, 2.18, x + 0.2, 0.75, 2.22), white, PART.headlight, null);
    expect(dimsOf(mergeGeometries([body, lamp(-0.6), lamp(0.6)])!).lampX).toBeCloseTo(0.6, 6);
    // Untagged (or no lamps): the old guess.
    expect(dimsOf(box(-1, 0, -2, 1, 1, 2)).lampX).toBeCloseTo(0.62, 6);
  });
});
