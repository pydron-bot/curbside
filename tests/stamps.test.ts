import { describe, expect, it } from 'vitest';
import { EventBus, type EventOf, type GameEvent } from '../src/core/events';
import type { CrowdPed } from '../src/game/population';
import type { SceneCtx } from '../src/game/cityLife';
import { Witnesses } from '../src/game/scenes/witnesses';
import { Stamps } from '../src/game/stamps';
import { MAX_COMBO, type Award, type ScoreKind } from '../src/systems/score';
import {
  Burst,
  CHAIN_GAP,
  Chain,
  FLYER_POINTS,
  PILEUP_RANGE,
  STAMPS,
  STAMP_COOLDOWN,
  STAMP_IDS,
  STAMP_OVERRIDE,
  STAMP_STALE,
  StampArbiter,
  StampDetector,
  type StampId,
} from '../src/systems/stamps';

const boom = (over: Partial<EventOf<'explosion'>> = {}): GameEvent => ({ type: 'explosion', x: 0, z: 0, distance: 0, byPlayer: true, ...over });
const award = (kind: ScoreKind, multiplier = 1, points = 100): GameEvent => ({ type: 'award', award: { kind, label: kind, points, multiplier } as Award });
const crash = (x: number, involvesPlayer: boolean, impact = 10): GameEvent => ({ type: 'crash', x, z: 0, impact, against: 'vehicle', involvesPlayer });
const down = (over: Partial<EventOf<'pedDown'>> = {}): GameEvent => ({ type: 'pedDown', x: 0, z: 0, cause: 'vehicle', byPlayer: true, ...over });
const wanted = (level: number, prev: number): GameEvent => ({ type: 'wanted', level, prev, reason: level > prev ? 'crime' : 'evaded' });

/** Feed events at the given times; every stamp found, in order. */
function run(d: StampDetector, steps: [number, GameEvent][]): (StampId | null)[] {
  return steps.map(([t, e]) => d.handle(e, t));
}

describe('stamps: the table', () => {
  it('has the named moments, the chase handoff ones included, each weighed and worded', () => {
    expect(STAMP_IDS.length).toBeGreaterThanOrEqual(12);
    for (const id of ['takeTheHeat', 'citizensArrest', 'haveAGo', 'barbecueSeason'] as StampId[]) expect(STAMPS[id]).toBeDefined();
    expect(STAMPS.takeTheHeat.label).toBe('TAKE THE HEAT');
    expect(STAMPS.citizensArrest.label).toBe("CITIZEN'S ARREST");
    expect(STAMPS.haveAGo.label).toBe('HAVE-A-GO HERO');
    expect(STAMPS.barbecueSeason.label).toBe('BARBECUE SEASON');
    const labels = new Set<string>();
    for (const id of STAMP_IDS) {
      const s = STAMPS[id];
      expect(s.weight).toBeGreaterThan(0);
      expect(s.label).toBe(s.label.toUpperCase());
      // Fits the 852-wide phone layout at the long size.
      expect(s.label.length).toBeLessThanOrEqual(20);
      expect(s.sub.length).toBeLessThanOrEqual(30);
      labels.add(s.label);
    }
    expect(labels.size).toBe(STAMP_IDS.length);
  });
});

describe('stamps: windows', () => {
  it('a burst fires once when n land within the span, and re-arms after a gap', () => {
    const b = new Burst(3, 3);
    expect([b.hit(0), b.hit(1), b.hit(2.5)]).toEqual([false, false, true]);
    // Still the same burst: no second fire.
    expect(b.hit(3)).toBe(false);
    expect(b.hit(4)).toBe(false);
    // A gap longer than the span, then three more.
    expect([b.hit(10), b.hit(11), b.hit(12)]).toEqual([false, false, true]);
  });

  it('a burst spread wider than its span never fires, but a tight run later in it does', () => {
    const b = new Burst(3, 3);
    expect([b.hit(0), b.hit(2), b.hit(4), b.hit(6)]).toEqual([false, false, false, false]);
    expect(b.hit(6.5)).toBe(true);
  });

  it('a chain counts links within the gap and starts again after it', () => {
    const c = new Chain(CHAIN_GAP);
    expect([c.link(0), c.link(1), c.link(3)]).toEqual([1, 2, 3]);
    expect(c.link(3 + CHAIN_GAP + 0.1)).toBe(1);
  });
});

