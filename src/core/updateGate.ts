/**
 * Holds a downloaded app update until reloading can't cost the player
 * anything. vite-plugin-pwa's autoUpdate mode reloaded the page as soon as
 * a new service worker took over, wiping whatever run was in progress; now
 * the new version waits until a safe point: the run just ended (respawn
 * after WASTED/BUSTED), the title screen went to the background, the page
 * came back after a long absence, or the player chose "restart" on the pause
 * screen. A plain app switch mid-run is not one: the run is still there to
 * resume. Pure logic; main.ts wires it to virtual:pwa-register.
 */
/** Hidden at least this long, a paused run is likely forgotten: update on return, ms. */
export const LONG_ABSENCE_MS = 10 * 60_000;

export class UpdateGate {
  private ready = false;
  private applying = false;
  /** When the page was last hidden (ms, caller's clock), or -1 while visible. */
  private hiddenAt = -1;

  constructor(
    /** Activate the waiting service worker and reload. */
    private readonly apply: () => void,
    /** Tell the UI an update is waiting (e.g. offer it on the pause screen). */
    private readonly onReady: () => void = () => {},
  ) {}

  /** A new version has been downloaded and is waiting. */
  get pending(): boolean {
    return this.ready && !this.applying;
  }

  /** The service worker reports a waiting update. */
  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.onReady();
  }

  /** The page went to the background; behind the title nothing can be lost. True if it applied. */
  pageHidden(now: number, inTitle: boolean): boolean {
    this.hiddenAt = now;
    return inTitle ? this.atSafePoint() : false;
  }

  /** The page is visible again: after a long absence, take the update. True if it applied. */
  pageShown(now: number): boolean {
    const away = this.hiddenAt < 0 ? 0 : now - this.hiddenAt;
    this.hiddenAt = -1;
    return away >= LONG_ABSENCE_MS ? this.atSafePoint() : false;
  }

  /** Reloading now would be harmless: apply a waiting update. True if it did. */
  atSafePoint(): boolean {
    if (!this.pending) return false;
    this.applying = true;
    this.apply();
    return true;
  }
}
