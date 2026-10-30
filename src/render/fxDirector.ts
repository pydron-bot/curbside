/**
 * The juice: turns what the simulation reports (crashes, shots, explosions,
 * knockouts, pickups, combos) into effects, camera jolts, hit-stop and flashes,
 * and runs the per-frame driving effects, body motion and weather. main.ts
 * creates one, calls simScale() to slow the sim on big moments, and update()
 * once per frame; everything else arrives over the event bus.
 *
 * Budget: all of it draws in 5 calls at most (fire, smoke, debris, ground
 * marks, rain), fake lights go into the shared glow mesh, and nothing here
 * allocates per frame.
 */
import { Vector2, type Scene, type WebGLRenderer } from 'three';
import type { EventBus, EventOf } from '../core/events';
import type { VehicleControls } from '../entities/vehicle';
import type { CrowdPed, Vehicle } from '../game/population';
import { MAX_COMBO } from '../systems/score';
import type { WeaponKind } from '../systems/weapons';
import type { City, Rect } from '../world/city';
import type { PickupKind } from '../world/pickups';
import { FxOverlay } from '../ui/fxOverlay';
import { LEAD_CAR, LEAD_FOOT, type CameraRig } from './cameraRig';
import type { Effects, Rgb, TracerKind } from './effects';
import { DrivingFx } from './fxDriving';
import { HitStop } from './fxMotion';
import { Rain, WeatherCycle } from './fxWeather';
import { GLOW, type GlowSprites } from './glowSprites';
import type { Look } from './look';
import { getQuality } from './quality';
import { worldUniforms } from './shaderLib';

/** Matches main.ts: cars and people inside this take blast damage. */
const BLAST_RADIUS = 9;
/** On foot with a gun out, the camera rises this much to show more of the fight, m. */
const ARMED_LIFT = 5;
/** Shot at or punched recently: lift a little even with bare fists. */
const FIGHT_LIFT = 3.5;
const FIGHT_SECONDS = 4;
/** Where crash sparks, flares and chips start, m: just over a car's roof. */
const CRASH_Y = 1.6;

/** What the director needs from the player (the game's Player fits). */
export interface FxPlayer {
  driving: Vehicle | null;
  readonly ped: { x: number; z: number; heading: number };
  readonly arsenal: { current: WeaponKind | null };
  readonly alive: boolean;
}

export interface FxDeps {
  bus: EventBus;
  effects: Effects;
  rig: CameraRig;
  look: Look;
  renderer: WebGLRenderer;
  scene: Scene;
  vehicles: ReadonlyArray<Vehicle>;
  crowd: ReadonlyArray<CrowdPed>;
  player: FxPlayer;
  playerModel: { flash(seconds?: number): void };
  score: { driftPoints: number };
  city: City;
  overlayParent: HTMLElement;
  audio?: { setRain(amount: number): void };
}

const PICKUP_COLOUR: Record<PickupKind, Rgb> = {
  health: { r: 0.35, g: 1, b: 0.45 },
  pistol: { r: 1, g: 0.78, b: 0.3 },
  smg: { r: 1, g: 0.65, b: 0.2 },
  shotgun: { r: 1, g: 0.5, b: 0.2 },
};

export class FxDirector {
  readonly driving: DrivingFx;
  readonly weather = new WeatherCycle();
  readonly rain = new Rain();
  readonly hitStop = new HitStop();
  readonly overlay: FxOverlay;
  /** Exposure flash above 1 (explosions), decays in ~120 ms. */
  private flash = 0;
  private playing = false;
  private realTime = 0;
  private lastCombat = -Infinity;
  private lastBoomKick = -Infinity;
  private lastShot: TracerKind = 'pistol';
  private readonly paint: Rgb = { r: 0, g: 0, b: 0 };
  private readonly view: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  private readonly size = new Vector2();
  private readonly reduced: MediaQueryList | null;

