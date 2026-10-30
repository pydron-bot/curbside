import './tokens.css';
import './progress.css';
import type { GameAudio } from '../audio/gameAudio';
import type { NavCommand } from '../core/input';
import type { DialogueLine } from '../systems/missions';
import type { Medal } from '../game/progressSave';
import { ICONS } from './icons';
import { MenuNav, menuButton, overlay, type Panel } from './menu';
import { fmt } from './scoreHud';

/** A results card's numbers (Chaos Run). */
export interface ResultsData {
  title: string;
  score: number;
  best: number;
  newBest: boolean;
  medal: Medal | null;
  /** Why it ended early ('' when the clock ran out). */
  why: string;
  /** Under the medal: what the next one takes, or the cash it banked. */
  note: string;
  rows: ReadonlyArray<{ label: string; count: number; points: number }>;
}

export interface ResultsActions {
  retry(): void;
  freeRoam(): void;
  title(): void;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Navigation for a page whose only button is its close: up / down scroll the
 * page (keyboard and gamepad have no other way to reach the bottom of it).
 */
class ScrollNav extends MenuNav {
  constructor(
    root: HTMLElement,
    private readonly page: () => HTMLElement,
  ) {
    super(root);
  }

  override handle(cmd: NavCommand): void {
    if (cmd !== 'up' && cmd !== 'down') return super.handle(cmd);
    this.showFocus(true);
    const page = this.page();
    page.scrollBy({ top: (cmd === 'down' ? 0.6 : -0.6) * page.clientHeight, behavior: 'smooth' });
  }
}

/** Close button for a sheet header, registered with its nav. */
function closeButton(nav: MenuNav, onClose: () => void): HTMLButtonElement {
  const close = document.createElement('button');
  close.type = 'button';
  close.tabIndex = -1;
  close.className = 'sheet-close';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = ICONS.close;
  nav.add({ el: close, activate: onClose });
  return close;
}

/**
 * The end of a timed run: the score, a medal stamped in, best / NEW BEST,
 * the breakdown by category, and one-tap RETRY (plus free roam or back to
 * the title). Shown over the frozen game.
 */
export class ResultsCard implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  private readonly card: HTMLElement;
  private readonly retryBtn: HTMLButtonElement;
  private actions: ResultsActions | null = null;

