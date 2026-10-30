import './tokens.css';
import './progress.css';
import type { GameAudio } from '../audio/gameAudio';
import { hiddenSetter, textSetter } from './domWrite';
import { fmt } from './scoreHud';

/** A banner's tone: colours and how hard it slams in (progress.css). */
export type BannerTone = 'count' | 'go' | 'pass' | 'fail' | 'info' | 'gold';

/** How long a banner stays up, s (a countdown digit is replaced sooner). */
const BANNER_SECONDS = 2.2;
/** The cash counter rolls toward its target at this rate (1/s, exponential). */
const ROLL_RATE = 5;

/**
 * The progression HUD, plain DOM like the rest:
 *  - cash under the score (top right) as a rolling counter, with a "+$600"
 *    chip and the register's ching when money comes in;
 *  - the activity card, top centre under the pause button (the wanted stars
 *    step down below it, the radio card pushes it down): what you're doing,
 *    a big timer, and the goal / counter line;
 *  - a banner in the middle of the screen for 3-2-1-GO, PASSED / FAILED
 *    stings and bonuses;
 *  - a prompt pill above the bottom-centre HUD prompt for markers ("STOP
 *    HERE TO RACE").
 * Writes only what changed; nothing allocates per frame unless text changes.
 */
export class ProgressHud {
  private readonly cashEl: HTMLElement;
  private readonly cashNum: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly setLabel: (s: string) => void;
  private readonly setTimerText: (s: string) => void;
  private readonly setGoalText: (s: string) => void;
  private readonly setCardHidden: (h: boolean) => void;
  private readonly timerEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly bannerText: HTMLElement;
  private readonly bannerSub: HTMLElement;
  private readonly setPromptText: (s: string) => void;
  private readonly setPromptHidden: (h: boolean) => void;
  private cash = 0;
  private shownCash = 0;
  private shownCashText = -1;
  private bannerLeft = 0;
  private shownTimer = -2;
  private timerUrgent = false;
  private cardOn = false;
  private bonusEl: HTMLElement;

  constructor(
    parent: HTMLElement,
    scoreBox: HTMLElement,
    private readonly audio: GameAudio,
  ) {
    const cash = document.createElement('div');
    cash.className = 'cash';
    cash.innerHTML = '<i class="cash-chip"></i><b class="cash-num">$0</b>';
    // Under the score's BEST line, above the feed.
    const best = scoreBox.querySelector('.score-best');
    if (best) best.after(cash);
    else scoreBox.append(cash);
    this.cashEl = cash;
    this.cashNum = cash.querySelector('.cash-num')!;
    this.chip = cash.querySelector('.cash-chip')!;

    const card = document.createElement('div');
    card.id = 'activity';
    card.hidden = true;
    card.innerHTML = `
      <div class="act-top"><span class="act-label"></span><b class="act-timer"></b><i class="act-bonus"></i></div>
      <div class="act-goal"></div>`;
    parent.append(card);
    this.setLabel = textSetter(card.querySelector('.act-label')!);
    this.timerEl = card.querySelector('.act-timer')!;
    this.setTimerText = textSetter(this.timerEl);
    this.setGoalText = textSetter(card.querySelector('.act-goal')!);
    this.setCardHidden = hiddenSetter(card);
    this.bonusEl = card.querySelector('.act-bonus')!;

    const banner = document.createElement('div');
    banner.id = 'act-banner';
    banner.hidden = true;
    banner.innerHTML = '<b></b><small></small>';
    parent.append(banner);
    this.bannerEl = banner;
    this.bannerText = banner.querySelector('b')!;
    this.bannerSub = banner.querySelector('small')!;

    const prompt = document.createElement('div');
    prompt.id = 'act-prompt';
    prompt.hidden = true;
    parent.append(prompt);
    this.setPromptText = textSetter(prompt);
    this.setPromptHidden = hiddenSetter(prompt);
  }

