/**
 * Menu building blocks shared by the title, pause, settings and how-to
 * screens: MenuNav moves a focus highlight between items with the keyboard or
 * a gamepad (spatially, so grids and two-column layouts just work), and
 * left/right adjust sliders and choices. Pointer input goes straight to the
 * DOM (onTap: a touch tap acts even with a thumb on the stick, a mouse
 * clicks); keyboard and pad arrive as NavCommands from Input, never as
 * native focus, so Enter can't double-activate a focused button.
 */
import './tokens.css';
import './menu.css';
import type { NavCommand } from '../core/input';
import { ICONS, type IconName } from './icons';
import { onTap } from './tap';

export interface NavItem {
  el: HTMLElement;
  /** Enter / A / tap / click. */
  activate?(): void;
  /** Activate on the browser's click only, never a pointer tap (a probe that measures click). */
  clickOnly?: boolean;
  /** Left / right on an adjustable item (slider, choice, toggle). */
  adjust?(dir: -1 | 1): void;
}

export class MenuNav {
  private items: NavItem[] = [];
  private current: NavItem | null = null;

  constructor(private readonly root: HTMLElement) {
    // A pointer user doesn't need the keyboard highlight.
    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') this.showFocus(false);
    });
  }

  /** Register an item; a tap or click on it activates it, hovering it with a mouse focuses it. */
  add(item: NavItem): NavItem {
    this.items.push(item);
    item.el.classList.add('nav-item');
    if (item.activate) {
      onTap(
        item.el,
        () => {
          this.focus(item);
          item.activate?.();
        },
        { clickOnly: item.clickOnly },
      );
    }
    item.el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && this.current !== item) this.focus(item);
    });
    return item;
  }

  remove(el: HTMLElement): void {
    this.items = this.items.filter((i) => i.el !== el);
    if (this.current?.el === el) this.current = null;
  }

  /** Highlight the first visible item (or `item`). */
  focus(item?: NavItem | null): void {
    const target = item ?? this.visible()[0] ?? null;
    if (this.current === target) return;
    this.current?.el.classList.remove('nav-focus');
    this.current = target;
    target?.el.classList.add('nav-focus');
  }

  /** Highlight the item for `el`, if it's one of ours. */
  focusElement(el: HTMLElement): void {
    const item = this.items.find((i) => i.el === el);
    if (item) this.focus(item);
  }

  /** Whether the highlight ring shows (keyboard / gamepad in use). */
  showFocus(show: boolean): void {
    this.root.classList.toggle('nav-visible', show);
  }

  /** Apply a keyboard / gamepad command (not 'back': the screen decides what that means). */
  handle(cmd: NavCommand): void {
    this.showFocus(true);
    const items = this.visible();
    if (items.length === 0) return;
    if (!this.current || !items.includes(this.current)) {
      this.focus(items[0]);
      if (cmd !== 'confirm') return;
    }
    const cur = this.current!;
    if (cmd === 'confirm') {
      cur.activate?.();
      return;
    }
    if ((cmd === 'left' || cmd === 'right') && cur.adjust) {
      cur.adjust(cmd === 'left' ? -1 : 1);
      return;
    }
    const next = nearest(cur, items, cmd);
    if (!next) return;
    this.focus(next);
    // In a scrolling sheet (Diagnostics at 340 high) the keyboard can move below the fold.
    next.el.scrollIntoView?.({ block: 'nearest' });
  }

  private visible(): NavItem[] {
    return this.items.filter((i) => i.el.getClientRects().length > 0 && !i.el.hasAttribute('disabled'));
  }
}

/** The best item from `cur` in direction `cmd`; up/down wrap around. */
function nearest(cur: NavItem, items: NavItem[], cmd: NavCommand): NavItem | null {
  const a = cur.el.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const vertical = cmd === 'up' || cmd === 'down';
  const sign = cmd === 'down' || cmd === 'right' ? 1 : -1;
  let best: NavItem | null = null;
  let bestScore = Infinity;
  let wrap: NavItem | null = null;
  let wrapScore = Infinity;
  for (const it of items) {
    if (it === cur) continue;
    const b = it.el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax;
    const dy = b.top + b.height / 2 - ay;
    const along = vertical ? dy * sign : dx * sign;
    const across = Math.abs(vertical ? dx : dy);
    if (along > 4) {
      const score = along + across * 2.2;
      // Near-ties (a wide button above two half-width ones) go to the item
      // registered first, i.e. the left / upper one.
      if (score < bestScore - 1) {
        bestScore = score;
        best = it;
      }
    } else if (vertical) {
      // Furthest the other way, for wrapping round a list.
      const score = along + across * 0.01;
      if (score < wrapScore) {
        wrapScore = score;
        wrap = it;
      }
    }
  }
  return best ?? wrap;
}

/** A menu button with an optional icon. */
export function menuButton(label: string, opts: { icon?: IconName; primary?: boolean; sub?: string; className?: string } = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.tabIndex = -1;
  b.className = `mbtn${opts.primary ? ' primary' : ''}${opts.className ? ` ${opts.className}` : ''}`;
  b.innerHTML = `${opts.icon ? `<span class="mbtn-icon">${ICONS[opts.icon]}</span>` : ''}<span class="mbtn-text"><b></b>${opts.sub !== undefined ? '<small></small>' : ''}</span>`;
  b.querySelector('b')!.textContent = label;
  if (opts.sub !== undefined) b.querySelector('small')!.textContent = opts.sub;
  return b;
}

/** A screen-sized overlay with a panel inside; hidden until opened. */
export function overlay(id: string, className = ''): { root: HTMLElement; card: HTMLElement } {
  const root = document.createElement('div');
  root.id = id;
  root.className = `ui-overlay ${className}`.trim();
  root.hidden = true;
  const card = document.createElement('div');
  card.className = 'ui-card';
  root.append(card);
  return { root, card };
}

/** One screen in the menu stack. */
export interface Panel {
  readonly nav: MenuNav;
  /** Back / Esc / B. */
  back(): void;
  /** Hide without the back action (the stack under it is closing). */
  hide?(): void;
  /** A sheet: Pause / Esc backs out of it (like settings) instead of pausing over it. */
  readonly sheet?: boolean;
}
