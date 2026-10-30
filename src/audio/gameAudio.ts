/**
 * The game's sound. One AudioContext, created lazily and unlocked by the first
 * tap, click or key (iOS needs a user gesture); a master chain of SFX and
 * music buses into a glue compressor and a limiter; positional one-shots for
 * every GameEvent on the bus; continuous voices for the player's car, fires,
 * sirens and the city; and an adaptive procedural soundtrack.
 *
 * Fully synthesised, no audio files. Everything degrades to silence (no Web
 * Audio, a context that won't start, blocked storage) without throwing.
 */
import { events as defaultBus, type EventBus, type EventOf, type GameEvent } from '../core/events';
import { onSettingsChange, settings, type Settings } from '../core/settings';
import type { Award } from '../systems/score';
import type { CarSound } from './carSound';
import { ChaosMeter, MAX_INTENSITY } from './chaos';
import { AmbientBed, EngineVoice, FireVoice, RainVoice, SirenVoice, TyreVoice, type SirenStyle } from './loops';
import {
  AIR_FILTER_BELOW,
  Dip,
  SILENT_GAIN,
  airCutoff,
  audioSessionType,
  clamp,
  clamp01,
  distanceGain,
  lerp,
  panFor,
  volumeToGain,
  wetFor,
  type Falloff,
} from './mix';
import { MusicPlayer } from './music/musicPlayer';
import type { MusicMode } from './music/sequencer';
import { STATIONS, type Station } from './music/stations';
import * as sfx from './sfx';
import { NoiseBank, Voice, automateDip, makeImpulse, nodeStats } from './synth';
import { RateGate, VoiceLimiter } from './voices';

export { createCarSound, describeCar, type CarSound } from './carSound';
export type { SirenStyle } from './loops';
export type { UiSound } from './sfx';
export type { MusicMode } from './music/sequencer';

/** A car that might be on fire (the game's Vehicle fits this shape). */
export interface FireSource {
  sim: { x: number; z: number };
  damage: { burning: boolean; wrecked: boolean };
  /** Seconds since it blew up; wrecks keep burning for a few seconds. */
  wreckAge: number;
}

/** What the continuous voices need each frame. Keep one and mutate it (no per-frame allocation). */
export interface AudioFrame {
  /** Listener: the camera focus, world metres. */
  x: number;
  z: number;
  /** The player's car, or null on foot. */
  car: CarSound | null;
  /** Walking / running speed on foot, m/s (footsteps). */
  footSpeed: number;
  /** Player health 0..100 (a heartbeat creeps in when low). */
  health: number;
  /** Cars to scan for fires near the listener. */
  vehicles: ReadonlyArray<FireSource>;
}

export function createAudioFrame(vehicles: ReadonlyArray<FireSource> = []): AudioFrame {
  return { x: 0, z: 0, car: null, footSpeed: 0, health: 100, vehicles };
}

type Category =
  | 'gun'
  | 'impact'
  | 'crash'
  | 'explosion'
  | 'body'
  | 'punch'
  | 'pickup'
  | 'award'
  | 'ui'
  | 'door'
  | 'engine'
  | 'foot'
  | 'horn'
  | 'ambient'
  | 'player';

/** Concurrent one-shots per category; the oldest is stolen past this. */
const LIMITS: Record<Category, number> = {
  gun: 8,
  impact: 6,
  crash: 4,
  explosion: 4,
  body: 4,
  punch: 3,
  pickup: 2,
  award: 3,
  ui: 4,
  door: 2,
  engine: 3,
  foot: 2,
  horn: 4,
  ambient: 3,
  player: 3,
};
const MAX_VOICES = 40;

const FALLOFF = {
  gun: { ref: 14, max: 170, floor: 0.07 },
  npcGun: { ref: 10, max: 140, floor: 0.05 },
  impact: { ref: 8, max: 60, floor: 0 },
  crash: { ref: 12, max: 120, floor: 0.05 },
  explosion: { ref: 20, max: 2000, floor: 0.16 },
  punch: { ref: 6, max: 45, floor: 0 },
  near: { ref: 6, max: 35, floor: 0 },
  horn: { ref: 12, max: 160, floor: 0.04 },
  siren: { ref: 16, max: 280, floor: 0.05 },
  fire: { ref: 6, max: 70, floor: 0 },
  distant: { ref: 25, max: 400, floor: 0.08 },
} satisfies Record<string, Falloff>;

/** Activation-triggering events that can unlock audio (iOS honours pointerup/touchend/click/keydown). */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown', 'click'] as const;
const MAX_SIRENS = 8;
/** A siren not refreshed for this long (game time) is released. */
const SIREN_STALE = 1;
/**
 * Continuous voices push parameter changes at most this often: their 30 ms
 * smoothing makes per-frame updates (120 Hz on ProMotion) pointless, and every
 * call queues an automation event.
 */
