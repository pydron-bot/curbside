/**
 * CHAOS RUN on the screen: picked from the title, it starts the player in a
 * sports car at a random crossing, holds them through a 3-2-1, runs the
 * two-minute clock (chaosRun.ts) with the timer top centre, time bonuses
 * popping beside it and the last ten seconds counted out loud, then slows
 * the city to a freeze-frame for the results card: medal, best, the
 * breakdown, and one tap to go again. WASTED or BUSTED ends it early.
 */
import { DIRS, MAX_NODE, dirHeading, lanePoint } from '../../world/roads';
import type { GlowSprites } from '../../render/glowSprites';
import type { ProgressProps } from '../../render/progressLook';
import type { ResultsCard, ResultsData } from '../../ui/progressScreens';
import { fmt } from '../../ui/scoreHud';
import type { TitleMode } from '../../ui/titleScreen';
import type { Vehicle } from '../population';
import { CHAOS_CATEGORIES, CHAOS_MEDALS, CHAOS_RUN_ID, CHAOS_RUN_SECONDS, ChaosRun, FINAL_COUNT, chaosMedal, nextMedal, type ChaosEnd } from './chaosRun';
import type { Mode, ModeCtx } from './context';

const PAINTS = ['#e8b923', '#ff2e88', '#2ee6ff', '#ff6a3d', '#3ddc84', '#f6f1e4'];
const COUNTDOWN = 3;
/** The end: the sim slows to a stop over this long (real time), s... */
const FREEZE_SECONDS = 1.1;
/** ...and the results come up this long after time's up. */
const RESULTS_AFTER = 1.6;
const MEDAL_WORD = { bronze: 'BRONZE', silver: 'SILVER', gold: 'GOLD' } as const;
/** The card's goal line by medal reached (none, bronze, silver, gold), built once. */
const GOALS = [
  `BRONZE AT ${fmt(CHAOS_MEDALS.bronze)}`,
  `SILVER AT ${fmt(CHAOS_MEDALS.silver)}`,
  `GOLD AT ${fmt(CHAOS_MEDALS.gold)}`,
  'GOLD! KEEP GOING',
];

type Phase = 'off' | 'countdown' | 'live' | 'ending' | 'results';

export class ChaosRunMode implements Mode {
  /** The title-screen entry (re-added to refresh its best / medal line). */
  readonly titleMode: TitleMode;
  phase: Phase = 'off';
  private run: ChaosRun | null = null;
  private car: Vehicle | null = null;
  private countdown = 0;
  private shownCount = 0;
  /** Real seconds since the run ended. */
  private endClock = 0;
  /** Waiting for the respawn after WASTED / BUSTED before the results. */
  private awaitRespawn = false;
  private finalScore = 0;
  private result: ResultsData | null = null;

  constructor(
    private readonly ctx: ModeCtx,
    private readonly results: ResultsCard,
  ) {
    this.titleMode = { id: CHAOS_RUN_ID, label: 'CHAOS RUN', sub: '', onSelect: () => this.start() };
    const bus = ctx.deps.bus;
    bus.on('award', (e) => this.run?.award(e.award));
    bus.on('explosion', (e) => this.run?.explosion(e.byPlayer, e.ownCar === true));
    bus.on('playerDied', () => this.cutShort('wasted'));
    bus.on('busted', () => this.cutShort('busted'));
    bus.on('respawn', () => {
      if (this.awaitRespawn) {
        this.awaitRespawn = false;
        this.endClock = RESULTS_AFTER - 0.4;
      }
    });
  }

  /** Running (or showing its results): free-roam activities stay off. */
  get active(): boolean {
    return this.phase !== 'off';
  }

  /** The title line: "2:00 · BEST 42,310 · GOLD". */
  titleSub(): string {
    const best = this.ctx.progress.best(CHAOS_RUN_ID);
    const medal = this.ctx.progress.medal(CHAOS_RUN_ID);
    if (best <= 0) return '2:00 — score all you can';
    return `2:00 · BEST ${fmt(best)}${medal ? ` · ${MEDAL_WORD[medal]}` : ''}`;
  }

  /**
   * Set up a run on top of the fresh start the title just made: a sports car
   * at a random crossing, the player in it, 3-2-1.
   */
  start(): void {
    const { deps } = this.ctx;
    this.reset();
    const rand = deps.rand;
    const lim = MAX_NODE - 2;
    let spot = { x: 0, z: 0, heading: 0 };
    for (let i = 0; i < 20; i++) {
      const ix = Math.floor(rand() * (2 * lim + 1)) - lim;
      const iz = Math.floor(rand() * (2 * lim + 1)) - lim;
      const d = DIRS[Math.floor(rand() * 4)];
      const p = lanePoint(ix, iz, d, 12);
      spot = { x: p.x, z: p.z, heading: dirHeading(d) };
      // Not on top of another car.
      if (!deps.vehicles.some((v) => Math.hypot(v.sim.x - p.x, v.sim.z - p.z) < 9)) break;
    }
    const paint = PAINTS[Math.floor(rand() * PAINTS.length)];
    this.car = this.ctx.spawnCar('sports', paint, spot.x, spot.z, spot.heading);
    this.ctx.board(this.car);
    // The run's own best on the BEST line (free roam's comes back in reset()).
    deps.hud.setBest(this.ctx.progress.best(CHAOS_RUN_ID));
    this.run = new ChaosRun();
    this.phase = 'countdown';
    this.countdown = COUNTDOWN;
    this.shownCount = 0;
    this.ctx.holdControls = true;
  }

  /** Restart from the pause menu: a fresh run, the same way the title starts one. */
  retry(): void {
    this.ctx.deps.frontDoor.play(this.titleMode);
  }

