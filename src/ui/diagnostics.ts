import { BUILD_ID } from '../core/build';
import { emptySummary, type FrameSummary } from '../core/frameStats';
import { loadPreviousLog, SAMPLE_EVERY_MS, SessionLog, type KeyValueStore, type SessionLogData } from '../core/sessionLog';
import { onSettingsChange, settings } from '../core/settings';
import { getQuality } from '../render/quality';
import type { FrontDoor } from './frontDoor';
import type { Haptics } from './haptics';
import { ICONS } from './icons';
import { DestructionProbe, destructionSummary, type DestructionProbeDeps } from './destructionProbe';
import { InputProbes } from './inputProbes';
import { MenuNav, overlay, type Panel } from './menu';
import { safeInsets } from './safeArea';

/** The play-log stream's key (it owns writing it); read raw for the report. */
const PLAYLOG_KEY = 'curbside.playlog';
/** Tier / ratio / audio are polled this often (off the game loop), ms. */
const POLL_MS = 1000;

export interface DiagnosticsDeps {
  /** Fills and returns the summary passed in. */
  frame: (out: FrameSummary) => FrameSummary;
  ratio: () => number;
  drawCalls: () => number;
  audioState: () => string;
  paused: () => boolean;
  canvas: HTMLCanvasElement;
  /** For the on-device haptic / rumble / pad probes. */
  haptics?: Haptics;
  /** The destruction test's switch, BLOW A WALL and readout. */
  destruction?: DestructionProbeDeps;
}

/** Rapier's files as loaded (Resource Timing): did Pages gzip the wasm, did it come from cache? */
function rapierFiles(): Array<{ file: string; transfer: number; encoded: number; decoded: number; ms: number }> {
  try {
    return (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((e) => /rapier/i.test(e.name))
      .map((e) => ({
        file: e.name.split('/').pop()!.split('?')[0],
        transfer: e.transferSize,
        encoded: e.encodedBodySize,
        decoded: e.decodedBodySize,
        ms: Math.round(e.duration),
      }));
  } catch {
    return [];
  }
}

function storage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // blocked storage throws on access
  }
}

function standalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches);
}

/**
 * Records the session (SessionLog) and shows it on a Diagnostics sheet with
 * SHARE / COPY, for device tests without a desktop console. Samples on a
 * timer, not in the game loop.
 */
