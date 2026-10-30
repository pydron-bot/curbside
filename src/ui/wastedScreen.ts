import { formatDuration, type RunStatsSnapshot } from '../game/runStats';
import { fmt } from './scoreHud';

export interface WastedSummary {
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
 */
export class WastedScreen {
  private readonly el: HTMLElement;
  private readonly rows: Record<'score' | 'best' | 'time' | 'kos' | 'wrecks', HTMLElement>;
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
      </div>
      <div class="wasted-timer"><i></i></div>`;
    root.append(el);
    this.el = el;
    const k = (key: string) => el.querySelector<HTMLElement>(`[data-k="${key}"]`)!;
    this.rows = { score: k('score'), best: k('best'), time: k('time'), kos: k('kos'), wrecks: k('wrecks') };
    this.bar = el.querySelector('.wasted-timer > i')!;
    this.badge = el.querySelector('.ws-badge')!;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(s: WastedSummary): void {
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

  hide(): void {
    this.el.hidden = true;
  }
}
