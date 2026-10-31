import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type EventOf } from '../src/core/events';
import {
  AWNING_CLEAR,
  BREACH,
  BREACH_DEPTH_CAP,
  BREACH_RADIUS_CAP,
  BreachSystem,
  Breaches,
  MAX_BREACHES,
  MIN_STRENGTH,
  WALL_BLAST_OUT,
  blastKindOf,
  breachStrength,
  nearestFace,
  wallToBlow,
  type AwningSpan,
  type BreachFace,
  type WallAhead,
} from '../src/systems/breaches';
import { AWNING_HEIGHT, planBuildings } from '../src/world/buildingPlans';
import type { Building, Rect } from '../src/world/city';
import { generateCity } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { mulberry32 } from '../src/world/random';

const face = (): BreachFace => ({ side: 0, px: 0, pz: 0, nx: 0, nz: 0, dist: 0 });
const wall = (): WallAhead => ({ building: -1, side: 0, x: 0, z: 0, dist: 0, offScreen: false });

function building(minX: number, minZ: number, maxX: number, maxZ: number, height = 10): Building {
  return { minX, minZ, maxX, maxZ, height, tint: 0.5, district: 'downtown' };
}

/** A tiny world: the buildings plus any extra rects (trees, dressing) in a grid that returns everything. */
function world(buildings: Building[], extra: Rect[] = [], awnings: AwningSpan[][] = []) {
  const rects: Rect[] = [...buildings, ...extra];
  const grid = { near: () => rects };
  const index = new Map<Rect, number>(buildings.map((b, i) => [b, i]));
  return new Breaches(buildings, grid, index, awnings);
}

const BIG = building(0, 0, 20, 10, 10);

afterEach(() => vi.restoreAllMocks());

describe('nearestFace', () => {
  it('gives the side, the point on it and the distance from each direction', () => {
    expect(nearestFace(BIG, 10, -2, face())).toMatchObject({ side: 0, px: 10, pz: 0, nx: 0, nz: -1, dist: 2 });
    expect(nearestFace(BIG, 23, 5, face())).toMatchObject({ side: 1, px: 20, pz: 5, nx: 1, nz: 0, dist: 3 });
    expect(nearestFace(BIG, 10, 12, face())).toMatchObject({ side: 2, px: 10, pz: 10, nx: 0, nz: 1, dist: 2 });
    expect(nearestFace(BIG, -1, 5, face())).toMatchObject({ side: 3, px: 0, pz: 5, nx: -1, nz: 0, dist: 1 });
  });

  it('a point inside (a rocket that ended up in the wall) gets the least-penetration face at distance 0', () => {
    expect(nearestFace(BIG, 0.3, 5, face())).toMatchObject({ side: 3, px: 0, pz: 5, dist: 0 });
    expect(nearestFace(BIG, 10, 9.6, face())).toMatchObject({ side: 2, px: 10, pz: 10, dist: 0 });
  });

  it('in a corner region the larger gap wins, and an exact diagonal goes to the z face', () => {
    expect(nearestFace(BIG, -1, -3, face()).side).toBe(0);
    expect(nearestFace(BIG, -3, -1, face()).side).toBe(3);
    expect(nearestFace(BIG, -2, -2, face()).side).toBe(0);
    expect(nearestFace(BIG, 22, 12, face()).side).toBe(2);
    expect(nearestFace(BIG, -2, -2, face()).dist).toBeCloseTo(Math.SQRT2 * 2, 12);
  });
});

