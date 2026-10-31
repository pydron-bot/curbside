/**
 * Device probes on the Diagnostics sheet: the iOS haptic switch fired from
 * four different triggers, a gamepad rumble, and a live pad readout. The
 * haptic paths fail silently by design, so a device session needs these to
 * tell "unsupported" from "broken".
 */
import type { Haptics } from './haptics';
import type { MenuNav } from './menu';

/** The pad readout refreshes this often while the sheet is open, ms. */
const PAD_POLL_MS = 100;
/** A pointer press this recent means a click on a down/up pad isn't a keyboard press, ms. */
const POINTER_RECENT_MS = 1000;

type Trigger = 'down' | 'up' | 'click' | 'timeout';

/** One line per pad: id, mapping, pressed buttons, axes (and the triggers' travel). */
export function padLines(pads: ReadonlyArray<Gamepad | null>): string {
  const lines: string[] = [];
  for (const p of pads) {
    if (!p) continue;
    const pressed: number[] = [];
    p.buttons.forEach((b, i) => {
      if (b.pressed) pressed.push(i);
    });
    const axes = p.axes.map((a) => a.toFixed(2)).join(' ');
    const lt = p.buttons[6]?.value ?? 0;
    const rt = p.buttons[7]?.value ?? 0;
    lines.push(
      `PAD ${p.index} ${p.id}\n  ${p.mapping || 'no mapping'} · ${p.buttons.length} buttons · pressed ${pressed.length ? pressed.join(',') : '-'}\n  axes ${axes || '-'} · LT ${lt.toFixed(2)} RT ${rt.toFixed(2)}`,
    );
  }
  return lines.length ? lines.join('\n') : 'PAD none connected';
}

export class InputProbes {
  readonly el: HTMLElement;
  private readonly padEl: HTMLElement;
  private readonly hapticEl: HTMLElement;
  private readonly rumbleEl: HTMLElement;
  private readonly fired: Record<Trigger, number> = { down: 0, up: 0, click: 0, timeout: 0 };
  private readonly toggled: Record<Trigger, number> = { down: 0, up: 0, click: 0, timeout: 0 };
  private timer = 0;
  private lastPointer = -Infinity;

  constructor(
    private readonly haptics: Haptics,
    nav: MenuNav,
  ) {
    this.el = document.createElement('section');
    this.el.className = 'diag-probes';
    this.el.innerHTML = `
      <h3>HAPTICS</h3>
      <div class="diag-pads"></div>
      <p class="diag-probe-out diag-haptic-out"></p>
      <h3>RUMBLE</h3>
      <div class="diag-pads diag-rumble"></div>
      <p class="diag-probe-out diag-rumble-out">not tried</p>
      <h3>GAMEPAD</h3>
      <pre class="diag-probe-out diag-pad-out"></pre>`;
    const pads = this.el.querySelector('.diag-pads')!;
    this.hapticEl = this.el.querySelector('.diag-haptic-out')!;
    this.rumbleEl = this.el.querySelector('.diag-rumble-out')!;
    this.padEl = this.el.querySelector('.diag-pad-out')!;
    const pad = (parent: Element, label: string, activate: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'tab diag-pad';
      b.textContent = label;
      parent.append(b);
      nav.add({ el: b, activate });
      return b;
    };
    // Enter / A on the down or up pad (no pointer involved) still fires, as a click.
    const keyOnly = () => {
      if (performance.now() - this.lastPointer >= POINTER_RECENT_MS) this.fire('click');
    };
    const down = pad(pads, 'ON DOWN', keyOnly);
    down.addEventListener('pointerdown', () => {
      this.lastPointer = performance.now();
      this.fire('down');
    });
    const up = pad(pads, 'ON UP', keyOnly);
    up.addEventListener('pointerdown', () => (this.lastPointer = performance.now()));
    up.addEventListener('pointerup', () => this.fire('up'));
    pad(pads, 'ON CLICK', () => this.fire('click'));
    pad(pads, 'AFTER 500 MS', () => {
      this.hapticEl.textContent = 'waiting 500 ms…';
      window.setTimeout(() => this.fire('timeout'), 500);
    });
    pad(this.el.querySelector('.diag-rumble')!, 'RUMBLE', () => this.rumble());
    this.showHaptics();
  }

  /** The sheet opened: start the pad readout. */
  start(): void {
    this.stop();
    this.showHaptics();
    this.pollPads();
    this.timer = window.setInterval(() => this.pollPads(), PAD_POLL_MS);
  }

  /** The sheet closed: nothing polls behind it. */
  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private fire(t: Trigger): void {
    const before = this.haptics.switchChanges;
    const ok = this.haptics.probeTick();
    if (ok) {
      this.fired[t]++;
      if (this.haptics.switchChanges > before) this.toggled[t]++;
    }
    this.showHaptics(ok ? null : 'no haptic switch (not iOS)');
  }

  private showHaptics(note: string | null = null): void {
    const f = this.fired;
    const g = this.toggled;
    this.hapticEl.textContent =
      note ??
      `fired/toggled · down ${f.down}/${g.down} · up ${f.up}/${g.up} · click ${f.click}/${g.click} · 500 ms ${f.timeout}/${g.timeout} · switch changes ${this.haptics.switchChanges}`;
  }

  private rumble(): void {
    this.rumbleEl.textContent = 'playing…';
    void this.haptics.probeRumble().then((r) => (this.rumbleEl.textContent = r));
  }

  private pollPads(): void {
    let pads: ReadonlyArray<Gamepad | null> = [];
    try {
      pads = navigator.getGamepads?.() ?? [];
    } catch {
      // Blocked by a permissions policy.
    }
    const text = padLines(pads);
    if (this.padEl.textContent !== text) this.padEl.textContent = text;
  }
}
