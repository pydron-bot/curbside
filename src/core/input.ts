import type { VehicleControls } from '../entities/vehicle';

/**
 * One input abstraction over keyboard, touch and gamepad. Every source writes
 * into its own slot; `read()` merges them so whichever device is in use wins.
 */
export interface InputSource {
  /** Analog steer -1..1 */
  steer: number;
  /** Analog throttle -1..1 (negative = brake/reverse) */
  throttle: number;
  handbrake: boolean;
}

const emptySource = (): InputSource => ({ steer: 0, throttle: 0, handbrake: false });

export class Input {
  readonly keyboard = emptySource();
  readonly touch = emptySource();
  readonly gamepad = emptySource();
  private keys = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (isGameKey(e.code)) e.preventDefault();
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
    this.keyboard.steer = (right ? 1 : 0) - (left ? 1 : 0);
    this.keyboard.throttle = (up ? 1 : 0) - (down ? 1 : 0);
    this.keyboard.handbrake = k.has('Space');
  }

  /** Call once per frame before `read()`. */
  pollGamepad(): void {
    const g = this.gamepad;
    g.steer = 0;
    g.throttle = 0;
    g.handbrake = false;
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const x = pad.axes[0] ?? 0;
      g.steer = Math.abs(x) > 0.15 ? x : 0;
      // Standard mapping: 7 = RT, 6 = LT, 0 = A
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      g.throttle = rt - lt;
      g.handbrake = pad.buttons[0]?.pressed ?? false;
      break;
    }
  }

  read(): VehicleControls {
    const sources = [this.keyboard, this.touch, this.gamepad];
    return {
      steer: strongest(sources.map((s) => s.steer)),
      throttle: strongest(sources.map((s) => s.throttle)),
      handbrake: sources.some((s) => s.handbrake),
    };
  }
}

function strongest(values: number[]): number {
  return values.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);
}

function isGameKey(code: string): boolean {
  return code.startsWith('Arrow') || code === 'Space';
}
