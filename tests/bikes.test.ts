import { describe, expect, it } from 'vitest';
import {
  BIKE_THROW_IMPACT,
  MAX_LEAN,
  SEDAN,
  VEHICLE_BODIES,
  VEHICLE_HEALTH,
  VEHICLE_SPECS,
  bikeLean,
  bikeThrows,
  createVehicleState,
  driverDoorPosition,
  forwardSpeed,
  isBike,
  isPoliceArchetype,
  leanOf,
  slideOnSide,
  speed,
  stepVehicle,
} from '../src/entities/vehicle';
import type { CrowdPed, Vehicle } from '../src/game/population';
import { collideVehicleStatic } from '../src/systems/physics';
import { BIKES_UNTIL, PoliceForce, SUV_FROM, type PoliceContext } from '../src/systems/police';
import { createDamage } from '../src/systems/damage';
import { generateCity } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';

const DT = 1 / 60;
const full = { throttle: 1, steer: 0, handbrake: false };

describe('bike handling', () => {
  it('gets off the line quicker than a sedan (to town speed)', () => {
    const time = (spec: typeof SEDAN) => {
      const s = createVehicleState(0, 0, 0);
      let t = 0;
      while (forwardSpeed(s) < 12 && t < 20) {
        stepVehicle(s, full, spec, DT);
        t += DT;
      }
      return t;
    };
    expect(time(VEHICLE_SPECS.scooter)).toBeLessThan(time(SEDAN));
    expect(time(VEHICLE_SPECS.cop_bike)).toBeLessThan(time(VEHICLE_SPECS.sports));
  });

  it('turns tighter than a car at town speed', () => {
    const radius = (spec: typeof SEDAN) => {
      const s = createVehicleState(0, 0, 0);
      s.vz = 12;
      for (let i = 0; i < 60 * 3; i++) stepVehicle(s, { throttle: 0.4, steer: 1, handbrake: false }, spec, DT);
      return speed(s) / Math.abs(s.yawRate);
    };
    expect(radius(VEHICLE_SPECS.scooter)).toBeLessThan(radius(SEDAN) * 0.8);
  });

  it('is narrow and fragile: a single-file footprint and little health', () => {
    for (const a of ['scooter', 'cop_bike'] as const) {
      expect(isBike(a)).toBe(true);
      expect(VEHICLE_BODIES[a].radius).toBeLessThan(0.5);
      expect(VEHICLE_BODIES[a].halfWidth).toBeLessThan(0.4);
      expect(VEHICLE_HEALTH[a]).toBeLessThan(VEHICLE_HEALTH.compact);
    }
    expect(isBike('sedan')).toBe(false);
    expect(isPoliceArchetype('cop_bike')).toBe(true);
    // The rider steps off beside the saddle, not a car's width away.
    const s = createVehicleState(0, 0, 0);
    s.body = VEHICLE_BODIES.scooter;
    expect(Math.hypot(driverDoorPosition(s).x, driverDoorPosition(s).z)).toBeLessThan(1.2);
  });
});

describe('leaning', () => {
  it('leans into the turn in proportion to the sideways pull, up to a limit', () => {
    // Positive lateral acceleration pulls to the left: a left lean is a negative roll.
    expect(bikeLean(5)).toBeLessThan(0);
    expect(bikeLean(-5)).toBeGreaterThan(0);
    expect(bikeLean(0)).toBe(-0);
    expect(Math.abs(bikeLean(10))).toBeCloseTo(Math.abs(bikeLean(5)) * 2, 6);
    expect(Math.abs(bikeLean(500))).toBe(MAX_LEAN);
  });

  it("a bike's own turn sets its lean: harder and faster leans further, straight is upright", () => {
    const turning = (steer: number, v: number) => {
      const s = createVehicleState(0, 0, 0);
      s.vz = v;
      for (let i = 0; i < 40; i++) stepVehicle(s, { throttle: 0.3, steer, handbrake: false }, VEHICLE_SPECS.scooter, DT);
      return s;
    };
    expect(leanOf(turning(0, 10))).toBeCloseTo(0, 6);
    const right = leanOf(turning(1, 10));
    const left = leanOf(turning(-1, 10));
    // Steering right (+1) turns right: lean right (left side up, positive roll).
    expect(right).toBeGreaterThan(0.1);
    expect(left).toBeLessThan(-0.1);
    expect(Math.abs(leanOf(turning(0.5, 6)))).toBeLessThan(Math.abs(right));
    // In the air it's level.
    const flying = turning(1, 10);
    flying.airborne = true;
    expect(leanOf(flying)).toBe(0);
  });
});

