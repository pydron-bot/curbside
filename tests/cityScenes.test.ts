import { describe, expect, it } from 'vitest';
import {
  BUSY,
  IN_PLAY,
  LOUD,
  WANTED_PACE,
  WANTED_SCENE_CAP,
  activityHolds,
  busyCap,
  paceFor,
  SCENE_START_RANGE,
  SceneClock,
  ServeQueue,
  held,
  nearest,
  stepService,
  type SceneWorld,
  type ServiceSense,
  type ServiceState,
} from '../src/systems/cityScenes';

const PLAYING: SceneWorld = { playing: true, activity: false, stars: 0, opening: false };

describe('SceneClock', () => {
  function clock(rand = () => 0.5) {
    const c = new SceneClock(rand);
    c.define('a', { every: [10, 20], cap: 1, first: 5 });
    c.define('b', { every: [30, 30], cap: 2, range: 60 });
    return c;
  }

  it('holds each kind until its first start, then a fresh wait after each', () => {
    const c = clock();
    expect(c.due('a', 4.9, 0, PLAYING)).toBe(false);
    expect(c.due('a', 5, 0, PLAYING)).toBe(true);
    // b has no `first`: a full wait.
    expect(c.due('b', 29, 0, PLAYING)).toBe(false);
    expect(c.due('b', 30, 0, PLAYING)).toBe(true);
    c.start('a', 5);
    expect(c.due('a', 19.9, 0, PLAYING)).toBe(false);
    expect(c.due('a', 20, 0, PLAYING)).toBe(true);
  });

  it('never starts more than the cap at once', () => {
    const c = clock(() => 0);
    expect(c.due('b', 100, 1, PLAYING)).toBe(true);
    expect(c.due('b', 100, 2, PLAYING)).toBe(false);
    expect(c.due('a', 100, 1, PLAYING)).toBe(false);
  });

  it('defers a few seconds when a start had nowhere to go, and resets from a new time', () => {
    const c = clock(() => 0);
    c.defer('a', 50, 3);
    expect(c.due('a', 52, 0, PLAYING)).toBe(false);
    expect(c.due('a', 53, 0, PLAYING)).toBe(true);
    c.reset(100);
    expect(c.left('a', 100)).toBe(5);
    expect(c.left('b', 100)).toBe(30);
  });

  it('starts only within its range of the player (the default without one)', () => {
    const c = clock();
    expect(c.near('b', 60)).toBe(true);
    expect(c.near('b', 61)).toBe(false);
    expect(c.near('a', SCENE_START_RANGE)).toBe(true);
    expect(c.near('a', SCENE_START_RANGE + 1)).toBe(false);
  });

  it('a kind never defined is a mistake, said out loud', () => {
    expect(() => clock().due('nope', 0, 0, PLAYING)).toThrow(/never defined/);
  });

  it('holds: the title, an activity, wanted stars, the cold open', () => {
    const c = new SceneClock(() => 0);
    c.define('loud', { every: [0, 0], cap: 1, first: 0, hold: LOUD });
    c.define('quiet', { every: [0, 0], cap: 1, first: 0, hold: IN_PLAY });
    c.define('any', { every: [0, 0], cap: 1, first: 0 });
    const worlds: SceneWorld[] = [
      { ...PLAYING, playing: false },
      { ...PLAYING, activity: true },
      { ...PLAYING, stars: 2 },
      { ...PLAYING, opening: true },
    ];
    for (const w of worlds) {
      expect(c.due('loud', 1, 0, w)).toBe(false);
      expect(c.due('any', 1, 0, w)).toBe(true);
    }
    expect(c.due('quiet', 1, 0, worlds[0])).toBe(false);
    expect(c.due('quiet', 1, 0, worlds[1])).toBe(true);
    expect(c.due('loud', 1, 0, PLAYING)).toBe(true);
    expect(held({ every: [0, 0], cap: 1, hold: ['wanted'] }, { ...PLAYING, stars: 1 })).toBe(true);
  });
});

