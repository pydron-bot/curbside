import { describe, expect, it } from 'vitest';
import {
  CRANK_TIME,
  ENGINE_PROFILES,
  GEARS,
  createCarSound,
  createEngine,
  describeCar,
  engineHz,
  roadAmount,
  squealAmount,
  windAmount,
} from '../src/audio/carSound';
import { ChaosMeter } from '../src/audio/chaos';
import {
  VEHICLE_SPECS,
  createVehicleState,
  stepVehicle,
  type VehicleArchetype,
  type VehicleControls,
} from '../src/entities/vehicle';

const DT = 1 / 60;
const ARCHETYPES = Object.keys(ENGINE_PROFILES) as VehicleArchetype[];

/** Drive a real vehicle sim and feed the engine model, like the game does. */
function drive(archetype: VehicleArchetype, controls: VehicleControls, seconds: number) {
  const sim = createVehicleState(0, 0, 0);
  const engine = createEngine(archetype);
  const car = createCarSound();
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepVehicle(sim, controls, VEHICLE_SPECS[archetype], DT);
    describeCar(car, sim, controls, archetype);
    engine.step(DT, car.forwardSpeed, car.throttle, car.slip);
  }
  return { sim, engine, car };
}

describe('engine gear / RPM model', () => {
  it('idles at idle revs in first gear', () => {
    const { engine } = drive('sedan', { throttle: 0, steer: 0, handbrake: false }, 2);
    expect(engine.gear).toBe(1);
    expect(engine.rpm).toBeCloseTo(ENGINE_PROFILES.sedan.idleRpm, 0);
    expect(engine.rpmNorm).toBe(0);
  });

  it('revs freely on the throttle at a standstill (clutch slipping)', () => {
    const engine = createEngine('sports');
    for (let i = 0; i < 90; i++) engine.step(DT, 0, 1);
    expect(engine.rpmNorm).toBeGreaterThan(0.45);
    expect(engine.rpm).toBeLessThan(engine.profile.redlineRpm);
    // Lift off: revs fall back to idle.
    for (let i = 0; i < 180; i++) engine.step(DT, 0, 0);
    expect(engine.rpm).toBeCloseTo(engine.profile.idleRpm, 0);
  });

  it('shifts up through the gears under full throttle, dropping revs at each shift', () => {
    for (const archetype of ARCHETYPES) {
      let lastGear = 1;
      let upshifts = 0;
      let rpmBefore = 0;
      const drops: number[] = [];
      const sim = createVehicleState(0, 0, 0);
      const model = createEngine(archetype);
      const car = createCarSound();
      const full: VehicleControls = { throttle: 1, steer: 0, handbrake: false };
      for (let i = 0; i < 30 * 60; i++) {
        stepVehicle(sim, full, VEHICLE_SPECS[archetype], DT);
        describeCar(car, sim, full, archetype);
        rpmBefore = model.rpm;
        model.step(DT, car.forwardSpeed, car.throttle, car.slip);
        expect(model.gear).toBeGreaterThanOrEqual(lastGear); // never hunts down while accelerating
        if (model.shifted === 1) {
          upshifts++;
          drops.push(rpmBefore);
        }
        expect(model.rpm).toBeLessThanOrEqual(model.profile.redlineRpm * 1.02);
        lastGear = model.gear;
      }
      expect(upshifts, archetype).toBeGreaterThanOrEqual(3);
      expect(model.gear, archetype).toBeGreaterThanOrEqual(4);
      // Upshifts happen near the top of the rev range...
      for (const rpm of drops) expect(rpm / model.profile.redlineRpm).toBeGreaterThan(0.8);
      // ...and the needle falls well below it afterwards (an audible shift).
      expect(model.rpmNorm, archetype).toBeLessThan(0.95);
      expect(GEARS).toBe(5);
    }
  });

  it('cuts the load during a shift', () => {
    const sim = createVehicleState(0, 0, 0);
    const model = createEngine('sedan');
    const car = createCarSound();
    const full: VehicleControls = { throttle: 1, steer: 0, handbrake: false };
    let sawCut = false;
    for (let i = 0; i < 600 && !sawCut; i++) {
      stepVehicle(sim, full, VEHICLE_SPECS.sedan, DT);
      describeCar(car, sim, full, 'sedan');
      model.step(DT, car.forwardSpeed, car.throttle, car.slip);
      if (model.shifting && model.load < 0.5) sawCut = true;
    }
    expect(sawCut).toBe(true);
  });

  it('downshifts as the car slows, back to first at a stop', () => {
    const sim = createVehicleState(0, 0, 0);
    const model = createEngine('police');
    const car = createCarSound();
    const run = (c: VehicleControls, seconds: number) => {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        stepVehicle(sim, c, VEHICLE_SPECS.police, DT);
        describeCar(car, sim, c, 'police');
        model.step(DT, car.forwardSpeed, car.throttle, car.slip);
      }
    };
    run({ throttle: 1, steer: 0, handbrake: false }, 12);
    const top = model.gear;
    expect(top).toBeGreaterThanOrEqual(4);
    run({ throttle: -1, steer: 0, handbrake: false }, 1.2);
    expect(model.gear).toBeLessThan(top);
    run({ throttle: 0, steer: 0, handbrake: false }, 30);
    expect(model.gear).toBe(1);
  });

  it('selects reverse when backing up', () => {
    const { engine } = drive('van', { throttle: -1, steer: 0, handbrake: false }, 2);
    expect(engine.gear).toBe(-1);
    expect(engine.rpm).toBeGreaterThan(engine.profile.idleRpm);
  });

  it('cranks on start, then catches with a flare of revs', () => {
    const engine = createEngine('compact');
    engine.start();
    expect(engine.cranking).toBe(true);
    let t = 0;
    while (engine.cranking && t < 2) {
      engine.step(DT, 0, 0);
      t += DT;
    }
    expect(t).toBeCloseTo(CRANK_TIME, 1);
    expect(engine.rpm).toBeGreaterThan(engine.profile.idleRpm * 1.5);
  });

  it('flags overrun when lifting off at high revs', () => {
    const engine = createEngine('sports');
    for (let i = 0; i < 120; i++) engine.step(DT, 0, 1);
    engine.step(DT, 0, 0);
    expect(engine.overrun).toBe(true);
  });

  it('gives each archetype its own voice: sports high and raspy, van low', () => {
    for (const a of ARCHETYPES) {
      const p = ENGINE_PROFILES[a];
      expect(p.idleRpm).toBeLessThan(p.redlineRpm);
      expect(engineHz(p.idleRpm, p)).toBeGreaterThan(20);
      expect(engineHz(p.redlineRpm, p)).toBeLessThan(500);
    }
    const sports = ENGINE_PROFILES.sports;
    const van = ENGINE_PROFILES.van;
    expect(engineHz(sports.redlineRpm, sports)).toBeGreaterThan(engineHz(van.redlineRpm, van) * 1.5);
    expect(sports.drive).toBeGreaterThan(van.drive);
    expect(van.lope).toBeGreaterThan(sports.lope);
  });
});

