import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import type { ModeCtx } from '../src/game/modes/context';
import { FRENZY_COUNTDOWN } from '../src/game/modes/frenzies';
import { FrenzyMode } from '../src/game/modes/frenzyMode';
import { Player } from '../src/game/player';
import { Progress } from '../src/game/progress';
import { defaultSave } from '../src/game/progressSave';

const DT = 1 / 60;

function setup() {
  const bus = new EventBus();
  const player = new Player(bus, 0, 0);
  const banners: [string, string, string | undefined][] = [];
  const ctx = {
    deps: { bus, player, audio: { ui() {} } },
    progress: new Progress(defaultSave(), null),
    ui: { banner: (text: string, kind: string, sub?: string) => banners.push([text, kind, sub]) },
    freeRoam: true,
    // As in ProgressDirector: already false when playerDied / busted fire.
    get live() {
      return player.alive && !player.arrested;
    },
    busy: null as string | null,
    blip() {},
    unblip() {},
  };
  const mode = new FrenzyMode(ctx as unknown as ModeCtx);
  // Start a run on the first token and step it past the 3-2-1.
  const inner = mode as unknown as { begin(t: unknown): void; tokens: unknown[] };
  inner.begin(inner.tokens[0]);
  for (let t = 0; t <= FRENZY_COUNTDOWN + 0.1; t += DT) mode.step(DT);
  banners.length = 0;
  return { mode, ctx, player, banners };
}

describe('frenzy mode', () => {
  it('raises FRENZY FAILED · WASTED when the player dies mid-run (held behind the WASTED card)', () => {
    const { ctx, player, banners } = setup();
    expect(ctx.busy).toBe('frenzy');
    player.hurt(1e6);
    expect(banners).toEqual([['FRENZY FAILED', 'fail', 'WASTED']]);
    expect(ctx.busy).toBeNull();
  });

  it('raises FRENZY FAILED · BUSTED on an arrest mid-run', () => {
    const { ctx, player, banners } = setup();
    player.arrest();
    expect(banners).toEqual([['FRENZY FAILED', 'fail', 'BUSTED']]);
    expect(ctx.busy).toBeNull();
  });
});
