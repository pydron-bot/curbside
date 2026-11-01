import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { Nitro } from '../src/game/nitro';
import { BustMeter, GRAB_RANGE, GRAB_SECONDS, type ArrestSituation } from '../src/systems/arrest';
import { applyDamage, createDamage } from '../src/systems/damage';
import { Wanted, evadeSeconds } from '../src/systems/wanted';

// The knobs the perks turn (game/credKeeper.ts sets them every step): 1 is
// no change, so everything without a perk plays exactly as before.
const DT = 1 / 60;

describe('perk hooks', () => {
  it('NITRO JUNKIE: gains are multiplied by fill', () => {
    const n = new Nitro(new EventBus());
    n.charge = 0;
    n.add(0.1);
    expect(n.charge).toBeCloseTo(0.1);
    n.fill = 1.5;
    n.add(0.1);
    expect(n.charge).toBeCloseTo(0.25);
    n.add(5);
    expect(n.charge).toBe(1);
  });

  it('SLIPPERY: a grab takes slow × as long', () => {
    const s: ArrestSituation = { stars: 1, onFoot: true, speed: 0, stunned: false, copDistance: GRAB_RANGE - 0.2, copCarTouching: false, copAtDoor: false };
    const bust = (slow: number) => {
      const m = new BustMeter();
      m.slow = slow;
      for (let t = 0; t < 10; t += DT) if (m.step(DT, s)) return t + DT;
      return Infinity;
    };
    expect(bust(1)).toBeCloseTo(GRAB_SECONDS, 1);
    expect(bust(1.6)).toBeCloseTo(GRAB_SECONDS * 1.6, 1);
  });

  it('GHOST: a star goes after evadeScale × the usual time unseen', () => {
    const lose = (scale: number) => {
      const w = new Wanted(new EventBus());
      w.evadeScale = scale;
      w.force(1.5);
      // Seen once (no response grace), then out of sight.
      w.step(DT, true);
      let t = 0;
      while (w.level > 0 && t < 60) {
        w.step(DT, false);
        t += DT;
      }
      return t;
    };
    expect(lose(1)).toBeCloseTo(evadeSeconds(1), 1);
    expect(lose(0.68)).toBeCloseTo(evadeSeconds(1) * 0.68, 1);
  });

  it('BODYWORK: a car with `taken` set takes that share of each hit', () => {
    const plain = createDamage(100);
    const tough = createDamage(100);
    tough.taken = 0.6;
    applyDamage(plain, 20);
    applyDamage(tough, 20);
    expect(plain.health).toBe(80);
    expect(tough.health).toBeCloseTo(88);
  });
});
