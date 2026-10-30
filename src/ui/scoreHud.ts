import { COMBO_WINDOW, type Award, type Score } from '../systems/score';
import { styleSetter, textSetter } from './domWrite';

const BEST_KEY = 'curbside.best';

/** Best score from this device (0 if storage is unavailable). */
export function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(best: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch {
    // Private mode / blocked storage: the best score just won't persist.
  }
}

/**
 * Score readout (top left), combo badge with a draining bar, a live drift
 * counter, and floating "+400 NEAR MISS ×2" pop-ups.
 */
export class ScoreHud {
  private readonly totalEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly comboEl: HTMLElement;
  private readonly comboBar: HTMLElement;
  private readonly driftEl: HTMLElement;
  private readonly popups: HTMLElement;
  private shownTotal = -1;
  private startBest: number;
  private celebratedBest = false;
  private shownLive = false;
  private shownCombo = -1;
  private shownDrift = -1;
  private setComboBar: (width: string) => void;
  private setDrift: (text: string) => void;

  constructor(
    root: HTMLElement,
    private readonly score: Score,
  ) {
    const box = document.createElement('div');
    box.id = 'score';
    box.innerHTML = `
      <div class="score-total">0</div>
      <div class="score-best"></div>
      <div class="score-combo"><span>×1</span><div class="combo-bar"><div></div></div></div>
      <div class="score-drift"></div>`;
    root.append(box);
    this.totalEl = box.querySelector('.score-total')!;
    this.bestEl = box.querySelector('.score-best')!;
    this.comboEl = box.querySelector('.score-combo')!;
    this.comboBar = box.querySelector('.combo-bar > div')!;
    this.driftEl = box.querySelector('.score-drift')!;
    this.popups = document.createElement('div');
    this.popups.id = 'popups';
    root.append(this.popups);
    this.startBest = score.best;
    this.bestEl.textContent = score.best > 0 ? `BEST ${fmt(score.best)}` : '';
    this.setComboBar = styleSetter(this.comboBar, 'width');
    this.setDrift = textSetter(this.driftEl);
  }

  pop(a: Award): void {
    const el = document.createElement('div');
    el.className = `popup popup-${a.kind}`;
    el.textContent = `+${fmt(a.points)} ${a.label}${a.multiplier > 1 ? ` ×${a.multiplier}` : ''}`;
    el.addEventListener('animationend', () => el.remove());
    this.popups.append(el);
    while (this.popups.children.length > 4) this.popups.firstElementChild!.remove();

    if (!this.celebratedBest && this.startBest > 0 && this.score.total > this.startBest) {
      this.celebratedBest = true;
      const best = document.createElement('div');
      best.className = 'popup popup-best';
      best.textContent = 'NEW BEST!';
      best.addEventListener('animationend', () => best.remove());
      this.popups.append(best);
    }
    saveBest(this.score.best);
  }

  /** A fresh run after respawning: beating the best again is worth celebrating again. */
  newRun(): void {
    this.startBest = this.score.best;
    this.celebratedBest = false;
  }

  /** A pop-up without points, e.g. "+ PISTOL". */
  notice(text: string, kind = 'notice'): void {
    const el = document.createElement('div');
    el.className = `popup popup-${kind}`;
    el.textContent = text;
    el.addEventListener('animationend', () => el.remove());
    this.popups.append(el);
  }

  update(): void {
    const s = this.score;
    if (s.total !== this.shownTotal) {
      this.shownTotal = s.total;
      this.totalEl.textContent = fmt(s.total);
      if (s.best > 0) this.bestEl.textContent = `BEST ${fmt(s.best)}`;
    }
    // Only touch the DOM when something visible changed.
    const live = s.combo > 1 && s.comboTimer > 0;
    if (live !== this.shownLive) this.comboEl.classList.toggle('live', (this.shownLive = live));
    if (live) {
      if (s.combo !== this.shownCombo) this.comboEl.firstElementChild!.textContent = `×${(this.shownCombo = s.combo)}`;
      this.setComboBar(`${Math.round(Math.min(100, (s.comboTimer / COMBO_WINDOW) * 100))}%`);
    }
    const drift = s.driftPoints >= 10 ? Math.round(s.driftPoints) : 0;
    if (drift !== this.shownDrift) this.setDrift((this.shownDrift = drift) ? `DRIFT ${drift}` : '');
  }
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}
