import { describe, expect, it } from 'vitest';
import {
  FIRE_LIFE,
  GRENADE_FUSE,
  MAX_ROCKET_FLIGHT,
  MIN_THROW,
  Projectiles,
  ROCKET_SPEED,
  THROW_GRAVITY,
  THROW_HEIGHT,
  WALL_CLEARANCE,
  clampThrowToWalls,
  throwTarget,
  throwVelocity,
  type ProjectileWorld,
} from '../src/systems/projectiles';
import { StaticGrid } from '../src/world/collision';

const DT = 1 / 60;

function world(rects = [] as Array<{ minX: number; minZ: number; maxX: number; maxZ: number }>, hits: (x: number, z: number) => boolean = () => false) {
  const booms: Array<{ kind: string; x: number; z: number; byPlayer: boolean }> = [];
  const fires: Array<{ x: number; z: number }> = [];
  const w: ProjectileWorld = {
    grid: new StaticGrid(rects),
    rocketHits: (x, z) => hits(x, z),
    bottleHits: () => false,
    explode: (kind, x, z, byPlayer) => booms.push({ kind, x, z, byPlayer }),
    ignite: (x, z) => fires.push({ x, z }),
  };
  return { w, booms, fires };
}

describe('throw arcs', () => {
  it('a throw lands where it was aimed', () => {
    const v = { vx: 0, vy: 0, vz: 0, time: 0 };
    for (const [tx, tz] of [
      [0, 5],
      [12, -9],
      [-18, 3],
    ]) {
      throwVelocity(0, 0, tx, tz, v);
      // Ballistic from hand height: where is it when it comes back to the ground?
      const y = THROW_HEIGHT + v.vy * v.time - 0.5 * THROW_GRAVITY * v.time * v.time;
      expect(y).toBeCloseTo(0, 5);
      expect(v.vx * v.time).toBeCloseTo(tx, 5);
      expect(v.vz * v.time).toBeCloseTo(tz, 5);
      expect(v.time).toBeLessThan(1.2); // snappy, even at full reach
    }
  });

  it('clamps the aim between the shortest throw and the weapon range', () => {
    const out = { x: 0, z: 0 };
    throwTarget(0, 0, 0, 50, 20, out);
    expect(out).toEqual({ x: 0, z: 20 });
    throwTarget(0, 0, 1, 0, 20, out);
    expect(out.x).toBeCloseTo(MIN_THROW);
  });
});

describe('throws and walls', () => {
  const wall = { minX: -10, minZ: 6, maxX: 10, maxZ: 8 };
  const grid = new StaticGrid([wall]);

  it('a throw at a wall lands short of it, and says so', () => {
    const out = { x: 0, z: 14 };
    expect(clampThrowToWalls(0, 0, out, grid)).toBe(true);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(6 - WALL_CLEARANCE);
  });

  it('a clear throw is left alone; one landing at a wall\'s foot steps back a little', () => {
    const out = { x: 3, z: -12 };
    expect(clampThrowToWalls(0, 0, out, grid)).toBe(false);
    expect(out).toEqual({ x: 3, z: -12 });
    out.x = 0;
    out.z = 5.6; // short of the wall, but a bounce would reach it
    expect(clampThrowToWalls(0, 0, out, grid)).toBe(false);
    expect(out.z).toBeCloseTo(6 - WALL_CLEARANCE);
  });

  it('a grenade thrown at the clamped point goes off there, not back at the thrower', () => {
    const { w, booms } = world([wall]);
    const pr = new Projectiles();
    const out = { x: 0, z: 14 };
    clampThrowToWalls(0, 0, out, grid);
    pr.throw('grenade', 0, 0, out.x, out.z, true);
    for (let t = 0; t < 3; t += DT) pr.step(DT, w);
    expect(booms).toHaveLength(1);
    expect(Math.abs(booms[0].z - out.z)).toBeLessThan(1.5);
  });
});

