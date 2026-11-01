/**
 * CRED in play (rules in cred.ts): counts what each life does, turns it into
 * CRED on WASTED or BUSTED (the line and level bar on the death screen),
 * holds the respawn for LEVEL UP (perkCard.ts) and keeps the perks' effects
 * applied every sim step: NEUTRAL while a scored mode (the Chaos Run, a
 * race) runs, so bests and medals stay comparable. The bills and banked
 * chains read `fx` from the progress director.
 */
import { NEUTRAL, PERKS, PERK_RANKS, cashInMaxed, credForLife, levelFor, offerFor, pendingLevels, perkEffects, pick, rankOf, type PerkDef, type PerkEffects, type PerkId } from './cred';
import type { ModeCtx } from './modes/context';
import type { Vehicle } from './population';
import { PerkCard } from '../ui/perkCard';

/** LEVEL UP opens this long into the death screen (real time, s): once the life's numbers and its CRED have dropped in. */
export const PICK_AFTER = 1.7;

const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p])) as Record<PerkId, PerkDef>;

export class CredKeeper {
  /** What the perks do right now (NEUTRAL in a scored mode). */
  readonly fx: PerkEffects = { ...NEUTRAL };
  private readonly card: PerkCard;
  /** Counting a life (from a respawn to its WASTED / BUSTED). */
  private counting = false;
  private startScore = 0;
  private startCash = 0;
  private seconds = 0;
  private peak = 0;
  /** KEVLAR's armour is put on at the first step of a life (a Chaos Run has started by then). */
  private kitDue = false;
  /** Real seconds until LEVEL UP opens; < 0 when not waiting. */
  private pickIn = -1;
  /** The car BODYWORK is protecting (so it can be let go on the way out). */
  private car: Vehicle | null = null;

  constructor(
    private readonly ctx: ModeCtx,
    private readonly scored: () => boolean,
  ) {
    const d = ctx.deps;
    this.card = new PerkCard(document.body, d.audio);
    d.bus.on('respawn', () => this.newLife());
    d.bus.on('wanted', (e) => {
      if (this.counting) this.peak = Math.max(this.peak, e.level);
    });
    d.bus.on('playerDied', () => this.lifeOver(0));
    d.bus.on('busted', (e) => this.lifeOver(e.fine));
  }

  /** One sim step: count the life, refresh and apply the effects. */
  step(dt: number): void {
    const d = this.ctx.deps;
    if (this.counting) this.seconds += dt;
    if (this.scored()) Object.assign(this.fx, NEUTRAL);
    else perkEffects(this.ctx.progress.data.cred, this.fx);
    d.nitro.fill = this.fx.nitroFill;
    d.heat.bust.slow = this.fx.grabTime;
    d.heat.wanted.evadeScale = this.fx.evadeTime;
    const car = d.player.driving;
    if (car !== this.car) {
      if (this.car) this.car.damage.taken = 1;
      this.car = car;
    }
    if (car) car.damage.taken = this.fx.carDamage;
    if (this.kitDue) {
      this.kitDue = false;
      if (this.fx.armour > 0 && d.player.alive) d.player.addArmour(this.fx.armour);
    }
  }

  /** Per frame, real time: open LEVEL UP when its moment comes. */
  update(dt: number): void {
    if (this.pickIn < 0) return;
    this.pickIn -= dt;
    if (this.pickIn < 0) this.offer();
  }

  /** Quit to the title or a fresh start: nothing waiting (pending levels stay in the save for the next death). */
  reset(): void {
    this.pickIn = -1;
    this.counting = false;
    if (this.car) this.car.damage.taken = 1;
    this.car = null;
  }

  private newLife(): void {
    const d = this.ctx.deps;
    this.counting = d.playing();
    this.startScore = d.score.total;
    this.startCash = this.ctx.progress.stats.cashEarned;
    this.seconds = 0;
    this.peak = d.heat.wanted.level;
    this.kitDue = true;
    this.pickIn = -1;
  }

  /** WASTED or BUSTED (`fine`: the points the bust took off the score, which this life still scored). */
  private lifeOver(fine: number): void {
    const d = this.ctx.deps;
    if (!this.counting || !d.playing()) return;
    this.counting = false;
    const progress = this.ctx.progress;
    const c = progress.data.cred;
    const gained = credForLife({
      points: d.score.total + fine - this.startScore,
      seconds: this.seconds,
      peakStars: this.peak,
      cash: progress.stats.cashEarned - this.startCash,
    });
    const before = levelFor(c.total).level;
    c.total += gained;
    const now = levelFor(c.total);
    progress.markDirty();
    progress.flush();
    d.hud.wastedCred(gained, now.level, now.into, now.need, now.level > before);
    if (pendingLevels(c) > 0) this.pickIn = PICK_AFTER;
  }

  /** LEVEL UP, one level at a time; maxed-out levels pay cash instead. */
  private offer(): void {
    const ctx = this.ctx;
    const d = ctx.deps;
    const progress = ctx.progress;
    const c = progress.data.cred;
    for (let cash = cashInMaxed(c); cash > 0; cash = cashInMaxed(c)) ctx.pay(cash, 'cred', 'LEVEL UP');
    // Back on your feet already (or quit): it waits in the save for the next death screen.
    if (pendingLevels(c) === 0 || !d.playing() || (d.player.alive && !d.player.arrested)) {
      if (this.card.isOpen) this.close();
      progress.flush();
      return;
    }
    if (!this.card.isOpen) ctx.openModal(this.card);
    const choices = offerFor(c).map((id) => ({ def: PERK_BY_ID[id], rank: rankOf(c, id) }));
    this.card.show(c.picked + 1, choices, pendingLevels(c) - 1, ctx.focusRing, (id) => {
      if (!pick(c, id)) return;
      ctx.notice(`${PERK_BY_ID[id].name} ${rankOf(c, id)}/${PERK_RANKS}`, 'progress');
      progress.markDirty();
      this.offer();
    });
  }

  private close(): void {
    this.ctx.closeModal(this.card);
    this.card.hide();
  }
}
