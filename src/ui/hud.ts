import './tokens.css';
import './hud.css';
import type { EventBus } from '../core/events';
import type { InputDevice } from '../core/input';
import type { VehicleSpec } from '../entities/vehicle';
import { onSettingsChange, settings } from '../core/settings';
import { BUSTED_SECONDS, RESPAWN_SECONDS } from '../game/player';
import { RunStats } from '../game/runStats';
import type { Score } from '../systems/score';
import { WEAPONS, type WeaponKind } from '../systems/weapons';
import { hiddenSetter, styleSetter, textSetter } from './domWrite';
import { ICONS } from './icons';
import { ScoreHud } from './scoreHud';
import { WastedScreen } from './wastedScreen';

/** What the HUD shows this frame. main.ts fills one of these and reuses it. */
export interface HudFrame {
  /** Player health 0..100. */
  health: number;
  weapon: WeaponKind | null;
  ammo: number;
  /** Set while driving. */
  car: CarHud | null;
  /** A car in reach on foot: 'enter' (empty) or 'jack' (someone's driving). */
  nearCar: 'enter' | 'jack' | null;
  device: InputDevice;
  /** Aiming with the mouse on foot: the cursor becomes a crosshair. */
  mouseAim: boolean;
}

export interface CarHud {
  kmh: number;
  /** The gauge's full scale. */
  maxKmh: number;
  /** Car health 0..1. */
  health: number;
  /** On fire: it's going to blow. */
  burning: boolean;
}

export function createHudFrame(): HudFrame {
  return { health: 100, weapon: null, ammo: 0, car: null, nearCar: null, device: 'keyboard', mouseAim: false };
}

/**
 * Where the speedometer's scale ends for a car: just above the speed it can
 * actually reach (drag stops it short of spec.maxSpeed, see stepVehicle), so
 * flat out fills the dial whatever the tuning.
 */
export function gaugeTopSpeed(spec: Pick<VehicleSpec, 'accel' | 'maxSpeed' | 'drag'>): number {
  const terminal = spec.accel / (spec.accel / spec.maxSpeed + spec.drag);
  return Math.min(spec.maxSpeed, terminal) * 1.06;
}

export interface HudOptions {
  /** The pause button was pressed. */
  onPause(): void;
  /** The developer line (fps · resolution · draw calls), polled 4× a second while shown. */
  debugText(): string;
}

/** Below this health the screen edge pulses red. */
const CRITICAL_HEALTH = 30;
const ARC_TICKS = 12;

/**
 * The in-game HUD, plain DOM over the canvas, laid out around the thumbs:
 *  - top left: the radar (radar.ts), and beside it player health as a
 *    segmented bar with the weapon and ammo under it, or in a car an arc
 *    speedometer with the car's health as an inner arc;
 *  - top centre: a 44pt pause button; top right: score, combo and the feed;
 *  - bottom centre: device-aware prompts ("E GET IN", "Ⓨ STEAL CAR"; on
 *    touch the ENTER button pulses instead);
 *  - a red vignette that scales with each hit and pulses at low health, and
 *    the WASTED screen with the life's stats.
 * Everything stays inside the safe areas; writes happen only on change.
 */
export class Hud {
  readonly score: ScoreHud;
  readonly stats: RunStats;
  private readonly wasted: WastedScreen;
  private readonly status: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpGhost: HTMLElement;
  private readonly weaponIcon: HTMLElement;
  private readonly setAmmo: (s: string) => void;
  private readonly speedo: HTMLElement;
  private readonly spFill: SVGPathElement;
  private readonly spCar: SVGPathElement;
  private readonly setKmh: (s: string) => void;
  private readonly prompt: HTMLElement;
  private readonly promptKey: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly hurt: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly setDebug: (s: string) => void;
  private readonly setSpeedoHidden: (h: boolean) => void;
  private readonly setPromptHidden: (h: boolean) => void;
  private readonly setHpScale: (s: string) => void;
  private readonly setGhostScale: (s: string) => void;
  private shownHealth = -1;
  private shownWeapon: WeaponKind | null | undefined;
  private shownAmmo = -1;
  private shownKmh = -1;
  private shownCarHealth = -1;
  private shownCarState = '';
  private shownIdle = false;
  private shownPrompt = '';
  private promptKeyText = '';
  private promptDevice: InputDevice | '' = '';
  private shownCritical = false;
  private shownMouseAim = false;
  private debugTimer = 0;
  private bestAtStart: number;
  private playing = false;
  private readonly debugFromUrl = new URLSearchParams(location.search).has('debug');

