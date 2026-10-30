import { describe, expect, it } from 'vitest';
import { SAFEHOUSE, placeDocks, placeFrenzyTokens, placePayphones } from '../src/game/modes/places';
import { RACES, nodeX, nodeZ } from '../src/game/modes/races';
import { generateCity } from '../src/world/city';
import { placeSprayShops, placeStation, shopRect } from '../src/world/landmarks';
import { generatePickups } from '../src/world/pickups';

const city = generateCity(1337);
const inside = (x: number, z: number, margin = 0) =>
  city.obstacles.some((o) => x > o.minX - margin && x < o.maxX + margin && z > o.minZ - margin && z < o.maxZ + margin);

describe('activity places', () => {
  const docks = placeDocks(city);
  const spots = [SAFEHOUSE, ...placePayphones(), ...placeFrenzyTokens(), { id: 'docks', x: docks.x, z: docks.z }];

  it('stand clear of buildings, trees and walls', () => {
    for (const s of spots) expect(inside(s.x, s.z, 0.6), s.id).toBe(false);
  });

  it('the docks garage is a clear drive-in lot in the south-east, not a spray bay', () => {
    expect(docks.x).toBeGreaterThan(0);
    expect(docks.z).toBeGreaterThan(0);
    const r = shopRect(docks);
    expect(city.obstacles.some((o) => o.minX < r.maxX && o.maxX > r.minX && o.minZ < r.maxZ && o.maxZ > r.minZ)).toBe(false);
    for (const s of placeSprayShops(city)) expect(Math.hypot(s.x - docks.x, s.z - docks.z)).toBeGreaterThan(30);
  });

  it('are spread out and keep away from the police landmarks, the race starts and the crates', () => {
    const others = [
      ...placeSprayShops(city).map((s) => ({ id: s.id, x: s.x, z: s.z })),
      { id: 'station', ...placeStation(city) },
      ...RACES.map((r) => ({ id: r.id, x: nodeX(r.nodes[0]), z: nodeZ(r.nodes[0]) })),
    ];
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z), `${spots[i].id}/${spots[j].id}`).toBeGreaterThan(40);
      }
      for (const o of others) expect(Math.hypot(spots[i].x - o.x, spots[i].z - o.z), `${spots[i].id}/${o.id}`).toBeGreaterThan(14);
      for (const p of generatePickups(1337)) expect(Math.hypot(spots[i].x - p.x, spots[i].z - p.z), `${spots[i].id}/crate`).toBeGreaterThan(3);
    }
  });

  it('the safehouse is a short walk from the spawn corner', () => {
    expect(Math.hypot(SAFEHOUSE.x - 9.5, SAFEHOUSE.z - 9.5)).toBeLessThan(20);
  });
});
