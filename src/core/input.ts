import type { MoveInput } from '../entities/pedestrian';
import type { VehicleControls, VehicleState } from '../entities/vehicle';
import type { AimState } from './aim';
import { settings } from './settings';
import { createDirectionalState, directionalControls, resetDirectionalState, type DirectionalInput } from './steering';

/**
 * One input abstraction over keyboard, mouse, touch and gamepad. Every source
 * writes into its own slot; reads merge them so whichever device is in use wins.
 */
export interface InputSource {
  /** Driving: analog steer -1..1 */
  steer: number;
  /** Driving: analog throttle -1..1 (negative = brake/reverse) */
  throttle: number;
  handbrake: boolean;
  /** On foot: screen-relative movement, -1..1 each (y = screen-up). In a car, touch's directional stick. */
  moveX: number;
  moveY: number;
  sprint: boolean;
  /** On foot: screen-relative aim (y = screen-up), length 0..1; (0, 0) = not aiming. */
  aimX: number;
  aimY: number;
  /** Twin-stick fire: the aim stick is pushed far enough to shoot. */
  aimFire: boolean;
  /** Enter/exit presses not yet consumed by the game. */
  actionPresses: number;
  /** Punch/fire presses (on foot) not yet consumed. */
  punchPresses: number;
  /** Fire button currently held (automatic weapons). */
  fireHeld: boolean;
  /** Next-weapon presses not yet consumed. */
  cyclePresses: number;
  /** Previous-weapon presses not yet consumed. */
  cyclePrevPresses: number;
  /** Pause toggles (P / Esc / gamepad Start) not yet consumed. */
  pausePresses: number;
  /** Driving: nitro held. */
  boost: boolean;
}

export type InputDevice = 'keyboard' | 'touch' | 'gamepad';

/** Menu navigation, from the keyboard or a gamepad (pointer input goes to the DOM directly). */
export type NavCommand = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

export const emptySource = (): InputSource => ({
  steer: 0,
  throttle: 0,
  handbrake: false,
  moveX: 0,
  moveY: 0,
  sprint: false,
  aimX: 0,
  aimY: 0,
  aimFire: false,
  actionPresses: 0,
  punchPresses: 0,
  fireHeld: false,
  cyclePresses: 0,
  cyclePrevPresses: 0,
  pausePresses: 0,
  boost: false,
});

/** Clear a source back to "nothing held, nothing pending". */
export function clearSource(s: InputSource): void {
  s.steer = s.throttle = s.moveX = s.moveY = s.aimX = s.aimY = 0;
  s.handbrake = s.sprint = s.fireHeld = s.aimFire = s.boost = false;
  s.actionPresses = s.punchPresses = s.cyclePresses = s.cyclePrevPresses = s.pausePresses = 0;
}

/** Stick deadzone, as a fraction of full deflection (radial, then rescaled). */
export const STICK_DEADZONE = 0.15;
/** The right (aim) stick rests less precisely: a larger deadzone. */
export const AIM_DEADZONE = 0.2;

/**
 * Radial deadzone with rescale: inside `dz` reads 0, and the output ramps from
 * 0 at the deadzone edge to 1 at full deflection, so there's no jump. Writes
 * into `out` (no allocation).
 */
export function radialDeadzone(x: number, y: number, dz: number, out: { x: number; y: number }): void {
  const mag = Math.hypot(x, y);
  if (mag <= dz) {
    out.x = out.y = 0;
    return;
  }
  const scaled = (Math.min(1, mag) - dz) / (1 - dz);
  out.x = (x / mag) * scaled;
  out.y = (y / mag) * scaled;
}

