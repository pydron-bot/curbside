import { describe, expect, it } from 'vitest';
import {
  CASH_HOURS,
  CASH_INSIDE,
  CASH_LIFE,
  CASH_SPILL_HEALTH,
  CASH_CLOCK,
  CONGA_CLOCK,
  CONGA_SECONDS,
  CashBundles,
  FILM_CLOCK,
  FILM_SECONDS,
  FUNERAL_CLOCK,
  FUNERAL_SECONDS,
  HYDRANT_CLOCK,
  HYDRANT_FADE,
  HYDRANT_SECONDS,
  KEBAB_CLOCK,
  KEBAB_SECONDS,
  SET_HALF,
  TAKE,
  Trail,
  carrying,
  cashSpill,
  congaJoiners,
  congaTime,
  cutsThrough,
  followSpeed,
  geyserStrength,
  inHours,
  kebabPhase,
  kebabTarget,
  kebabTime,
  kerbOf,
  madeReal,
  onSet,
  playsInIt,
  robbedByPlayer,
  ropePost,
  scatter,
  sprayReach,
  stepCashTrip,
  takePhase,
  type CashTrip,
  type IncidentClock,
} from '../src/systems/incidents';
import { BLOCK_SIZE, ROAD_WIDTH } from '../src/world/city';
import { generateCity } from '../src/world/city';
import { shopSpots } from '../src/world/shopSpots';

const kerb = () => ({ x: 0, z: 0, laneX: 0, laneZ: 0, heading: 0 });

describe('hours', () => {
  it('a window within the day, and one wrapping past midnight', () => {
    expect(inHours(12, CASH_HOURS)).toBe(true);
    expect(inHours(7.9, CASH_HOURS)).toBe(false);
    expect(inHours(18, CASH_HOURS)).toBe(false);
    expect(inHours(23, [20, 2.5])).toBe(true);
    expect(inHours(1, [20, 2.5])).toBe(true);
    expect(inHours(3, [20, 2.5])).toBe(false);
    expect(inHours(26, [20, 2.5])).toBe(true);
  });
});

describe('cooldowns', () => {
  const runs: Array<[string, IncidentClock, number]> = [
    ['cash run', CASH_CLOCK, 200],
    ['kebab', KEBAB_CLOCK, KEBAB_SECONDS[1]],
    ['funeral', FUNERAL_CLOCK, FUNERAL_SECONDS],
    ['hydrant', HYDRANT_CLOCK, HYDRANT_SECONDS],
    ['conga', CONGA_CLOCK, CONGA_SECONDS[1]],
    ['film shoot', FILM_CLOCK, FILM_SECONDS[1]],
  ];
  it.each(runs)('%s: one at a time, and the next never before the last is over', (_, c, longest) => {
    expect(c.cap).toBe(1);
    expect(c.every[0]).toBeGreaterThanOrEqual(longest);
    expect(c.every[1]).toBeGreaterThan(c.every[0]);
  });
});

describe('the kerb out from a shop', () => {
  it('finds the road beyond the pavement, the lane pulled in to the kerb, the kerb on the lane’s right', () => {
    // A shop at x = 52, its front facing +x: the road's centreline is x = 64.
    const k = kerbOf(52, 10, 1, 0, kerb());
    expect(k.x).toBeCloseTo(64 - ROAD_WIDTH / 2 - 0.7);
    expect(k.z).toBe(10);
    expect(k.laneX).toBeGreaterThan(k.x - 5);
    expect(k.laneX).toBeLessThan(64);
    // Right of the heading (-cos h, sin h) points back at the shop (-x).
    expect(-Math.cos(k.heading)).toBeCloseTo(-1);
    // Facing -z: the road is a block line below.
    const k2 = kerbOf(5, -54, 0, -1, kerb());
    expect(k2.z).toBeCloseTo(-64 + ROAD_WIDTH / 2 + 0.7);
    // Its right, (-cos h, sin h), back up at the shop (+z).
    expect(-Math.cos(k2.heading)).toBeCloseTo(0, 5);
    expect(Math.sin(k2.heading)).toBeCloseTo(1, 5);
  });

  it("every shopfront's kerb is a few metres out across its pavement", () => {
    const spots = shopSpots(generateCity(1337));
    for (const s of spots.slice(0, 400)) {
      const k = kerbOf(s.x, s.z, s.outX, s.outZ, kerb());
      const d = Math.hypot(k.x - s.x, k.z - s.z);
      expect(d).toBeGreaterThan(1);
      expect(d).toBeLessThan(4);
      // Along the out direction (it's in front of the shop, not behind).
      expect((k.x - s.x) * s.outX + (k.z - s.z) * s.outZ).toBeGreaterThan(0);
      // The lane stop is on a road (a block line within half a road's width).
      const c = s.outX !== 0 ? k.laneX : k.laneZ;
      const off = Math.abs(c - Math.round(c / BLOCK_SIZE) * BLOCK_SIZE);
      expect(off).toBeLessThan(ROAD_WIDTH / 2);
    }
  });
});

