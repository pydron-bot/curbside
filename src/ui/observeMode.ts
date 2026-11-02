/**
 * Observe mode (OBSERVE on the title and in the pause menu): no player, no
 * HUD, the camera handed to you over the live city. Pan, zoom and rotate
 * (keyboard, mouse, touch, gamepad); tap a car or person to ride along;
 * NEXT INCIDENT glides to whatever is happening; a palette starts any
 * city scene where the camera looks (SceneStarter, as the TEST menu, with
 * no test tools needed and no taint); time-of-day and rain nudges. One
 * small control strip that fades when idle. Leaving restores the title, or
 * the paused run exactly as it was left.
 *
 * Nobody plays while observing: the attract camera stands in as the focus
 * (it's what keeps everything "not playing": heat, combat, the crowd's
 * target, the marker) and follows this camera instead of traffic, while
 * CityLife's `observing` lets the city live as in play. From a paused run
 * the run is held (`holdsRun`): main.ts doesn't step the player, their
 * car, the police chasing them, the activity's cars, heat, score or the
 * activity's clocks (`held(v)`), so it all waits where it was.
 *
 * The camera's logic and clamps are game/observe.ts (pure, tested).
 */
import './tokens.css';
import './observe.css';
import { Vector3 } from 'three';
import type { GameAudio } from '../audio/gameAudio';
import type { Input, NavCommand } from '../core/input';
import { len2 } from '../core/len';
import { HIGHLIGHTS } from '../game/attractHighlights';
import type { CityLife, Scene, Subject } from '../game/cityLife';
import {
  IdleFade,
  OBSERVE_START_HEIGHT,
  ObserveCamera,
  clampHeight,
  nextHour,
  nextLive,
  pickFollow,
  roofFloor,
  spawnShield,
  type Roofed,
} from '../game/observe';
import type { Player } from '../game/player';
import type { CrowdPed, Vehicle } from '../game/population';
import { FireCrews } from '../game/scenes/fireCrews';
import { Tows } from '../game/scenes/tows';
import { SCENES, SCENE_KINDS, type SceneId, type SceneStarter } from '../game/sceneStarter';
import { LEAD_CAR, LEAD_FOOT, type CameraRig, type LeadSettings } from '../render/cameraRig';
import type { WeatherCycle } from '../render/fxWeather';
import type { PedState } from '../entities/pedestrian';
import { copyVehicleState, type VehicleState } from '../entities/vehicle';
import type { DamageState } from '../systems/damage';
import type { QualityTierName } from '../render/quality';
import type { PoliceForce } from '../systems/police';
import { inHours } from '../systems/incidents';
import type { Rect } from '../world/city';
import { DISTRICT_NAMES, districtAt } from '../world/districts';
import type { AttractCamera } from './attract';
import { FADE_IN, FADE_OUT, GLIDE_RANGE, fadeAlpha, groundPerPx } from './attractShow';
import type { FrontDoor } from './frontDoor';
import type { Haptics } from './haptics';
import type { Hud } from './hud';
import { ICONS, type IconName } from './icons';
import { MenuNav, menuButton, overlay, type Panel } from './menu';
import type { Radar } from './radar';
import { onTap } from './tap';
import type { TitleCamera } from './titleCamera';
import type { ScreenAwake } from './wakeLock';

/** No look-ahead: the view sits where you put it. */
const LEAD_NONE: LeadSettings = { seconds: 0, maxX: 0, maxZ: 0 };
/** How fast the rig's height follows the zoom while observing, 1/s (play's is a gentle 1.6). */
const ZOOM_EASE = 7;
/** Over this height the fog is pushed out by the difference, m (the title's cruise height sees it as designed). */
const FOG_FROM = 46;
/** A press that moves less than this (px) and lifts within TAP_MS is a tap: follow what's under it. */
const TAP_SLOP = 10;
const TAP_MS = 450;
/** A tap's slop on the ground, m per m of height (about a fingertip at 852 px across). */
const TAP_SLACK = 0.025;
/** Wheel: e-folds of height per pixel of deltaY. */
const WHEEL_ZOOM = 0.0016;
/** Held pan input under this doesn't count (a resting stick), nor does it stop a follow. */
const PAN_DEAD = 0.12;
/** Further than this, or out of view, NEXT INCIDENT fades across instead of gliding, m. */
const CUT_RANGE = GLIDE_RANGE * 2.5;
/** Moved this far (m) since the streets were last filled, and now slower than STREAM_SLOW (m/s): fill them round the camera. */
const STREAM_REFILL = 110;
const STREAM_SLOW = 6;
/** A scene just started may take this long to have something to show (a turf war gathering, a fight squaring up), s. */
const WATCH_WAIT = 10;
/** NEXT INCIDENT with nothing on: this many tries at starting one. */
const START_TRIES = 4;
/** The result line under the strip stays this long, ms. */
const NOTE_MS = 2600;
/** Gamepad buttons (standard mapping) read here: X spawns, Y next incident, LB rain, RB time. */
const PAD_X = 2;
const PAD_Y = 3;
const PAD_LB = 4;
const PAD_RB = 5;
const PAD_READ = [PAD_X, PAD_Y, PAD_LB, PAD_RB] as const;
/** A stick pushed this far wakes the strip. */
const PAD_WAKE = 0.2;

