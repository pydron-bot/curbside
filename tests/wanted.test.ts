import { describe, expect, it } from 'vitest';
import { EventBus, type EventOf } from '../src/core/events';
import {
  CIVILIAN_CAP,
  COOL_AFTER,
  CRIME_HEAT,
  EVADE_BASE,
  EVADE_PER_STAR,
  GUNFIRE_CAP,
  GUNFIRE_WINDOW,
  MAX_HEAT,
  SEARCH_AFTER,
  Wanted,
  evadeSeconds,
  starsFor,
} from '../src/systems/wanted';

const DT = 1 / 60;

function setup() {
  const bus = new EventBus();
  const log: Array<EventOf<'wanted'>> = [];
  bus.on('wanted', (e) => log.push(e));
  return { bus, log, w: new Wanted(bus) };
}

/** Step `seconds` of sim time with the player seen or not. */
function run(w: Wanted, seconds: number, seen: boolean) {
  for (let t = 0; t < seconds - 1e-9; t += DT) w.step(DT, seen);
}

describe('wanted: crimes', () => {
  it('stars are the whole part of the heat', () => {
    expect(starsFor(0)).toBe(0);
    expect(starsFor(0.99)).toBe(0);
    expect(starsFor(1)).toBe(1);
    expect(starsFor(3.7)).toBe(3);
    expect(starsFor(9)).toBe(MAX_HEAT);
  });

  it('unwitnessed crimes cost nothing', () => {
    const { w, log } = setup();
    for (let i = 0; i < 20; i++) w.commit('assault', false);
    expect(w.heat).toBe(0);
    expect(log).toHaveLength(0);
  });

  it('four witnessed knockdowns make one star, and say so once', () => {
    const { w, log } = setup();
    for (let i = 0; i < 3; i++) w.commit('assault', true);
    expect(w.level).toBe(0);
    w.commit('assault', true);
    expect(w.heat).toBeCloseTo(CRIME_HEAT.assault * 4);
    expect(w.level).toBe(1);
    expect(log).toEqual([{ type: 'wanted', level: 1, prev: 0, reason: 'crime' }]);
  });

  it('crimes against civilians stop at 3 stars; attacks on police go to 5', () => {
    const { w } = setup();
    for (let i = 0; i < 100; i++) w.commit('explosion', true);
    expect(w.heat).toBeCloseTo(CIVILIAN_CAP);
    expect(w.level).toBe(3);
    w.commit('copDown', true);
    expect(w.level).toBe(4);
    for (let i = 0; i < 10; i++) w.commit('ramCop', true);
    expect(w.level).toBe(MAX_HEAT);
    expect(w.heat).toBe(MAX_HEAT);
    // A civilian crime never lowers heat earned on the police.
    w.commit('assault', true);
    expect(w.heat).toBe(MAX_HEAT);
  });

  it('caps gunfire per window, then allows more in the next one', () => {
    const { w } = setup();
    for (let i = 0; i < 60; i++) w.commit('gunfire', true);
    expect(w.heat).toBeCloseTo(GUNFIRE_CAP);
    w.step(GUNFIRE_WINDOW + 0.01, true);
    for (let i = 0; i < 60; i++) w.commit('gunfire', true);
    expect(w.heat).toBeCloseTo(GUNFIRE_CAP * 2);
  });

  it('stealing a police car is at least one star, witnessed or not', () => {
    const { w } = setup();
    w.commit('copCarStolen', false);
    expect(w.level).toBe(1);
    w.force(3.5);
    w.commit('copCarStolen', false);
    expect(w.heat).toBe(3.5);
  });

  it('heat short of a star fades once things have been quiet a while', () => {
    const { w } = setup();
    w.commit('assault', true);
    run(w, COOL_AFTER - 1, false);
    expect(w.heat).toBeCloseTo(CRIME_HEAT.assault);
    run(w, 20, false);
    expect(w.heat).toBe(0);
  });
});

describe('wanted: evasion', () => {
  it('needs 6 s + 3 s per star out of sight to lose a star', () => {
    expect(evadeSeconds(1)).toBe(EVADE_BASE + EVADE_PER_STAR);
    expect(evadeSeconds(3)).toBe(EVADE_BASE + 3 * EVADE_PER_STAR);
    expect(evadeSeconds(5)).toBeGreaterThan(evadeSeconds(4));
  });

  it('blinks after a moment unseen, then drops one star at a time to clear', () => {
    const { w, log } = setup();
    w.force(2.4);
    log.length = 0;
    run(w, SEARCH_AFTER - 0.1, false);
    expect(w.searching).toBe(false);
    run(w, 0.2, false);
    expect(w.searching).toBe(true);
    run(w, evadeSeconds(2) - (SEARCH_AFTER + 0.1) + 0.05, false);
    expect(w.level).toBe(1);
    expect(log.at(-1)).toMatchObject({ level: 1, prev: 2, reason: 'lost' });
    run(w, evadeSeconds(1), false);
    expect(w.level).toBe(0);
    expect(w.heat).toBe(0);
    expect(log.at(-1)).toMatchObject({ level: 0, prev: 1, reason: 'evaded' });
  });

  it('being seen restarts the clock', () => {
    const { w } = setup();
    w.force(1);
    run(w, evadeSeconds(1) - 1, false);
    w.step(DT, true);
    expect(w.unseen).toBe(0);
    run(w, evadeSeconds(1) - 1, false);
    expect(w.level).toBe(1);
  });

  it('a witnessed crime also restarts the clock', () => {
    const { w } = setup();
    w.force(1.2);
    run(w, evadeSeconds(1) - 1, false);
    w.commit('gunfire', true);
    expect(w.unseen).toBe(0);
  });

  it('keeps the chase peak until the stars are gone (for the EVADED bonus)', () => {
    const { w, bus } = setup();
    let peakAtEvade = -1;
    bus.on('wanted', (e) => {
      if (e.reason === 'evaded') peakAtEvade = w.peak;
    });
    for (let i = 0; i < 12; i++) w.commit('explosion', true);
    expect(w.level).toBe(3);
    run(w, evadeSeconds(3) + evadeSeconds(2) + evadeSeconds(1) + 1, false);
    expect(w.level).toBe(0);
    expect(peakAtEvade).toBe(3);
    expect(w.peak).toBe(0);
  });

  it('clear() drops straight to zero with its reason', () => {
    const { w, log } = setup();
    w.force(4.2);
    log.length = 0;
    w.clear('busted');
    expect(w.level).toBe(0);
    expect(log).toEqual([{ type: 'wanted', level: 0, prev: 4, reason: 'busted' }]);
    w.clear('reset');
    expect(log).toHaveLength(1); // nothing to clear the second time
  });
});
