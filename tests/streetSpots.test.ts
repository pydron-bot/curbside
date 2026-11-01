import { describe, expect, it } from 'vitest';
import { generateCity, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, WORLD_LIMIT } from '../src/world/city';
import { LANE_OFFSET, lanePoint } from '../src/world/roads';
import {
  BUS_PULL_IN,
  carParkBays,
  crowdSpot,
  isCarPark,
  lotRolls,
  pickBay,
  PARK_ALONG,
  PARK_OFFSET,
  STOP_ALONG,
  pickParkingSpot,
  placeBusStops,
  placeHospital,
  queueSpot,
  roadPoint,
  segmentValid,
  type RoadSpot,
} from '../src/world/streetSpots';
import { random } from './helpers';

const city = generateCity(1337);

describe('roadPoint', () => {
  it('agrees with the lane line traffic drives on (right of travel)', () => {
    for (const dir of [0, 1, 2, 3] as const) {
      const a = roadPoint(2, -1, dir, 20, LANE_OFFSET);
      const b = lanePoint(2, -1, dir, -20);
      expect(a.x).toBeCloseTo(b.x);
      expect(a.z).toBeCloseTo(b.z);
    }
  });

  it('parks clear of the lane traffic drives in and short of the kerb', () => {
    // A sedan is 1.9 m across.
    expect(PARK_OFFSET - 0.95).toBeGreaterThan(LANE_OFFSET + 1 + 0.5);
    expect(PARK_OFFSET + 0.95).toBeLessThan(ROAD_WIDTH / 2);
  });
});

describe('pickParkingSpot', () => {
  it('lands mid-block against a kerb on a real road, in the ring, away from `avoid`', () => {
    const rand = random(7);
    const out: RoadSpot = { ix: 0, iz: 0, dir: 0, along: 0, x: 0, z: 0, heading: 0 };
    const avoid = [{ x: 40, z: 40, r: 30 }];
    let found = 0;
    for (let i = 0; i < 400; i++) {
      const s = pickParkingSpot(10, 10, 30, 150, rand, avoid, out);
      if (!s) continue;
      found++;
      expect(segmentValid(s.ix, s.iz, s.dir)).toBe(true);
      expect(s.along).toBeGreaterThanOrEqual(PARK_ALONG[0]);
      expect(s.along).toBeLessThanOrEqual(PARK_ALONG[1]);
      const d = Math.hypot(s.x - 10, s.z - 10);
      expect(d).toBeGreaterThanOrEqual(30);
      expect(d).toBeLessThanOrEqual(150);
      expect(Math.hypot(s.x - 40, s.z - 40)).toBeGreaterThanOrEqual(30);
      // On a road: one coordinate is a road centreline ± PARK_OFFSET.
      const offX = Math.abs(s.x - Math.round(s.x / BLOCK_SIZE) * BLOCK_SIZE);
      const offZ = Math.abs(s.z - Math.round(s.z / BLOCK_SIZE) * BLOCK_SIZE);
      expect(Math.min(Math.abs(offX - PARK_OFFSET), Math.abs(offZ - PARK_OFFSET))).toBeLessThan(1e-6);
      expect(Math.abs(s.x)).toBeLessThan(WORLD_LIMIT);
      expect(Math.abs(s.z)).toBeLessThan(WORLD_LIMIT);
    }
    expect(found).toBeGreaterThan(100);
  });
});

describe('bus stops', () => {
  const stops = placeBusStops([{ x: 0, z: 0, r: 40 }]);

  it('are spread over the city, mid-block, never on the outer ring or inside `avoid`', () => {
    expect(stops.length).toBeGreaterThan(80);
    for (const s of stops) {
      expect(s.along).toBe(STOP_ALONG);
      expect(segmentValid(s.ix, s.iz, s.dir)).toBe(true);
      expect(Math.hypot(s.waitX, s.waitZ)).toBeGreaterThan(40);
      // The bus pulls in kerbside of the lane, riders wait on the pavement beyond it.
      const along = roadPoint(s.ix, s.iz, s.dir, STOP_ALONG, BUS_PULL_IN);
      expect(s.x).toBeCloseTo(along.x);
      expect(s.z).toBeCloseTo(along.z);
      expect(Math.hypot(s.waitX - s.x, s.waitZ - s.z)).toBeGreaterThan(2.5);
    }
    // Ids are their index (the scenes look stops up by id).
    stops.forEach((s, i) => expect(s.id).toBe(i));
  });
});

describe('placeHospital', () => {
  it('is on a built-up block, its bay on the road beside the doors', () => {
    const h = placeHospital(city);
    const bx = Math.floor((h.x + HALF_EXTENT) / BLOCK_SIZE);
    const bz = Math.floor((h.z + 1 + HALF_EXTENT) / BLOCK_SIZE);
    const block = city.blocks.find((b) => b.bx === bx && b.bz === bz);
    expect(block?.kind).toBe('buildings');
    expect(h.bayX).toBe(h.x);
    expect(Math.abs(h.bayZ - h.z)).toBeLessThan(5);
    expect(h.bayZ).toBeLessThan(h.z);
  });
});

