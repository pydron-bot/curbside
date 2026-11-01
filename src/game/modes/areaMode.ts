/**
 * Where you are: when you cross into another district and stay there a
 * moment (the borders wobble, so a road along one shouldn't flash cards),
 * the area card under the radar names it, with whose turf it is. Also once
 * at the start of a run. Free roam only, and never over a card.
 */
import type { AreaCard, AreaTone } from '../../ui/areaCard';
import { DISTRICT_NAMES, districtAt, type District } from '../../world/districts';
import { gangOn } from '../gangs';
import type { GangMode } from './gangMode';
import type { Mode, ModeCtx } from './context';

/** In the new district this long before the card shows, s. */
export const SETTLE = 1.2;

/**
 * Debounces district changes: feed it the district under the player every
 * step; it says which one to announce (once per change, after SETTLE s).
 */
export class AreaTracker {
  private shown: District | null = null;
  private candidate: District | null = null;
  private held = 0;

  update(d: District, dt: number): District | null {
    if (d !== this.candidate) {
      this.candidate = d;
      this.held = 0;
    }
    this.held += dt;
    if (d === this.shown || this.held < SETTLE) return null;
    this.shown = d;
    return d;
  }

  reset(): void {
    this.shown = this.candidate = null;
    this.held = 0;
  }
}

export class AreaMode implements Mode {
  private readonly tracker = new AreaTracker();

  constructor(
    private readonly ctx: ModeCtx,
    private readonly card: AreaCard,
    private readonly gangs: GangMode,
  ) {}

  step(dt: number): void {
    const ctx = this.ctx;
    if (!ctx.freeRoam || !ctx.live) return;
    const at = ctx.deps.player.position;
    const d = this.tracker.update(districtAt(at.x, at.z), dt);
    if (d) this.show(d);
  }

  private show(d: District): void {
    const g = gangOn(d);
    let sub = '';
    let tone: AreaTone = 'plain';
    if (g) {
      const s = this.gangs.standing(g.id);
      sub = s === 'hostile' ? `${g.name} TURF · HOSTILE` : s === 'friendly' ? `${g.name} TURF · FRIENDLY` : `${g.name} TURF`;
      tone = s === 'hostile' ? 'hostile' : s === 'friendly' ? 'friendly' : 'turf';
    }
    this.card.show(DISTRICT_NAMES[d], sub, tone);
  }

  hud(): boolean {
    return false;
  }

  prompt(): string | null {
    return null;
  }

  glow(): void {}

  reset(): void {
    this.tracker.reset();
    this.card.hide();
  }
}
