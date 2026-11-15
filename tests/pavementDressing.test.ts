import { describe, expect, it } from 'vitest';
import { generatePickups } from '../src/world/pickups';
import { BLOCK_SIZE, ROAD_WIDTH, SIDEWALK, generateCity, isCarPark, lotBytes } from '../src/world/city';
import { dressCity } from '../src/world/dressing';
import { planBuildings } from '../src/world/buildingPlans';
import { doorIn } from '../src/world/pavementDressing';
import { placeKickers, placeRamps } from '../src/world/ramps';
import { Hideouts } from '../src/systems/hideouts';

const city = generateCity(1337);
const big = placeRamps(1337);
const dressing = dressCity(city, generatePickups(1337), [...big, ...placeKickers(1337, big)]);
const { street } = dressing;
const plans = planBuildings(city);
const ROUND3 = ['a_board', 'crate_stack', 'bin_bags', 'market_stall', 'flower_stand', 'news_stand', 'water_barrier', 'scaffold', 'leaf_pile'];
const count = (k: string) => street.props.filter((p) => p.kind === k).length;
const walk = ROAD_WIDTH / 2 + SIDEWALK / 2;

function fromCentreline(x: number, z: number): number {
  const dx = Math.abs(x - Math.round(x / BLOCK_SIZE) * BLOCK_SIZE);
  const dz = Math.abs(z - Math.round(z / BLOCK_SIZE) * BLOCK_SIZE);
  return Math.min(dx, dz);
}

describe('the pavements dressed (V3 L7)', () => {
  it('places every round-3 prop, in numbers that fill the streets without crowding them', () => {
    for (const k of ROUND3) expect(count(k), k).toBeGreaterThan(k === 'scaffold' || k === 'news_stand' ? 3 : 12);
    expect(count('a_board')).toBeLessThan(900);
    expect(count('leaf_pile')).toBeLessThan(1200);
  });

  it('leaves a clear path down every pavement: nothing within a person of the walk line', () => {
    for (const p of street.props) {
      if (!['a_board', 'bin_bags', 'crate_stack', 'flower_stand', 'news_stand', 'market_stall', 'scaffold'].includes(p.kind)) continue;
      const d = fromCentreline(p.x, p.z);
      if (d > ROAD_WIDTH / 2 + SIDEWALK + 1) continue; // a plaza's stalls
      expect(Math.abs(d - walk), p.kind).toBeGreaterThan(0.6);
    }
  });

  it('keeps leaves in the gutter, never across a crossing, and nothing on a car park', () => {
    for (const p of street.props.filter((q) => q.kind === 'leaf_pile')) {
      expect(fromCentreline(p.x, p.z)).toBeCloseTo(7.45, 1);
      // Along the road: clear of the junction box and its zebras (within 12 m of the crossing's centre).
      const ax = Math.abs(p.x - Math.round(p.x / BLOCK_SIZE) * BLOCK_SIZE);
      const az = Math.abs(p.z - Math.round(p.z / BLOCK_SIZE) * BLOCK_SIZE);
      expect(Math.max(ax, az)).toBeGreaterThan(12);
    }
    const bytes = lotBytes(city);
    const parks = city.blocks.filter((_, i) => isCarPark(city, bytes, i)).map((b) => b.interior);
    for (const p of street.props) {
      if (!ROUND3.includes(p.kind) || p.kind === 'water_barrier') continue;
      for (const r of parks) expect(p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ, `${p.kind} on a car park`).toBe(false);
    }
  });

  it('blocks no alley a player can hide in', () => {
    const hide = new Hideouts(city);
    for (const p of street.props) if (ROUND3.includes(p.kind) && p.kind !== 'water_barrier') expect(hide.at(p.x, p.z)?.kind, p.kind).not.toBe('alley');
  });

  it('keeps clear of bus stops and where the bus pulls in', () => {
    for (const p of street.props) {
      if (!ROUND3.includes(p.kind) || p.kind === 'water_barrier') continue;
      for (const s of street.busStops) {
        expect(Math.hypot(p.x - s.x, p.z - s.z), p.kind).toBeGreaterThan(4.5);
        expect(Math.hypot(p.x - s.stopX, p.z - s.stopZ), p.kind).toBeGreaterThan(7.5);
      }
    }
  });

  it('puts scaffolding against a plain street face, its walkway open (only the standards solid)', () => {
    for (const p of street.props.filter((q) => q.kind === 'scaffold')) {
      const d = fromCentreline(p.x, p.z);
      expect(d - 0.66).toBeGreaterThan(walk + 0.4);
      // The wall behind it: within a metre of its back.
      const back = { x: p.x - Math.sin(p.heading) * 0.8, z: p.z - Math.cos(p.heading) * 0.8 };
      expect(city.buildings.some((b) => back.x >= b.minX - 0.05 && back.x <= b.maxX + 0.05 && back.z >= b.minZ - 0.05 && back.z <= b.maxZ + 0.05)).toBe(true);
    }
  });

  it('finds the shop doors where the building shader draws them', () => {
    const i = plans.findIndex((p) => p.shopSides & 1);
    const b = city.buildings[i];
    const plan = plans[i];
    const w = b.maxX - b.minX;
    const nb = Math.max(1, Math.floor(w / 2.6));
    const bw = w / nb;
    for (let bi = 0; bi < nb; bi++) {
      const h = bi * 0.37 + plan.seed * 3.1;
      const mid = b.minX + (bi + 0.5) * bw;
      if (h - Math.floor(h) <= 0.28) expect(doorIn(b, plan, 0, mid - 0.05, mid + 0.05)).toBe(true);
      if (h - Math.floor(h) > 0.3) expect(doorIn(b, plan, 0, mid - 0.05, mid + 0.05)).toBe(false);
    }
    // A face with no shops has no doors.
    const plain = plans.findIndex((p) => !(p.shopSides & 1));
    expect(doorIn(city.buildings[plain], plans[plain], 0, -1e6, 1e6)).toBe(false);
  });
});
