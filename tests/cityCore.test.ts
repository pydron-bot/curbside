/**
 * W3-A: the city can grow (`?city=24`, CURBSIDE_CITY=24), but today's
 * 16 × 16 city stays in the middle of it block for block, so every
 * hand-placed spot (payphones, story spawns, races, the safehouse) keeps
 * working. These fingerprints are of the core only, so they hold at any
 * size: run `CURBSIDE_CITY=24 npx vitest run tests/cityCore.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { placeHangouts } from '../src/game/gangs';
import { SAFEHOUSE, placeDocks, placeFrenzyTokens, placePayphones } from '../src/game/modes/places';
import { buildMissions } from '../src/systems/missionsData';
import { CORE_BLOCKS, CORE_OFFSET, generateCity } from '../src/world/city';
import { planBuildings } from '../src/world/buildingPlans';
import { dressCity } from '../src/world/dressing';
import { placeSprayShops, placeStation } from '../src/world/landmarks';
import { generatePickups } from '../src/world/pickups';
import { placeKickers, placeRamps } from '../src/world/ramps';
import { placeHospital } from '../src/world/streetSpots';

/** Inside the core, clear of its old outer ring road (which a bigger city fills in: junction lights, the far kerb). */
const CORE_HALF = 512 - 16;
const inCore = (x: number, z: number) => Math.abs(x) < CORE_HALF && Math.abs(z) < CORE_HALF;

/** FNV-1a over a canonical string. */
function hash(v: unknown): string {
  const s = JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const centre = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) => inCore((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2);

describe('the core city (today’s 16 × 16) at any size', () => {
  const city = generateCity(1337);
  const pickups = generatePickups(1337);
  const big = placeRamps(1337);
  const ramps = [...big, ...placeKickers(1337, big)];

  it('has the same blocks, buildings and trees', () => {
    const blocks = city.blocks
      .filter((b) => b.bx >= CORE_OFFSET && b.bx < CORE_OFFSET + CORE_BLOCKS && b.bz >= CORE_OFFSET && b.bz < CORE_OFFSET + CORE_BLOCKS)
      .map((b) => [b.bx - CORE_OFFSET, b.bz - CORE_OFFSET, b.kind, b.district])
      .sort();
    expect(blocks).toHaveLength(256);
    expect.soft(hash(blocks)).toBe('a590887f');
    expect.soft(hash(city.buildings.filter(centre))).toBe('968ca044');
    expect.soft(hash(city.trees.filter((t) => inCore(t.x, t.z)))).toBe('faab1af3');
  });

  it('has the same hand-placed spots', () => {
    const docks = placeDocks(city);
    // The mission data is hashed whole: re-pinned for W3-B's sticky charge (s5 gives two, Lionel's line mentions them; same spots).
    expect.soft(
      hash({
        safehouse: SAFEHOUSE,
        phones: placePayphones(),
        frenzy: placeFrenzyTokens(),
        docks,
        shops: placeSprayShops(city),
        station: placeStation(city),
        hospital: placeHospital(city),
        missions: buildMissions(docks, SAFEHOUSE),
      }),
    ).toBe('9af78634');
    expect.soft(hash(placeHangouts())).toBe('446c0e20');
  });

  it('has the same ramps, pickups and street furniture', () => {
    expect.soft(hash(ramps.filter((r) => inCore(r.x, r.z)))).toBe('c64427e3');
    expect.soft(hash(pickups.filter((p) => inCore(p.x, p.z)))).toBe('3dc964cd');
    const d = dressCity(city, pickups, ramps);
    const props = d.street.props.filter((p) => inCore(p.x, p.z)).map((p) => [p.kind, p.x, p.z, p.heading, p.scale, p.tint ?? '']);
    props.sort((a, b) => (a[1] as number) - (b[1] as number) || (a[2] as number) - (b[2] as number) || String(a[0]).localeCompare(String(b[0])));
    expect.soft(hash(props)).toBe('f41154ea');
    expect.soft(hash(d.landmarks.props.filter((p) => inCore(p.x, p.z)))).toBe('bac58205');
    expect.soft(hash(d.street.roadworks.filter((w) => centre(w.area)))).toBe('5076d9ad');
    expect.soft(hash(d.street.busStops.filter((s) => inCore(s.x, s.z)))).toBe('a2b6ebf2');
    expect.soft(hash(d.street.vendors.filter((v) => inCore(v.x, v.z)))).toBe('fbe0dd1a');
    // Roofs and shopfronts: keyed by where each building stands (W3-D), so the core's hold at any size.
    expect.soft(hash(planBuildings(city).filter((_p, i) => centre(city.buildings[i])))).toBe('be684bc5');
  });
});
