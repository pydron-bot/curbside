import { describe, expect, it } from 'vitest';
import { EventTrail } from '../src/core/eventTrail';
import type { GameEvent } from '../src/core/events';

const boom: GameEvent = { type: 'explosion', x: 10.123, z: -4, distance: 12, byPlayer: true, source: 'rocket' };

describe('event trail', () => {
  it('keeps compact entries: where, a value, a word, by the player', () => {
    const t = new EventTrail(8);
    t.record(100, boom);
    t.record(101, { type: 'wanted', level: 3, prev: 2, reason: 'crime' } as GameEvent);
    t.record(102, { type: 'award', award: { kind: 'smash', label: 'SMASH', points: 250, multiplier: 2 } } as GameEvent);
    t.record(103, { type: 'playerDied' });
    const e = t.entries(105);
    expect(e).toEqual([
      [5, 'explosion', 10.12, -4, 12, 'rocket', 1],
      [4, 'wanted', null, null, 3, 'crime', 0],
      [3, 'award', null, null, 250, 'smash', 0],
      [2, 'playerDied', null, null, null, null, 0],
    ]);
  });

  it('keeps the newest `capacity` and only the last 30 s', () => {
    const t = new EventTrail(4);
    for (let i = 0; i < 10; i++) t.record(i * 10, { type: 'respawn' });
    expect(t.count).toBe(4);
    // Kept: 60, 70, 80, 90; within 30 s of 95: 70, 80, 90.
    expect(t.entries(95).map((e) => e[0])).toEqual([25, 15, 5]);
    t.clear();
    expect(t.entries(95)).toEqual([]);
  });

  it('records without allocating new slots (fixed arrays reused)', () => {
    const t = new EventTrail(4);
    for (let i = 0; i < 1000; i++) t.record(i, boom);
    expect(t.count).toBe(4);
    expect(t.entries(999)).toHaveLength(4);
  });
});
