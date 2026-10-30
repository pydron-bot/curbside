import { describe, expect, it } from 'vitest';
import { PACKAGE_COUNT, PACKAGE_PERKS, generatePackages, interiorAround, perkFor, wayOut } from '../src/game/modes/packages';
import { generateCity } from '../src/world/city';

const city = generateCity(1337);

describe('hidden packages', () => {
  const pkgs = generatePackages(city);

  it('forty of them, the same every game', () => {
    expect(pkgs).toHaveLength(PACKAGE_COUNT);
    expect(generatePackages(generateCity(1337))).toEqual(pkgs);
    expect(pkgs.map((p) => p.index)).toEqual([...Array(PACKAGE_COUNT).keys()]);
  });

  it('hidden in alleys, parks and plazas, about half in alleys', () => {
    const alleys = pkgs.filter((p) => p.where === 'alley').length;
    expect(alleys).toBeGreaterThanOrEqual(PACKAGE_COUNT * 0.4);
    expect(pkgs.some((p) => p.where === 'park')).toBe(true);
    expect(pkgs.some((p) => p.where === 'plaza')).toBe(true);
  });

  it('never inside anything, and reachable on foot', () => {
    for (const p of pkgs) {
      const blocked = city.obstacles.some((o) => p.x > o.minX - 0.5 && p.x < o.maxX + 0.5 && p.z > o.minZ - 0.5 && p.z < o.maxZ + 0.5);
      expect(blocked, `package ${p.index}`).toBe(false);
      if (p.where === 'alley') expect(wayOut(p.x, p.z, interiorAround(p.x, p.z), city.obstacles), `package ${p.index}`).toBe(true);
    }
  });

  it('spread across the city', () => {
    for (let i = 0; i < pkgs.length; i++) {
      for (let j = i + 1; j < pkgs.length; j++) expect(Math.hypot(pkgs[i].x - pkgs[j].x, pkgs[i].z - pkgs[j].z)).toBeGreaterThan(19);
    }
    const quarters = new Set(pkgs.map((p) => `${Math.sign(p.x)},${Math.sign(p.z)}`));
    expect(quarters.size).toBe(4);
  });

  it('every tenth one unlocks a perk', () => {
    expect(PACKAGE_PERKS.map((p) => p[0])).toEqual([10, 20, 30, 40]);
    expect(perkFor(10)?.[1]).toBe('perk-pistol');
    expect(perkFor(11)).toBeNull();
  });
});