const PARAM_INTERVAL = 1 / 45;
/** Paused this long, the context is suspended to save battery. */
const PAUSE_SUSPEND_MS = 45_000;
/** Music bus trim: at the default 0.5 slider the radio sits just under the engine at speed. */
const MUSIC_LEVEL = 1.4;
/** On foot the soundtrack is underscore, a little quieter than the car radio. */
const MUSIC_ON_FOOT = 0.7;
const STATION_KEY = 'curbside.station';
/** The world muffle's resting cutoff, Hz (effectively open). */
const OPEN = 20000;
/** Entering a car this soon (ms) after a carjack means its engine is already running: no starter. */
const CARJACK_WINDOW_MS = 1500;

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** iOS 16.4+ audio session: see audioSessionType() for the policy. */
function applyAudioSession(s: Settings): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as unknown as { audioSession?: { type: string } };
  if (!nav.audioSession) return;
  const type = audioSessionType(s);
  if (nav.audioSession.type === type) return;
  try {
    nav.audioSession.type = type;
  } catch {
    // Unsupported value on this browser: keep its default.
  }
}

function loadStation(): number {
  try {
    const n = Number(localStorage.getItem(STATION_KEY));
    return Number.isInteger(n) && n >= 0 && n < STATIONS.length ? n : 0;
  } catch {
    return 0;
  }
}

function saveStation(i: number): void {
  try {
    localStorage.setItem(STATION_KEY, String(i));
  } catch {
    // Blocked storage: the station just won't be remembered.
  }
}

export interface GameAudioOptions {
  /** Best score so far, for the NEW BEST fanfare. */
  best?: number;
  bus?: EventBus;
}

export class GameAudio {
  /** Let play (combos, explosions, speed) push the music above the setIntensity() floor. */
  autoIntensity = true;

  private ctx: AudioContext | null = null;
  private failed = false;
  private bank: NoiseBank | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private worldIn!: GainNode;
  private worldVerb!: GainNode;
  private worldMuffle!: BiquadFilterNode;
  private worldGate!: GainNode;
  private uiIn!: GainNode;
  private musicBus!: GainNode;
  /** The limiter: the last node before the speakers. */
  private output: AudioNode | null = null;
  private analyser: AnalyserNode | null = null;
  private music: MusicPlayer | null = null;
  private engine: EngineVoice | null = null;
  private tyres: TyreVoice | null = null;
  private fire: FireVoice | null = null;
  private ambient: AmbientBed | null = null;
  private rain: RainVoice | null = null;
  private rainAmount = 0;
  private rainIdle = 0;
  private readonly sirens: SirenVoice[] = [];
  /** Released continuous voices, disconnected once they've faded. */
  private readonly retiring: Voice[] = [];
  private readonly limiter = new VoiceLimiter<Voice>(LIMITS, MAX_VOICES);
  private readonly gate = new RateGate();
  private readonly chaos = new ChaosMeter();
  private readonly stationListeners: Array<(s: Station) => void> = [];
  private readonly cleanups: Array<() => void> = [];
  /** The world muffle as one merged state (a hurt can't cut short a blast's or WASTED's). */
  private readonly muffleDip = new Dip(OPEN);
  private stationIndex = loadStation();
  private musicMode: MusicMode = 'game';
  private intensityFloor = 0;
  private listenerX = 0;
  private listenerZ = 0;
  private paused = false;
  private hidden = false;
  /** Master volume at zero: the context stays suspended (battery; other apps' audio plays). */
  private muted = false;
  private dead = false;
  private carjackAt = -Infinity;
  private inCar: boolean | null = null;
  private pauseTimer = 0;
  private tickHandle = 0;
  private pendingUi: sfx.UiSound | null = null;
  private paramDt = 0;
  private stepDistance = 0;
  private heartbeatIn = 0;
  private ambientIn = 6;
  private best: number;
  private runPoints = 0;
  private celebrated = false;

  constructor(opts: GameAudioOptions = {}) {
    this.best = opts.best ?? 0;
    const bus = opts.bus ?? defaultBus;
    this.cleanups.push(bus.onAny((e) => this.handle(e)));
    this.cleanups.push(onSettingsChange((s) => this.applySettings(s)));
    applyAudioSession(settings);
    if (typeof window === 'undefined') return;
    const opt = { capture: true, passive: true };
    for (const type of GESTURES) window.addEventListener(type, this.onGesture, opt);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    this.cleanups.push(() => {
      for (const type of GESTURES) window.removeEventListener(type, this.onGesture, opt);
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener('pagehide', this.onPageHide);
    });
  }

  // --- Public API ---

  /** 'locked' until the first gesture, then the context's state ('running', 'suspended', 'interrupted'...). */
  get state(): string {
    return this.ctx ? this.ctx.state : this.failed ? 'unavailable' : 'locked';
  }

  get station(): Station {
    return this.music?.station ?? STATIONS[this.stationIndex];
  }

  /** Create / resume the context. Safe to call from any user-gesture handler (a title screen's tap). */
  unlock(): void {
    if (!this.ctx) this.init();
    else this.wake();
  }

