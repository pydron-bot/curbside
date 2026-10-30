import { describe, expect, it } from 'vitest';
import { FLOCK_DROP, MAX_FLOCKS, Pigeons, SETTLE_RANGE, type Pigeon, type PigeonThreat, type PigeonWorld } from '../src/systems/pigeons';
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, generateCity, type BlockKind } from '../src/world/city';
import { random } from './helpers';

const DT = 1 / 60;
const VIEW = { minX: -18, maxX: 18, minZ: -10, maxZ: 10 };

function world(threats: PigeonThreat[] = [], x = 0, z = 0): PigeonWorld {
  return { view: { minX: x + VIEW.minX, maxX: x + VIEW.maxX, minZ: z + VIEW.minZ, maxZ: z + VIEW.maxZ }, x, z, threats };
}

function setup(kind: BlockKind = 'buildings', seed = 3) {
  return new Pigeons({ kindAt: () => kind, blocked: () => false }, random(seed));
}

/** Run until the flocks have settled (a few settle intervals). */
function settle(p: Pigeons, w = world()): void {
  for (let i = 0; i < 60 * 12; i++) p.step(DT, w);
}

describe('pigeons', () => {
  it('flocks settle near the action but out of view, on the kerb side of the pavement', () => {
    const p = setup();
    settle(p);
    expect(p.flocks.length).toBe(MAX_FLOCKS);
    for (const f of p.flocks) {
      const d = Math.hypot(f.x, f.z);
      expect(d).toBeGreaterThan(SETTLE_RANGE[0] - 12);
      expect(d).toBeLessThan(SETTLE_RANGE[1] + 12);
      expect(f.x > VIEW.minX - 4 && f.x < VIEW.maxX + 4 && f.z > VIEW.minZ - 4 && f.z < VIEW.maxZ + 4).toBe(false);
      // Between the kerb and the walkers' line, measured from the nearest road centreline.
      const off = (v: number) => {
        const m = (((v + HALF_EXTENT) % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE;
        return Math.min(m, BLOCK_SIZE - m);
      };
      expect(Math.min(off(f.x), off(f.z))).toBeGreaterThan(ROAD_WIDTH / 2);
      expect(Math.min(off(f.x), off(f.z))).toBeLessThan(ROAD_WIDTH / 2 + 1.5);
      for (const b of f.birds) expect(b.state).toBe('ground');
    }
  });

  it('a car coming through scatters them: up, away from it, then gone', () => {
    const p = setup('plaza');
    settle(p);
    const f = p.flocks[0];
    const birds = [...f.birds];
    const car: PigeonThreat = { x: f.x - 5, z: f.z, speed: 12, car: true, player: false };
    p.step(DT, world([car]));
    expect(f.spooked).toBe(true);
    for (let i = 0; i < 60; i++) p.step(DT, world());
    for (const b of birds) {
      expect(b.state).toBe('fly');
      expect(b.y).toBeGreaterThan(1.5);
      expect(b.x).toBeGreaterThan(car.x); // away from the car
      expect(b.spread).toBe(1);
    }
    expect(p.flocks).not.toContain(f);
    for (let i = 0; i < 60 * 6; i++) p.step(DT, world());
    const alive: Pigeon[] = [];
    p.collect(alive);
    for (const b of birds) expect(alive).not.toContain(b);
  });

  it('a slow car or a walker going by leaves them be; running at them or walking right up does not', () => {
    const p = setup('plaza');
    settle(p);
    const f = p.flocks[0];
    p.step(DT, world([{ x: f.x + 3, z: f.z, speed: 1.5, car: true, player: false }]));
    p.step(DT, world([{ x: f.x + 3, z: f.z, speed: 1.4, car: false, player: false }]));
    expect(f.spooked).toBe(false);
    p.step(DT, world([{ x: f.x + 3.5, z: f.z, speed: 5, car: false, player: false }]));
    expect(f.spooked).toBe(true);
    const g = p.flocks.find((q) => !q.spooked)!;
    p.step(DT, world([{ x: g.x + 1.5, z: g.z, speed: 0.5, car: false, player: true }]));
    expect(g.spooked).toBe(true);
  });

  it('a gunshot scatters every flock in earshot, not the ones further off', () => {
    const p = setup();
    settle(p);
    const [a] = p.flocks;
    p.startle(a.x + 10, a.z, 12);
    expect(a.spooked).toBe(true);
    for (const f of p.flocks) if (Math.hypot(f.x - a.x - 10, f.z - a.z) > 12) expect(f.spooked).toBe(false);
  });

  it('flocks left far behind are dropped, and new ones settle around you', () => {
    const p = setup();
    settle(p);
    const old = [...p.flocks];
    const far = FLOCK_DROP + 150;
    settle(p, world([], far, 0));
    for (const f of old) expect(p.flocks).not.toContain(f);
    expect(p.flocks.length).toBe(MAX_FLOCKS);
    for (const f of p.flocks) expect(Math.hypot(f.x - far, f.z)).toBeLessThan(SETTLE_RANGE[1] + 12);
  });

  it('in the real city, nobody lands inside a building or a tree', () => {
    const city = generateCity(1337);
    const kinds = new Map(city.blocks.map((b) => [`${b.bx},${b.bz}`, b.kind]));
    const blocked = (x: number, z: number, r: number) => city.obstacles.some((o) => x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r);
    const p = new Pigeons({ kindAt: (bx, bz) => kinds.get(`${bx},${bz}`) ?? 'buildings', blocked }, random(9));
    for (let k = 0; k < 6; k++) {
      const x = (k - 3) * 140;
      settle(p, world([], x, 60));
      for (const f of p.flocks) for (const b of f.birds) expect(blocked(b.x, b.z, 0.1), `${b.x},${b.z}`).toBe(false);
    }
  });
});