describe('breach strength and size', () => {
  it('strength is 1 at the face and falls monotonically to 0 at reach', () => {
    for (const kind of ['car', 'grenade', 'rocket'] as const) {
      const reach = BREACH[kind].reach;
      expect(breachStrength(kind, 0)).toBe(1);
      expect(breachStrength(kind, reach)).toBe(0);
      expect(breachStrength(kind, reach + 3)).toBe(0);
      let prev = 1;
      for (let d = 0.1; d < reach; d += 0.1) {
        const s = breachStrength(kind, d);
        expect(s).toBeLessThan(prev);
        expect(s).toBeGreaterThan(0);
        prev = s;
      }
    }
  });

  it('at equal distance a rocket makes the biggest crater, then a car, then a grenade', () => {
    const r = (kind: 'car' | 'grenade' | 'rocket') => world([BIG]).blast(kind, 10, 11)!.radius;
    expect(r('rocket')).toBeGreaterThan(r('car'));
    expect(r('car')).toBeGreaterThan(r('grenade'));
  });

  it('caps hold on a small building, and the crater sits off the ground and under the roof', () => {
    const small = building(0, 0, 2.6, 2.6, 2.6);
    const b = world([small]).blast('rocket', 1.3, 2.7)!;
    expect(b.radius).toBeLessThanOrEqual(0.45 * 2.6 + 1e-9);
    expect(b.depth).toBeLessThanOrEqual(0.3 * 2.6 + 1e-9);
    expect(b.y).toBeGreaterThanOrEqual(0.35 * b.radius);
    expect(b.y).toBeLessThanOrEqual(2.6 - 0.6 * b.radius + 1e-9);
    for (const kind of ['car', 'grenade', 'rocket'] as const) {
      const c = world([BIG]).blast(kind, 10, 10.5)!;
      expect(c.y).toBeGreaterThanOrEqual(0.35 * c.radius);
      expect(c.y).toBeLessThanOrEqual(BIG.height - 0.6 * c.radius);
      expect(c.depth).toBeLessThanOrEqual(BREACH_DEPTH_CAP);
    }
  });

  it('the centre stays off the corners, on the face plane', () => {
    const b = world([BIG]).blast('rocket', -0.5, 10.5)!;
    expect(b.side).toBe(2);
    expect(b.z).toBe(10);
    expect(b.x).toBeGreaterThanOrEqual(0.6 * b.radius);
    expect(b.nx).toBe(0);
    expect(b.nz).toBe(1);
  });
});

describe('the breach rule at its edges', () => {
  it('a thin building caps the depth at 30% of its thickness', () => {
    const thin = building(0, 0, 20, 1.5, 10);
    const b = world([thin]).blast('rocket', 10, 1.8)!;
    // Uncapped it would be deeper.
    expect(BREACH.rocket.depth * (0.6 + 0.4 * breachStrength('rocket', 0.3))).toBeGreaterThan(0.6);
    expect(b.depth).toBeCloseTo(0.3 * 1.5, 12);
  });

  it('a blast just inside the MIN_STRENGTH distance breaches; just outside, it does not', () => {
    for (const kind of ['car', 'grenade', 'rocket'] as const) {
      const edge = BREACH[kind].reach * (1 - MIN_STRENGTH * MIN_STRENGTH);
      expect(world([BIG]).blast(kind, 10, 10 + edge - 0.01), kind).not.toBeNull();
      expect(world([BIG]).blast(kind, 10, 10 + edge + 0.01), kind).toBeNull();
    }
  });

  it('a blast overlapping two craters grows the nearer one', () => {
    const w = world([BIG]);
    const a = { ...w.blast('grenade', 10, 10.3)! };
    const b = { ...w.blast('grenade', 11.6, 10.3)! };
    expect(b.merged).toBe(false);
    expect(w.blast('grenade', 11, 10.3)).toMatchObject({ merged: true, slot: b.slot });
    expect(w.blast('grenade', 10.2, 10.3)).toMatchObject({ merged: true, slot: a.slot });
    expect(w.count).toBe(2);
  });

  it('a blast overlapping a crater along the face but well above it makes its own', () => {
    // The awning lifts the rocket's crater 2.4 m over the grenade's beside it.
    const w = world([BIG], [], [[{ side: 2, from: 10, to: 14 }]]);
    const low = { ...w.blast('grenade', 8, 10.3)! };
    const high = { ...w.blast('rocket', 9.2, 10.3)! };
    expect(Math.abs(high.x - low.x)).toBeLessThan(0.6 * (low.radius + high.radius));
    expect(high.y - low.y).toBeGreaterThanOrEqual(0.6 * (low.radius + high.radius));
    expect(high.merged).toBe(false);
    expect(high.slot).not.toBe(low.slot);
  });

  it('blastKindOf: grenades and rockets by name, anything else is a car', () => {
    expect(blastKindOf('grenade')).toBe('grenade');
    expect(blastKindOf('rocket')).toBe('rocket');
    expect(blastKindOf('vehicle')).toBe('car');
    expect(blastKindOf(undefined)).toBe('car');
  });
});

