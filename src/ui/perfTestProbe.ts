/**
 * LOW POWER TESTS on the Diagnostics sheet (core/perfTests.ts): three
 * switches, each taking away one kind of processor work, saved until
 * switched back. Each change is logged, so the report's samples line up
 * with what was on.
 */
import { PERF_TEST_KEYS, perfTests, savePerfTests } from '../core/perfTests';
import type { KeyValueStore } from '../core/sessionLog';
import type { MenuNav } from './menu';

export class PerfTestProbe {
  readonly el: HTMLElement;
  private readonly pads: Array<[keyof typeof perfTests, HTMLButtonElement]> = [];

  constructor(
    nav: MenuNav,
    private readonly store: () => KeyValueStore | null,
    /** A switch changed: what's on now ('' none). */
    private readonly changed: () => void,
  ) {
    this.el = document.createElement('section');
    this.el.className = 'diag-probes diag-perftests';
    this.el.innerHTML = `
      <h3>LOW POWER TESTS</h3>
      <div class="diag-pads"></div>
      <p class="diag-probe-out">Each takes away one kind of processor work; saved until switched off. SIM 1 STEP plays in slow motion below 60 fps. CROWD ½ and TRAFFIC ½ thin out as people and cars leave range: drive a block or two, or relaunch. Play ~30 s with each, then SHARE.</p>`;
    const row = this.el.querySelector('.diag-pads')!;
    for (const { key, label } of PERF_TEST_KEYS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'tab diag-pad';
      b.textContent = label;
      row.append(b);
      nav.add({
        el: b,
        activate: () => {
          perfTests[key] = !perfTests[key];
          savePerfTests(this.store());
          this.show();
          this.changed();
        },
      });
      this.pads.push([key, b]);
    }
    this.show();
  }

  show(): void {
    for (const [key, b] of this.pads) {
      b.classList.toggle('selected', perfTests[key]);
      b.setAttribute('aria-pressed', String(perfTests[key]));
    }
  }
}
