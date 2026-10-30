import type { InputDevice } from '../core/input';
import './core.css';
import type { IconName } from './icons';
import { MenuNav, menuButton, type Panel } from './menu';

/**
 * Why the game is paused: the player's pause menu; the WebGL context being
 * rebuilt (nothing can resume until it's back); or the phone turned to
 * portrait (the rotate card covers everything, no menu).
 */
export type PauseReason = 'paused' | 'contextLost' | 'rotate';

export interface PauseActions {
  resume(): void;
  settings(): void;
  howTo(): void;
  /** Respawn and start the run over. */
  restart(): void;
  quit(): void;
  /** Reload into the waiting app update. */
  update(): void;
}

/** Restart and Quit lose the run: the first press arms them for this long, ms. */
const CONFIRM_MS = 3000;

/**
 * The pause screen: a menu (Resume, Settings, How to play, Restart, Quit to
 * title) over the frozen game; it also offers a waiting app update ("restart
 * now") and doubles as the "reloading graphics" notice while the WebGL
 * context is lost. Keyboard / pad navigable via MenuNav; Restart and Quit ask
 * for a second press.
 */
export class PauseOverlay implements Panel {
  readonly nav: MenuNav;
  private readonly title: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly update: HTMLButtonElement;
  private readonly resumeBtn: HTMLButtonElement;
  private readonly grid: HTMLElement;
  private reason: PauseReason = 'paused';
  private armed: HTMLButtonElement | null = null;
  private armTimer = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly actions: PauseActions,
  ) {
    el.textContent = '';
    el.classList.add('ui-overlay');
    const card = document.createElement('div');
    card.className = 'pause-card ui-card';
    this.title = document.createElement('div');
    this.title.className = 'pause-title';
    this.hint = document.createElement('div');
    this.hint.className = 'pause-hint';
    this.menu = document.createElement('div');
    this.menu.className = 'pause-menu';
    this.nav = new MenuNav(el);

    this.resumeBtn = menuButton('RESUME', { icon: 'play', primary: true, className: 'pause-resume' });
    const settings = menuButton('SETTINGS', { icon: 'gear' });
    const howTo = menuButton('HOW TO PLAY', { icon: 'help' });
    const restart = menuButton('RESTART', { icon: 'restart', className: 'risky' });
    const quit = menuButton('QUIT TO TITLE', { icon: 'exit', className: 'risky' });
    const grid = document.createElement('div');
    grid.className = 'pause-grid';
    grid.append(settings, howTo, restart, quit);
    this.grid = grid;
    this.menu.append(this.resumeBtn, grid);

    this.update = menuButton('UPDATE READY — RESTART NOW', { className: 'pause-update' });
    this.update.hidden = true;
    card.append(this.title, this.hint, this.menu, this.update);
    el.append(card);

    this.nav.add({ el: this.resumeBtn, activate: () => actions.resume() });
    this.nav.add({ el: settings, activate: () => actions.settings() });
    this.nav.add({ el: howTo, activate: () => actions.howTo() });
    this.nav.add({ el: restart, activate: () => this.confirm(restart, 'SURE? RESTART', actions.restart) });
    this.nav.add({ el: quit, activate: () => this.confirm(quit, 'SURE? QUIT', actions.quit) });
    this.nav.add({ el: this.update, activate: () => actions.update() });
  }

  /** Showing the pause menu itself (not the context-lost notice or the rotate pause). */
  get menuOpen(): boolean {
    return !this.el.hidden && this.reason === 'paused';
  }

  show(reason: PauseReason, device: InputDevice): void {
    this.reason = reason;
    this.disarm();
    this.el.classList.toggle('busy', reason === 'contextLost');
    this.el.classList.toggle('rotate', reason === 'rotate');
    if (reason === 'contextLost') {
      this.title.textContent = 'Reloading graphics…';
      this.hint.textContent = 'The game will carry on in a moment';
      this.hint.hidden = false;
      this.menu.hidden = true;
    } else {
      this.title.textContent = 'PAUSED';
      this.hint.hidden = true;
      this.menu.hidden = false;
    }
    // Opening fresh: Resume is highlighted, ready for Enter / A.
    if (this.el.hidden) this.nav.focusElement(this.resumeBtn);
    this.el.hidden = false;
    this.nav.showFocus(device !== 'touch');
  }

  hide(): void {
    this.el.hidden = true;
    this.disarm();
  }

  back(): void {
    if (this.reason === 'paused') this.actions.resume();
  }

  /**
   * Another system's button in the menu grid, before RESTART (e.g. PROGRESS,
   * SHOP). Hide it with `hidden`: hidden buttons are skipped by navigation.
   */
  addButton(label: string, icon: IconName, activate: () => void): HTMLButtonElement {
    const b = menuButton(label, { icon });
    this.grid.insertBefore(b, this.grid.querySelector('.risky'));
    this.nav.add({ el: b, activate });
    return b;
  }

  /** Offer the waiting update on the pause screen. */
  setUpdateReady(ready: boolean): void {
    this.update.hidden = !ready;
  }

  /** First press arms a run-losing button; a second within CONFIRM_MS does it. */
  private confirm(btn: HTMLButtonElement, prompt: string, run: () => void): void {
    if (this.armed === btn) {
      this.disarm();
      run();
      return;
    }
    this.disarm();
    this.armed = btn;
    btn.classList.add('armed');
    const label = btn.querySelector('b')!;
    btn.dataset.label = label.textContent ?? '';
    label.textContent = prompt;
    this.armTimer = window.setTimeout(() => this.disarm(), CONFIRM_MS);
  }

  private disarm(): void {
    window.clearTimeout(this.armTimer);
    const btn = this.armed;
    if (!btn) return;
    this.armed = null;
    btn.classList.remove('armed');
    btn.querySelector('b')!.textContent = btn.dataset.label ?? '';
  }
}
