/**
 * Taxi fares on the screen: in a taxi you're on duty (the card says so).
 * Someone on the pavement ahead raises an arm and waves under a yellow
 * marker; stop beside them and they get in (off the street), the radar
 * routes to their destination and the clock runs. Arrive and stop to get
 * paid by distance and time to spare, with a streak bonus every fifth fare
 * (taxi.ts). The passenger gets out and walks off, or bails and runs.
 */
import { driverDoorPosition, speed } from '../../entities/vehicle';
import type { GlowSprites } from '../../render/glowSprites';
import { MARK, beacon, groundRing, nearView, type ProgressProps } from '../../render/progressLook';
import { resumeWalking, scare, spawnPed } from '../../systems/crowd';
import type { BlipOptions } from '../../ui/radar';
import { fmt } from '../../ui/scoreHud';
import { BLOCKS_PER_SIDE, type Rect } from '../../world/city';
import type { CrowdPed, Vehicle } from '../population';
import { KeyedText, type Mode, type ModeCtx } from './context';
import { pavement } from './places';
import { TRIP_RANGE, TaxiDuty, fareFor, type TaxiInput } from './taxi';

/** Where a hail can come from: this far from the cab, m... */
const HAIL_RANGE = [14, 60] as const;
/** ...and roughly ahead of it (cosine of the angle off the nose). */
const HAIL_AHEAD = 0.2;
/** The hailing passenger waves this often, s. */
const WAVE_EVERY = 0.75;

export class TaxiMode implements Mode {
  private readonly duty: TaxiDuty;
  private readonly input: TaxiInput = { onDuty: false, x: 0, z: 0, speed: 0, health: 1, stars: 0, fare: null };
  private readonly farePos = { x: 0, z: 0 };
  private fare: CrowdPed | null = null;
  private wave = 0;
  private cab: Vehicle | null = null;
  /** The hailing fare's radar blip, moved with them (reused: no garbage per step). */
  private readonly label = new KeyedText();
  private readonly goal = new KeyedText();
  private readonly fareBlip: BlipOptions = { x: 0, z: 0, kind: 'objective', icon: 'T', size: 5.5, pulse: true, edgeArrow: true };

  constructor(private readonly ctx: ModeCtx) {
    this.duty = new TaxiDuty(ctx.deps.rand);
  }

  step(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.deps.player;
    const car = p.driving;
    const i = this.input;
    i.onDuty = ctx.live && ctx.freeRoam && !!car && car.archetype === 'taxi' && !car.damage.wrecked && (ctx.busy === null || ctx.busy === 'taxi');
    if (car && i.onDuty) {
      this.cab = car;
      i.x = car.sim.x;
      i.z = car.sim.z;
      i.speed = speed(car.sim);
      i.health = car.damage.health / car.damage.maxHealth;
      i.stars = ctx.deps.heat.wanted.level;
    }
    const f = this.fare;
    const fareOk = f !== null && ctx.deps.population.crowd.includes(f) && f.agent.mode === 'arrest';
    i.fare = fareOk ? ((this.farePos.x = f.agent.s.x), (this.farePos.z = f.agent.s.z), this.farePos) : null;
    if (fareOk) {
      this.fareBlip.x = f.agent.s.x;
      this.fareBlip.z = f.agent.s.z;
      ctx.blip('taxi', this.fareBlip);
    }
    if (fareOk && (this.wave -= dt) <= 0) {
      this.wave = WAVE_EVERY;
      f.model.punch(); // the arm goes up: a wave
      f.agent.s.heading = Math.atan2(i.x - f.agent.s.x, i.z - f.agent.s.z);
    }
    const r = this.duty.step(dt, i);
    if (!r) return;
    switch (r) {
      case 'wantHail':
        this.hail();
        return;
      case 'lapsed':
        this.dropHail();
        return;
      case 'board':
        this.board();
        return;
      case 'fare':
        return this.arrive();
      default:
        return this.lose(r === 'late' ? 'TOO SLOW' : r === 'bailed' ? 'THE FARE BAILED' : 'YOU LEFT THE CAB');
    }
  }

  /** Pick someone walking ahead of the cab to hail it. */
  private hail(): void {
    const { deps } = this.ctx;
    const car = deps.player.driving;
    if (!car) return;
    const fx = Math.sin(car.sim.heading);
    const fz = Math.cos(car.sim.heading);
    let best: CrowdPed | null = null;
    let bestD = Infinity;
    for (const c of deps.population.crowd) {
      const a = c.agent;
      if (a.mode !== 'walk' || a.role !== 'civilian') continue;
      const dx = a.s.x - car.sim.x;
      const dz = a.s.z - car.sim.z;
      const d = Math.hypot(dx, dz);
      if (d < HAIL_RANGE[0] || d > HAIL_RANGE[1] || (dx * fx + dz * fz) / d < HAIL_AHEAD) continue;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) return; // the duty asks again shortly
    // Stop and wave (an officer's "stand here" mode, at their own spot).
    best.agent.mode = 'arrest';
    best.agent.goalX = best.agent.s.x;
    best.agent.goalZ = best.agent.s.z;
    this.fare = best;
    this.wave = 0;
    this.duty.hailed();
    this.ctx.notice('TAXI! A FARE HAILS', 'progress');
  }

  private dropHail(): void {
    const f = this.fare;
    this.fare = null;
    this.ctx.unblip('taxi');
    if (f && f.agent.mode === 'arrest') resumeWalking(f.agent);
  }