describe('stepService', () => {
  const sense = (o: Partial<ServiceSense> = {}): ServiceSense => ({ lost: false, stuck: false, arrived: false, away: false, ...o });
  const fresh = (): ServiceState => ({ phase: 'drive', age: 0, site: 0 });

  it('drives, arrives, waits out its dwell, leaves, and is done once away', () => {
    const s = fresh();
    const times = { timeout: 60, dwell: 3 };
    expect(stepService(s, sense(), 1, times)).toBe('drive');
    expect(stepService(s, sense({ arrived: true }), 1, times)).toBe('onSite');
    expect(stepService(s, sense(), 1, times)).toBe('onSite');
    expect(stepService(s, sense(), 1, times)).toBe('onSite');
    expect(stepService(s, sense(), 1, times)).toBe('leave');
    expect(stepService(s, sense(), 1, times)).toBe('leave');
    expect(stepService(s, sense({ away: true }), 1, times)).toBe('done');
    expect(stepService(s, sense({ lost: true }), 1, times)).toBe('done');
  });

  it('without a dwell it stays on site until the scene sends it off', () => {
    const s = fresh();
    stepService(s, sense({ arrived: true }), 1, { timeout: 60 });
    for (let i = 0; i < 100; i++) stepService(s, sense(), 1, { timeout: 60 });
    expect(s.phase).toBe('onSite');
    expect(s.site).toBe(100);
  });

  it('fails if lost or stuck on the way, or never there in time; lost while leaving is just done', () => {
    const lost = fresh();
    expect(stepService(lost, sense({ lost: true }), 1, { timeout: 60 })).toBe('failed');
    const stuck = fresh();
    expect(stepService(stuck, sense({ stuck: true }), 1, { timeout: 60 })).toBe('failed');
    const slow = fresh();
    for (let i = 0; i < 61; i++) stepService(slow, sense(), 1, { timeout: 60 });
    expect(slow.phase).toBe('failed');
    const leaving: ServiceState = { phase: 'leave', age: 0, site: 0 };
    expect(stepService(leaving, sense({ lost: true }), 1, { timeout: 60 })).toBe('done');
    const onSite: ServiceState = { phase: 'onSite', age: 0, site: 0 };
    expect(stepService(onSite, sense({ lost: true }), 1, { timeout: 60 })).toBe('failed');
  });
});

describe('ServeQueue', () => {
  it('serves the front one every `every` seconds once they are at the hatch', () => {
    const q = new ServeQueue<string>(3, 3);
    expect(q.join('a')).toBe(true);
    expect(q.join('b')).toBe(true);
    expect(q.join('a')).toBe(false);
    expect(q.step(5, false)).toBe(null);
    expect(q.step(2.9, true)).toBe(null);
    expect(q.step(0.2, true)).toBe('a');
    expect(q.members).toEqual(['b']);
  });

  it('caps the line and lets people drop out (the front one starts the wait again)', () => {
    const q = new ServeQueue<number>(2, 2);
    q.join(1);
    q.join(2);
    expect(q.join(3)).toBe(false);
    q.step(1.5, true);
    q.leave(1);
    expect(q.step(1, true)).toBe(null);
    expect(q.step(1.1, true)).toBe(2);
  });
});

describe('nearest', () => {
  it('picks the closest accepted one within range', () => {
    const list = [
      { x: 5, z: 0, ok: false },
      { x: 8, z: 0, ok: true },
      { x: 30, z: 0, ok: true },
    ];
    expect(nearest(list, 0, 0, 20, (t) => t.ok)).toBe(list[1]);
    expect(nearest(list, 0, 0, 6, (t) => t.ok)).toBe(null);
  });
});

