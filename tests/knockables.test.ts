import { describe, expect, it } from 'vitest';
import { VEHICLE_BODIES, createVehicleState } from '../src/entities/vehicle';
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
});
