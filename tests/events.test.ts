import { describe, expect, it, vi } from 'vitest';
import { EventBus, events, type GameEvent } from '../src/core/events';

describe('event bus', () => {
  it('delivers events to listeners of that type, in subscription order', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on('crash', (e) => order.push(`a${e.impact}`));
    bus.on('crash', (e) => order.push(`b${e.impact}`));
    bus.on('explosion', () => order.push('boom'));
    bus.emit({ type: 'crash', x: 0, z: 0, impact: 7, against: 'static', involvesPlayer: true });
    expect(order).toEqual(['a7', 'b7']);
  });

  it('onAny sees everything, after the typed listeners', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.onAny((e) => seen.push(`any:${e.type}`));
    bus.on('respawn', () => seen.push('respawn'));
    bus.emit({ type: 'respawn' });
    bus.emit({ type: 'playerDied' });
    expect(seen).toEqual(['respawn', 'any:respawn', 'any:playerDied']);
  });

  it('unsubscribes', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('pause', fn);
    const offAny = bus.onAny(fn);
    bus.emit({ type: 'pause', paused: true });
    off();
    offAny();
    bus.emit({ type: 'pause', paused: false });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a listener unsubscribing mid-emit does not make others miss the event', () => {
    const bus = new EventBus();
    const second = vi.fn();
    const off = bus.on('award', () => off());
    bus.on('award', second);
    bus.emit({ type: 'award', award: { kind: 'boom', label: 'KABOOM', points: 500, multiplier: 1 } });
    expect(second).toHaveBeenCalledOnce();
  });

  it('a listener added mid-emit starts with the next event', () => {
    const bus = new EventBus();
    const late = vi.fn();
    bus.on('respawn', () => {
      bus.on('respawn', late);
    });
    bus.emit({ type: 'respawn' });
    expect(late).not.toHaveBeenCalled();
    bus.emit({ type: 'respawn' });
    expect(late).toHaveBeenCalledOnce();
  });

  it('listeners get the exact event object (typed per event)', () => {
    const bus = new EventBus();
    let got: GameEvent | null = null;
    bus.on('shot', (e) => {
      got = e;
      // Type narrowing: weapon is only on shot events.
      expect(e.weapon).toBe('smg');
    });
    const e: GameEvent = { type: 'shot', x: 1, z: 2, dirX: 0, dirZ: 1, weapon: 'smg', byPlayer: true };
    bus.emit(e);
    expect(got).toBe(e);
  });

  it('there is one shared game bus', () => {
    expect(events).toBeInstanceOf(EventBus);
  });
});
