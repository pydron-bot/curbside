import { BUILD_ID } from '../core/build';
import { VERSION } from '../core/changelog';
import { buildBugReport, bugFileStem, bugSummary, NOTE_MAX, type BugReport, type BugState } from '../core/bugReportData';
import type { TrailEntry } from '../core/eventTrail';
import type { SceneCounts } from '../core/sceneCounts';
import { onSettingsChange, settings } from '../core/settings';
import type { FrontDoor } from './frontDoor';
import { ICONS } from './icons';
import { MenuNav, overlay, type Panel } from './menu';

/** Screenshots are scaled down to this width, px. */
export const SHOT_WIDTH = 960;
const SHOT_QUALITY = 0.8;

export interface BugReportDeps {
  /** Draw one frame and copy it, at most `maxWidth` wide; null without a GL context. */
  snapshot(maxWidth: number): HTMLCanvasElement | null;
  state(): BugState;
  /** The last moments of game events. */
  events(): TrailEntry[];
  /** The Diagnostics report's data. */
  diagnostics(): unknown;
  counts(): SceneCounts | null;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

type ShareNav = Pick<Navigator, 'share' | 'canShare'>;

/**
 * Share `files` through the system sheet. Never throws or rejects: a
 * missing API, files it won't take, the player cancelling or any other
 * failure comes back as an outcome. Call it straight from a tap (share
 * needs the user's gesture).
 */
export function shareFiles(nav: Partial<ShareNav>, files: File[], title: string, text: string): Promise<ShareOutcome> {
  try {
    if (typeof nav.share !== 'function') return Promise.resolve('unsupported');
    if (typeof nav.canShare === 'function' && !nav.canShare({ files })) return Promise.resolve('unsupported');
    return nav.share({ files, title, text }).then(
      () => 'shared' as const,
      (e: unknown) => (e instanceof Error && e.name === 'AbortError' ? ('cancelled' as const) : ('failed' as const)),
    );
  } catch {
    return Promise.resolve('failed');
  }
}

/** Download `files` (a refused or missing share sheet's fallback). Throws if the browser won't. */
export function saveFiles(files: File[]): void {
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }
}

/**
 * REPORT BUG: opened from the pause card or the Diagnostics sheet, it
 * captures the moment (a screenshot of the game, where the player is, the
 * last game events, the Diagnostics report), takes an optional note, and
 * shares a JPEG and a JSON file through the share sheet (falling back to
 * downloading them, or copying the JSON).
 */
