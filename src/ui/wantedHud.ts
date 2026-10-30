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
}

export function createWantedFrame(): WantedFrame {
  return { level: 0, searching: false, arrest: 0, spray: 0 };
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
  private readonly stars: HTMLElement[] = [];
  private readonly pop: HTMLElement;
  private readonly arrest: HTMLElement;
  private readonly spray: HTMLElement;
  private readonly setArrestHidden: (h: boolean) => void;
  private readonly setSprayHidden: (h: boolean) => void;
  private readonly setArrestFill: (s: string) => void;
  private readonly setSprayFill: (s: string) => void;
  private readonly setPopText: (s: string) => void;
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
      <div class="w-meter w-spray" hidden><b>RESPRAY</b><span><i></i></span></div>`;
    parent.append(el);
    this.el = el;
    this.stars.push(...el.querySelectorAll<HTMLElement>('.w-star'));
    this.pop = el.querySelector('.w-pop')!;
    this.arrest = el.querySelector('.w-arrest')!;
    this.spray = el.querySelector('.w-spray')!;
    this.setArrestHidden = hiddenSetter(this.arrest);
    this.setSprayHidden = hiddenSetter(this.spray);
    this.setArrestFill = styleSetter(this.arrest.querySelector('i')!, 'transform');
    this.setSprayFill = styleSetter(this.spray.querySelector('i')!, 'transform');
    this.setPopText = textSetter(this.pop);

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
      for (let i = 0; i < 5; i++) {
        const s = this.stars[i];
        const on = i < level;
        s.classList.toggle('on', on);
        // A newly lit star pops (restart the animation).
        if (on && i >= prev) {
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
