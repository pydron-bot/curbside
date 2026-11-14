/**
 * Stage 4 (chases worth having): the ways to lose the police beyond staying
 * unseen (NEW WHEELS, LYING LOW, the search ring), the 4–5 star survival
 * knobs, the roadblock's warning and the GOT AWAY pay. The rules are pure;
 * the Heat wiring is checked in tests/heat.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { EventBus, type EventOf } from '../src/core/events';
import { GETAWAY_CAP, getawayPay } from '../src/game/heat';
import { PLAYER_CRASH_SHARE, playerCrashShare } from '../src/systems/damage';
import { ALLEY_MAX, ALLEY_MIN, Hideouts, alleys } from '../src/systems/hideouts';
import { SEARCH_RING_MAX, SEARCH_RING_MIN, searchRadius } from '../src/systems/police';
import { ScannerFeed, type PingWorld } from '../src/systems/scanner';
import { CHASE_TIME_FROM, LIE_LOW_RATE, NEW_WHEELS_SHARE, Wanted, evadeSeconds } from '../src/systems/wanted';
import { BLOCK_SIZE, generateCity, isCarPark, lotBytes } from '../src/world/city';

const DT = 1 / 60;

function setup() {
  const bus = new EventBus();
  const log: Array<EventOf<'wanted'>> = [];
  bus.on('wanted', (e) => log.push(e));
  const w = new Wanted(bus);
  return { bus, log, w };
}

/** Step until the level drops below `from` (or `limit` s); seconds taken. */
function timeToDrop(w: Wanted, from: number, limit = 60): number {
  for (let t = 0; t < limit; t += DT) {
    w.step(DT, false);
    if (w.level < from) return t;
  }
  return Infinity;
}

/** A chase at `stars` that the police have seen (the response grace is over). */
function seenAt(stars: number) {
  const s = setup();
  s.w.force(stars);
  s.w.step(DT, true);
  return s;
}

describe('evasion at the top', () => {
  it('the wait per star stops growing at 4 and 5 stars, and 1–3 stars are as before', () => {
    expect(evadeSeconds(1)).toBe(9);
    expect(evadeSeconds(3)).toBe(15);
    expect(evadeSeconds(4)).toBe(15);
    expect(evadeSeconds(5)).toBe(16);
  });
});

describe('NEW WHEELS', () => {
  it('a different car, unseen, halves the wait for the current star', () => {
    const plain = seenAt(3).w;
    const wheels = seenAt(3).w;
    expect(wheels.switchedCar(false)).toBe(true);
    expect(wheels.newWheels).toBe(true);
    const a = timeToDrop(plain, 3);
    const b = timeToDrop(wheels, 3);
    expect(b).toBeCloseTo(a * NEW_WHEELS_SHARE, 1);
  });

  it('is no use with a cop watching, and only once per star', () => {
    const { w } = seenAt(4);
    expect(w.switchedCar(true)).toBe(false);
    expect(w.switchedCar(false)).toBe(true);
    // Hopping again at the same star adds nothing.
    expect(w.switchedCar(false)).toBe(false);
    // The star drops: the next one is a fresh wait, and a new car counts again.
    timeToDrop(w, 4);
    expect(w.level).toBe(3);
    expect(w.newWheels).toBe(false);
    expect(w.switchedCar(false)).toBe(true);
  });

  it('a sighting in the new car ends it', () => {
    const { w } = seenAt(3);
    w.switchedCar(false);
    w.step(DT, true);
    expect(w.newWheels).toBe(false);
    expect(timeToDrop(w, 3)).toBeCloseTo(evadeSeconds(3), 1);
  });

  it('does nothing when clean', () => {
    const { w } = setup();
    expect(w.switchedCar(false)).toBe(false);
  });
});

describe('LYING LOW', () => {
  it('hiding unseen runs the clock LIE_LOW_RATE times as fast', () => {
    const plain = seenAt(2).w;
    const low = seenAt(2).w;
    low.hiding = true;
    expect(low.lyingLow).toBe(false); // seen on the last step
    low.step(DT, false);
    plain.step(DT, false);
    expect(low.lyingLow).toBe(true);
    expect(timeToDrop(low, 2)).toBeCloseTo(timeToDrop(plain, 2) / LIE_LOW_RATE, 0);
  });

  it('stacks with NEW WHEELS', () => {
    const { w } = seenAt(5);
    w.hiding = true;
    w.switchedCar(false);
    expect(timeToDrop(w, 5)).toBeCloseTo((evadeSeconds(5) * NEW_WHEELS_SHARE) / LIE_LOW_RATE, 1);
  });

  it('seen while hiding: not lying low, and the clock starts over', () => {
    const { w } = seenAt(2);
    w.hiding = true;
    w.step(3, false);
    w.step(DT, true);
    expect(w.lyingLow).toBe(false);
    expect(w.unseen).toBe(0);
  });
});

