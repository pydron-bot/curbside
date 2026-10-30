/** The bits of the Screen Wake Lock API used here (fakeable in tests). */
export interface WakeSentinel {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}
export interface WakeHost {
  wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> };
}
export interface WakeDoc {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
}

/**
 * Keeps the screen on while a run is being played: a controller-only session
 * never touches the screen, and iOS Auto-Lock would dim and lock it (which
 * hides the page and pauses the game). Feature-detected; any request can be
 * refused (low battery, older iOS home-screen apps), which just means the
 * screen may sleep as before. Held only while wanted, never on menus.
 */
export class ScreenAwake {
  readonly supported: boolean;
  /** The last refusal, for diagnostics (null once a request succeeds). */
  lastError: string | null = null;
  private want = false;
  private sentinel: WakeSentinel | null = null;
  private requesting = false;

  constructor(
    private readonly host: WakeHost = navigator as WakeHost,
    private readonly doc: WakeDoc = document,
  ) {
    this.supported = !!host.wakeLock;
    // The browser lets go whenever the page is hidden: take it again on return.
    if (this.supported) doc.addEventListener('visibilitychange', () => this.sync());
  }

  get active(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  set(want: boolean): void {
    if (want === this.want) return;
    this.want = want;
    this.sync();
  }

  private sync(): void {
    if (!this.supported) return;
    if (this.want && this.doc.visibilityState === 'visible') void this.acquire();
    else this.drop();
  }

  private async acquire(): Promise<void> {
    // One request in flight and one sentinel at most, however fast set() toggles.
    if (this.sentinel || this.requesting) return;
    this.requesting = true;
    try {
      const s = await this.host.wakeLock!.request('screen');
      this.lastError = null;
      if (!this.want || this.doc.visibilityState !== 'visible') {
        // Unwanted (paused, hidden) while the request was out.
        s.release().catch(() => {});
        return;
      }
      this.sentinel = s;
      s.addEventListener('release', () => {
        if (this.sentinel !== s) return; // ours, from drop()
        this.sentinel = null;
        this.sync(); // the system let go: ask again if still wanted
      });
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      this.requesting = false;
    }
  }

  private drop(): void {
    const s = this.sentinel;
    if (!s) return;
    this.sentinel = null;
    try {
      s.release().catch(() => {});
    } catch {
      // Already gone.
    }
  }
}