describe('awnings', () => {
  const awning: AwningSpan[][] = [[{ side: 2, from: 10, to: 14 }]];

  it('a crater under an awning goes above it (the overhead camera cannot see under one)', () => {
    const plain = world([BIG]).blast('rocket', 12, 10.3)!;
    const b = world([BIG], [], awning).blast('rocket', 12, 10.3)!;
    expect(plain.y).toBe(BREACH.rocket.centreY);
    expect(b.y).toBeCloseTo(AWNING_HEIGHT + AWNING_CLEAR * b.radius, 12);
    expect(b.x).toBe(plain.x);
    expect(b.radius).toBe(plain.radius);
  });

  it('only when the crater reaches the awning, and only on its side', () => {
    const w = world([BIG], [], awning);
    expect(w.blast('grenade', 5, 10.3)!.y).toBe(BREACH.grenade.centreY);
    expect(w.underAwning(0, 2, 5, 1)).toBe(false);
    expect(w.underAwning(0, 2, 9.1, 1)).toBe(true);
    expect(w.underAwning(0, 0, 12, 1)).toBe(false);
    expect(world([BIG], [], awning).blast('rocket', 12, -0.3)!.y).toBe(BREACH.rocket.centreY);
  });

  it('a low building keeps the crater under its roof line', () => {
    const shop = building(0, 0, 20, 10, 4);
    const b = world([shop], [], awning).blast('rocket', 12, 10.3)!;
    expect(b.y).toBeCloseTo(4 - 0.6 * b.radius, 12);
  });

  it('probe reports the crater a first blast makes, without making it', () => {
    const w = world([BIG], [], awning);
    const p = w.probe('rocket', 12, 10.4)!;
    expect(w.count).toBe(0);
    const b = w.blast('rocket', 12, 10.4)!;
    expect(p).toMatchObject({ building: 0, side: 2, x: b.x, y: b.y, z: b.z, radius: b.radius });
  });

  it('on the real city every first crater that reaches an awning sits above it', () => {
    const city = generateCity(1337);
    const grid = new StaticGrid(city.obstacles);
    const index = new Map<Rect, number>(city.buildings.map((b, i) => [b, i]));
    const awnings = planBuildings(city).map((p) => p.shopfronts.filter((s) => s.awning !== null));
    let raised = 0;
    for (let i = 0; i < city.buildings.length; i += 7) {
      const b = city.buildings[i];
      const w = new Breaches(city.buildings, grid, index, awnings);
      const r = w.blast('rocket', (b.minX + b.maxX) / 2, b.maxZ + 0.3);
      if (!r || r.building !== i) continue;
      if (!w.underAwning(i, r.side, r.x, r.radius)) continue;
      raised++;
      expect(r.y - 0.85 * r.radius, `building ${i}`).toBeGreaterThanOrEqual(Math.min(AWNING_HEIGHT - 0.35 * r.radius, b.height - 1.45 * r.radius) - 1e-9);
    }
    expect(raised).toBeGreaterThan(10);
  });
});

