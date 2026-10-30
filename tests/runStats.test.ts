import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { RunStats, formatDuration } from '../src/game/runStats';

describe('run stats', () => {
  it('counts what the player did in this life only', () => {
    const bus = new EventBus();
    const stats = new RunStats(bus);
    bus.emit({ type: 'pedDown', x: 0, z: 0, cause: 'punch', byPlayer: true });
    bus.emit({ type: 'pedDown', x: 0, z: 0, cause: 'vehicle', byPlayer: false }); // traffic's doing
    bus.emit({ type: 'pedDown', x: 0, z: 0, cause: 'blast', byPlayer: true, isPlayer: true }); // the player themself
    bus.emit({ type: 'explosion', x: 0, z: 0, distance: 3, byPlayer: true });
    bus.emit({ type: 'explosion', x: 0, z: 0, distance: 3, byPlayer: false });
    bus.emit({ type: 'carjack', x: 0, z: 0 });
    bus.emit({ type: 'award', award: { kind: 'smash', label: 'SMASH', points: 300, multiplier: 4 } });
    stats.tick(12.5);
    expect(stats).toMatchObject({ knockouts: 1, carsWrecked: 1, carjacks: 1, bestCombo: 4, timeAlive: 12.5 });

    bus.emit({ type: 'playerDied' });
    stats.tick(2); // lying there doesn't count...
    bus.emit({ type: 'explosion', x: 0, z: 0, distance: 3, byPlayer: true }); // ...nor does what blows up after
    expect(stats).toMatchObject({ carsWrecked: 1, timeAlive: 12.5 });

    bus.emit({ type: 'respawn' });
    expect(stats).toMatchObject({ knockouts: 0, carsWrecked: 0, carjacks: 0, bestCombo: 1, timeAlive: 0 });
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(75.9)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
