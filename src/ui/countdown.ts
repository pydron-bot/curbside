import type { GameAudio } from '../audio/gameAudio';

const STEP_MS = 650;

/**
 * A big 3-2-1-GO in the middle of the screen, with the audio's countdown
 * blips, so thumbs can get back into place before play resumes (after the
 * phone is turned back to landscape). Cancelable.
 */
export class Countdown {
  private readonly el: HTMLElement;
  private readonly num: HTMLElement;
  private timer = 0;
  private running = false;

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
  ) {
    const el = document.createElement('div');
    el.id = 'countdown';
    el.hidden = true;
    el.innerHTML = '<b></b>';
    parent.append(el);
    this.el = el;
    this.num = el.querySelector('b')!;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(done: () => void): void {
    this.cancel();
    this.running = true;
    this.el.hidden = false;
    let n = 3;
    const tick = () => {
      if (n > 0) {
        this.show(String(n), false);
        this.audio.ui('countdown');
        n--;
        this.timer = window.setTimeout(tick, STEP_MS);
      } else {
        this.show('GO!', true);
        this.audio.ui('go');
        this.running = false;
        done();
        this.timer = window.setTimeout(() => (this.el.hidden = true), STEP_MS);
      }
    };
    tick();
  }

  cancel(): void {
    window.clearTimeout(this.timer);
    this.running = false;
    this.el.hidden = true;
  }

  private show(text: string, go: boolean): void {
    this.num.textContent = text;
    this.num.classList.toggle('go', go);
    // Restart the pop animation.
    this.num.style.animation = 'none';
    void this.num.offsetWidth;
    this.num.style.animation = '';
  }
}
