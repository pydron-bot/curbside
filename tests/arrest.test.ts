import { describe, expect, it } from 'vitest';
import { createVehicleState } from '../src/entities/vehicle';
import {
  BOXED_SECONDS,
  BustMeter,
  GRAB_RANGE,
  GRAB_SECONDS,
  SLOW_ON_FOOT,
  STUNNED_GRAB_SECONDS,
  carsTouching,
  type ArrestSituation,
} from '../src/systems/arrest';

const DT = 1 / 60;

function situation(over: Partial<ArrestSituation> = {}): ArrestSituation {
  return {
    stars: 1,
    onFoot: true,
    speed: 0,
    stunned: false,
    copDistance: Infinity,
    copCarTouching: false,
    copAtDoor: false,
    ...over,
  };
}

/** Seconds of holding `s` until busted (or Infinity within `limit`). */
function timeToBust(m: BustMeter, s: ArrestSituation, limit = 10): number {
  for (let t = 0; t < limit; t += DT) if (m.step(DT, s)) return t + DT;
  return Infinity;
}

describe('bust meter', () => {
  it('an officer at arm’s length cuffs someone standing still in about a second', () => {
    const t = timeToBust(new BustMeter(), situation({ copDistance: GRAB_RANGE - 0.2 }));
    expect(t).toBeCloseTo(GRAB_SECONDS, 1);
  });

  it('nobody is arrested with no stars, or by a cop out of reach', () => {
    expect(timeToBust(new BustMeter(), situation({ stars: 0, copDistance: 0.5 }))).toBe(Infinity);
    expect(timeToBust(new BustMeter(), situation({ copDistance: GRAB_RANGE + 0.1 }))).toBe(Infinity);
  });

  it('a sprinting player can’t be grabbed, a walking one can', () => {
    expect(timeToBust(new BustMeter(), situation({ copDistance: 1, speed: 6 }))).toBe(Infinity);
    expect(timeToBust(new BustMeter(), situation({ copDistance: 1, speed: SLOW_ON_FOOT - 0.5 }))).toBeLessThan(2);
  });

  it('lying knocked down is quicker, even mid-slide', () => {
    const t = timeToBust(new BustMeter(), situation({ copDistance: 1, stunned: true, speed: 4 }));
    expect(t).toBeCloseTo(STUNNED_GRAB_SECONDS, 1);
  });

  it('a car stopped with a police car touching it is busted after two seconds', () => {
    const t = timeToBust(new BustMeter(), situation({ onFoot: false, speed: 0.3, copCarTouching: true }));
    expect(t).toBeCloseTo(BOXED_SECONDS, 1);
    // A cop at the door does it too.
    expect(timeToBust(new BustMeter(), situation({ onFoot: false, speed: 0, copAtDoor: true }))).toBeCloseTo(BOXED_SECONDS, 1);
  });

  it('a moving car, or a stopped one nobody has hold of, is never busted', () => {
    expect(timeToBust(new BustMeter(), situation({ onFoot: false, speed: 3, copCarTouching: true }))).toBe(Infinity);
    expect(timeToBust(new BustMeter(), situation({ onFoot: false, speed: 0, copDistance: 0.5 }))).toBe(Infinity);
  });

  it('breaking free drains the meter rather than resetting it instantly', () => {
    const m = new BustMeter();
    const held = situation({ copDistance: 1 });
    for (let t = 0; t < 0.6; t += DT) m.step(DT, held);
    const before = m.progress;
    expect(before).toBeGreaterThan(0.5);
    m.step(DT, situation({ copDistance: 5 }));
    expect(m.progress).toBeLessThan(before);
    expect(m.progress).toBeGreaterThan(0.4);
    for (let t = 0; t < 2; t += DT) m.step(DT, situation({ copDistance: 5 }));
    expect(m.progress).toBe(0);
  });
});

describe('cars touching', () => {
  it('side by side touching, a lane apart not', () => {
    const a = createVehicleState(0, 0, 0);
    expect(carsTouching(a, createVehicleState(2, 0, 0))).toBe(true);
    expect(carsTouching(a, createVehicleState(4, 0, 0))).toBe(false);
    // Nose to tail.
    expect(carsTouching(a, createVehicleState(0, 4.6, 0))).toBe(true);
    expect(carsTouching(a, createVehicleState(0, 6.5, 0))).toBe(false);
  });
});
