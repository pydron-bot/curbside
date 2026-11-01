import { describe, expect, it } from 'vitest';
import {
  SHOVE_REACH,
  barges,
  busDoor,
  cartBusyness,
  cartSpot,
  nextCorner,
  planFight,
  shelterSpot,
  sidestep,
  type FightPlan,
  type Stand,
} from '../src/systems/streetPeople';
import { generateCity } from '../src/world/city';
import { WALK_LINE } from '../src/world/kerbs';
import { dressCity } from '../src/world/dressing';
import { random } from './helpers';

const out = (): Stand => ({ x: 0, z: 0, heading: 0 });

describe('bus shelters', () => {
  it('riders wait along the front a pace apart, the first in the middle, a second row behind, all facing the road', () => {
    // A shelter facing +x (the road to its east).
    const h = Math.PI / 2;
    const spots = [0, 1, 2, 3, 4].map((i) => ({ ...shelterSpot(10, 0, h, i, out()) }));
    expect(spots[0]).toMatchObject({ x: 10, z: 0 });
    expect(spots[1].x).toBeCloseTo(10);
    expect(spots[2].x).toBeCloseTo(10);
    expect(Math.abs(spots[1].z - spots[2].z)).toBeCloseTo(2.2);
    // The back row is further from the road.
    expect(spots[3].x).toBeLessThan(10);
    expect(spots[4].x).toBeLessThan(10);
    for (const s of spots) expect(s.heading).toBe(h);
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z)).toBeGreaterThan(0.6);
  });

  it('the doors are on the kerb side, the front one toward the nose', () => {
    // Heading +z: the kerb (right) is -x.
    const front = { ...busDoor(0, 0, 0, 5.8, 1.3, true, { x: 0, z: 0 }) };
    const middle = { ...busDoor(0, 0, 0, 5.8, 1.3, false, { x: 0, z: 0 }) };
    expect(front.x).toBeCloseTo(-1.9);
    expect(front.z).toBeGreaterThan(3);
    expect(middle.z).toBeCloseTo(0);
  });
});

describe('food carts', () => {
  const city = generateCity(1337);
  const vendors = dressCity(city, [], []).street.vendors;

  it("a kerb cart's queue steps off the walking line; the first faces the cart, the rest the one ahead", () => {
    const kerb = vendors.filter((v) => v.setting === 'kerb');
    expect(kerb.length).toBeGreaterThan(20);
    for (const v of kerb) {
      const first = cartSpot(v, 0, true, out());
      // Facing the cart.
      const toCart = Math.atan2(v.x - first.x, v.z - first.z);
      expect(Math.cos(first.heading - toCart)).toBeGreaterThan(0.9);
      // Distance from the walking line: |offset from the road centreline| - WALK_LINE, along the serving direction.
      const offWalk = (s: Stand) => Math.abs((s.x - v.serveX) * Math.sin(v.heading) + (s.z - v.serveZ) * Math.cos(v.heading));
      for (const i of [2, 3]) {
        const s = cartSpot(v, i, true, out());
        expect(offWalk(s)).toBeGreaterThan(0.9);
        const ahead = cartSpot(v, i - 1, true, out());
        const toAhead = Math.atan2(ahead.x - s.x, ahead.z - s.z);
        expect(Math.cos(s.heading - toAhead)).toBeGreaterThan(0.99);
        // Still on the pavement: no further from the serving point across the walk than the pavement allows.
        expect(offWalk(s)).toBeLessThan(11 - WALK_LINE + 0.5);
      }
    }
  });

  it('a park cart’s queue runs straight along its line', () => {
    const lot = vendors.find((v) => v.setting !== 'kerb')!;
    const s = cartSpot(lot, 3, false, out());
    expect(s.x).toBeCloseTo(lot.serveX + lot.queueX * 2.7);
    expect(s.z).toBeCloseTo(lot.serveZ + lot.queueZ * 2.7);
  });

  it('is busiest at lunch and in the evening, quiet at night', () => {
    expect(cartBusyness(13)).toBeGreaterThan(0.9);
    expect(cartBusyness(18.5)).toBeGreaterThan(0.9);
    expect(cartBusyness(10.5)).toBeLessThan(0.5);
    expect(cartBusyness(3)).toBeLessThan(0.1);
    expect(cartBusyness(27)).toBeCloseTo(cartBusyness(3));
    for (let h = 0; h < 24; h += 0.5) {
      expect(cartBusyness(h)).toBeGreaterThanOrEqual(0);
      expect(cartBusyness(h)).toBeLessThanOrEqual(1);
    }
  });
});