  constructor(parent: HTMLElement) {
    const { root, card } = overlay('results', 'prog-overlay');
    card.classList.add('prog-card', 'results-card');
    // Scrollable by touch if a short screen cuts it off (gestures.ts blocks the rest).
    card.dataset.scroll = '';
    this.root = root;
    this.card = card;
    this.nav = new MenuNav(root);
    const body = document.createElement('div');
    body.className = 'res-body';
    const actions = document.createElement('div');
    actions.className = 'prog-actions';
    this.retryBtn = menuButton('RETRY', { icon: 'restart', primary: true });
    const roam = menuButton('FREE ROAM', { icon: 'play' });
    const title = menuButton('TITLE', { icon: 'exit' });
    actions.append(this.retryBtn, roam, title);
    card.append(body, actions);
    this.nav.add({ el: this.retryBtn, activate: () => this.act('retry') });
    this.nav.add({ el: roam, activate: () => this.act('freeRoam') });
    this.nav.add({ el: title, activate: () => this.act('title') });
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(d: ResultsData, actions: ResultsActions, showFocus: boolean): void {
    this.actions = actions;
    const medal = d.medal ?? 'none';
    const rows = d.rows
      .map(
        (r, i) =>
          `<div class="res-row${r.points ? '' : ' zero'}" style="animation-delay:${0.5 + i * 0.06}s"><span>${escapeHtml(r.label)}</span><i>×${r.count}</i><b>${fmt(r.points)}</b></div>`,
      )
      .join('');
    this.card.querySelector('.res-body')!.innerHTML = `
      <div class="prog-head"><div class="prog-title">${escapeHtml(d.title)}</div><div class="prog-sub">${d.why ? 'RUN OVER' : "TIME'S UP"}</div></div>
      <div class="res-why">${escapeHtml(d.why)}</div>
      <div class="res-main">
        <div class="medal" data-medal="${medal}">${medal === 'none' ? 'NO MEDAL' : medal.toUpperCase()}</div>
        <div class="res-score">${fmt(d.score)}</div>
        <div class="res-side">
          <span>BEST <b>${fmt(d.best)}</b></span>
          <span class="res-new"${d.newBest ? '' : ' hidden'}>NEW BEST</span>
          <span>${escapeHtml(d.note)}</span>
        </div>
      </div>
      <div class="res-table">${rows}</div>`;
    this.root.hidden = false;
    this.nav.focusElement(this.retryBtn);
    this.nav.showFocus(showFocus);
  }

  hide(): void {
    this.root.hidden = true;
    this.actions = null;
  }

  /** B / Esc: nothing to go back to; the buttons say where to go. */
  back(): void {}

  private act(which: keyof ResultsActions): void {
    const a = this.actions;
    if (!a) return;
    this.hide();
    a[which]();
  }
}

/**
 * A phone call or a mission debrief: who's talking, a few lines, the
 * payout, and a button to carry on. Shown over the frozen game.
 */
export class DialogueCard implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  private readonly card: HTMLElement;
  private readonly okBtn: HTMLButtonElement;
  private done: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
  ) {
    const { root, card } = overlay('dialogue', 'prog-overlay');
    card.classList.add('prog-card', 'dlg-card');
    card.dataset.scroll = '';
    this.root = root;
    this.card = card;
    this.nav = new MenuNav(root);
    const body = document.createElement('div');
    body.className = 'dlg-body';
    this.okBtn = menuButton('CONTINUE', { icon: 'play', primary: true, className: 'dlg-ok' });
    const actions = document.createElement('div');
    actions.className = 'prog-actions';
    actions.append(this.okBtn);
    card.append(body, actions);
    this.nav.add({ el: this.okBtn, activate: () => this.back() });
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** kicker: small line over the title ('INCOMING CALL', 'MISSION PASSED'). */
  show(kicker: string, title: string, lines: readonly DialogueLine[], reward: string, button: string, showFocus: boolean, done: () => void): void {
    this.done = done;
    const who = (name: string) => (/TUNA/.test(name) ? 'tuna' : /PIKE/.test(name) ? 'pike' : 'vex');
    const lineHtml = lines
      .map(
        (l) =>
          `<div class="dlg-line" data-who="${who(l.who)}"><span class="dlg-who">${escapeHtml(l.who.replace(/[^A-Z]/g, '').slice(0, 1))}</span><span class="dlg-text"><b>${escapeHtml(l.who)}</b>${escapeHtml(l.text)}</span></div>`,
      )
      .join('');
    this.card.querySelector('.dlg-body')!.innerHTML = `
      <div class="prog-head"><div class="prog-title">${escapeHtml(title)}</div><div class="prog-sub">${escapeHtml(kicker)}</div></div>
      <div class="dlg-lines">${lineHtml}</div>
      <div class="dlg-reward">${escapeHtml(reward)}</div>`;
    this.okBtn.querySelector('b')!.textContent = button;
    this.root.hidden = false;
    this.nav.focusElement(this.okBtn);
    this.nav.showFocus(showFocus);
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Continue (also B / Esc). */
  back(): void {
    if (this.root.hidden) return;
    this.audio.ui('confirm');
    this.root.hidden = true;
    const d = this.done;
    this.done = null;
    d?.();
  }
}

/** One thing for sale, as the shop sheet shows it. */
export interface ShopEntry {
  id: string;
  name: string;
  blurb: string;
  price: number;
}

export interface ShopHooks {
  /** 'ok', 'owned' or 'broke' for each entry. */
  state(id: string): 'ok' | 'owned' | 'broke';
  /** Try to buy; true if it went through. */
  buy(id: string): boolean;
  cash(): number;
}

/** The safehouse shop: a sheet of upgrades and ammo, with your cash in the corner. */
export class ShopSheet implements Panel {
  readonly sheet = true;
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  private readonly list: HTMLElement;
  private readonly cashEl: HTMLElement;
  private readonly items = new Map<string, HTMLButtonElement>();
  private hooks: ShopHooks | null = null;
  private onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
    entries: readonly ShopEntry[],
  ) {
    const { root, card } = overlay('shop', 'ui-sheet');
    this.root = root;
    this.nav = new MenuNav(root);
    card.innerHTML = `
      <header class="sheet-head"><h2>SAFEHOUSE</h2><b class="sheet-cash"></b></header>
      <div class="sheet-body" data-scroll><div class="shop-list"></div></div>`;
    card.querySelector('.sheet-head')!.append(closeButton(this.nav, () => this.back()));
    this.cashEl = card.querySelector('.sheet-cash')!;
    this.list = card.querySelector('.shop-list')!;
    for (const e of entries) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'shop-item';
      b.innerHTML = '<span><b></b><small></small></span><span class="shop-price"></span>';
      b.querySelector('b')!.textContent = e.name;
      b.querySelector('small')!.textContent = e.blurb;
      b.querySelector('.shop-price')!.textContent = `$${fmt(e.price)}`;
      this.list.append(b);
      this.items.set(e.id, b);
      this.nav.add({ el: b, activate: () => this.buy(e.id) });
    }
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(hooks: ShopHooks, onClose: () => void, showFocus: boolean): void {
    this.hooks = hooks;
    this.onClose = onClose;
    this.refresh();
    this.root.hidden = false;
    this.nav.focus();
    this.nav.showFocus(showFocus);
  }

  hide(): void {
    this.root.hidden = true;
  }

  back(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.audio.ui('back');
    this.onClose();
  }

  private buy(id: string): void {
    const h = this.hooks;
    if (!h) return;
    const el = this.items.get(id)!;
    if (h.buy(id)) {
      el.classList.remove('bought');
      void el.offsetWidth;
      el.classList.add('bought');
    } else this.audio.ui('fail');
    this.refresh();
  }

  private refresh(): void {
    const h = this.hooks;
    if (!h) return;
    this.cashEl.textContent = `$${fmt(h.cash())}`;
    for (const [id, el] of this.items) {
      const state = h.state(id);
      el.dataset.state = state;
      if (state === 'owned') el.querySelector('.shop-price')!.textContent = 'OWNED';
    }
  }
}

