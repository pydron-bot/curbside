import { describe, expect, it } from 'vitest';
import { createPedState } from '../src/entities/pedestrian';
import { VEHICLE_BODIES, createVehicleState } from '../src/entities/vehicle';
import { PED_RADIUS } from '../src/systems/physics';
import { KNOCK_RESPAWN, KNOCK_SPEED, Knockables } from '../src/systems/knockables';

const far = { minX: 1000, minZ: 1000, maxX: 1100, maxZ: 1100 };
const near = { minX: -50, minZ: -50, maxX: 50, maxZ: 50 };

describe('knockable street furniture', () => {
  it('a car at speed knocks a hydrant flying and loses a little speed; a crawl just nudges it', () => {
    const k = new Knockables([{ id: 7, kind: 'hydrant', x: 0, z: 2, radius: 0.25 }]);
    const slow = createVehicleState(0, 0, 0);
    slow.vz = KNOCK_SPEED * 0.8;
    const hits: number[] = [];
    k.step([slow], 1 / 60, (item) => hits.push(item.id));
    expect(hits).toHaveLength(0);
    const car = createVehicleState(0, 0, 0);
    car.vz = 15;
    k.step([car], 1 / 60, (item) => hits.push(item.id));
    expect(hits).toEqual([7]);
    expect(car.vz).toBeLessThan(15);
    expect(car.vz).toBeGreaterThan(13.5);
    expect(k.isKnocked(7)).toBe(true);
    // Once down it can't be knocked again.
    k.step([car], 1 / 60, (item) => hits.push(item.id));
    expect(hits).toHaveLength(1);
  });

  it("a bus's tail sweeps a bin its middle would miss", () => {
    const k = new Knockables([{ id: 1, kind: 'trash_bin', x: 0, z: -5.5, radius: 0.32 }]);
    const bus = createVehicleState(0, 0, 0);
    bus.body = VEHICLE_BODIES.bus;
    bus.vz = 8;
    let hit = 0;
    k.step([bus], 1 / 60, () => hit++);
    expect(hit).toBe(1);
  });

  it('comes back a minute later, but only out of view', () => {
    const k = new Knockables([{ id: 3, kind: 'bench', x: 0, z: 1, radius: 0.9 }]);
    const car = createVehicleState(0, 0, 0);
    car.vz = 20;
    k.step([car], 1 / 60, () => {});
    const back: number[] = [];
    k.restore(far, (i) => back.push(i.id));
    expect(back).toHaveLength(0);
    k.step([], KNOCK_RESPAWN + 1, () => {});
    k.restore(near, (i) => back.push(i.id));
    expect(back).toHaveLength(0);
    k.restore(far, (i) => back.push(i.id));
    expect(back).toEqual([3]);
    expect(k.isKnocked(3)).toBe(false);
  });

  it('a fresh run stands everything back up', () => {
    const k = new Knockables([{ id: 9, kind: 'traffic_cone', x: 0, z: 1, radius: 0.3 }]);
    const car = createVehicleState(0, 0, 0);
    car.vz = 20;
    k.step([car], 1 / 60, () => {});
    const back: number[] = [];
    k.reset((i) => back.push(i.id));
    expect(back).toEqual([9]);
  });

  /** Walk a person along +Z at walking pace for 4 s, bumping the furniture each step; returns them. */
  const walk = (k: Knockables, x: number, z: number) => {
    const p = createPedState(x, z, 0);
    for (let i = 0; i < 240; i++) {
      p.vx = 0;
      p.vz = 1.6;
      p.x += p.vx / 60;
      p.z += p.vz / 60;
      k.collidePed(p);
    }
    return p;
  };

  it("people can't walk through a standing hydrant or bench, and walk over a knocked one", () => {
    const hydrant = new Knockables([{ id: 1, kind: 'hydrant', x: 0, z: 3, radius: 0.25 }]);
    const p = walk(hydrant, 0, 0);
    expect(p.z).toBeCloseTo(3 - 0.25 - PED_RADIUS, 3);
    expect(p.vz).toBeCloseTo(0, 6); // speed into it removed
    // A bench along X (0.9 x 0.3 half-sizes): stopped at its long face, even off-centre...
    const bench = () => new Knockables([{ id: 2, kind: 'bench', x: 0, z: 3, radius: 0.95, hx: 0.9, hz: 0.3 }]);
    expect(walk(bench(), 0.7, 0).z).toBeCloseTo(3 - 0.3 - PED_RADIUS, 3);
    // ...but its box, not its 0.95 m knock circle: past the end, a person walks on by.
    expect(walk(bench(), 1.3, 0).z).toBeGreaterThan(6);
    // Knocked over, it's no obstacle.
    const down = bench();
    const car = createVehicleState(0, 1, 0);
    car.vz = 20;
    down.step([car], 1 / 60, () => {});
    expect(down.isKnocked(2)).toBe(true);
    expect(walk(down, 0, 0).z).toBeGreaterThan(6);
  });

  it('a person caught inside a bench is pushed out its nearer side; people never knock things over', () => {
    const k = new Knockables([{ id: 3, kind: 'bench', x: 0, z: 0, radius: 0.95, hx: 0.9, hz: 0.3 }]);
    const p = createPedState(0.2, 0.1, 0);
    k.collidePed(p);
    expect(p.x).toBeCloseTo(0.2);
    expect(p.z).toBeCloseTo(0.3 + PED_RADIUS);
    const q = createPedState(0.8, 0, 0);
    k.collidePed(q);
    expect(q.x).toBeCloseTo(0.9 + PED_RADIUS);
    expect(k.isKnocked(3)).toBe(false);
  });
});
