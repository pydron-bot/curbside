import { describe, expect, it } from 'vitest';
import { Arsenal, WEAPONS, autoAim, rayCircle, rayRect } from '../src/systems/weapons';

describe('arsenal', () => {
  it('starts with fists, picks up guns and spends ammo', () => {
    const a = new Arsenal();
    expect(a.current).toBeNull();
    expect(a.tryFire()).toBeNull();
    a.pickUp('pistol');
    expect(a.current).toBe('pistol');
    expect(a.tryFire()).toBe('pistol');
    expect(a.ammo.get('pistol')).toBe(WEAPONS.pistol.pickupAmmo - 1);
    expect(a.tryFire()).toBeNull(); // cooling down
    a.step(1);
    expect(a.tryFire()).toBe('pistol');
  });

  it('cycles through fists and owned guns only', () => {
    const a = new Arsenal();
    a.pickUp('shotgun');
    a.cycle();
    expect(a.current).toBeNull();
    a.cycle();
    expect(a.current).toBe('shotgun');
  });

  it('falls back when a gun runs dry', () => {
    const a = new Arsenal();
    a.pickUp('pistol');
    a.ammo.set('pistol', 1);
    a.tryFire();
    expect(a.current).toBeNull();
  });
});

describe('ray tests', () => {
  it('hits circles and boxes at the right distance, misses behind', () => {
    expect(rayCircle(0, 0, 1, 0, { x: 10, z: 0, r: 1 })).toBeCloseTo(9);
    expect(rayCircle(0, 0, 1, 0, { x: -10, z: 0, r: 1 })).toBe(Infinity);
    expect(rayCircle(0, 0, 1, 0, { x: 10, z: 3, r: 1 })).toBe(Infinity);
    const box = { minX: 5, minZ: -1, maxX: 7, maxZ: 1 };
    expect(rayRect(0, 0, 1, 0, box)).toBeCloseTo(5);
    expect(rayRect(0, 0, 0, 1, box)).toBe(Infinity);
  });

  it('auto-aim picks the target in front, ignores ones behind', () => {
    // Heading 0 faces +Z.
    const dir = autoAim(0, 0, 0, [{ x: 3, z: 10 }, { x: 0, z: -5 }], 30);
    expect(dir.z).toBeGreaterThan(0.9);
    expect(dir.x).toBeGreaterThan(0.2); // bent toward the target
    const none = autoAim(0, 0, 0, [{ x: 0, z: -5 }], 30);
    expect(none).toEqual({ x: 0, z: 1 });
  });
});
