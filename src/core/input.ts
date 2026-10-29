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
}

export const emptySource = (): InputSource => ({
  steer: 0,
  throttle: 0,
  handbrake: false,
  moveX: 0,
  moveY: 0,
  sprint: false,
  actionPresses: 0,
});

export class Input {
  readonly keyboard = emptySource();
  readonly touch = emptySource();
  readonly gamepad = emptySource();
  private keys = new Set<string>();
  private padActionWasDown = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (isGameKey(e.code)) e.preventDefault();
      if (!e.repeat && (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Enter')) {
        this.keyboard.actionPresses++;
      }
      this.keys.add(e.code);
      this.updateKeyboard();
    });
    target.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.updateKeyboard();
    });
    // Losing focus while a key is held would otherwise leave it stuck.
    target.addEventListener('blur', () => {
      this.keys.clear();
      this.updateKeyboard();
    });
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
  }

  /** Call once per frame before reading. */
  pollGamepad(): void {
    const g = this.gamepad;
    g.steer = g.throttle = g.moveX = g.moveY = 0;
    g.handbrake = g.sprint = false;
    const pad = (navigator.getGamepads?.() ?? []).find((p) => p);
    if (!pad) return;
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    const live = Math.hypot(x, y) > 0.15;
    g.steer = Math.abs(x) > 0.15 ? x : 0;
    g.moveX = live ? x : 0;
    g.moveY = live ? -y : 0;
    // Standard mapping: 7 = RT, 6 = LT, 0 = A, 3 = Y
    g.throttle = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
    g.handbrake = g.sprint = pad.buttons[0]?.pressed ?? false;
    const action = pad.buttons[3]?.pressed ?? false;
    if (action && !this.padActionWasDown) g.actionPresses++;
    this.padActionWasDown = action;
  }

  readVehicle(): VehicleControls {
    const sources = [this.keyboard, this.touch, this.gamepad];
    return {
      steer: strongest(sources.map((s) => s.steer)),
      throttle: strongest(sources.map((s) => s.throttle)),
      handbrake: sources.some((s) => s.handbrake),
    };
  }

  readMove(): MoveInput {
    // Take the whole vector from the most-deflected source so diagonals stay intact.
    let best = this.keyboard;
    for (const s of [this.touch, this.gamepad]) {
      if (Math.hypot(s.moveX, s.moveY) > Math.hypot(best.moveX, best.moveY)) best = s;
    }
    const sprint = [this.keyboard, this.touch, this.gamepad].some((s) => s.sprint);
    return { x: best.moveX, y: best.moveY, sprint };
  }

  /** True once per enter/exit press from any device. */
  consumeAction(): boolean {
    let pressed = false;
    for (const s of [this.keyboard, this.touch, this.gamepad]) {
      if (s.actionPresses > 0) pressed = true;
      s.actionPresses = 0;
    }
    return pressed;
  }
}

function strongest(values: number[]): number {
  return values.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);
}

function isGameKey(code: string): boolean {
  return code.startsWith('Arrow') || code === 'Space';
}
