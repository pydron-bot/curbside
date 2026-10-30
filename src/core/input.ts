import type { MoveInput } from '../entities/pedestrian';
import type { VehicleControls } from '../entities/vehicle';

/**
 * One input abstraction over keyboard, touch and gamepad. Every source writes
 * into its own slot; reads merge them so whichever device is in use wins.
 */
export interface InputSource {
  /** Driving: analog steer -1..1 */
  steer: number;
  /** Driving: analog throttle -1..1 (negative = brake/reverse) */
  throttle: number;
  handbrake: boolean;
  /** On foot: screen-relative movement, -1..1 each (y = screen-up). */
  moveX: number;
  moveY: number;
  sprint: boolean;
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
  /** "Confirm" presses (gamepad A), used to resume from the pause screen. */
  confirmPresses: number;
}

export type InputDevice = 'keyboard' | 'touch' | 'gamepad';

export const emptySource = (): InputSource => ({
  steer: 0,
  throttle: 0,
  handbrake: false,
  moveX: 0,
  moveY: 0,
  sprint: false,
  actionPresses: 0,
  punchPresses: 0,
  fireHeld: false,
  cyclePresses: 0,
  cyclePrevPresses: 0,
  pausePresses: 0,
  confirmPresses: 0,
});

/** Clear a source back to "nothing held, nothing pending". */
export function clearSource(s: InputSource): void {
  s.steer = s.throttle = s.moveX = s.moveY = 0;
  s.handbrake = s.sprint = s.fireHeld = false;
  s.actionPresses = s.punchPresses = s.cyclePresses = s.cyclePrevPresses = s.pausePresses = s.confirmPresses = 0;
}

/** Stick deadzone, as a fraction of full deflection (radial, then rescaled). */
export const STICK_DEADZONE = 0.15;

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
const PAD_X = 2;
const PAD_Y = 3;
const PAD_LB = 4;
const PAD_RB = 5;
const PAD_LT = 6;
const PAD_RT = 7;
const PAD_START = 9;
const PAD_BUTTONS = 17;

/** Keys that are "held actions" rather than movement: cleared on a foot/car switch. */
const ACTION_KEYS = ['Space', 'KeyJ'];

type PressKey = 'punchPresses' | 'cyclePresses' | 'cyclePrevPresses' | 'actionPresses' | 'pausePresses' | 'confirmPresses';

export class Input {
  readonly keyboard = emptySource();
  readonly touch = emptySource();
  readonly gamepad = emptySource();
  private readonly sources: InputSource[] = [this.keyboard, this.touch, this.gamepad];
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
  private readonly vehicleOut: VehicleControls = { steer: 0, throttle: 0, handbrake: false };
  private readonly moveOut: MoveInput = { x: 0, y: 0, sprint: false };
  private device: InputDevice = 'keyboard';

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      this.device = 'keyboard';
      if (isGameKey(e.code)) e.preventDefault();
      if (e.code === 'KeyQ' || e.code === 'Tab') e.preventDefault();
      if (e.repeat && this.suppressedKeys.has(e.code)) return;
      this.suppressedKeys.delete(e.code);
      if (!e.repeat) {
        const kb = this.keyboard;
        if (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Enter') kb.actionPresses++;
        if (e.code === 'Space' || e.code === 'KeyJ') kb.punchPresses++;
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
    target.addEventListener('gamepaddisconnected', () => {
      clearSource(this.gamepad);
      this.padWasDown.fill(false);
      this.padLatched.fill(false);
    });
  }

  /** The device the player used last, for prompts ("tap" vs "press P"). */
  get lastDevice(): InputDevice {
    return this.device;
  }

  /** Run `fn` on every resetAll(), e.g. to release on-screen buttons. */
  addResetHook(fn: () => void): void {
    this.resetHooks.push(fn);
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
      s.fireHeld = false;
    }
    this.padLatched[PAD_A] = this.padLatched[PAD_X] = true;
    this.gamepad.handbrake = this.gamepad.sprint = false;
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
    kb.fireHeld = k.has('Space') || k.has('KeyJ');
  }

  /** Call once per frame before reading (also while paused, to catch Start). */
  pollGamepad(): void {
    const g = this.gamepad;
    g.steer = g.throttle = g.moveX = g.moveY = 0;
    g.handbrake = g.sprint = g.fireHeld = false;
    const pad = firstPad();
    if (!pad) {
      // Disconnected mid-press: nothing may stay held.
      this.padWasDown.fill(false);
      return;
    }
    radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEADZONE, this.stick);
    g.steer = g.moveX = this.stick.x;
    g.moveY = -this.stick.y;
    g.throttle = (pad.buttons[PAD_RT]?.value ?? 0) - (pad.buttons[PAD_LT]?.value ?? 0);
    if (Math.abs(g.throttle) < 0.05) g.throttle = 0;

    let active = this.stick.x !== 0 || this.stick.y !== 0 || g.throttle !== 0;
    const n = Math.min(PAD_BUTTONS, pad.buttons.length);
    for (let i = 0; i < n; i++) {
      const raw = pad.buttons[i]?.pressed ?? false;
      if (!raw) this.padLatched[i] = false;
      const down = raw && !this.padLatched[i];
      const edge = down && !this.padWasDown[i];
      this.padWasDown[i] = down;
      if (!down) continue;
      active = true;
      if (i === PAD_A) g.handbrake = g.sprint = true;
      else if (i === PAD_X) g.fireHeld = true;
      if (!edge) continue;
      if (i === PAD_Y) g.actionPresses++;
      else if (i === PAD_X) g.punchPresses++;
      else if (i === PAD_RB) g.cyclePresses++;
      else if (i === PAD_LB) g.cyclePrevPresses++;
      else if (i === PAD_START) g.pausePresses++;
      else if (i === PAD_A) g.confirmPresses++;
    }
    if (active) this.device = 'gamepad';
  }

  /** Merged driving controls. The returned object is reused between calls. */
  readVehicle(): VehicleControls {
    const out = this.vehicleOut;
    out.steer = out.throttle = 0;
    out.handbrake = false;
    for (const s of this.sources) {
      if (Math.abs(s.steer) > Math.abs(out.steer)) out.steer = s.steer;
      if (Math.abs(s.throttle) > Math.abs(out.throttle)) out.throttle = s.throttle;
      if (s.handbrake) out.handbrake = true;
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

  /** True once per punch press from any device. */
  consumePunch(): boolean {
    return this.drain('punchPresses') > 0;
  }

  get fireHeld(): boolean {
    return this.keyboard.fireHeld || this.touch.fireHeld || this.gamepad.fireHeld;
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

  /** True once per pause toggle (P, Esc, gamepad Start). */
  consumePause(): boolean {
    return this.drain('pausePresses') > 0;
  }

  /** True once per confirm press (gamepad A). */
  consumeConfirm(): boolean {
    return this.drain('confirmPresses') > 0;
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

function firstPad(): Gamepad | null {
  const pads = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : undefined;
  if (!pads) return null;
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

function isGameKey(code: string): boolean {
  return code.startsWith('Arrow') || code === 'Space';
}
