import { describe, expect, it } from 'vitest';
import { createPedState } from '../src/entities/pedestrian';
import { SEDAN, createVehicleState, speed, stepVehicle } from '../src/entities/vehicle';
import { carCircles, collidePedVehicle, collideVehicleStatic, collideVehicles, type CarContact } from '../src/systems/physics';
import { StaticGrid } from '../src/world/collision';

describe('collision contacts', () => {
  it('reports where a car hit a wall', () => {
    const grid = new StaticGrid([{ minX: -10, minZ: -20, maxX: 10, maxZ: -10 }]);
    const s = createVehicleState(0, -8.5); // nose (heading PI = -Z) inside the wall
    s.vz = -12;
    const contact = { x: NaN, z: NaN };
    const impact = collideVehicleStatic(s, grid, contact);
    expect(impact).toBeGreaterThan(10);
    expect(contact.z).toBeCloseTo(-10, 1); // on the wall face
    expect(Math.abs(contact.x)).toBeLessThan(1);
  });

  it('reports where two cars touched', () => {
    const a = createVehicleState(0, 0, Math.PI / 2); // facing +X
    const b = createVehicleState(4.5, 0, -Math.PI / 2); // nose to nose
    a.vx = 8;
    b.vx = -8;
    const contact = { x: NaN, z: NaN };
    expect(collideVehicles(a, b, contact)).toBeGreaterThan(10);
    expect(contact.x).toBeGreaterThan(1.5);
    expect(contact.x).toBeLessThan(3);
  });

  it('carCircles can write into caller storage', () => {
    const out = [
      { x: 0, z: 0 },
      { x: 0, z: 0 },
      { x: 0, z: 0 },
    ];
    const s = createVehicleState(5, 5, 0);
    expect(carCircles(s, out)).toBe(out);
    expect(out[2].z).toBeCloseTo(5 + 1.38);
    expect(carCircles(s)).toEqual(out);
  });

  it('peds far from a car are rejected without touching them', () => {
    const p = createPedState(20, 0);
    p.vx = -3;
    expect(collidePedVehicle(p, createVehicleState(0, 0))).toBe(0);
    expect(p.x).toBe(20);
  });
});

describe('walls', () => {
  const wall = new StaticGrid([{ minX: 3, minZ: -1000, maxX: 5, maxZ: 1000 }]);
  /** Drive into the wall at `deg` off parallel at 25 m/s, throttle held, wheel straight. */
  const glance = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const s = createVehicleState(0, 0, a);
    s.vx = Math.sin(a) * 25;
    s.vz = Math.cos(a) * 25;
    let touched = -1;
    for (let i = 0; i < 180; i++) {
      stepVehicle(s, { throttle: 1, steer: 0, handbrake: false }, SEDAN, 1 / 60);
      if (collideVehicleStatic(s, wall) > 0 && touched < 0) touched = i;
      if (touched >= 0 && i - touched > 36) break;
    }
    return s;
  };

  it('a glancing hit slides along the wall, turned parallel, keeping its pace', () => {
    const s = glance(5);
    expect(speed(s)).toBeGreaterThan(23);
    expect(Math.abs(s.heading)).toBeLessThan(0.05); // nose along the wall
    expect(s.x).toBeLessThan(3); // and still outside it
  });

  it('the steeper the hit, the more speed it costs; head-on stops dead', () => {
    const speeds = [5, 20, 35, 90].map((d) => speed(glance(d)));
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThan(speeds[i - 1]);
    expect(speeds[3]).toBeLessThan(1);
  });
});

describe('car on car', () => {
  it('the heavier car is shoved less, and the contact says who rammed whom', () => {
    const van = createVehicleState(0, 0, Math.PI / 2);
    const car = createVehicleState(4.4, 0, Math.PI / 2); // parked ahead of it
    van.vx = 15;
    const contact: CarContact = { x: 0, z: 0, nx: 0, nz: 0, closingA: 0, closingB: 0 };
    const impact = collideVehicles(van, car, contact, 1.6, 0.85);
    expect(impact).toBeCloseTo(15, 0);
    expect(contact.closingA).toBeCloseTo(15, 0); // the van brought all of it
    expect(contact.closingB).toBeCloseTo(0, 5);
    expect(car.vx).toBeGreaterThan(15 - van.vx); // the car is thrown forward harder than the van slows
    expect(van.vx).toBeGreaterThan(5);
  });

  it('a car flying over another does not touch it', () => {
    const a = createVehicleState(0, 0, 0);
    const b = createVehicleState(0.5, 0, 0);
    a.y = 2;
    expect(collideVehicles(a, b)).toBe(0);
    expect(a.x).toBe(0);
  });
});

describe('static grid queries', () => {
  it('returns each obstacle once even when the query spans cells', () => {
    const wide = { minX: -40, minZ: -1, maxX: 40, maxZ: 1 };
    const grid = new StaticGrid([wide, { minX: 30, minZ: 30, maxX: 31, maxZ: 31 }]);
    const near = grid.near(0, 0, 10); // spans the cell boundary at 0
    expect(near.filter((r) => r === wide)).toHaveLength(1);
    expect(grid.near(500, 500, 1)).toHaveLength(0);
  });
});
