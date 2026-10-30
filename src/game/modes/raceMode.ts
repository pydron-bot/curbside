/**
 * Checkpoint races on the screen: a chequered line glowing at each course's
 * start crossing (on the radar as 'R'). Drive into it and the car lines up
 * on the grid, 3-2-1-GO; then a gate of light marks the next checkpoint
 * (the one after it shown small), the radar routes to it, and the card
 * counts the time up against the gold time. Medals pay the first time
 * they're reached (races.ts).
 */
import { createVehicleState, speed } from '../../entities/vehicle';
import type { GlowSprites } from '../../render/glowSprites';
import { MARK, chequer, gate, groundRing, nearView, type ProgressProps } from '../../render/progressLook';
import { fmt } from '../../ui/scoreHud';
import type { Rect } from '../../world/city';
import { dirHeading } from '../../world/roads';
import type { Vehicle } from '../population';
import type { Medal } from '../progressSave';
import { KeyedText, type Mode, type ModeCtx } from './context';
import { MEDAL_FACTORS, MEDAL_PAY, RACES, RaceRun, START_RADIUS, formatRaceTime, legDir, nodeX, nodeZ, raceMedal, startGrid, type RaceDef } from './races';

/** Out of the car this long and the race is off, s. */
const OUT_OF_CAR = 8;
/** Drive in slower than this to start, m/s. */
const START_SPEED = 9;
const PROMPT_RANGE = 30;
const MEDAL_WORD: Record<Medal, string> = { gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE' };

export class RaceMode implements Mode {
  private run: RaceRun | null = null;
  private armed = new Map<string, boolean>();
  private near: RaceDef | null = null;
  private shownCount = 0;
  private outOfCar = 0;
  private blipsOn = false;
  /** The car the race started in: wreck it and the race is over. */
  private car: Vehicle | null = null;
  private readonly goal = new KeyedText();
  private readonly promptText = new KeyedText();
  private gold = '';

  constructor(private readonly ctx: ModeCtx) {
    for (const r of RACES) this.armed.set(r.id, true);
    const fail = () => this.run && this.end(false, 'WASTED');
    ctx.deps.bus.on('playerDied', fail);
    ctx.deps.bus.on('busted', () => this.run && this.end(false, 'BUSTED'));
  }

  step(dt: number): void {
    const ctx = this.ctx;
    this.syncBlips();
    const p = ctx.deps.player;
    const run = this.run;
    if (run) {
      // Any car will do, but wreck the one you started in and it's over.
      const car = p.driving;
      if (this.car?.damage.wrecked || car?.damage.wrecked) return this.end(false, 'WRECKED');
      if (!car) {
        this.outOfCar += dt;
        if (this.outOfCar > OUT_OF_CAR) return this.end(false, 'YOU LEFT THE CAR');
      } else {
        this.outOfCar = 0;
        this.car = car;
      }
      const before = run.phase;
      const at = p.position;
      const r = run.step(dt, at.x, at.z);
      if (run.phase === 'countdown') {
        const n = Math.ceil(run.countdown);
        if (n !== this.shownCount && n > 0) {
          this.shownCount = n;
          ctx.ui.banner(String(n), 'count', run.def.name, 0.9);
          ctx.deps.audio.ui('countdown');
        }
      } else if (before === 'countdown') {
        ctx.holdControls = false;
        ctx.ui.banner('GO!', 'go', '', 0.8);
        ctx.deps.audio.ui('go');
      }
      if (r === 'checkpoint') {
        ctx.deps.audio.ui('confirm');
        this.aimRadar();
      } else if (r === 'finish') this.end(true, '');
      else if (r === 'timeout') this.end(false, 'TOO SLOW');
      return;
    }
    this.near = null;
    if (!ctx.freeRoam || !ctx.live) return;
    const car = p.driving;
    const at = p.position;
    for (const def of RACES) {
      const sx = nodeX(def.nodes[0]);
      const sz = nodeZ(def.nodes[0]);
      const d = Math.hypot(at.x - sx, at.z - sz);
      if (d > START_RADIUS + 10) this.armed.set(def.id, true);
      if (d < PROMPT_RANGE) this.near = def;
      if (!car || car.damage.wrecked || ctx.busy || !this.armed.get(def.id)) continue;
      if (d < START_RADIUS && speed(car.sim) < START_SPEED) {
        this.armed.set(def.id, false);
        this.begin(def);
        break;
      }
    }
  }

  private begin(def: RaceDef): void {
    const ctx = this.ctx;
    const car = ctx.deps.player.driving!;
    // Line up on the grid.
    const g = startGrid(def);
    Object.assign(car.sim, createVehicleState(g.x, g.z, g.heading));
    Object.assign(car.prev, car.sim);
    ctx.deps.rig.snapTo(g.x, g.z);
    this.run = new RaceRun(def);
    this.gold = formatRaceTime(this.run.dev * MEDAL_FACTORS.gold);
    this.goal.reset();
    this.car = car;
    this.shownCount = 0;
    this.outOfCar = 0;
    ctx.busy = 'race';
    ctx.holdControls = true;
    this.aimRadar();
  }

  private end(finished: boolean, why: string): void {
    const ctx = this.ctx;
    const run = this.run!;
    run.fail();
    ctx.holdControls = false;
    if (finished) {
      const id = run.def.id;
      const medal = raceMedal(run.time, run.dev);
      const best = ctx.progress.data.raceTimes[id];
      const record = best === undefined || run.time < best;
      if (record) ctx.progress.data.raceTimes[id] = Math.round(run.time * 100) / 100;
      const improved = ctx.progress.recordMedal(id, medal);
      // A better medal pays in full; a repeat pays a tenth.
      const pay = medal ? (improved ? MEDAL_PAY[medal] : MEDAL_PAY[medal] / 10) : 0;
      const paid = pay > 0 ? ctx.pay(pay, 'race', 'RACE') : 0;
      ctx.ui.banner(medal ? `${MEDAL_WORD[medal]}!` : 'FINISHED', medal ? 'gold' : 'pass', `${formatRaceTime(run.time)}${record && best !== undefined ? ' · RECORD' : ''}${paid ? ` · +$${fmt(paid)}` : ''}`, 3);
      ctx.deps.audio.ui(medal ? 'success' : 'confirm');
      ctx.progress.markDirty();
      ctx.progress.flush();
    } else if (ctx.live || why === 'WASTED' || why === 'BUSTED') {
      ctx.ui.banner('RACE OVER', 'fail', why);
      ctx.deps.audio.ui('fail');
    }
    this.run = null;
    this.car = null;
    if (ctx.busy === 'race') ctx.busy = null;
    ctx.deps.radar.clearWaypoint();
    ctx.unblip('race-next');
    this.blipsOn = false;
  }

  /** Route the radar to the next checkpoint. */
  private aimRadar(): void {
    const run = this.run;
    if (!run || run.next >= run.def.nodes.length) return;
    const n = run.def.nodes[run.next];
    this.ctx.deps.radar.setWaypoint(nodeX(n), nodeZ(n));
    this.ctx.blip('race-next', { x: nodeX(n), z: nodeZ(n), kind: 'race', icon: run.next === run.def.nodes.length - 1 ? 'F' : String(run.next), size: 6, pulse: true });
  }

  hud(): boolean {
    const run = this.run;
    if (!run) return false;
    const ui = this.ctx.ui;
    ui.activity(run.def.name);
    ui.timer(run.time, false, Infinity);
    const back = this.outOfCar > 0 ? Math.ceil(OUT_OF_CAR - this.outOfCar) : 0;
    const g = this.goal;
    if (g.stale(run.passed * 100 + back)) g.text = back ? `GET BACK IN THE CAR · ${back}` : `CHECKPOINT ${run.passed}/${run.checkpoints} · GOLD ${this.gold}`;
    ui.goal(g.text);
    return true;
  }

  prompt(): string | null {
    const def = this.near;
    if (!def || this.run || this.ctx.busy) return null;
    const best = this.ctx.progress.data.raceTimes[def.id];
    const driving = this.ctx.deps.player.driving !== null;
    const p = this.promptText;
    if (p.stale(RACES.indexOf(def) * 2 + (driving ? 1 : 0) + (best ?? 0) * 100)) {
      const tail = best !== undefined ? ` · BEST ${formatRaceTime(best)}` : '';
      p.text = driving ? `RACE · ${def.name} · DRIVE ONTO THE LINE${tail}` : `RACE · ${def.name} · NEEDS A CAR${tail}`;
    }
    return p.text;
  }

  glow(g: GlowSprites, _props: ProgressProps, view: Rect, t: number): void {
    const run = this.run;
    if (run) {
      const nodes = run.def.nodes;
      for (let k = 0; k < 2; k++) {
        const i = run.next + k;
        if (i >= nodes.length) break;
        const x = nodeX(nodes[i]);
        const z = nodeZ(nodes[i]);
        if (!nearView(x, z, view, 14)) continue;
        const heading = dirHeading(legDir(nodes[i - 1], nodes[i]));
        const finish = i === nodes.length - 1;
        if (k === 0) {
          const pulse = 0.75 + 0.25 * Math.sin(t * 6);
          gate(g, x, z, heading, 16, finish ? MARK.white : MARK.race, pulse, t);
          if (finish) chequer(g, x, z, heading, 15, 0.8);
        } else groundRing(g, x, z, 7, MARK.race, 0.45, t);
      }
      return;
    }
    // Start lines only while nothing else is on (they can't start meanwhile).
    if (!this.ctx.freeRoam || this.ctx.busy) return;
    for (const def of RACES) {
      const x = nodeX(def.nodes[0]);
      const z = nodeZ(def.nodes[0]);
      if (!nearView(x, z, view, 12)) continue;
      const heading = dirHeading(legDir(def.nodes[0], def.nodes[1]));
      const medal = this.ctx.progress.medal(def.id);
      chequer(g, x, z, heading, 14, 0.55 + 0.25 * Math.sin(t * 2.5));
      groundRing(g, x, z, START_RADIUS * 2, medal === 'gold' ? MARK.gold : MARK.race, 0.6 + 0.2 * Math.sin(t * 3), t * 0.4);
    }
  }

  reset(): void {
    if (this.run) {
      this.run = null;
      this.car = null;
      this.ctx.deps.radar.clearWaypoint();
      this.ctx.unblip('race-next');
    }
    if (this.ctx.busy === 'race') this.ctx.busy = null;
    for (const r of RACES) this.armed.set(r.id, true);
    this.hideBlips();
  }

  private syncBlips(): void {
    const want = this.ctx.freeRoam && !this.run;
    if (want === this.blipsOn) return;
    if (!want) return this.hideBlips();
    this.blipsOn = true;
    for (const def of RACES) {
      const gold = this.ctx.progress.medal(def.id) === 'gold';
      this.ctx.blip(def.id, { x: nodeX(def.nodes[0]), z: nodeZ(def.nodes[0]), kind: 'race', colour: gold ? '#ffd23f' : undefined, icon: 'R', size: 5.5 });
    }
  }

  private hideBlips(): void {
    this.blipsOn = false;
    for (const def of RACES) this.ctx.unblip(def.id);
  }
}
