import { describe, expect, it, vi } from 'vitest';
import { CityMood, RAIN_THIN, densityFor, nightlifeAt, nightlifeFactor, rainPace } from '../src/game/cityMood';
import { Population, type Vehicle } from '../src/game/population';
import type { CharacterModel } from '../src/render/characterModel';
import { DISTRICTS, districtAt } from '../src/world/districts';
import { random } from './helpers';

describe('city mood: nightlife', () => {
  it('is off by day, eases in through the evening, full at night, gone by morning', () => {
    for (const h of [6, 9, 12, 15, 17.9]) expect(nightlifeFactor(h)).toBe(0);
    expect(nightlifeFactor(19)).toBeGreaterThan(0);
    expect(nightlifeFactor(19)).toBeLessThan(nightlifeFactor(21));
    for (const h of [22, 23.5, 0, 1, 2.9]) expect(nightlifeFactor(h)).toBe(1);
    expect(nightlifeFactor(4)).toBeGreaterThan(0);
    expect(nightlifeFactor(4)).toBeLessThan(1);
    // Wraps.
    expect(nightlifeFactor(24 + 23)).toBe(1);
    expect(nightlifeFactor(-1)).toBe(1);
  });

  it('is the Neon Mile\'s above all, none at the docks', () => {
    expect(nightlifeAt('arts', 23)).toBe(1);
    expect(nightlifeAt('oldtown', 23)).toBeGreaterThan(nightlifeAt('downtown', 23));
    expect(nightlifeAt('industrial', 23)).toBe(0);
    expect(nightlifeAt('arts', 12)).toBe(0);
  });
});

describe('city mood: densityFor', () => {
  it('shifts the crowd into the nightlife districts at night and out of the quiet ones', () => {
    expect(densityFor('arts', 23, 0)).toBeGreaterThan(densityFor('arts', 12, 0));
    expect(densityFor('oldtown', 23, 0)).toBeGreaterThanOrEqual(densityFor('oldtown', 12, 0));
    for (const quiet of ['industrial', 'residential', 'downtown'] as const) {
      expect(densityFor(quiet, 23, 0)).toBeLessThan(densityFor(quiet, 12, 0));
      expect(densityFor(quiet, 23, 0)).toBeLessThan(densityFor('arts', 23, 0) / 2);
    }
  });

  it('thins every street in the rain, by RAIN_THIN at full rain', () => {
    for (const d of DISTRICTS) {
      for (const h of [12, 23]) {
        const dry = densityFor(d, h, 0);
        const wet = densityFor(d, h, 1);
        expect(wet).toBeLessThan(dry);
        expect(wet).toBeGreaterThanOrEqual(0.15);
        if (dry * (1 - RAIN_THIN) > 0.15) expect(wet).toBeCloseTo(dry * (1 - RAIN_THIN), 5);
      }
    }
    expect(densityFor('downtown', 12, 0.5)).toBeGreaterThan(densityFor('downtown', 12, 1));
  });

  it('stays within bounds whatever it is given', () => {
    for (const d of DISTRICTS) {
      for (let h = -3; h < 30; h += 0.7) {
        for (const r of [-1, 0, 0.3, 1, 2]) {
          const v = densityFor(d, h, r);
          expect(v).toBeGreaterThanOrEqual(0.15);
          expect(v).toBeLessThanOrEqual(1.4);
        }
      }
    }
  });
});

describe('city mood: rain pace', () => {
  it('walks brisker the harder it rains, never past a fast walk', () => {
    expect(rainPace(0.5, 0)).toBe(0.5);
    expect(rainPace(0.5, 1)).toBeGreaterThan(0.7);
    expect(rainPace(0.5, 0.5)).toBeLessThan(rainPace(0.5, 1));
    expect(rainPace(0.9, 1)).toBe(1);
  });
});

describe('city mood: CityMood', () => {
  it('reads the density where you are and weights spawns toward the busiest district', () => {
    const m = new CityMood(23, 0);
    expect(m.nightlife).toBe(1);
    const arts = { x: 250, z: -250 };
    const docks = { x: 250, z: 250 };
    expect(districtAt(arts.x, arts.z)).toBe('arts');
    expect(districtAt(docks.x, docks.z)).toBe('industrial');
    expect(m.densityAt(arts.x, arts.z)).toBeCloseTo(densityFor('arts', 23, 0));
    expect(m.weight(arts.x, arts.z)).toBeCloseTo(1);
    expect(m.weight(docks.x, docks.z)).toBeLessThan(0.25);
    expect(m.nightlifeAt(arts.x, arts.z)).toBe(1);
    m.set(12, 1);
    expect(m.nightlife).toBe(0);
    expect(m.raining).toBe(true);
    expect(m.density('arts')).toBeCloseTo(densityFor('arts', 12, 1));
    // Rain thins everywhere alike: the weights don't move.
    expect(m.weight(arts.x, arts.z)).toBeCloseTo(densityFor('arts', 12, 1) / densityFor('downtown', 12, 1));
  });

  it('crowd upkeep keeps fewer spawns where the weight is low', () => {
    const count = (weight?: (x: number, z: number) => number) => {
      const vehicles: Vehicle[] = [];
      const pop = new Population(
        vehicles,
        {
          createVehicle: () => {
            throw new Error('no traffic here');
          },
          resetVehicle: () => {},
          createPedModel: (_o, body) => ({ root: { visible: true }, dispose: vi.fn(), reset: vi.fn(), setOutfit: vi.fn(), bodyKind: body }) as unknown as CharacterModel,
        },
        random(3),
      );
      const view = { minX: -18, maxX: 18, minZ: -8, maxZ: 8 };
      // Traffic off (scale 0), one round of crowd spawning.
      pop.maintain({ x: 0, z: 0, vx: 0, vz: 0, view, keep: [], trafficScale: 0, spawnWeight: weight });
      return pop.crowd.length;
    };
    const all = count();
    expect(all).toBeGreaterThan(0);
    expect(count(() => 0)).toBe(0);
    expect(count(() => 0.2)).toBeLessThan(all);
  });
});
