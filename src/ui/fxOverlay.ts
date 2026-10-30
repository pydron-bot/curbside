import './fx.css';

/**
 * Screen-edge flashes over the game view for big moments (combo milestones):
 * one absolutely positioned layer, animated with the Web Animations API so a
 * flash costs no layout and nothing runs between flashes. Silently does
 * nothing where element.animate is missing.
 */
export class FxOverlay {
  private readonly edge: HTMLElement;
  private anim: Animation | null = null;
  /** "Reduce motion": flashes are softer (read per flash, so a change applies at once). */
  private readonly reduced: MediaQueryList | null;

  constructor(parent: HTMLElement) {
    this.edge = document.createElement('div');
    this.edge.className = 'fx-edge';
    this.edge.setAttribute('aria-hidden', 'true');
    parent.append(this.edge);
    this.reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  }

  /** Flash the screen edges in `colour` (CSS); `strength` 0..1 sets thickness and how long it lingers. */
  edgeFlash(colour: string, strength = 1): void {
    const el = this.edge;
    if (typeof el.animate !== 'function') return;
    el.style.setProperty('--fx-c', colour);
    el.style.setProperty('--fx-k', String(strength));
    this.anim?.cancel();
    const peak = this.reduced?.matches ? 0.45 : 1;
    this.anim = el.animate(
      [
        { opacity: 0 },
        { opacity: peak, offset: 0.12 },
        { opacity: 0.55 * peak, offset: 0.45 },
        { opacity: 0 },
      ],
      { duration: 420 + 380 * strength, easing: 'ease-out' },
    );
  }
}