  constructor(
    parent: HTMLElement,
    scoreModel: Score,
    bus: EventBus,
    private readonly opts: HudOptions,
  ) {
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div class="hud-status">
        <div class="hp"><span class="hp-icon">${ICONS.heart}</span><div class="hp-bar"><i class="hp-ghost"></i><i class="hp-fill"></i><i class="hp-gaps"></i></div></div>
        <div class="weapon"><span class="weapon-icon"></span><b class="weapon-ammo"></b></div>
      </div>
      <div class="speedo" hidden>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <defs><linearGradient id="sp-grad" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#2ee6ff"/><stop offset=".6" stop-color="#b15cff"/><stop offset="1" stop-color="#ff2e88"/></linearGradient></defs>
          <path class="sp-track" d="M21.7 78.3A40 40 0 1 1 78.3 78.3" pathLength="100"/>
          <g class="sp-ticks"></g>
          <path class="sp-fill" d="M21.7 78.3A40 40 0 1 1 78.3 78.3" pathLength="100"/>
          <path class="sp-car-track" d="M28.1 71.9A31 31 0 1 1 71.9 71.9" pathLength="100"/>
          <path class="sp-car" d="M28.1 71.9A31 31 0 1 1 71.9 71.9" pathLength="100"/>
        </svg>
        <div class="sp-num"><b>0</b><small>KM/H</small></div>
        <div class="sp-icon">${ICONS.wrench}</div>
        <div class="sp-warn">GET OUT!</div>
      </div>
      <button class="hud-pause" type="button" aria-label="Pause">${ICONS.pause}</button>
      <div class="hud-prompt" hidden><span class="key"></span><span class="txt"></span></div>
      <div class="hud-debug" hidden></div>`;
    parent.append(root);

    const hurt = document.createElement('div');
    hurt.id = 'hurt';
    parent.append(hurt);
    this.hurt = hurt;

    this.score = new ScoreHud(root, scoreModel);
    this.wasted = new WastedScreen(parent);
    this.stats = new RunStats(bus);
    this.bestAtStart = scoreModel.best;

    const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    this.status = q('.hud-status');
    this.hpFill = q('.hp-fill');
    this.hpGhost = q('.hp-ghost');
    this.weaponIcon = q('.weapon-icon');
    this.setAmmo = textSetter(q('.weapon-ammo'));
    this.speedo = q('.speedo');
    this.spFill = q<SVGPathElement>('.sp-fill');
    this.spCar = q<SVGPathElement>('.sp-car');
    this.setKmh = textSetter(q('.sp-num b'));
    this.prompt = q('.hud-prompt');
    this.promptKey = q('.hud-prompt .key');
    this.promptText = q('.hud-prompt .txt');
    this.debug = q('.hud-debug');
    this.setDebug = textSetter(this.debug);
    this.setSpeedoHidden = hiddenSetter(this.speedo);
    this.setPromptHidden = hiddenSetter(this.prompt);
    this.setHpScale = styleSetter(this.hpFill, 'transform');
    this.setGhostScale = styleSetter(this.hpGhost, 'transform');
    drawTicks(q('.sp-ticks'));

    q('.hud-pause').addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      opts.onPause();
    });
    const showDebug = () => (this.debug.hidden = !(this.debugFromUrl || settings.showFps));
    showDebug();
    onSettingsChange(showDebug);

    bus.on('award', (e) => this.score.pop(e.award));
    bus.on('pickup', (e) =>
      e.kind === 'health' ? this.score.notice('+ HEALTH', 'health') : this.score.notice(`+ ${WEAPONS[e.kind].label}`, 'weapon'),
    );
    bus.on('playerHurt', (e) => this.flashHurt(e.amount));
    bus.on('playerDied', () =>
      this.wasted.show({
        score: scoreModel.total,
        best: scoreModel.best,
        newBest: scoreModel.total > this.bestAtStart && scoreModel.total >= scoreModel.best,
        stats: this.stats,
        respawnIn: RESPAWN_SECONDS,
      }),
    );
    bus.on('busted', (e) =>
      this.wasted.show({
        variant: 'busted',
        fine: e.fine,
        score: scoreModel.total,
        best: scoreModel.best,
        newBest: false,
        stats: this.stats,
        respawnIn: BUSTED_SECONDS,
      }),
    );
    bus.on('respawn', () => {
      this.wasted.hide();
      this.score.newRun();
      this.bestAtStart = scoreModel.best;
      this.shownHealth = -1;
    });
  }

  /** 'title' hides the game HUD and touch controls; 'play' shows them (body[data-scene]). */
  setScene(scene: 'title' | 'play'): void {
    this.playing = scene === 'play';
    if (document.body.dataset.scene !== scene) document.body.dataset.scene = scene;
  }

  /** Per frame (while not paused). */
  update(dt: number, f: HudFrame): void {
    const body = document.body;
    if (body.dataset.device !== f.device) body.dataset.device = f.device;
    // Touch layouts shift a little between foot and car (hud.css).
    const mode = f.car ? 'car' : 'foot';
    if (body.dataset.mode !== mode) body.dataset.mode = mode;
    if (f.mouseAim !== this.shownMouseAim) {
      this.shownMouseAim = f.mouseAim;
      body.dataset.aim = f.mouseAim ? 'mouse' : '';
    }
    if (this.playing) this.stats.tick(dt);
    this.score.update(dt);
    this.updateHealth(f.health);

    const car = f.car;
    this.setSpeedoHidden(!car);
    if (car) this.updateSpeedo(car);
    // Fists or a gun on foot; nothing in a car (no drive-bys).
    const weapon = car ? undefined : f.weapon;
    if (weapon !== this.shownWeapon) {
      this.shownWeapon = weapon;
      this.status.classList.toggle('in-car', weapon === undefined);
      if (weapon !== undefined) this.weaponIcon.innerHTML = ICONS[weapon ?? 'fist'];
      this.status.classList.toggle('armed', !!weapon);
    }
    const ammo = weapon ? f.ammo : -1;
    if (ammo !== this.shownAmmo) {
      this.shownAmmo = ammo;
      this.setAmmo(ammo >= 0 ? String(ammo) : '');
    }

    this.updatePrompt(f);

    if (!this.debug.hidden && (this.debugTimer -= dt) <= 0) {
      this.debugTimer = 0.25;
      this.setDebug(this.opts.debugText());
    }
  }

  private updateHealth(health: number): void {
    const hp = Math.max(0, Math.ceil(health));
    if (hp === this.shownHealth) return;
    this.shownHealth = hp;
    this.setHpScale(`scaleX(${hp / 100})`);
    // A pale "ghost" bar behind it lingers, then drains (a delayed CSS transition).
    this.setGhostScale(`scaleX(${hp / 100})`);
    const critical = hp > 0 && hp < CRITICAL_HEALTH;
    if (critical !== this.shownCritical) {
      this.shownCritical = critical;
      this.status.classList.toggle('critical', critical);
      this.hurt.classList.toggle('critical', critical);
    }
  }

  private updateSpeedo(car: CarHud): void {
    const kmh = Math.round(car.kmh);
    if (kmh !== this.shownKmh) {
      this.shownKmh = kmh;
      this.setKmh(String(kmh));
      const p = Math.min(100, (kmh / car.maxKmh) * 100);
      // The gap is longer than the path, so the dash pattern never repeats a dot at the end.
      this.spFill.style.strokeDasharray = `${p.toFixed(1)} 200`;
      const idle = kmh === 0;
      if (idle !== this.shownIdle) this.speedo.classList.toggle('idle', (this.shownIdle = idle));
    }
    const hp = Math.round(car.health * 100);
    if (hp !== this.shownCarHealth) {
      this.shownCarHealth = hp;
      this.spCar.style.strokeDasharray = `${hp} 200`;
    }
    const state = car.burning ? 'burning' : hp > 60 ? 'ok' : hp > 25 ? 'hurt' : 'bad';
    if (state !== this.shownCarState) this.speedo.dataset.state = this.shownCarState = state;
  }

  private updatePrompt(f: HudFrame): void {
    let key = '';
    let text = '';
    if (f.nearCar && !f.car && f.device !== 'touch') {
      key = f.device === 'gamepad' ? 'Y' : 'E';
      text = f.nearCar === 'jack' ? 'STEAL THIS CAR' : 'GET IN';
    }
    // Compare the parts, not a joined string: this runs every frame.
    if (f.device === this.promptDevice && key === this.promptKeyText && text === this.shownPrompt) return;
    this.promptDevice = f.device;
    this.promptKeyText = key;
    this.shownPrompt = text;
    this.setPromptHidden(!text);
    if (!text) return;
    this.promptKey.textContent = key;
    this.promptKey.className = `key key-${f.device}`;
    this.promptText.textContent = text;
  }

  private flashHurt(amount: number): void {
    const strength = Math.max(0.35, Math.min(1, amount / 28));
    // Bigger hits frame the screen thicker (the vignette's size is in vmin, hud.css).
    this.hurt.style.setProperty('--hurt', strength.toFixed(2));
    this.hurt.animate?.([{ opacity: strength }, { opacity: 0 }], { duration: 300 + strength * 400, easing: 'ease-out' });
  }
}

/** Static tick marks around the speedometer arc. */
function drawTicks(g: SVGGElement): void {
  const ns = 'http://www.w3.org/2000/svg';
  for (let i = 0; i <= ARC_TICKS; i++) {
    const a = ((135 + (270 * i) / ARC_TICKS) * Math.PI) / 180;
    const major = i % 3 === 0;
    const r0 = major ? 43.5 : 44.5;
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', (50 + Math.cos(a) * r0).toFixed(2));
    line.setAttribute('y1', (50 + Math.sin(a) * r0).toFixed(2));
    line.setAttribute('x2', (50 + Math.cos(a) * 47.5).toFixed(2));
    line.setAttribute('y2', (50 + Math.sin(a) * 47.5).toFixed(2));
    if (major) line.setAttribute('class', 'major');
    g.append(line);
  }
}