describe('stamps: the detector', () => {
  it('three cars going up in a chain: BARBECUE SEASON; six: BONFIRE NIGHT', () => {
    const d = new StampDetector();
    const got = run(d, [
      [0, boom()],
      [1.2, boom()],
      [2.9, boom()],
      [4, boom()],
      [5, boom()],
      [6.5, boom()],
      [7, boom()],
    ]);
    expect(got).toEqual([null, null, 'barbecueSeason', null, null, 'bonfireNight', null]);
  });

  it('a gap breaks the chain; others\' blasts, your own car and grenades do not count', () => {
    const d = new StampDetector();
    expect(run(d, [[0, boom()], [1, boom()], [1 + CHAIN_GAP + 0.5, boom()], [5, boom()]])).toEqual([null, null, null, null]);
    const e = new StampDetector();
    expect(run(e, [[0, boom()], [0.5, boom({ byPlayer: false })], [1, boom({ ownCar: true })], [1.5, boom({ source: 'grenade' })], [2, boom()]])).toEqual([null, null, null, null, null]);
    // A rocket's own blast is not a car, but the cars it sets off are.
    expect(e.handle(boom({ source: 'vehicle' }), 3)).toBe('barbecueSeason');
  });

  it('three police cars wrecked in one pursuit: ENDANGERED PANDAS, once; 0 stars starts the count again', () => {
    const d = new StampDetector();
    expect(run(d, [[0, award('copWreck')], [20, award('copWreck')], [40, award('copWreck')], [41, award('copWreck')]])).toEqual([null, null, 'endangeredPandas', null]);
    const e = new StampDetector();
    expect(run(e, [[0, award('copWreck')], [1, award('copWreck')], [2, wanted(0, 3)], [3, award('copWreck')], [4, award('copWreck')]])).toEqual([null, null, null, null, null]);
    expect(e.handle(award('copWreck'), 5)).toBe('endangeredPandas');
  });

  it('a pile-up: four car-on-car crashes within 3 s round one of the player\'s', () => {
    const d = new StampDetector();
    // Traffic crashing on its own doesn't count before the player's in it.
    expect(run(d, [[0, crash(0, false)], [0.1, crash(0, false)], [0.2, crash(0, false)]])).toEqual([null, null, null]);
    expect(run(d, [[1, crash(0, true)], [1.4, crash(3, false)], [1.9, crash(-4, false)], [2.5, crash(5, false)]])).toEqual([null, null, null, 'bankHoliday']);
    // Far off, too soft or after the window: not part of it.
    const e = new StampDetector();
    expect(run(e, [[0, crash(0, true)], [0.5, crash(PILEUP_RANGE + 5, false)], [0.6, crash(1, false, 3)], [1, crash(2, false)], [3.5, crash(2, false)]])).toEqual([null, null, null, null, null]);
  });

  it('a bus through a crowd: FARES PLEASE at three; any other car needs four (BOWLED OVER)', () => {
    const d = new StampDetector();
    d.driving = 'bus';
    expect(run(d, [[0, down()], [0.5, down()], [1, down()]])).toEqual([null, null, 'faresPlease']);
    const e = new StampDetector();
    e.driving = 'sedan';
    expect(run(e, [[0, down()], [0.5, down()], [1, down()], [1.5, down()]])).toEqual([null, null, null, 'bowledOver']);
    // Not the player's doing, or the player themselves: nothing.
    const f = new StampDetector();
    f.driving = 'bus';
    expect(run(f, [[0, down({ byPlayer: false })], [0.2, down({ isPlayer: true })], [0.4, down()], [0.6, down()]])).toEqual([null, null, null, null]);
  });

  it('three punched down within 6 s: LAST ORDERS; three of a crew: NEIGHBOURHOOD WATCH (the heavier)', () => {
    const d = new StampDetector();
    expect(run(d, [[0, down({ cause: 'punch' })], [2.5, down({ cause: 'punch' })], [5.5, down({ cause: 'punch' })]])).toEqual([null, null, 'lastOrders']);
    const e = new StampDetector();
    const g = { cause: 'punch' as const, gang: 'vipers' };
    expect(run(e, [[0, down(g)], [1, down(g)], [2, down(g)]])).toEqual([null, null, 'neighbourhoodWatch']);
  });

  it('a blast by a fire crew hosing: HEALTH AND SAFETY, until the fire is out', () => {
    const d = new StampDetector();
    d.handle({ type: 'street', what: 'hose', x: 100, z: 50 }, 0);
    expect(d.handle(boom({ x: 108, z: 44, source: 'rocket' }), 3)).toBe('healthAndSafety');
    const e = new StampDetector();
    e.handle({ type: 'street', what: 'hose', x: 100, z: 50 }, 0);
    e.handle({ type: 'street', what: 'fireOut', x: 100, z: 50 }, 2);
    expect(e.handle(boom({ x: 104, z: 50, source: 'grenade' }), 3)).toBe(null);
    const f = new StampDetector();
    f.handle({ type: 'street', what: 'hose', x: 100, z: 50 }, 0);
    expect(f.handle(boom({ x: 160, z: 50 }), 3)).toBe(null);
  });

  it('big air, the combo to the top, five stars and a big chase shaken off', () => {
    const d = new StampDetector();
    const stunt = (points: number): GameEvent => ({ type: 'stunt', x: 0, z: 0, airtime: 1, distance: 30, spin: 0, points, label: 'STUNT' });
    expect(d.handle(stunt(FLYER_POINTS - 1), 0)).toBe(null);
    expect(d.handle(stunt(FLYER_POINTS), 1)).toBe('frequentFlyer');
    expect(d.handle(award('smash', MAX_COMBO - 2), 2)).toBe(null);
    expect(d.handle(award('smash', MAX_COMBO - 1), 3)).toBe('absoluteScenes');
    expect(d.handle(award('smash', MAX_COMBO), 4)).toBe(null);
    expect(run(d, [[5, wanted(5, 4)], [6, wanted(4, 5)], [7, wanted(5, 4)]])).toEqual(['bluesAndTwos', null, null]);
    expect(d.handle(award('evaded', 1, 5000), 8)).toBe('nothingToSeeHere');
    expect(d.handle(wanted(0, 5), 8)).toBe(null);
    expect(d.handle(wanted(5, 4), 9)).toBe('bluesAndTwos');
  });

  it('a respawn forgets a half-built chain', () => {
    const d = new StampDetector();
    run(d, [[0, boom()], [1, boom()]]);
    d.handle({ type: 'respawn' }, 1.5);
    expect(d.handle(boom(), 2)).toBe(null);
  });
});