  /**
   * Per-frame update for continuous voices: engine, tyres, footsteps, fires,
   * sirens, heartbeat, ambience and the music's intensity. Mutate one
   * AudioFrame and pass it every frame.
   */
  update(dt: number, f: AudioFrame): void {
    this.listenerX = f.x;
    this.listenerZ = f.z;
    const ctx = this.ctx;
    if (!ctx || !this.bank || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.reap(now);
    this.paramDt += dt;
    const push = this.paramDt >= PARAM_INTERVAL;
    this.updateCar(f.car, dt, now, push);
    this.updateFootsteps(f, dt);
    if (push) {
      this.updateFire(f.vehicles, this.paramDt, now);
      this.updateRain(f.car !== null, this.paramDt, now);
      this.updateSirens(this.paramDt, now);
      this.paramDt = 0;
    }
    this.updateHeartbeat(f.health, dt);
    this.updateAmbience(f.car !== null, dt, now);
    this.updateIntensity(f.car, dt);
  }

  /**
   * A positional police siren loop per `id`. Call every frame while it should
   * sound (positions update, doppler follows); call with on = false, or just
   * stop calling, and it fades out after a second.
   */
  siren(id: string | number, x: number, z: number, on = true, style: SirenStyle = 'twoTone'): void {
    const ctx = this.ctx;
    if (!ctx || !this.bank) return;
    let s: SirenVoice | null = null;
    let index = -1;
    for (let i = 0; i < this.sirens.length; i++) {
      if (this.sirens[i].id === id) {
        s = this.sirens[i];
        index = i;
        break;
      }
    }
    if (!on) {
      if (s) {
        this.retire(s.v, s.release(ctx.currentTime));
        this.sirens.splice(index, 1);
      }
      return;
    }
    if (!s) {
      if (this.sirens.length >= MAX_SIRENS) return;
      s = new SirenVoice(ctx, this.bank, this.worldIn, id, ctx.currentTime);
      this.sirens.push(s);
    }
    s.setStyle(style);
    s.x = x;
    s.z = z;
    s.age = 0;
  }

  /** A car horn at (x, z). */
  /** How hard it's raining, 0..1 (a weather loop; 0 fades it out). Call whenever it changes. */
  setRain(amount: number): void {
    this.rainAmount = clamp01(amount);
  }

  horn(x: number, z: number, duration = 0.4): void {
    const v = this.voice({ x, z }, FALLOFF.horn, 0.55, 0.25);
    if (!v) return;
    sfx.horn(v, clamp(duration, 0.08, 3));
    this.commit('horn', v);
  }

  /** Menu and mission sounds. Plays while paused; may be called before the first gesture (it unlocks). */
  ui(kind: sfx.UiSound): void {
    if (!this.ctx) this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running' || !this.bank) {
      // Plays once the context is running and the graph is built.
      this.pendingUi = kind;
      this.wake();
      return;
    }
    const v = this.voice(null, FALLOFF.near, 0.8, 0, 0, 'ui');
    if (!v) return;
    sfx.ui(v, kind, this.station.key);
    this.commit('ui', v);
  }

  /** Game paused: silence the world, muffle the music. Suspends the context if it stays paused a while. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    const ctx = this.ctx;
    if (ctx && this.bank) {
      const now = ctx.currentTime;
      this.worldGate.gain.setTargetAtTime(paused ? 0 : 1, now, paused ? 0.04 : 0.12);
      this.music?.setPaused(paused);
    }
    window.clearTimeout(this.pauseTimer);
    if (paused) this.armPauseSuspend();
    else this.wake();
  }

  /** Music intensity floor 0..5 (e.g. the wanted level); play can push it higher while autoIntensity is on. */
  setIntensity(level: number): void {
    this.intensityFloor = clamp(level, 0, MAX_INTENSITY);
  }

  /** 'game' plays the adaptive soundtrack, 'menu' a sparse title arrangement, 'off' fades it out. */
  setMusicMode(mode: MusicMode): void {
    this.musicMode = mode;
    if (!this.dead) this.music?.setMode(mode);
  }

  /** Tune the radio to the next station; returns it. */
  nextStation(): Station {
    this.stationIndex = (this.stationIndex + 1) % STATIONS.length;
    saveStation(this.stationIndex);
    const station = this.music ? this.music.setStation(this.stationIndex) : STATIONS[this.stationIndex];
    for (const fn of this.stationListeners) fn(station);
    return station;
  }

  onStationChange(fn: (s: Station) => void): () => void {
    this.stationListeners.push(fn);
    return () => {
      const i = this.stationListeners.indexOf(fn);
      if (i >= 0) this.stationListeners.splice(i, 1);
    };
  }

  /** React to one game event (the bus calls this; tools and tests can too). */
  handle(e: GameEvent): void {
    const newBest = e.type === 'award' && this.countAward(e.award);
    // Life and death change state even while the context is suspended, so the music comes back.
    if (e.type === 'playerDied') return this.onPlayerDied();
    if (e.type === 'respawn') return this.onRespawn();
    if (e.type === 'carjack') this.carjackAt = performance.now();
    const ctx = this.ctx;
    if (!ctx || !this.bank || ctx.state !== 'running') return;
    switch (e.type) {
      case 'crash':
        return this.onCrash(e);
      case 'explosion':
        return this.onExplosion(e);
      case 'shot':
        return this.onShot(e);
      case 'bulletHit':
        return this.onBulletHit(e);
      case 'punch':
        return this.onPunch(e);
      case 'pedDown':
        return this.onPedDown(e);
      case 'carjack':
        return this.oneShot('door', e, FALLOFF.near, 0.85, 0.15, sfx.carjack, 0.4);
      case 'enterVehicle':
        return this.oneShot('door', null, FALLOFF.near, 0.8, 0.1, (v) => sfx.door(v, true));
      case 'exitVehicle':
        return this.oneShot('door', null, FALLOFF.near, 0.65, 0.1, (v) => sfx.door(v, true));
      case 'pickup': {
        const kind = e.kind;
        return this.oneShot('pickup', null, FALLOFF.near, 0.75, 0.05, (v) =>
          kind === 'health' ? sfx.pickupHealth(v) : sfx.pickupWeapon(v, kind),
        );
      }
      case 'award':
        return this.onAward(e.award, newBest);
      case 'weaponSwitch': {
        const gun = e.weapon !== null;
        return this.oneShot('pickup', null, FALLOFF.near, 0.6, 0, (v) => sfx.weaponSwitch(v, gun));
      }
      case 'playerHurt':
        return this.onPlayerHurt(e);
      case 'pause':
        return; // main.ts calls setPaused directly, before this event fires
      default: {
        const unhandled: never = e;
        return unhandled;
      }
    }
  }