  /** Set the cash shown; `roll` animates the counter (and chimes for income). */
  setCash(total: number, change = 0): void {
    this.cash = total;
    if (change === 0) {
      this.shownCash = total;
      this.writeCash();
      return;
    }
    this.chip.textContent = `${change > 0 ? '+' : '−'}$${fmt(Math.abs(change))}`;
    this.chip.className = `cash-chip ${change > 0 ? 'up' : 'down'}`;
    // Restart the chip's animation.
    void this.chip.offsetWidth;
    this.chip.classList.add('show');
    // Flash the figure (restart the animation).
    this.cashEl.classList.remove('up', 'down');
    void this.cashEl.offsetWidth;
    this.cashEl.classList.add(change > 0 ? 'up' : 'down');
    if (change > 0) this.audio.ui('cash');
  }

  /** Show the activity card with `label` (or hide it with null). */
  activity(label: string | null): void {
    const on = label !== null;
    if (on) this.setLabel(label);
    if (on !== this.cardOn) {
      this.cardOn = on;
      this.setCardHidden(!on);
      if (on) document.body.dataset.activity = '1';
      else delete document.body.dataset.activity;
      if (!on) {
        this.shownTimer = -2;
        this.setUrgent(false);
      }
    }
  }

  /**
   * The card's timer: seconds as m:ss (tenths under `tenthsBelow`), or null
   * to hide it. `urgent` turns it red and pulsing.
   */
  timer(seconds: number | null, urgent = false, tenthsBelow = 10): void {
    if (seconds === null) {
      if (this.shownTimer !== -1) {
        this.shownTimer = -1;
        this.setTimerText('');
      }
      this.setUrgent(false);
      return;
    }
    const s = Math.max(0, seconds);
    const tenths = s < tenthsBelow;
    // Odd keys for tenths, even for whole seconds: a switch always rewrites.
    const key = tenths ? Math.floor(s * 10) * 2 + 1 : Math.ceil(s) * 2;
    if (key !== this.shownTimer) {
      this.shownTimer = key;
      const t = Math.floor(s * 10);
      this.setTimerText(tenths ? `${s >= 60 ? clock(s) : Math.floor(s)}.${t % 10}` : clock(Math.ceil(s)));
    }
    this.setUrgent(urgent);
  }

  /** The goal / counter line under the timer. */
  goal(text: string): void {
    this.setGoalText(text);
  }

  /** "+5 s" popping beside the timer. */
  bonus(text: string): void {
    this.bonusEl.textContent = text;
    this.bonusEl.classList.remove('show');
    void this.bonusEl.offsetWidth;
    this.bonusEl.classList.add('show');
  }

  /** A big line in the middle of the screen (3-2-1, PASSED, FAILED...). */
  banner(text: string, tone: BannerTone, sub = '', seconds = BANNER_SECONDS): void {
    this.bannerText.textContent = text;
    this.bannerSub.textContent = sub;
    this.bannerSub.hidden = !sub;
    this.bannerEl.dataset.tone = tone;
    // Restart the slam-in animation.
    this.bannerEl.hidden = true;
    void this.bannerEl.offsetWidth;
    this.bannerEl.hidden = false;
    this.bannerLeft = seconds;
  }

  clearBanner(): void {
    this.bannerLeft = 0;
    this.bannerEl.hidden = true;
  }

  /** The marker prompt ("STOP HERE TO RACE"), or null to hide it. */
  prompt(text: string | null): void {
    this.setPromptHidden(text === null);
    if (text !== null) this.setPromptText(text);
  }

  /** Per frame (real time). */
  update(dt: number): void {
    if (this.shownCash !== this.cash) {
      const d = this.cash - this.shownCash;
      const step = d * (1 - Math.exp(-ROLL_RATE * dt));
      // At least $1 a frame, so the last few dollars don't crawl.
      this.shownCash += Math.abs(step) < 1 ? Math.sign(d) * Math.min(1, Math.abs(d)) : step;
      if (Math.abs(this.cash - this.shownCash) < 0.5) this.shownCash = this.cash;
      this.writeCash();
    }
    if (this.bannerLeft > 0 && (this.bannerLeft -= dt) <= 0) this.bannerEl.hidden = true;
  }

  private writeCash(): void {
    const n = Math.round(this.shownCash);
    if (n === this.shownCashText) return;
    this.shownCashText = n;
    this.cashNum.textContent = `$${fmt(n)}`;
  }

  private setUrgent(on: boolean): void {
    if (on === this.timerUrgent) return;
    this.timerUrgent = on;
    this.timerEl.classList.toggle('urgent', on);
  }
}

/** 75 → "1:15". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
