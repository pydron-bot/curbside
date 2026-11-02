import { describe, expect, it } from 'vitest';
import { ROUTE_AHEAD, ROUTE_EVERY, RouteAhead, onRoute, routeAheadSpot } from '../src/systems/routeAhead';
import type { Rect } from '../src/world/city';
import { random } from './helpers';

/** The phone's view round (x, z) at speed: about 90 × 40 m. */
const viewAt = (x: number, z: number): Rect => ({ minX: x - 45, maxX: x + 45, minZ: z - 20, maxZ: z + 20 });
const free = () => false;

describe('route-ahead placement', () => {
  it('puts the spot 60–150 m ahead of the way the player is going, off-screen, its car coming their way', () => {
    const rand = random(11);
    // Up the road at x = 0 (+z), then along z = 64 (-x), then diagonally.
    const cases = [
      { px: 2, pz: -100, vx: 0, vz: 20 },
      { px: 120, pz: 66, vx: -18, vz: 0 },
      { px: -64, pz: -64, vx: 12, vz: 12 },
    ];
    for (const c of cases) {
      const view = viewAt(c.px, c.pz);
      let found = 0;
      for (let i = 0; i < 40; i++) {
        const s = routeAheadSpot(c.px, c.pz, c.vx, c.vz, view, rand, free);
        if (!s) continue;
        found++;
        const dx = s.x - c.px;
        const dz = s.z - c.pz;
        const d = Math.hypot(dx, dz);
        expect(d).toBeGreaterThanOrEqual(ROUTE_AHEAD[0]);
        expect(d).toBeLessThanOrEqual(ROUTE_AHEAD[1]);
        // Within 45° of their way.
        const sp = Math.hypot(c.vx, c.vz);
        expect((dx * c.vx + dz * c.vz) / sp / d).toBeGreaterThanOrEqual(Math.SQRT1_2 - 1e-9);
        // Off-screen.
        const inView = s.x > view.minX && s.x < view.maxX && s.z > view.minZ && s.z < view.maxZ;
        expect(inView).toBe(false);
        // Its car faces back toward the player (forward is (sin h, cos h)).
        expect(Math.sin(s.heading) * -dx + Math.cos(s.heading) * -dz).toBeGreaterThan(0);
        expect(s.driver).toBeTruthy();
      }
      expect(found).toBeGreaterThan(30);
    }
  });

  it('nothing for a player standing about or crawling, or when every spot is crowded', () => {
    const rand = random(3);
    expect(routeAheadSpot(0, 0, 0, 0, viewAt(0, 0), rand, free)).toBeNull();
    expect(routeAheadSpot(0, 0, 3, 3, viewAt(0, 0), rand, free)).toBeNull();
    expect(routeAheadSpot(2, -100, 0, 20, viewAt(2, -100), rand, () => true)).toBeNull();
  });

  it('nothing off the edge of the city', () => {
    // At the north edge driving out of town: no lane ahead to put anything on.
    expect(routeAheadSpot(2, -500, 0, -20, viewAt(2, -500), random(5), free)).toBeNull();
  });

  it('the throttle: only while wanted, at most once per ROUTE_EVERY seconds, fresh after a reset', () => {
    const r = new RouteAhead();
    expect(r.ready(0, 0)).toBe(false);
    expect(r.ready(0, 2)).toBe(true);
    r.used(10);
    expect(r.placed).toBe(1);
    expect(r.ready(10 + ROUTE_EVERY - 0.1, 5)).toBe(false);
    expect(r.ready(10 + ROUTE_EVERY, 1)).toBe(true);
    expect(r.ready(10 + ROUTE_EVERY, 0)).toBe(false);
    r.reset();
    expect(r.ready(11, 1)).toBe(true);
  });
});

describe('onRoute', () => {
  it('within 60° of a moving player\'s way; anywhere for one standing still', () => {
    expect(onRoute(0, 0, 0, 20, 0, 100)).toBe(true);
    expect(onRoute(0, 0, 0, 20, 50, 100)).toBe(true); // ~27°
    expect(onRoute(0, 0, 0, 20, 100, 50)).toBe(false); // ~63°
    expect(onRoute(0, 0, 0, 20, 0, -100)).toBe(false);
    expect(onRoute(0, 0, 0, 2, 0, -100)).toBe(true);
  });
});
