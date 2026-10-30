/**
 * The game's menus and the flow between them: title → play, the pause menu,
 * settings and how-to (from either), the rotate-your-phone pause with its
 * 3-2-1, and routing keyboard / gamepad navigation to whichever screen is on
 * top. main.ts owns the game state; it hands FrontDoor a few hooks and calls
 * showPause/hidePause from its setPaused.
 */
import type { GameAudio } from '../audio/gameAudio';
import type { Input, NavCommand } from '../core/input';
import { Countdown } from './countdown';
import { HowToPlay } from './howToPlay';
import type { Panel } from './menu';
import { PauseOverlay, type PauseReason } from './pauseOverlay';
import { RotateOverlay } from './rotateOverlay';
import { SettingsPanel } from './settingsPanel';
import { TitleScreen } from './titleScreen';

export interface FrontDoorHooks {
  /** PLAY on the title: start a fresh game. */
  startGame(): void;
  /** Leave the game for the title screen (attract mode). */
  enterTitle(): void;
  /** Respawn and start the run over. */
  restart(): void;
  setPaused(paused: boolean, reason?: PauseReason): void;
  isPaused(): boolean;
  /** Why it's paused (meaningful while isPaused()). */
  pauseReason(): PauseReason;
  /** Reload into a waiting app update. */
  applyUpdate(): void;
}

export class FrontDoor {
  readonly title: TitleScreen;
  readonly pause: PauseOverlay;
  readonly settings: SettingsPanel;
  readonly howTo: HowToPlay;
  readonly rotate: RotateOverlay;
  readonly countdown: Countdown;
  /** Screens receiving navigation, bottom to top. */
  private readonly stack: Panel[] = [];
  private pausedForRotate = false;

  constructor(
    parent: HTMLElement,
    pauseEl: HTMLElement,
    private readonly input: Input,
    private readonly audio: GameAudio,
    private readonly hooks: FrontDoorHooks,
  ) {
    this.title = new TitleScreen(parent, audio, {
      onPlay: () => this.play(),
      onSettings: () => this.openSettings(),
      onHowTo: () => this.openHowTo(),
    });
    this.pause = new PauseOverlay(pauseEl, {
      resume: () => this.resume(),
      settings: () => this.openSettings(),
      howTo: () => this.openHowTo(),
      restart: () => {
        this.audio.ui('confirm');
        hooks.restart();
        hooks.setPaused(false);
      },
      quit: () => {
        this.audio.ui('back');
        hooks.setPaused(false);
        hooks.enterTitle();
      },
      update: () => hooks.applyUpdate(),
    });
    this.settings = new SettingsPanel(parent, audio);
    this.howTo = new HowToPlay(parent, audio);
    this.countdown = new Countdown(parent, audio);
    this.rotate = new RotateOverlay(
      parent,
      () => this.onPortrait(),
      () => this.onLandscape(),
    );
  }

  /** Title screen up (the game behind it is attract mode). */
  get inTitle(): boolean {
    return this.title.isOpen;
  }

  /** Show the title (at boot, and after Quit). */
  showTitle(best: number): void {
    this.stack.length = 0;
    this.title.open(best, this.input.lastDevice);
    this.stack.push(this.title);
  }

  /** Per frame, before the game reads input: menu navigation and pause toggles. */
  update(): void {
    const pauses = this.input.consumePause();
    for (let cmd = this.input.consumeNav(); cmd; cmd = this.input.consumeNav()) this.route(cmd);
    if (pauses % 2 === 1) this.togglePause();
    if (this.title.isOpen) this.title.setDevice(this.input.lastDevice);
  }

  /** The HUD's pause button. */
  openPause(): void {
    if (!this.title.isOpen && !this.hooks.isPaused()) this.hooks.setPaused(true, 'paused');
  }

  /** Called from main's setPaused(true, reason). */
  showPause(reason: PauseReason): void {
    this.pause.show(reason, this.input.lastDevice);
    const i = this.stack.indexOf(this.pause);
    if (reason === 'paused' && i < 0) this.stack.push(this.pause);
    else if (reason !== 'paused' && i >= 0) this.stack.splice(i);
  }

  /** Called from main's setPaused(false): the pause menu and anything opened from it close. */
  hidePause(): void {
    this.pause.hide();
    const i = this.stack.indexOf(this.pause);
    if (i < 0) return;
    for (const p of this.stack.splice(i)) {
      if (p === this.settings && this.settings.isOpen) this.settings.root.hidden = true;
      if (p === this.howTo && this.howTo.isOpen) this.howTo.root.hidden = true;
    }
  }

  private route(cmd: NavCommand): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) return; // in play: menu keys are game keys
    if (cmd === 'back') top.back();
    else top.nav.handle(cmd);
  }

  private togglePause(): void {
    if (this.countdown.isRunning) {
      // Mid 3-2-1: stay paused, with the menu this time.
      this.countdown.cancel();
      this.pausedForRotate = false;
      this.hooks.setPaused(true, 'paused');
      return;
    }
    const top = this.stack[this.stack.length - 1];
    if (top === this.settings || top === this.howTo) {
      top.back();
      return;
    }
    if (this.title.isOpen || this.rotate.active) return;
    if (this.hooks.isPaused()) {
      if (this.hooks.pauseReason() === 'paused') this.resume();
      return;
    }
    this.hooks.setPaused(true, 'paused');
  }

  private play(): void {
    this.title.root.classList.add('leaving');
    this.title.close();
    this.stack.length = 0;
    this.hooks.startGame();
  }

  private resume(): void {
    this.audio.ui('back');
    this.hooks.setPaused(false);
  }

  private openSettings(): void {
    this.settings.open(() => this.pop(this.settings), this.input.lastDevice !== 'touch');
    this.stack.push(this.settings);
  }

  private openHowTo(): void {
    this.howTo.open(this.input.lastDevice, () => this.pop(this.howTo), this.input.lastDevice !== 'touch');
    this.stack.push(this.howTo);
  }

  private pop(panel: Panel): void {
    const i = this.stack.indexOf(panel);
    if (i >= 0) this.stack.splice(i, 1);
  }

  private onPortrait(): void {
    this.countdown.cancel();
    if (this.title.isOpen || (this.hooks.isPaused() && !this.pausedForRotate)) return;
    this.pausedForRotate = true;
    this.hooks.setPaused(true, 'rotate');
  }

  private onLandscape(): void {
    if (!this.pausedForRotate) return;
    if (!this.hooks.isPaused() || this.hooks.pauseReason() !== 'rotate') {
      // Paused for something else meanwhile (app switch): leave the menu up.
      this.pausedForRotate = false;
      return;
    }
    this.countdown.start(() => {
      this.pausedForRotate = false;
      this.hooks.setPaused(false);
    });
  }
}