  constructor(private readonly d: FxDeps) {
    this.driving = new DrivingFx(d.effects, d.city);
    this.overlay = new FxOverlay(d.overlayParent);
    d.scene.add(this.rain.mesh);
    d.look.addGlowSource((glows, view) => this.drawGlows(glows, view));
    // Respect "reduce motion": a gentler camera.
    this.reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const applyReduced = () => (d.rig.reducedMotion = this.reduced?.matches ?? false);
    applyReduced();
    this.reduced?.addEventListener?.('change', applyReduced);

    const bus = d.bus;
    bus.on('crash', (e) => this.onCrash(e));
    bus.on('explosion', (e) => this.onExplosion(e));
    bus.on('shot', (e) => this.onShot(e));
    bus.on('bulletHit', (e) => this.onBulletHit(e));
    bus.on('punch', (e) => this.onPunch(e));
    bus.on('pedDown', (e) => this.onPedDown(e));
    bus.on('pickup', (e) => {
      const c = PICKUP_COLOUR[e.kind];
      this.d.effects.burst(e.x, e.z, c.r, c.g, c.b, Math.round(14 * this.d.effects.scale), 2.6);
    });
    bus.on('award', (e) => this.onAward(e));
    bus.on('playerHurt', (e) => {
      this.d.rig.addTrauma(0.2 + Math.min(0.4, e.amount / 50));
      this.d.playerModel.flash(0.1);
      this.lastCombat = this.realTime;
    });
    bus.on('playerDied', () => this.d.rig.addTrauma(0.5));
    bus.on('respawn', () => {
      this.flash = 0;
      this.hitStop.reset();
      this.driving.reset();
    });
  }

  /**
   * Time scale for the simulation this frame (hit-stop), advanced by real
   * seconds. Call once per frame and multiply what you feed the fixed-step
   * loop by it; the camera keeps real time.
   */
  simScale(realDt: number): number {
    return this.hitStop.step(realDt);
  }

  /**
   * Per frame, after the cars and people have been placed for this frame:
   * body motion, tyre marks and smoke, burning cars, weather, particles.
   * `controls` are the player's car controls (null on foot); focus is where
   * the action is; `playing` is false behind the title.
   */
  update(realDt: number, controls: VehicleControls | null, focusX: number, focusZ: number, playing: boolean): void {
    const d = this.d;
    this.playing = playing;
    this.realTime += realDt;
    const dt = realDt * this.hitStop.scale;

    // Camera framing: lead for driving, a nudge on foot, lift when armed or fighting.
    // During hit-stop the follow slows with the sim, so the view freezes with the action.
    d.rig.timeScale = this.hitStop.scale;
    const driving = playing ? d.player.driving : null;
    d.rig.setLead(!playing || driving ? LEAD_CAR : LEAD_FOOT);
    let lift = 0;
    if (playing && !driving && d.player.alive) {
      if (d.player.arsenal.current) lift = ARMED_LIFT;
      if (this.realTime - this.lastCombat < FIGHT_SECONDS) lift = Math.max(lift, FIGHT_LIFT);
    }
    d.rig.lift = lift;

    // Flash and weather.
    this.flash *= Math.exp(-realDt / 0.065);
    this.weather.step(realDt);
    const rain = this.weather.rain;
    worldUniforms.uWetness.value = this.weather.wetness;
    d.look.exposureBoost = (1 + this.flash) * (1 - 0.1 * rain);
    d.audio?.setRain(playing ? rain : rain * 0.5);
    d.renderer.getDrawingBufferSize(this.size);
    const tier = getQuality();
    const rainShown = rain * (tier.name === 'low' ? 0.45 : 1) * Math.max(0.6, tier.particleScale);
    this.rain.update(realDt, rainShown, d.rig.visibleGround(this.view), d.rig.currentHeight, this.size.x, this.size.y, worldUniforms.uNight.value);

    this.driving.update(dt, d.vehicles, driving, controls, d.score.driftPoints, focusX, focusZ);
    d.effects.update(dt);
  }