export interface ObserveDeps {
  parent: HTMLElement;
  /** The game canvas: drags, pinches, taps and the wheel land here. */
  canvas: HTMLElement;
  rig: CameraRig;
  attract: AttractCamera;
  titleCam: TitleCamera;
  frontDoor: FrontDoor;
  input: Input;
  audio: GameAudio;
  hud: Hud;
  radar: Radar;
  haptics: Haptics;
  screenAwake: ScreenAwake;
  life: CityLife;
  starter: SceneStarter;
  vehicles: readonly Vehicle[];
  crowd: readonly CrowdPed[];
  /** Roofs the camera is held off (city.buildings). */
  buildings: readonly Roofed[];
  player: Player;
  playerModel: { root: { visible: boolean } };
  police: PoliceForce;
  /** An activity's own cars (a mission's target, the Chaos Run car). */
  activityCars: readonly Vehicle[];
  /** The game clock (look.time). */
  time: { hour: number; set(hour: number): void };
  weather: WeatherCycle;
  /** look: its fog is pushed out from high up. */
  look: { fogPush: number };
  tier(): QualityTierName;
  /** The rig's height ranges: the title's cruise, on foot, in a car. */
  heights: { title: readonly [number, number]; foot: readonly [number, number]; car: readonly [number, number] };
  /** The best score, for the title. */
  best(): number;
  /** main's setPaused. */
  setPaused(paused: boolean): void;
  /** The camera jumped or travelled far: fill the streets round it. */
  moved(): void;
  /** OBSERVE is offered (after the cold open, or with Test tools on: game/opening.ts titleOffer). */
  offered(): boolean;
}

/** What the camera rides along with. */
interface Follow {
  car: Vehicle | null;
  ped: CrowdPed | null;
  scene: Scene | null;
}

/** The strip's arrows and Enter / A: directions pan the camera (Input reads them), confirm follows what's in the middle. */
class StripNav extends MenuNav {
  constructor(
    root: HTMLElement,
    private readonly confirm: () => void,
  ) {
    super(root);
  }

  override handle(cmd: NavCommand): void {
    if (cmd === 'confirm') this.confirm();
  }
}

