import './tokens.css';
import './wanted.css';
import type { EventBus } from '../core/events';
import { hiddenSetter, styleSetter, textSetter } from './domWrite';

/** What the wanted HUD shows this frame (main/heatPresenter fills one and reuses it). */
export interface WantedFrame {
  /** Stars, 0..5. */
  level: number;
  /** Out of sight: the stars blink. */
  searching: boolean;
  /** 0..1 how close an arrest is (an officer's grip, a boxed-in car). */
  arrest: number;
  /** 0..1 a respray in progress (0 when not in a bay). */
  spray: number;
  /** The kind of hideout the player is in (LYING LOW), or null. */
  hideout: 'carPark' | 'alley' | null;
  /** Lying low there now: stopped and unseen (the clock runs double). */
  lyingLow: boolean;
  /** NEW WHEELS is cutting the wait for this star. */
  newWheels: boolean;
}

export function createWantedFrame(): WantedFrame {
  return { level: 0, searching: false, arrest: 0, spray: 0, hideout: null, lyingLow: false, newWheels: false };
}

/** The cue's lines, built once (no string per frame while it shows). */
const CUE = {
  carPark: { hint: 'CAR PARK · STOP, STAY UNSEEN', stop: 'CAR PARK · STOP HERE' },
  alley: { hint: 'ALLEY · STOP, STAY UNSEEN', stop: 'ALLEY · STOP HERE' },
  low: 'LYING LOW · 2×',
  wheels: 'NEW WHEELS · ½ WAIT',
} as const;

/** The first time in a hideout while wanted, the cue explains itself (once per device). */
const HINT_KEY = 'curbside.hint.lieLow';
const HINT_SECONDS = 6;

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function markHintSeen(): void {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    // Private mode: it'll explain itself again next time.
  }
}

/** What each level means, flashed under the stars as it's reached. */
const LEVEL_NAMES = ['', 'WANTED', 'HOT PURSUIT', 'ROADBLOCKS', 'SWAT', 'CHOPPER'];
const STAR_PATH = 'M12 1.8l3.1 6.6 7.1.9-5.2 5 1.3 7.1L12 18l-6.3 3.4 1.3-7.1-5.2-5 7.1-.9z';
/** How long the pop line stays up, s (matches the CSS animation). */
const POP_SECONDS = 2.2;
/** Meter fills in 1% steps, built once (no string garbage per frame while a meter runs). */
const FILLS = Array.from({ length: 101 }, (_, i) => `scaleX(${i / 100})`);
const fill = (f: number) => FILLS[Math.round(Math.max(0, Math.min(1, f)) * 100)];

/**
 * The wanted level, top centre under the pause button (clear of the radar,
 * the score and the thumbs at 852×393 and 852×340): five stars that light
 * up with a flash and a "WANTED"-style pop as the level rises, blink while
 * the police have lost sight, and fade with an "EVADED" when it's over.
 * Below them, a meter fills while an officer has hold of the player (or a
 * car is boxed in), and another while a Pay 'n' Spray works. Only what
 * changed is written to the DOM.
 */
export class WantedHud {
  private readonly el: HTMLElement;
  /** Red and blue light pulsing at the screen's edges, faster with every star (wanted.css .w-edge). */
  private readonly edge: HTMLElement;
  private readonly stars: HTMLElement[] = [];
  private readonly pop: HTMLElement;
  private readonly arrest: HTMLElement;
  private readonly spray: HTMLElement;
  private readonly setArrestHidden: (h: boolean) => void;
  private readonly setSprayHidden: (h: boolean) => void;
  private readonly setArrestFill: (s: string) => void;
  private readonly setSprayFill: (s: string) => void;
  private readonly setPopText: (s: string) => void;
  private readonly cue: HTMLElement;
  private readonly setCueText: (s: string) => void;
  private readonly setCueHidden: (h: boolean) => void;
  private hinted = hintSeen();
  /** Seconds left of the first-time hint. */
  private hintLeft = 0;
  private shownWheels = false;
  private shownLevel = 0;
  private shownSearching = false;
  private popLeft = 0;
  /** Keep the row up a moment after the level drops to 0 (for the EVADED pop). */
  private linger = 0;

