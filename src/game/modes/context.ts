/**
 * What the activity runtimes (chaosRunMode, frenzyMode, raceMode, ...) are
 * given: the game objects they read and the services the progress director
 * provides (paying out, spawning mission cars, freezing the game for a card,
 * radar blips). Keeps each runtime small and main.ts out of it.
 */
import type { ColorRepresentation } from 'three';
import type { GameAudio } from '../../audio/gameAudio';
import type { EventBus } from '../../core/events';
import type { Input } from '../../core/input';
import type { VehicleArchetype } from '../../entities/vehicle';
import type { CameraRig } from '../../render/cameraRig';
import type { GlowSprites } from '../../render/glowSprites';
import type { Look } from '../../render/look';
import type { ProgressProps } from '../../render/progressLook';
import type { Score } from '../../systems/score';
import type { FrontDoor } from '../../ui/frontDoor';
import type { Hud } from '../../ui/hud';
import type { Panel } from '../../ui/menu';
import type { ProgressHud } from '../../ui/progressHud';
import type { BlipOptions, Radar } from '../../ui/radar';
import type { City, Rect } from '../../world/city';
import type { Heat } from '../heat';
import type { Player } from '../player';
import type { Population, Vehicle } from '../population';
import type { Progress } from '../progress';

/**
 * HUD text rebuilt only when what it shows changes: the per-frame HUD code
 * asks stale(key) with a number standing for the content, and builds the
 * string only then (no garbage per frame while nothing visible changes).
 */
export class KeyedText {
  text = '';
  private key: number | null = null;

  stale(key: number): boolean {
    if (key === this.key) return false;
    this.key = key;
    return true;
  }

  reset(): void {
    this.key = null;
  }
}

/** The game objects the progress director needs (main.ts hands these over). */
export interface ProgressDeps {
  bus: EventBus;
  player: Player;
  vehicles: Vehicle[];
  population: Population;
  heat: Heat;
  score: Score;
  city: City;
  rand: () => number;
  look: Look;
  rig: CameraRig;
  radar: Radar;
  hud: Hud;
  audio: GameAudio;
  frontDoor: FrontDoor;
  input: Input;
  /** False behind the title (attract mode). */
  playing(): boolean;
  /** Quit to the title screen. */
  enterTitle(): void;
}

/** One activity runtime, driven by the director. */
export interface Mode {
  /** One sim step (not while frozen or paused). */
  step(dt: number): void;
  /** Per frame, real time: claim the activity card if this mode is running; true if it did. */
  hud(dt: number): boolean;
  /** A prompt for a nearby marker, or null. */
  prompt(): string | null;
  /** Faked lights and props for this frame (only near `view`). */
  glow(g: GlowSprites, props: ProgressProps, view: Rect, t: number, night: number): void;
  /** Drop everything silently (quit to title, restart, a mode taking over). */
  reset(): void;
}

/** The director's services for the runtimes. */
export interface ModeCtx {
  readonly deps: ProgressDeps;
  readonly progress: Progress;
  readonly ui: ProgressHud;
  /** Free-roam activities are on: in play, not in a special mode (Chaos Run). */
  readonly freeRoam: boolean;
  /** Alive, free and in play. */
  readonly live: boolean;
  /** The exclusive activity running ('frenzy', 'race', 'mission', 'taxi'), or null. */
  busy: string | null;
  /** Hold the player's car still (a race or Chaos Run 3-2-1). */
  holdControls: boolean;
  /** Pay out with a feed line: "+$1,000 FRENZY". Returns what was paid. */
  pay(amount: number, reason: string, label: string): number;
  /** A feed line without points. */
  notice(text: string, kind?: string): void;
  /** Bank the open chain into cash now (a timed run is over: nothing can lose it any more). */
  bankChain(): void;
  /** A parked car for an activity, kept from recycling until unpin(). */
  spawnCar(archetype: VehicleArchetype, paint: ColorRepresentation, x: number, z: number, heading: number): Vehicle;
  unpin(v: Vehicle): void;
  /** Put the player in `v` (getting out of any other car first). */
  board(v: Vehicle): void;
  /** Freeze the game and route navigation to `panel` until closeModal(). */
  openModal(panel: Panel): void;
  closeModal(panel: Panel): void;
  /** Show the keyboard / pad focus ring in cards (not on touch). */
  readonly focusRing: boolean;
  blip(id: string, opts: BlipOptions): void;
  unblip(id: string): void;
}