describe('stamps: one at a time', () => {
  it('shows at once, then not again until the cooldown is over', () => {
    const a = new StampArbiter();
    a.offer('lastOrders', 0);
    expect(a.step(0)).toBe('lastOrders');
    expect(a.step(0.1)).toBe(null);
    a.offer('bowledOver', 2);
    expect(a.step(2)).toBe(null);
    // Waited out the cooldown while still fresh: it shows then.
    a.offer('bowledOver', STAMP_COOLDOWN - 1);
    expect(a.step(STAMP_COOLDOWN - 0.5)).toBe(null);
    expect(a.step(STAMP_COOLDOWN)).toBe('bowledOver');
  });

  it('a stamp that waits too long is dropped', () => {
    const a = new StampArbiter();
    a.offer('lastOrders', 0);
    a.step(0);
    a.offer('lastOrders', 1);
    expect(a.step(1 + STAMP_STALE + 0.1)).toBe(null);
    expect(a.step(STAMP_COOLDOWN + 1)).toBe(null);
  });

  it('the bigger stamp wins: in one step, and over a lighter one just shown', () => {
    const a = new StampArbiter();
    a.offer('barbecueSeason', 0);
    a.offer('endangeredPandas', 0);
    a.offer('lastOrders', 0);
    expect(a.step(0)).toBe('endangeredPandas');
    const b = new StampArbiter();
    b.offer('lastOrders', 0);
    expect(b.step(0)).toBe('lastOrders');
    b.offer('bonfireNight', STAMP_OVERRIDE / 2);
    expect(b.step(STAMP_OVERRIDE / 2)).toBe('bonfireNight');
    // A lighter one within the window doesn't replace it, and waits.
    b.offer('lastOrders', STAMP_OVERRIDE);
    expect(b.step(STAMP_OVERRIDE)).toBe(null);
    // Nor does a heavier one once the window has passed.
    const c = new StampArbiter();
    c.offer('lastOrders', 0);
    c.step(0);
    c.offer('bonfireNight', STAMP_OVERRIDE + 0.2);
    expect(c.step(STAMP_OVERRIDE + 0.2)).toBe(null);
  });
});

