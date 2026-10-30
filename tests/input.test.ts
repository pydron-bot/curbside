import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input, STICK_DEADZONE, radialDeadzone } from '../src/core/input';

/** A window stand-in: Input only needs addEventListener. */
function fakeWindow() {
  const target = new EventTarget();
  const send = (type: string, props: Record<string, unknown> = {}) =>
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { repeat: false, shiftKey: false, ...props }));
  return { win: target as unknown as Window, send };
}

type Pad = { connected: boolean; axes: number[]; buttons: Array<{ pressed: boolean; value: number }> };
function fakePad(): Pad {
  return { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
}
function usePad(pad: Pad | null) {
  vi.stubGlobal('navigator', { getGamepads: () => [pad] });
}

afterEach(() => vi.unstubAllGlobals());

describe('input', () => {
  it('radial deadzone reads zero inside and ramps from zero outside', () => {
    const out = { x: 1, y: 1 };
    radialDeadzone(0.1, 0.05, STICK_DEADZONE, out);
    expect(out).toEqual({ x: 0, y: 0 });
    radialDeadzone(STICK_DEADZONE + 0.01, 0, STICK_DEADZONE, out);
    expect(out.x).toBeGreaterThan(0);
    expect(out.x).toBeLessThan(0.02); // no jump at the edge
    radialDeadzone(1, 0, STICK_DEADZONE, out);
    expect(out.x).toBeCloseTo(1);
  });

  it('counts each key press once and ignores auto-repeat', () => {
    const { win, send } = fakeWindow();
    const input = new Input(win);
    send('keydown', { code: 'KeyE' });
    send('keydown', { code: 'KeyE', repeat: true });
    expect(input.consumeAction()).toBe(true);
    expect(input.consumeAction()).toBe(false);
    send('keydown', { code: 'KeyP' });
    send('keydown', { code: 'KeyP', repeat: true });
    expect(input.consumePause()).toBe(1);
    expect(input.consumePause()).toBe(0);
  });

  it('resetAll drops pending presses and held keys until they are pressed afresh', () => {
    const { win, send } = fakeWindow();
    const input = new Input(win);
    send('keydown', { code: 'KeyW' });
    send('keydown', { code: 'Space' });
    send('keydown', { code: 'KeyE' });
    expect(input.readVehicle().throttle).toBe(1);
    input.resetAll();
    expect(input.consumeAction()).toBe(false);
    expect(input.readVehicle().throttle).toBe(0);
    expect(input.fireHeld).toBe(false);
    // Auto-repeat from the still-held key doesn't bring it back...
    send('keydown', { code: 'KeyW', repeat: true });
    expect(input.readVehicle().throttle).toBe(0);
    // ...a real release and press does.
    send('keyup', { code: 'KeyW' });
    send('keydown', { code: 'KeyW' });
    expect(input.readVehicle().throttle).toBe(1);
  });

  it('runs reset hooks (touch controls release their buttons)', () => {
    const { win } = fakeWindow();
    const input = new Input(win);
    const hook = vi.fn();
    input.addResetHook(hook);
    input.touch.throttle = 1;
    input.resetAll();
    expect(hook).toHaveBeenCalledOnce();
    expect(input.touch.throttle).toBe(0);
  });

  it('a foot/car switch stops Space from turning handbrake into gunfire', () => {
    const { win, send } = fakeWindow();
    const input = new Input(win);
    send('keydown', { code: 'KeyW' });
    send('keydown', { code: 'Space' }); // handbrake in the car
    input.consumePunch();
    input.resetActions(); // got out
    expect(input.fireHeld).toBe(false);
    expect(input.consumePunch()).toBe(false);
    send('keydown', { code: 'Space', repeat: true });
    expect(input.fireHeld).toBe(false);
    expect(input.readMove().y).toBe(1); // still walking
  });

  it('Shift+Tab / LB cycle backwards, Tab / RB forwards', () => {
    const { win, send } = fakeWindow();
    const input = new Input(win);
    send('keydown', { code: 'Tab', shiftKey: true });
    expect(input.consumeCycle()).toBe(-1);
    send('keydown', { code: 'Tab' });
    expect(input.consumeCycle()).toBe(1);
    expect(input.consumeCycle()).toBe(0);

    const pad = fakePad();
    usePad(pad);
    pad.buttons[4].pressed = true; // LB
    input.pollGamepad();
    expect(input.consumeCycle()).toBe(-1);
    pad.buttons[4].pressed = false;
    pad.buttons[5].pressed = true; // RB
    input.pollGamepad();
    input.pollGamepad(); // held: still one press
    expect(input.consumeCycle()).toBe(1);
    expect(input.consumeCycle()).toBe(0);
  });

  it('gamepad fire is released when the pad disconnects mid-press', () => {
    const { win } = fakeWindow();
    const input = new Input(win);
    const pad = fakePad();
    usePad(pad);
    pad.buttons[2].pressed = true; // X
    input.pollGamepad();
    expect(input.fireHeld).toBe(true);
    usePad(null);
    input.pollGamepad();
    expect(input.fireHeld).toBe(false);
  });

  it('Start toggles pause; held buttons must be released after a reset', () => {
    const { win } = fakeWindow();
    const input = new Input(win);
    const pad = fakePad();
    usePad(pad);
    pad.buttons[9].pressed = true;
    input.pollGamepad();
    expect(input.consumePause()).toBe(1);
    pad.buttons[2].pressed = true; // X held through the pause
    input.resetAll();
    input.pollGamepad();
    expect(input.fireHeld).toBe(false);
    expect(input.consumePunch()).toBe(false);
    pad.buttons[2].pressed = false;
    input.pollGamepad();
    pad.buttons[2].pressed = true;
    input.pollGamepad();
    expect(input.fireHeld).toBe(true);
    expect(input.consumePunch()).toBe(true);
    expect(input.lastDevice).toBe('gamepad');
  });

  it('a pad connected after a reset counts the press that woke it', () => {
    const { win } = fakeWindow();
    const input = new Input(win);
    usePad(null);
    input.resetAll();
    input.pollGamepad();
    const pad = fakePad();
    pad.buttons[9].pressed = true;
    usePad(pad);
    input.pollGamepad();
    expect(input.consumePause()).toBe(1);
  });

  it('starts on touch on phones and tablets (prompts before the first tap)', () => {
    const { win } = fakeWindow();
    expect(new Input(win).lastDevice).toBe('keyboard');
    const coarse = Object.assign(win, { matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }) });
    expect(new Input(coarse).lastDevice).toBe('touch');
  });

  it('a drifting stick does not steal the prompts from the keyboard', () => {
    const { win, send } = fakeWindow();
    const input = new Input(win);
    const pad = fakePad();
    usePad(pad);
    pad.axes[0] = 0.6; // pushed: the pad is in use
    input.pollGamepad();
    expect(input.lastDevice).toBe('gamepad');
    pad.axes[0] = 0.3; // let go, but it rests off centre
    input.pollGamepad();
    send('keydown', { code: 'KeyW' });
    for (let i = 0; i < 10; i++) input.pollGamepad();
    expect(input.lastDevice).toBe('keyboard');
    pad.buttons[0].pressed = true; // a real press takes it back
    input.pollGamepad();
    expect(input.lastDevice).toBe('gamepad');
  });

  it('uses a rescaled radial deadzone on the stick', () => {
    const { win } = fakeWindow();
    const input = new Input(win);
    const pad = fakePad();
    usePad(pad);
    pad.axes[0] = 0.12; // inside the deadzone
    input.pollGamepad();
    expect(input.readVehicle().steer).toBe(0);
    pad.axes[0] = 0.2;
    input.pollGamepad();
    expect(input.readVehicle().steer).toBeGreaterThan(0);
    expect(input.readVehicle().steer).toBeLessThan(0.1);
  });
});