/** The spawn palette: every city scene, started where the camera looks. */
class ObservePalette implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  readonly sheet = true;
  private onClose: () => void = () => {};
  private readonly first: HTMLElement;

  constructor(parent: HTMLElement, pick: (id: SceneId) => void) {
    const { root, card } = overlay('observe-palette', 'ui-sheet observe-sheet');
    this.root = root;
    this.nav = new MenuNav(root);
    card.innerHTML = `
      <header class="sheet-head"><h2>START SOMETHING</h2></header>
      <div class="sheet-body observe-grid" data-scroll></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.tabIndex = -1;
    close.className = 'sheet-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = ICONS.close;
    card.querySelector('.sheet-head')!.append(close);
    const grid = card.querySelector('.observe-grid')!;
    let first: HTMLElement | null = null;
    for (const [id, label] of SCENES) {
      // Rain is the strip's own nudge.
      if (id === 'rain') continue;
      const b = menuButton(label, { className: 'small observe-scene' });
      b.dataset.scene = id;
      grid.append(b);
      first ??= b;
      this.nav.add({ el: b, activate: () => pick(id) });
    }
    this.first = first!;
    this.nav.add({ el: close, activate: () => this.back() });
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(onClose: () => void, showFocus: boolean): void {
    this.onClose = onClose;
    this.root.hidden = false;
    this.nav.focusElement(this.first);
    this.nav.showFocus(showFocus);
  }

  back(): void {
    this.hide();
    this.onClose();
  }

  hide(): void {
    this.root.hidden = true;
  }
}

export class ObserveMode implements Panel {
  readonly nav: MenuNav;
  /** Esc / Start / B back out of it (to where you came from) rather than pausing over it. */
  readonly sheet = true;
  active = false;
  /** Entered from the title (else from a paused run). */
  fromTitle = false;
  /** The free camera (game/observe.ts). */
  readonly cam = new ObserveCamera();
  readonly palette: ObservePalette;
  private readonly root: HTMLElement;
  private readonly ui: HTMLElement;
  private readonly fadeEl: HTMLElement;
  private readonly captionEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly hintsEl: HTMLElement;
  private readonly followBtn: HTMLButtonElement;
  private readonly rainBtn: HTMLButtonElement;
  private rainShown = false;
  private readonly idle = new IdleFade();
  private readonly follow: Follow = { car: null, ped: null, scene: null };
  /** A scene started with nothing to show yet: watched once it has (for WATCH_WAIT s). */
  private pending: Scene | null = null;
  private pendingCaption = '';
  private pendingT = 0;
  /** The scene NEXT INCIDENT showed last (index into life.scenes), for the round. */
  private sceneIndex = -1;
  private readonly subject: Subject = { x: 0, z: 0, vx: 0, vz: 0 };
  /** A NEXT INCIDENT fade across: seconds into it, or -1. */
  private cutT = -1;
  private cutX = 0;
  private cutZ = 0;
  private fadeShown = -1;
  private uiShown = true;
  private followShown: string | null = null;
  private hintDevice: string | null = null;
  private district: string | null = null;
  private seedX = 0;
  private seedZ = 0;
  private noteTimer = 0;
  // What a held run goes back to.
  private holding = false;
  /** The held run's cars (kept from Population's recycling and the scenes while observing). */
  readonly heldCars: Vehicle[] = [];
  /** Each held car as it was (a blast or a shove while observing is undone on the way out), and the player on foot. */
  private readonly heldState = new Map<Vehicle, { sim: VehicleState; damage: DamageState }>();
  private savedPed: PedState | null = null;
  private savedFocusX = 0;
  private savedFocusZ = 0;
  private savedHeight = 0;
  private savedVisible = true;
  private savedHour = 0;
  private savedRaining = false;
  private savedRain = 0;
  private savedWet = 0;
  private weatherTouched = false;
  private savedZoomRate = 0;
  // Input.
  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private dragging = false;
  private pinchDist = 0;
  private pinchAngle = 0;
  private pinchX = 0;
  private pinchY = 0;
  private readonly padWas = [false, false, false, false];
  private readonly ndc = new Vector3();
  private readonly shieldView: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  private readonly captions = new Map<string, string>();

  constructor(private readonly d: ObserveDeps) {
    const root = document.createElement('div');
    root.id = 'observe';
    root.hidden = true;
    root.innerHTML = `
      <div class="observe-fade"></div>
      <div class="observe-caption" aria-hidden="true"><b></b><span></span></div>
      <div class="observe-ui">
        <div class="observe-note" aria-live="polite"></div>
        <div class="observe-strip"></div>
        <div class="observe-hints"></div>
      </div>`;
    d.parent.append(root);
    this.root = root;
    this.ui = root.querySelector('.observe-ui')!;
    this.fadeEl = root.querySelector('.observe-fade')!;
    this.captionEl = root.querySelector('.observe-caption')!;
    this.noteEl = root.querySelector('.observe-note')!;
    this.hintsEl = root.querySelector('.observe-hints')!;
    this.nav = new StripNav(root, () => this.toggleFollow());
    const strip = root.querySelector('.observe-strip')!;
    const button = (icon: IconName, label: string, cls: string, act: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = `observe-btn ${cls}`;
      b.innerHTML = `${ICONS[icon]}<b></b>`;
      b.querySelector('b')!.textContent = label;
      strip.append(b);
      onTap(b, () => {
        this.idle.poke();
        act();
      });
      return b;
    };
    button('exit', 'EXIT', 'observe-exit', () => this.exit());
    button('next', 'NEXT INCIDENT', 'observe-next', () => this.next());
    this.followBtn = button('target', 'FOLLOW', 'observe-follow', () => this.toggleFollow());
    button('plusSquare', 'START', 'observe-spawn', () => this.openPalette());
    button('sun', 'TIME', 'observe-time', () => this.nudgeTime());
    this.rainBtn = button('rain', 'RAIN', 'observe-rain', () => this.toggleRain());
    this.palette = new ObservePalette(d.parent, (id) => this.spawn(id));

    // Captions by clock kind: the title's names for its highlights, else the TEST menu's.
    for (const [id, label] of SCENES) if (id !== 'rain') this.captions.set(SCENE_KINDS[id], label);
    for (const h of Object.values(HIGHLIGHTS)) this.captions.set(h.kind, h.caption);

    // OBSERVE on the title and in the pause menu, once offered (not in the middle of the cold open).
    d.frontDoor.title.addEntry('OBSERVE', 'Watch the city', 'eye', 'title-observe', () => this.enterFromTitle(), d.offered);
    d.frontDoor.pause.addButton('OBSERVE', 'eye', () => this.enterFromRun(), d.offered);
    this.listen();
  }

  /** Observing a paused run: main.ts holds the player, their car, the police on them, heat, score and the activity. */
  get holdsRun(): boolean {
    return this.holding;
  }

  /** Observing from the title (a safe point for app updates; no pause on app switch). */
  get atTitle(): boolean {
    return this.active && this.fromTitle;
  }

  /** A car of the held run (not stepped, not hit, not hurt while observing). */
  held(v: Vehicle): boolean {
    return this.holding && this.heldCars.includes(v);
  }

  /**
   * The ground Population keeps its spawns out of this call (MaintainContext
   * spawnView): undefined in play, the view shrunk about the camera from high up.
   */
  spawnView(view: Rect): Rect | undefined {
    if (!this.active) return undefined;
    return spawnShield(view, this.cam.x, this.cam.z, this.d.rig.currentHeight, this.shieldView);
  }

  // --- Entering and leaving ---

  /** OBSERVE on the title: the show stops and the camera is yours. */
  enterFromTitle(): void {
    if (this.active || !this.d.frontDoor.inTitle) return;
    const { frontDoor, titleCam } = this.d;
    this.fromTitle = true;
    frontDoor.title.close();
    frontDoor.closePanel(frontDoor.title);
    titleCam.stop();
    this.begin();
  }

  /** OBSERVE in the pause menu: the run is held as it is and the city carries on. */
  enterFromRun(): void {
    if (this.active || this.d.frontDoor.inTitle) return;
    const d = this.d;
    this.d.audio.ui('confirm');
    this.fromTitle = false;
    this.holding = true;
    const held = this.heldCars;
    held.length = 0;
    const p = d.player;
    if (p.driving) held.push(p.driving);
    for (const v of d.activityCars) if (!held.includes(v)) held.push(v);
    for (const u of d.police.units) if (u.vehicle && !held.includes(u.vehicle)) held.push(u.vehicle);
    // Road ragers after the player.
    for (const v of d.vehicles) if (v.pursuit && !held.includes(v)) held.push(v);
    this.heldState.clear();
    for (const v of held) {
      this.heldState.set(v, { sim: { ...v.sim }, damage: { ...v.damage } });
      // Parked while held (a frozen car still "moving" would knock over whoever walks into it); its speed is back on the way out.
      v.sim.vx = v.sim.vz = v.sim.vy = v.sim.yawRate = 0;
      copyVehicleState(v.prev, v.sim);
    }
    this.savedPed = { ...p.ped };
    this.savedFocusX = d.rig.focusX;
    this.savedFocusZ = d.rig.focusZ;
    this.savedHeight = d.rig.currentHeight;
    this.savedVisible = d.playerModel.root.visible;
    this.savedHour = d.time.hour;
    const w = d.weather;
    this.savedRaining = w.isRaining;
    this.savedRain = w.rain;
    this.savedWet = w.wetness;
    // Unpause first: the pause card and anything over it close.
    d.setPaused(false);
    this.begin();
  }

  private begin(): void {
    const d = this.d;
    const rig = d.rig;
    this.active = true;
    this.weatherTouched = false;
    // Nobody playing: the attract camera is the focus, kept on ours.
    d.attract.start(rig.focusX, rig.focusZ);
    this.cam.reset(rig.focusX, rig.focusZ, clampHeight(rig.currentHeight || OBSERVE_START_HEIGHT, d.tier()), 0);
    this.seedX = this.cam.x;
    this.seedZ = this.cam.z;
    this.stopFollowing();
    this.sceneIndex = -1;
    this.cutT = -1;
    this.district = null;
    rig.setLead(LEAD_NONE);
    this.savedZoomRate = rig.opts.zoomRate;
    rig.opts.zoomRate = ZOOM_EASE;
    d.hud.setScene('observe');
    d.radar.visible = false;
    d.haptics.enabled = false;
    d.playerModel.root.visible = false;
    d.screenAwake.set(true);
    this.keys.clear();
    this.pointers.clear();
    this.dragging = false;
    // A button held as you came in (the A that picked OBSERVE) doesn't act.
    const pad = d.input.pad;
    for (let i = 0; i < PAD_READ.length; i++) this.padWas[i] = pad?.buttons[PAD_READ[i]]?.pressed ?? false;
    this.root.hidden = false;
    this.idle.poke();
    this.syncUi(true);
    d.frontDoor.openPanel(this);
  }

  /** EXIT, Esc, Start or B: back to the title, or to the paused run exactly as it was. */
  exit(): void {
    if (!this.active) return;
    const d = this.d;
    const rig = d.rig;
    d.audio.ui('back');
    this.active = false;
    if (this.palette.isOpen) this.palette.hide();
    d.frontDoor.closePanel(this.palette);
    d.frontDoor.closePanel(this);
    this.root.hidden = true;
    this.stopFollowing();
    this.cutT = -1;
    this.setFade(0);
    window.clearTimeout(this.noteTimer);
    this.noteEl.textContent = '';
    d.look.fogPush = 0;
    rig.yaw = 0;
    rig.opts.zoomRate = this.savedZoomRate;
    const w = d.weather;
    if (this.fromTitle) {
      // A forced shower goes back to the weather's own cycle.
      if (this.weatherTouched) w.set(w.isRaining);
      d.titleCam.start(rig.focusX, rig.focusZ);
      rig.setHeights(...d.heights.title);
      d.hud.setScene('title');
      d.screenAwake.set(false);
      d.frontDoor.showTitle(d.best());
      return;
    }
    // The run's clock and sky were on hold with it.
    d.time.set(this.savedHour);
    if (this.weatherTouched || w.isRaining !== this.savedRaining) w.set(this.savedRaining);
    w.rain = this.savedRain;
    w.wetness = this.savedWet;
    d.attract.stop();
    this.holding = false;
    for (const [v, was] of this.heldState) {
      Object.assign(v.sim, was.sim);
      Object.assign(v.prev, was.sim);
      Object.assign(v.damage, was.damage);
    }
    this.heldState.clear();
    if (this.savedPed) {
      Object.assign(d.player.ped, this.savedPed);
      Object.assign(d.player.prev, this.savedPed);
    }
    this.savedPed = null;
    this.heldCars.length = 0;
    const driving = d.player.driving !== null;
    d.playerModel.root.visible = this.savedVisible;
    rig.setHeights(...(driving ? d.heights.car : d.heights.foot));
    rig.setLead(driving ? LEAD_CAR : LEAD_FOOT);
    rig.snapTo(this.savedFocusX, this.savedFocusZ, this.savedHeight);
    d.hud.setScene('play');
    d.radar.visible = true;
    d.haptics.enabled = true;
    // The streets round the player again (observing far off recycled them).
    d.moved();
    d.setPaused(true);
  }

  /** Panel: Back / Esc / Start / B. */
  back(): void {
    this.exit();
  }

  // --- Per frame ---

  /** Per frame while not paused: input, the camera, the rig, the strip. */
  update(dt: number): void {
    if (!this.active) return;
    const d = this.d;
    const cam = this.cam;
    const rig = d.rig;
    const busy = this.palette.isOpen;
    const tier = d.tier();

    // Held controls: keys and the pad's sticks (none while the palette has the input).
    let right = 0;
    let up = 0;
    let zoom = 0;
    let turn = 0;
    if (!busy) {
      const kb = d.input.keyboard;
      const pad = d.input.gamepad;
      right = clamp1(kb.moveX + pad.moveX);
      up = clamp1(kb.moveY + pad.moveY);
      const k = this.keys;
      zoom = clamp1((k.has('KeyZ') || k.has('Equal') || k.has('NumpadAdd') ? 1 : 0) - (k.has('KeyX') || k.has('Minus') || k.has('NumpadSubtract') ? 1 : 0) + pad.aimY);
      turn = clamp1((k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0) - pad.aimX);
      if (Math.abs(pad.moveX) + Math.abs(pad.moveY) + Math.abs(pad.aimX) + Math.abs(pad.aimY) > PAD_WAKE) this.idle.poke();
    }
    this.readPad(!busy);
    if (Math.abs(right) < PAN_DEAD) right = 0;
    if (Math.abs(up) < PAN_DEAD) up = 0;
    // Panning away lets go of whatever it was riding along with.
    if ((right !== 0 || up !== 0) && (this.following || this.pending)) this.stopFollowing();
    cam.steer(dt, right, up, zoom, turn);
    this.stepFollow(dt);
    this.stepCut(dt);
    // Held off the roofs round where the camera itself is (behind the look point by its tilt), and a little ahead of a pan.
    const back = cam.height * rig.opts.tilt;
    const gx = cam.x + Math.sin(cam.yaw) * back + cam.vx * 0.4;
    const gz = cam.z + Math.cos(cam.yaw) * back + cam.vz * 0.4;
    cam.clamp(dt, tier, roofFloor(d.buildings, gx, gz));

    rig.yaw = cam.yaw;
    rig.setHeights(cam.height, cam.height);
    rig.update(dt, cam.x, cam.z, cam.vx, cam.vz);
    // The focus for the streets, the scenes, the sim's detail and the sound.
    d.attract.jump(cam.x, cam.z, cam.vx, cam.vz);
    d.look.fogPush = Math.max(0, rig.currentHeight - FOG_FROM);

    // The streets stream round a pan; after a long one they're filled round where it stopped.
    if (len2(cam.x - this.seedX, cam.z - this.seedZ) > STREAM_REFILL && len2(cam.vx, cam.vz) < STREAM_SLOW) this.refill();

    const shown = this.idle.step(dt, busy);
    if (shown !== this.uiShown) {
      this.uiShown = shown;
      this.ui.classList.toggle('idle', !shown);
    }
    this.syncUi(false);
    const district = districtAt(cam.x, cam.z);
    if (district !== this.district) {
      this.district = district;
      this.caption(DISTRICT_NAMES[district], '');
    }
  }

  // --- Following and NEXT INCIDENT ---

  private get following(): boolean {
    const f = this.follow;
    return f.car !== null || f.ped !== null || f.scene !== null;
  }

  private stopFollowing(): void {
    const f = this.follow;
    f.car = f.ped = null;
    f.scene = null;
    this.pending = null;
  }

  private stepFollow(dt: number): void {
    const f = this.follow;
    const cam = this.cam;
    const p = this.pending;
    if (p) {
      if (p.subject?.(this.subject)) this.watch(p, this.pendingCaption);
      else if ((this.pendingT -= dt) <= 0) this.pending = null;
      return;
    }
    if (f.car) {
      const v = f.car;
      if (!this.d.vehicles.includes(v) || !v.mesh.root.visible) {
        this.stopFollowing();
        this.note('LOST THEM');
        return;
      }
      cam.follow(dt, v.sim.x, v.sim.z, v.sim.vx, v.sim.vz);
    } else if (f.ped) {
      const p = f.ped;
      if (!this.d.crowd.includes(p) || !p.model.root.visible) {
        this.stopFollowing();
        this.note('LOST THEM');
        return;
      }
      const s = p.agent.s;
      cam.follow(dt, s.x, s.z, s.vx, s.vz);
    } else if (f.scene) {
      if (this.cutT >= 0) return;
      if (!(f.scene.subject?.(this.subject) ?? false)) {
        this.stopFollowing();
        this.note("THAT'S OVER");
        return;
      }
      const s = this.subject;
      cam.follow(dt, s.x, s.z, s.vx, s.vz);
    }
  }

  /** A fade across to a far incident: dark, jump, streets filled, light. */
  private stepCut(dt: number): void {
    if (this.cutT < 0) return;
    const was = this.cutT;
    this.cutT += dt;
    if (was < FADE_OUT && this.cutT >= FADE_OUT) {
      this.cam.jump(this.cutX, this.cutZ);
      this.d.rig.snapTo(this.cutX, this.cutZ);
      this.refill();
    }
    this.setFade(fadeAlpha(this.cutT));
    if (this.cutT >= FADE_OUT + FADE_IN) {
      this.cutT = -1;
      this.setFade(0);
    }
  }

  private refill(): void {
    this.seedX = this.cam.x;
    this.seedZ = this.cam.z;
    // The attract focus first: the streets fill round it.
    this.d.attract.jump(this.cam.x, this.cam.z, 0, 0);
    this.d.moved();
  }

  /** Tap or click on the canvas at client (px, py): follow the car or person there. */
  private pickAt(px: number, py: number): void {
    const d = this.d;
    const rect = d.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cam = d.rig.camera;
    cam.updateMatrixWorld();
    const ray = this.ndc.set(((px - rect.left) / rect.width) * 2 - 1, -((py - rect.top) / rect.height) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize();
    if (ray.y > -1e-4) return;
    // Onto a plane at body height (about where a car's roof or a person's middle is).
    const t = (0.9 - cam.position.y) / ray.y;
    const gx = cam.position.x + ray.x * t;
    const gz = cam.position.z + ray.z * t;
    const hit = pickFollow(gx, gz, d.vehicles, d.crowd, 0.6 + d.rig.currentHeight * TAP_SLACK);
    if (!hit) return;
    this.stopFollowing();
    this.cutT = -1;
    this.setFade(0);
    if (hit.car) this.follow.car = hit.car;
    else this.follow.ped = hit.ped;
    this.d.audio.ui('click');
    this.note('FOLLOWING · PAN TO LET GO');
  }

  /** FOLLOW (Enter, A): let go, or ride along with whatever's nearest the middle of the view. */
  private toggleFollow(): void {
    this.idle.poke();
    if (this.following) {
      this.stopFollowing();
      this.note('LET GO');
      return;
    }
    const cam = this.cam;
    const hit = pickFollow(cam.x, cam.z, this.d.vehicles, this.d.crowd, Math.max(6, cam.height * 0.18));
    if (!hit) {
      this.note('NOTHING TO FOLLOW HERE · TAP A CAR OR A PERSON');
      return;
    }
    if (hit.car) this.follow.car = hit.car;
    else this.follow.ped = hit.ped;
    this.note('FOLLOWING · PAN TO LET GO');
  }

  /** NEXT INCIDENT: the next running scene round, or one started near the camera if nothing's on. */
  next(): void {
    this.idle.poke();
    const life = this.d.life;
    const scenes = life.scenes;
    const subject = this.subject;
    const i = nextLive(scenes.length, this.sceneIndex, (k) => scenes[k].running > 0 && (scenes[k].subject?.(subject) ?? false));
    // The only one on is the one being watched: start another instead.
    if (i < 0 || scenes[i] === this.follow.scene) {
      this.startIncident();
      return;
    }
    this.sceneIndex = i;
    this.watch(scenes[i], this.captions.get(life.sceneLabels[i]) ?? life.sceneLabels[i].toUpperCase());
  }

  /** Nothing on: start one of the title's highlights round the camera (its hours kept). */
  private startIncident(): void {
    const d = this.d;
    const ids = Object.keys(HIGHLIGHTS) as Array<keyof typeof HIGHLIGHTS>;
    const hour = d.time.hour;
    for (let tries = 0; tries < START_TRIES; tries++) {
      const h = HIGHLIGHTS[ids[Math.floor(Math.random() * ids.length)]];
      if (h.hours && !inHours(hour, h.hours)) continue;
      d.starter.start(h.start, this.cam.x, this.cam.z, this.heading());
      if (!d.starter.ok) continue;
      const scene = this.sceneFor(h.start);
      if (scene) this.watch(scene, h.caption);
      else this.note(h.caption);
      return;
    }
    this.note('NOTHING ON NEAR HERE · TRY START');
  }

  /** Ride along with a scene's subject: a glide when it's close and in view, else a fade across. */
  private watch(scene: Scene, caption: string): void {
    this.stopFollowing();
    const s = this.subject;
    if (!scene.subject) return;
    if (!scene.subject(s)) {
      // Nothing to see yet: wait for it here.
      this.pending = scene;
      this.pendingCaption = caption;
      this.pendingT = WATCH_WAIT;
      return;
    }
    this.follow.scene = scene;
    const cam = this.cam;
    if (len2(s.x - cam.x, s.z - cam.z) > CUT_RANGE || !this.d.life.inView(s.x, s.z, 4)) {
      this.cutT = 0;
      this.cutX = s.x;
      this.cutZ = s.z;
    }
    // The district goes in the caption: no second one for crossing into it.
    const district = districtAt(s.x, s.z);
    this.district = district;
    this.caption(caption, DISTRICT_NAMES[district]);
  }

  /** Screen-up as a heading (where the starter puts a car down beside the point). */
  private heading(): number {
    const yaw = this.cam.yaw;
    return Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
  }

  /** The scene behind a palette id, for its subject (none for the ambulance, the alarm, the double-parker). */
  private sceneFor(id: SceneId): Scene | null {
    const { life, starter } = this.d;
    switch (id) {
      case 'chaseCar':
      case 'chaseBike':
      case 'chaseFoot':
        return life.chases;
      case 'race':
        return life.races;
      case 'accident':
        return life.accidents;
      case 'fire':
        return FireCrews.of(life);
      case 'tow':
        return Tows.of(life);
      case 'turf':
        return life.turfWar;
      case 'dogs':
      case 'dogChase':
        return life.dogs;
      default: {
        const s = starter.people(id);
        return s?.subject ? s : null;
      }
    }
  }

  // --- The strip's other buttons ---

  private openPalette(): void {
    const d = this.d;
    if (this.palette.isOpen) return;
    d.audio.ui('click');
    this.palette.open(() => d.frontDoor.closePanel(this.palette), d.input.lastDevice !== 'touch');
    d.frontDoor.openPanel(this.palette);
  }

  /** A palette pick: start it where the camera looks, and watch it if it shows itself. */
  spawn(id: SceneId): void {
    const d = this.d;
    if (this.palette.isOpen) this.palette.back();
    this.idle.poke();
    const text = d.starter.start(id, this.cam.x, this.cam.z, this.heading());
    d.audio.ui(d.starter.ok ? 'confirm' : 'fail');
    this.note(text);
    if (!d.starter.ok) return;
    const scene = this.sceneFor(id);
    if (scene) {
      this.sceneIndex = d.life.scenes.indexOf(scene);
      this.watch(scene, SCENES.find(([k]) => k === id)![1]);
    }
  }

  /** TIME: on to the next stop of the day (dawn, noon, golden hour, dusk, night, small hours). */
  nudgeTime(): void {
    const t = this.d.time;
    const [label, hour] = nextHour(t.hour);
    t.set(hour);
    this.d.audio.ui('click');
    this.note(label);
  }

  /** RAIN: a shower now, or stop it now. */
  toggleRain(): void {
    const w = this.d.weather;
    const on = !w.isRaining;
    // Ten minutes, or until pressed again (the weather's own cycle after that).
    w.set(on, 600);
    w.rain = on ? 1 : 0;
    this.weatherTouched = true;
    this.d.audio.ui('click');
    this.note(on ? 'RAIN' : 'DRY');
  }

  // --- Presentation ---

  private syncUi(force: boolean): void {
    const f = this.follow;
    const label = f.car || f.ped || f.scene ? 'LET GO' : 'FOLLOW';
    if (force || label !== this.followShown) {
      this.followShown = label;
      this.followBtn.querySelector('b')!.textContent = label;
      this.followBtn.classList.toggle('on', label === 'LET GO');
    }
    const device = this.d.input.lastDevice;
    if (force || device !== this.hintDevice) {
      this.hintDevice = device;
      this.hintsEl.innerHTML =
        device === 'gamepad'
          ? '<kbd class="pad">LS</kbd> PAN <kbd class="pad">RS</kbd> ZOOM · TURN <kbd class="pad">A</kbd> FOLLOW <kbd class="pad">Y</kbd> NEXT <kbd class="pad">X</kbd> START <kbd class="pad">RB</kbd> TIME <kbd class="pad">LB</kbd> RAIN <kbd class="pad b">B</kbd> EXIT'
          : device === 'keyboard'
            ? '<kbd>WASD</kbd> PAN <kbd>WHEEL</kbd><kbd>Z</kbd><kbd>X</kbd> ZOOM <kbd>Q</kbd><kbd>E</kbd> TURN <kbd>CLICK</kbd> FOLLOW <kbd>N</kbd> NEXT <kbd>I</kbd> START <kbd>T</kbd> TIME <kbd>U</kbd> RAIN <kbd>ESC</kbd> EXIT'
            : 'DRAG · PINCH · TWIST · TAP A CAR OR A PERSON';
    }
    const raining = this.d.weather.isRaining;
    if (force || raining !== this.rainShown) {
      this.rainShown = raining;
      this.rainBtn.classList.toggle('on', raining);
    }
  }

  private setFade(alpha: number): void {
    const a = Math.round(alpha * 100) / 100;
    if (a === this.fadeShown) return;
    this.fadeShown = a;
    this.fadeEl.style.opacity = String(a);
  }

  /** A caption top right, fading in and out (a district crossed into, an incident cut to). */
  private caption(what: string, where: string): void {
    const el = this.captionEl;
    el.querySelector('b')!.textContent = what;
    el.querySelector('span')!.textContent = where;
    el.getAnimations?.().forEach((a) => a.cancel());
    el.animate?.(
      [
        { opacity: 0, transform: 'translateX(12px)' },
        { opacity: 1, transform: 'none', offset: 0.1 },
        { opacity: 1, transform: 'none', offset: 0.82 },
        { opacity: 0, transform: 'none' },
      ],
      { duration: 3600, easing: 'ease-out', fill: 'both' },
    );
  }

  /** The result of the last action, under the strip for a moment. */
  private note(text: string): void {
    this.noteEl.textContent = text;
    this.idle.poke();
    window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => (this.noteEl.textContent = ''), NOTE_MS);
  }

  // --- Input ---

  /** The pad's X / Y / LB / RB, on a fresh press (Input turns A, B and Start into menu commands); `act` false: only tracked. */
  private readPad(act: boolean): void {
    const pad = this.d.input.pad;
    for (let i = 0; i < PAD_READ.length; i++) {
      const down = pad?.buttons[PAD_READ[i]]?.pressed ?? false;
      const edge = down && !this.padWas[i];
      this.padWas[i] = down;
      if (!edge || !act) continue;
      this.idle.poke();
      const b = PAD_READ[i];
      if (b === PAD_Y) this.next();
      else if (b === PAD_X) this.openPalette();
      else if (b === PAD_RB) this.nudgeTime();
      else if (b === PAD_LB) this.toggleRain();
    }
  }

  private listen(): void {
    const canvas = this.d.canvas;
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.idle.poke();
      if (this.palette.isOpen) return;
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyN') this.next();
      else if (e.code === 'KeyF') this.toggleFollow();
      else if (e.code === 'KeyI') this.openPalette();
      else if (e.code === 'KeyT') this.nudgeTime();
      else if (e.code === 'KeyU') this.toggleRain();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // Any mouse move or touch wakes the strip.
    window.addEventListener(
      'pointermove',
      () => {
        if (this.active) this.idle.poke();
      },
      { passive: true },
    );
    window.addEventListener(
      'pointerdown',
      () => {
        if (this.active) this.idle.poke();
      },
      { passive: true, capture: true },
    );
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || this.palette.isOpen) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      canvas.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      if (this.pointers.size === 2) this.startPinch();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!this.active || !p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size >= 2) {
        this.movePinch();
        return;
      }
      if (!this.dragging && len2(p.x - p.sx, p.y - p.sy) < TAP_SLOP) return;
      if (!this.dragging) {
        this.dragging = true;
        // Dragging the view lets go of whatever it rode along with.
        this.stopFollowing();
        this.cutT = -1;
        this.setFade(0);
      }
      this.cam.drag(dx, dy, this.metresPerPx());
    });
    const end = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (!this.active) return;
      const tap = !this.dragging && this.pointers.size === 0 && e.type === 'pointerup' && performance.now() - p.t < TAP_MS && len2(e.clientX - p.sx, e.clientY - p.sy) < TAP_SLOP;
      if (this.pointers.size === 1) {
        // Down to one finger: carry on dragging from where it is.
        for (const q of this.pointers.values()) {
          q.sx = q.x - TAP_SLOP;
          q.sy = q.y;
        }
        this.dragging = true;
      }
      if (this.pointers.size === 0) this.dragging = false;
      if (tap) this.pickAt(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || this.palette.isOpen) return;
        e.preventDefault();
        const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        this.cam.zoomBy(Math.exp(px * WHEEL_ZOOM));
        this.idle.poke();
      },
      { passive: false },
    );
  }

  private startPinch(): void {
    const [a, b] = this.pointers.values();
    this.pinchDist = len2(b.x - a.x, b.y - a.y);
    this.pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
    this.pinchX = (a.x + b.x) / 2;
    this.pinchY = (a.y + b.y) / 2;
    this.dragging = true;
    this.stopFollowing();
  }

  /** Two fingers: the pair's middle pans, their spread zooms, their turn turns the view (the city turns with them). */
  private movePinch(): void {
    const [a, b] = this.pointers.values();
    const dist = len2(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    this.cam.drag(mx - this.pinchX, my - this.pinchY, this.metresPerPx());
    if (dist > 20 && this.pinchDist > 20) this.cam.zoomBy(this.pinchDist / dist);
    let turn = angle - this.pinchAngle;
    if (turn > Math.PI) turn -= Math.PI * 2;
    else if (turn < -Math.PI) turn += Math.PI * 2;
    this.cam.turnBy(turn);
    this.pinchDist = dist;
    this.pinchAngle = angle;
    this.pinchX = mx;
    this.pinchY = my;
  }

  /** Ground metres per screen px at the look point now. */
  private metresPerPx(): number {
    const rig = this.d.rig;
    const cam = rig.camera;
    const w = this.d.canvas.clientWidth || 1;
    return groundPerPx(rig.currentHeight, rig.opts.tilt, cam.fov, cam.aspect, w);
  }
}

function clamp1(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
