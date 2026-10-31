/**
 * TOUCH TUNING on the Diagnostics sheet: a −/+ stepper per touch-feel value
 * (core/touchTuning.ts) and RESET. Changes apply at once and are saved; the
 * report carries the ones that differ from the defaults, ready to bake in.
 * Tune, close the sheet, resume and drive, then pause and adjust again.
 */
import { TUNE_SPECS, formatTune, resetTune, stepTune, tuneValue, type TuneKey } from '../core/touchTuning';
import type { MenuNav } from './menu';

export class TuningProbe {
  readonly el: HTMLElement;
  private readonly values = new Map<TuneKey, HTMLElement>();

  constructor(nav: MenuNav) {
    this.el = document.createElement('section');
    this.el.className = 'diag-probes diag-tune';
    this.el.innerHTML = `<h3>TOUCH TUNING</h3><div class="diag-tune-grid"></div><div class="diag-pads"></div>`;
    const grid = this.el.querySelector('.diag-tune-grid')!;
    const button = (parent: Element, label: string, aria: string, activate: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'tab diag-pad';
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      parent.append(b);
      nav.add({ el: b, activate });
      return b;
    };
    for (const s of TUNE_SPECS) {
      const name = document.createElement('span');
      name.textContent = s.label;
      grid.append(name);
      button(grid, '−', `${s.label} down`, () => this.step(s.key, -1));
      const v = document.createElement('b');
      grid.append(v);
      this.values.set(s.key, v);
      button(grid, '+', `${s.label} up`, () => this.step(s.key, 1));
    }
    button(this.el.querySelector('.diag-pads')!, 'RESET', 'Reset touch tuning', () => {
      resetTune();
      this.show();
    });
    this.show();
  }

  /** The sheet opened: show the current values. */
  show(): void {
    for (const [key, el] of this.values) el.textContent = formatTune(key, tuneValue(key));
  }

  private step(key: TuneKey, dir: 1 | -1): void {
    stepTune(key, dir);
    this.values.get(key)!.textContent = formatTune(key);
  }
}
