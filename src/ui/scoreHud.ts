import { COMBO_WINDOW, type Award, type Score } from '../systems/score';
import { textSetter } from './domWrite';

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

/** A feed line stays this long after its last update, s. */
const LINE_LIFE = 1.9;
/** ...then fades out over this long, s. */
const LINE_FADE = 0.3;
/** Lines on screen at once (a third may be fading out). */
const MAX_LINES = 2;

interface FeedLine {
  el: HTMLElement;
  label: HTMLElement;
  points: HTMLElement;
  kind: string;
  text: string;
  count: number;
  total: number;
  /** Seconds left before it starts fading; negative while fading. */
  life: number;
}

/** Combo multiplier → colour tier for the badge. */
const comboTier = (c: number) => (c >= 8 ? 3 : c >= 5 ? 2 : c >= 3 ? 1 : 0);

/**
 * Score readout (top right): the run total punches on every award; the combo
 * badge's ring drains toward the chain breaking; and a two-line rolling feed
 * says what scored. Repeats of the same kind merge into one line
 * ("NEAR MISS ×3 +450") instead of stacking, and the feed sits under the
 * score in the corner, never over the player.
 */
export class ScoreHud {
  readonly el: HTMLElement;
  private readonly totalEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly comboEl: HTMLElement;
  private readonly comboText: HTMLElement;
  private readonly comboRing: SVGCircleElement;
  private readonly feed: HTMLElement;
  private readonly lines: FeedLine[] = [];
  private readonly pool: FeedLine[] = [];
  private readonly drift: FeedLine;
  private shownTotal = -1;
  private startBest: number;
  private celebratedBest = false;
  private shownLive = false;
  private shownCombo = -1;
  private shownRing = -1;
  private shownDrift = -1;
  private readonly setDriftPoints: (s: string) => void;

  constructor(
    root: HTMLElement,
    private readonly score: Score,
  ) {
    const box = document.createElement('div');
    box.id = 'score';
    box.innerHTML = `
      <div class="score-row">
        <div class="combo"><svg viewBox="0 0 40 40" aria-hidden="true"><circle class="combo-track" cx="20" cy="20" r="17"/><circle class="combo-ring" cx="20" cy="20" r="17" pathLength="100"/></svg><b>×1</b></div>
        <div class="score-total">0</div>
      </div>
      <div class="score-best"></div>
      <div class="score-feed"></div>`;
    root.append(box);
    this.el = box;
    this.totalEl = box.querySelector('.score-total')!;
    this.bestEl = box.querySelector('.score-best')!;
    this.comboEl = box.querySelector('.combo')!;
    this.comboText = this.comboEl.querySelector('b')!;
    this.comboRing = this.comboEl.querySelector('.combo-ring')!;
    this.feed = box.querySelector('.score-feed')!;
    this.startBest = score.best;
    this.bestEl.textContent = score.best > 0 ? `BEST ${fmt(score.best)}` : '';
    // The live drift counter is a line of its own, shown while sliding.
    this.drift = this.makeLine();
    this.drift.el.classList.add('feed-drift', 'live');
    this.drift.label.textContent = 'DRIFT';
    this.setDriftPoints = textSetter(this.drift.points);
  }

  pop(a: Award): void {
    this.push(a.kind, a.label, a.points);
    if (!this.celebratedBest && this.startBest > 0 && this.score.total > this.startBest) {
      this.celebratedBest = true;
      this.push('best', 'NEW BEST!', 0);
      this.bestEl.classList.add('beaten');
    }
    saveBest(this.score.best);
  }

  /** A line without points, e.g. "+ PISTOL". */
  notice(text: string, kind = 'notice'): void {
    this.push(`${kind}:${text}`, text, 0, kind);
  }

  /** A fresh run after respawning: beating the best again is worth celebrating again. */
  newRun(): void {
    this.startBest = this.score.best;
    this.celebratedBest = false;
    this.bestEl.classList.remove('beaten');
    for (const l of this.lines) this.release(l);
    this.lines.length = 0;
  }

