/**
 * GPU BREAKDOWN on the Diagnostics sheet (core/gpuBreakdown.ts has the plan
 * and the stats): ~15 s of the paused scene drawn and waited for, one part
 * left out at a time, then the cost of each part. The result goes into the
 * report (SHARE / COPY, REPORT BUG). Pause on the busy moment to measure.
 */
import { ALL, breakdownLines, GpuBreakdownRun, stepName, type GpuBreakdownResult, type GpuLayerKey } from '../core/gpuBreakdown';
import type { MenuNav } from './menu';

export interface GpuFrame {
  /** JS time of the draw, and the draw plus the wait for the GPU, ms. */
  cpu: number;
  total: number;
}

export interface GpuProbeDeps {
  /** Why it can't run now, or null. */
  blocker(): string | null;
  /** Leave one part out (null: everything back as it was). */
  setLayer(key: GpuLayerKey | null): void;
  /** Draw the paused scene once and wait for the GPU to finish it. */
  frame(out: GpuFrame): void;
  info(): { tier: string; ratio: number; dc: number };
}

export class GpuProbe {
  readonly el: HTMLElement;
  /** The last finished run (for the report), or null. */
  last: GpuBreakdownResult | null = null;
  private readonly button: HTMLButtonElement;
  private readonly outEl: HTMLElement;
  private run: GpuBreakdownRun | null = null;
  private raf = 0;
  private dc = 0;
  private readonly m: GpuFrame = { cpu: 0, total: 0 };

  constructor(
    private readonly deps: GpuProbeDeps,
    nav: MenuNav,
  ) {
    this.el = document.createElement('section');
    this.el.className = 'diag-probes diag-gpu';
    this.el.innerHTML = `
      <h3>GPU BREAKDOWN</h3>
      <div class="diag-pads"></div>
      <pre class="diag-probe-out diag-gpu-out" aria-live="polite">Pause on a busy moment, then RUN: about 15 s, the paused scene drawn with one part left out at a time.</pre>`;
    this.outEl = this.el.querySelector('.diag-gpu-out')!;
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.className = 'tab diag-pad';
    b.textContent = 'RUN';
    this.el.querySelector('.diag-pads')!.append(b);
    nav.add({ el: b, activate: () => (this.run ? this.stop('Stopped') : this.start()) });
    this.button = b;
  }

  get running(): boolean {
    return this.run !== null;
  }

  /** The sheet closed or the run was cancelled: everything back, nothing left drawing. */
  stop(note?: string): void {
    if (!this.run) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.run = null;
    this.deps.setLayer(null);
    this.deps.frame(this.m);
    this.button.textContent = 'RUN';
    if (note) this.outEl.textContent = note;
  }

  private start(): void {
    const why = this.deps.blocker();
    if (why) {
      this.outEl.textContent = why;
      return;
    }
    this.run = new GpuBreakdownRun();
    this.deps.setLayer(null);
    this.deps.frame(this.m);
    this.dc = this.deps.info().dc;
    this.button.textContent = 'STOP';
    this.progress();
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    const run = this.run;
    if (!run) return;
    this.deps.frame(this.m);
    if (run.sample(this.m.cpu, this.m.total)) {
      const next = run.current;
      if (next === null) {
        this.finish(run);
        return;
      }
      this.deps.setLayer(next === ALL ? null : (next as GpuLayerKey));
      this.progress();
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private progress(): void {
    const run = this.run!;
    const key = run.current!;
    this.outEl.textContent = `Measuring: ${stepName(key, run.label(key))} (${run.index + 1}/${run.plan.length})…`;
  }

  private finish(run: GpuBreakdownRun): void {
    this.raf = 0;
    this.run = null;
    this.deps.setLayer(null);
    this.deps.frame(this.m);
    const info = this.deps.info();
    this.last = { at: new Date().toISOString(), tier: info.tier, ratio: info.ratio, dc: this.dc, steps: run.results() };
    this.button.textContent = 'RUN';
    this.outEl.textContent = breakdownLines(this.last).join('\n');
  }
}