describe('tyre and road noise', () => {
  const car = createCarSound();
  it('squeals when sliding, handbraking at speed or braking hard, not when cruising', () => {
    Object.assign(car, { speed: 20, forwardSpeed: 20, throttle: 1, slip: 0.5, handbrake: false });
    expect(squealAmount(car)).toBe(0);
    car.slip = 7;
    expect(squealAmount(car)).toBeGreaterThan(0.6);
    Object.assign(car, { slip: 0, handbrake: true });
    expect(squealAmount(car)).toBeGreaterThan(0.4);
    Object.assign(car, { handbrake: false, throttle: -1, forwardSpeed: 25, speed: 25 });
    expect(squealAmount(car)).toBeGreaterThan(0.3);
    Object.assign(car, { speed: 1, forwardSpeed: 1, throttle: 0, handbrake: true, slip: 0 });
    expect(squealAmount(car)).toBe(0);
  });

  it('builds road roar with speed, wind only when fast', () => {
    expect(roadAmount(0)).toBe(0);
    expect(roadAmount(20)).toBeGreaterThan(roadAmount(10));
    expect(windAmount(10)).toBe(0);
    expect(windAmount(40)).toBeGreaterThan(0.5);
  });
});

describe('chaos meter (music intensity from play)', () => {
  it('climbs with mayhem and decays when things calm down', () => {
    const c = new ChaosMeter();
    expect(c.step(0.1)).toBe(0);
    for (let i = 0; i < 4; i++) c.add(1.2); // a few explosions
    expect(c.step(0.016)).toBeGreaterThanOrEqual(3);
    let t = 0;
    while (c.level > 0 && t < 120) {
      c.step(0.1);
      t += 0.1;
    }
    expect(c.level).toBe(0);
    expect(t).toBeGreaterThan(10); // lingers, doesn't snap back
  });

  it('only steps down after holding low (no flapping between layers)', () => {
    const c = new ChaosMeter();
    c.add(1.6);
    c.step(0.01);
    expect(c.level).toBe(2);
    // Hovering around a threshold for a couple of seconds keeps the level.
    for (let i = 0; i < 20; i++) {
      c.step(0.1);
      if (i % 5 === 0) c.add(0.1);
    }
    expect(c.level).toBe(2);
  });

  it('resets', () => {
    const c = new ChaosMeter();
    c.add(10);
    c.step(0.01);
    c.reset();
    expect(c.level).toBe(0);
    expect(c.energy).toBe(0);
  });
});
