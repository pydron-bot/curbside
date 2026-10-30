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
import { TitleScreen, type TitleMode } from './titleScreen';

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
      onMode: (mode) => this.play(mode),
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

  /** The HUD's pause button (also mid 3-2-1: stay paused, with the menu). */
  openPause(): void {
    if (this.title.isOpen) return;
    if (!this.hooks.isPaused() || this.countdown.isRunning) this.hooks.setPaused(true, 'paused');
  }

  /** Called from main's setPaused(true, reason). */
  showPause(reason: PauseReason): void {
    if (reason === 'paused' && this.countdown.isRunning) {
      // The menu (pause button, P, an app switch) wins over a 3-2-1 in progress,
      // which would otherwise resume the game from under it.
      this.countdown.cancel();
      this.pausedForRotate = false;
    }
    this.pause.show(reason, this.input.lastDevice);
    const i = this.stack.indexOf(this.pause);
    if (reason === 'paused' && i < 0) this.stack.push(this.pause);
    else if (reason !== 'paused') this.closeFrom(i);
  }

  /** Called from main's setPaused(false): the pause menu and anything opened from it close. */
  hidePause(): void {
    this.pause.hide();
    this.closeFrom(this.stack.indexOf(this.pause));
  }

  /** Drop stack entries from `i` up, hiding any settings / how-to (or other panels) opened over them. */
  private closeFrom(i: number): void {
    if (i < 0) return;
    for (const p of this.stack.splice(i)) {
      if (p === this.settings && this.settings.isOpen) this.settings.root.hidden = true;
      else if (p === this.howTo && this.howTo.isOpen) this.howTo.root.hidden = true;
      else if (p !== this.pause) p.hide?.();
    }
  }

  /**
   * A screen from another system (results, shop, progress, a mission card)
   * takes keyboard / gamepad navigation until closePanel(). Opened from the
   * pause menu it closes with it.
   */
  openPanel(panel: Panel): void {
    if (!this.stack.includes(panel)) this.stack.push(panel);
  }

  closePanel(panel: Panel): void {
    this.pop(panel);
  }

  /** The pause menu is showing (not the context-lost notice or the rotate pause). */
  get pauseMenuOpen(): boolean {
    return this.pause.menuOpen;
  }

  private route(cmd: NavCommand): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) return; // in play: menu keys are game keys
    if (cmd === 'back') top.back();
    else top.nav.handle(cmd);
  }

  private togglePause(): void {
    if (this.countdown.isRunning) {
      // Mid 3-2-1: stay paused, with the menu this time (showPause stops the count).
      this.hooks.setPaused(true, 'paused');
      return;
    }
    const top = this.stack[this.stack.length - 1];
    if (top === this.settings || top === this.howTo || top?.sheet) {
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

  /**
   * Leave the title for a fresh run: PLAY, or a mode from title.addMode()
   * (its onSelect runs once the run has started, to set itself up on top).
   * The one way into play, so the title and its menu stack always close.
   */
  play(mode?: TitleMode): void {
    this.title.close();
    this.stack.length = 0;
    this.hooks.startGame();
    mode?.onSelect();
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
