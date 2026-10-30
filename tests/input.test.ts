import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input, STICK_DEADZONE, radialDeadzone } from '../src/core/input';
import { updateSettings } from '../src/core/settings';
import { createVehicleState } from '../src/entities/vehicle';

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
  it('queues menu navigation from keys (arrows repeat, confirm does not) and the pad (with hold-repeat)', () => {
    const { win, send } = fakeWindow();
    const input = new Input(win);
    send('keydown', { code: 'ArrowDown' });
    send('keydown', { code: 'ArrowDown', repeat: true });
    send('keydown', { code: 'Enter' });
    send('keydown', { code: 'Enter', repeat: true });
    send('keydown', { code: 'Backspace' });
    expect([input.consumeNav(), input.consumeNav(), input.consumeNav(), input.consumeNav(), input.consumeNav()]).toEqual([
      'down',
      'down',
      'confirm',
      'back',
      null,
    ]);
    const pad = fakePad();
    usePad(pad);
    pad.buttons[13].pressed = true; // D-pad down
    input.pollGamepad(0);
    input.pollGamepad(100); // held, before the repeat delay
    input.pollGamepad(500); // repeats
    expect([input.consumeNav(), input.consumeNav(), input.consumeNav()]).toEqual(['down', 'down', null]);
    pad.buttons[13].pressed = false;
    pad.axes[0] = -0.9; // the stick navigates too
    input.pollGamepad(600);
    pad.buttons[1].pressed = true; // B
    input.pollGamepad(610);
    expect([input.consumeNav(), input.consumeNav()]).toEqual(['left', 'back']);
    input.resetAll();
    expect(input.consumeNav()).toBe(null);
  });

  it('A confirms in menus while still being handbrake; Start is a pause toggle, not a nav command', () => {
    const { win } = fakeWindow();
    const input = new Input(win);
    const pad = fakePad();
    usePad(pad);
    pad.buttons[0].pressed = true;
    input.pollGamepad();
    expect(input.consumeNav()).toBe('confirm');
    expect(input.readVehicle().handbrake).toBe(true);
    pad.buttons[9].pressed = true;
    input.pollGamepad();
    expect(input.consumeNav()).toBe(null);
    expect(input.consumePause()).toBe(1);
  });

  it('the right stick aims and RT fires on foot; RT held through a car exit does not fire', () => {
    const { win } = fakeWindow();
    const input = new Input(win);
    const pad = fakePad();
    usePad(pad);
    pad.axes[2] = 0.9;
    pad.axes[3] = -0.1;
    input.pollGamepad();
    const aim = input.readAim();
    expect(aim.active).toBe(true);
    expect(aim.x).toBeGreaterThan(0.8);
    expect(aim.y).toBeGreaterThan(0); // stick up is screen-up
    expect(aim.fire).toBe(false); // the pad fires with RT, not by aiming
    pad.buttons[7] = { pressed: true, value: 1 };
    input.pollGamepad();
    expect(input.consumePunch()).toBe(true);
    expect(input.fireHeld).toBe(true);
    input.resetActions(); // got out of the car with RT still down
    input.pollGamepad();
    expect(input.fireHeld).toBe(false);
    pad.axes[2] = pad.axes[3] = 0;
    input.pollGamepad();
    expect(input.readAim().active).toBe(false);
  });

  it('touch aim comes from the aim stick and fires twin-stick style', () => {
    const { win } = fakeWindow();
    const coarse = Object.assign(win, { matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }) });
    const input = new Input(coarse);
    input.touch.aimX = 0.6;
    input.touch.aimY = 0.6;
    input.touch.aimFire = true;
    const aim = input.readAim();
    expect(aim).toMatchObject({ active: true, fire: true });
    input.resetAll();
    expect(input.readAim().active).toBe(false);
  });

  it('mouse: left button fires (and holds), right button and wheel switch weapon, aim goes stale', () => {
    const { win } = fakeWindow();
    const input = new Input(win);
    const canvas = new EventTarget() as unknown as HTMLElement;
    let t = 1000;
    input.attachMouse(canvas, () => t);
    const fire = (type: string, props: Record<string, unknown>) =>
      canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerType: 'mouse', clientX: 0, clientY: 0, ...props }));
    fire('pointermove', { clientX: 300, clientY: 200 });
    expect(input.mousePosition).toEqual({ x: 300, y: 200 });
    expect(input.mouseAimLive(t)).toBe(true);
    input.mouse.aimX = 1; // written each frame by mouseAim.ts
    expect(input.readAim(t).active).toBe(true);
    fire('pointerdown', { button: 0, clientX: 300, clientY: 200 });
    expect(input.consumePunch()).toBe(true);
    expect(input.fireHeld).toBe(true);
    win.dispatchEvent(Object.assign(new Event('pointerup'), { pointerType: 'mouse', button: 0 }));
    expect(input.fireHeld).toBe(false);
    fire('pointerdown', { button: 2 });
    expect(input.consumeCycle()).toBe(1);
    fire('wheel', { deltaY: -100 });
    expect(input.consumeCycle()).toBe(-1);
    fire('wheel', { deltaY: -100 }); // too soon after the last notch
    expect(input.consumeCycle()).toBe(0);
    t += 10_000; // untouched for a while: a resting cursor stops aiming
    expect(input.mouseAimLive(t)).toBe(false);
    expect(input.readAim(t).active).toBe(false);
  });

  it('directional touch steering applies only with a car and in directional mode', () => {
    const { win } = fakeWindow();
    const input = new Input(win);
    const car = createVehicleState(0, 0, 0); // facing down-screen
    car.vz = 10;
    input.touch.moveX = 1; // stick right
    input.touch.steer = 1; // the classic reading of the same stick
    updateSettings({ steering: 'directional' });
    // Heading +X from +Z is a heading increase, which needs negative steer.
    expect(input.readVehicle(car).steer).toBeLessThan(0);
    expect(input.readVehicle(car).throttle).toBeGreaterThan(0); // auto-gas
    updateSettings({ steering: 'classic' });
    expect(input.readVehicle(car).steer).toBe(1);
    updateSettings({ steering: 'directional' });
    expect(input.readVehicle().steer).toBe(1); // no car: classic
  });
});