// Standard gamepad mapping.
const PAD_A = 0;
const PAD_B = 1;
const PAD_X = 2;
const PAD_Y = 3;
const PAD_LB = 4;
const PAD_RB = 5;
const PAD_LT = 6;
const PAD_RT = 7;
const PAD_START = 9;
const PAD_UP = 12;
const PAD_DOWN = 13;
const PAD_LEFT = 14;
const PAD_RIGHT = 15;
const PAD_BUTTONS = 17;
/**
 * How far the sticks/triggers must move (summed) to count as using the pad.
 * Measured from where they were last time, so a drifting stick resting off
 * centre doesn't keep claiming the player is on the pad.
 */
const PAD_ACTIVITY = 0.25;
/** Menu navigation with the stick: how far to push, and the hold-to-repeat timing (ms). */
const NAV_STICK = 0.6;
const NAV_REPEAT_DELAY = 380;
const NAV_REPEAT_EVERY = 110;
const NAV_QUEUE_MAX = 8;
/** Mouse aim stays live this long after the mouse last moved or clicked, ms. */
const MOUSE_AIM_MS = 6000;
/** The mouse must travel this far (px) to take the prompts back from a pad or touch. */
const MOUSE_CLAIM_PX = 24;
const WHEEL_EVERY_MS = 140;

/** Keys that are "held actions" rather than movement: cleared on a foot/car switch. */
const ACTION_KEYS = ['Space', 'KeyJ'];

const NAV_KEYS: Readonly<Record<string, NavCommand>> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Space: 'confirm',
  Backspace: 'back',
};

type PressKey = 'punchPresses' | 'cyclePresses' | 'cyclePrevPresses' | 'actionPresses' | 'pausePresses';

export class Input {
  readonly keyboard = emptySource();
  readonly mouse = emptySource();
  readonly touch = emptySource();
  readonly gamepad = emptySource();
  private readonly sources: InputSource[] = [this.keyboard, this.mouse, this.touch, this.gamepad];
  private keys = new Set<string>();
  /**
   * Keys held through a reset. Auto-repeat keydowns for them are ignored, so a
   * held key only counts again after it's released and pressed afresh.
   */
  private suppressedKeys = new Set<string>();
  private padWasDown: boolean[] = new Array<boolean>(PAD_BUTTONS).fill(false);
  /** Buttons that must read "released" once before they count again. */
  private padLatched: boolean[] = new Array<boolean>(PAD_BUTTONS).fill(false);
  private readonly resetHooks: Array<() => void> = [];
  private readonly stick = { x: 0, y: 0 };
  private readonly aimStick = { x: 0, y: 0 };
  private readonly vehicleOut: VehicleControls = { steer: 0, throttle: 0, handbrake: false, boost: false };
  private readonly directionalOut: VehicleControls = { steer: 0, throttle: 0, handbrake: false };
  private readonly directionalIn: DirectionalInput = { x: 0, y: 0, gas: false, brake: false, handbrake: false };
  private readonly directional = createDirectionalState();
  private readonly moveOut: MoveInput = { x: 0, y: 0, sprint: false };
  private readonly aimOut: AimState = { x: 0, y: 0, active: false, fire: false };
  /** Stick and trigger readings when the pad last counted as in use. */
  private readonly padAnchor = { x: 0, y: 0, ax: 0, ay: 0, throttle: 0 };
  private readonly navQueue: NavCommand[] = [];
  private padNav: NavCommand | null = null;
  private padNavRepeatAt = 0;
  /**
   * After a reset (pausing, opening a menu) a stick or D-pad still held from
   * play must come back to centre before it navigates: steering hard left as
   * you hit Start mustn't walk the highlight off RESUME.
   */
  private padNavLatched = false;
  private device: InputDevice;
  private readonly mousePos = { x: 0, y: 0 };
  private mouseOver = false;
  private mouseUsedAt = -Infinity;
  private mouseTravel = 0;
  private wheelAt = -Infinity;
  /**
   * In a car Space is the handbrake and RT the throttle, not fire: drive-bys
   * fire on J, the mouse, X or the touch FIRE button; Shift and B are nitro.
   */
  private driving = false;

