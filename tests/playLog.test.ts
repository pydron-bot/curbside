import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { LOG_CAP, PLAY_LOG_KEY, PlayLog, type LogStorage } from '../src/game/playLog';

function fakeStorage(init: Record<string, string> = {}): LogStorage & { data: Record<string, string>; writes: number } {
  const s = {
    data: { ...init },
    writes: 0,
    getItem: (k: string) => s.data[k] ?? null,
    setItem: (k: string, v: string) => {
      s.writes++;
      s.data[k] = v;
    },
    removeItem: (k: string) => {
      delete s.data[k];
    },
  };
  return s;
}

function setup(init?: Record<string, string>) {
  const storage = fakeStorage(init);
  const bus = new EventBus();
  const clock = { t: 0 };
  const log = new PlayLog({ storage, build: 'abc1234', device: () => 'touch', tier: () => 'medium', now: () => clock.t, wallClock: () => 42 });
  log.attach(bus);
  return { storage, bus, clock, log };
}

describe('play log', () => {
  it('records a Chaos Run end with the stamp', () => {
    const { storage, bus, log } = setup();
    bus.emit({ type: 'activityEnd', kind: 'chaosRun', id: 'chaosRun', time: 120.123, score: 5400, medal: 'silver', end: 'time', bonusTime: 20 });
    expect(log.list).toEqual([{ at: 42, build: 'abc1234', device: 'touch', tier: 'medium', kind: 'chaos', score: 5400, medal: 'silver', elapsed: 120.12, bonusTime: 20, end: 'time' }]);
    expect(JSON.parse(storage.data[PLAY_LOG_KEY])).toEqual(log.list);
  });

  it('records races finished and failed, with the ratio to dev time', () => {
    const { bus, log } = setup();
    bus.emit({ type: 'activityEnd', kind: 'race', id: 'docks', time: 55, dev: 50, medal: 'bronze', end: 'finish' });
    bus.emit({ type: 'activityEnd', kind: 'race', id: 'docks', time: 12, dev: 50, medal: null, end: 'WRECKED' });
    expect(log.list.map((e) => e.kind === 'race' && [e.ratio, e.medal, e.fail])).toEqual([
      [1.1, 'bronze', null],
      [0.24, null, 'WRECKED'],
    ]);
  });

  it('records a chase: peak, time at five stars and how it ended', () => {
    const { bus, clock, log, storage } = setup();
    const wanted = (level: number, prev: number, reason: 'crime' | 'lost' | 'evaded' | 'busted') => bus.emit({ type: 'wanted', level, prev, reason });
    wanted(1, 0, 'crime');
    clock.t = 10;
    wanted(5, 1, 'crime');
    clock.t = 40;
    wanted(4, 5, 'lost');
    clock.t = 50;
    wanted(5, 4, 'crime');
    clock.t = 55;
    expect(storage.writes).toBe(0); // nothing written mid-chase
    wanted(0, 5, 'busted');
    expect(log.list).toHaveLength(1);
    expect(log.list[0]).toMatchObject({ kind: 'heat', peak: 5, atFive: 35, duration: 55, end: 'busted' });
    // A one-star brush isn't logged.
    wanted(1, 0, 'crime');
    clock.t = 60;
    wanted(0, 1, 'evaded');
    expect(log.list).toHaveLength(1);
  });

  it('keeps a ring of the last LOG_CAP entries and survives a reload', () => {
    const { bus, storage } = setup();
    for (let i = 0; i < LOG_CAP + 5; i++) bus.emit({ type: 'activityEnd', kind: 'chaosRun', id: 'chaosRun', time: 1, score: i, medal: null, end: 'time' });
    const reloaded = setup(storage.data).log;
    expect(reloaded.list).toHaveLength(LOG_CAP);
    expect(reloaded.list[0]).toMatchObject({ score: 5 });
    expect(JSON.parse(reloaded.export())).toHaveLength(LOG_CAP);
  });

  it('starts empty on junk in storage, and clear() empties it', () => {
    const { log, storage } = setup({ [PLAY_LOG_KEY]: '{not json' });
    expect(log.list).toEqual([]);
    storage.data[PLAY_LOG_KEY] = '[]';
    log.clear();
    expect(storage.data[PLAY_LOG_KEY]).toBeUndefined();
    expect(log.export()).toBe('[]');
  });
});