describe('the city does not stop (V2-02): busy holds, the wanted pace, the caps', () => {
  const W = (o: Partial<SceneWorld> = {}): SceneWorld => ({ ...PLAYING, ...o });

  it('BUSY scenes run through wanted stars, but not behind the title, in a timed race or the cold open', () => {
    const spec = { every: [0, 0] as const, cap: 1, hold: BUSY, pace: WANTED_PACE };
    for (let stars = 0; stars <= 5; stars++) expect(held(spec, W({ stars }))).toBe(false);
    expect(held(spec, W({ playing: false }))).toBe(true);
    expect(held(spec, W({ activity: true }))).toBe(true);
    expect(held(spec, W({ opening: true }))).toBe(true);
    // LOUD is still everything, stars included.
    expect(held({ every: [0, 0], cap: 1, hold: LOUD }, W({ stars: 1 }))).toBe(true);
  });

  it('the wanted pace: full with no stars, fewer each star, never none', () => {
    const spec = { every: [0, 0] as const, cap: 1, pace: WANTED_PACE };
    expect(paceFor(spec, 0)).toBe(1);
    for (let s = 1; s <= 5; s++) {
      expect(paceFor(spec, s)).toBeLessThan(paceFor(spec, s - 1));
      expect(paceFor(spec, s)).toBeGreaterThan(0.25);
    }
    // Past the table: its last; no pace at all: full.
    expect(paceFor(spec, 9)).toBe(WANTED_PACE[WANTED_PACE.length - 1]);
    expect(paceFor({ every: [0, 0], cap: 1 }, 5)).toBe(1);
  });

  it('a paced clock runs slower while wanted (and a featured kind keeps full pace)', () => {
    const c = new SceneClock(() => 0);
    c.define('race', { every: [10, 10], cap: 1, first: 10, hold: BUSY, pace: WANTED_PACE });
    c.define('fire', { every: [10, 10], cap: 1, first: 10, hold: BUSY });
    c.define('shown', { every: [10, 10], cap: 1, first: 10, pace: WANTED_PACE });
    const stars = 3;
    const pace = WANTED_PACE[stars];
    let t = 0;
    for (; t < 10 / pace - 0.5; t += 0.5) c.tick(0.5, stars, 'shown');
    expect(c.due('fire', 10, 0, W({ stars }))).toBe(true);
    expect(c.due('shown', 10, 0, W({ stars }))).toBe(true);
    expect(c.due('race', t, 0, W({ stars }))).toBe(false);
    c.tick(0.5, stars, 'shown');
    expect(c.due('race', t + 0.5 + 1e-9, 0, W({ stars }))).toBe(true);
    // No stars: tick changes nothing.
    const left = c.left('fire', 0);
    c.tick(100, 0);
    expect(c.left('fire', 0)).toBe(left);
    expect(c.busy('race')).toBe(true);
    expect(c.busy('fire')).toBe(false);
  });

  it('only a timed race or a mission that asks holds the city; Chaos Run, fares and frenzies do not', () => {
    expect(activityHolds('race', false)).toBe(true);
    expect(activityHolds('mission', true)).toBe(true);
    expect(activityHolds('mission', false)).toBe(false);
    expect(activityHolds('taxi', false)).toBe(false);
    expect(activityHolds('frenzy', false)).toBe(false);
    // Chaos Run isn't a `busy` activity: null.
    expect(activityHolds(null, false)).toBe(false);
  });

  it('while wanted, the busy scenes running at once are capped by quality tier', () => {
    expect(busyCap('medium', 0)).toBe(Infinity);
    expect(busyCap('high', 2)).toBe(WANTED_SCENE_CAP.high);
    expect(busyCap('medium', 5)).toBe(WANTED_SCENE_CAP.medium);
    expect(busyCap('low', 1)).toBe(WANTED_SCENE_CAP.low);
    expect(WANTED_SCENE_CAP.low).toBeLessThan(WANTED_SCENE_CAP.medium);
    expect(WANTED_SCENE_CAP.medium).toBeLessThan(WANTED_SCENE_CAP.high);
  });
});
