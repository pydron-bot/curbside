import './tokens.css';
import './title.css';
import type { GameAudio } from '../audio/gameAudio';
import type { InputDevice } from '../core/input';
import { ICONS } from './icons';
import { MenuNav, menuButton, type NavItem, type Panel } from './menu';
import { fmt } from './scoreHud';
import { onTap } from './tap';

/** A way to play, listed on the title screen under PLAY. */
export interface TitleMode {
  id: string;
  label: string;
  /** One line under the label, e.g. "2:00 — score as much as you can". */
  sub?: string;
  onSelect(): void;
}

export interface TitleOptions {
  /** PLAY: free roam. */
  onPlay(): void;
  /** A mode added with addMode() was picked. */
  onMode(mode: TitleMode): void;
  onSettings(): void;
  onHowTo(): void;
}

const TIP_KEY = 'curbside.a2hsTip';
/** The deeek.org hub. Absolute: '/' is the game itself wherever base is '/' (dev, hive1). */
const HUB_URL = 'https://deeek.org/';

/**
 * The front door: the CURBSIDE wordmark over the live city (the sim runs
 * behind it in attract mode, see attract.ts), PLAY plus any modes other
 * systems add with addMode(), SETTINGS and HOW TO PLAY, the best score and
 * a small link back to the deeek.org hub (here only, never on the pause
 * menu, where a mis-tap would throw away a run).
 * The first tap, click or key also unlocks audio (iOS needs a gesture) and
 * starts the menu music. On iPhone Safari (not installed) a one-time tip
 * explains Add to Home Screen, the only way to get true full screen there.
 */
