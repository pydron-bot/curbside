import './scanner.css';
import type { EventBus } from '../core/events';

/** The fade out, s (scanner.css's transition). */
const FADE = 0.3;

/**
 * The police scanner's subtitle (game/scanner.ts emits `scanner`): one
 * small line at the bottom, between the thumbs on touch (scanner.css), that
 * fades in, stays its `hold` and fades out. A story character's line mid-job
 * (`voice`: Todd in the passenger seat) takes the same slot under their
 * name, and the dispatcher waits for it (`speaking`). Timed by update() on the frame
 * clock, so it waits while paused; it writes to the DOM only when a line
 * comes or goes.
 */
export class ScannerHud {
  readonly el: HTMLElement;
  private readonly text: HTMLElement;
  private readonly who: HTMLElement;
  /** The line up is a story character's. */
  private story = false;
  /** Seconds left on screen; then FADE more until hidden. */
  private left = 0;
  private fading = false;

  constructor(parent: HTMLElement, bus: EventBus) {
    const el = document.createElement('div');
    el.id = 'scanner';
    el.hidden = true;
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="sc-box"><b class="sc-tag" aria-hidden="true"><i></i><span class="sc-who">SCANNER</span></b><span class="sc-text"></span></div>';
    parent.append(el);
    this.el = el;
    this.text = el.querySelector('.sc-text')!;
    this.who = el.querySelector('.sc-who')!;
    bus.on('scanner', (e) => this.show('SCANNER', e.text, e.hold, e.priority === 4 ? 'you' : e.priority === 3 ? 'hot' : 'city'));
    bus.on('voice', (e) => this.show(e.who, e.text, e.hold, 'story'));
  }

  /** A story character's line is on screen (the dispatcher holds his until it's gone). */
  get speaking(): boolean {
    return this.story && !this.el.hidden;
  }

  /** Per frame (not while paused). */
  update(dt: number): void {
    if (this.el.hidden) return;
    this.left -= dt;
    if (!this.fading && this.left <= 0) {
      this.fading = true;
      this.el.classList.remove('in');
    }
    if (this.left <= -FADE) {
      this.el.hidden = true;
      this.story = false;
    }
  }

  /** Down now (switched off, the title, observe mode). */
  clear(): void {
    this.left = 0;
    this.fading = true;
    this.el.classList.remove('in');
    this.el.hidden = true;
    this.story = false;
  }

  /** `tone`: the player's own lines (stars, lost, nicked) in the police's colours ('you'), a story character's 'story'. */
  private show(who: string, text: string, hold: number, tone: 'city' | 'hot' | 'you' | 'story'): void {
    this.who.textContent = who;
    this.text.textContent = text;
    this.el.dataset.tone = tone;
    this.story = tone === 'story';
    this.left = hold;
    this.fading = false;
    const was = this.el.hidden;
    this.el.hidden = false;
    // Next frame, so the fade in runs from the hidden state.
    if (was) requestAnimationFrame(() => !this.fading && this.el.classList.add('in'));
    else this.el.classList.add('in');
  }
}