  /** Start or stop a rain shower now (debug, missions). */
  setRain(on: boolean, seconds?: number): void {
    this.weather.set(on, seconds);
  }

  // --- Events -----------------------------------------------------------------

  private onCrash(e: EventOf<'crash'>): void {
    const fx = this.d.effects;
    const scale = fx.scale;
    const hit = this.driving.crash(this.d.vehicles, e.x, e.z, e.impact);
    const sparks = Math.round(Math.min(26, Math.max(3, (e.impact - 2) * 1.1)) * scale);
    // Born just above roof height: lower, the near-overhead camera would see the
    // contact's first frames (hit-stop included) hidden inside the two bodies.
    fx.sparks(e.x, CRASH_Y, e.z, sparks, 4, 8 + e.impact * 0.6, 0, 0);
    if (e.impact > 7) fx.flare(e.x, CRASH_Y + 0.2, e.z, 0.6 + e.impact * 0.05, 0.07, 2.4, 2.1, 1.6);
    if (e.impact > 5) fx.puff(e.x, CRASH_Y - 0.3, e.z, 0.5, 0.6, 1.6 + e.impact * 0.05, 0.35);
    if (e.impact > 12) {
      fx.glass(e.x, CRASH_Y - 0.1, e.z, Math.round((3 + e.impact / 4) * scale), 3 + e.impact * 0.2);
      if (hit) {
        const p = hit.mesh.paint;
        for (let k = Math.round(2 + e.impact / 10); k > 0; k--) {
          const a = Math.random() * Math.PI * 2;
          const sp = 2 + Math.random() * 4;
          fx.debris.throw(e.x, CRASH_Y - 0.2, e.z, Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp, 0.18 + Math.random() * 0.2, 0.03, 0.14 + Math.random() * 0.2, p.r, p.g, p.b, 4, 10);
        }
      }
    }
    if (!e.involvesPlayer || !this.playing) return;
    const rig = this.d.rig;
    rig.addTrauma(Math.min(0.8, Math.max(0, (e.impact - 3) / 24)));
    const car = this.d.player.driving;
    if (car) rig.kick(car.sim.x - e.x, car.sim.z - e.z, Math.min(1.3, e.impact * 0.045));
    if (e.impact > 14) rig.punchFov(Math.min(4, (e.impact - 10) * 0.25));
    if (e.impact > 16) this.hitStop.hit(Math.min(0.08, 0.035 + e.impact * 0.0015), 0.1);
  }

  private onExplosion(e: EventOf<'explosion'>): void {
    const source = this.vehicleAt(e.x, e.z);
    const p = source ? source.mesh.paint : null;
    this.paint.r = p ? p.r : 0.05;
    this.paint.g = p ? p.g : 0.045;
    this.paint.b = p ? p.b : 0.04;
    this.d.effects.explode(e.x, e.z, this.paint);
    this.driving.blast(this.d.vehicles, e.x, e.z, BLAST_RADIUS + 3);

    const close = e.ownCar ? 1 : Math.max(0, 1 - e.distance / 55);
    const rig = this.d.rig;
    // A blast out of sight doesn't flash the screen; reduced motion keeps flashes soft.
    if (close > 0) this.flash = Math.max(this.flash, (0.12 + 0.75 * close) * (rig.reducedMotion ? 0.4 : 1));
    // Behind the title the attract camera stays steady.
    if (!this.playing) return;
    rig.addTrauma(close > 0 ? 0.2 + 0.75 * close : 0.08);
    // A chain reaction going off in one frame jolts the view once, not five times over.
    if (this.realTime - this.lastBoomKick > 0.15) {
      this.lastBoomKick = this.realTime;
      if (close > 0.05) rig.kick(rig.focusX - e.x, rig.focusZ - e.z, 1.6 * close);
      if (close > 0.35) rig.punchFov(5 * close);
    }
    if (e.byPlayer || e.ownCar ? close > 0.25 : close > 0.6) this.hitStop.hit(0.075, 0.06);
  }

