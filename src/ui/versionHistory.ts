import type { GameAudio } from '../audio/gameAudio';
import { BUILD_ID } from '../core/build';
import { CHANGELOG, VERSION } from '../core/changelog';
import { ICONS } from './icons';
import { MenuNav, overlay, type Panel } from './menu';

/** Settings → Version history: every release, newest first, and the build that's running. */
export class VersionHistory implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  readonly sheet = true;
  private readonly body: HTMLElement;
  private onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
  ) {
    const { root, card } = overlay('versions', 'ui-sheet');
    this.root = root;
    this.nav = new MenuNav(root);
    card.innerHTML = `
      <header class="sheet-head"><h2>VERSION HISTORY</h2></header>
      <div class="sheet-body versions" data-scroll></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.tabIndex = -1;
    close.className = 'sheet-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = ICONS.close;
    card.querySelector('.sheet-head')!.append(close);
    this.nav.add({ el: close, activate: () => this.back() });
    this.body = card.querySelector('.versions')!;
    for (const r of CHANGELOG) {
      const el = document.createElement('section');
      el.className = `release${r.version === VERSION ? ' current' : ''}`;
      el.innerHTML = '<header><b></b><span></span><time></time></header><ul></ul>';
      el.querySelector('b')!.textContent = `v${r.version}`;
      el.querySelector('span')!.textContent = r.title;
      el.querySelector('time')!.textContent = r.date;
      const ul = el.querySelector('ul')!;
      for (const n of r.notes) {
        const li = document.createElement('li');
        li.textContent = n;
        ul.append(li);
      }
      this.body.append(el);
      // A stop for the keyboard / pad, so arrows scroll the list.
      this.nav.add({ el });
    }
    const build = document.createElement('footer');
    build.className = 'build-id';
    build.textContent = `Build ${BUILD_ID}`;
    this.body.append(build);
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(onClose: () => void, showFocus: boolean): void {
    this.onClose = onClose;
    this.root.hidden = false;
    this.body.scrollTop = 0;
    this.nav.focus();
    this.nav.showFocus(showFocus);
  }

  /** The stack under it is closing (the pause menu went away). */
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
