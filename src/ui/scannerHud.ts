import './scanner.css';
import type { EventBus, EventOf } from '../core/events';

/** The fade out, s (scanner.css's transition). */
const FADE = 0.3;

/**
 * The police scanner's subtitle (game/scanner.ts emits `scanner`): one
 * small line at the bottom, between the thumbs on touch (scanner.css), that
 * fades in, stays its `hold` and fades out. Timed by update() on the frame
 * clock, so it waits while paused; it writes to the DOM only when a line
 * comes or goes.
 */
export class ScannerHud {
  readonly el: HTMLElement;
  private readonly text: HTMLElement;
  /** Seconds left on screen; then FADE more until hidden. */
  private left = 0;
  private fading = false;

  constructor(parent: HTMLElement, bus: EventBus) {
    const el = document.createElement('div');
    el.id = 'scanner';
    el.hidden = true;
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="sc-box"><b class="sc-tag" aria-hidden="true"><i></i>SCANNER</b><span class="sc-text"></span></div>';
    parent.append(el);
    this.el = el;
    this.text = el.querySelector('.sc-text')!;
    bus.on('scanner', (e) => this.show(e));
  }

  /** Per frame (not while paused). */
  update(dt: number): void {
    if (this.el.hidden) return;
    this.left -= dt;
    if (!this.fading && this.left <= 0) {
      this.fading = true;
      this.el.classList.remove('in');
    }
    if (this.left <= -FADE) this.el.hidden = true;
  }

  /** Down now (switched off, the title, observe mode). */
  clear(): void {
    this.left = 0;
    this.fading = true;
    this.el.classList.remove('in');
    this.el.hidden = true;
  }

  private show(e: EventOf<'scanner'>): void {
    this.text.textContent = e.text;
    // The player's own lines (stars, lost, nicked) in the police's colours.
    this.el.dataset.tone = e.priority === 4 ? 'you' : e.priority === 3 ? 'hot' : 'city';
    this.left = e.hold;
    this.fading = false;
    const was = this.el.hidden;
    this.el.hidden = false;
    // Next frame, so the fade in runs from the hidden state.
    if (was) requestAnimationFrame(() => !this.fading && this.el.classList.add('in'));
    else this.el.classList.add('in');
  }
}
