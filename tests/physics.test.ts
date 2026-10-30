import { describe, expect, it } from 'vitest';
import { createPedState } from '../src/entities/pedestrian';
import { createVehicleState } from '../src/entities/vehicle';
import { carCircles, collidePedVehicle, collideVehicleStatic, collideVehicles } from '../src/systems/physics';
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

describe('static grid queries', () => {
  it('returns each obstacle once even when the query spans cells', () => {
    const wide = { minX: -40, minZ: -1, maxX: 40, maxZ: 1 };
    const grid = new StaticGrid([wide, { minX: 30, minZ: 30, maxX: 31, maxZ: 31 }]);
    const near = grid.near(0, 0, 10); // spans the cell boundary at 0
    expect(near.filter((r) => r === wide)).toHaveLength(1);
    expect(grid.near(500, 500, 1)).toHaveLength(0);
  });
});
