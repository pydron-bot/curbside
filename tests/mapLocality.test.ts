/**
 * W3-D: a map edit changes its own block and nothing else. The dressing
 * (kerb furniture, bus stops, carts, café tables, dumpsters) and the
 * buildings' plans (roofs, shopfronts) come from streams keyed by block or
 * building, so a block that draws differently can't move another's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { placeDocks } from '../src/game/modes/places';
import { planBuildings } from '../src/world/buildingPlans';
import { BLOCK_SIZE, CORE_OFFSET, HALF_EXTENT, generateCity, isCarPark, lotBytes, type Block, type City } from '../src/world/city';
import { dressCity, type Dressing } from '../src/world/dressing';
import { placeSprayShops, placeStation } from '../src/world/landmarks';
import { NO_EDITS, type BlockEdit, type MapEdits } from '../src/world/mapEdits';
import { generatePickups } from '../src/world/pickups';
import { placeKickers, placeRamps } from '../src/world/ramps';
import { placeHospital } from '../src/world/streetSpots';

afterEach(() => void generateCity(1337));

const big = placeRamps(1337);
const ramps = [...big, ...placeKickers(1337, big)];
const pickups = generatePickups(1337);
const dress = (city: City) => dressCity(city, pickups, ramps);
const landmarks = (city: City) => JSON.stringify([placeSprayShops(city), placeDocks(city), placeStation(city), placeHospital(city)]);

/** Is (x, z) in block b's cell (road centreline to road centreline)? */
const inCell = (b: Block, x: number, z: number) => {
  const x0 = -HALF_EXTENT + b.bx * BLOCK_SIZE;
  const z0 = -HALF_EXTENT + b.bz * BLOCK_SIZE;
  return x >= x0 && x <= x0 + BLOCK_SIZE && z >= z0 && z <= z0 + BLOCK_SIZE;
};

/** Everything the dressing placed outside block b, as comparable strings. */
function outside(d: Dressing, b: Block): Record<string, string[]> {
  const out = <T extends { x: number; z: number }>(list: readonly T[], key: (t: T) => string) =>
    list.filter((t) => !inCell(b, t.x, t.z)).map(key).sort();
  return {
    props: out(d.street.props, (p) => `${p.kind} ${p.x.toFixed(3)} ${p.z.toFixed(3)} ${p.heading.toFixed(3)} ${p.scale.toFixed(3)} ${p.tint ?? ''}`),
    busStops: out(d.street.busStops, (s) => `${s.x.toFixed(3)} ${s.z.toFixed(3)}`),
    vendors: out(d.street.vendors, (v) => `${v.kind} ${v.x.toFixed(3)} ${v.z.toFixed(3)}`),
    roadworks: d.street.roadworks.map((w) => JSON.stringify(w)),
  };
}

describe('a map edit stays in its block', () => {
  const plain = generateCity(1337);
  const plainDress = dress(plain);
  const plainLandmarks = landmarks(plain);
  const plainBytes = lotBytes(plain);
  const plainPlans = new Map(plain.buildings.map((b, i) => [`${b.minX},${b.minZ}`, planBuildings(plain)[i]]));

  // A block of each kind, in the core, whose edit doesn't move a landmark (they take the nearest open lot, on purpose).
  const pickBlock = (kind: Block['kind'], edit: Omit<BlockEdit, 'at'>) =>
    plain.blocks.find((b) => {
      if (kind === 'plaza' && !isCarPark(plain, plainBytes, plain.blocks.indexOf(b))) return false;
      if (b.kind !== kind || b.bx < CORE_OFFSET + 2 || b.bz < CORE_OFFSET + 2 || b.district === edit.style) return false;
      const city = generateCity(1337, { ...NO_EDITS, blocks: [{ ...edit, at: [b.bx - CORE_OFFSET, b.bz - CORE_OFFSET] }] });
      return landmarks(city) === plainLandmarks;
    })!;

  const cases: ReadonlyArray<[string, Block['kind'], Omit<BlockEdit, 'at'>]> = [
    ['buildings to park', 'buildings', { kind: 'park' }],
    ['buildings to car park', 'buildings', { kind: 'carpark' }],
    ['park to buildings', 'park', { kind: 'buildings' }],
    ['car park to open plaza', 'plaza', { kind: 'plaza' }],
    ['a reroll', 'buildings', { variant: 7 }],
    ['a repaint', 'buildings', { district: 'industrial' }],
    ['buildings to an empty lot', 'buildings', { kind: 'lot' }],
    ['a restyle', 'buildings', { style: 'downtown' }],
  ];

  for (const [name, kind, edit] of cases) {
    it(name, () => {
      const b = pickBlock(kind, edit);
      expect(b, `a ${kind} block whose edit keeps the landmarks`).toBeDefined();
      const city = generateCity(1337, { ...NO_EDITS, blocks: [{ ...edit, at: [b.bx - CORE_OFFSET, b.bz - CORE_OFFSET] }] });
      const d = dress(city);
      expect(outside(d, b)).toEqual(outside(plainDress, b));
      // Every building outside the block keeps its plan (roof, shopfronts, awnings).
      const plans = planBuildings(city);
      city.buildings.forEach((bd, i) => {
        if (inCell(b, (bd.minX + bd.maxX) / 2, (bd.minZ + bd.maxZ) / 2)) return;
        expect(plans[i]).toEqual(plainPlans.get(`${bd.minX},${bd.minZ}`));
      });
      // And the edit did change its own block.
      const mine = (x: Dressing) => x.street.props.filter((p) => inCell(b, p.x, p.z)).map((p) => `${p.kind} ${p.x} ${p.z}`);
      if (edit.district === undefined && edit.style === undefined) expect(mine(d)).not.toEqual(mine(plainDress));
    });
  }
});