describe('hideouts', () => {
  const city = generateCity(1337);
  const hideouts = new Hideouts(city);

  it('every car park the ground draws is one', () => {
    const bytes = lotBytes(city);
    let parks = 0;
    for (let i = 0; i < city.blocks.length; i++) {
      if (!isCarPark(city, bytes, i)) continue;
      parks++;
      const r = city.blocks[i].interior;
      expect(hideouts.at((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2)?.kind).toBe('carPark');
    }
    expect(parks).toBeGreaterThan(0);
  });

  it('alleys are the narrow gaps between two buildings, and you can stand in one', () => {
    const list = alleys(city.buildings);
    expect(list.length).toBeGreaterThan(50);
    for (const a of list) {
      const w = Math.min(a.maxX - a.minX, a.maxZ - a.minZ);
      expect(w).toBeGreaterThanOrEqual(ALLEY_MIN - 1e-9);
      expect(w).toBeLessThanOrEqual(ALLEY_MAX + 1e-9);
      // Its middle is open ground (no building there).
      const x = (a.minX + a.maxX) / 2;
      const z = (a.minZ + a.maxZ) / 2;
      expect(city.buildings.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)).toBe(false);
      expect(hideouts.at(x, z)).not.toBeNull();
    }
  });

  it('a road is no hideout', () => {
    // Junctions are on the block grid: always road.
    for (let i = -4; i <= 4; i++) expect(hideouts.at(i * BLOCK_SIZE, 2 * BLOCK_SIZE)).toBeNull();
  });
});

describe('where they think you are', () => {
  it('the search ring starts small round the last sighting and widens, to a limit', () => {
    expect(searchRadius(0)).toBe(SEARCH_RING_MIN);
    expect(searchRadius(5)).toBeGreaterThan(searchRadius(2));
    expect(searchRadius(600)).toBe(SEARCH_RING_MAX);
  });
});

describe('5 stars you can survive', () => {
  it('the car takes less of each crash in a big chase, as before below 4 stars', () => {
    for (const s of [0, 1, 2]) expect(playerCrashShare(s)).toBe(PLAYER_CRASH_SHARE);
    expect(playerCrashShare(3)).toBeLessThanOrEqual(PLAYER_CRASH_SHARE);
    expect(playerCrashShare(4)).toBeLessThan(playerCrashShare(3));
    expect(playerCrashShare(5)).toBeLessThan(playerCrashShare(4));
  });
});

describe('see it coming', () => {
  it('a roadblock going up is called on the scanner, naming where', () => {
    const feed = new ScannerFeed(() => 0);
    const still: PingWorld = { alive: () => true, where: () => false };
    // Not while clean.
    feed.roadblock('COBBLE ROW', 10, 20, 0);
    expect(feed.step(0, still)).toBeNull();
    feed.stars = 3;
    feed.roadblock('COBBLE ROW', 10, 20, 1);
    const l = feed.step(1, still);
    expect(l?.topic).toBe('roadblock');
    expect(l?.text).toContain('COBBLE ROW');
  });
});

describe('GOT AWAY', () => {
  it('nothing below 2 stars: a star gained and lost in a loop is worth nothing', () => {
    expect(getawayPay(0, 600)).toBe(0);
    expect(getawayPay(1, 600)).toBe(0);
    expect(getawayPay(2, 0)).toBeGreaterThan(0);
  });

  it('pays more for more stars and a longer chase, up to a cap', () => {
    for (let s = 2; s < 5; s++) expect(getawayPay(s + 1, 60)).toBeGreaterThan(getawayPay(s, 60));
    expect(getawayPay(3, 90)).toBeGreaterThan(getawayPay(3, 30));
    expect(getawayPay(5, 1e6)).toBeLessThanOrEqual(GETAWAY_CAP);
    expect(getawayPay(5, Infinity)).toBeLessThanOrEqual(GETAWAY_CAP);
  });

  it('is sized against the economy: a 5-star two minutes is about a good story job, a quick 2 stars pocket money', () => {
    expect(getawayPay(5, 120)).toBeGreaterThan(800);
    expect(getawayPay(5, 120)).toBeLessThan(1400);
    expect(getawayPay(2, 30)).toBeLessThan(150);
  });

  it('the chase time it pays on counts only at 2 stars or more, and comes with the evaded event', () => {
    const { w, log } = setup();
    w.force(1);
    w.step(DT, true);
    for (let i = 0; i < 60 * 5; i++) w.step(DT, true);
    expect(w.chaseTime).toBe(0);
    w.force(CHASE_TIME_FROM + 1);
    w.step(DT, true);
    for (let i = 0; i < 60 * 10; i++) w.step(DT, true);
    expect(w.chaseTime).toBeCloseTo(10, 0);
    for (let i = 0; i < 60 * 60 && w.level > 0; i++) w.step(DT, false);
    const evaded = log.at(-1)!;
    expect(evaded).toMatchObject({ level: 0, reason: 'evaded', peak: CHASE_TIME_FROM + 1 });
    expect(evaded.chaseTime).toBeGreaterThan(10);
    expect(w.chaseTime).toBe(0);
  });
});
