import type { GameAudio } from '../audio/gameAudio';
import { CAMERA_PRESETS, LOOK_GROUPS, LOOK_SPECS, formatLook, lookDistance, type LookGroup, type LookKey, type LookSpec, type LookTuning } from '../render/lookTuning';
import { getDevice } from '../render/quality';
import './lookPanel.css';

/** The clock's quick hours (TEST → WORLD's, plus sunset). */
const CLOCK_PRESETS: ReadonlyArray<readonly [string, number]> = [
  ['DAWN', 6.4],
  ['NOON', 12.5],
  ['GOLD', 18.2],
  ['SUNSET', 19.6],
  ['00:00', 0],
];
/** RESET ALL's first press arms it for this long, ms. */
const CONFIRM_MS = 3000;
const NOTICE_MS = 3200;
/** Where the panel sits, whether it's folded and which groups are open (per device). */
const PREFS_KEY = 'curbside.lookPanel';

interface Prefs {
  side: 'left' | 'right';
  folded: boolean;
  open: LookGroup[];
}

export interface LookPanelHooks {
  /** The game clock now. */
  hour(): number;
  /** Hold the clock at an hour, or let it run (null). */
  holdClock(hour: number | null): void;
  /** Is the clock held? */
  held(): boolean;
}

/** "18:15" for 18.25 (to the quarter hour shown). */
export function clockLabel(hour: number): string {
  const m = Math.round((((hour % 24) + 24) % 24) * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

interface Row {
  spec: LookSpec;
  el: HTMLElement;
  input: HTMLInputElement;
  value: HTMLElement;
  dist: HTMLElement;
  reset: HTMLButtonElement;
}

/**
 * TEST → LOOK: a slim panel down one edge of the screen over live play, so
 * the city stays in view while the look is tuned (render/lookTuning.ts).
 * A slider per look constant, in folding groups, each showing its distance
 * from the shipped look with a reset; RESET ALL; EXPORT downloads look.json
 * (and copies it). The clock can be held at an hour. A tab on the inner
 * edge folds the panel to a strip; ⇆ moves it to the other side (a phone's
 * pedals are on the right). DOM only: no draw call.
 */
export class LookPanel {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly resetAll: HTMLButtonElement;
  private readonly clock: HTMLInputElement;
  private readonly clockText: HTMLElement;
  private readonly hold: HTMLButtonElement;
  private readonly rows = new Map<LookKey, Row>();
  private readonly groups = new Map<LookGroup, { el: HTMLElement; sub: HTMLElement }>();
  private prefs: Prefs = { side: 'right', folded: false, open: ['sky'] };
  private armTimer = 0;
  private noticeTimer = 0;
  private clockTimer = 0;
  private dragging = false;

  constructor(
    parent: HTMLElement,
    private readonly tuning: LookTuning,
    private readonly audio: GameAudio,
    private readonly hooks: LookPanelHooks,
  ) {
    this.loadPrefs();
    const root = document.createElement('aside');
    root.className = 'lookp';
    root.hidden = true;
    root.innerHTML = `
      <button type="button" class="lookp-tab" aria-label="Fold the look panel"><span>LOOK</span></button>
      <div class="lookp-card">
        <header class="lookp-head">
          <h2>LOOK</h2>
          <span class="lookp-count"></span>
          <button type="button" class="lookp-icon" data-act="side" aria-label="Other side">⇆</button>
          <button type="button" class="lookp-icon" data-act="close" aria-label="Close">✕</button>
        </header>
        <div class="lookp-actions">
          <button type="button" class="lookp-btn" data-act="reset-all">RESET ALL</button>
          <button type="button" class="lookp-btn hot" data-act="export">EXPORT</button>
        </div>
        <div class="lookp-body" data-scroll>
          <section class="lookp-clock">
            <div class="lookp-top"><b>CLOCK</b><span class="lookp-val lookp-time"></span><button type="button" class="lookp-btn small" data-act="hold">HOLD</button></div>
            <input type="range" min="0" max="24" step="0.25" aria-label="Hour">
            <div class="lookp-chips"></div>
          </section>
        </div>
        <div class="lookp-notice" hidden></div>
      </div>`;
    this.root = root;
    this.body = root.querySelector('.lookp-body')!;
    this.count = root.querySelector('.lookp-count')!;
    this.notice = root.querySelector('.lookp-notice')!;
    this.resetAll = root.querySelector('[data-act="reset-all"]')!;
    this.clock = root.querySelector('.lookp-clock input')!;
    this.clockText = root.querySelector('.lookp-time')!;
    this.hold = root.querySelector('[data-act="hold"]')!;

    const chips = root.querySelector('.lookp-chips')!;
    for (const [label, hour] of CLOCK_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lookp-chip';
      b.textContent = label;
      b.addEventListener('click', () => this.setClock(hour));
      chips.append(b);
    }
    this.clock.addEventListener('input', () => this.setClock(Number(this.clock.value)));
    this.clock.addEventListener('pointerdown', () => (this.dragging = true));
    this.clock.addEventListener('pointerup', () => (this.dragging = false));
    this.clock.addEventListener('pointercancel', () => (this.dragging = false));
    this.hold.addEventListener('click', () => {
      this.audio.ui('click');
      this.hooks.holdClock(this.hooks.held() ? null : this.hooks.hour());
      this.syncClock();
    });

    const handheld = getDevice().handheld;
    for (const [group, title] of LOOK_GROUPS) {
      const specs = LOOK_SPECS.filter((s) => s.group === group && !(handheld && 'desktopOnly' in s && s.desktopOnly));
      this.buildGroup(group, title, specs);
    }

    root.querySelector('.lookp-tab')!.addEventListener('click', () => this.fold(!this.prefs.folded));
    root.querySelector('[data-act="side"]')!.addEventListener('click', () => {
      this.prefs.side = this.prefs.side === 'right' ? 'left' : 'right';
      this.savePrefs();
      this.layout();
    });
    root.querySelector('[data-act="close"]')!.addEventListener('click', () => this.close());
    this.resetAll.addEventListener('click', () => this.onResetAll());
    root.querySelector('[data-act="export"]')!.addEventListener('click', () => this.exportFile());
    // Keys typed here (arrows on a slider) aren't the game's.
    root.addEventListener('keydown', (e) => e.stopPropagation());
    tuning.onChange(() => this.refresh());
    this.layout();
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.fold(false);
    this.refresh();
    this.syncClock();
    window.clearInterval(this.clockTimer);
    this.clockTimer = window.setInterval(() => this.syncClock(), 250);
  }

  close(): void {
    if (this.root.hidden) return;
    this.audio.ui('back');
    this.root.hidden = true;
    window.clearInterval(this.clockTimer);
  }

  /** Every slider shown from the store again (after a load or a reset). */
  refresh(): void {
    for (const row of this.rows.values()) this.syncRow(row);
    const n = this.tuning.changed;
    this.count.textContent = n ? `${n} CHANGED` : 'AS SHIPPED';
    this.count.classList.toggle('on', n > 0);
    for (const [group, g] of this.groups) {
      let k = 0;
      for (const row of this.rows.values()) if (row.spec.group === group && row.el.classList.contains('changed')) k++;
      g.sub.textContent = k ? `${k} CHANGED` : '';
    }
  }

  private buildGroup(group: LookGroup, title: string, specs: readonly LookSpec[]): void {
    const sec = document.createElement('section');
    sec.className = 'lookp-group';
    sec.innerHTML = '<button type="button" class="lookp-gh"><b></b><small></small><i>▾</i></button><div class="lookp-rows"></div>';
    sec.querySelector('b')!.textContent = title;
    const rows = sec.querySelector<HTMLElement>('.lookp-rows')!;
    sec.classList.toggle('open', this.prefs.open.includes(group));
    sec.querySelector('.lookp-gh')!.addEventListener('click', () => {
      const open = !sec.classList.contains('open');
      sec.classList.toggle('open', open);
      this.prefs.open = this.prefs.open.filter((g) => g !== group);
      if (open) this.prefs.open.push(group);
      this.savePrefs();
    });
    if (group === 'camera') rows.append(this.cameraChips());
    for (const spec of specs) rows.append(this.buildRow(spec));
    this.groups.set(group, { el: sec, sub: sec.querySelector('small')! });
    this.body.append(sec);
  }

  /** The camera trial's presets: one tap sets tilt, on-foot height and field of view. */
  private cameraChips(): HTMLElement {
    const chips = document.createElement('div');
    chips.className = 'lookp-chips';
    for (const p of CAMERA_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lookp-chip';
      b.textContent = p.label;
      b.addEventListener('click', () => {
        this.audio.ui('click');
        this.tuning.set('cameraTilt', p.cameraTilt);
        this.tuning.set('footHeight', p.footHeight);
        this.tuning.set('fieldOfView', p.fieldOfView);
        this.refresh();
      });
      chips.append(b);
    }
    return chips;
  }

  private buildRow(spec: LookSpec): HTMLElement {
    const el = document.createElement('div');
    el.className = 'lookp-row';
    el.innerHTML = `
      <div class="lookp-top"><b></b><span class="lookp-dist"></span><span class="lookp-val"></span><button type="button" class="lookp-reset" aria-label="Reset">↺</button></div>
      <input type="range">
      <small></small>`;
    el.querySelector('b')!.textContent = spec.label;
    el.querySelector('small')!.textContent = spec.hint;
    const input = el.querySelector('input')!;
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.setAttribute('aria-label', spec.label);
    const key = spec.key as LookKey;
    const row: Row = {
      spec,
      el,
      input,
      value: el.querySelector('.lookp-val')!,
      dist: el.querySelector('.lookp-dist')!,
      reset: el.querySelector('.lookp-reset')!,
    };
    input.addEventListener('input', () => {
      this.tuning.set(key, Number(input.value));
      this.syncRow(row);
    });
    row.reset.addEventListener('click', () => {
      this.audio.ui('click');
      this.tuning.reset(key);
      this.refresh();
    });
    this.rows.set(key, row);
    return el;
  }

  private syncRow(row: Row): void {
    const key = row.spec.key as LookKey;
    const v = this.tuning.value(key);
    if (Number(row.input.value) !== v) row.input.value = String(v);
    row.value.textContent = formatLook(key, v);
    const d = lookDistance(key, v, this.tuning.shipped[key]);
    // A colour turn from a shipped 0 reads the same twice: show it once.
    row.dist.textContent = d === row.value.textContent ? '' : d;
    row.el.classList.toggle('changed', d !== '');
    row.reset.disabled = d === '';
    // Where the shipped value sits on the track (a tick under it).
    const span = row.spec.max - row.spec.min;
    row.el.style.setProperty('--shipf', String((this.tuning.shipped[key] - row.spec.min) / span));
  }

  private setClock(hour: number): void {
    this.hooks.holdClock(hour >= 24 ? 0 : hour);
    this.syncClock();
  }

  private syncClock(): void {
    const h = this.hooks.hour();
    this.clockText.textContent = clockLabel(h);
    if (!this.dragging) this.clock.value = String(h);
    const held = this.hooks.held();
    this.hold.classList.toggle('on', held);
    this.hold.textContent = held ? 'HELD' : 'HOLD';
  }

  private fold(folded: boolean): void {
    this.prefs.folded = folded;
    this.savePrefs();
    this.layout();
  }

  private layout(): void {
    this.root.dataset.side = this.prefs.side;
    this.root.classList.toggle('folded', this.prefs.folded);
  }

  private onResetAll(): void {
    const b = this.resetAll;
    if (!b.classList.contains('armed')) {
      this.audio.ui('click');
      b.classList.add('armed');
      b.textContent = 'AGAIN TO RESET';
      window.clearTimeout(this.armTimer);
      this.armTimer = window.setTimeout(() => this.disarm(), CONFIRM_MS);
      return;
    }
    this.disarm();
    this.tuning.resetAll();
    this.audio.ui('confirm');
    this.say('EVERY SLIDER BACK TO THE SHIPPED LOOK');
  }

  private disarm(): void {
    window.clearTimeout(this.armTimer);
    this.resetAll.classList.remove('armed');
    this.resetAll.textContent = 'RESET ALL';
  }

  private exportFile(): void {
    const text = this.tuning.exportFile();
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'look.json';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // No download: the clipboard has it.
    }
    navigator.clipboard?.writeText(text).catch(() => {});
    this.audio.ui('success');
    this.say('LOOK.JSON SAVED & COPIED · HAND IT OVER TO SHIP IT');
  }

  private say(text: string): void {
    this.notice.textContent = text;
    this.notice.hidden = false;
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => (this.notice.hidden = true), NOTICE_MS);
  }

  private loadPrefs(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
      if (!raw) return;
      if (raw.side === 'left' || raw.side === 'right') this.prefs.side = raw.side;
      if (Array.isArray(raw.open)) this.prefs.open = raw.open.filter((g): g is LookGroup => LOOK_GROUPS.some(([id]) => id === g));
    } catch {
      // Defaults.
    }
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // Not kept: fine.
    }
  }
}
