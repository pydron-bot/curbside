import type { GameAudio } from '../audio/gameAudio';
import { onSettingsChange, settings, updateSettings, type Settings } from '../core/settings';
import { ICONS } from './icons';
import { MenuNav, overlay, type Panel } from './menu';

type SliderKey = 'masterVolume' | 'sfxVolume' | 'musicVolume';
type ToggleKey = 'ignoreSilentSwitch' | 'leftHanded' | 'haptics' | 'showFps';
type ChoiceKey = 'quality' | 'steering';

type Row =
  | { kind: 'slider'; key: SliderKey; label: string }
  | { kind: 'toggle'; key: ToggleKey; label: string; sub?: string }
  | { kind: 'choice'; key: ChoiceKey; label: string; sub?: string; options: ReadonlyArray<readonly [string, string]> };

/** Slider step for keyboard / pad adjustment. */
const STEP = 0.05;
/** The volume preview click plays at most this often while dragging, ms. */
const PREVIEW_EVERY = 90;

const isIos = () =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/**
 * Settings: every field of Settings, persisted through updateSettings (so
 * audio, quality and the touch layout react at once). Volume sliders play a
 * click as they move so you hear the level; rows are at least 44pt tall and
 * the whole row is the target; keyboard / pad: up/down to pick a row,
 * left/right to change it.
 */