/** The PROGRESS page's content, built by the caller. */
export interface StatsModel {
  completion: number;
  cash: number;
  /** Groups of rows: [label, value, optional 0..1 bar, optional medal]. */
  sections: ReadonlyArray<{ title: string; rows: ReadonlyArray<{ label: string; value: string; bar?: number; medal?: Medal | null }>; chips?: ReadonlyArray<{ text: string; done: boolean }> }>;
}

/** PROGRESS: completion, cash, bests and medals, activities and lifetime stats. */
export class StatsSheet implements Panel {
  readonly sheet = true;
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  private readonly body: HTMLElement;
  private onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
  ) {
    const { root, card } = overlay('progress', 'ui-sheet');
    this.root = root;
    this.nav = new ScrollNav(root, () => this.body);
    card.innerHTML = `
      <header class="sheet-head"><h2>PROGRESS</h2></header>
      <div class="sheet-body" data-scroll></div>`;
    card.querySelector('.sheet-head')!.append(closeButton(this.nav, () => this.back()));
    this.body = card.querySelector('.sheet-body')!;
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(m: StatsModel, onClose: () => void, showFocus: boolean): void {
    this.onClose = onClose;
    const pct = Math.round(m.completion * 100);
    const sections = m.sections
      .map((s) => {
        const rows = s.rows
          .map(
            (r) =>
              `<div class="stat"><span>${escapeHtml(r.label)}${r.medal ? `<i class="stat-medal" data-medal="${r.medal}"></i>` : ''}</span><b>${escapeHtml(r.value)}</b>${
                r.bar !== undefined ? `<div class="stat-bar"><i style="transform:scaleX(${Math.max(0, Math.min(1, r.bar)).toFixed(3)})"></i></div>` : ''
              }</div>`,
          )
          .join('');
        const chips = s.chips ? `<div class="export-list">${s.chips.map((c) => `<span${c.done ? ' class="done"' : ''}>${escapeHtml(c.text)}</span>`).join('')}</div>` : '';
        return `<h3>${escapeHtml(s.title)}</h3>${rows}${chips}`;
      })
      .join('');
    this.body.innerHTML = `
      <div class="stats-top">
        <div class="stats-ring"><svg viewBox="0 0 80 80" aria-hidden="true"><defs><linearGradient id="stats-grad"><stop offset="0" stop-color="#2ee6ff"/><stop offset="1" stop-color="#ff2e88"/></linearGradient></defs><circle class="track" cx="40" cy="40" r="32" pathLength="100"/><circle class="fill" cx="40" cy="40" r="32" pathLength="100" style="stroke-dasharray:${pct} 200"/></svg><b>${pct}%</b></div>
        <div class="stats-headline"><span>COMPLETION</span><b>$${fmt(m.cash)}</b><span>CASH</span></div>
      </div>
      <div class="stats-grid">${sections}</div>`;
    this.body.scrollTop = 0;
    this.root.hidden = false;
    this.nav.focus();
    this.nav.showFocus(showFocus);
  }

  hide(): void {
    this.root.hidden = true;
  }

  back(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.audio.ui('back');
    this.onClose();
  }
}