export class TitleScreen implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  private readonly modes: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly hubLink: HTMLAnchorElement;
  private readonly hints: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly modeItems = new Map<string, { el: HTMLElement; item: NavItem }>();
  private readonly playBtn: HTMLButtonElement;
  private hintDevice: InputDevice | null = null;

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
    private readonly opts: TitleOptions,
  ) {
    const root = document.createElement('div');
    root.id = 'title';
    root.className = 'ui-overlay';
    root.hidden = true;
    root.innerHTML = `
      <div class="title-scrim"></div>
      <div class="title-main">
        <h1 class="wordmark" aria-label="Curbside"><span class="wm" data-text="CURBSIDE">CURBSIDE</span><i class="wm-drip"></i></h1>
        <div class="tagline">STEAL <i></i> DRIFT <i></i> CAUSE CHAOS</div>
        <div class="title-modes"></div>
        <div class="title-row"></div>
        <div class="title-best" hidden>BEST <b></b></div>
        <a class="title-hub" href="${HUB_URL}" tabindex="-1">MORE AT DEEEK.ORG</a>
      </div>
      <div class="title-hints"></div>
      <div class="a2hs" hidden>
        <span class="a2hs-icon">${ICONS.share}</span>
        <span class="a2hs-text"><b>Play full screen</b>Tap <span class="inline-icon">${ICONS.share}</span> then <em>Add to Home Screen</em></span>
        <button type="button" class="a2hs-close" aria-label="Dismiss">${ICONS.close}</button>
      </div>`;
    parent.append(root);
    this.root = root;
    this.nav = new MenuNav(root);
    this.modes = root.querySelector('.title-modes')!;
    this.bestEl = root.querySelector('.title-best')!;
    this.hubLink = root.querySelector('.title-hub')!;
    this.hints = root.querySelector('.title-hints')!;
    this.tip = root.querySelector('.a2hs')!;

    this.playBtn = menuButton('PLAY', { icon: 'play', primary: true, sub: 'Free roam — cause chaos', className: 'title-play' });
    this.modes.append(this.playBtn);
    this.nav.add({ el: this.playBtn, activate: () => this.select(opts.onPlay) });
    const row = root.querySelector('.title-row')!;
    const settings = menuButton('SETTINGS', { icon: 'gear', className: 'small' });
    const howTo = menuButton('HOW TO PLAY', { icon: 'help', className: 'small' });
    row.append(settings, howTo);
    this.nav.add({
      el: settings,
      activate: () => {
        audio.ui('click');
        opts.onSettings();
      },
    });
    this.nav.add({
      el: howTo,
      activate: () => {
        audio.ui('click');
        opts.onHowTo();
      },
    });
    // Same tab: the hub's PLAY brings you back.
    this.nav.add({
      el: this.hubLink,
      activate: () => {
        audio.ui('click');
        location.assign(HUB_URL);
      },
    });

    // The first touch anywhere on the title unlocks audio (GameAudio also
    // listens globally; this makes the intent explicit).
    root.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
    onTap(root.querySelector<HTMLElement>('.a2hs-close')!, () => this.dismissTip());
    this.tip.hidden = !shouldOfferInstallTip();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * Add a mode under PLAY (e.g. CHAOS RUN). Picking it starts a fresh run
   * exactly as PLAY does, then calls mode.onSelect() to set the mode up on
   * top of it. Re-adding an id replaces it.
   */
  addMode(mode: TitleMode): void {
    this.removeMode(mode.id);
    const el = menuButton(mode.label, { sub: mode.sub ?? '', className: 'title-mode' });
    el.dataset.mode = mode.id;
    this.modes.append(el);
    const item = this.nav.add({ el, activate: () => this.select(() => this.opts.onMode(mode)) });
    this.modeItems.set(mode.id, { el, item });
  }

  /** A line of another system's under the best score (e.g. cash); the hub link stays last. */
  addInfo(el: HTMLElement): void {
    this.hubLink.before(el);
  }

  removeMode(id: string): void {
    const m = this.modeItems.get(id);
    if (!m) return;
    this.nav.remove(m.el);
    m.el.remove();
    this.modeItems.delete(id);
  }

  open(best: number, device: InputDevice): void {
    this.bestEl.hidden = best <= 0;
    this.bestEl.querySelector('b')!.textContent = fmt(best);
    this.setDevice(device);
    this.root.hidden = false;
    this.nav.focusElement(this.playBtn);
    this.nav.showFocus(device !== 'touch');
  }

  close(): void {
    this.root.hidden = true;
  }

  /** Key hints follow the device in use (none on touch). Cheap to call every frame. */
  setDevice(device: InputDevice): void {
    if (device === this.hintDevice) return;
    this.hintDevice = device;
    this.hints.innerHTML =
      device === 'gamepad'
        ? '<kbd class="pad">A</kbd> SELECT <kbd class="pad b">B</kbd> BACK'
        : device === 'keyboard'
          ? '<kbd>↑</kbd><kbd>↓</kbd> CHOOSE <kbd>ENTER</kbd> SELECT'
          : '';
  }

  back(): void {
    // Nothing behind the title; Back just dismisses the install tip.
    if (!this.tip.hidden) this.dismissTip();
  }

  private select(run: () => void): void {
    this.audio.unlock();
    this.audio.ui('confirm');
    run();
  }

  private dismissTip(): void {
    this.tip.hidden = true;
    try {
      localStorage.setItem(TIP_KEY, 'dismissed');
    } catch {
      // Blocked storage: it'll be offered again next time.
    }
  }
}

/** iPhone / iPad Safari, not already installed to the home screen, tip not dismissed. */
function shouldOfferInstallTip(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (window.matchMedia?.('(display-mode: standalone)').matches ?? false) ||
    (window.matchMedia?.('(display-mode: fullscreen)').matches ?? false);
  if (standalone) return false;
  try {
    return localStorage.getItem(TIP_KEY) !== 'dismissed';
  } catch {
    return true;
  }
}

/**
 * Android / desktop: go full screen and lock landscape from the PLAY press
 * (iOS Safari has neither API for pages; it gets the install tip instead).
 * Asks the browser to keep our storage (the best score) too. Never throws.
 */
export function enterGameMode(handheld: boolean): void {
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {
    // Not offered.
  }
  if (!handheld) return;
  const el = document.documentElement as HTMLElement & { requestFullscreen?: (o?: FullscreenOptions) => Promise<void> };
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => {});
}