describe('cash-in-transit van', () => {
  it('the guard walks the box in, waits inside, walks it back, and is aboard', () => {
    const t: CashTrip = { leg: 'out', timer: 0 };
    expect(stepCashTrip(t, 1, false, false)).toBe('out');
    expect(stepCashTrip(t, 1, true, false)).toBe('inside');
    expect(stepCashTrip(t, CASH_INSIDE - 0.1, true, false)).toBe('inside');
    expect(stepCashTrip(t, 0.2, true, false)).toBe('back');
    expect(stepCashTrip(t, 1, false, false)).toBe('back');
    expect(stepCashTrip(t, 1, false, true)).toBe('aboard');
    expect(carrying('out')).toBe(true);
    expect(carrying('inside')).toBe(false);
    expect(carrying('back')).toBe(true);
    expect(carrying('aboard')).toBe(false);
  });

  it('spills when the van is broken open, or the guard is knocked down with the box', () => {
    const base = { wrecked: false, burning: false, health: 1, guardDown: false, carrying: false };
    expect(cashSpill(base)).toBeNull();
    expect(cashSpill({ ...base, health: CASH_SPILL_HEALTH - 0.01 })).toBe('van');
    expect(cashSpill({ ...base, health: CASH_SPILL_HEALTH + 0.01 })).toBeNull();
    expect(cashSpill({ ...base, wrecked: true })).toBe('van');
    expect(cashSpill({ ...base, burning: true })).toBe('van');
    expect(cashSpill({ ...base, guardDown: true })).toBeNull();
    expect(cashSpill({ ...base, guardDown: true, carrying: true })).toBe('guard');
  });

  it("the robbery is the player's only when they did it: not for a van the traffic hit or a guard a hydrant flattened", () => {
    const none = { taken: false, vanBlamed: false, guardByPlayer: false };
    expect(robbedByPlayer('van', none)).toBe(false);
    expect(robbedByPlayer('guard', none)).toBe(false);
    expect(robbedByPlayer('van', { ...none, taken: true })).toBe(true);
    expect(robbedByPlayer('van', { ...none, vanBlamed: true })).toBe(true);
    // A rammed van doesn't make a guard someone else knocked down the player's, nor the other way.
    expect(robbedByPlayer('guard', { ...none, vanBlamed: true })).toBe(false);
    expect(robbedByPlayer('van', { ...none, guardByPlayer: true })).toBe(false);
    expect(robbedByPlayer('guard', { ...none, guardByPlayer: true })).toBe(true);
  });

  it('bundles scatter apart, lie a while, and are taken within reach', () => {
    const out = { x: 0, z: 0 };
    const pts = [0, 1, 2, 3, 4].map((i) => ({ ...scatter(i, 5, 10, 10, 2.2, out) }));
    for (let i = 0; i < pts.length; i++) {
      expect(Math.hypot(pts[i].x - 10, pts[i].z - 10)).toBeLessThan(4);
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)).toBeGreaterThan(0.5);
    }
    const b = new CashBundles(3);
    b.drop(0, 0, 50, 0);
    b.drop(5, 0, 40, 1);
    expect(b.count).toBe(2);
    expect(b.at(0.5, 0, 1.3)?.value).toBe(50);
    expect(b.at(2.5, 0, 1.3)).toBeNull();
    b.step(CASH_LIFE + 0.5);
    expect(b.count).toBe(1);
    // Full: the oldest goes.
    b.drop(1, 1, 1, 50);
    b.drop(2, 2, 2, 51);
    b.drop(3, 3, 3, 52);
    expect(b.count).toBe(3);
    expect(b.at(5, 0, 1)).toBeNull();
    b.clear();
    expect(b.count).toBe(0);
  });
});

