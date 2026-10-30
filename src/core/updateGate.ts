/**
 * Holds a downloaded app update until reloading can't cost the player
 * anything. vite-plugin-pwa's autoUpdate mode reloaded the page as soon as
 * a new service worker took over, wiping whatever run was in progress; now
 * the new version waits until a safe point: the run just ended (respawn),
 * the page went to the background, or the player chose "restart" on the
 * pause screen. Pure logic; main.ts wires it to virtual:pwa-register.
 */
export class UpdateGate {
  private ready = false;
  private applying = false;

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

  /** Reloading now would be harmless: apply a waiting update. True if it did. */
  atSafePoint(): boolean {
    if (!this.pending) return false;
    this.applying = true;
    this.apply();
    return true;
  }
}