describe('Breaches.blast', () => {
  it('ignores trees and dressing (rects that are not buildings) and anything out of reach', () => {
    const tree: Rect = { minX: 9, minZ: 11, maxX: 11, maxZ: 13 };
    const w = world([BIG], [tree]);
    // Nearer the tree box than the wall: still the wall.
    const b = w.blast('car', 10, 13.5)!;
    expect(b.building).toBe(0);
    expect(b.side).toBe(2);
    expect(world([BIG]).blast('car', 10, 10 + BREACH.car.reach + 0.01)).toBeNull();
    expect(world([BIG]).blast('grenade', 10, 10 + BREACH.grenade.reach)).toBeNull();
    expect(world([BIG], [tree]).blast('rocket', 10, 30)).toBeNull();
  });

  it('picks the nearer of two buildings', () => {
    const other = building(0, 14, 20, 24, 8);
    expect(world([BIG, other]).blast('car', 10, 11)!.building).toBe(0);
    expect(world([BIG, other]).blast('car', 10, 13)!).toMatchObject({ building: 1, side: 0 });
  });

  it('two faces at the same distance: the lower building index wins, whatever order the grid lists them in', () => {
    const other = building(0, 12, 20, 22, 8);
    const buildings = [BIG, other];
    for (const order of [[BIG, other], [other, BIG]]) {
      const grid = { near: () => order };
      const w = new Breaches(buildings, grid, new Map<Rect, number>(buildings.map((b, i) => [b, i])));
      expect(w.blast('car', 5, 11)).toMatchObject({ building: 0, side: 2 });
    }
    // Swap their indices: now the other one wins.
    const swapped = [other, BIG];
    const w = new Breaches(swapped, { near: () => swapped }, new Map<Rect, number>(swapped.map((b, i) => [b, i])));
    expect(w.blast('car', 5, 11)).toMatchObject({ building: 0, side: 0 });
  });

  it('returns the same object every call', () => {
    const w = world([BIG]);
    const a = w.blast('car', 10, 11);
    const b = w.blast('car', 2, 11);
    expect(a).toBe(b);
  });

  it('three rockets on one spot grow one crater to the cap', () => {
    const w = world([BIG]);
    const a = { ...w.blast('rocket', 10, 10.3)! };
    const b = { ...w.blast('rocket', 10, 10.3)! };
    const c = { ...w.blast('rocket', 10, 10.3)! };
    expect(a.merged).toBe(false);
    expect(b.merged).toBe(true);
    expect(c.merged).toBe(true);
    expect(b.slot).toBe(a.slot);
    expect(c.slot).toBe(a.slot);
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(c.radius).toBeLessThanOrEqual(BREACH_RADIUS_CAP);
    expect(c.radius).toBe(BREACH_RADIUS_CAP);
    expect(b.depth).toBeGreaterThan(a.depth);
    expect(c.depth).toBeLessThanOrEqual(BREACH_DEPTH_CAP);
    expect(c.hits).toBe(3);
    expect(w.count).toBe(1);
    // A new hit gets a new layout seed.
    expect(b.seed).not.toBe(a.seed);
  });

  it('two spots far apart on one face, or the other face at a corner, are separate craters', () => {
    const w = world([BIG]);
    const a = { ...w.blast('rocket', 3, 10.3)! };
    const b = { ...w.blast('rocket', 17, 10.3)! };
    expect(b.slot).not.toBe(a.slot);
    expect(b.merged).toBe(false);
    const c = { ...w.blast('rocket', 20.3, 9) };
    expect(c.side).toBe(1);
    expect(c.merged).toBe(false);
    expect(w.count).toBe(3);
  });

  it('the 33rd crater replaces the oldest; reset empties every slot', () => {
    const long = building(0, 0, 220, 10, 10);
    const w = world([long]);
    const slots: number[] = [];
    for (let i = 0; i < MAX_BREACHES; i++) slots.push(w.blast('rocket', 3 + i * 6.5, 10.3)!.slot);
    expect(new Set(slots).size).toBe(MAX_BREACHES);
    expect(w.count).toBe(MAX_BREACHES);
    const first = slots[0];
    const next = w.blast('rocket', 3 + MAX_BREACHES * 6.5, 10.3)!;
    expect(next.merged).toBe(false);
    expect(next.slot).toBe(first);
    expect(w.count).toBe(MAX_BREACHES);
    w.reset();
    expect(w.count).toBe(0);
    expect(w.slots.every((s) => s === null)).toBe(true);
  });

  it('the slot replaced is the one hit longest ago: a crater hit again counts as new', () => {
    const long = building(0, 0, 220, 10, 10);
    const w = world([long]);
    const slots: number[] = [];
    for (let i = 0; i < MAX_BREACHES; i++) slots.push(w.blast('rocket', 3 + i * 6.5, 10.3)!.slot);
    // The first crater is hit again (a merge): the second is now the oldest.
    expect(w.blast('rocket', 3, 10.3)).toMatchObject({ slot: slots[0], merged: true });
    const next = w.blast('rocket', 3 + MAX_BREACHES * 6.5, 10.3)!;
    expect(next.merged).toBe(false);
    expect(next.slot).toBe(slots[1]);
    expect(w.slots[slots[0]]).not.toBeNull();
  });

  it('is deterministic and uses no randomness, pow or hypot', () => {
    const city = generateCity(1337);
    const grid = new StaticGrid(city.obstacles);
    const index = new Map<Rect, number>(city.buildings.map((b, i) => [b, i]));
    const rand = mulberry32(99);
    const shots: Array<[('car' | 'grenade' | 'rocket'), number, number]> = [];
    for (let i = 0; i < 300; i++) {
      const b = city.buildings[Math.floor(rand() * city.buildings.length)];
      const kinds = ['car', 'grenade', 'rocket'] as const;
      shots.push([kinds[i % 3], b.minX + (b.maxX - b.minX) * rand(), b.maxZ + rand() * 3]);
    }
    const awnings = planBuildings(city).map((p) => p.shopfronts.filter((s) => s.awning !== null));
    const random = vi.spyOn(Math, 'random');
    const pow = vi.spyOn(Math, 'pow');
    const hypot = vi.spyOn(Math, 'hypot');
    const run = () => {
      const w = new Breaches(city.buildings, grid, index, awnings);
      return shots.map(([k, x, z]) => {
        const r = w.blast(k, x, z);
        return r ? { ...r } : null;
      });
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.filter((r) => r !== null).length).toBeGreaterThan(100);
    expect(random).not.toHaveBeenCalled();
    expect(pow).not.toHaveBeenCalled();
    expect(hypot).not.toHaveBeenCalled();
  });
});