describe('kebab chucking-out time', () => {
  it('is round 2 a.m. in the Neon Mile and Cobble Row only', () => {
    expect(kebabTime(2, 'arts')).toBe(true);
    expect(kebabTime(1, 'oldtown')).toBe(true);
    expect(kebabTime(2, 'downtown')).toBe(false);
    expect(kebabTime(2, 'residential')).toBe(false);
    expect(kebabTime(23, 'arts')).toBe(false);
    expect(kebabTime(4, 'arts')).toBe(false);
  });

  it('spills out, heaves, then drains: no one new out at the end', () => {
    const L = 90;
    expect(kebabPhase(5, L)).toBe('spill');
    expect(kebabPhase(45, L)).toBe('peak');
    expect(kebabPhase(80, L)).toBe('drain');
    let last = 0;
    for (let t = 0; t < L * 0.74; t += 1) {
      const n = kebabTarget(t, L, 8);
      expect(n).toBeGreaterThanOrEqual(last);
      expect(n).toBeLessThanOrEqual(8);
      last = n;
    }
    expect(last).toBe(8);
    expect(kebabTarget(L * 0.8, L, 8)).toBe(0);
    expect(kebabTarget(0, L, 8)).toBeGreaterThan(0);
  });
});

describe('funeral procession', () => {
  it('a trail gives points back along the path, round a corner', () => {
    const t = new Trail(64, 0.5);
    // Up +z 10 m, then right along +x 10 m.
    for (let z = 0; z <= 10; z += 0.25) t.push(0, z);
    for (let x = 0; x <= 10; x += 0.25) t.push(x, 10);
    const out = { x: 0, z: 0 };
    t.at(10, 10, 4, out);
    expect(out.x).toBeCloseTo(6, 0);
    expect(out.z).toBeCloseTo(10, 5);
    t.at(10, 10, 14, out);
    expect(out.x).toBeCloseTo(0, 0);
    expect(out.z).toBeCloseTo(6, 0);
    // Past its end: the oldest point.
    t.at(10, 10, 999, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(0);
    // How far back a follower is: one on the line before the corner.
    expect(t.backOf(10, 10, 0.2, 5, 60)).toBeCloseTo(15, 0);
    expect(t.backOf(10, 10, 9, 10.3, 60)).toBeCloseTo(1, 0);
  });

  it('reset lays a straight line back along the heading', () => {
    const t = new Trail(32, 0.5);
    t.reset(0, 0, 0, 6);
    const out = { x: 0, z: 0 };
    t.at(0, 0, 5, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(-5);
    // Capacity holds.
    for (let i = 0; i < 100; i++) t.push(i, 0);
    expect(t.length).toBe(32);
  });

  it('cutting through is passing between two of its cars, not round the ends', () => {
    expect(cutsThrough(5, 0.5, 0, 0, 10, 0)).toBe(true);
    expect(cutsThrough(5, 3, 0, 0, 10, 0)).toBe(false);
    // At the ends: overtaking or tailing, not cutting through.
    expect(cutsThrough(0.5, 0.5, 0, 0, 10, 0)).toBe(false);
    expect(cutsThrough(11, 0, 0, 0, 10, 0)).toBe(false);
  });

  it('a follower closes up to its gap, holds the pace there, and waits when too close', () => {
    expect(followSpeed(8.5, 8.5, 5.5)).toBeCloseTo(5.5);
    expect(followSpeed(14, 8.5, 5.5)).toBeGreaterThan(5.5);
    expect(followSpeed(4, 8.5, 0)).toBe(0);
    expect(followSpeed(100, 8.5, 5.5)).toBeLessThan(10);
  });
});

describe('burst hydrant', () => {
  it('builds, goes full, eases off, and stops', () => {
    expect(geyserStrength(-1)).toBe(0);
    expect(geyserStrength(0.1)).toBeLessThan(0.5);
    expect(geyserStrength(10)).toBe(1);
    expect(geyserStrength(HYDRANT_SECONDS - HYDRANT_FADE / 2)).toBeCloseTo(0.5);
    expect(geyserStrength(HYDRANT_SECONDS)).toBe(0);
    expect(sprayReach(0)).toBe(0);
    expect(sprayReach(1)).toBeGreaterThan(sprayReach(0.3));
    expect(sprayReach(1)).toBeLessThan(3);
  });

  it('kids play in it by day when dry; otherwise people stand back', () => {
    expect(playsInIt(14, false)).toBe(true);
    expect(playsInIt(14, true)).toBe(false);
    expect(playsInIt(22, false)).toBe(false);
  });
});

describe('hen and stag conga', () => {
  it('late on, where there’s nightlife', () => {
    expect(congaTime(23, 1)).toBe(true);
    expect(congaTime(1, 0.6)).toBe(true);
    expect(congaTime(23, 0.1)).toBe(false);
    expect(congaTime(14, 1)).toBe(false);
  });

  it('a third piles into a fight (at least two), never the whole line', () => {
    expect(congaJoiners(6)).toBe(2);
    expect(congaJoiners(9)).toBe(3);
    expect(congaJoiners(2)).toBe(2);
  });
});

describe('film shoot', () => {
  it('a take: setup, ACTION, the blast, CUT, round again', () => {
    expect(takePhase(0)).toBe('setup');
    expect(takePhase(TAKE.action + 0.1)).toBe('action');
    expect(takePhase(TAKE.boom + 0.1)).toBe('boom');
    expect(takePhase(TAKE.cut + 0.1)).toBe('cut');
    expect(takePhase(TAKE.end + 0.1)).toBe('setup');
  });

  it('made real: stealing a car first, then a fight, then driving through it', () => {
    const none = { setHit: false, heroTaken: false, realFight: false };
    expect(madeReal(none)).toBeNull();
    expect(madeReal({ ...none, setHit: true })).toBe('wrecked');
    expect(madeReal({ ...none, realFight: true, setHit: true })).toBe('fight');
    expect(madeReal({ setHit: true, realFight: true, heroTaken: true })).toBe('stolen');
  });

  it('the set: its box along the kerb, and the cones round its ends and road side', () => {
    // Along +x; across is + to the left of the heading (toward the road), the shops on the right.
    const h = Math.PI / 2;
    expect(onSet(5, 0, 0, 0, h)).toBe(true);
    expect(onSet(SET_HALF[0] + 1, 0, 0, 0, h)).toBe(false);
    expect(onSet(0, SET_HALF[1] + 1, 0, 0, h)).toBe(false);
    expect(onSet(0, SET_HALF[1] + 1, 0, 0, h, 2)).toBe(true);
    const out = { x: 0, z: 0 };
    const n = 14;
    for (let i = 0; i < n; i++) {
      const p = ropePost(i, n, 0, 0, h, out);
      // On the edge of the box (within a hair), never the shop side (across -b).
      expect(onSet(p.x, p.z, 0, 0, h, 0.01)).toBe(true);
      expect(onSet(p.x, p.z, 0, 0, h, -0.01)).toBe(false);
      const across = p.x * Math.cos(h) - p.z * Math.sin(h);
      expect(across).toBeGreaterThan(-SET_HALF[1] - 0.01);
    }
    // The first and last close the ends at the shop side.
    const a = { ...ropePost(0, n, 0, 0, h, out) };
    const b = { ...ropePost(n - 1, n, 0, 0, h, out) };
    expect(Math.abs(a.x - b.x)).toBeCloseTo(SET_HALF[0] * 2);
  });
});

describe('wired up', () => {
  const ids = ['cashRun', 'kebab', 'funeral', 'hydrant', 'conga', 'filmShoot'] as const;

  it('each incident has a TEST menu button and a title highlight with a caption in caps', async () => {
    const { SCENES } = await import('../src/game/sceneStarter');
    const { HIGHLIGHTS } = await import('../src/game/attractHighlights');
    for (const id of ids) {
      expect(SCENES.some(([k]) => k === id)).toBe(true);
      const h = HIGHLIGHTS[id];
      expect(h.start).toBe(id);
      expect(h.caption).toBe(h.caption.toUpperCase());
    }
    // The night's show only at night; the day's by day.
    expect(inHours(2, HIGHLIGHTS.kebab.hours!)).toBe(true);
    expect(inHours(14, HIGHLIGHTS.kebab.hours!)).toBe(false);
    expect(inHours(23, HIGHLIGHTS.conga.hours!)).toBe(true);
    expect(inHours(12, HIGHLIGHTS.cashRun.hours!)).toBe(true);
    expect(inHours(23, HIGHLIGHTS.funeral.hours!)).toBe(false);
  });

  it('the awards score, and count as smashing things up in a Chaos Run', async () => {
    const { BASE_POINTS, LABELS, Score } = await import('../src/systems/score');
    const { categoryOf } = await import('../src/game/modes/chaosRun');
    for (const k of ['cashGrab', 'wrapped', 'noRespect'] as const) {
      expect(BASE_POINTS[k]).toBeGreaterThan(0);
      expect(LABELS[k]).toBe(LABELS[k].toUpperCase());
      expect(categoryOf(k)).toBe('smash');
      expect(new Score().award(k).points).toBe(BASE_POINTS[k]);
    }
  });
});
