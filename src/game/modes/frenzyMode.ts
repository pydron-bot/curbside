/**
 * Frenzies on the screen: eight purple gems spinning over a pulsing ring
 * (gold once beaten), on the radar as '!'. Touch one (on foot, or in a car
 * for the driving ones), 3-2-1, and the card counts the goal down against
 * the clock; PASSED pays and turns the token gold, FAILED can be retried by
 * touching it again. Counts come straight off the bus (frenzies.ts).
 */
import { speed } from '../../entities/vehicle';
import type { GlowSprites } from '../../render/glowSprites';
import { MARK, beacon, groundRing, nearView, type ProgressProps } from '../../render/progressLook';
import { fmt } from '../../ui/scoreHud';
import type { Rect } from '../../world/city';
import { KeyedText, type Mode, type ModeCtx } from './context';
import { FRENZIES, FRENZY_PAY, FRENZY_REPLAY, FrenzyRun, type FrenzyDef } from './frenzies';
import { placeFrenzyTokens, type Spot } from './places';

/** Touching distance, m: on foot, and in a car. */
const REACH_FOOT = 1.8;
const REACH_CAR = 3.8;
/** Leave the token by this much before it can start again, m. */
const REARM = 8;
/** Prompts show this close, m. */
const PROMPT_RANGE = 14;

interface Token {
  def: FrenzyDef;
  spot: Spot;
  armed: boolean;
  /** Its prompt, on foot and in a car (built once). */
  prompt: string;
  promptOnFoot: string;
}

export class FrenzyMode implements Mode {
  private readonly tokens: Token[];
  private run: FrenzyRun | null = null;
  private token: Token | null = null;
  private shownCount = 0;
  private near: Token | null = null;
  private blipsOn = false;
  private readonly goal = new KeyedText();

  constructor(private readonly ctx: ModeCtx) {
    const spots = placeFrenzyTokens();
    this.tokens = FRENZIES.map((def) => {
      const prompt = `FRENZY · ${def.title} IN ${def.seconds} S`;
      return { def, spot: spots.find((s) => s.id === def.id)!, armed: true, prompt, promptOnFoot: def.needsCar ? `${prompt} · NEEDS A CAR` : prompt };
    });
    const bus = ctx.deps.bus;
    bus.onAny((e) => {
      const run = this.run;
      if (!run || run.phase !== 'live') return;
      if (run.event(e) && run.def.goal !== 'drift' && run.def.goal !== 'combo') ctx.deps.audio.ui('click');
    });
    const fail = () => this.run && !this.run.done && this.end(false);
    bus.on('playerDied', fail);
    bus.on('busted', fail);
  }

  private beaten(def: FrenzyDef): boolean {
    return this.ctx.progress.data.frenzies.includes(def.id);
  }

  step(dt: number): void {
    const ctx = this.ctx;
    this.syncBlips();
    const run = this.run;
    if (run) {
      const before = run.phase;
      const phase = run.step(dt);
      if (phase === 'countdown') {
        const n = Math.ceil(run.countdown);
        if (n !== this.shownCount && n > 0) {
          this.shownCount = n;
          ctx.ui.banner(String(n), 'count', run.def.title, 0.9);
          ctx.deps.audio.ui('countdown');
        }
      } else if (before === 'countdown' && phase === 'live') {
        ctx.ui.banner('GO!', 'go', run.def.title, 0.9);
        ctx.deps.audio.ui('go');
        const gift = run.def.gift;
        if (gift) {
          ctx.deps.player.arsenal.pickUp(gift);
          ctx.deps.player.arsenal.current = gift;
        }
      }
      if (phase === 'passed') this.end(true);
      else if (phase === 'failed') this.end(false);
      return;
    }
    this.near = null;
    if (!ctx.freeRoam || !ctx.live) return;
    const p = ctx.deps.player;
    const at = p.position;
    const car = p.driving;
    for (const t of this.tokens) {
      const d = Math.hypot(at.x - t.spot.x, at.z - t.spot.z);
      if (d > REARM) t.armed = true;
      if (d < PROMPT_RANGE) this.near = t;
      if (!t.armed || ctx.busy) continue;
      if (d > (car ? REACH_CAR : REACH_FOOT)) continue;
      if (t.def.needsCar && (!car || car.damage.wrecked)) continue;
      if (car && speed(car.sim) > 25) continue;
      t.armed = false;
      this.begin(t);
      break;
    }
  }