describe('the breach rule on the real city', () => {
  it('a rocket just outside a face breaches that face (as a brute-force search over every building says)', () => {
    const city = generateCity(1337);
    const B = city.buildings;
    const grid = new StaticGrid(city.obstacles);
    const index = new Map<Rect, number>(B.map((b, i) => [b, i]));
    const w = new Breaches(B, grid, index);
    const f = face();
    let checked = 0;
    let own = 0;
    for (let i = 0; i < B.length; i += 50) {
      const b = B[i];
      const mx = (b.minX + b.maxX) / 2;
      const mz = (b.minZ + b.maxZ) / 2;
      const points: Array<[number, number, number]> = [
        [0, mx, b.minZ - 0.3],
        [1, b.maxX + 0.3, mz],
        [2, mx, b.maxZ + 0.3],
        [3, b.minX - 0.3, mz],
      ];
      for (const [side, x, z] of points) {
        let bestD = Infinity;
        let bestI = -1;
        let bestSide = -1;
        let clearance = Infinity;
        B.forEach((c, j) => {
          const g = nearestFace(c, x, z, f);
          if (g.dist < bestD || (g.dist === bestD && j < bestI)) {
            bestD = g.dist;
            bestI = j;
            bestSide = g.side;
          }
          if (j !== i) clearance = Math.min(clearance, g.dist);
        });
        const p = w.probe('rocket', x, z)!;
        expect(p, `building ${i} side ${side}`).not.toBeNull();
        expect(p.building).toBe(bestI);
        expect(p.side).toBe(bestSide);
        checked++;
        if (clearance >= 1) {
          own++;
          expect(p.building, `building ${i} side ${side}`).toBe(i);
          expect(p.side).toBe(side);
        }
      }
    }
    expect(checked).toBe(4 * Math.ceil(B.length / 50));
    expect(own).toBeGreaterThan(checked / 2);
  });
});

