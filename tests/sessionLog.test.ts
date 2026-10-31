import { describe, expect, it } from 'vitest';
import {
  DIAG_KEY,
  EVENT_CAPACITY,
  loadPreviousLog,
  PERSIST_EVERY_MS,
  SAMPLE_CAPACITY,
  SAMPLE_EVERY_MS,
  SessionLog,
  type KeyValueStore,
} from '../src/core/sessionLog';

const base = { fps: 59.94, p50: 16.66, p95: 18.2, p99: 33.3, jsP95: 4.04, hitches: 1.25, tier: 'medium', ratio: 1.5, dc: 92, audioState: 'running', paused: false };

function fakeStore(): KeyValueStore & { map: Map<string, string>; writes: number } {
  const map = new Map<string, string>();
  return {
    map,
    writes: 0,
    getItem: (k) => map.get(k) ?? null,
    setItem(k, v) {
      this.writes++;
      map.set(k, v);
    },
  };
}

describe('SessionLog', () => {
  it('samples every 10 s, rounded, oldest first after the ring wraps', () => {
    const log = new SessionLog(1000, 'x');
    expect(log.due(1000 + SAMPLE_EVERY_MS - 1)).toBe(false);
    expect(log.due(1000 + SAMPLE_EVERY_MS)).toBe(true);
    for (let i = 1; i <= SAMPLE_CAPACITY + 5; i++) log.addSample(1000 + i * SAMPLE_EVERY_MS, { ...base, dc: i });
    const d = log.data();
    expect(d.samples).toHaveLength(SAMPLE_CAPACITY);
    expect(d.samples[0].dc).toBe(6);
    expect(d.samples[SAMPLE_CAPACITY - 1].dc).toBe(SAMPLE_CAPACITY + 5);
    expect(d.samples[0].t).toBe(60);
    expect(d.samples[0].fps).toBe(59.9);
    expect(d.samples[0].jsP95).toBe(4);
  });

  it('caps events and counts the dropped ones', () => {
    const log = new SessionLog(0);
    for (let i = 0; i < EVENT_CAPACITY + 3; i++) log.addEvent(i * 100, 'tier', `t${i}`);
    const d = log.data();
    expect(d.events).toHaveLength(EVENT_CAPACITY);
    expect(d.droppedEvents).toBe(3);
    expect(d.events[1]).toEqual({ t: 0.1, kind: 'tier', detail: 't1' });
    expect(log.eventCount).toBe(EVENT_CAPACITY + 3);
  });

  it('persists throttled, only with news, and survives a throwing store', () => {
    const log = new SessionLog(0);
    const store = fakeStore();
    expect(log.persist(PERSIST_EVERY_MS, store)).toBe(false); // nothing new
    log.addEvent(5, 'visibility', 'hidden');
    expect(log.persist(PERSIST_EVERY_MS - 1, store)).toBe(false);
    expect(log.persist(PERSIST_EVERY_MS, store)).toBe(true);
    log.addEvent(PERSIST_EVERY_MS + 1, 'audio', 'interrupted');
    expect(log.persist(PERSIST_EVERY_MS + 2, store)).toBe(false);
    expect(log.persist(PERSIST_EVERY_MS + 2, store, true)).toBe(true);
    expect(store.writes).toBe(2);
    const bad: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    log.addEvent(1, 'x');
    expect(log.persist(0, bad, true)).toBe(false);
    expect(log.persist(0, null, true)).toBe(false);
  });

  it('round-trips through storage for the next session', () => {
    const log = new SessionLog(0, '2026-10-31T00:00:00.000Z');
    log.addSample(SAMPLE_EVERY_MS, base);
    log.addEvent(SAMPLE_EVERY_MS, 'contextlost');
    const store = fakeStore();
    log.persist(0, store, true);
    const prev = loadPreviousLog(store)!;
    expect(prev.started).toBe('2026-10-31T00:00:00.000Z');
    expect(prev.samples[0].tier).toBe('medium');
    expect(prev.events[0].kind).toBe('contextlost');
    store.map.set(DIAG_KEY, '{oops');
    expect(loadPreviousLog(store)).toBeNull();
    expect(loadPreviousLog(null)).toBeNull();
  });
});