  constructor(parent: HTMLElement, bus: EventBus) {
    const el = document.createElement('div');
    el.id = 'wanted';
    el.dataset.level = '0';
    el.hidden = true;
    el.classList.add('clean');
    const star = `<i class="w-star"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg></i>`;
    el.innerHTML = `
      <div class="w-stars" role="img" aria-label="Wanted level">${star.repeat(5)}</div>
      <div class="w-pop" hidden></div>
      <div class="w-meter w-arrest" hidden><b>ARREST</b><span><i></i></span></div>
      <div class="w-meter w-spray" hidden><b>RESPRAY</b><span><i></i></span></div>
      <div class="w-cue" hidden></div>`;
    const edge = document.createElement('div');
    edge.className = 'w-edge';
    edge.dataset.level = '0';
    parent.append(edge, el);
    this.edge = edge;
    this.el = el;
    this.stars.push(...el.querySelectorAll<HTMLElement>('.w-star'));
    // Drop the pop once it has played: a finished animation held on every
    // lit star kept layers alive, the likely source of Safari's stray stars.
    for (const s of this.stars) s.addEventListener('animationend', (e) => e.animationName === 'star-gain' && s.classList.remove('gain'));
    this.pop = el.querySelector('.w-pop')!;
    this.arrest = el.querySelector('.w-arrest')!;
    this.spray = el.querySelector('.w-spray')!;
    this.setArrestHidden = hiddenSetter(this.arrest);
    this.setSprayHidden = hiddenSetter(this.spray);
    this.setArrestFill = styleSetter(this.arrest.querySelector('i')!, 'transform');
    this.setSprayFill = styleSetter(this.spray.querySelector('i')!, 'transform');
    this.setPopText = textSetter(this.pop);
    this.cue = el.querySelector('.w-cue')!;
    this.setCueText = textSetter(this.cue);
    this.setCueHidden = hiddenSetter(this.cue);

    bus.on('wanted', (e) => {
      if (e.level > e.prev) this.flashPop(LEVEL_NAMES[e.level] ?? 'WANTED', 'up');
      else if (e.level === 0 && e.reason === 'evaded') this.flashPop('EVADED', 'clear');
      else if (e.level === 0 && e.reason === 'respray') this.flashPop('LOST THEM', 'clear');
      else if (e.level > 0 && e.level < e.prev) this.flashPop('LOSING THEM', 'down');
    });
    bus.on('respray', (e) => {
      if (!e.cleared && this.shownLevel > 0) this.flashPop('THEY SAW YOU GO IN', 'down');
    });
    // Busted or wasted: the big screen says it all.
    const hide = () => {
      this.linger = 0;
      this.popLeft = 0;
      this.pop.hidden = true;
      this.edge.dataset.level = '0';
    };
    bus.on('busted', hide);
    bus.on('playerDied', hide);
    bus.on('respawn', hide);
  }

  /** Per frame (not while paused). */
  update(dt: number, f: WantedFrame): void {
    const level = f.level;
    if (level !== this.shownLevel) {
      const prev = this.shownLevel;
      this.shownLevel = level;
      this.el.dataset.level = String(level);
      this.edge.dataset.level = String(level);
      for (let i = 0; i < 5; i++) {
        const s = this.stars[i];
        const on = i < level;
        s.classList.toggle('on', on);
        if (!on) s.classList.remove('gain');
        // A newly lit star pops (restart the animation).
        else if (i >= prev) {
          s.classList.remove('gain');
          void s.offsetWidth;
          s.classList.add('gain');
        }
      }
      if (level === 0) this.linger = 1.4;
      this.el.classList.toggle('clean', level === 0);
    }
    const searching = f.searching && level > 0;
    if (searching !== this.shownSearching) {
      this.shownSearching = searching;
      this.el.classList.toggle('searching', searching);
      this.edge.classList.toggle('searching', searching);
    }
    if (this.linger > 0) this.linger -= dt;
    const show = level > 0 || this.linger > 0 || f.spray > 0;
    if (show === this.el.hidden) this.el.hidden = !show;

    const grabbing = f.arrest > 0.01;
    this.setArrestHidden(!grabbing);
    if (grabbing) this.setArrestFill(fill(f.arrest));
    const spraying = f.spray > 0.01 && f.spray < 1;
    this.setSprayHidden(!spraying);
    if (spraying) this.setSprayFill(fill(f.spray));

    if (this.popLeft > 0 && (this.popLeft -= dt) <= 0) this.pop.hidden = true;
    this.updateCue(dt, f);
  }

  /** LYING LOW and NEW WHEELS: one short line under the stars (the first time in a hideout, a longer hint). */
  private updateCue(dt: number, f: WantedFrame): void {
    const wanted = f.level > 0;
    const wheels = wanted && f.newWheels;
    if (wheels && !this.shownWheels) this.flashPop('NEW WHEELS', 'down');
    this.shownWheels = wheels;
    if (wanted && f.hideout && !this.hinted) {
      this.hinted = true;
      this.hintLeft = HINT_SECONDS;
      markHintSeen();
    }
    if (this.hintLeft > 0) this.hintLeft -= dt;
    let text = '';
    let tone = 'hide';
    if (wanted && f.hideout) {
      const where = CUE[f.hideout];
      text = f.lyingLow ? CUE.low : this.hintLeft > 0 ? where.hint : where.stop;
      tone = f.lyingLow ? 'low' : 'hide';
    } else if (wheels) {
      text = CUE.wheels;
      tone = 'wheels';
    }
    this.setCueHidden(text === '');
    if (text) {
      this.setCueText(text);
      if (this.cue.dataset.tone !== tone) this.cue.dataset.tone = tone;
    }
  }

  private flashPop(text: string, tone: 'up' | 'down' | 'clear'): void {
    this.setPopText(text);
    this.pop.dataset.tone = tone;
    // Restart the slam-in animation.
    this.pop.hidden = true;
    void this.pop.offsetWidth;
    this.pop.hidden = false;
    this.popLeft = POP_SECONDS;
    if (tone === 'clear') this.linger = Math.max(this.linger, POP_SECONDS);
  }
}
