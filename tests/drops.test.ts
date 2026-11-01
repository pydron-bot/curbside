import { describe, expect, it } from 'vitest';
import { DROP_LIFE, DROP_RADIUS, MAX_DROPS, WeaponDrops } from '../src/world/drops';

describe('WeaponDrops', () => {
  it('lies where it fell until picked up', () => {
    const d = new WeaponDrops();
    d.drop('smg', 5, 5, 0);
    expect(d.count).toBe(1);
    expect(d.at(0, 0)).toBe(null);
    const got = d.at(5 + DROP_RADIUS * 0.9, 5);
    expect(got?.kind).toBe('smg');
    d.take(got!);
    expect(d.count).toBe(0);
    expect(d.at(5, 5)).toBe(null);
  });

  it('is gone after DROP_LIFE', () => {
    const d = new WeaponDrops();
    d.drop('pistol', 0, 0, 10);
    d.step(10 + DROP_LIFE - 1);
    expect(d.count).toBe(1);
    d.step(10 + DROP_LIFE + 0.1);
    expect(d.count).toBe(0);
  });

  it('keeps at most MAX_DROPS: a new one takes the oldest slot', () => {
    const d = new WeaponDrops();
    for (let i = 0; i < MAX_DROPS; i++) d.drop('pistol', i * 10, 0, i);
    d.drop('shotgun', 500, 0, 100);
    expect(d.count).toBe(MAX_DROPS);
    expect(d.at(0, 0)).toBe(null);
    expect(d.at(500, 0)?.kind).toBe('shotgun');
    d.clear();
    expect(d.count).toBe(0);
  });
});