  constructor(target: Window = window) {
    this.device = initialDevice(target);
    target.addEventListener('keydown', (e) => {
      this.device = 'keyboard';
      if (isGameKey(e.code)) e.preventDefault();
      if (e.code === 'KeyQ' || e.code === 'Tab') e.preventDefault();
      if (e.repeat && this.suppressedKeys.has(e.code)) return;
      this.suppressedKeys.delete(e.code);
      const nav = NAV_KEYS[e.code];
      // Held arrows auto-repeat through menus; confirm/back only on a fresh press.
      if (nav && (!e.repeat || (nav !== 'confirm' && nav !== 'back'))) this.pushNav(nav);
      if (!e.repeat) {
        const kb = this.keyboard;
        if (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Enter') kb.actionPresses++;
        if ((e.code === 'Space' && !this.driving) || e.code === 'KeyJ') kb.punchPresses++;
        if (e.code === 'KeyQ' || e.code === 'Tab') {
          if (e.shiftKey) kb.cyclePrevPresses++;
          else kb.cyclePresses++;
        }
        if (e.code === 'KeyP' || e.code === 'Escape') kb.pausePresses++;
      }
      this.keys.add(e.code);
      this.updateKeyboard();
    });
    target.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.suppressedKeys.delete(e.code);
      // macOS sends no keyup for keys released while Cmd is held, so they'd stick.
      if (e.code === 'MetaLeft' || e.code === 'MetaRight') this.keys.clear();
      this.updateKeyboard();
    });
    // Losing focus while a key is held would otherwise leave it stuck.
    target.addEventListener('blur', () => this.resetAll());
    target.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') this.device = 'touch';
      },
      { capture: true },
    );
    // A mouse button released anywhere (even off the canvas) stops the firing.
    target.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouse.fireHeld = false;
    });
    target.addEventListener('gamepaddisconnected', () => {
      clearSource(this.gamepad);
      this.padWasDown.fill(false);
      this.padLatched.fill(false);
      this.padNav = null;
    });
  }

  /** The device the player used last, for prompts ("tap" vs "press P"). Mouse counts as keyboard. */
  get lastDevice(): InputDevice {
    return this.device;
  }

  /** On foot or in a car: changes which keys and buttons fire (see `driving`). */
  setDriving(driving: boolean): void {
    this.driving = driving;
    this.updateKeyboard();
  }

  /** Run `fn` on every resetAll(), e.g. to release on-screen buttons. */
  addResetHook(fn: () => void): void {
    this.resetHooks.push(fn);
  }

  /**
   * Mouse play on `el` (the game canvas): the cursor aims on foot, the left
   * button fires (hold for automatics), right-click and the wheel switch weapon.
   */
  attachMouse(el: HTMLElement, now: () => number = () => performance.now()): void {
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouseTravel += Math.abs(e.clientX - this.mousePos.x) + Math.abs(e.clientY - this.mousePos.y);
      this.mousePos.x = e.clientX;
      this.mousePos.y = e.clientY;
      this.mouseOver = true;
      this.mouseUsedAt = now();
      if (this.mouseTravel > MOUSE_CLAIM_PX) {
        this.mouseTravel = 0;
        this.device = 'keyboard';
      }
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.mouseOver = false;
    });
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.device = 'keyboard';
      this.mouseOver = true;
      this.mousePos.x = e.clientX;
      this.mousePos.y = e.clientY;
      this.mouseUsedAt = now();
      if (e.button === 0) {
        this.mouse.punchPresses++;
        this.mouse.fireHeld = true;
      } else if (e.button === 2) this.mouse.cyclePresses++;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const t = now();
        if (t - this.wheelAt < WHEEL_EVERY_MS || e.deltaY === 0) return;
        this.wheelAt = t;
        this.device = 'keyboard';
        if (e.deltaY > 0) this.mouse.cyclePresses++;
        else this.mouse.cyclePrevPresses++;
      },
      { passive: false },
    );
  }

  /** Cursor position (client px), for mouse aim. */
  get mousePosition(): Readonly<{ x: number; y: number }> {
    return this.mousePos;
  }

  /**
   * The mouse is aiming: it's the device in use, over the game, and was moved
   * or clicked lately (a keyboard-only player's resting cursor doesn't steer
   * their aim).
   */
  mouseAimLive(now = performance.now()): boolean {
    return this.device === 'keyboard' && this.mouseOver && (this.mouse.fireHeld || now - this.mouseUsedAt < MOUSE_AIM_MS);
  }

  /**
   * Forget everything held or pending on every device: on blur, pause and
   * resume. Keys and buttons still physically held must be released and
   * pressed again before they count.
   */
  resetAll(): void {
    for (const code of this.keys) this.suppressedKeys.add(code);
    this.keys.clear();
    for (const s of this.sources) clearSource(s);
    this.padLatched.fill(true);
    this.padWasDown.fill(false);
    this.padNavLatched = true;
    this.navQueue.length = 0;
    resetDirectionalState(this.directional);
    for (const fn of this.resetHooks) fn();
  }

  /**
   * Switching between foot and car: drop pending presses and require a fresh
   * press of held action buttons (Space is handbrake in a car but fire on foot,
   * so holding it through the switch would otherwise start shooting).
   * Movement keys and sticks stay live.
   */
  resetActions(): void {
    for (const code of ACTION_KEYS) {
      if (this.keys.delete(code)) this.suppressedKeys.add(code);
    }
    this.updateKeyboard();
    for (const s of this.sources) {
      s.actionPresses = s.punchPresses = s.cyclePresses = s.cyclePrevPresses = 0;
      s.fireHeld = s.aimFire = false;
    }
    this.padLatched[PAD_A] = this.padLatched[PAD_X] = this.padLatched[PAD_RT] = true;
    this.gamepad.handbrake = this.gamepad.sprint = false;
    resetDirectionalState(this.directional);
  }

  private updateKeyboard(): void {
    const k = this.keys;
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const kb = this.keyboard;
    kb.steer = kb.moveX = (right ? 1 : 0) - (left ? 1 : 0);
    kb.throttle = kb.moveY = (up ? 1 : 0) - (down ? 1 : 0);
    kb.handbrake = k.has('Space');
    kb.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    kb.boost = kb.sprint;
    kb.fireHeld = (k.has('Space') && !this.driving) || k.has('KeyJ');
  }

  /** Call once per frame before reading (also while paused, to catch Start and menu navigation). */
  pollGamepad(now = performance.now()): void {
    const g = this.gamepad;
    g.steer = g.throttle = g.moveX = g.moveY = g.aimX = g.aimY = 0;
    g.handbrake = g.sprint = g.fireHeld = g.boost = false;
    const pad = firstPad();
    if (!pad) {
      // Disconnected mid-press: nothing may stay held. A pad that turns up
      // later starts fresh (it's often woken by the very press that counts).
      this.padWasDown.fill(false);
      this.padLatched.fill(false);
      this.padNav = null;
      this.padNavLatched = false;
      return;
    }
    radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEADZONE, this.stick);
    g.steer = g.moveX = this.stick.x;
    g.moveY = -this.stick.y;
    radialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, AIM_DEADZONE, this.aimStick);
    g.aimX = this.aimStick.x;
    g.aimY = -this.aimStick.y;
    g.throttle = (pad.buttons[PAD_RT]?.value ?? 0) - (pad.buttons[PAD_LT]?.value ?? 0);
    if (Math.abs(g.throttle) < 0.05) g.throttle = 0;

    const anchor = this.padAnchor;
    let active =
      Math.abs(this.stick.x - anchor.x) +
        Math.abs(this.stick.y - anchor.y) +
        Math.abs(this.aimStick.x - anchor.ax) +
        Math.abs(this.aimStick.y - anchor.ay) +
        Math.abs(g.throttle - anchor.throttle) >
      PAD_ACTIVITY;
    if (active) {
      anchor.x = this.stick.x;
      anchor.y = this.stick.y;
      anchor.ax = this.aimStick.x;
      anchor.ay = this.aimStick.y;
      anchor.throttle = g.throttle;
    }
    const n = Math.min(PAD_BUTTONS, pad.buttons.length);
    for (let i = 0; i < n; i++) {
      const raw = pad.buttons[i]?.pressed ?? false;
      if (!raw) this.padLatched[i] = false;
      const down = raw && !this.padLatched[i];
      const edge = down && !this.padWasDown[i];
      this.padWasDown[i] = down;
      if (!down) continue;
      if (edge) active = true;
      // RT is the throttle in a car: there only X fires (drive-bys) and B boosts.
      const fires = i === PAD_X || (i === PAD_RT && !this.driving);
      if (i === PAD_A) g.handbrake = g.sprint = true;
      else if (fires) g.fireHeld = true;
      else if (i === PAD_B && this.driving) g.boost = true;
      if (!edge) continue;
      if (i === PAD_Y) g.actionPresses++;
      else if (fires) g.punchPresses++;
      else if (i === PAD_RB) g.cyclePresses++;
      else if (i === PAD_LB) g.cyclePrevPresses++;
      else if (i === PAD_START) g.pausePresses++;
      else if (i === PAD_A) this.pushNav('confirm');
      else if (i === PAD_B) this.pushNav('back');
    }
    this.pollPadNav(pad, now);
    if (active) this.device = 'gamepad';
  }

  /** D-pad or left stick → menu directions, repeating while held. */
  private pollPadNav(pad: Gamepad, now: number): void {
    const b = pad.buttons;
    let dir: NavCommand | null = null;
    if (b[PAD_UP]?.pressed) dir = 'up';
    else if (b[PAD_DOWN]?.pressed) dir = 'down';
    else if (b[PAD_LEFT]?.pressed) dir = 'left';
    else if (b[PAD_RIGHT]?.pressed) dir = 'right';
    else {
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      if (Math.max(Math.abs(x), Math.abs(y)) > NAV_STICK) {
        dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
      }
    }
    if (this.padNavLatched) {
      if (dir) return;
      this.padNavLatched = false;
    }
    if (dir !== this.padNav) {
      this.padNav = dir;
      if (dir) {
        this.pushNav(dir);
        this.padNavRepeatAt = now + NAV_REPEAT_DELAY;
      }
    } else if (dir && now >= this.padNavRepeatAt) {
      this.pushNav(dir);
      this.padNavRepeatAt = now + NAV_REPEAT_EVERY;
    }
  }

  private pushNav(cmd: NavCommand): void {
    if (this.navQueue.length < NAV_QUEUE_MAX) this.navQueue.push(cmd);
  }

  /** The next menu command (keyboard or gamepad), or null. Drain it every frame, in menus or not. */
  consumeNav(): NavCommand | null {
    return this.navQueue.shift() ?? null;
  }

  /**
   * Merged driving controls for `car`. Touch in directional mode turns the
   * stick's direction into steering for this car (see core/steering.ts);
   * everything else steers left/right. `dt` is the sim step this read drives
   * (0 for an extra read, e.g. for rendering). The returned object is reused.
   */
  readVehicle(car?: VehicleState, dt = 0): VehicleControls {
    const out = this.vehicleOut;
    out.steer = out.throttle = 0;
    out.handbrake = false;
    out.boost = false;
    const directional = car !== undefined && settings.steering === 'directional';
    for (const s of this.sources) {
      if (s.boost) out.boost = true;
      if (directional && s === this.touch) continue;
      merge(out, s.steer, s.throttle, s.handbrake);
    }
    if (directional) {
      const t = this.touch;
      const inp = this.directionalIn;
      inp.x = t.moveX;
      inp.y = t.moveY;
      inp.gas = t.throttle > 0;
      inp.brake = t.throttle < 0;
      inp.handbrake = t.handbrake;
      const d = directionalControls(inp, car, this.directional, this.directionalOut, dt);
      merge(out, d.steer, d.throttle, d.handbrake);
    }
    return out;
  }

  /** Merged on-foot movement. The returned object is reused between calls. */
  readMove(): MoveInput {
    // Take the whole vector from the most-deflected source so diagonals stay intact.
    let best = this.keyboard;
    let sprint = false;
    for (const s of this.sources) {
      if (Math.hypot(s.moveX, s.moveY) > Math.hypot(best.moveX, best.moveY)) best = s;
      if (s.sprint) sprint = true;
    }
    const out = this.moveOut;
    out.x = best.moveX;
    out.y = best.moveY;
    out.sprint = sprint;
    return out;
  }

  /**
   * Where the player is aiming on foot, from the device in use: touch's aim
   * stick, the gamepad's right stick, or the mouse cursor (mouse aim is
   * written into `mouse.aimX/aimY` by the caller, who has the camera). The
   * returned object is reused.
   */
  readAim(now = performance.now()): AimState {
    const out = this.aimOut;
    out.active = out.fire = false;
    const src =
      this.device === 'touch' ? this.touch : this.device === 'gamepad' ? this.gamepad : this.mouseAimLive(now) ? this.mouse : null;
    if (src && (src.aimX !== 0 || src.aimY !== 0)) {
      out.x = src.aimX;
      out.y = src.aimY;
      out.active = true;
      out.fire = src.aimFire;
    }
    return out;
  }

  /** True once per punch press from any device. */
  consumePunch(): boolean {
    return this.drain('punchPresses') > 0;
  }

  get fireHeld(): boolean {
    return this.keyboard.fireHeld || this.mouse.fireHeld || this.touch.fireHeld || this.gamepad.fireHeld;
  }

  /** Weapon switch asked for since the last call: 1 = next, -1 = previous, 0 = none. */
  consumeCycle(): -1 | 0 | 1 {
    const next = this.drain('cyclePresses');
    const prev = this.drain('cyclePrevPresses');
    return next > 0 ? 1 : prev > 0 ? -1 : 0;
  }

  /** True once per enter/exit press from any device. */
  consumeAction(): boolean {
    return this.drain('actionPresses') > 0;
  }

  /** Pause toggles (P, Esc, gamepad Start) since the last call; two in one frame cancel out. */
  consumePause(): number {
    return this.drain('pausePresses');
  }

  /** The connected gamepad, if any (for rumble). */
  get pad(): Gamepad | null {
    return firstPad();
  }

  private drain(key: PressKey): number {
    let n = 0;
    for (const s of this.sources) {
      n += s[key];
      s[key] = 0;
    }
    return n;
  }
}

/** Keep the strongest steer and throttle; any handbrake counts. */
function merge(out: VehicleControls, steer: number, throttle: number, handbrake: boolean): void {
  if (Math.abs(steer) > Math.abs(out.steer)) out.steer = steer;
  if (Math.abs(throttle) > Math.abs(out.throttle)) out.throttle = throttle;
  if (handbrake) out.handbrake = true;
}

/**
 * Phones and tablets start on touch, so a prompt shown before the first tap
 * (paused by an app switch straight after launch) talks about tapping.
 */
function initialDevice(target: Window): InputDevice {
  try {
    return target.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'keyboard';
  } catch {
    return 'keyboard';
  }
}

function firstPad(): Gamepad | null {
  const pads = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : undefined;
  if (!pads) return null;
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

function isGameKey(code: string): boolean {
  return code.startsWith('Arrow') || code === 'Space';
}