describe('walkers step round people standing', () => {
  it('steps aside across their way, away from the one standing, never further than asked', () => {
    const o = { x: 0, z: 0 };
    // Walking +z, passing just right (+x) of someone at the origin.
    expect(sidestep(0.2, -0.3, 0, 1.5, 0, 0, 0.75, 0.05, o)).toBe(true);
    expect(o.x).toBeCloseTo(0.25);
    expect(o.z).toBeCloseTo(-0.3);
    // On the other side: steps the other way.
    expect(sidestep(-0.2, -0.3, 0, 1.5, 0, 0, 0.75, 0.05, o)).toBe(true);
    expect(o.x).toBeCloseTo(-0.25);
    // Clear: untouched.
    o.x = 99;
    expect(sidestep(1, 0, 0, 1.5, 0, 0, 0.75, 0.05, o)).toBe(false);
    expect(o.x).toBe(99);
  });

  it('a stream of walkers down a line through someone standing all get past, none ends inside', () => {
    const o = { x: 0, z: 0 };
    for (const x0 of [-0.3, -0.1, 0, 0.1, 0.3]) {
      let x = x0;
      let z = -5;
      let minD = Infinity;
      for (let t = 0; t < 8; t += 1 / 60) {
        z += 1.5 / 60;
        if (sidestep(x, z, 0, 1.5, 0, 0, 0.75, 2.5 / 60, o)) {
          x = o.x;
          z = o.z;
        }
        minD = Math.min(minD, Math.hypot(x, z));
      }
      expect(z).toBeGreaterThan(5);
      expect(minD).toBeGreaterThan(0.25);
    }
  });
});

describe('scuffles', () => {
  it('running into someone barges them; walking past or running away does not', () => {
    expect(barges(0, 0, 0, 5, 0, 0.5)).toBe(true);
    expect(barges(0, 0, 0, 2, 0, 0.5)).toBe(false);
    expect(barges(0, 0, 0, -5, 0, 0.5)).toBe(false);
    expect(barges(0, 0, 0, 5, 0, SHOVE_REACH + 0.1)).toBe(false);
  });

  it('calm people back down more often; a knockout now and then', () => {
    const rand = random(9);
    const plan: FightPlan = { backsDown: false, knockout: false, seconds: 0 };
    const n = { calm: 0, fighter: 0, ko: 0 };
    for (let i = 0; i < 2000; i++) {
      if (planFight(rand, true, plan).backsDown) n.calm++;
      if (planFight(rand, false, plan).backsDown) n.fighter++;
      if (plan.knockout) n.ko++;
      expect(plan.seconds).toBeGreaterThanOrEqual(6);
      expect(plan.seconds).toBeLessThanOrEqual(10);
    }
    expect(n.calm).toBeGreaterThan(n.fighter * 2);
    expect(n.ko / 2000).toBeGreaterThan(0.2);
    expect(n.ko / 2000).toBeLessThan(0.4);
  });
});

describe('a runner’s route', () => {
  it('goes round the block either way, or across to the mirrored corner next door', () => {
    const o = { bx: 0, bz: 0, corner: 0 };
    expect(nextCorner(3, 3, 0, true, false, 16, o)).toEqual({ bx: 3, bz: 3, corner: 1 });
    expect(nextCorner(3, 3, 0, false, false, 16, o)).toEqual({ bx: 3, bz: 3, corner: 3 });
    expect(nextCorner(3, 3, 1, true, true, 16, o)).toEqual({ bx: 4, bz: 3, corner: 0 });
    expect(nextCorner(3, 3, 3, true, true, 16, o)).toEqual({ bx: 2, bz: 3, corner: 2 });
    // At the city's edge it carries on round instead.
    expect(nextCorner(15, 3, 2, true, true, 16, o)).toEqual({ bx: 15, bz: 3, corner: 3 });
  });
});