  private board(): void {
    const { deps } = this.ctx;
    const f = this.fare;
    this.fare = null;
    if (f) deps.population.removePed(f);
    const car = deps.player.driving!;
    const dest = this.destination(car.sim.x, car.sim.z);
    const dist = Math.hypot(dest.x - car.sim.x, dest.z - car.sim.z);
    this.duty.startTrip(dest.x, dest.z, dist, car.damage.health / car.damage.maxHealth);
    this.ctx.busy = 'taxi';
    deps.radar.setWaypoint(dest.x, dest.z);
    this.ctx.blip('taxi', { x: dest.x, z: dest.z, kind: 'objective', icon: 'T', size: 6, pulse: true, edgeArrow: true });
    this.ctx.notice(`FARE · ${Math.round(dist)} M`, 'progress');
    deps.audio.ui('confirm');
  }

  /** A pavement point TRIP_RANGE away (straight line), inside the city. */
  private destination(x: number, z: number): { x: number; z: number } {
    const rand = this.ctx.deps.rand;
    let p = { x: 0, z: 0 };
    for (let i = 0; i < 60; i++) {
      p = pavement(Math.floor(rand() * BLOCKS_PER_SIDE), Math.floor(rand() * BLOCKS_PER_SIDE), Math.floor(rand() * 4), 0.2 + rand() * 0.6);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d >= TRIP_RANGE[0] && d <= TRIP_RANGE[1]) break;
    }
    return p;
  }

  private arrive(): void {
    const ctx = this.ctx;
    const { fare, bonus } = this.duty.payout();
    const streak = this.duty.streak;
    ctx.pay(fare, 'taxi', 'FARE');
    if (bonus) {
      ctx.pay(bonus, 'taxi', `STREAK ×${streak}`);
      ctx.ui.banner(`${streak} IN A ROW!`, 'gold', `+$${fmt(bonus)} STREAK BONUS`);
      ctx.deps.audio.ui('success');
    }
    const save = ctx.progress.data;
    save.stats.fares++;
    save.taxi.bestStreak = Math.max(save.taxi.bestStreak, streak);
    ctx.progress.markDirty();
    this.alight(false);
    this.endTrip();
  }

  private lose(why: string): void {
    const ctx = this.ctx;
    if (ctx.live) {
      ctx.ui.banner('FARE LOST', 'fail', why);
      ctx.deps.audio.ui('fail');
    }
    if (this.cab) this.alight(true);
    this.endTrip();
  }

  private endTrip(): void {
    if (this.ctx.busy === 'taxi') this.ctx.busy = null;
    this.ctx.deps.radar.clearWaypoint();
    this.ctx.unblip('taxi');
  }

  /** The passenger gets out by the cab: walks off, or runs if it went badly. */
  private alight(run: boolean): void {
    const { deps } = this.ctx;
    const car = this.cab;
    if (!car) return;
    const door = driverDoorPosition(car.sim);
    const agent = spawnPed(0, 0, 0, 0, deps.rand);
    agent.temper = 'calm';
    Object.assign(agent.s, { x: door.x, z: door.z, vx: 0, vz: 0, heading: car.sim.heading });
    if (run) scare(agent, car.sim.x, car.sim.z, 5);
    else resumeWalking(agent);
    deps.population.addPed(agent);
  }

  hud(): boolean {
    const d = this.duty;
    if (d.phase === 'off') return false;
    const ui = this.ctx.ui;
    if (this.label.stale(d.streak)) this.label.text = d.streak > 0 ? `TAXI · STREAK ${d.streak}` : 'TAXI';
    ui.activity(this.label.text);
    if (d.phase === 'trip') {
      ui.timer(d.timeLeft, d.timeLeft <= 10, 0);
      const at = this.ctx.deps.player.position;
      // To the nearest 10 m, and the fare as it stands.
      const left = Math.round(Math.hypot(d.dest.x - at.x, d.dest.z - at.z) / 10) * 10;
      const fare = fareFor(d.tripDist, d.timeLeft, d.timeTotal);
      if (this.goal.stale(left * 100000 + fare)) this.goal.text = `DROP-OFF ${left} M · $${fmt(fare)}`;
      ui.goal(this.goal.text);
    } else {
      ui.timer(null);
      ui.goal(d.phase === 'cruising' ? 'ON DUTY · LOOK FOR A HAIL' : 'STOP BESIDE THE FARE');
    }
    return true;
  }

  prompt(): string | null {
    return null;
  }

  glow(g: GlowSprites, _props: ProgressProps, view: Rect, t: number): void {
    const d = this.duty;
    if (this.fare && this.input.fare) {
      const { x, z } = this.input.fare;
      if (nearView(x, z, view)) {
        groundRing(g, x, z, 2.6 + 0.4 * Math.sin(t * 6), MARK.taxi, 1, t);
        beacon(g, x, z, 0.9, 5, MARK.taxi, 0.6);
      }
    } else if (d.phase === 'trip' && nearView(d.dest.x, d.dest.z, view, 10)) {
      groundRing(g, d.dest.x, d.dest.z, 9, MARK.taxi, 0.7 + 0.3 * Math.sin(t * 4), t * 0.6);
      beacon(g, d.dest.x, d.dest.z, 1.6, 14, MARK.taxi, 0.6);
    }
  }

  reset(): void {
    if (this.duty.phase === 'trip' || this.fare) {
      this.dropHail();
      this.endTrip();
    }
    this.duty.phase = 'off';
    this.duty.streak = 0;
    this.cab = null;
  }
}