  private onShot(e: EventOf<'shot'>): void {
    const power = e.weapon === 'shotgun' ? 1.6 : e.weapon === 'smg' ? 0.85 : e.weapon ? 1 : 0.65;
    const fx = this.d.effects;
    fx.muzzleFlash(e.x, e.z, e.dirX, e.dirZ, power);
    this.lastShot = e.weapon ?? 'npc';
    const p = this.d.player;
    if (e.byPlayer) {
      this.lastCombat = this.realTime;
      // Spent casing out of the right side of the gun (the right is (-dirZ, dirX)).
      const shell = e.weapon === 'shotgun';
      const rx = -e.dirZ;
      const rz = e.dirX;
      const sp = 1.8 + Math.random() * 1.4;
      fx.debris.throw(
        e.x - e.dirX * 0.4 + rx * 0.15,
        1.15,
        e.z - e.dirZ * 0.4 + rz * 0.15,
        rx * sp - e.dirX * 0.6,
        2.8 + Math.random() * 1.5,
        rz * sp - e.dirZ * 0.6,
        shell ? 0.07 : 0.045,
        shell ? 0.07 : 0.045,
        shell ? 0.17 : 0.1,
        shell ? 0.75 : 0.85,
        shell ? 0.08 : 0.55,
        shell ? 0.05 : 0.14,
        2.2,
        28,
        0.45,
      );
      if (this.playing) {
        const rig = this.d.rig;
        rig.addTrauma(shell ? 0.14 : 0.045);
        rig.kick(-e.dirX, -e.dirZ, shell ? 0.4 : 0.14);
      }
    } else if (!p.driving && Math.hypot(p.ped.x - e.x, p.ped.z - e.z) < 26) {
      this.lastCombat = this.realTime;
    }
  }

  private onBulletHit(e: EventOf<'bulletHit'>): void {
    const fx = this.d.effects;
    const fromX = e.fromX ?? e.x;
    const fromZ = e.fromZ ?? e.z;
    fx.tracer(fromX, fromZ, e.x, e.z, e.byPlayer ? this.lastShot : 'npc');
    fx.impact(e.x, e.z, e.target, fromX, fromZ);
    if (e.target === 'ped') this.pedAt(e.x, e.z, 1.2)?.model.flash(0.12);
    else if (e.target === 'player') {
      this.lastCombat = this.realTime;
      this.d.rig.kick(e.x - fromX, e.z - fromZ, 0.35);
    }
  }

