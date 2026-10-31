import type { GameAudio } from '../audio/gameAudio';
import { settings, updateSettings, type PlayerCharacter } from '../core/settings';
import { ICONS } from './icons';
import { MenuNav, overlay, type Panel } from './menu';

/** Front views in the player's colours (the GLBs' palette): the two bodies at a glance. */
const FIGURES: Record<PlayerCharacter, string> = {
  male: `<svg viewBox="0 0 60 100" aria-hidden="true">
    <rect x="21" y="60" width="8" height="30" rx="2" fill="#343e5c"/><rect x="31" y="60" width="8" height="30" rx="2" fill="#343e5c"/>
    <rect x="19" y="88" width="10" height="6" rx="2" fill="#1e1e1e"/><rect x="31" y="88" width="10" height="6" rx="2" fill="#1e1e1e"/>
    <rect x="8" y="27" width="8" height="30" rx="3" fill="#e6c43c"/><rect x="44" y="27" width="8" height="30" rx="3" fill="#e6c43c"/>
    <circle cx="12" cy="59" r="4" fill="#e0ac84"/><circle cx="48" cy="59" r="4" fill="#e0ac84"/>
    <rect x="15" y="25" width="30" height="37" rx="5" fill="#e6c43c"/>
    <circle cx="30" cy="14" r="9" fill="#e0ac84"/><path d="M21 13a9 9 0 0 1 18 0c-3-3-15-3-18 0z" fill="#281c16"/>
  </svg>`,
  female: `<svg viewBox="0 0 60 100" aria-hidden="true">
    <rect x="21" y="60" width="8" height="30" rx="2" fill="#343e5c"/><rect x="31" y="60" width="8" height="30" rx="2" fill="#343e5c"/>
    <rect x="20" y="88" width="9" height="6" rx="2" fill="#1e1e1e"/><rect x="31" y="88" width="9" height="6" rx="2" fill="#1e1e1e"/>
    <path d="M18 56h24l2 8H16z" fill="#343e5c"/>
    <rect x="11" y="28" width="7" height="28" rx="3" fill="#e6c43c"/><rect x="42" y="28" width="7" height="28" rx="3" fill="#e6c43c"/>
    <circle cx="14.5" cy="58" r="3.6" fill="#e0ac84"/><circle cx="45.5" cy="58" r="3.6" fill="#e0ac84"/>
    <path d="M18 26h24l-2 14-3 7 4 11H19l4-11-3-7z" fill="#e6c43c"/>
    <rect x="37" y="10" width="7" height="17" rx="3.5" fill="#281c16" transform="rotate(18 40 12)"/>
    <circle cx="30" cy="14" r="8.5" fill="#e0ac84"/><path d="M21.5 13a8.5 8.5 0 0 1 17 0c-3-3.5-14-3.5-17 0z" fill="#281c16"/>
  </svg>`,
};
const LABELS: Record<PlayerCharacter, string> = { male: 'MALE', female: 'FEMALE' };

/** Title → CHARACTER: pick the player's body. Saved at once (settings.character); the game redraws the player. */
export class CharacterPicker implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  readonly sheet = true;
  private readonly choices = new Map<PlayerCharacter, HTMLButtonElement>();
  private onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
  ) {
    const { root, card } = overlay('character', 'ui-sheet character-sheet');
    this.root = root;
    this.nav = new MenuNav(root);
    card.innerHTML = `
      <header class="sheet-head"><h2>CHARACTER</h2></header>
      <div class="sheet-body character-choices"></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.tabIndex = -1;
    close.className = 'sheet-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = ICONS.close;
    card.querySelector('.sheet-head')!.append(close);
    const list = card.querySelector('.character-choices')!;
    for (const c of ['male', 'female'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'character-choice';
      b.dataset.character = c;
      b.innerHTML = `${FIGURES[c]}<b></b>`;
      b.querySelector('b')!.textContent = LABELS[c];
      list.append(b);
      this.choices.set(c, b);
      this.nav.add({ el: b, activate: () => this.pick(c) });
    }
    this.nav.add({ el: close, activate: () => this.back() });
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(onClose: () => void, showFocus: boolean): void {
    this.onClose = onClose;
    this.mark();
    this.root.hidden = false;
    this.nav.focusElement(this.choices.get(settings.character)!);
    this.nav.showFocus(showFocus);
  }

  back(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.audio.ui('back');
    this.onClose();
  }

  hide(): void {
    this.root.hidden = true;
  }

  private pick(c: PlayerCharacter): void {
    this.audio.ui('confirm');
    if (c !== settings.character) updateSettings({ character: c });
    this.mark();
  }

  private mark(): void {
    for (const [c, b] of this.choices) {
      const on = c === settings.character;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
}
