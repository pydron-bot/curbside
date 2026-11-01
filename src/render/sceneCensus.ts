/**
 * Fills a SceneCounts (core/sceneCounts.ts) from the counters the renderers
 * and the simulation already keep: the particle pools, the glow batch, the
 * fire board, the rubble, the people and car batches and the city's scenes.
 * For the perf overlay, the session log's samples and dips, and bug reports:
 * a few times a second at most, never per frame.
 */
import type { EventBus } from '../core/events';
import { BoomWindow, sceneKinds, type SceneCounts } from '../core/sceneCounts';
import type { CityLife } from '../game/cityLife';
import type { Vehicle } from '../game/population';
import { FireCrews } from '../game/scenes/fireCrews';
import { damageStage } from '../systems/damage';
import { near } from './cityLifeLook';
import type { Effects } from './effects';
import type { Look } from './look';

/** A wreck still shows flames for this long (fxDriving's wreck fire), s. */
const WRECK_FLAMES = 6;
/** A fire this far outside the view still lights it (emergencyLook's glow margin), m. */
const FIRE_MARGIN = 10;

export interface CensusDeps {
  effects: Effects;
  look: Look;
  life: CityLife;
  vehicles: readonly Vehicle[];
  bus: EventBus;
  /** Rubble alive and drawn (the destruction test). */
  rubble: () => { live: number; drawn: number };
  /** Seconds, a clock that runs forward. */
  now: () => number;
}

export class SceneCensus {
  private readonly booms = new BoomWindow();
  private readonly running: number[] = [];
  private readonly lastRunning: number[] = [];
  private kinds = '';
  private sceneCount = 0;

  constructor(private readonly d: CensusDeps) {
    d.bus.on('explosion', () => this.booms.add(d.now()));
  }

  /** Fill `out` with what is on screen now. */
  fill(out: SceneCounts): SceneCounts {
    const { effects, look, life } = this.d;
    out.hot = effects.hot.count;
    out.soft = effects.soft.count;
    out.big = effects.big;
    out.fill = effects.fill;
    const ground = effects.viewArea;
    out.glows = look.glows.drawn;
    out.glowFill = ground > 0 ? look.glows.area / ground : 0;

    let fires = 0;
    let seen = 0;
    const board = FireCrews.of(life)?.board;
    if (board) {
      const view = life.view;
      for (const f of board.fires) {
        if (!f.alive) continue;
        fires++;
        if (near(view, f.x, f.z, FIRE_MARGIN)) seen++;
      }
    }
    out.fires = fires;
    out.firesSeen = seen;
    let burning = 0;
    for (const v of this.d.vehicles) {
      if (damageStage(v.damage) === 'burning' || (v.damage.wrecked && v.wreckAge < WRECK_FLAMES)) burning++;
    }
    out.burning = burning;
    out.booms = this.booms.count(this.d.now());

    const rubble = this.d.rubble();
    out.rubble = rubble.live;
    out.rubbleDrawn = rubble.drawn;
    const people = look.characters.counts();
    out.people = people.live;
    out.peopleSeen = people.drawn;
    out.cars = look.cars.live;
    out.carsSeen = look.cars.drawn;

    // The kinds string is rebuilt only when a count changed.
    const run = life.sceneRunning(this.running);
    let changed = run.length !== this.lastRunning.length;
    for (let i = 0; i < run.length && !changed; i++) changed = run[i] !== this.lastRunning[i];
    if (changed) {
      const s = sceneKinds(life.sceneLabels, run);
      this.kinds = s.kinds;
      this.sceneCount = s.count;
      this.lastRunning.length = run.length;
      for (let i = 0; i < run.length; i++) this.lastRunning[i] = run[i];
    }
    out.scenes = this.sceneCount;
    out.kinds = this.kinds;
    return out;
  }
}
