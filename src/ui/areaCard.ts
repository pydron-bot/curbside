/**
 * The area card: the district's name under the radar for a few seconds when
 * you cross into it ("NEON MILE"), with whose turf it is underneath ("VIPERS
 * TURF", red while they're out for you). game/modes/areaMode.ts decides when.
 */
import './progress.css';

const SHOW_MS = 2800;
const FADE_MS = 450;

export type AreaTone = 'plain' | 'turf' | 'hostile' | 'friendly';

export class AreaCard {
  private readonly el: HTMLElement;
  private readonly name: HTMLElement;
  private readonly sub: HTMLElement;
  private hideTimer = 0;
  private goneTimer = 0;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.id = 'area-card';
    el.hidden = true;
    el.innerHTML = '<b></b><small></small>';
    parent.append(el);
    this.el = el;
    this.name = el.querySelector('b')!;
    this.sub = el.querySelector('small')!;
  }

  show(name: string, sub: string, tone: AreaTone): void {
    this.name.textContent = name;
    this.sub.textContent = sub;
    this.sub.hidden = sub === '';
    this.el.dataset.tone = tone;
    window.clearTimeout(this.hideTimer);
    window.clearTimeout(this.goneTimer);
    this.el.hidden = false;
    // Next frame, so the slide-in runs from the hidden position.
    requestAnimationFrame(() => this.el.classList.add('in'));
    this.hideTimer = window.setTimeout(() => this.hide(), SHOW_MS);
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    if (this.el.hidden) return;
    this.el.classList.remove('in');
    this.goneTimer = window.setTimeout(() => (this.el.hidden = true), FADE_MS);
  }
}