  private begin(t: Token): void {
    this.token = t;
    this.goal.reset();
    this.run = new FrenzyRun(t.def);
    this.shownCount = 0;
    this.ctx.busy = 'frenzy';
  }

  private end(passed: boolean): void {
    const ctx = this.ctx;
    const run = this.run!;
    run.fail(); // no-op once passed; stops the clock otherwise
    const def = run.def;
    if (passed) {
      const first = ctx.progress.complete('frenzies', def.id);
      const pay = ctx.pay(first ? FRENZY_PAY : FRENZY_REPLAY, 'frenzy', 'FRENZY');
      ctx.ui.banner('FRENZY PASSED!', 'pass', `+$${fmt(pay)}`);
      ctx.deps.audio.ui('success');
      const left = FRENZIES.filter((f) => !this.beaten(f)).length;
      if (first) ctx.notice(left === 0 ? 'ALL FRENZIES BEATEN!' : `FRENZIES ${FRENZIES.length - left}/${FRENZIES.length}`, 'progress');
      ctx.progress.flush();
    } else if (ctx.live) {
      ctx.ui.banner('FRENZY FAILED', 'fail', 'TOUCH THE TOKEN TO RETRY');
      ctx.deps.audio.ui('fail');
    }
    this.run = null;
    this.token = null;
    if (ctx.busy === 'frenzy') ctx.busy = null;
    this.blipsOn = false; // recolour the token
  }

  hud(): boolean {
    const run = this.run;
    if (!run) return false;
    const ui = this.ctx.ui;
    ui.activity('FRENZY');
    ui.timer(run.phase === 'countdown' ? run.def.seconds : run.timeLeft, run.phase === 'live' && run.timeLeft <= 10, 0);
    const d = run.def;
    const g = this.goal;
    if (g.stale(Math.floor(run.count))) {
      g.text = d.goal === 'drift' ? `DRIFT ${fmt(Math.floor(run.count))} / ${fmt(d.target)}` : d.goal === 'combo' ? `${d.title} · ×${Math.max(1, run.count)}` : `${d.title} · ${run.count}/${d.target}`;
    }
    ui.goal(g.text);
    return true;
  }

  prompt(): string | null {
    const t = this.near;
    if (!t || this.run || this.ctx.busy || !t.armed) return null;
    return this.ctx.deps.player.driving ? t.prompt : t.promptOnFoot;
  }

  glow(g: GlowSprites, props: ProgressProps, view: Rect, t: number): void {
    if (!this.ctx.freeRoam) return;
    for (let i = 0; i < this.tokens.length; i++) {
      const tok = this.tokens[i];
      const { x, z } = tok.spot;
      if (!nearView(x, z, view)) continue;
      const running = this.token === tok;
      // Other tokens step back while something else is on.
      if (this.ctx.busy && !running) continue;
      const c = this.beaten(tok.def) ? MARK.gold : MARK.frenzy;
      const pulse = 0.5 + 0.5 * Math.sin(t * (running ? 8 : 3) + i);
      const k = (running ? 0.5 : 0.85) + 0.45 * pulse;
      groundRing(g, x, z, 3 + pulse * 0.6, c, k, t);
      beacon(g, x, z, 1.1, 6, c, 0.45 * k);
      props.gem(x, 1.3 + Math.sin(t * 2.2 + i) * 0.18, z, 1, t * 1.8 + i, c[0], c[1], c[2]);
    }
  }

  reset(): void {
    this.run = null;
    this.token = null;
    for (const t of this.tokens) t.armed = true;
    this.hideBlips();
  }

  /** Radar: '!' per token in free roam (gold once beaten). */
  private syncBlips(): void {
    const want = this.ctx.freeRoam;
    if (want === this.blipsOn) return;
    if (!want) {
      this.hideBlips();
      return;
    }
    this.blipsOn = true;
    for (const t of this.tokens) {
      this.ctx.blip(t.def.id, { x: t.spot.x, z: t.spot.z, kind: 'marker', colour: this.beaten(t.def) ? '#ffd23f' : '#c15cff', icon: '!', size: 5.5 });
    }
  }

  private hideBlips(): void {
    this.blipsOn = false;
    for (const t of this.tokens) this.ctx.unblip(t.def.id);
  }
}