  /** Counters for the debug overlay and automated checks: a leak shows as `nodes` creeping up. */
  get debug() {
    const m = this.engine?.model;
    const music = this.music;
    const byCategory: Record<string, number> = {};
    for (const k of Object.keys(LIMITS)) byCategory[k] = this.limiter.count(k);
    return {
      state: this.state,
      time: this.ctx?.currentTime ?? 0,
      voices: this.limiter.size,
      byCategory,
      retiring: this.retiring.length,
      nodes: nodeStats.live,
      nodesCreated: nodeStats.created,
      sirens: this.sirens.length,
      fire: this.fire !== null,
      rain: this.rain !== null,
      engine: m ? { archetype: this.engine!.archetype, rpm: Math.round(m.rpm), gear: m.gear, load: +m.load.toFixed(2), cranking: m.cranking } : null,
      music: music
        ? {
            station: music.station.name,
            mode: music.mode,
            intensity: music.arranger.intensity,
            target: music.arranger.target,
            bpm: music.arranger.bpm,
            bar: music.arranger.bar,
            stepsScheduled: music.stepsScheduled,
            activeNotes: music.activeNotes,
          }
        : null,
      chaos: { energy: +this.chaos.energy.toFixed(2), level: this.chaos.level },
      muffle: Math.round(this.muffleDip.at(this.ctx?.currentTime ?? 0)),
      musicDormant: music?.isDormant ?? false,
      paused: this.paused,
      hidden: this.hidden,
      muted: this.muted,
    };
  }

