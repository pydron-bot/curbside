import './progress.css';
import type { GameAudio } from '../audio/gameAudio';
import { PERK_RANKS, type PerkDef, type PerkId } from '../game/cred';
import { MenuNav, overlay, type Panel } from './menu';

/** One perk on offer, with the rank the player holds now. */
export interface PerkChoice {
  def: PerkDef;
  rank: number;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * LEVEL UP on the death screen: three perks side by side, each with its
 * group, name, rank pips (the one you'd gain lit) and what it adds up to
 * at that rank. Tap one (or arrows and confirm). There's no back: a level
 * is always cashed in. Shown over the frozen game, so the respawn waits.
 */
export class PerkCard implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  private readonly head: HTMLElement;
  private readonly row: HTMLElement;
  private onPick: ((id: PerkId) => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
  ) {
    const { root, card } = overlay('perks', 'prog-overlay');
    card.classList.add('prog-card', 'perk-card');
    card.dataset.scroll = '';
    this.root = root;
    this.nav = new MenuNav(root);
    this.head = document.createElement('div');
    this.head.className = 'prog-head';
    this.row = document.createElement('div');
    this.row.className = 'perk-row';
    card.append(this.head, this.row);
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** `level` is the one being cashed in; `more` how many are still waiting after it. */
  show(level: number, choices: readonly PerkChoice[], more: number, showFocus: boolean, onPick: (id: PerkId) => void): void {
    this.onPick = onPick;
    this.head.innerHTML = `<div class="prog-title">LEVEL ${level}</div><div class="prog-sub">${more > 0 ? `PICK A PERK · ${more} MORE` : 'PICK A PERK'}</div>`;
    for (const el of [...this.row.children]) this.nav.remove(el as HTMLElement);
    this.row.replaceChildren();
    let first: HTMLElement | null = null;
    for (const [i, c] of choices.entries()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'perk-choice';
      b.dataset.group = c.def.group.toLowerCase();
      b.style.animationDelay = `${0.08 * i}s`;
      const pips = Array.from({ length: PERK_RANKS }, (_, r) => `<i class="${r < c.rank ? 'on' : r === c.rank ? 'next' : ''}"></i>`).join('');
      b.innerHTML = `<small>${escapeHtml(c.def.group)}</small><b>${escapeHtml(c.def.name)}</b><span class="perk-pips">${pips}</span><span class="perk-says">${escapeHtml(c.def.says(c.rank + 1))}</span>`;
      this.row.append(b);
      this.nav.add({ el: b, activate: () => this.choose(c.def.id) });
      first ??= b;
    }
    this.root.hidden = false;
    if (first) this.nav.focusElement(first);
    this.nav.showFocus(showFocus);
  }

  hide(): void {
    this.root.hidden = true;
    this.onPick = null;
  }

  /** B / Esc: nothing to go back to; a level is always cashed in. */
  back(): void {}

  private choose(id: PerkId): void {
    const f = this.onPick;
    if (!f) return;
    this.audio.ui('confirm');
    f(id);
  }
}