describe('stamps: on the bus', () => {
  function rig(live = true) {
    const bus = new EventBus();
    const w = { t: 0, live, driving: null as 'bus' | null };
    const stamps = new Stamps({ bus, now: () => w.t, live: () => w.live, driving: () => w.driving, position: () => ({ x: 5, z: 7 }) });
    const shown: EventOf<'stamp'>[] = [];
    bus.on('stamp', (e) => shown.push(e));
    return { bus, w, stamps, shown };
  }

  it('the player\'s chaos goes out as one stamp event per step, where the player is', () => {
    const { bus, w, stamps, shown } = rig();
    for (let i = 0; i < 3; i++) {
      w.t = i;
      bus.emit(boom());
    }
    expect(shown.length).toBe(0);
    stamps.step();
    stamps.step();
    expect(shown).toEqual([{ type: 'stamp', id: 'barbecueSeason', x: 5, z: 7 }]);
  });

  it('reads the vehicle the player is in (a bus through a crowd)', () => {
    const { bus, w, stamps, shown } = rig();
    w.driving = 'bus';
    for (let i = 0; i < 3; i++) bus.emit(down());
    stamps.step();
    expect(shown.map((s) => s.id)).toEqual(['faresPlease']);
  });

  it('nothing behind the title or on WASTED; show() names a moment; force() skips the cooldown', () => {
    const { bus, w, stamps, shown } = rig(false);
    for (let i = 0; i < 3; i++) bus.emit(boom());
    stamps.show('takeTheHeat');
    stamps.step();
    expect(shown.length).toBe(0);
    w.live = true;
    stamps.show('citizensArrest');
    stamps.step();
    stamps.show('haveAGo');
    w.t = 1;
    stamps.step();
    expect(shown.map((s) => s.id)).toEqual(['citizensArrest']);
    stamps.force('frequentFlyer');
    stamps.step();
    expect(shown.map((s) => s.id)).toEqual(['citizensArrest', 'frequentFlyer']);
  });

  it('a respawn clears a stamp still waiting', () => {
    const { bus, w, stamps, shown } = rig();
    stamps.show('lastOrders');
    stamps.step();
    w.t = 1;
    stamps.show('bowledOver');
    bus.emit({ type: 'respawn' });
    w.t = STAMP_COOLDOWN + 0.5;
    stamps.step();
    expect(shown.map((s) => s.id)).toEqual(['lastOrders']);
  });
});

describe('stamps: passers-by film it', () => {
  function street(n: number) {
    const crowd: CrowdPed[] = [];
    for (let i = 0; i < n; i++) {
      crowd.push({
        phone: false,
        agent: { street: true, scene: false, role: 'civilian', mode: 'walk', injured: false, burning: 0, s: { x: 8 + i * 2, z: 0, heading: 0 } },
      } as unknown as CrowdPed);
    }
    const life = {
      now: 0,
      people: [] as CrowdPed[],
      view: { minX: -40, minZ: -30, maxX: 40, maxZ: 30 },
      d: { playing: () => true, rand: () => 0.5, population: { crowd } },
      borrow(c: CrowdPed) {
        c.agent.scene = true;
        this.people.push(c);
      },
    };
    return { crowd, life, witnesses: new Witnesses(life as unknown as SceneCtx) };
  }

  it('the nearest few in view stop and film, from the people already there', () => {
    const { crowd, life, witnesses } = street(8);
    // One too close (running from it), one off screen, one busy in a scene, one running.
    crowd[0].agent.s.x = 2;
    crowd[1].agent.s.x = 60;
    crowd[2].agent.scene = true;
    crowd[3].agent.mode = 'flee';
    expect(witnesses.film(0, 0)).toBe(4);
    expect(crowd.filter((c) => c.phone).map((c) => crowd.indexOf(c))).toEqual([4, 5, 6, 7]);
    expect(witnesses.phones.every((p) => p.role === 'film' && p.report === null)).toBe(true);
    expect(life.people.length).toBe(4);
  });

  it('within the phones and people caps', () => {
    const { life, witnesses } = street(12);
    life.people.length = 23;
    expect(witnesses.film(0, 0)).toBe(1);
    const other = street(12);
    other.witnesses.film(0, 0);
    expect(other.witnesses.film(0, 0)).toBe(2);
    expect(other.witnesses.phones.length).toBe(6);
  });
});