  private onPunch(e: EventOf<'punch'>): void {
    const fx = this.d.effects;
    if (e.hit) {
      fx.flare(e.x, 1.15, e.z, 1.1, 0.09, 2.6, 2.5, 2.2);
      fx.light(e.x, 0.1, e.z, 0.3, 1.6, 0.9, 0.85, 0.75, 0.18, GLOW.ring);
      for (let k = 0; k < 3; k++) fx.puff(e.x, 0.9, e.z, 0.62, 0.3, 0.9, 0.35, (Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2, 0.5);
      if (this.playing) {
        this.d.rig.addTrauma(0.13);
        if (e.byPlayer) this.hitStop.hit(0.045, 0.12);
        else this.lastCombat = this.realTime;
      }
    } else {
      fx.puff(e.x, 1, e.z, 0.7, 0.2, 0.7, 0.18, 0, 0.2, 0, 0.35);
    }
  }

  private onPedDown(e: EventOf<'pedDown'>): void {
    const fx = this.d.effects;
    fx.dustRing(e.x, e.z, Math.max(3, Math.round(6 * fx.scale)), 0.35, 2.2);
    if (!e.isPlayer && e.cause !== 'blast') this.pedAt(e.x, e.z, 1.3)?.model.flash(0.1);
    if (!this.playing || !e.byPlayer || e.isPlayer) return;
    if (e.cause === 'vehicle') {
      this.d.rig.addTrauma(0.14);
      this.hitStop.hit(0.04, 0.15);
    } else if (e.cause === 'shot' || e.cause === 'punch') {
      this.hitStop.hit(0.045, 0.12);
    }
  }

  private onAward(e: EventOf<'award'>): void {
    if (!this.playing) return;
    const a = e.award;
    const car = this.d.player.driving;
    const at = car ? car.mesh.root.position : this.d.player.ped;
    if (a.kind === 'nearMiss' && car) {
      // A whoosh: streaks along both flanks, a quick widen of the view.
      const s = car.sim;
      const sp = Math.hypot(s.vx, s.vz) || 1;
      const dx = s.vx / sp;
      const dz = s.vz / sp;
      for (let k = 0; k < 10; k++) {
        const side = k % 2 ? 1 : -1;
        const off = side * (1.6 + Math.random() * 1.6);
        const ahead = -3 + Math.random() * 10;
        this.d.effects.streak(at.x + dx * ahead - dz * off, 0.8 + Math.random() * 1.4, at.z + dz * ahead + dx * off, dx, dz, 4 + Math.random() * 4, 0.6, 0.32, 0.2);
      }
      this.d.rig.punchFov(-2);
    }
    // Combo milestones: the multiplier just reached ×5 or ×10.
    const reached = Math.min(MAX_COMBO, a.multiplier + 1);
    if (reached !== a.multiplier && (reached === 5 || reached === MAX_COMBO)) {
      const top = reached === MAX_COMBO;
      this.overlay.edgeFlash(top ? 'rgb(255 70 170 / 0.8)' : 'rgb(255 196 64 / 0.75)', top ? 1 : 0.6);
      if (top) this.d.effects.burst(at.x, at.z, 1, 0.3, 0.75, Math.round(26 * this.d.effects.scale), 5);
      else this.d.effects.burst(at.x, at.z, 1, 0.75, 0.25, Math.round(18 * this.d.effects.scale), 4.5);
      this.d.rig.addTrauma(top ? 0.25 : 0.12);
    }
  }

  // --- Helpers --------------------------------------------------------------

  /** Fake lights and burning-car glows, drawn with the rest of the glows. */
  private drawGlows(glows: GlowSprites, view: Rect): void {
    this.d.effects.drawLights(glows, view);
    const f = this.driving.fires;
    const night = worldUniforms.uNight.value;
    const strength = 0.4 + 0.75 * night;
    for (let i = 0; i < f.count; i++) {
      const x = f.x[i];
      const z = f.z[i];
      if (x < view.minX - 8 || x > view.maxX + 8 || z < view.minZ - 8 || z > view.maxZ + 8) continue;
      const k = f.k[i] * strength;
      glows.addFlat(x, 0.09, z, 0, 11, 11, 1.0 * k, 0.42 * k, 0.1 * k, GLOW.disc);
      glows.addFlat(x, 1.9, z, 0, 3.4, 3.4, 1.2 * k, 0.6 * k, 0.16 * k, GLOW.disc);
    }
  }

  private vehicleAt(x: number, z: number): Vehicle | null {
    const list = this.d.vehicles;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (Math.abs(v.sim.x - x) < 0.01 && Math.abs(v.sim.z - z) < 0.01) return v;
    }
    return null;
  }

  private pedAt(x: number, z: number, within: number): CrowdPed | null {
    let best: CrowdPed | null = null;
    let bestD = within;
    const list = this.d.crowd;
    for (let i = 0; i < list.length; i++) {
      const s = list[i].agent.s;
      const dd = Math.hypot(s.x - x, s.z - z);
      if (dd < bestD) {
        bestD = dd;
        best = list[i];
      }
    }
    return best;
  }
}
