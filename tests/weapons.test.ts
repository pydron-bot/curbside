import { describe, expect, it } from 'vitest';
import { Arsenal, DRIVE_BY_CONE, WEAPONS, autoAim, driveByAim, lockTarget, rayCircle, rayRect } from '../src/systems/weapons';

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

  it('falls back to fists when the only gun runs dry', () => {
    const a = new Arsenal();
    a.pickUp('pistol');
    a.ammo.set('pistol', 1);
    a.tryFire();
    expect(a.current).toBeNull();
  });

  it('switches to the next loaded gun when one runs dry', () => {
    const a = new Arsenal();
    a.pickUp('pistol');
    a.pickUp('smg');
    a.current = 'smg';
    a.ammo.set('smg', 1);
    expect(a.tryFire()).toBe('smg');
    // SMG -> shotgun (not owned) -> pistol: wraps round WEAPON_ORDER.
    expect(a.current).toBe('pistol');

    const b = new Arsenal();
    b.pickUp('pistol');
    b.pickUp('shotgun');
    b.current = 'pistol';
    b.ammo.set('pistol', 1);
    b.tryFire();
    expect(b.current).toBe('shotgun');
  });

  it('cycles backwards too', () => {
    const a = new Arsenal();
    a.pickUp('pistol');
    a.pickUp('smg');
    a.current = null;
    a.cycle(-1);
    expect(a.current).toBe('smg');
    a.cycle(-1);
    expect(a.current).toBe('pistol');
  });
});

describe('ammo', () => {
  it('pickups stop at the carry limit; ammo crates top up every gun owned', () => {
    const a = new Arsenal();
    for (let i = 0; i < 20; i++) a.pickUp('pistol');
    expect(a.ammo.get('pistol')).toBe(WEAPONS.pistol.maxAmmo);
    expect(a.addAmmo()).toBe(false); // nothing to top up
    a.pickUp('smg');
    a.ammo.set('smg', 1);
    expect(a.addAmmo()).toBe(true);
    expect(a.ammo.get('smg')).toBe(1 + WEAPONS.smg.pickupAmmo / 2);
  });

  it('the best drive-by gun is the SMG, then the pistol; nothing else fires from a car', () => {
    const a = new Arsenal();
    a.pickUp('shotgun');
    a.pickUp('rocket');
    expect(a.driveByGun()).toBeNull();
    a.pickUp('pistol');
    expect(a.driveByGun()).toBe('pistol');
    a.pickUp('smg');
    expect(a.driveByGun()).toBe('smg');
  });
});

describe('lock-on', () => {
  const t = (x: number, z: number, hostile = false) => ({ x, z, hostile });
  it('prefers hostiles at any angle; else the best in a 90° cone', () => {
    const list = [t(0, 5), t(-4, -4, true)];
    expect(lockTarget(0, 0, 0, list, 2, 30)).toBe(1);
    expect(lockTarget(0, 0, 0, [t(0, 5), t(6, 1)], 2, 30)).toBe(0); // (6, 1) is outside 45°
    expect(lockTarget(0, 0, 0, [t(0, -5)], 1, 30)).toBe(-1);
    expect(lockTarget(0, 0, 0, [t(0, 40, true)], 1, 30)).toBe(-1); // out of range
  });

  it('with a deliberate aim, only near the aim (hostiles still first)', () => {
    const list = [t(0.5, 10), t(-3, -6, true), t(1.5, 9, true)];
    expect(lockTarget(0, 0, 0, list, 3, 30, 0.35)).toBe(2);
    expect(lockTarget(0, 0, 0, list, 2, 30, 0.35)).toBe(0);
  });
});

describe('drive-by aim', () => {
  const t = (x: number, z: number, hostile = false) => ({ x, z, hostile });
  const out = { x: 0, z: 0 };
  it('finds targets off either side, never dead ahead or behind', () => {
    // Heading 0 faces +Z; the left window looks along +X.
    expect(driveByAim(0, 0, 0, [t(0, 10), t(0, -10)], 2, 30, out)).toBe(-1);
    expect(out.x).toBeCloseTo(1); // fallback: straight out of the driver's window
    expect(driveByAim(0, 0, 0, [t(0, 10), t(8, 2)], 2, 30, out)).toBe(1);
    expect(out.x).toBeGreaterThan(0.9);
    expect(driveByAim(0, 0, 0, [t(-8, -3)], 1, 30, out)).toBe(0);
    expect(out.x).toBeLessThan(-0.9);
    // The cone is ±DRIVE_BY_CONE around square out of the window.
    const edge = Math.PI / 2 - DRIVE_BY_CONE - 0.05;
    expect(driveByAim(0, 0, 0, [t(Math.sin(edge) * 10, Math.cos(edge) * 10)], 1, 30, out)).toBe(-1);
  });

  it('goes for a person before a closer car', () => {
    expect(driveByAim(0, 0, 0, [{ x: 5, z: 0, hostile: false, vehicle: true }, t(8, 1)], 2, 30, out)).toBe(1);
  });

  it('prefers hostiles, and a side filter picks the window', () => {
    expect(driveByAim(0, 0, 0, [t(5, 0), t(-9, 0, true)], 2, 30, out)).toBe(1);
    expect(driveByAim(0, 0, 0, [t(5, 0), t(-9, 0, true)], 2, 30, out, 1)).toBe(0);
    expect(driveByAim(0, 0, 0, [t(5, 0)], 1, 30, out, -1)).toBe(-1);
    expect(out.x).toBeCloseTo(-1);
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