describe('grenades', () => {
  it('fly the arc, bounce and roll a little, and go off after the fuse', () => {
    const { w, booms } = world();
    const pr = new Projectiles();
    const g = pr.throw('grenade', 0, 0, 0, 12, true)!;
    let landedAt = -1;
    let maxY = 0;
    for (let t = 0; t < 3 && booms.length === 0; t += DT) {
      pr.step(DT, w);
      maxY = Math.max(maxY, g.y);
      if (landedAt < 0 && g.y <= 0.16 && g.vy >= 0) landedAt = t;
    }
    expect(maxY).toBeGreaterThan(THROW_HEIGHT + 0.5); // a visible lob
    expect(booms).toHaveLength(1);
    expect(booms[0].kind).toBe('grenade');
    expect(booms[0].z).toBeGreaterThan(11.5); // landed near the aim, rolled a little on
    expect(booms[0].z).toBeLessThan(13.5); // within ~1.5 m of the landing marker
    expect(g.age).toBeCloseTo(GRENADE_FUSE, 1);
    expect(g.alive).toBe(false);
  });

  it('bounce off walls', () => {
    const { w, booms } = world([{ minX: -10, minZ: 6, maxX: 10, maxZ: 8 }]);
    const pr = new Projectiles();
    pr.throw('grenade', 0, 0, 0, 14, true);
    for (let t = 0; t < 3; t += DT) pr.step(DT, w);
    expect(booms[0].z).toBeLessThan(6); // came back off the wall
  });
});

describe('molotovs', () => {
  it('burst into a fire patch where they land, which burns out', () => {
    const { w, fires } = world();
    const pr = new Projectiles();
    pr.throw('molotov', 0, 0, 8, 0, false);
    for (let t = 0; t < 2; t += DT) pr.step(DT, w);
    expect(fires).toHaveLength(1);
    expect(fires[0].x).toBeCloseTo(8, 0);
    const f = pr.fires.find((q) => q.alive)!;
    expect(f.byPlayer).toBe(false);
    for (let t = 0; t < FIRE_LIFE; t += DT) pr.step(DT, w);
    expect(pr.active).toBe(false);
  });
});

describe('rockets', () => {
  it('fly slowly in a straight line and blow up on the first thing they touch', () => {
    const { w, booms } = world([], (x) => x > 30);
    const pr = new Projectiles();
    const r = pr.fireRocket(0, 0, 1, 0, true)!;
    let t = 0;
    while (r.alive && t < 5) {
      pr.step(DT, w);
      t += DT;
    }
    expect(booms).toHaveLength(1);
    expect(booms[0].kind).toBe('rocket');
    expect(booms[0].x).toBeGreaterThan(30);
    expect(booms[0].x).toBeLessThan(31);
    expect(t).toBeCloseTo(30 / ROCKET_SPEED, 1); // visibly slow: over a second for 30 m
  });

  it('arm after a few metres: someone right in front of the launcher is flown past', () => {
    const { w, booms } = world([], (x) => x > 0.5 && x < 2);
    const pr = new Projectiles();
    pr.fireRocket(0, 0, 1, 0, true);
    for (let t = 0; t < 0.5; t += DT) pr.step(DT, w);
    expect(booms).toHaveLength(0);
  });

  it('hit walls, or go off at the end of their flight', () => {
    const wall = world([{ minX: 20, minZ: -5, maxX: 22, maxZ: 5 }]);
    const pr = new Projectiles();
    pr.fireRocket(0, 0, 1, 0, true);
    for (let t = 0; t < 2; t += DT) pr.step(DT, wall.w);
    expect(wall.booms[0].x).toBeLessThan(20.1);
    const open = world();
    const pr2 = new Projectiles();
    pr2.fireRocket(0, 0, 0, 1, false);
    for (let t = 0; t < 5; t += DT) pr2.step(DT, open.w);
    expect(open.booms[0].z).toBeCloseTo(MAX_ROCKET_FLIGHT, 0);
    expect(open.booms[0].byPlayer).toBe(false);
  });
});