export class SettingsPanel implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  private readonly refreshers: Array<(s: Settings) => void> = [];
  private lastPreview = 0;
  private onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
  ) {
    const { root, card } = overlay('settings', 'ui-sheet');
    this.root = root;
    this.nav = new MenuNav(root);
    card.innerHTML = `
      <header class="sheet-head"><h2>SETTINGS</h2></header>
      <div class="sheet-body settings-grid" data-scroll>
        <section><h3>SOUND</h3></section>
        <section><h3>CONTROLS</h3></section>
        <section><h3>DISPLAY</h3></section>
      </div>`;
    const [sound, controls, display] = card.querySelectorAll('section');
    const head = card.querySelector('.sheet-head')!;
    const close = document.createElement('button');
    close.type = 'button';
    close.tabIndex = -1;
    close.className = 'sheet-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = ICONS.close;
    head.append(close);
    this.nav.add({ el: close, activate: () => this.back() });

    const soundRows: Row[] = [
      { kind: 'slider', key: 'masterVolume', label: 'Master' },
      { kind: 'slider', key: 'sfxVolume', label: 'Effects' },
      { kind: 'slider', key: 'musicVolume', label: 'Music' },
    ];
    if (isIos()) {
      soundRows.push({ kind: 'toggle', key: 'ignoreSilentSwitch', label: 'Sound with silent switch on', sub: 'iPhone ring/silent switch' });
    }
    const controlRows: Row[] = [
      {
        kind: 'choice',
        key: 'steering',
        label: 'Touch steering',
        sub: 'Point where to go, or steer left/right',
        options: [
          ['directional', 'Point'],
          ['classic', 'Classic'],
        ],
      },
      { kind: 'toggle', key: 'leftHanded', label: 'Left-handed layout', sub: 'Mirror the touch controls' },
      { kind: 'toggle', key: 'haptics', label: 'Vibration', sub: 'Phone and controller rumble' },
    ];
    const displayRows: Row[] = [
      {
        kind: 'choice',
        key: 'quality',
        label: 'Graphics',
        options: [
          ['auto', 'Auto'],
          ['high', 'High'],
          ['medium', 'Med'],
          ['low', 'Low'],
        ],
      },
      { kind: 'toggle', key: 'showFps', label: 'Show FPS' },
    ];
    for (const r of soundRows) sound.append(this.row(r));
    for (const r of controlRows) controls.append(this.row(r));
    for (const r of displayRows) display.append(this.row(r));
    parent.append(root);
    onSettingsChange((s) => this.refresh(s));
    this.refresh(settings);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(onClose: () => void, showFocus: boolean): void {
    this.onClose = onClose;
    this.root.hidden = false;
    this.refresh(settings);
    this.nav.focus();
    this.nav.showFocus(showFocus);
  }

  back(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.audio.ui('back');
    this.onClose();
  }

  private refresh(s: Settings): void {
    for (const fn of this.refreshers) fn(s);
  }

  private row(r: Row): HTMLElement {
    const el = document.createElement('div');
    el.className = `srow srow-${r.kind}`;
    const label = document.createElement('div');
    label.className = 'srow-label';
    label.innerHTML = `<b></b>${'sub' in r && r.sub ? '<small></small>' : ''}`;
    label.querySelector('b')!.textContent = r.label;
    if ('sub' in r && r.sub) label.querySelector('small')!.textContent = r.sub;
    el.append(label);
    if (r.kind === 'slider') this.slider(el, r.key);
    else if (r.kind === 'toggle') this.toggle(el, r.key);
    else this.choice(el, r.key, r.options);
    return el;
  }

  private slider(row: HTMLElement, key: SliderKey): void {
    const track = document.createElement('div');
    track.className = 'slider';
    track.innerHTML = '<div class="slider-fill"></div><div class="slider-thumb"></div>';
    const value = document.createElement('b');
    value.className = 'srow-value';
    row.append(track, value);
    const fill = track.firstElementChild as HTMLElement;
    const thumb = track.lastElementChild as HTMLElement;
    const set = (v: number, preview: boolean) => {
      const q = Math.round(Math.max(0, Math.min(1, v)) / STEP) * STEP;
      if (Math.abs(q - settings[key]) > 1e-6) updateSettings({ [key]: q } as Partial<Settings>);
      if (preview) this.preview();
    };
    const fromPointer = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      set((e.clientX - r.left) / r.width, true);
    };
    let dragging: number | null = null;
    row.addEventListener('pointerdown', (e) => {
      if (!(e.target as Element).closest('.slider')) return;
      dragging = e.pointerId;
      track.setPointerCapture(e.pointerId);
      fromPointer(e);
    });
    track.addEventListener('pointermove', (e) => {
      if (e.pointerId === dragging) fromPointer(e);
    });
    const stop = (e: PointerEvent) => {
      if (e.pointerId === dragging) dragging = null;
    };
    track.addEventListener('pointerup', stop);
    track.addEventListener('pointercancel', stop);
    this.nav.add({ el: row, adjust: (dir) => set(settings[key] + dir * STEP, true) });
    this.refreshers.push((s) => {
      const pct = Math.round(s[key] * 100);
      fill.style.transform = `scaleX(${s[key]})`;
      thumb.style.left = `${pct}%`;
      value.textContent = String(pct);
    });
  }

  private toggle(row: HTMLElement, key: ToggleKey): void {
    const sw = document.createElement('div');
    sw.className = 'switch';
    sw.innerHTML = '<i></i>';
    const value = document.createElement('b');
    value.className = 'srow-value';
    row.append(sw, value);
    const flip = (on?: boolean) => {
      const next = on ?? !settings[key];
      if (next === settings[key]) return;
      updateSettings({ [key]: next } as Partial<Settings>);
      this.audio.ui('click');
    };
    this.nav.add({ el: row, activate: () => flip(), adjust: (dir) => flip(dir > 0) });
    this.refreshers.push((s) => {
      row.classList.toggle('on', s[key]);
      value.textContent = s[key] ? 'ON' : 'OFF';
    });
  }

  private choice(row: HTMLElement, key: ChoiceKey, options: ReadonlyArray<readonly [string, string]>): void {
    const seg = document.createElement('div');
    seg.className = 'segmented';
    const buttons = options.map(([value, text]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.textContent = text;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        pick(value);
      });
      seg.append(b);
      return b;
    });
    row.append(seg);
    const pick = (value: string) => {
      if (settings[key] === value) return;
      updateSettings({ [key]: value } as Partial<Settings>);
      this.audio.ui('click');
    };
    const index = () => options.findIndex(([v]) => v === settings[key]);
    this.nav.add({
      el: row,
      adjust: (dir) => {
        const i = index();
        const next = options[Math.max(0, Math.min(options.length - 1, i + dir))];
        if (next) pick(next[0]);
      },
      activate: () => pick(options[(index() + 1) % options.length][0]),
    });
    this.refreshers.push(() => {
      const i = index();
      buttons.forEach((b, j) => b.classList.toggle('selected', i === j));
    });
  }

  /** Let the player hear the level they're setting. */
  private preview(): void {
    const now = performance.now();
    if (now - this.lastPreview < PREVIEW_EVERY) return;
    this.lastPreview = now;
    this.audio.ui('click');
  }
}