export class Diagnostics implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  readonly sheet = true;
  readonly log = new SessionLog(performance.now());
  private readonly previous: SessionLogData | null;
  private readonly summaryEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly fallback: HTMLTextAreaElement;
  private readonly firstBtn: HTMLButtonElement;
  private readonly probes: InputProbes | null = null;
  private readonly destruction: DestructionProbe | null = null;
  private readonly frameOut = emptySummary();
  private onClose: () => void = () => {};
  private tier = '';
  private ratio = 0;
  private audio = '';

  constructor(
    parent: HTMLElement,
    private readonly deps: DiagnosticsDeps,
  ) {
    this.previous = loadPreviousLog(storage());
    const { root, card } = overlay('diagnostics', 'ui-sheet');
    this.root = root;
    this.nav = new MenuNav(root);
    card.innerHTML = `
      <header class="sheet-head"><h2>DIAGNOSTICS</h2><div class="tabs"></div></header>
      <div class="sheet-body diag" data-scroll>
        <p class="diag-status" aria-live="polite"></p>
        <textarea class="diag-fallback" readonly hidden></textarea>
        <pre class="diag-summary"></pre>
      </div>`;
    const head = card.querySelector('.sheet-head')!;
    const tabs = card.querySelector('.tabs')!;
    const button = (label: string, activate: () => void, cls = 'tab') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = cls;
      b.textContent = label;
      tabs.append(b);
      this.nav.add({ el: b, activate });
      return b;
    };
    this.firstBtn = button('SHARE', () => this.share());
    button('COPY', () => this.copy());
    const close = document.createElement('button');
    close.type = 'button';
    close.tabIndex = -1;
    close.className = 'sheet-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = ICONS.close;
    head.append(close);
    this.nav.add({ el: close, activate: () => this.back() });
    this.summaryEl = card.querySelector('.diag-summary')!;
    this.statusEl = card.querySelector('.diag-status')!;
    this.fallback = card.querySelector('.diag-fallback')!;
    // The destruction test first: its pads fit unscrolled at 852x340.
    if (deps.destruction) {
      this.destruction = new DestructionProbe(deps.destruction, this.nav);
      this.summaryEl.before(this.destruction.el);
    }
    if (deps.haptics) {
      this.probes = new InputProbes(deps.haptics, this.nav);
      this.summaryEl.before(this.probes.el);
    }
    parent.append(root);

    this.log.addEvent(performance.now(), 'boot', BUILD_ID);
    if (this.previous) this.log.addEvent(performance.now(), 'previous-log', `${this.previous.samples.length} samples from ${this.previous.started}`);
    window.setInterval(() => this.poll(), POLL_MS);
    deps.canvas.addEventListener('webglcontextlost', () => this.mark('contextlost'));
    deps.canvas.addEventListener('webglcontextrestored', () => this.mark('contextrestored'));
    document.addEventListener('visibilitychange', () => {
      this.mark('visibility', document.visibilityState);
      if (document.visibilityState === 'hidden') this.log.persist(performance.now(), storage(), true);
    });
    window.addEventListener('pagehide', () => {
      this.mark('pagehide');
      this.log.persist(performance.now(), storage(), true);
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(onClose: () => void, showFocus: boolean): void {
    this.onClose = onClose;
    this.statusEl.textContent = '';
    this.fallback.hidden = true;
    this.refresh();
    this.probes?.start();
    this.destruction?.start();
    this.root.hidden = false;
    // The destruction test's mode pads first while it is on the sheet (the header's buttons are up from there).
    this.nav.focusElement(this.destruction?.current ?? this.firstBtn);
    this.nav.showFocus(showFocus);
  }

  back(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.probes?.stop();
    this.destruction?.stop();
    this.onClose();
  }

  hide(): void {
    this.root.hidden = true;
    this.probes?.stop();
    this.destruction?.stop();
  }

  /** The whole report: a few readable lines, then JSON with the session log and the play log. */
  report(): string {
    const now = performance.now();
    const f = this.deps.frame(this.frameOut);
    const s = safeInsets();
    let playlog: unknown = null;
    try {
      const raw = storage()?.getItem(PLAYLOG_KEY) ?? null;
      if (raw !== null) {
        try {
          playlog = JSON.parse(raw);
        } catch {
          playlog = raw;
        }
      }
    } catch {
      playlog = 'unreadable';
    }
    const data = {
      build: BUILD_ID,
      generated: new Date().toISOString(),
      uptime: this.log.seconds(now),
      ua: navigator.userAgent,
      standalone: standalone(),
      screen: `${screen.width}x${screen.height}`,
      inner: `${innerWidth}x${innerHeight}`,
      dpr: devicePixelRatio,
      safe: { top: s.top, right: s.right, bottom: s.bottom, left: s.left },
      tier: getQuality().name,
      ratio: this.deps.ratio(),
      drawCalls: this.deps.drawCalls(),
      audioState: this.deps.audioState(),
      settings: { ...settings },
      frame: { ...f },
      destruction: this.deps.destruction?.stats() ?? null,
      rapierFiles: rapierFiles(),
      session: this.log.data(),
      previous: this.previous,
      playlog,
    };
    return `${this.summaryText(f)}\n\n${JSON.stringify(data)}`;
  }

  private summaryText(f: FrameSummary): string {
    const s = safeInsets();
    const d = this.log.data();
    return [
      `CURBSIDE DIAGNOSTICS`,
      `BUILD ${BUILD_ID}`,
      `UA ${navigator.userAgent}`,
      `SCREEN ${screen.width}x${screen.height} · inner ${innerWidth}x${innerHeight} · dpr ${devicePixelRatio}`,
      `SAFE t${s.top} r${s.right} b${s.bottom} l${s.left} · ${standalone() ? 'home-screen app' : 'browser tab'}`,
      `TIER ${getQuality().name} @ ${this.deps.ratio().toFixed(2)}x · ${this.deps.drawCalls()} dc · audio ${this.deps.audioState()}`,
      ...(this.deps.destruction ? [destructionSummary(this.deps.destruction.stats())] : []),
      `FRAMES ${f.fps.toFixed(1)} fps · p50 ${f.p50.toFixed(1)} p95 ${f.p95.toFixed(1)} p99 ${f.p99.toFixed(1)} ms · js p95 ${f.jsP95.toFixed(1)} · ${f.hitchesPerMin.toFixed(1)} hitch/min`,
      `SESSION ${this.log.seconds(performance.now()).toFixed(0)} s · ${d.samples.length} samples (every ${SAMPLE_EVERY_MS / 1000} s) · ${this.log.eventCount} events`,
      `PREVIOUS ${this.previous ? `${this.previous.samples.length} samples from ${this.previous.started}` : 'none'}`,
    ].join('\n');
  }

  private refresh(): void {
    const f = this.deps.frame(this.frameOut);
    const tail = this.log
      .data()
      .events.slice(-8)
      .map((e) => `${e.t.toFixed(0).padStart(5)} s  ${e.kind}${e.detail ? ` ${e.detail}` : ''}`);
    this.summaryEl.textContent = `${this.summaryText(f)}\n\nRECENT EVENTS\n${tail.join('\n')}`;
  }

  private share(): void {
    const text = this.report();
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share !== 'function') {
      this.copy(text);
      return;
    }
    // Called straight from the click: share needs the user's gesture.
    nav.share({ title: `Curbside diagnostics ${BUILD_ID}`, text }).then(
      () => this.status('Shared'),
      (e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') this.status('Share cancelled');
        else this.copy(text);
      },
    );
  }

  private copy(text = this.report()): void {
    const clip = navigator.clipboard;
    if (!clip?.writeText) {
      this.showFallback(text);
      return;
    }
    clip.writeText(text).then(
      () => this.status(`Copied (${Math.round(text.length / 1024)} KB)`),
      () => this.showFallback(text),
    );
  }

  /** Clipboard refused: a selectable box to copy by hand. */
  private showFallback(text: string): void {
    this.fallback.value = text;
    this.fallback.hidden = false;
    this.fallback.select();
    this.status('Copy blocked — select the text below');
  }

  private status(msg: string): void {
    this.statusEl.textContent = msg;
  }

  private mark(kind: string, detail?: string): void {
    this.log.addEvent(performance.now(), kind, detail);
  }

  /** Once a second: note tier / ratio / audio changes, sample every 10 s, persist (throttled). */
  private poll(): void {
    const now = performance.now();
    const tier = getQuality().name;
    const ratio = this.deps.ratio();
    if (tier !== this.tier || ratio !== this.ratio) {
      this.mark('quality', `${tier} @ ${ratio.toFixed(2)}x`);
      this.tier = tier;
      this.ratio = ratio;
    }
    const audio = this.deps.audioState();
    if (audio !== this.audio) {
      this.mark('audio', audio);
      this.audio = audio;
    }
    if (this.log.due(now)) {
      const f = this.deps.frame(this.frameOut);
      const d = this.deps.destruction?.stats();
      this.log.addSample(now, {
        fps: f.fps,
        p50: f.p50,
        p95: f.p95,
        p99: f.p99,
        jsP95: f.jsP95,
        hitches: f.hitchesPerMin,
        tier,
        ratio,
        dc: this.deps.drawCalls(),
        audioState: audio,
        paused: this.deps.paused(),
        ...(d && d.mode !== 'off' ? { rubble: d.live, physP95: d.stepP95 } : {}),
      });
    }
    this.log.persist(now, storage());
    if (this.isOpen) this.refresh();
  }
}

/** DIAGNOSTICS on the pause card while the Perf overlay is on (or ?debug). */
export function addDiagnosticsButton(diag: Diagnostics, frontDoor: FrontDoor, showFocus: () => boolean): void {
  const b = frontDoor.pause.addButton('DIAGNOSTICS', 'chevron', () => {
    frontDoor.openPanel(diag);
    diag.open(() => frontDoor.closePanel(diag), showFocus());
  });
  const debug = new URLSearchParams(location.search).has('debug');
  const sync = () => (b.hidden = !debug && settings.perfOverlay === 'off');
  sync();
  onSettingsChange(sync);
}
