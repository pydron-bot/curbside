import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { ChaosRun } from '../src/game/modes/chaosRun';
import { ChaosRunMode } from '../src/game/modes/chaosRunMode';
import type { ModeCtx } from '../src/game/modes/context';
import { Progress } from '../src/game/progress';
import { defaultSave } from '../src/game/progressSave';
import { Score } from '../src/systems/score';
import type { ResultsData } from '../src/ui/progressScreens';

const DT = 1 / 60;

function setup() {
  const bus = new EventBus();
  const score = new Score();
  const shown: ResultsData[] = [];
  const ui = { activity() {}, timer() {}, goal() {}, banner() {}, clearBanner() {}, bonus() {} };
  const ctx = {
    deps: {
      bus,
      score,
      audio: { ui() {} },
      heat: { wanted: { clear() {} }, police: { standDown() {} } },
      hud: { setBest() {} },
      player: { position: { x: 0, z: 0 } },
    },
    progress: new Progress(defaultSave(), null),
    ui,
    holdControls: false,
    bankChain() {},
    openModal() {},
    closeModal() {},
  };
  const results = { isOpen: false, show: (r: ResultsData) => shown.push(r), hide() {} };
  const mode = new ChaosRunMode(ctx as unknown as ModeCtx, results as never);
  // Live, one tick from the buzzer.
  const inner = mode as unknown as { run: ChaosRun };
  inner.run = new ChaosRun();
  inner.run.timeLeft = DT / 2;
  mode.phase = 'live';
  const scoreIt = () => bus.emit({ type: 'award', award: score.award('smash') });
  return { mode, score, shown, scoreIt, run: inner.run, ctx };
}

describe('chaos run mode: results at time-up', () => {
  it('counts awards that bank in the slow-mo, never less than the HUD at the buzzer', () => {
    const { mode, score, shown, scoreIt, run, ctx } = setup();
    scoreIt();
    mode.step(DT);
    expect(run.ended).toBe('time');
    const atBuzzer = score.total;
    // A drift banking after its grace, mid slow-mo.
    scoreIt();
    expect(score.total).toBeGreaterThan(atBuzzer);
    for (let t = 0; t < 2 && shown.length === 0; t += DT) mode.hud(DT);
    expect(shown).toHaveLength(1);
    expect(shown[0].score).toBe(score.total);
    expect(shown[0].score).toBeGreaterThanOrEqual(atBuzzer);
    expect(shown[0].rows.reduce((n, r) => n + r.points, 0)).toBe(score.total);
    expect(ctx.progress.best('chaosRun')).toBe(score.total);
  });

  it('keeps the buzzer score if the total drops in the slow-mo', () => {
    const { mode, score, shown, scoreIt } = setup();
    scoreIt();
    mode.step(DT);
    const atBuzzer = score.total;
    score.fine(0.5);
    for (let t = 0; t < 2 && shown.length === 0; t += DT) mode.hud(DT);
    expect(shown[0].score).toBe(atBuzzer);
  });
});
