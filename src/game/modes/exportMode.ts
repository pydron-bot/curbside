/**
 * Hot-car exports on the screen: the docks garage is a drive-in bay glowing
 * orange (on the radar as '$', pulsing with an arrow while you sit in a car
 * on the list). Get into a wanted car and the feed says so; stop in the bay
 * clean (no stars) and the buyer pays by its health, the car's taken away
 * and the order ticked off (exports.ts). The whole list pays a bonus and a
 * new one comes in.
 */
import { speed } from '../../entities/vehicle';
import type { GlowSprites } from '../../render/glowSprites';
import { MARK, chevrons, groundRing, nearView, type ProgressProps } from '../../render/progressLook';
import { GLOW } from '../../render/glowSprites';
import { fmt } from '../../ui/scoreHud';
import type { City, Rect } from '../../world/city';
import { inShop, type SprayShop } from '../../world/landmarks';
import type { Vehicle } from '../population';
import { KeyedText, type Mode, type ModeCtx } from './context';
import { EXPORT_MIN_HEALTH, LIST_BONUS, exportList, exportPayout, openOrderFor, type ExportOrder } from './exports';
import { placeDocks } from './places';

/** Stopped in the bay this long to deliver, s. */
const HOLD = 0.6;
const STOP_SPEED = 3;
/** The car is craned away this long after the sale, s. */
const TAKE_AFTER = 1.4;
const PROMPT_RANGE = 22;
/** Why the buyer won't take a car (prompt lines). */
const REFUSALS = ['NOT ON THE LIST', 'LOSE THE HEAT FIRST', `TOO DAMAGED · NEEDS ${Math.round(EXPORT_MIN_HEALTH * 100)}%`] as const;

export class ExportMode implements Mode {
  readonly docks: SprayShop;
  private list: ExportOrder[];
  private listNo = 0;
  private held = 0;
  /** The car just sold, taken away shortly. */
  private sold: Vehicle | null = null;
  private soldIn = 0;
  /** The wanted car being driven (for the radar), if any. */
  private wanted: ExportOrder | null = null;
  private blip = '';
  private refused: (typeof REFUSALS)[number] | '' = '';
  private readonly promptText = new KeyedText();

  constructor(
    private readonly ctx: ModeCtx,
    city: City,
  ) {
    this.docks = placeDocks(city);
    this.list = exportList(ctx.progress.data.exports.lists);
    this.listNo = ctx.progress.data.exports.lists;
    ctx.deps.bus.on('enterVehicle', () => {
      if (!ctx.freeRoam) return;
      const v = ctx.deps.player.driving;
      const o = v ? this.orderFor(v) : null;
      if (o) ctx.notice(`EXPORT: ${o.label}`, 'progress');
    });
  }

  /** The current list with what's been delivered, for the PROGRESS page. */
  get orders(): ReadonlyArray<{ label: string; done: boolean }> {
    const done = this.ctx.progress.data.exports.done;
    return this.list.map((o) => ({ label: o.label, done: done.includes(o.id) }));
  }

  private orderFor(v: Vehicle): ExportOrder | null {
    return openOrderFor(this.list, this.ctx.progress.data.exports.done, v.archetype, v.paint, v.police === true);
  }

  step(dt: number): void {
    const ctx = this.ctx;
    if (this.sold && (this.soldIn -= dt) <= 0) {
      const v = this.sold;
      this.sold = null;
      const player = ctx.deps.player;
      if (player.driving !== v) {
        ctx.deps.population.retireVehicle(v);
        if (player.lastDriven === v) player.lastDriven = null;
      }
    }
    const car = ctx.deps.player.driving;
    this.wanted = ctx.freeRoam && car && !car.damage.wrecked ? this.orderFor(car) : null;
    this.syncBlip();
    this.refused = '';
    if (!car || !ctx.freeRoam || !ctx.live || ctx.busy === 'mission' || !inShop(this.docks, car.sim.x, car.sim.z, 1)) {
      this.held = 0;
      return;
    }
    if (speed(car.sim) > STOP_SPEED) {
      this.held = 0;
      return;
    }
    const order = this.wanted;
    const health = car.damage.health / car.damage.maxHealth;
    if (!order) this.refused = REFUSALS[0];
    else if (ctx.deps.heat.wanted.level > 0) this.refused = REFUSALS[1];
    else if (health < EXPORT_MIN_HEALTH) this.refused = REFUSALS[2];
    if (this.refused || (this.held += dt) < HOLD) return;
    this.held = 0;
    this.deliver(car, order!, health);
  }

