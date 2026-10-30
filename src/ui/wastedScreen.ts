import { formatDuration, type RunStatsSnapshot } from '../game/runStats';
import { fmt } from './scoreHud';

export interface WastedSummary {
  /** WASTED (died) or BUSTED (arrested: a blue variant with the fine). */
  variant?: 'wasted' | 'busted';
  /** Points the arrest cost (BUSTED only). */
  fine?: number;
  score: number;
  best: number;
  newBest: boolean;
  stats: RunStatsSnapshot;
  /** Seconds until respawn, for the countdown bar. */
  respawnIn: number;
}

/**
 * The death screen: WASTED slams in over a darkened, drained-of-colour city,
 * then the life's numbers drop in one by one — score (with a NEW BEST stamp),
 * best, time alive, knockouts, cars wrecked — while a bar runs down to the
 * respawn. All of it is CSS animation (hud.css), restarted on each show.
 * Arrests reuse it as BUSTED, in police blue with the points lost (wanted.css);
 * the progress director adds what the life cost in cash (bill()).
 */
export class WastedScreen {
  private readonly el: HTMLElement;
  private readonly rows: Record<'score' | 'best' | 'time' | 'kos' | 'wrecks' | 'fine' | 'bill', HTMLElement>;
  private readonly billLabel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly badge: HTMLElement;

  constructor(root: HTMLElement) {
    const el = document.createElement('div');
    el.id = 'wasted';
    el.hidden = true;
    el.innerHTML = `
      <div class="wasted-slash"></div>
      <div class="wasted-title" data-text="WASTED">WASTED</div>
      <div class="wasted-stats">
        <div class="ws-row ws-score"><span>SCORE</span><b data-k="score"></b><em class="ws-badge">NEW BEST</em></div>
        <div class="ws-row"><span>BEST</span><b data-k="best"></b></div>
        <div class="ws-row"><span>TIME ALIVE</span><b data-k="time"></b></div>
        <div class="ws-row"><span>KNOCKOUTS</span><b data-k="kos"></b></div>
        <div class="ws-row"><span>CARS WRECKED</span><b data-k="wrecks"></b></div>
        <div class="ws-row ws-fine" hidden><span>POINTS LOST</span><b data-k="fine"></b></div>
        <div class="ws-row ws-bill" hidden><span></span><b data-k="bill"></b></div>
      </div>
      <div class="wasted-timer"><i></i></div>`;
    root.append(el);
    this.el = el;
    const k = (key: string) => el.querySelector<HTMLElement>(`[data-k="${key}"]`)!;
    this.rows = { score: k('score'), best: k('best'), time: k('time'), kos: k('kos'), wrecks: k('wrecks'), fine: k('fine'), bill: k('bill') };
    this.billLabel = el.querySelector('.ws-bill > span')!;
    this.title = el.querySelector('.wasted-title')!;
    this.bar = el.querySelector('.wasted-timer > i')!;
    this.badge = el.querySelector('.ws-badge')!;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(s: WastedSummary): void {
    const busted = s.variant === 'busted';
    const title = busted ? 'BUSTED' : 'WASTED';
    this.title.textContent = title;
    this.title.dataset.text = title;
    this.el.classList.toggle('busted', busted);
    // No points to lose, no fine line ("−0" reads like a glitch).
    this.rows.fine.textContent = `−${fmt(s.fine ?? 0)}`;
    this.rows.fine.parentElement!.hidden = !busted || !s.fine;
    this.rows.score.textContent = fmt(s.score);
    this.rows.best.textContent = fmt(s.best);
    this.rows.time.textContent = formatDuration(s.stats.timeAlive);
    this.rows.kos.textContent = String(s.stats.knockouts);
    this.rows.wrecks.textContent = String(s.stats.carsWrecked);
    this.badge.hidden = !s.newBest;
    this.bar.style.animationDuration = `${s.respawnIn}s`;
    // Restart the CSS animations from the top.
    this.el.hidden = true;
    void this.el.offsetWidth;
    this.el.hidden = false;
  }

  /** What the life cost in cash ('HOSPITAL', 'CASH FINE'), under the score's own loss; 0 hides it. */
  bill(label: string, amount: number): void {
    this.billLabel.textContent = label;
    this.rows.bill.textContent = `−$${fmt(amount)}`;
    this.rows.bill.parentElement!.hidden = amount <= 0;
  }

  hide(): void {
    this.el.hidden = true;
    this.rows.bill.parentElement!.hidden = true;
  }
}
