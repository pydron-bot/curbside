import './stamp.css';
import type { EventBus, EventOf } from '../core/events';
import { STAMPS } from '../systems/stamps';

/** Labels longer than this get the smaller size. */
const LONG = 14;

/**
 * The named-mayhem stamp (game/stamps.ts emits `stamp`): one element,
 * built once and reused, slammed onto the middle of the view by a CSS
 * animation that fades itself out. A new stamp swaps the label and
 * restarts the animation; nothing runs between stamps.
 */
export class StampHud {
  readonly el: HTMLElement;
  private readonly box: HTMLElement;
  private readonly label: HTMLElement;
  private readonly sub: HTMLElement;
  private flip = false;

  constructor(parent: HTMLElement, bus: EventBus) {
    const el = document.createElement('div');
    el.id = 'stamp';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="stamp-box"><b></b><small></small></div>';
    parent.append(el);
    this.el = el;
    this.box = el.querySelector('.stamp-box')!;
    this.label = this.box.querySelector('b')!;
    this.sub = this.box.querySelector('small')!;
    bus.on('stamp', (e) => this.show(e));
    // Gone with the life it was for.
    bus.on('respawn', () => this.clear());
  }

  private show(e: EventOf<'stamp'>): void {
    const def = STAMPS[e.id];
    this.label.textContent = def.label;
    this.sub.textContent = def.sub;
    this.box.dataset.tone = def.tone;
    this.box.classList.toggle('long', def.label.length > LONG);
    this.flip = !this.flip;
    this.box.classList.toggle('a', this.flip);
    this.box.classList.toggle('b', !this.flip);
  }

  private clear(): void {
    this.box.classList.remove('a', 'b');
  }
}