describe('wallToBlow (BLOW A WALL)', () => {
  const view: Rect = { minX: -20, minZ: -5, maxX: 40, maxZ: 35 };

  it('facing a building: its camera-facing side, WALL_BLAST_OUT out, hit hard', () => {
    const w = world([BIG]);
    const r = wallToBlow(w, 10, 20, Math.PI, 10, 23, view, wall())!;
    expect(r).toMatchObject({ building: 0, side: 2, offScreen: false });
    expect(r.x).toBeCloseTo(10, 9);
    expect(r.z).toBeCloseTo(10 + WALL_BLAST_OUT, 9);
    expect(r.dist).toBeCloseTo(10, 9);
    // The dry run agrees: a rocket there breaches that face, at three quarters strength or more.
    const p = w.probe('rocket', r.x, r.z)!;
    expect(p).toMatchObject({ building: 0, side: 2 });
    expect(p.strength).toBeGreaterThanOrEqual(0.75);
  });

  it('a camera-facing face in view wins over a nearer face turned away from the camera', () => {
    const behind = building(0, 22, 20, 30, 6);
    // Heading at the turned-away face, 2 m off: it still loses.
    const r = wallToBlow(world([BIG, behind]), 10, 20, 0, 10, 23, view, wall())!;
    expect(r).toMatchObject({ building: 0, side: 2 });
  });

  it('a face in front beats a nearer one behind', () => {
    const south = building(0, 26, 20, 34, 6);
    const w = world([BIG, south]);
    expect(wallToBlow(w, 10, 20, Math.PI, 10, 23, view, wall())).toMatchObject({ building: 0, side: 2 });
    expect(wallToBlow(w, 10, 20, 0, 10, 23, view, wall())).toMatchObject({ building: 1, side: 0 });
  });

  it('the blast point keeps 1.5 m from the end of the face', () => {
    const r = wallToBlow(world([BIG]), -0.5, 16, Math.PI, -0.5, 19, view, wall())!;
    expect(r).toMatchObject({ building: 0, side: 2 });
    expect(r.x).toBeCloseTo(1.5, 9);
    expect(r.z).toBeCloseTo(10 + WALL_BLAST_OUT, 9);
  });

  it('a face whose blast point another building would take is skipped for the next', () => {
    // A low shed hugs the middle of the south face: a rocket there would breach the shed.
    const shed = building(8, 10.2, 12, 10.6, 1);
    const east = building(30, 0, 40, 10, 8);
    const w = world([BIG, shed, east]);
    const r = wallToBlow(w, 10, 20, Math.PI, 10, 10.4, view, wall())!;
    // The east building's nearest camera-facing face (its west side, 23 m off).
    expect(r).toMatchObject({ building: 2, side: 3, offScreen: false });
  });

  it('a face whose crater would be hidden (off screen, under the HUD) gives way to the next, else falls back off-screen', () => {
    const south = building(0, 26, 20, 34, 6);
    const w = world([BIG, south]);
    const tops: number[] = [];
    // Only the crater on building 0 is hidden.
    const r = wallToBlow(w, 10, 20, Math.PI, 10, 23, view, wall(), (_x, y, z) => {
      tops.push(y);
      return z > 15;
    })!;
    expect(r).toMatchObject({ building: 1, side: 0, offScreen: false });
    // It is asked about the top of the crater, not the foot of the wall.
    const p = w.probe('rocket', 10, 10 + WALL_BLAST_OUT)!;
    expect(tops[0]).toBeCloseTo(p.y + 0.85 * p.radius, 12);
    expect(wallToBlow(w, 10, 20, Math.PI, 10, 23, view, wall(), () => false)).toMatchObject({ offScreen: true });
  });

  it('nothing in view falls back to the nearest face within 40 m; nothing at all is null', () => {
    const w = world([BIG]);
    expect(wallToBlow(w, 10, 45, Math.PI, 10, 48, view, wall())).toMatchObject({ building: 0, side: 2, offScreen: true });
    expect(wallToBlow(w, 10, 80, Math.PI, 10, 83, view, wall())).toBeNull();
    expect(wallToBlow(world([]), 10, 20, Math.PI, 10, 23, view, wall())).toBeNull();
  });
});

describe('BreachSystem', () => {
  function setup(enabled = true, playing = true) {
    const bus = new EventBus();
    const w = world([BIG]);
    const state = { enabled, playing };
    new BreachSystem(bus, w, { enabled: () => state.enabled, playing: () => state.playing });
    const breaches: Array<EventOf<'breach'>> = [];
    let explosions = 0;
    bus.on('breach', (e) => breaches.push(e));
    bus.on('explosion', () => explosions++);
    const boom = (x: number, z: number, source?: 'vehicle' | 'grenade' | 'rocket') =>
      bus.emit({ type: 'explosion', x, z, distance: 7, byPlayer: true, source });
    return { bus, w, state, breaches, boom, explosions: () => explosions };
  }

  it('an explosion near a wall makes exactly one breach, with consistent fields; nothing is re-emitted', () => {
    const t = setup();
    t.boom(10, 11.5);
    expect(t.breaches).toHaveLength(1);
    expect(t.explosions()).toBe(1);
    const e = t.breaches[0];
    expect(e).toMatchObject({ kind: 'car', building: 0, side: 2, nx: 0, nz: 1, z: 10, merged: false, byPlayer: true, distance: 7 });
    expect(e.strength).toBeCloseTo(breachStrength('car', 1.5), 12);
    expect(e.slot).toBe(t.w.slots.findIndex((s) => s !== null));
    expect(e.seed).toBeGreaterThanOrEqual(0);
    expect(e.seed).toBeLessThan(1);
    t.boom(10, 11.5, 'grenade');
    expect(t.breaches[1]).toMatchObject({ kind: 'grenade', merged: true, slot: e.slot });
    t.boom(3, 10.4, 'rocket');
    expect(t.breaches[2]).toMatchObject({ kind: 'rocket', merged: false });
  });

  it('nothing while the test is off, behind the title, or far from any wall', () => {
    const off = setup(false, true);
    off.boom(10, 11);
    expect(off.breaches).toHaveLength(0);
    const title = setup(true, false);
    title.boom(10, 11);
    expect(title.breaches).toHaveLength(0);
    const far = setup();
    far.boom(10, 30);
    expect(far.breaches).toHaveLength(0);
    expect(far.w.count).toBe(0);
  });
});
