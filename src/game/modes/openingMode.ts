/**
 * The live cold open (V2-07) on the street; the rules and geometry are in
 * game/opening.ts. PLAY on a save that hasn't had it: the player stands at
 * a bus shelter as a bus pulls in, sirens off screen; a staged chase's
 * getaway (scenes/chases.ts stage()) comes down the far lane and piles
 * into the kerb a few steps away, and its driver runs. Story job s1, WRONG
 * STOP, starts then with that car lent to it: GET IN · LOSE THE HEAT.
 * Getting in is TAKE THE HEAT (the chase hands its cops over: 2 stars). If
 * the chase can't start, the getaway is already there, crashed, and getting
 * in brings the 2 stars and the stamp all the same (the fallback).
 *
 * It's armed by a respawn (PLAY, RESTART, after WASTED) while the save
 * hasn't had it, and starts on the next sim step (the respawn's own street
 * reset has run by then) unless a Chaos Run took the run. Once the player
 * is in the getaway it has run: `save.opening`. While it's on, the city's
 * busy scenes hold off (CityLifeDeps.opening), so nothing gets in the way.
 */
import { VEHICLE_HEALTH } from '../../entities/vehicle';
import type { GlowSprites } from '../../render/glowSprites';
import type { ProgressProps } from '../../render/progressLook';
import { TOOK_GETAWAY_STARS } from '../../systems/chaseHandoff';
import { applyDamage } from '../../systems/damage';
import type { MissionDef } from '../../systems/missions';
import type { Rect } from '../../world/city';
import type { BusStop } from '../../world/streetStops';
import type { CityLife } from '../cityLife';
import { CHASE_GIVE_UP, CHASE_WAIT, CRASH_BY, GETAWAY_TAG, OPENING_JOB, BUS_BACK, onOpeningRoad, openingDue, openingPlan, pickOpeningStop, type OpeningPlan } from '../opening';
import { trafficPaint, type Population, type Vehicle } from '../population';
import type { StagedGetaway } from '../scenes/chases';
import type { Mode, ModeCtx } from './context';
import type { MissionMode } from './missionMode';
import { SAFEHOUSE } from './places';

/** What the cold open needs from the city (main.ts: openingStage). */
export interface OpeningStage {
  /** The bus shelters. */
  readonly stops: readonly BusStop[];
  /** The player has been moved: the camera there, the streets filled round them. */
  moved(): void;
  /** Take the traffic and parked cars off the plan's road (the screen has only just cut there). */
  clear(plan: OpeningPlan): void;
  /** A bus `back` m back from `stop`, pulling in, riders waiting. */
  bus(stop: BusStop, back: number): void;
  /** The staged chase; its getaway, or null if it can't start. */
  chase(s: StagedGetaway): Vehicle | null;
  /** The staged getaway's state: coming, dumped at the kerb, or no chase's any more. */
  staged(v: Vehicle): 'coming' | 'dumped' | null;
}

/** The city's side of it (scenes/chases.ts, scenes/buses.ts, the population). */
export function openingStage(life: CityLife, population: Population, stops: readonly BusStop[], moved: () => void): OpeningStage {
  return {
    stops,
    moved,
    clear(plan) {
      const p = life.d.player;
      for (let i = life.d.vehicles.length - 1; i >= 0; i--) {
        const v = life.d.vehicles[i];
        if (v === p.driving || v.police || v.ambient || v.scene || life.d.keep(v)) continue;
        if (onOpeningRoad(plan, v.sim.x, v.sim.z)) population.retireVehicle(v);
      }
    },
    bus: (stop, back) => void life.buses.force(stop, back),
    chase: (s) => life.chases.stage(s),
    staged: (v) => life.chases.staged(v),
  };
}

type Phase = 'idle' | 'armed' | 'chase' | 'crashed' | 'done';

/** The fallback's crashed car. */
const FALLBACK_CAR = 'sedan';

export class OpeningMode implements Mode {
  phase: Phase = 'idle';
  /** The getaway (staged or the fallback's). */
  car: Vehicle | null = null;
  /** This run's opening is the fallback (no chase). */
  fallback = false;
  private stage: OpeningStage | null = null;
  private plan: OpeningPlan | null = null;
  private t = 0;
  private readonly job: MissionDef | null;

  constructor(
    private readonly ctx: ModeCtx,
    private readonly missions: MissionMode,
  ) {
    this.job = missions.missions.find((m) => m.id === OPENING_JOB) ?? null;
    const bus = ctx.deps.bus;
    // PLAY, RESTART, the respawn after WASTED: the opening goes (again) if it hasn't run.
    bus.on('respawn', () => {
      if (openingDue(ctx.progress.data) && this.phase !== 'done') this.arm();
    });
    // Down before getting in: the respawn starts it over.
    bus.on('playerDied', () => {
      if (this.phase !== 'done') this.drop();
    });
  }