describe('queueSpot', () => {
  it('stands the first at the hatch facing it, the rest back along the pavement', () => {
    const o = { x: 0, z: 0, heading: 0 };
    // A van facing +z: its right (the kerb) is -x.
    queueSpot(0, 0, 0, 2, 0, o);
    expect(o.x).toBeCloseTo(-2);
    expect(o.z).toBeCloseTo(0);
    expect(Math.sin(o.heading)).toBeCloseTo(1);
    queueSpot(0, 0, 0, 2, 3, o);
    expect(o.x).toBeCloseTo(-2);
    expect(o.z).toBeLessThan(-2);
  });
});

describe('car parks', () => {
  const bays = carParkBays(city);
  const rolls = lotRolls(city);

  it('half the plazas are car parks (the ones the ground paints with bays)', () => {
    const plazas = city.blocks.filter((b) => b.kind === 'plaza').length;
    const parks = city.blocks.filter((b, i) => isCarPark(b, rolls[i])).length;
    expect(parks).toBeGreaterThan(0);
    expect(parks).toBeLessThan(plazas);
  });

  it('bays sit inside their car park, a car-width apart, nose-in along the rows', () => {
    expect(bays.length).toBeGreaterThan(50);
    for (const b of bays) {
      const bx = Math.floor((b.x + HALF_EXTENT) / BLOCK_SIZE);
      const bz = Math.floor((b.z + HALF_EXTENT) / BLOCK_SIZE);
      const i = city.blocks.findIndex((k) => k.bx === bx && k.bz === bz);
      expect(isCarPark(city.blocks[i], rolls[i])).toBe(true);
      // A 4.6 m car inside the painted span (21 - 1.5 m from the middle).
      const cx = -HALF_EXTENT + (bx + 0.5) * BLOCK_SIZE;
      const cz = -HALF_EXTENT + (bz + 0.5) * BLOCK_SIZE;
      expect(Math.abs(b.x - cx)).toBeLessThanOrEqual(19.5 - 1.3 + 1e-9);
      expect(Math.abs(b.z - cz) + 2.3).toBeLessThanOrEqual(19.5 + 0.01);
      expect([0, Math.PI]).toContain(b.heading);
    }
    // Neighbours in a row: 2.6 m apart (a 1.9 m car each).
    const row = bays.filter((b) => b.z === bays[0].z && Math.abs(b.x - bays[0].x) < 20).sort((a, b) => a.x - b.x);
    expect(row[1].x - row[0].x).toBeCloseTo(2.6);
  });

  it('pickBay keeps to the ring and clear of `avoid`', () => {
    const rand = random(3);
    let got = 0;
    for (let i = 0; i < 2000; i++) {
      const b = pickBay(bays, 0, 0, 30, 400, rand, [{ x: bays[0].x, z: bays[0].z, r: 25 }]);
      if (!b) continue;
      got++;
      const d = Math.hypot(b.x, b.z);
      expect(d).toBeGreaterThanOrEqual(30);
      expect(d).toBeLessThanOrEqual(400);
      expect(Math.hypot(b.x - bays[0].x, b.z - bays[0].z)).toBeGreaterThanOrEqual(25);
    }
    expect(got).toBeGreaterThan(0);
  });
});

describe('crowdSpot', () => {
  it('rings the middle, everyone facing in, nobody on top of anyone', () => {
    const o = { x: 0, z: 0, heading: 0 };
    const placed: Array<[number, number]> = [];
    for (let i = 0; i < 24; i++) {
      crowdSpot(10, 20, 3, i, o);
      const r = Math.hypot(o.x - 10, o.z - 20);
      expect(r).toBeGreaterThanOrEqual(3 - 1e-9);
      // Facing the middle.
      expect(Math.sin(o.heading) * (10 - o.x) + Math.cos(o.heading) * (20 - o.z)).toBeCloseTo(r);
      for (const [x, z] of placed) expect(Math.hypot(x - o.x, z - o.z)).toBeGreaterThan(0.6);
      placed.push([o.x, o.z]);
    }
  });

  it('keeps to an arc round the way it faces', () => {
    const o = { x: 0, z: 0, heading: 0 };
    for (let i = 0; i < 8; i++) {
      crowdSpot(0, 0, 4, i, o, 0, Math.PI / 2);
      // In front (+z), within the quarter circle (with half a place of slack).
      expect(Math.abs(Math.atan2(o.x, o.z))).toBeLessThanOrEqual(Math.PI / 4 + 0.3);
    }
  });
});
