import type { InputDevice } from '../core/input';
import './core.css';

export type PauseReason = 'paused' | 'contextLost';

/**
 * The pause screen: says how to resume on the device in use, offers a waiting
 * app update ("restart now"), and doubles as the "reloading graphics" notice
 * while the WebGL context is lost (when tapping can't resume). Sits above
 * the touch controls so a tap anywhere reaches it.
 */
export class PauseOverlay {
  private readonly title: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly update: HTMLButtonElement;
  private reason: PauseReason = 'paused';

  constructor(
    private readonly el: HTMLElement,
    onResume: () => void,
    onUpdate: () => void,
  ) {
    el.textContent = '';
    const card = document.createElement('div');
    card.className = 'pause-card';
    this.title = document.createElement('div');
    this.title.className = 'pause-title';
    this.hint = document.createElement('div');
    this.hint.className = 'pause-hint';
    this.update = document.createElement('button');
    this.update.className = 'pause-update';
    this.update.type = 'button';
    this.update.textContent = 'Update ready — restart now';
    this.update.hidden = true;
    card.append(this.title, this.hint, this.update);
    el.append(card);

    this.update.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onUpdate();
    });
    el.addEventListener('pointerdown', () => {
      if (this.reason === 'paused') onResume();
    });
  }

  show(reason: PauseReason, device: InputDevice): void {
    this.reason = reason;
    if (reason === 'contextLost') {
      this.title.textContent = 'Reloading graphics…';
      this.hint.textContent = 'The game will carry on in a moment';
    } else {
      this.title.textContent = 'Paused';
      this.hint.textContent =
        device === 'touch'
          ? 'Tap to resume'
          : device === 'gamepad'
            ? 'Press Start or A to resume'
            : 'Press P or Esc (or click) to resume';
    }
    this.el.classList.toggle('busy', reason === 'contextLost');
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  /** Offer the waiting update on the pause screen. */
  setUpdateReady(ready: boolean): void {
    this.update.hidden = !ready;
  }
}
