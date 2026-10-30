import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvent } from '../src/core/events';
import { NITRO_MIN, NITRO_SECONDS, NITRO_START, Nitro } from '../src/game/nitro';

describe('nitro', () => {
  const car = { x: 3, z: 4 };
  it('burns while held, announces start and stop, and runs dry', () => {
    const bus = new EventBus();
    const log: GameEvent[] = [];
    bus.onAny((e) => log.push(e));
    const n = new Nitro(bus);
    n.add(1);
    expect(n.step(1 / 60, true, car)).toBe(true);
    expect(log).toEqual([{ type: 'boost', on: true, x: 3, z: 4 }]);
    let t = 0;
    while (n.step(1 / 60, true, car)) t += 1 / 60;
    expect(t).toBeCloseTo(NITRO_SECONDS, 1);
    expect(n.charge).toBe(0);
    expect(log.at(-1)).toMatchObject({ type: 'boost', on: false });
  });

  it('needs a little in the tank to light, never burns on foot, and refills', () => {
    const n = new Nitro(new EventBus());
    n.charge = NITRO_MIN * 0.5;
    expect(n.step(1 / 60, true, car)).toBe(false);
    n.add(NITRO_MIN);
    expect(n.step(1 / 60, true, null)).toBe(false);
    expect(n.step(1 / 60, true, car)).toBe(true);
    n.add(5);
    expect(n.charge).toBe(1);
    n.reset();
    expect(n.charge).toBe(NITRO_START);
    expect(n.boosting).toBe(false);
  });
});