describe('throwing the rider', () => {
  it('a hard crash throws the rider; a bump does not', () => {
    expect(bikeThrows(BIKE_THROW_IMPACT + 0.5)).toBe(true);
    expect(bikeThrows(BIKE_THROW_IMPACT - 0.5)).toBe(false);
    expect(bikeThrows(3)).toBe(false);
  });

  it('riding into a wall at speed is over the threshold; nudging one is not', () => {
    const grid = new StaticGrid([{ minX: -10, minZ: 10, maxX: 10, maxZ: 12 }]);
    const hit = (v: number) => {
      const s = createVehicleState(0, 8.5, 0);
      s.body = VEHICLE_BODIES.scooter;
      s.vz = v;
      let impact = 0;
      for (let i = 0; i < 60 && impact === 0; i++) {
        stepVehicle(s, full, VEHICLE_SPECS.scooter, DT);
        impact = collideVehicleStatic(s, grid);
      }
      return impact;
    };
    expect(bikeThrows(hit(18))).toBe(true);
    expect(bikeThrows(hit(4))).toBe(false);
  });

  it('a bike down on its side scrapes to a stop', () => {
    const s = createVehicleState(0, 0, 0);
    s.vz = 15;
    for (let i = 0; i < 60 * 2; i++) {
      slideOnSide(s, DT);
      stepVehicle(s, { throttle: 0, steer: 0, handbrake: false }, VEHICLE_SPECS.scooter, DT);
    }
    expect(speed(s)).toBeLessThan(2);
  });
});

describe('the police fleet', () => {
  const city = generateCity(1337);
  const grid = new StaticGrid(city.obstacles);
  const run = (stars: number, seed: number) => {
    const taken: string[] = [];
    const depot = {
      takeVehicle: (archetype: Vehicle['archetype'], paint: string): Vehicle => {
        taken.push(archetype);
        const sim = createVehicleState();
        return { archetype, paint, sim, prev: { ...sim }, mesh: { siren: false }, ai: null, damage: createDamage(), wreckAge: 0, charred: false } as unknown as Vehicle;
      },
      retireVehicle: () => {},
      addPed: (agent: CrowdPed['agent']) => ({ agent, prev: { ...agent.s } }) as unknown as CrowdPed,
      removePed: () => {},
    };
    const police = new PoliceForce(depot, () => {});
    const suspect = { x: 0, z: 0, vx: 0, vz: 0, heading: 0, inCar: true, armed: false, down: false, car: null, active: true };
    police.report(suspect);
    const ctx: PoliceContext = { stars, tracked: true, suspect, view: { minX: -30, minZ: -15, maxX: 30, maxZ: 15 }, grid, rand: random(seed) };
    for (let i = 0; i < 60 * 12; i++) police.step(DT, ctx);
    return { taken, police };
  };

  it('sends a police bike now and then at low heat, one officer aboard, never more than one', () => {
    let bikes = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { police } = run(BIKES_UNTIL, seed);
      const units = police.units.filter((u) => u.kind === 'bike');
      expect(units.length).toBeLessThanOrEqual(1);
      for (const u of units) {
        expect(u.vehicle?.archetype).toBe('cop_bike');
        expect(u.aboard).toBeLessThanOrEqual(1);
      }
      bikes += units.length;
    }
    expect(bikes).toBeGreaterThan(0);
  });

  it('brings SUVs from three stars and the real SWAT truck at four', () => {
    const three = run(SUV_FROM, 3).taken;
    expect(three).toContain('police_suv');
    expect(three).not.toContain('cop_bike');
    const four = run(4, 4).taken;
    expect(four).toContain('swat');
    expect(four).not.toContain('van');
  });
});
