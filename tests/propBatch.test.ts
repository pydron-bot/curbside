import { DataUtils, Matrix4, type BufferGeometry, type DataTexture } from 'three';
import { describe, expect, it } from 'vitest';
import { PropBatch } from '../src/render/propBatch';
import { VERTS_PER_ROW } from '../src/render/propChunks';
import { PropModels } from '../src/render/propModels';
import { STAND_INS, standInGeometry } from '../src/render/propStandIns';
import { LAMPS_NONE } from '../src/render/shaderLib';

const KINDS = ['traffic_barrel', 'bus_shelter', 'parking_meter', 'steel_plate', 'not_in_the_files'];

function family(): { batch: PropBatch; geos: Map<string, BufferGeometry> } {
  const models = new PropModels();
  const geos = new Map<string, BufferGeometry>();
  for (const k of KINDS) {
    if (!(k in STAND_INS)) continue;
    const g = standInGeometry(k, STAND_INS[k]);
    models.addGeometry(k, g);
    geos.set(k, g);
  }
  const batch = new PropBatch('test', KINDS, 64);
  batch.setModels(models);
  return { batch, geos };
}

const attr = (b: PropBatch, name: string) => b.mesh.geometry.getAttribute(name).array as Float32Array;
const VIEW = { minX: -40, minZ: -40, maxX: 40, maxZ: 40 };

describe('prop family (vertex pulling)', () => {
  it('runs each prop over its own model only, in whole chunks of one draw', () => {
    const { batch, geos } = family();
    const size = batch.stats().chunkSize;
    expect(batch.mesh.geometry.getAttribute('position').count).toBe(size);
    for (const [k, g] of geos) {
      const n = g.getAttribute('position').count;
      expect(batch.stats(k).vertices).toBeGreaterThanOrEqual(n);
      expect(batch.stats(k).vertices).toBeLessThan(n + size);
    }
    batch.addStatic('bus_shelter', 3, 0, 4, 0.5);
    batch.addStatic('parking_meter', -5, 0, 2, 0);
    batch.addStatic('not_in_the_files', 0, 0, 0, 0);
    batch.begin(VIEW);
    batch.add('traffic_barrel', 1, 0, 1, 0);
    batch.end();
    const chunks = (k: string) => batch.stats(k).vertices / size;
    expect(batch.mesh.count).toBe(chunks('bus_shelter') + chunks('parking_meter') + chunks('traffic_barrel'));
    // Chunks run consecutively through their model and stop at its end.
    const c = attr(batch, 'aChunk');
    for (let i = 0; i < batch.mesh.count; i++) {
      expect(c[i * 2]).toBeLessThan(c[i * 2 + 1]);
      if (i > 0 && c[i * 2 + 1] === c[i * 2 - 1]) expect(c[i * 2] - c[i * 2 - 2]).toBe(size);
    }
  });

  it('packs each model into the texture as it was: position, surface, normal and colour', () => {
    const { batch, geos } = family();
    batch.addStatic('steel_plate', 0, 0, 0, 0);
    batch.begin(VIEW);
    batch.end();
    const first = attr(batch, 'aChunk')[0];
    const tex = (batch as unknown as { verts: { value: DataTexture } }).verts.value;
    expect(tex.image.width).toBe(VERTS_PER_ROW * 2);
    const data = tex.image.data as unknown as Uint32Array;
    const f = new Float32Array(data.buffer);
    const g = geos.get('steel_plate')!;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const col = g.getAttribute('aColor');
    const surf = g.getAttribute('aSurf');
    const half = (u: number, hi: boolean) => DataUtils.fromHalfFloat(hi ? u >>> 16 : u & 0xffff);
    for (let i = 0; i < pos.count; i++) {
      const o = (first + i) * 8;
      expect(f[o]).toBe(Math.fround(pos.getX(i)));
      expect(f[o + 1]).toBe(Math.fround(pos.getY(i)));
      expect(f[o + 2]).toBe(Math.fround(pos.getZ(i)));
      expect(data[o + 3]).toBe(surf.getX(i));
      expect(half(data[o + 4], false)).toBeCloseTo(nor.getX(i), 3);
      expect(half(data[o + 4], true)).toBeCloseTo(nor.getY(i), 3);
      expect(half(data[o + 5], false)).toBeCloseTo(nor.getZ(i), 3);
      expect(half(data[o + 5], true)).toBeCloseTo(col.getX(i), 3);
      expect(half(data[o + 6], false)).toBeCloseTo(col.getY(i), 3);
      expect(half(data[o + 6], true)).toBeCloseTo(col.getZ(i), 3);
    }
  });

  it('keeps knocked-over props out, and each chunk carries its prop', () => {
    const { batch } = family();
    const h = batch.addStatic('bus_shelter', 3, 0, 4, 0.5, 1, 1, 1, 0.25, 0, 0, 0.5, 0.6, 0.7);
    batch.addStatic('parking_meter', -5, 0, 2, 0);
    batch.begin(VIEW);
    batch.end();
    const all = batch.mesh.count;
    const prop = attr(batch, 'aProp');
    const tint = attr(batch, 'aTint');
    let shelter = 0;
    for (let i = 0; i < all; i++) {
      if (prop[i * 4] !== batch.kindOf('bus_shelter')) continue;
      shelter++;
      expect(prop[i * 4 + 1]).toBeCloseTo(0.25);
      expect(tint[i * 3 + 1]).toBeCloseTo(0.6);
    }
    expect(shelter).toBe(batch.stats('bus_shelter').vertices / batch.stats().chunkSize);
    batch.setHidden(h, true);
    batch.begin(VIEW);
    batch.end();
    expect(batch.mesh.count).toBe(all - batch.stats('bus_shelter').vertices / batch.stats().chunkSize);
  });

  it('gives tumbling debris a lamp list from where it is', () => {
    const { batch } = family();
    batch.begin(VIEW);
    batch.addMatrix('parking_meter', new Matrix4().makeTranslation(-HALF, 0, -HALF));
    batch.end();
    // Far outside the city: no lamp reaches it.
    expect(attr(batch, 'aLamps')[0]).toBe(LAMPS_NONE);
  });
});

const HALF = 2000;
