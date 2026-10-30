import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_SECONDS,
  BLASTS,
  PLAYER_CRASH_SHARE,
  applyDamage,
  crashDamage,
  ignite,
  landingDamage,
  blamesPlayer,
  blastDamage,
  createDamage,
  damageStage,
  impactDamage,
  markPlayerHit,
  stepDamage,
} from '../src/systems/damage';

describe('vehicle damage', () => {
  it('ignores gentle bumps but punishes real crashes', () => {
    expect(impactDamage(5)).toBe(0);
    expect(impactDamage(14)).toBeGreaterThan(20);
    // A 28 m/s head-on into a wall leaves a sedan smoking, not burning.
    const d = createDamage(100);
    applyDamage(d, impactDamage(28));
    expect(damageStage(d)).toBe('smoking');
  });

  it('a car survives a couple of solid crashes; real abuse sets it alight', () => {
    const d = createDamage(100);
    applyDamage(d, impactDamage(20));
    applyDamage(d, impactDamage(20));
    expect(damageStage(d)).toBe('smoking');
    applyDamage(d, impactDamage(20));
    expect(damageStage(d)).toBe('burning');
  });

  it('splits car-on-car damage: the rammer takes less, a head-on shares it', () => {
    // 23.8 m/s head-on between two sedans: both smoking, neither on fire.
    const each = crashDamage(23.8, 11.9, 11.9);
    expect(each).toBeLessThan(100 * 0.42);
    // Ramming a parked car: it takes the full hit, the rammer 30% of it.
    const rammed = crashDamage(20, 0, 20);
    const rammer = crashDamage(20, 20, 0);
    expect(rammed).toBeCloseTo(impactDamage(20));
    expect(rammer).toBeCloseTo(impactDamage(20) * 0.3);
    // A 13 m/s shunt costs a sports car well under a third of its health.
    expect(crashDamage(13, 0, 13) / 90).toBeLessThan(0.3);
    // Heavier takes less.
    expect(crashDamage(20, 10, 10, 1.6, 0.85)).toBeLessThan(crashDamage(20, 10, 10, 0.85, 1.6));
  });

  it("the player's own car lasts several big smashes (it's what the game scores)", () => {
    // A 21 m/s wall hit costs a sports car (90 HP) about a quarter, not 43%.
    expect((impactDamage(21) * PLAYER_CRASH_SHARE) / 90).toBeLessThan(0.3);
    // Ramming a parked car at 28 m/s: the victim smokes, the player's car shrugs.
    const victim = createDamage(100);
    applyDamage(victim, crashDamage(28, 0, 28));
    expect(damageStage(victim)).toBe('smoking');
    expect(crashDamage(28, 28, 0) * PLAYER_CRASH_SHARE).toBeLessThan(15);
    // Two 28 m/s head-ons into buildings and a sedan still isn't on fire; six rams of parked cars neither.
    const own = createDamage(100);
    for (let i = 0; i < 2; i++) applyDamage(own, impactDamage(28) * PLAYER_CRASH_SHARE);
    expect(own.burning).toBe(false);
    const rammer = createDamage(100);
    for (let i = 0; i < 6; i++) applyDamage(rammer, crashDamage(28, 28, 0) * PLAYER_CRASH_SHARE);
    expect(rammer.burning).toBe(false);
  });

  it('a blast close by sets a car alight on a short fuse', () => {
    const d = createDamage(100);
    ignite(d, 1.5);
    expect(d.burning).toBe(true);
    let t = 0;
    while (!stepDamage(d, 1 / 60)) t += 1 / 60;
    expect(t).toBeCloseTo(1.5, 1);
  });

  it('hard landings hurt, ordinary hops do not', () => {
    expect(landingDamage(8)).toBe(0);
    expect(landingDamage(16)).toBeGreaterThan(10);
    expect(landingDamage(16)).toBeLessThan(25);
  });

  it('goes ok → smoking → burning → explodes → wrecked', () => {
    const d = createDamage(100);
    expect(damageStage(d)).toBe('ok');
    applyDamage(d, 45);
    expect(damageStage(d)).toBe('smoking');
    applyDamage(d, 35);
    expect(damageStage(d)).toBe('burning');

    let exploded = 0;
    let seconds = 0;
    for (let i = 0; i < 60 * 20; i++) {
      if (stepDamage(d, 1 / 60)) {
        exploded++;
        seconds = i / 60;
      }
    }
    expect(exploded).toBe(1); // exactly once
    expect(seconds).toBeGreaterThan(2); // time to bail out
    expect(seconds).toBeLessThan(6);
    expect(damageStage(d)).toBe('wrecked');
  });

  it('wrecks take no further damage', () => {
    const d = createDamage(50);
    applyDamage(d, 50);
    stepDamage(d, 0.1);
    expect(d.wrecked).toBe(true);
    applyDamage(d, 10);
    expect(d.health).toBe(0);
    expect(stepDamage(d, 1)).toBe(false);
  });

  it('remembers who hurt it, for a while', () => {
    const d = createDamage(100);
    expect(blamesPlayer(d, 0)).toBe(false);
    markPlayerHit(d, 12);
    expect(blamesPlayer(d, 12 + ATTRIBUTION_SECONDS - 0.1)).toBe(true);
    expect(blamesPlayer(d, 12 + ATTRIBUTION_SECONDS + 0.1)).toBe(false);
  });

  it('blast damage falls off with distance', () => {
    expect(blastDamage(0)).toBe(85);
    expect(blastDamage(4.5)).toBeCloseTo(42.5);
    expect(blastDamage(20)).toBe(0);
    // Rockets hit hardest and furthest, grenades in between.
    expect(BLASTS.rocket.carDamage).toBeGreaterThan(BLASTS.grenade.carDamage);
    expect(BLASTS.grenade.carDamage).toBeGreaterThan(BLASTS.car.carDamage);
    expect(BLASTS.rocket.radius).toBeGreaterThan(BLASTS.car.radius);
  });
});

describe('crash damage in the physics loop', () => {
  it('a head-on wall hit at speed wrecks a good chunk of health', async () => {
    const { SEDAN, createVehicleState, stepVehicle } = await import('../src/entities/vehicle');
    const { collideVehicleStatic } = await import('../src/systems/physics');
    const { StaticGrid } = await import('../src/world/collision');
    const grid = new StaticGrid([{ minX: -50, minZ: -60, maxX: 50, maxZ: -50 }]);
    const s = createVehicleState(0, 0); // facing -Z, toward the wall
    const d = createDamage(100);
    for (let i = 0; i < 60 * 6; i++) {
      stepVehicle(s, { throttle: 1, steer: 0, handbrake: false }, SEDAN, 1 / 60);
      applyDamage(d, impactDamage(collideVehicleStatic(s, grid)));
    }
    expect(d.health).toBeLessThan(60); // at least smoking
  });
});
