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
import { BREACH_RADIUS_CAP } from '../systems/breaches';
import type { Award } from '../systems/score';
import type { CarSound } from './carSound';
import { ChaosMeter, MAX_INTENSITY } from './chaos';
import { AmbientBed, EngineVoice, FireVoice, RainVoice, RotorVoice, SirenVoice, StreetChain, TyreVoice, type SirenStyle } from './loops';
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
import { CHASE, ChaseMusic, type ChaseCue } from './music/chase';
import { MusicPlayer } from './music/musicPlayer';
import type { MusicMode } from './music/sequencer';
import { STATIONS, songMajor, type Song, type Station } from './music/stations';
import { STING_LEVELS, countInSting, missionFailedSting, missionPassedSting, missionStartSting } from './music/stings';
import { THEME } from './music/themes';
import * as sfx from './sfx';
import {
  Boomboxes,
  EMITTERS,
  ParkedRadios,
  ShopEmitters,
  StreetMusic,
  isParked,
  type ShopBuilding,
  type ShopPlan,
  type StreetCar,
} from './streetMusic';
import { NoiseBank, Voice, automateDip, makeImpulse, nodeStats } from './synth';
import { RateGate, VoiceLimiter } from './voices';
import { len2 } from '../core/len';
import { alarmPattern } from '../systems/emergency';

export { createCarSound, describeCar, type CarSound } from './carSound';
export type { SirenStyle } from './loops';
export type { UiSound } from './sfx';
export type { MusicMode } from './music/sequencer';

/** A car that might be on fire, or parked with its radio on (the game's Vehicle fits this shape). */
export interface FireSource extends StreetCar {
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
  /** Cars to scan for fires near the listener, and for radios on foot. */
  vehicles: ReadonlyArray<FireSource>;
  /** The car the player is driving (null on foot), and the one they last got out of: its radio plays their station. */
  playerCar?: FireSource | null;
  lastCar?: FireSource | null;
}