  /** A level meter on the final output, for debug overlays and automated checks. Null before unlock. */
  meter(): AnalyserNode | null {
    if (!this.ctx || !this.output) return null;
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.output.connect(this.analyser);
    }
    return this.analyser;
  }

  /** Tear everything down (tests, hot reload). */
  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    window.clearInterval(this.tickHandle);
    window.clearTimeout(this.pauseTimer);
    this.limiter.clear((v) => v.dispose());
    for (const v of this.retiring) v.dispose();
    this.retiring.length = 0;
    this.music?.dispose();
    for (const s of this.sirens) s.v.dispose();
    for (const x of [this.engine, this.tyres, this.fire, this.ambient, this.rain]) x?.v.dispose();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  // --- Context lifecycle ---

  private readonly onGesture = (): void => {
    if (!this.ctx) this.init();
    else this.wake();
  };

  private readonly onVisibility = (): void => {
    this.hidden = document.hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.hidden) ctx.suspend().catch(() => {});
    else if (!this.paused) this.wake();
  };

  private readonly onPageHide = (): void => {
    this.ctx?.suspend().catch(() => {});
  };

  private readonly onStateChange = (): void => {
    const ctx = this.ctx;
    // 'interrupted' (iOS: a call, Siri) or an unexpected 'suspended' is resumed by the next gesture.
    if (!ctx || ctx.state !== 'running') return;
    this.flushPendingUi();
    if (this.paused) this.armPauseSuspend();
  };

  private flushPendingUi(): void {
    if (!this.pendingUi || !this.bank || this.ctx?.state !== 'running') return;
    const kind = this.pendingUi;
    this.pendingUi = null;
    this.ui(kind);
  }

  private readonly tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.music?.pump(now);
    this.reap(now);
  };

  private init(): void {
    if (this.failed || typeof window === 'undefined') return;
    // Creating a context outside a gesture leaves it suspended (and logs a warning): wait for a real one.
    const nav = navigator as unknown as { userActivation?: { isActive: boolean } };
    if (nav.userActivation && !nav.userActivation.isActive) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.failed = true;
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      this.failed = true;
      return;
    }
    this.ctx = ctx;
    applyAudioSession(settings);
    this.kick(ctx);
    ctx.addEventListener('statechange', this.onStateChange);
    this.buildSoon(ctx);
  }

  /**
   * Only the unlock has to happen inside the gesture. Generating noise, the
   * reverb impulse and the graph takes ~20 ms, so it runs in separate tasks
   * after the handler returns: the first touch doesn't drop frames.
   */
  private buildSoon(ctx: AudioContext): void {
    let bank: NoiseBank | null = null;
    let impulse: AudioBuffer | null = null;
    const stages = [
      () => (bank = new NoiseBank(ctx)),
      () => (impulse = makeImpulse(ctx)),
      () => this.build(ctx, bank!, impulse!),
    ];
    let i = 0;
    const next = () => {
      if (this.ctx !== ctx) return; // disposed meanwhile
      try {
        stages[i++]();
      } catch (err) {
        console.warn('Audio unavailable:', err);
        this.failed = true;
        this.ctx = null;
        this.bank = null;
        ctx.close().catch(() => {});
        return;
      }
      if (i < stages.length) {
        window.setTimeout(next, 0);
        return;
      }
      this.tickHandle = window.setInterval(this.tick, 25);
      this.flushPendingUi();
    };
    window.setTimeout(next, 0);
  }

  /** iOS only truly unlocks once something has played inside the gesture: a one-sample silent buffer. */
  private kick(ctx: AudioContext): void {
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.onended = () => s.disconnect();
      s.start(0);
    } catch {
      // Closed context: nothing to unlock.
    }
    ctx.resume().catch(() => {});
  }

  private wake(): void {
    const ctx = this.ctx;
    if (!ctx || this.hidden || this.muted) return;
    if (ctx.state !== 'running') this.kick(ctx);
    else if (this.paused) this.armPauseSuspend();
  }

  private armPauseSuspend(): void {
    window.clearTimeout(this.pauseTimer);
    this.pauseTimer = window.setTimeout(() => {
      if (this.paused && this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
    }, PAUSE_SUSPEND_MS);
  }

  private build(ctx: AudioContext, bank: NoiseBank, impulse: AudioBuffer): void {
    // Glue compression, then a limiter so a pile-up of booms can't clip.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 12;
    glue.ratio.value = 3;
    glue.attack.value = 0.006;
    glue.release.value = 0.22;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.connect(glue).connect(limit).connect(ctx.destination);
    this.output = limit;

    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    // World sounds (muted when paused, muffled by blasts and death) and their street reverb.
    this.worldGate = ctx.createGain();
    this.worldGate.connect(this.sfxBus);
    this.worldMuffle = ctx.createBiquadFilter();
    this.worldMuffle.type = 'lowpass';
    this.worldMuffle.frequency.value = OPEN;
    this.worldMuffle.Q.value = 0.5;
    this.worldMuffle.connect(this.worldGate);
    this.worldIn = ctx.createGain();
    this.worldIn.connect(this.worldMuffle);
    this.worldVerb = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = impulse;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.7;
    this.worldVerb.connect(verb).connect(verbOut).connect(this.worldMuffle);
    // UI, stingers and the heartbeat bypass the world's pause gate and muffle.
    this.uiIn = ctx.createGain();
    this.uiIn.connect(this.sfxBus);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);

    this.music = new MusicPlayer(ctx, bank, this.musicBus, impulse, STATIONS[this.stationIndex]);
    if (this.musicMode !== 'off' && !this.dead) this.music.setMode(this.musicMode);
    this.ambient = new AmbientBed(ctx, bank, this.worldIn, ctx.currentTime);
    if (this.paused) {
      this.worldGate.gain.value = 0;
      this.music.setPaused(true);
    }
    if (this.dead) {
      this.muffleDip.hold(600);
      this.worldMuffle.frequency.value = 600;
    }
    // Last: `bank` marks the graph as ready for everything else.
    this.bank = bank;
    this.applySettings(settings);
  }

  private applySettings(s: Settings): void {
    applyAudioSession(s);
    const ctx = this.ctx;
    if (!ctx || !this.bank) return;
    const now = ctx.currentTime;
    const master = volumeToGain(s.masterVolume);
    this.master.gain.setTargetAtTime(master, now, 0.03);
    this.sfxBus.gain.setTargetAtTime(volumeToGain(s.sfxVolume), now, 0.03);
    this.musicBus.gain.setTargetAtTime(this.musicGain(s), now, 0.03);
    // Silent music costs nothing: no notes booked, its graph not rendered.
    this.music?.setDormant(master * volumeToGain(s.musicVolume) < SILENT_GAIN);
    // Fully muted, the whole context sleeps; turning it back up wakes it (or the next gesture does).
    const muted = master < SILENT_GAIN;
    if (muted === this.muted) return;
    this.muted = muted;
    if (muted) ctx.suspend().catch(() => {});
    else this.wake();
  }

  private musicGain(s: Settings): number {
    return volumeToGain(s.musicVolume) * MUSIC_LEVEL * (this.inCar ? 1 : MUSIC_ON_FOOT);
  }

  // --- Voices ---

  /**
   * A one-shot placed at `at` (null = on the listener): distance gain, pan, air
   * absorption and a reverb send. Null when it would be inaudible, or the
   * world is paused. The caller builds the sound into it, then commit()s it.
   */
  private voice(
    at: { x: number; z: number } | null,
    falloff: Falloff,
    level: number,
    wet: number,
    delay = 0,
    bus: 'world' | 'ui' = 'world',
  ): Voice | null {
    const ctx = this.ctx;
    if (!ctx || !this.bank || ctx.state !== 'running') return null;
    if (this.paused && bus === 'world') return null;
    let gain = level;
    let d = 0;
    let pan = 0;
    if (at) {
      const dx = at.x - this.listenerX;
      d = Math.hypot(dx, at.z - this.listenerZ);
      gain *= distanceGain(d, falloff);
      pan = panFor(dx);
    }
    if (gain < 0.003) return null;
    const v = new Voice(ctx, this.bank, ctx.currentTime + 0.005 + delay, gain);
    const dest = bus === 'ui' ? this.uiIn : this.worldIn;
    const cutoff = airCutoff(d);
    if (cutoff < AIR_FILTER_BELOW) {
      const air = v.filter('lowpass', cutoff, 0.5);
      air.connect(v.out);
      v.input = air;
    }
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = v.track(ctx.createStereoPanner());
      p.pan.value = pan;
      v.chain(v.out, p, dest);
    } else {
      v.out.connect(dest);
    }
    const w = bus === 'world' ? wetFor(wet, d) : 0;
    if (w > 0.01) {
      const send = v.gain(w);
      v.chain(v.out, send, this.worldVerb);
    }
    return v;
  }

  private commit(category: Category, v: Voice): void {
    const ctx = this.ctx!;
    this.limiter.add(category, v, v.t, v.end + 0.05, (old) => old.kill(ctx.currentTime));
  }

  /** voice() + recipe + commit() in one go. */
  private oneShot(
    category: Category,
    at: { x: number; z: number } | null,
    falloff: Falloff,
    level: number,
    wet: number,
    recipe: (v: Voice) => void,
    chaos = 0,
  ): void {
    this.chaos.add(chaos);
    const v = this.voice(at, falloff, level, wet);
    if (!v) return;
    recipe(v);
    this.commit(category, v);
  }

  private retire(v: Voice, end: number): void {
    v.end = end;
    this.retiring.push(v);
  }

  private reap(now: number): void {
    this.limiter.reap(now, (v) => v.dispose());
    let w = 0;
    for (let i = 0; i < this.retiring.length; i++) {
      const v = this.retiring[i];
      if (v.end + 0.05 <= now) v.dispose();
      else this.retiring[w++] = v;
    }
    this.retiring.length = w;
  }

  /** Briefly dull the world: a hit, a blast nearby. Merges with a muffle in progress (deepest wins). */
  private muffle(cutoff: number, hold: number, recover: number): void {
    if (this.dead || !this.ctx || !this.bank) return;
    const now = this.ctx.currentTime;
    this.muffleDip.add(now, cutoff, hold, recover);
    automateDip(this.worldMuffle.frequency, this.muffleDip, now, 0.01);
  }

  // --- Events ---

  private onCrash(e: EventOf<'crash'>): void {
    if (e.impact < 2.5) return;
    const now = this.ctx!.currentTime;
    if (!this.gate.allow(e.involvesPlayer ? 'crash-player' : 'crash', now, 0.07)) return;
    const k = clamp01((e.impact - 3) / 17);
    if (e.involvesPlayer) this.chaos.add(Math.min(0.6, e.impact / 25));
    const v = this.voice(e, FALLOFF.crash, (e.involvesPlayer ? 1 : 0.8) * (0.45 + 0.55 * k), 0.25);
    if (!v) return;
    sfx.crash(v, e.impact, e.against === 'vehicle');
    this.commit('crash', v);
    if (e.involvesPlayer && k > 0.7) this.music?.duck(0.6, 0.5);
  }

  private onExplosion(e: EventOf<'explosion'>): void {
    const now = this.ctx!.currentTime;
    const d = Math.hypot(e.x - this.listenerX, e.z - this.listenerZ);
    this.chaos.add(d < 60 ? 1.2 : 0.4);
    // A chain reaction makes a couple of booms, not thirty.
    if (!this.gate.allow('boom', now, 0.06, 2)) return;
    const v = this.voice(e, FALLOFF.explosion, 1, 0.55);
    if (!v) return;
    sfx.explosion(v, clamp01(1 - d / 40));
    this.commit('explosion', v);
    this.music?.duck(lerp(0.22, 0.75, clamp01(d / 120)), 1.6);
    if (d < 14) {
      const near = 1 - d / 14;
      this.muffle(lerp(1800, 500, near), 0.15, 1.6);
      const t = this.voice(null, FALLOFF.near, 1, 0, 0.05, 'ui');
      if (t) {
        sfx.tinnitus(t, near);
        this.commit('player', t);
      }
    }
  }

  private onShot(e: EventOf<'shot'>): void {
    const now = this.ctx!.currentTime;
    this.chaos.add(e.byPlayer ? 0.06 : 0.12);
    if (!this.gate.allow(e.byPlayer ? 'shot-player' : 'shot', now, 0.03, 3)) return;
    const level = e.byPlayer ? (e.weapon === 'smg' ? 0.75 : 0.9) : 0.8;
    const v = this.voice(e, e.byPlayer ? FALLOFF.gun : FALLOFF.npcGun, level, 0.35);
    if (v) {
      sfx.gunshot(v, e.weapon, e.byPlayer);
      this.commit('gun', v);
    }
    if (!e.byPlayer) this.maybeWhiz(e);
  }

  /** An NPC's bullet passing close to the listener whizzes by (after its flight time). */
  private maybeWhiz(e: EventOf<'shot'>): void {
    const len = Math.hypot(e.dirX, e.dirZ) || 1;
    const dx = e.dirX / len;
    const dz = e.dirZ / len;
    const lx = this.listenerX - e.x;
    const lz = this.listenerZ - e.z;
    const along = lx * dx + lz * dz;
    if (along < 3 || along > 30) return;
    const miss = Math.abs(lx * dz - lz * dx);
    if (miss > 2.5 || miss < 0.3) return;
    const at = { x: e.x + dx * along, z: e.z + dz * along };
    const v = this.voice(at, FALLOFF.near, 0.8, 0.05, along / 400);
    if (!v) return;
    sfx.whiz(v);
    this.commit('impact', v);
  }

  private onBulletHit(e: EventOf<'bulletHit'>): void {
    if (e.target === 'none') return;
    if (!this.gate.allow('hit', this.ctx!.currentTime, 0.02, 3)) return;
    const player = e.target === 'player';
    const v = this.voice(e, FALLOFF.impact, player ? 1 : 0.75, 0.2);
    if (!v) return;
    if (e.target === 'wall') sfx.bulletWall(v, Math.random() < 0.35);
    else if (e.target === 'vehicle') sfx.bulletMetal(v);
    else sfx.bulletFlesh(v);
    this.commit('impact', v);
  }

  private onPunch(e: EventOf<'punch'>): void {
    const hit = e.hit;
    this.oneShot('punch', e, FALLOFF.punch, e.byPlayer ? 0.9 : 0.75, 0.15, (v) => sfx.punch(v, hit), e.byPlayer && hit ? 0.1 : 0);
  }

  private onPedDown(e: EventOf<'pedDown'>): void {
    if (e.byPlayer) this.chaos.add(0.15);
    if (e.cause === 'blast') return;
    if (!this.gate.allow('ped', this.ctx!.currentTime, 0.05, 2)) return;
    if (e.cause === 'vehicle') this.oneShot('body', e, FALLOFF.punch, 0.9, 0.15, sfx.bodyHit);
    else this.oneShot('body', e, FALLOFF.punch, 0.55, 0.1, (v) => sfx.bodyFall(v, 0.2));
  }

  private onAward(a: Award, newBest: boolean): void {
    const key = this.station.key;
    this.chaos.add(a.kind === 'boom' ? 0.6 : 0.35 + 0.08 * a.multiplier);
    const v = this.voice(null, FALLOFF.near, a.kind === 'boom' ? 0.9 : 0.75, 0, 0, 'ui');
    if (v) {
      if (a.kind === 'boom') sfx.bigSting(v, key);
      else sfx.award(v, a.kind, a.multiplier, key);
      this.commit('award', v);
    }
    if (newBest) {
      const f = this.voice(null, FALLOFF.near, 0.9, 0, 0.15, 'ui');
      if (f) {
        sfx.fanfare(f, key);
        this.commit('award', f);
        this.music?.duck(0.45, 1.4);
      }
    }
  }

  /** Track this life's points; true the first time they pass the best score (once per session, like the HUD). */
  private countAward(a: Award): boolean {
    this.runPoints += a.points;
    if (this.celebrated || this.best <= 0 || this.runPoints <= this.best) return false;
    this.celebrated = true;
    return true;
  }

  private onPlayerHurt(e: EventOf<'playerHurt'>): void {
    if (!this.gate.allow('hurt', this.ctx!.currentTime, 0.07)) return;
    const amount = e.amount;
    this.oneShot('player', null, FALLOFF.near, 0.9, 0, (v) => sfx.hurt(v, amount), 0.15);
    if (amount >= 8) this.muffle(2400, 0.06, 0.45);
  }

  private onPlayerDied(): void {
    this.dead = true;
    this.chaos.reset();
    if (!this.ctx || !this.bank) return;
    const now = this.ctx.currentTime;
    const v = this.voice(null, FALLOFF.near, 1, 0, 0, 'ui');
    if (v) {
      sfx.wasted(v, this.station.key);
      this.commit('player', v);
    }
    this.music?.setMode('off');
    // Held until respawn; cancels any hurt or blast recovery already queued.
    this.muffleDip.hold(600);
    automateDip(this.worldMuffle.frequency, this.muffleDip, now, 0.25);
  }

  private onRespawn(): void {
    this.dead = false;
    this.runPoints = 0;
    if (!this.ctx || !this.bank) return;
    const now = this.ctx.currentTime;
    this.muffleDip.release(now, 0.9);
    automateDip(this.worldMuffle.frequency, this.muffleDip, now, 0.01);
    const v = this.voice(null, FALLOFF.near, 0.9, 0, 0, 'ui');
    if (v) {
      sfx.respawn(v, this.station.key);
      this.commit('player', v);
    }
    if (this.musicMode !== 'off') this.music?.setMode(this.musicMode);
  }

  // --- Continuous voices ---

  private updateCar(car: CarSound | null, dt: number, now: number, push: boolean): void {
    if (car && !this.dead) {
      if (!this.engine || this.engine.archetype !== car.archetype) {
        if (this.engine) this.retire(this.engine.v, this.engine.release(now));
        this.engine = new EngineVoice(this.ctx!, this.bank!, this.worldIn, car.archetype, now);
        // A carjacked car is already running; one that was parked needs the starter.
        if (performance.now() - this.carjackAt < CARJACK_WINDOW_MS) this.engine.warm();
        else this.engine.ignite();
      }
      this.tyres ??= new TyreVoice(this.ctx!, this.bank!, this.worldIn, now);
      if (this.engine.apply(car, dt, now, push) === 'pop') this.backfire();
      if (push) this.tyres.apply(car, now);
      return;
    }
    if (this.engine) {
      this.retire(this.engine.v, this.engine.release(now));
      this.engine = null;
    }
    if (this.tyres) {
      this.retire(this.tyres.v, this.tyres.release(now));
      this.tyres = null;
    }
  }

  /** A string of exhaust pops. */
  private backfire(): void {
    let delay = 0;
    const pops = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pops; i++) {
      const v = this.voice(null, FALLOFF.near, rnd(0.35, 0.6), 0.2, delay);
      if (!v) return;
      sfx.backfire(v);
      this.commit('engine', v);
      delay += rnd(0.06, 0.14);
    }
  }

  private updateFootsteps(f: AudioFrame, dt: number): void {
    const stride = f.footSpeed > 4 ? 1.5 : 0.75;
    if (f.car || f.footSpeed < 0.6 || this.dead) {
      this.stepDistance = stride * 0.6; // first step lands soon after setting off
      return;
    }
    this.stepDistance += f.footSpeed * dt;
    if (this.stepDistance < stride) return;
    this.stepDistance = 0;
    const sprint = f.footSpeed > 4;
    this.oneShot('foot', null, FALLOFF.near, sprint ? 0.5 : 0.36, 0.05, (v) => sfx.footstep(v, sprint));
  }

  private updateFire(vehicles: ReadonlyArray<FireSource>, dt: number, now: number): void {
    let sum = 0;
    let px = 0;
    for (const v of vehicles) {
      const dmg = v.damage;
      const flaming = dmg.burning || (dmg.wrecked && v.wreckAge < 4);
      if (!flaming) continue;
      const dx = v.sim.x - this.listenerX;
      const d = Math.hypot(dx, v.sim.z - this.listenerZ);
      if (d > FALLOFF.fire.max) continue;
      const w = distanceGain(d, FALLOFF.fire) * (dmg.wrecked ? clamp01(1 - v.wreckAge / 4) : 1);
      sum += w;
      px += w * dx;
    }
    if (sum > 0.01 && !this.fire) this.fire = new FireVoice(this.ctx!, this.bank!, this.worldIn, now);
    if (!this.fire) return;
    this.fire.apply(sum, sum > 0 ? panFor(px / sum) : 0, now, dt);
    if (this.fire.idle > 4) {
      this.retire(this.fire.v, this.fire.release(now));
      this.fire = null;
    }
  }

  private updateRain(inCar: boolean, dt: number, now: number): void {
    const amount = this.rainAmount;
    if (amount > 0.01 && !this.rain) this.rain = new RainVoice(this.ctx!, this.bank!, this.worldIn, now);
    if (!this.rain) return;
    this.rain.apply(amount, inCar, now);
    this.rainIdle = amount > 0.005 ? 0 : this.rainIdle + dt;
    if (this.rainIdle > 3) {
      this.retire(this.rain.v, this.rain.release(now));
      this.rain = null;
    }
  }

  private updateSirens(dt: number, now: number): void {
    for (let i = this.sirens.length - 1; i >= 0; i--) {
      const s = this.sirens[i];
      s.age += dt;
      if (s.age > SIREN_STALE) {
        this.retire(s.v, s.release(now));
        this.sirens.splice(i, 1);
        continue;
      }
      const dx = s.x - this.listenerX;
      const d = Math.hypot(dx, s.z - this.listenerZ);
      s.place(distanceGain(d, FALLOFF.siren), panFor(dx), airCutoff(d), d, dt, now);
    }
  }

  private updateHeartbeat(health: number, dt: number): void {
    if (this.dead || health <= 0 || health >= 30) {
      this.heartbeatIn = 0;
      return;
    }
    this.heartbeatIn -= dt;
    if (this.heartbeatIn > 0) return;
    this.heartbeatIn = lerp(0.62, 1, health / 30);
    const v = this.voice(null, FALLOFF.near, 0.3 + 0.5 * (1 - health / 30), 0, 0, 'ui');
    if (!v) return;
    sfx.heartbeat(v);
    this.commit('player', v);
  }

  private updateAmbience(inCar: boolean, dt: number, now: number): void {
    if (inCar !== this.inCar) {
      this.inCar = inCar;
      this.ambient?.setInCar(inCar, now);
      this.musicBus.gain.setTargetAtTime(this.musicGain(settings), now, 0.4);
    }
    this.ambientIn -= dt;
    if (this.ambientIn > 0) return;
    this.ambientIn = rnd(5, 13);
    // Somewhere out in the city: a car swishing past, a horn, a siren.
    const angle = Math.random() * Math.PI * 2;
    const dist = rnd(70, 150);
    const at = { x: this.listenerX + Math.cos(angle) * dist, z: this.listenerZ + Math.sin(angle) * dist };
    const r = Math.random();
    if (r < 0.45) this.oneShot('ambient', at, FALLOFF.distant, 0.5, 0.3, sfx.carPass);
    else if (r < 0.8) this.horn(at.x, at.z, rnd(0.15, 0.5));
    else this.oneShot('ambient', at, FALLOFF.distant, 0.4, 0.5, sfx.distantSiren);
  }

  private updateIntensity(car: CarSound | null, dt: number): void {
    this.chaos.step(dt);
    let level = this.intensityFloor;
    if (this.autoIntensity) {
      const cruising = car ? (car.speed > 22 ? 2 : 1) : 0;
      level = Math.max(level, Math.min(MAX_INTENSITY, cruising + this.chaos.level));
    }
    this.music?.setIntensity(level);
  }
}