  update(dt: number): void {
    const s = this.score;
    if (s.total !== this.shownTotal) {
      const grew = s.total > this.shownTotal && this.shownTotal >= 0;
      this.shownTotal = s.total;
      this.totalEl.textContent = fmt(s.total);
      if (s.best > 0) this.bestEl.textContent = `BEST ${fmt(s.best)}`;
      if (grew) punch(this.totalEl, 1.28);
    }
    // Only touch the DOM when something visible changed.
    const live = s.combo > 1 && s.comboTimer > 0;
    if (live !== this.shownLive) this.comboEl.classList.toggle('live', (this.shownLive = live));
    if (live) {
      if (s.combo !== this.shownCombo) {
        this.shownCombo = s.combo;
        this.comboText.textContent = `×${s.combo}`;
        this.comboEl.dataset.tier = String(comboTier(s.combo));
        punch(this.comboEl, 1.35);
      }
      const ring = Math.round(Math.min(100, (s.comboTimer / COMBO_WINDOW) * 100));
      if (ring !== this.shownRing) {
        this.shownRing = ring;
        this.comboRing.style.strokeDashoffset = String(100 - ring);
      }
    } else this.shownCombo = -1;

    const drift = s.driftPoints >= 10 ? Math.round(s.driftPoints) : 0;
    if (drift !== this.shownDrift) {
      const was = this.shownDrift;
      this.shownDrift = drift;
      if (drift > 0) {
        this.setDriftPoints(fmt(drift));
        if (was <= 0) this.feed.prepend(this.drift.el);
      } else this.drift.el.remove();
    }

    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.life -= dt;
      if (l.life <= -LINE_FADE) {
        this.lines.splice(i, 1);
        this.release(l);
      } else if (l.life <= 0 && !l.el.classList.contains('out')) l.el.classList.add('out');
    }
  }

  private push(kind: string, text: string, points: number, style = kind): void {
    const top = this.lines[0];
    if (top && top.kind === kind && top.life > 0) {
      top.count++;
      top.total += points;
      this.render(top);
      top.life = LINE_LIFE;
      punch(top.el, 1.15);
      return;
    }
    const line = this.pool.pop() ?? this.makeLine();
    line.kind = kind;
    line.text = text;
    line.count = 1;
    line.total = points;
    line.life = LINE_LIFE;
    line.el.className = `feed-line feed-${style}`;
    this.render(line);
    this.lines.unshift(line);
    // After the live drift line, if it's showing.
    this.drift.el.isConnected ? this.drift.el.after(line.el) : this.feed.prepend(line.el);
    // Older lines beyond the limit fade out straight away.
    for (let i = MAX_LINES; i < this.lines.length; i++) {
      const old = this.lines[i];
      if (old.life > 0) {
        old.life = 0;
        old.el.classList.add('out');
      }
    }
  }

  private render(l: FeedLine): void {
    l.label.textContent = l.count > 1 ? `${l.text} ×${l.count}` : l.text;
    l.points.textContent = l.total > 0 ? `+${fmt(l.total)}` : '';
  }

  private makeLine(): FeedLine {
    const el = document.createElement('div');
    el.className = 'feed-line';
    const label = document.createElement('span');
    const points = document.createElement('b');
    el.append(label, points);
    return { el, label, points, kind: '', text: '', count: 0, total: 0, life: 0 };
  }

  private release(l: FeedLine): void {
    l.el.remove();
    if (this.pool.length < 4) this.pool.push(l);
  }
}

/** A quick scale-punch (composited transform; no layout). */
function punch(el: HTMLElement, scale: number): void {
  el.animate?.([{ transform: `scale(${scale})` }, { transform: 'scale(1)' }], {
    duration: 260,
    easing: 'cubic-bezier(.2, 1.4, .4, 1)',
  });
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}