describe('round 3: a merge or a pedestrian street stays where it is', () => {
  const plain = generateCity(1337);
  const plainDress = dress(plain);
  const plainPlans = new Map(plain.buildings.map((b, i) => [`${b.minX},${b.minZ}`, planBuildings(plain)[i]]));
  /** Everything the dressing placed outside a rectangle of world space, as comparable strings. */
  const outsideRect = (d: Dressing, x0: number, z0: number, x1: number, z1: number) => {
    const out = <T extends { x: number; z: number }>(list: readonly T[], key: (t: T) => string) =>
      list.filter((t) => t.x < x0 || t.x > x1 || t.z < z0 || t.z > z1).map(key).sort();
    return {
      props: out(d.street.props, (p) => `${p.kind} ${p.x.toFixed(3)} ${p.z.toFixed(3)} ${p.heading.toFixed(3)} ${p.scale.toFixed(3)} ${p.tint ?? ''}`),
      busStops: out(d.street.busStops, (s) => `${s.x.toFixed(3)} ${s.z.toFixed(3)}`),
      vendors: out(d.street.vendors, (v) => `${v.kind} ${v.x.toFixed(3)} ${v.z.toFixed(3)}`),
      roadworks: d.street.roadworks.map((w) => JSON.stringify(w)),
    };
  };
  const cases: ReadonlyArray<[string, MapEdits['roads'], [number, number, number, number]]> = [
    // Crossings to world metres: the cells the edit can touch.
    ['a 2×1 merge', [{ a: [1, -1], b: [1, 0], removed: true }], [0, -64, 128, 0]],
    [
      'a 2×2 merge',
      [
        { a: [-2, -3], b: [-2, -2], removed: true },
        { a: [-2, -2], b: [-2, -1], removed: true },
        { a: [-3, -2], b: [-2, -2], removed: true },
        { a: [-2, -2], b: [-1, -2], removed: true },
      ],
      [-192, -192, -64, -64],
    ],
    ['a pedestrian street', [{ a: [1, 1], b: [2, 1], pedestrian: true }], [64, 0, 128, 128]],
  ];
  for (const [name, roads, [x0, z0, x1, z1]] of cases) {
    it(name, () => {
      const city = generateCity(1337, { ...NO_EDITS, roads });
      const d = dress(city);
      expect(outsideRect(d, x0, z0, x1, z1)).toEqual(outsideRect(plainDress, x0, z0, x1, z1));
      const plans = planBuildings(city);
      const out = (bd: { minX: number; minZ: number; maxX: number; maxZ: number }) => {
        const cx = (bd.minX + bd.maxX) / 2;
        const cz = (bd.minZ + bd.maxZ) / 2;
        return cx < x0 || cx > x1 || cz < z0 || cz > z1;
      };
      expect(city.buildings.filter(out).length).toBe(plain.buildings.filter(out).length);
      city.buildings.forEach((bd, i) => {
        if (out(bd)) expect(plans[i]).toEqual(plainPlans.get(`${bd.minX},${bd.minZ}`));
      });
      expect(landmarks(city)).toBe(landmarks(plain));
    });
  }
});