export class BugReportSheet implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  readonly sheet = true;
  private readonly img: HTMLImageElement;
  private readonly noShot: HTMLElement;
  private readonly note: HTMLTextAreaElement;
  private readonly summaryEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly fallback: HTMLTextAreaElement;
  private readonly firstBtn: HTMLButtonElement;
  private onClose: () => void = () => {};
  private shot: Blob | null = null;
  private shotSize: { width: number; height: number } | null = null;
  private shotUrl = '';
  private captured: Omit<Parameters<typeof buildBugReport>[0], 'note' | 'screenshot'> | null = null;
  /** Bumped on each open: a slow JPEG encode from an earlier capture is dropped. */
  private generation = 0;

  constructor(
    parent: HTMLElement,
    private readonly deps: BugReportDeps,
  ) {
    const { root, card } = overlay('bug-report', 'ui-sheet');
    this.root = root;
    this.nav = new MenuNav(root);
    card.innerHTML = `
      <header class="sheet-head"><h2>REPORT BUG</h2><div class="tabs"></div></header>
      <div class="sheet-body bug" data-scroll>
        <div class="bug-shot"><img alt="Screenshot of the game" hidden><span class="bug-noshot">No screenshot</span></div>
        <div class="bug-side">
          <textarea class="bug-note" rows="3" maxlength="${NOTE_MAX}" placeholder="What went wrong? (optional)"></textarea>
          <p class="diag-status" aria-live="polite"></p>
          <textarea class="diag-fallback" readonly hidden></textarea>
          <pre class="bug-summary"></pre>
        </div>
      </div>`;
    const tabs = card.querySelector('.tabs')!;
    const button = (label: string, activate: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'tab';
      b.textContent = label;
      tabs.append(b);
      this.nav.add({ el: b, activate });
      return b;
    };
    this.firstBtn = button('SHARE', () => this.share());
    button('SAVE', () => this.save());
    button('COPY', () => this.copy());
    const close = document.createElement('button');
    close.type = 'button';
    close.tabIndex = -1;
    close.className = 'sheet-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = ICONS.close;
    card.querySelector('.sheet-head')!.append(close);
    this.nav.add({ el: close, activate: () => this.back() });
    this.img = card.querySelector('.bug-shot img')!;
    this.noShot = card.querySelector('.bug-noshot')!;
    this.note = card.querySelector('.bug-note')!;
    this.summaryEl = card.querySelector('.bug-summary')!;
    this.statusEl = card.querySelector('.diag-status')!;
    this.fallback = card.querySelector('.diag-fallback')!;
    this.nav.add({ el: this.note, activate: () => this.note.focus() });
    // Typing is not playing: keep keys away from the game's keyboard input (and Esc just leaves the box).
    for (const type of ['keydown', 'keyup'] as const) {
      this.note.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Escape') this.note.blur();
      });
    }
    this.note.addEventListener('input', () => this.refresh());
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Capture now (the frame behind the menu, the state, the events) and show the sheet. */
  open(onClose: () => void, showFocus: boolean): void {
    this.onClose = onClose;
    this.capture();
    this.statusEl.textContent = '';
    this.fallback.hidden = true;
    this.root.hidden = false;
    this.refresh();
    this.nav.focusElement(this.firstBtn);
    this.nav.showFocus(showFocus);
  }

  back(): void {
    if (this.root.hidden) return;
    this.hide();
    this.onClose();
  }

  hide(): void {
    this.root.hidden = true;
    this.note.blur();
  }

  /** The report as it stands (the note as typed). */
  report(): BugReport | null {
    if (!this.captured) return null;
    const shot = this.shot && this.shotSize ? { ...this.shotSize, bytes: this.shot.size } : null;
    return buildBugReport({ ...this.captured, note: this.note.value, screenshot: shot });
  }

  private capture(): void {
    const gen = ++this.generation;
    this.dropShot();
    const at = new Date();
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = this.deps.snapshot(SHOT_WIDTH);
    } catch {
      canvas = null;
    }
    this.captured = {
      build: BUILD_ID,
      version: VERSION,
      at,
      state: this.deps.state(),
      counts: this.deps.counts(),
      events: this.deps.events(),
      diagnostics: this.deps.diagnostics(),
    };
    if (!canvas) return;
    this.shotSize = { width: canvas.width, height: canvas.height };
    // The pixels were copied synchronously; the JPEG encodes in the background.
    canvas.toBlob(
      (blob) => {
        if (gen !== this.generation || !blob) return;
        this.shot = blob;
        this.shotUrl = URL.createObjectURL(blob);
        this.img.src = this.shotUrl;
        this.img.hidden = false;
        this.noShot.hidden = true;
        this.refresh();
      },
      'image/jpeg',
      SHOT_QUALITY,
    );
  }

  private dropShot(): void {
    if (this.shotUrl) URL.revokeObjectURL(this.shotUrl);
    this.shotUrl = '';
    this.shot = null;
    this.shotSize = null;
    this.img.hidden = true;
    this.img.removeAttribute('src');
    this.noShot.hidden = false;
  }

  private refresh(): void {
    const r = this.report();
    this.summaryEl.textContent = r ? bugSummary(r) : '';
  }

  /** The screenshot (if any) and the report, as files. */
  private files(r: BugReport, textOnly = false): File[] {
    const stem = bugFileStem(r.build, new Date(r.at));
    const json = JSON.stringify(r);
    const files: File[] = [];
    if (this.shot) files.push(new File([this.shot], `${stem}.jpg`, { type: 'image/jpeg' }));
    files.push(textOnly ? new File([json], `${stem}.txt`, { type: 'text/plain' }) : new File([json], `${stem}.json`, { type: 'application/json' }));
    return files;
  }

  private share(): void {
    const r = this.report();
    if (!r) return;
    const nav = navigator as Partial<ShareNav>;
    // Some share sheets take text files but not JSON: offer the report as .txt then.
    let files = this.files(r);
    try {
      if (typeof nav.canShare === 'function' && !nav.canShare({ files })) files = this.files(r, true);
    } catch {
      // canShare itself failing: try the JSON as it is
    }
    void shareFiles(nav, files, `Curbside bug ${r.build}`, bugSummary(r)).then((outcome) => {
      if (outcome === 'shared') this.status('Shared — thanks!');
      else if (outcome === 'cancelled') this.status('Share cancelled');
      else this.save(r);
    });
  }

  /** Download both files (the share sheet's fallback). */
  private save(r = this.report()): void {
    if (!r) return;
    try {
      saveFiles(this.files(r));
      this.status(`Saved ${this.shot ? 'the screenshot and ' : ''}the report`);
    } catch {
      this.copy(r);
    }
  }

  private copy(r = this.report()): void {
    if (!r) return;
    const text = `${bugSummary(r)}\n\n${JSON.stringify(r)}`;
    const clip = navigator.clipboard;
    const fallback = () => {
      this.fallback.value = text;
      this.fallback.hidden = false;
      this.fallback.select();
      this.status('Copy blocked — select the text below');
    };
    if (!clip?.writeText) {
      fallback();
      return;
    }
    clip.writeText(text).then(() => this.status(`Copied the report (${Math.round(text.length / 1024)} KB, no screenshot)`), fallback);
  }

  private status(msg: string): void {
    this.statusEl.textContent = msg;
  }
}

/** Is REPORT BUG offered (test tools or the perf overlay on, or ?debug)? */
export function bugReportShown(debug = new URLSearchParams(location.search).has('debug')): boolean {
  return debug || settings.testTools || settings.perfOverlay !== 'off';
}

/** REPORT BUG on the pause card while it is offered; returns the opener (the Diagnostics sheet uses it too). */
export function addBugReportButton(sheet: BugReportSheet, frontDoor: FrontDoor, showFocus: () => boolean): () => void {
  const openSheet = () => {
    frontDoor.openPanel(sheet);
    sheet.open(() => frontDoor.closePanel(sheet), showFocus());
  };
  const b = frontDoor.pause.addCornerButton('Report bug', 'bug', openSheet);
  const sync = () => (b.hidden = !bugReportShown());
  sync();
  onSettingsChange(sync);
  return openSheet;
}