  step(dt: number): void {
    const run = this.run;
    if (!run) return;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.shownCount && n > 0) {
        this.shownCount = n;
        this.ctx.ui.banner(String(n), 'count', '', 0.9);
        this.ctx.deps.audio.ui('countdown');
      }
      if (this.countdown <= 0) {
        this.phase = 'live';
        this.ctx.holdControls = false;
        this.ctx.ui.banner('GO!', 'go', '', 0.8);
        this.ctx.deps.audio.ui('go');
      }
      return;
    }
    if (this.phase !== 'live') return;
    run.step(dt);
    for (const cue of run.cues) {
      if (cue.kind === 'bonus') this.ctx.ui.bonus(`+${cue.seconds} S`);
      else if (cue.kind === 'count') {
        this.ctx.deps.audio.ui('countdown');
        if (cue.n <= 5) this.ctx.ui.banner(String(cue.n), 'final', '', 0.8);
      } else this.finish(cue.reason);
    }
    run.cues.length = 0;
  }

  /** The sim's speed while the run ends: easing to a freeze-frame. */
  simScale(): number {
    if (this.phase === 'ending' && !this.awaitRespawn && this.run?.ended === 'time') {
      const t = Math.min(1, this.endClock / FREEZE_SECONDS);
      return (1 - t) * (1 - t);
    }
    return this.phase === 'results' ? 0 : 1;
  }

  hud(dt: number): boolean {
    const ui = this.ctx.ui;
    if (this.phase === 'ending') {
      this.endClock += dt;
      if (!this.awaitRespawn && this.endClock >= RESULTS_AFTER) this.showResults();
    }
    const run = this.run;
    if (!run || this.phase === 'off' || this.phase === 'results') return false;
    ui.activity('CHAOS RUN');
    ui.timer(this.phase === 'countdown' ? CHAOS_RUN_SECONDS : run.timeLeft, run.timeLeft <= FINAL_COUNT && this.phase === 'live');
    const score = this.ctx.deps.score.total;
    ui.goal(GOALS[score >= CHAOS_MEDALS.gold ? 3 : score >= CHAOS_MEDALS.silver ? 2 : score >= CHAOS_MEDALS.bronze ? 1 : 0]);
    return true;
  }

  prompt(): string | null {
    return null;
  }

  glow(_g: GlowSprites, _props: ProgressProps): void {}

  reset(): void {
    if (this.phase !== 'off') {
      // Leaving a run: its points mustn't carry into free roam (or its best).
      this.ctx.deps.score.resetRun();
      this.ctx.deps.hud.setBest(this.ctx.progress.best('free'));
    }
    this.phase = 'off';
    this.run = null;
    this.awaitRespawn = false;
    this.result = null;
    if (this.car) this.ctx.unpin(this.car);
    this.car = null;
    this.ctx.holdControls = false;
    if (this.results.isOpen) {
      this.results.hide();
      this.ctx.closeModal(this.results);
    }
  }

  private cutShort(reason: ChaosEnd): void {
    const run = this.run;
    if (!run || !run.running) return;
    if (this.phase === 'countdown') this.ctx.holdControls = false;
    run.end(reason);
    this.finish(reason);
  }

  /** The run is over: score it now (before a respawn resets the score), results shortly. */
  private finish(reason: ChaosEnd): void {
    const { progress, deps, ui } = this.ctx;
    const run = this.run!;
    run.cues.length = 0;
    this.phase = 'ending';
    this.endClock = 0;
    this.finalScore = deps.score.total;
    this.awaitRespawn = reason !== 'time';
    const best = progress.best(CHAOS_RUN_ID);
    const newBest = progress.recordBest(CHAOS_RUN_ID, this.finalScore);
    const medal = chaosMedal(this.finalScore);
    progress.recordMedal(CHAOS_RUN_ID, medal);
    progress.flush();
    const next = nextMedal(this.finalScore);
    this.result = {
      title: 'CHAOS RUN',
      score: this.finalScore,
      best: Math.max(best, this.finalScore),
      newBest: newBest && best > 0,
      medal,
      why: reason === 'wasted' ? 'WASTED — THE RUN WAS CUT SHORT' : reason === 'busted' ? 'BUSTED — THE RUN WAS CUT SHORT' : '',
      note: next ? `${MEDAL_WORD[next.medal]} AT ${fmt(next.at)}` : `+${Math.round(run.bonusTime)} S EARNED`,
      rows: CHAOS_CATEGORIES.map((c) => ({ label: c.label, count: run.tally[c.id].count, points: run.tally[c.id].points })),
    };
    if (reason === 'time') {
      ui.banner("TIME'S UP!", 'fail', '', RESULTS_AFTER);
      deps.audio.ui('go');
    }
    // Nobody's chasing a frozen car (and the next run starts clean anyway).
    if (reason === 'time') {
      deps.heat.wanted.clear('reset');
      deps.heat.police.standDown();
    }
  }

  private showResults(): void {
    const r = this.result;
    if (!r) return;
    this.phase = 'results';
    const { ui, deps } = this.ctx;
    ui.clearBanner();
    // The game is frozen now: the chain running when time ran out is earned (RETRY or TITLE would drop it).
    this.ctx.bankChain();
    deps.audio.ui(r.medal ? 'success' : 'fail');
    this.ctx.openModal(this.results);
    this.results.show(
      r,
      {
        retry: () => {
          this.ctx.closeModal(this.results);
          this.retry();
        },
        freeRoam: () => {
          this.ctx.closeModal(this.results);
          this.reset();
        },
        title: () => {
          this.ctx.closeModal(this.results);
          this.reset();
          deps.enterTitle();
        },
      },
      this.ctx.focusRing,
    );
  }
}
