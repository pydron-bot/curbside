import { ICONS } from './icons';

/**
 * "Rotate your phone": iOS ignores the manifest's landscape orientation and
 * screen.orientation.lock(), so on a touch screen held upright the game says
 * so full-screen (with an animated phone) and the caller pauses it. Turning
 * back to landscape calls onLandscape (the caller counts 3-2-1 and resumes).
 */
export class RotateOverlay {
  private readonly el: HTMLElement;
  private readonly portrait: MediaQueryList | null;
  private readonly coarse: MediaQueryList | null;
  private shown = false;

  constructor(
    parent: HTMLElement,
    private readonly onPortrait: () => void,
    private readonly onLandscape: () => void,
  ) {
    const el = document.createElement('div');
    el.id = 'rotate';
    el.hidden = true;
    el.innerHTML = `
      <div class="rotate-phone">${ICONS.phone}</div>
      <b>ROTATE YOUR PHONE</b>
      <span>Curbside plays in landscape</span>`;
    parent.append(el);
    this.el = el;
    this.portrait = window.matchMedia?.('(orientation: portrait)') ?? null;
    this.coarse = window.matchMedia?.('(pointer: coarse)') ?? null;
    const check = () => this.check();
    this.portrait?.addEventListener?.('change', check);
    window.addEventListener('resize', check);
  }

  get active(): boolean {
    return this.shown;
  }

  /** Re-evaluate (also runs on every orientation change / resize). */
  check(): void {
    const want = (this.coarse?.matches ?? false) && (this.portrait?.matches ?? false);
    if (want === this.shown) return;
    this.shown = want;
    this.el.hidden = !want;
    if (want) this.onPortrait();
    else this.onLandscape();
  }
}