  private deliver(car: Vehicle, order: ExportOrder, health: number): void {
    const ctx = this.ctx;
    const save = ctx.progress.data;
    const paid = ctx.pay(exportPayout(order, health), 'export', 'EXPORT');
    save.exports.done.push(order.id);
    save.stats.exportsDelivered++;
    ctx.ui.banner('SOLD!', 'pass', `${order.label} · +$${fmt(paid)}`);
    // Out you get; the crane takes it.
    ctx.deps.player.exit();
    this.sold = car;
    this.soldIn = TAKE_AFTER;
    if (save.exports.done.length >= this.list.length) {
      ctx.pay(LIST_BONUS, 'export', 'LIST BONUS');
      ctx.ui.banner('LIST COMPLETE!', 'gold', `+$${fmt(LIST_BONUS)} · A NEW LIST IS IN`, 3);
      ctx.deps.audio.ui('success');
      save.exports.lists++;
      save.exports.done = [];
      this.list = exportList(save.exports.lists);
      this.listNo = save.exports.lists;
    }
    ctx.progress.markDirty();
    ctx.progress.flush();
  }

  hud(): boolean {
    return false;
  }

  prompt(): string | null {
    const ctx = this.ctx;
    if (!ctx.freeRoam || ctx.busy === 'mission') return null;
    const at = ctx.deps.player.position;
    if (!this.refused && Math.hypot(at.x - this.docks.x, at.z - this.docks.z) > PROMPT_RANGE) return null;
    // Rebuilt only when what it says changes.
    const done = ctx.progress.data.exports.done;
    const key = (this.refused ? 1 + REFUSALS.indexOf(this.refused) : 0) * 1000 + (this.wanted ? 1 + this.list.indexOf(this.wanted) : 0) * 100 + done.length + this.listNo * 10000;
    const p = this.promptText;
    if (p.stale(key)) {
      if (this.refused) p.text = `DOCKS EXPORTS · ${this.refused}`;
      else if (this.wanted) p.text = `DOCKS EXPORTS · STOP IN THE BAY TO SELL THE ${this.wanted.label.replace(/^(A|ANY) /, '')}`;
      else {
        const open = this.list.filter((o) => !done.includes(o.id)).slice(0, 3).map((o) => o.label);
        p.text = `DOCKS EXPORTS ${done.length}/${this.list.length} · WANTED: ${open.join(', ')}`;
      }
    }
    return p.text;
  }

  glow(g: GlowSprites, _props: ProgressProps, view: Rect, t: number): void {
    if (!this.ctx.freeRoam) return;
    const s = this.docks;
    if (!nearView(s.x, s.z, view, 12)) return;
    const c = MARK.docks;
    const hot = this.wanted !== null;
    const k = (hot ? 1.1 : 0.7) * (0.75 + 0.25 * Math.sin(t * (hot ? 5 : 2)));
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const ax = fz;
    const az = -fx;
    for (let side = -1; side <= 1; side += 2) {
      g.addFlat(s.x + ax * s.halfWidth * side, 0.06, s.z + az * s.halfWidth * side, s.heading, 0.35, s.halfLength * 2, c[0] * k, c[1] * k, c[2] * k, GLOW.bar);
    }
    g.addFlat(s.x + fx * s.halfLength, 0.06, s.z + fz * s.halfLength, s.heading + Math.PI / 2, 0.35, s.halfWidth * 2, c[0] * k, c[1] * k, c[2] * k, GLOW.bar);
    groundRing(g, s.x, s.z, 4, c, k * 0.6, t * 0.3);
    chevrons(g, s.x - fx * 1.5, s.z - fz * 1.5, s.heading, c, k, t, s.halfLength + 3);
  }

  reset(): void {
    this.held = 0;
    this.refused = '';
  }

  /** '$' at the docks in free roam; pulsing with an arrow while you drive a wanted car. */
  private syncBlip(): void {
    const want = !this.ctx.freeRoam ? '' : this.wanted ? 'hot' : 'on';
    if (want === this.blip) return;
    this.blip = want;
    if (!want) {
      this.ctx.unblip('docks');
      return;
    }
    const hot = want === 'hot';
    this.ctx.blip('docks', { x: this.docks.x, z: this.docks.z, kind: 'marker', colour: '#ff8a2a', icon: '$', size: 6, pulse: hot, edgeArrow: hot });
  }
}