  /** The city's side (main.ts, once CityLife exists). */
  useStage(stage: OpeningStage): void {
    this.stage = stage;
  }

  /** It's on: the city's busy scenes hold off (CityLifeDeps.opening). */
  get holding(): boolean {
    return (this.phase === 'armed' || this.phase === 'chase' || this.phase === 'crashed') && this.ctx.deps.playing();
  }

  /** Settings → REPLAY OPENING: the next PLAY has it again. */
  forget(): void {
    const p = this.ctx.progress;
    p.data.opening = false;
    p.markDirty();
    p.flush();
    this.phase = 'idle';
  }

  step(dt: number): void {
    const ctx = this.ctx;
    if (this.phase === 'idle' || this.phase === 'done') return;
    if (this.phase === 'armed') {
      // A Chaos Run took the run (the title's modes start from PLAY's respawn).
      if (!ctx.freeRoam) this.phase = 'idle';
      else if (ctx.live && !ctx.busy && this.stage) this.begin(this.stage);
      return;
    }
    this.t += dt;
    const car = this.car;
    if (this.phase === 'chase') {
      const st = car && this.stage ? this.stage.staged(car) : null;
      if (st === 'dumped' && car && !car.damage.wrecked && !car.damage.burning) this.crashed(car);
      // Wrecked on the way, handed back, or late: the crashed getaway is there instead.
      else if (st !== 'coming' || this.t > CHASE_GIVE_UP) this.startFallback();
      return;
    }
    // Crashed, waiting for the player to get in.
    const p = ctx.deps.player;
    if (car && p.driving === car) this.gotIn(car);
  }

  hud(): boolean {
    return false;
  }

  prompt(): string | null {
    return null;
  }

  glow(_g: GlowSprites, _props: ProgressProps, _view: Rect): void {}

  /** Quit, RESTART, a new run: it stops (a respawn arms it again if it hasn't run). */
  reset(): void {
    if (this.phase !== 'done') this.drop();
    else this.phase = 'idle';
  }

  private arm(): void {
    this.drop();
    this.phase = 'armed';
  }

  private drop(): void {
    this.phase = 'idle';
    this.car = null;
    this.fallback = false;
    this.t = 0;
  }

  /** To the shelter, the bus pulling in, the chase waiting off screen (or the crashed getaway already there). */
  private begin(stage: OpeningStage): void {
    const plan = (this.plan ??= this.makePlan(stage));
    if (!plan) {
      this.phase = 'idle';
      return;
    }
    const p = this.ctx.deps.player;
    const st = plan.stand;
    Object.assign(p.ped, { x: st.x, z: st.z, vx: 0, vz: 0, heading: st.heading });
    Object.assign(p.prev, p.ped);
    stage.moved();
    stage.clear(plan);
    stage.bus(plan.stop, BUS_BACK);
    this.t = 0;
    this.fallback = false;
    const g = plan.getaway;
    const car = stage.chase({ x: g.x, z: g.z, heading: g.heading, crashX: plan.crash.x, crashZ: plan.crash.z, wait: CHASE_WAIT, by: CRASH_BY });
    if (car) {
      this.car = car;
      this.phase = 'chase';
    } else this.startFallback();
  }

  private makePlan(stage: OpeningStage): OpeningPlan | null {
    const stop = pickOpeningStop(stage.stops, SAFEHOUSE.x, SAFEHOUSE.z);
    return stop ? openingPlan(stop) : null;
  }

  /** No chase: a getaway already crashed at the kerb, steaming, nobody in it. */
  private startFallback(): void {
    const plan = this.plan!;
    const c = plan.crash;
    const ctx = this.ctx;
    const v = ctx.spawnCar(FALLBACK_CAR, trafficPaint(FALLBACK_CAR, ctx.deps.rand), c.x, c.z, c.heading);
    applyDamage(v.damage, VEHICLE_HEALTH[FALLBACK_CAR] * 0.5);
    this.fallback = true;
    this.crashed(v);
  }

  /** The getaway's at the kerb: WRONG STOP starts with it as its car. */
  private crashed(v: Vehicle): void {
    this.car = v;
    this.phase = 'crashed';
    if (this.job) this.missions.beginNow(this.job, { tag: GETAWAY_TAG, v });
  }

  /**
   * In: TAKE THE HEAT. The chase handed its cops over already (the city
   * steps first); without one (the fallback, or a chase that gave up on the
   * car) the radio has it now, with the stamp. It has run.
   */
  private gotIn(v: Vehicle): void {
    const { heat, score, bus } = this.ctx.deps;
    if (heat.wanted.level < TOOK_GETAWAY_STARS) {
      heat.called('tookGetaway');
      bus.emit({ type: 'award', award: score.award('takeTheHeat') });
      bus.emit({ type: 'street', what: 'takeTheHeat', x: v.sim.x, z: v.sim.z });
    }
    const p = this.ctx.progress;
    p.data.opening = true;
    p.markDirty();
    p.flush();
    this.phase = 'done';
  }
}