export function createAudioFrame(vehicles: ReadonlyArray<FireSource> = []): AudioFrame {
  return { x: 0, z: 0, car: null, footSpeed: 0, health: 100, vehicles, playerCar: null, lastCar: null };
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
  | 'player'
  | 'sting';

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
  sting: 3,
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
  rotor: { ref: 22, max: 320, floor: 0.04 },
  fire: { ref: 6, max: 70, floor: 0 },
  distant: { ref: 25, max: 400, floor: 0.08 },
  boombox: { ref: EMITTERS.boombox.ref, max: EMITTERS.boombox.max, floor: 0 },
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
/** On foot the street is scanned for music this often, s. */
const STREET_SCAN = 0.2;
const STATION_KEY = 'curbside.station';
/** The world muffle's resting cutoff, Hz (effectively open). */
const OPEN = 20000;
/** Entering a car this soon (ms) after a carjack means its engine is already running: no starter. */
const CARJACK_WINDOW_MS = 1500;
/** GO's hit (and the radio dropping in on it) this long after the call, so the radio's first notes book on time. */
const GO_DELAY = 0.03;
/** Chaos energy GO adds: the run starts with the music already up a few layers. */
const GO_ENERGY = 3.2;
/** The radio under a count-in: this deep, held a little past the next count (GO lets go at once). */
const COUNT_DUCK = 0.3;
const COUNT_HOLD = 1.25;

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
  /** The music on foot: emitters picked from the street, through the street chain. */
  private streetChain: StreetChain | null = null;
  private readonly street = new StreetMusic();
  private shops: ShopEmitters | null = null;
  private readonly boomboxes = new Boomboxes();
  private readonly parked = new ParkedRadios();
  private streetIn = 0;
  private streetDt = 0;
  /** The street chain: 'open' (the radio, the chase or the theme in your ears), 'street' (on foot), 'shut' (silent: WASTED, the chase's last bar on foot). */
  private chainState: 'open' | 'street' | 'shut' = 'open';
  /** WASTED or BUSTED is over: the respawn sting waits for the next frame, to be in the key of the music that comes back. */
  private respawnSting = false;
  /** Music volume at zero: the music sleeps whatever else happens. */
  private volumeSilent = false;
  /** When the chase plays instead of the radio. */
  private readonly chase = new ChaseMusic();
  private engine: EngineVoice | null = null;
  private tyres: TyreVoice | null = null;
  private fire: FireVoice | null = null;
  private ambient: AmbientBed | null = null;
  private rain: RainVoice | null = null;
  private rainAmount = 0;
  private rainIdle = 0;
  private readonly sirens: SirenVoice[] = [];
  private rotorVoice: RotorVoice | null = null;
  /** Released continuous voices, disconnected once they've faded. */
  private readonly retiring: Voice[] = [];
  private readonly limiter = new VoiceLimiter<Voice>(LIMITS, MAX_VOICES);
  private readonly gate = new RateGate();
  private readonly chaos = new ChaosMeter();
  private readonly stationListeners: Array<(s: Station) => void> = [];
  private readonly songListeners: Array<(song: Song, s: Station) => void> = [];
  private readonly scoreListeners: Array<(playing: boolean) => void> = [];
  /** The chase as the listeners last heard of it. */
  private scoreHeard = false;
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

  /** The car radio's station (saved; also under the title theme and on foot, so a retune there is kept for the car). */
  get station(): Station {
    return STATIONS[this.stationIndex];
  }

  /** The key the music is in (the song's own, or the theme's; the next one's mid-switch), for stings and UI sounds. */
  private get musicKey(): number {
    return this.music?.arranger.key ?? this.station.key;
  }

  /** That key is major (stings and UI sounds spell their chords to match). */
  private get musicMajor(): boolean {
    return this.music?.arranger.major ?? songMajor(this.station.songs[0]);
  }

  /** Stings borrow the radio's drum kit. */
  private readonly kitTake = (part: Parameters<sfx.KitSource>[0]): AudioBuffer | null => this.music?.kitTake(part) ?? null;

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
    this.updateMusicRoute(f, dt, now);
    if (this.respawnSting) this.playRespawnSting();
  }

  /** The city's shopfronts that play music on foot (planned once, at wiring time). */
  streetShops(buildings: ReadonlyArray<ShopBuilding>, plans: ReadonlyArray<ShopPlan>): void {
    this.shops = new ShopEmitters(buildings, plans);
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

  /**
   * A helicopter's rotor overhead at (x, z). Call every frame while it's
   * there; call with on = false, or stop calling, and it fades out.
   */
  rotor(x: number, z: number, on = true): void {
    const ctx = this.ctx;
    if (!ctx || !this.bank) return;
    if (!on) {
      if (this.rotorVoice) {
        this.retire(this.rotorVoice.v, this.rotorVoice.release(ctx.currentTime));
        this.rotorVoice = null;
      }
      return;
    }
    if (!this.rotorVoice) this.rotorVoice = new RotorVoice(ctx, this.bank, this.worldIn, ctx.currentTime);
    this.rotorVoice.x = x;
    this.rotorVoice.z = z;
    this.rotorVoice.age = 0;
  }

  /** How hard it's raining, 0..1 (a weather loop; 0 fades it out). Call whenever it changes. */
  setRain(amount: number): void {
    this.rainAmount = clamp01(amount);
  }

  /** The ice cream van's jingle at (x, z). */
  chime(x: number, z: number): void {
    const v = this.voice({ x, z }, FALLOFF.horn, 0.5, 0.25);
    if (!v) return;
    sfx.chime(v);
    this.commit('horn', v);
  }

  /** A car horn at (x, z). */
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
    sfx.ui(v, kind, this.musicKey, this.musicMajor);
    this.commit('ui', v);
  }

  /**
   * The 3-2-1-GO before a run (Chaos Run, races, frenzies): call with each
   * number as it shows (3, 2, 1), then 0 on GO. The counts are hits that
   * build over a riser in the music's key with the radio held down under
   * them; GO lands a big hit and, in a car, the radio drops back in hard on
   * a chorus (on foot the street plays on: it isn't the radio in your ears).
   */
  countIn(n: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.bank || ctx.state !== 'running') return;
    const go = n <= 0;
    const v = this.voice(null, FALLOFF.near, STING_LEVELS.countIn, 0, go ? GO_DELAY : 0, 'ui');
    if (!v) return;
    sfx.playSting(v, countInSting(n, this.musicKey, this.musicMajor), this.kitTake);
    this.commit('sting', v);
    const music = this.music;
    if (!music || this.dead) return;
    if (!go) {
      music.duck(COUNT_DUCK, 0.3, COUNT_HOLD);
      return;
    }
    // Play takes over from here; the next frames ask for the same level, so the drop sticks.
    this.chaos.add(GO_ENERGY);
    this.chaos.step(0);
    // GO lets go of the count's duck whatever drops in: on foot too, under the chase or the street.
    music.unduck(v.t);
    // On foot the street plays on: a shop's radio doesn't jump to its chorus for you.
    if (this.walking) return;
    const level = this.autoIntensity ? Math.min(MAX_INTENSITY, (this.inCar ? 1 : 0) + this.chaos.level) : 0;
    music.dropIn(v.t, Math.max(this.intensityFloor, level));
    music.pump(ctx.currentTime);
  }

  /**
   * A payphone job's music, built on the theme's hook: 'start' as it begins,
   * 'passed', 'failed'. `index` (the job's) gives each its own colour. The
   * radio dips under it.
   */
  missionCue(kind: 'start' | 'passed' | 'failed', index = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.bank || ctx.state !== 'running') return;
    const key = this.musicKey;
    const major = this.musicMajor;
    const [sting, level] =
      kind === 'start'
        ? [missionStartSting(key, index, major), STING_LEVELS.missionStart]
        : kind === 'passed'
          ? [missionPassedSting(key, index), STING_LEVELS.missionPassed]
          : [missionFailedSting(key, index, major), STING_LEVELS.missionFailed];
    const v = this.voice(null, FALLOFF.near, level, 0, 0, 'ui');
    if (!v) return;
    sfx.playSting(v, sting, this.kitTake);
    this.commit('sting', v);
    this.music?.duck(kind === 'start' ? 0.3 : 0.4, 0.8, sting.length * 0.6);
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

  /** 'game' plays the adaptive soundtrack, 'menu' the title theme, 'off' fades it out. */
  setMusicMode(mode: MusicMode): void {
    this.musicMode = mode;
    if (!this.dead) this.music?.setMode(mode);
  }

  /**
   * Tune the car radio to the next station; returns it. During a chase the
   * chase gives way to it (and stays away until the next chase). On foot it
   * retunes the car radio for next time (heard at once from the car you got
   * out of, if you're by it); the street plays on.
   */
  nextStation(): Station {
    this.stationIndex = (this.stationIndex + 1) % STATIONS.length;
    saveStation(this.stationIndex);
    const station = STATIONS[this.stationIndex];
    const music = this.music;
    if (music) {
      if (this.chase.skip() || music.playingScore) music.dropScore();
      if (!this.walking) music.setStation(this.stationIndex);
    }
    for (const fn of this.stationListeners) fn(station);
    return station;
  }

  /** The song on the car radio's station (null before the music starts, under the title theme or the chase, and from the street on another station). */
  get song(): Song | null {
    const m = this.music;
    return m && m.station === STATIONS[this.stationIndex] ? m.arranger.song : null;
  }

  /** A new song started on the car radio's station (the first song too; not the title theme, the chase or other stations heard on foot). */
  onSongChange(fn: (song: Song, s: Station) => void): () => void {
    this.songListeners.push(fn);
    return () => {
      const i = this.songListeners.indexOf(fn);
      if (i >= 0) this.songListeners.splice(i, 1);
    };
  }

  /** The chase is what plays instead of the radio (its outro included). */
  get playingScore(): boolean {
    return this.music?.playingScore ?? false;
  }

  /** The chase came in (true, as its first bar is booked) or gave way to the radio (false). */
  onScoreChange(fn: (playing: boolean) => void): () => void {
    this.scoreListeners.push(fn);
    return () => {
      const i = this.scoreListeners.indexOf(fn);
      if (i >= 0) this.scoreListeners.splice(i, 1);
    };
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
    if (e.type === 'busted') return this.onBusted();
    if (e.type === 'respawn') return this.onRespawn();
    // The wanted level is the music's floor (a chase ramps it up, and from CHASE_FROM stars the chase plays), audible or not yet.
    if (e.type === 'wanted') this.onWantedMusic(e);
    if (e.type === 'boombox') this.boomboxes.track(e);
    if (e.type === 'carjack') this.carjackAt = performance.now();
    const ctx = this.ctx;
    if (!ctx || !this.bank || ctx.state !== 'running') return;
    switch (e.type) {
      case 'crash':
        return this.onCrash(e);
      case 'explosion':
        return this.onExplosion(e);
      case 'breach':
        return this.onBreach(e);
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
        // Back on your station before anything keyed to it (a run's count-in follows at once).
        this.syncRadio();
        return this.oneShot('door', null, FALLOFF.near, 0.8, 0.1, (v) => sfx.door(v, true));
      case 'exitVehicle':
        return this.oneShot('door', null, FALLOFF.near, 0.65, 0.1, (v) => sfx.door(v, true));
      case 'pickup': {
        const kind = e.kind;
        return this.oneShot('pickup', null, FALLOFF.near, 0.75, 0.05, (v) =>
          kind === 'health'
            ? sfx.pickupHealth(v)
            : kind === 'armour'
              ? sfx.pickupArmour(v)
              : sfx.pickupWeapon(v, kind === 'ammo' ? 'smg' : kind),
        );
      }
      case 'throw':
        return this.oneShot('punch', e, FALLOFF.punch, 0.8, 0.1, sfx.throwWhoosh);
      case 'ignite':
        return this.oneShot('impact', e, FALLOFF.crash, 0.9, 0.3, sfx.ignite, 0.5);
      case 'boost':
        if (!e.on) return;
        return this.oneShot('engine', null, FALLOFF.near, 0.8, 0.1, sfx.boost, 0.3);
      case 'jump':
        return this.oneShot('crash', e, FALLOFF.crash, e.involvesPlayer ? 0.9 : 0.6, 0.15, sfx.jumpWhoosh, e.involvesPlayer ? 0.4 : 0);
      case 'land': {
        const impact = e.impact;
        return this.oneShot('crash', e, FALLOFF.crash, e.involvesPlayer ? 1 : 0.7, 0.25, (v) => sfx.landThump(v, impact));
      }
      case 'stunt':
        return; // the STUNT award plays its own sting
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
      case 'wanted':
        return this.onWanted(e);
      case 'horn':
        return this.horn(e.x, e.z, e.duration);
      case 'respray':
        return this.oneShot('door', e, FALLOFF.near, 0.8, 0.2, sfx.spray);
      case 'boombox':
        return this.onBoombox(e);
      case 'celebrate':
        return; // the mission / Chaos Run card plays its own sting
      case 'activityEnd':
        return; // the race banner / results card play their own stings
      case 'street':
        return this.onStreet(e);
      case 'stamp':
        return this.onStamp();
      default: {
        const unhandled: never = e;
        return unhandled;
      }
    }
  }

  /** The city's own happenings: a chime as the ice cream van opens, doors, a bus's brakes, a hose, a winch, a dog. */
  private onStreet(e: EventOf<'street'>): void {
    switch (e.what) {
      case 'iceCream':
        return this.chime(e.x, e.z);
      case 'patientLoaded':
      case 'arrest':
        return this.oneShot('door', e, FALLOFF.near, 0.6, 0.2, (v) => sfx.door(v, false));
      case 'busStop':
      case 'hose':
        // Air brakes / the pump: a hiss.
        return this.oneShot('door', e, FALLOFF.near, 0.55, 0.25, sfx.spray);
      case 'tow':
        return this.oneShot('crash', e, FALLOFF.crash, 0.45, 0.2, (v) => sfx.crash(v, 4, true));
      case 'bark':
        return this.oneShot('ambient', e, FALLOFF.punch, 0.5, 0.25, sfx.bark);
      case 'yelp':
        return this.oneShot('ambient', e, FALLOFF.punch, 0.45, 0.2, sfx.yelp);
      case 'alarm': {
        const pattern = alarmPattern(e.x, e.z);
        return this.oneShot('horn', e, FALLOFF.horn, 0.4, 0.2, (v) => sfx.carAlarm(v, pattern));
      }
      case 'takeTheHeat':
        // The chase's cars are yours now: a whoop as they swing in behind.
        return this.oneShot('horn', e, FALLOFF.siren, 0.7, 0.15, sfx.sirenWhoop, 0.3);
      case 'citizensArrest':
        // The suspect's door; the award plays the sting.
        return this.oneShot('door', e, FALLOFF.near, 0.6, 0.2, (v) => sfx.door(v, true));
      case 'haveAGo':
        return; // heard through the knock-down and the award's sting
      // The incidents (V2).
      case 'cashRun':
        // The armoured van's back doors.
        return this.oneShot('door', e, FALLOFF.near, 0.6, 0.2, (v) => sfx.door(v, true));
      case 'cashSpill':
        return this.oneShot('pickup', e, FALLOFF.punch, 0.7, 0.2, sfx.cashSpill);
      case 'kebab':
        return this.oneShot('ambient', e, FALLOFF.punch, 0.45, 0.3, sfx.lastOrders);
      case 'funeral':
        return this.oneShot('ambient', e, FALLOFF.horn, 0.35, 0.45, sfx.toll);
      case 'hydrant':
        return this.oneShot('ambient', e, FALLOFF.fire, 0.5, 0.2, sfx.gush);
      case 'conga':
        return this.oneShot('ambient', e, FALLOFF.punch, 0.45, 0.25, sfx.conga);
      case 'action':
        return this.oneShot('ambient', e, FALLOFF.punch, 0.55, 0.25, sfx.clapper);
      case 'pyro':
        // The staged blast: the real thing's sound, a little held back.
        return this.oneShot('explosion', e, FALLOFF.explosion, 0.5, 0.35, (v) => sfx.explosion(v, 0.3));
      default:
        // Sirens are continuous (StreetLife); the rest is heard through what it causes (shots, crashes, horns).
        return;
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
      rotor: this.rotorVoice !== null,
      fire: this.fire !== null,
      rain: this.rain !== null,
      engine: m ? { archetype: this.engine!.archetype, rpm: Math.round(m.rpm), gear: m.gear, load: +m.load.toFixed(2), cranking: m.cranking } : null,
      music: music
        ? {
            station: music.station.name,
            radio: music.arranger.radio.name,
            theme: music.playingTheme,
            song: music.arranger.song.title,
            key: music.arranger.key,
            major: music.arranger.major,
            section: music.arranger.section,
            mode: music.mode,
            intensity: music.arranger.intensity,
            target: music.arranger.target,
            bpm: music.arranger.bpm,
            bar: music.arranger.bar,
            stepsScheduled: music.stepsScheduled,
            activeNotes: music.activeNotes,
            chase: this.chase.phase,
            score: music.playingScore,
            scoreEnding: music.arranger.scoreEnding,
          }
        : null,
      street: {
        onFoot: this.street.onFoot,
        source: this.street.kind,
        station: this.street.station >= 0 ? STATIONS[this.street.station].name : null,
        gain: +this.street.gain.toFixed(3),
        cutoff: Math.round(this.street.cutoff),
        pan: +this.street.pan.toFixed(2),
        dormant: this.street.dormant,
        shops: this.shops?.count ?? 0,
        boomboxes: this.boomboxes.playing,
      },
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
    this.streetChain?.v.dispose();
    for (const s of this.sirens) s.v.dispose();
    this.rotorVoice?.v.dispose();
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

    // On foot the music is heard from the street, through this chain; elsewhere it's open.
    this.streetChain = new StreetChain(ctx, bank, this.musicBus, ctx.currentTime);
    this.music = new MusicPlayer(ctx, bank, this.streetChain.input, impulse, STATIONS[this.stationIndex]);
    this.music.setTheme(THEME);
    this.music.onSong = (song, station) => {
      const score = this.music!.playingScore;
      if (score !== this.scoreHeard) {
        this.scoreHeard = score;
        for (const fn of this.scoreListeners) fn(score);
      }
      // Only the car radio's station gets NOW PLAYING (not the title theme, the chase or another station heard on foot).
      if (station !== STATIONS[this.stationIndex]) return;
      for (const fn of this.songListeners) fn(song, station);
    };
    if (this.chase.phase === 'on') this.music.setScore(CHASE);
    if (this.musicMode !== 'off' && !this.dead) this.music.setMode(this.musicMode);
    // Every kit the street or the chase may want, warmed from now on in idle time (the chase's right after the radio's), not mid-play.
    this.music.warmKits([CHASE.station, ...STATIONS].map((s) => s.sound));
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
    this.volumeSilent = master * volumeToGain(s.musicVolume) < SILENT_GAIN;
    this.syncDormant();
    // Fully muted, the whole context sleeps; turning it back up wakes it (or the next gesture does).
    const muted = master < SILENT_GAIN;
    if (muted === this.muted) return;
    this.muted = muted;
    if (muted) ctx.suspend().catch(() => {});
    else this.wake();
  }

  private musicGain(s: Settings): number {
    return volumeToGain(s.musicVolume) * MUSIC_LEVEL;
  }

  /** On foot in play: the music comes from the street (unless the chase plays). */
  private get walking(): boolean {
    return this.musicMode === 'game' && !this.dead && this.inCar === false;
  }

  /** Asleep (no notes booked) when the music volume is at zero, or on foot with nothing to hear for a while (not with a chase coming). */
  private syncDormant(): void {
    const music = this.music;
    if (!music) return;
    music.setDormant(this.volumeSilent || (this.street.onFoot && this.street.dormant && music.arranger.score === null));
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
      d = len2(dx, at.z - this.listenerZ);
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
    const d = len2(e.x - this.listenerX, e.z - this.listenerZ);
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

  /** A facade crumbling (the destruction test): masonry and chunks landing, just after the boom. */
  private onBreach(e: EventOf<'breach'>): void {
    const now = this.ctx!.currentTime;
    // A chain makes a couple of crumbles, not five.
    if (!this.gate.allow('crumble', now, 0.12, 2)) return;
    const v = this.voice(e, FALLOFF.crash, 0.55 + 0.45 * e.strength, 0.5, 0.12);
    if (!v) return;
    sfx.crumble(v, clamp01(e.radius / BREACH_RADIUS_CAP));
    this.commit('crash', v);
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
    const len = len2(e.dirX, e.dirZ) || 1;
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
    const key = this.musicKey;
    this.chaos.add(a.kind === 'boom' ? 0.6 : 0.35 + 0.08 * a.multiplier);
    const v = this.voice(null, FALLOFF.near, a.kind === 'boom' ? 0.9 : 0.75, 0, 0, 'ui');
    if (v) {
      if (a.kind === 'boom') sfx.bigSting(v, key, this.musicMajor);
      else sfx.award(v, a.kind, a.multiplier, key, this.musicMajor);
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

  /** Named mayhem (game/stamps.ts): the stamp's thunk and chord, the music ducked under it. */
  private onStamp(): void {
    const v = this.voice(null, FALLOFF.near, 0.85, 0, 0, 'ui');
    if (!v) return;
    sfx.stamp(v, this.musicKey, this.musicMajor);
    this.commit('award', v);
    this.music?.duck(0.6, 0.9);
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
    if (!this.ctx || !this.bank) return this.endChase();
    const now = this.ctx.currentTime;
    const v = this.voice(null, FALLOFF.near, STING_LEVELS.wasted, 0, 0, 'ui');
    if (v) {
      sfx.wasted(v, this.musicKey);
      this.commit('player', v);
    }
    this.music?.setMode('off');
    this.endChase();
    // Held until respawn; cancels any hurt or blast recovery already queued.
    this.muffleDip.hold(600);
    automateDip(this.worldMuffle.frequency, this.muffleDip, now, 0.25);
  }

  /** A star gained: the wanted sting. A chase shaken off (or resprayed away): relief. */
  private onWanted(e: EventOf<'wanted'>): void {
    if (e.level > e.prev) this.ui('star');
    else if (e.level === 0 && (e.reason === 'evaded' || e.reason === 'respray')) this.ui('success');
  }

  /** BUSTED: like WASTED (world muffled, music off until release), with its own sting. */
  private onBusted(): void {
    this.dead = true;
    this.chaos.reset();
    if (!this.ctx || !this.bank) return this.endChase();
    const now = this.ctx.currentTime;
    const v = this.voice(null, FALLOFF.near, STING_LEVELS.busted, 0.1, 0, 'ui');
    if (v) {
      sfx.busted(v, this.musicKey);
      this.commit('player', v);
    }
    this.music?.setMode('off');
    this.endChase();
    this.muffleDip.hold(600);
    automateDip(this.worldMuffle.frequency, this.muffleDip, now, 0.25);
  }

  /** WASTED, BUSTED, a fresh run: no chase, and no outro of one still playing (the radio after respawn). */
  private endChase(): void {
    this.chase.reset();
    this.music?.dropScore();
  }

  /**
   * Every new life, and every fresh run (PLAY, RESTART, quit to title come
   * through respawn too): the chaos meter starts from zero, so a 5-star chase
   * doesn't carry its music into the next run. The sting only after WASTED
   * or BUSTED, not over the title.
   */
  private onRespawn(): void {
    const fromDeath = this.dead;
    this.dead = false;
    this.runPoints = 0;
    this.chaos.reset();
    this.endChase();
    if (!this.ctx || !this.bank) return;
    const now = this.ctx.currentTime;
    this.muffleDip.release(now, 0.9);
    automateDip(this.worldMuffle.frequency, this.muffleDip, now, 0.01);
    if (this.musicMode !== 'off') this.music?.setMode(this.musicMode);
    // Next frame, once the street has picked what plays (you respawn on foot), so the sting is in its key.
    this.respawnSting = fromDeath && this.ctx.state === 'running';
  }

  private playRespawnSting(): void {
    this.respawnSting = false;
    if (this.musicMode !== 'game') return; // quit to the title meanwhile
    const v = this.voice(null, FALLOFF.near, 0.9, 0, 0, 'ui');
    if (!v) return;
    sfx.respawn(v, this.musicKey);
    this.commit('player', v);
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
      const d = len2(dx, v.sim.z - this.listenerZ);
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
      const d = len2(dx, s.z - this.listenerZ);
      s.place(distanceGain(d, FALLOFF.siren), panFor(dx), airCutoff(d), d, dt, now);
    }
    const r = this.rotorVoice;
    if (r) {
      r.age += dt;
      if (r.age > SIREN_STALE) {
        this.retire(r.v, r.release(now));
        this.rotorVoice = null;
      } else {
        const dx = r.x - this.listenerX;
        const d = len2(dx, r.z - this.listenerZ);
        r.place(distanceGain(d, FALLOFF.rotor), panFor(dx), airCutoff(d), now);
      }
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

  // --- The chase and music on foot ---

  private onWantedMusic(e: EventOf<'wanted'>): void {
    this.setIntensity(e.level);
    // A chase may be coming: its drum kit renders between frames now, not as it starts.
    if (e.level > 0 && e.prev === 0) this.music?.warmKit(CHASE.station.sound);
    // WASTED and BUSTED end the chase once the music is off (a death clears the stars first: dropping it here would fade it back up).
    if (e.reason === 'died' || e.reason === 'busted') return;
    this.cueChase(this.chase.wanted(e.level, e.reason));
  }

  private cueChase(cue: ChaseCue): void {
    const music = this.music;
    if (!music || !cue) return;
    if (cue === 'start') music.setScore(CHASE);
    else if (cue === 'end') music.endScore();
    else music.dropScore();
  }

  /** A boombox cut by trouble: a record scratch where it stood, and its music stops dead if that's what's heard. */
  private onBoombox(e: EventOf<'boombox'>): void {
    if (e.on || !e.cut) return;
    this.oneShot('ambient', e, FALLOFF.boombox, 0.75, 0.2, sfx.recordScratch);
    const s = this.street;
    if (!s.onFoot || s.kind !== 'boombox' || s.x !== e.x || s.z !== e.z) return;
    s.cut();
    this.streetChain?.apply(s.gain, s.cutoff, s.pan, s.tau, this.ctx!.currentTime);
    this.streetIn = STREET_SCAN;
  }

  /**
   * Where the music is heard. The car radio, the chase and the title theme
   * play in your ears (the street chain open); on foot it's the street: the
   * loudest emitter's station, faint, muffled and panned, or nothing. Back in
   * a car the radio is the player's station again. While the music is off
   * (WASTED, BUSTED), and over the chase's last bar on foot, the chain is
   * shut: what plays next on foot starts from silence, not in your ears.
   */
  private updateMusicRoute(f: AudioFrame, dt: number, now: number): void {
    const music = this.music;
    const chain = this.streetChain;
    if (!music || !chain) return;
    if (!this.walking || music.playingScore) {
      if (this.street.onFoot) this.street.leave();
      this.streetIn = 0;
      this.streetDt = 0;
      // In a car the radio is the player's station (a silent retune under the chase, the usual retune otherwise); off the game too (silent under the theme).
      if (f.car || this.musicMode !== 'game') this.syncRadio();
      const a = music.arranger;
      if (this.dead) {
        // Held until the music's own fade is done (no swell from a faint street), then shut.
        if (this.chainState !== 'shut') chain.apply(0, OPEN, 0, 0.1, now + 0.5);
        this.chainState = 'shut';
      } else if (this.walking && a.section === 'outro' && a.lastBar && a.scoreEnding) {
        // The chase hands back to the street: faded out across its last bar.
        if (this.chainState !== 'shut') chain.apply(0, OPEN, 0, 48 / a.bpm, now);
        this.chainState = 'shut';
      } else if (this.chainState !== 'open') {
        // The chase slams in on its bar line; a car door opens the radio up a little slower.
        chain.open(now, music.playingScore ? 0.03 : 0.3);
        this.chainState = 'open';
      }
      this.syncDormant();
      return;
    }
    // Stepping out carries on from the radio in your ears; from a shut chain the street starts from silence.
    const audible = this.chainState === 'open';
    this.chainState = 'street';
    this.streetDt += dt;
    this.streetIn -= dt;
    if (this.streetIn > 0) return;
    this.streetIn = STREET_SCAN;
    const s = this.street;
    this.scanStreet(f);
    s.end(this.streetDt, this.heardStation(), audible);
    this.streetDt = 0;
    if (s.tune >= 0 && music.arranger.radio !== STATIONS[s.tune]) music.tune(s.tune, true);
    this.syncDormant();
    chain.apply(s.gain, s.cutoff, s.pan, s.tau, now);
  }

  /** The music's radio back on the car radio's station, after the street retuned it (silent under the theme and the chase). */
  private syncRadio(): void {
    const music = this.music;
    if (music && !this.dead && music.arranger.radio !== STATIONS[this.stationIndex]) music.setStation(this.stationIndex);
  }

  /** Offer the street every emitter that could be heard: the car you left, parked cars, shops, boomboxes. */
  private scanStreet(f: AudioFrame): void {
    const s = this.street;
    s.begin(f.x, f.z);
    const own = f.lastCar ?? null;
    const driving = f.playerCar ?? null;
    if (own && own !== driving && isParked(own)) s.offer('own', this.stationIndex, own.sim.x, own.sim.z);
    const r = EMITTERS.car.max;
    for (const v of f.vehicles) {
      if (v === own || v === driving || Math.abs(v.sim.x - f.x) > r || Math.abs(v.sim.z - f.z) > r || !isParked(v)) continue;
      s.offer('car', this.parked.stationOf(v), v.sim.x, v.sim.z);
    }
    this.shops?.offerNear(s, f.x, f.z);
    this.boomboxes.offerTo(s);
  }

  /** The radio station the music is playing (−1 for the theme or the chase). */
  private heardStation(): number {
    const st = this.music!.station;
    for (let i = 0; i < STATIONS.length; i++) if (STATIONS[i] === st) return i;
    return -1;
  }
}
