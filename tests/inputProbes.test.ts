import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import type { Input } from '../src/core/input';
import { Haptics } from '../src/ui/haptics';
import { padLines } from '../src/ui/inputProbes';

const button = (pressed: boolean, value = pressed ? 1 : 0) => ({ pressed, touched: pressed, value });

describe('input probes', () => {
  it('reads out each pad: id, mapping, pressed buttons, axes and triggers', () => {
    const buttons = Array.from({ length: 17 }, () => button(false));
    buttons[0] = button(true);
    buttons[7] = button(true, 0.75);
    const pad = { index: 0, id: 'Xbox Wireless Controller', mapping: 'standard', buttons, axes: [0, -0.5, 0.25, 1] } as unknown as Gamepad;
    expect(padLines([null, pad])).toBe(
      'PAD 0 Xbox Wireless Controller\n  standard · 17 buttons · pressed 0,7\n  axes 0.00 -0.50 0.25 1.00 · LT 0.00 RT 0.75',
    );
    expect(padLines([null, null])).toBe('PAD none connected');
  });

  it('says why a rumble probe did nothing', async () => {
    const input = { pad: null as unknown };
    const h = new Haptics(input as Input, new EventBus());
    expect(h.probeTick()).toBe(false);
    await expect(h.probeRumble()).resolves.toBe('no gamepad');
    input.pad = { vibrationActuator: null };
    await expect(h.probeRumble()).resolves.toBe('unsupported (no vibrationActuator)');
    input.pad = { vibrationActuator: { playEffect: () => Promise.resolve('complete') } };
    await expect(h.probeRumble()).resolves.toBe('resolved: complete');
    input.pad = { vibrationActuator: { playEffect: () => Promise.reject(new Error('nope')) } };
    await expect(h.probeRumble()).resolves.toBe('rejected: Error nope');
  });
});
