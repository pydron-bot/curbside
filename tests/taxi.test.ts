import { describe, expect, it } from 'vitest';
import {
  BAIL_STARS,
  FARE_BASE,
  HAIL_PATIENCE,
  PICKUP_HOLD,
  STREAK_BONUS,
  TaxiDuty,
  fareFor,
  streakBonus,
  tripTime,
  type TaxiInput,
} from '../src/game/modes/taxi';

const DT = 1 / 60;

function input(over: Partial<TaxiInput> = {}): TaxiInput {
  return { onDuty: true, x: 0, z: 0, speed: 0, health: 1, stars: 0, fare: null, ...over };
}

/** Step until `pred` or `seconds` run out; returns the last non-null result. */
function stepUntil(d: TaxiDuty, i: TaxiInput, seconds: number, want?: string): string | null {
  let last: string | null = null;
  for (let t = 0; t < seconds; t += DT) {
    const r = d.step(DT, i);
    if (r) last = r;
    if (want && r === want) return r;
  }
  return last;
}

describe('taxi: fares', () => {
  it('a trip gets 15 s plus a second per 11 m', () => {
    expect(tripTime(0)).toBe(15);
    expect(tripTime(440)).toBe(55);
  });

  it('the fare grows with distance and with time to spare', () => {
    expect(fareFor(0, 0, 10)).toBe(FARE_BASE);
    expect(fareFor(500, 0, 60)).toBe(FARE_BASE + 300);
    expect(fareFor(500, 60, 60)).toBe(FARE_BASE + 600);
    expect(fareFor(500, 30, 60)).toBe(FARE_BASE + 450);
    expect(fareFor(500, 999, 60)).toBe(FARE_BASE + 600);
  });

  it('every fifth fare in a row pays the streak bonus', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(streakBonus)).toEqual([0, 0, 0, 0, STREAK_BONUS, 0, STREAK_BONUS]);
  });
});

describe('taxi: duty', () => {
  it('going on duty asks for a hail soon', () => {
    const d = new TaxiDuty(() => 0.5);
    expect(stepUntil(d, input(), 6, 'wantHail')).toBe('wantHail');
    expect(d.phase).toBe('cruising');
  });

  it('stop beside the fare and they get in; deliver for a paid fare', () => {
    const d = new TaxiDuty(() => 0.5);
    stepUntil(d, input(), 6, 'wantHail');
    d.hailed();
    // Rolling past doesn't count; stopping beside them does.
    expect(stepUntil(d, input({ fare: { x: 3, z: 0 }, speed: 5 }), 2)).toBeNull();
    expect(stepUntil(d, input({ fare: { x: 3, z: 0 } }), PICKUP_HOLD + 0.1, 'board')).toBe('board');
    d.startTrip(400, 0, 400, 1);
    expect(d.phase).toBe('trip');
    expect(stepUntil(d, input({ x: 200 }), 2)).toBeNull();
    expect(stepUntil(d, input({ x: 398, speed: 1 }), 0.2, 'fare')).toBe('fare');
    expect(d.streak).toBe(1);
    const pay = d.payout();
    expect(pay.fare).toBeGreaterThan(FARE_BASE + 0.6 * 400);
    expect(pay.bonus).toBe(0);
  });

  it('the passenger bails at 2★ or after a beating, and the streak is lost', () => {
    const d = new TaxiDuty(() => 0.5);
    d.streak = 3;
    d.startTrip(500, 0, 500, 1);
    expect(stepUntil(d, input({ stars: BAIL_STARS }), 0.1, 'bailed')).toBe('bailed');
    expect(d.streak).toBe(0);
    d.startTrip(500, 0, 500, 0.9);
    expect(stepUntil(d, input({ health: 0.6 }), 0.1, 'bailed')).toBe('bailed');
  });

  it('late is a fail too', () => {
    const d = new TaxiDuty(() => 0.5);
    d.startTrip(500, 0, 100, 1);
    expect(stepUntil(d, input(), d.timeTotal + 1, 'late')).toBe('late');
  });

  it('a hail lapses if ignored, and leaving the cab ends the duty', () => {
    const d = new TaxiDuty(() => 0.5);
    stepUntil(d, input(), 6, 'wantHail');
    d.hailed();
    expect(stepUntil(d, input({ fare: { x: 100, z: 0 } }), HAIL_PATIENCE + 1, 'lapsed')).toBe('lapsed');
    d.startTrip(500, 0, 500, 1);
    d.streak = 2;
    expect(d.step(DT, input({ onDuty: false }))).toBe('lost');
    expect(d.phase).toBe('off');
    expect(d.streak).toBe(0);
  });
});
