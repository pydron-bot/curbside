import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_SECONDS,
  applyDamage,
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
    expect(impactDamage(3)).toBe(0);
    expect(impactDamage(14)).toBeGreaterThan(40);
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
    expect(blastDamage(0)).toBe(70);
    expect(blastDamage(4.5)).toBeCloseTo(35);
    expect(blastDamage(20)).toBe(0);
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
