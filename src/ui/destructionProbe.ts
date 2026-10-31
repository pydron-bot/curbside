/**
 * The destruction test on the Diagnostics sheet: the mode (OFF / AUTO /
 * PHONE / DESKTOP, saved like a setting), BLOW A WALL (a harmless blast at
 * the wall ahead, repeatable on the device) and a live readout of what the
 * rubble costs. The test has no Settings row: this is its only switch.
 */
import { DESTRUCTION_MODES, type DestructionMode } from '../core/settings';
import type { DestructionStats } from '../render/destruction';
import { needsPhysics, resolveStyle } from '../render/destructionStyle';
import type { QualityTierName } from '../render/quality';
import type { MenuNav } from './menu';

/** The readout refreshes this often while the sheet is open, ms. */
const LIVE_MS = 250;

export interface DestructionProbeDeps {
  stats(out?: DestructionStats): DestructionStats;
  setMode(m: DestructionMode): void;
  /** Queue the blast (it goes off as the sheet closes and play resumes), or say why not. */
  blowWall(): string | null;
  /** The live quality tier ('auto' follows it). */
  tier(): QualityTierName;
}

const ms = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(2));

/** A coarse timer (WebKit without isolation rounds to ~1 ms) makes single steps unreadable: say so. */
const coarse = (s: DestructionStats) => (s.timerMs >= 0.5 ? ' (q)' : '');

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 'es'}`;

/**
 * Why BLOW A WALL can't go yet, or null: with the test off it would be a
 * plain fireball; while Rapier is still loading (or waiting for a pause to
 * warm up) the first breach would show the 'low' look and the warm-up would
 * land mid-play.
 */
export function blowWallBlocker(s: DestructionStats, tier: QualityTierName): string | null {
  if (s.mode === 'off') return 'Turn the test on first (AUTO / PHONE / DESKTOP)';
  if (s.rapier === 'loading' && needsPhysics(resolveStyle(s.mode, tier))) return 'Loading physics: wait for "rapier … ready" below, then try again';
  return null;
}

/** The top strip of the screen (the HUD's bar, a notch's shadow), as a share of its height. */
const HUD_BAND = 0.12;

/**
 * BLOW A WALL's crater (its top, in CSS px) can be seen: on screen, below
 * the top HUD band and clear of the HUD's buttons (`avoid`, padded 8 px).
 */
export function clearOfHud(x: number, y: number, width: number, height: number, avoid: ReadonlyArray<{ left: number; top: number; right: number; bottom: number }>): boolean {
  if (x < 0 || x > width || y < HUD_BAND * height || y > height) return false;
  for (const r of avoid) if (x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) return false;
  return true;
}

/** The readout under the pads: style and Rapier, bodies, physics time. */
export function destructionLines(s: DestructionStats, tier: string): string {
  if (s.mode === 'off') return 'off: blasts leave walls alone, Rapier not loaded';
  const why = s.source === 'url' ? `url ${s.mode}` : s.mode === 'auto' ? `auto→${tier}` : 'forced';
  const rapier =
    s.rapier === 'ready'
      ? `rapier ${s.version ?? ''} ready: load ${Math.round(s.loadMs)} + import ${Math.round(s.evalMs)} + warm ${Math.round(s.warmMs)} ms`
      : s.rapier === 'failed'
        ? `rapier failed: ${s.error ?? 'unknown'}`
        : `rapier ${s.rapier}`;
  const worst = s.timerMs >= 0.5 ? ` · worst 1 s avg ${ms(s.secAvgMax)} (p95 ${ms(s.secAvgP95)})` : '';
  return [
    `style ${s.style} (${why}) · ${rapier}`,
    `bodies ${s.live} live · ${s.awake} awake · ${s.sinking} sinking · ${s.drawn} drawn · ${s.statics} statics · ${s.proxies} proxies · scars ${s.scars}/${s.scarCap} · ${plural(s.breaches, 'breach')}`,
    `phys avg ${ms(s.stepAvg)} · p95 ${ms(s.stepP95)}${coarse(s)} · max ${ms(s.stepMax)} ms (${s.steps} steps)${worst} · spawn max ${ms(s.spawnMaxMs)} ms · timer ${s.timerMs.toFixed(3)} ms`,
  ].join('\n');
}

/** The report's one-line summary. */
export function destructionSummary(s: DestructionStats): string {
  if (s.mode === 'off') return 'DESTRUCTION off';
  const rapier = s.rapier === 'ready' ? `rapier ready ${Math.round(s.loadMs)}+${Math.round(s.evalMs)}+${Math.round(s.warmMs)} ms` : `rapier ${s.rapier}`;
  const why = s.source === 'url' ? `url ${s.mode}` : s.mode === 'auto' ? 'auto' : 'forced';
  return `DESTRUCTION ${s.style} (${why}) · ${rapier} · ${s.live} bodies (${s.awake} awake) · phys ${ms(s.stepAvg)}/${ms(s.stepP95)}${coarse(s)} ms · scars ${s.scars} · ${plural(s.breaches, 'breach')}`;
}

export class DestructionProbe {
  readonly el: HTMLElement;
  private readonly pads = new Map<DestructionMode, HTMLButtonElement>();
  private readonly liveEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly out: DestructionStats;
  private timer = 0;

  constructor(
    private readonly deps: DestructionProbeDeps,
    nav: MenuNav,
  ) {
    this.out = deps.stats();
    this.el = document.createElement('section');
    this.el.className = 'diag-probes diag-destruction';
    this.el.innerHTML = `
      <h3>DESTRUCTION (TEST)</h3>
      <div class="diag-pads diag-modes"></div>
      <p class="diag-probe-out diag-blow-out" aria-live="polite"></p>
      <pre class="diag-probe-out diag-destruction-out"></pre>`;
    this.liveEl = this.el.querySelector('.diag-destruction-out')!;
    this.noteEl = this.el.querySelector('.diag-blow-out')!;
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
    const modes = this.el.querySelector('.diag-modes')!;
    for (const m of DESTRUCTION_MODES) {
      const b = pad(modes, m.toUpperCase(), () => {
        deps.setMode(m);
        this.noteEl.textContent = '';
        this.show();
      });
      this.pads.set(m, b);
    }
    // On the same row: right from DESKTOP (down goes on to the probes below).
    pad(modes, 'BLOW A WALL', () => {
      const why = deps.blowWall();
      this.noteEl.textContent = why ?? '';
    }).classList.add('diag-blow');
  }

  /** The pad for the current mode: where the keyboard starts on the sheet. */
  get current(): HTMLElement {
    return this.pads.get(this.deps.stats(this.out).mode)!;
  }

  /** The sheet opened: show the mode and keep the readout live. */
  start(): void {
    this.stop();
    this.noteEl.textContent = '';
    this.show();
    this.timer = window.setInterval(() => this.show(), LIVE_MS);
  }

  /** The sheet closed: nothing polls behind it. */
  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private show(): void {
    const s = this.deps.stats(this.out);
    for (const [m, b] of this.pads) {
      const on = m === s.mode;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const text = destructionLines(s, this.deps.tier());
    if (this.liveEl.textContent !== text) this.liveEl.textContent = text;
  }
}
