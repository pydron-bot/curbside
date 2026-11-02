import './moment.css';
import type { EventBus } from '../core/events';
import { BestMoment, momentCaption, momentFileName, type MomentCaption } from '../systems/bestMoment';
import type { StampTone } from '../systems/stamps';
import { saveFiles, shareFiles } from './bugReport';
import { ICONS } from './icons';
import { onTap } from './tap';

/** The picture is copied at most this wide, px (the share JPEG's size too). */
export const MOMENT_WIDTH = 800;
const JPEG_QUALITY = 0.85;
/** The respawn waits for the share sheet at most this long, ms (a promise that never settles mustn't hold the game). */
const HOLD_MAX = 60_000;

/** The stamp's ink (ui/stamp.css) for the caption burnt into the JPEG. */
const INK: Record<StampTone, string> = { mayhem: '#ff4d3a', hero: '#2ee6ff', law: '#7fa8ff' };

export interface MomentDeps {
  bus: EventBus;
  /** The WebGL canvas: copied right after a frame is drawn, in the same task (no preserveDrawingBuffer). */
  source: HTMLCanvasElement;
  /** The GL context is gone: nothing to copy. */
  lost: () => boolean;
  /** The game clock's hour, for the caption. */
  hour: () => number;
  /** The Diagnostics session log (what the copy and the encode cost). */
  log: (kind: string, detail: string) => void;
}

/**
 * The life's best moment (V2-16): the heaviest stamp of the life
 * (systems/bestMoment.ts) is photographed on the frame it lands, during
 * its hit-stop, and shown on WASTED / BUSTED with its caption, with SHARE
 * through the bug report's share path (a JPEG with the caption burnt in;
 * a refused or missing share sheet saves the file). Cheap: the frame is
 * copied once, after afterRender() is called following that frame's own
 * render (no extra render pass), into one small canvas reused for the
 * life; the JPEG is encoded once, on WASTED, in the background. All of
 * it is released on respawn. No stamp, no picture.
 */
export class MomentCard {
  readonly best = new BestMoment();
  /** What the last copy and encode took, ms (Diagnostics log, __ub). */
  copyMs = 0;
  encodeMs = 0;
  /** Sharing: the respawn waits (main.ts multiplies the sim's time by simScale()). */
  holding = false;
  readonly el: HTMLElement;
  private readonly pic: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly label: HTMLElement;
  private readonly line: HTMLElement;
  private readonly where: HTMLElement;
  private readonly shareBtn: HTMLButtonElement;
  private readonly shareText: HTMLElement;
  /** A photo is due on the frame being drawn. */
  private due = false;
  /** The canvas holds this life's best. */
  private shot = false;
  private blob: Blob | null = null;
  private caption: MomentCaption | null = null;
  /** Bumped on release: an encode from an earlier life is dropped. */
  private generation = 0;
  private holdTimer = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly d: MomentDeps,
  ) {
    const el = document.createElement('figure');
    el.className = 'moment';
    el.hidden = true;
    el.innerHTML = `
      <div class="moment-photo"><canvas width="0" height="0"></canvas>
        <button type="button" class="moment-share" disabled>${ICONS.share}<span>SHARE</span></button></div>
      <figcaption><b></b><span></span><small></small></figcaption>`;
    root.append(el);
    this.el = el;
    this.pic = el.querySelector('canvas')!;
    // Made now, so the first photo doesn't pay for it.
    this.ctx = this.pic.getContext('2d');
    this.label = el.querySelector('figcaption b')!;
    this.line = el.querySelector('figcaption span')!;
    this.where = el.querySelector('figcaption small')!;
    this.shareBtn = el.querySelector('.moment-share')!;
    this.shareText = this.shareBtn.querySelector('span')!;
    onTap(this.shareBtn, () => this.share());
    d.bus.on('stamp', (e) => {
      if (this.best.offer(e.id, e.x, e.z, d.hour())) this.due = true;
    });
    d.bus.on('playerDied', () => this.show());
    d.bus.on('busted', () => this.show());
    d.bus.on('respawn', () => this.release());
  }

  /** The picture of this life's best, if one was taken. */
  get picture(): HTMLCanvasElement | null {
    return this.shot ? this.pic : null;
  }

  /** The sim's time scale: 0 while the share sheet is up (WASTED waits for it). */
  simScale(): number {
    return this.holding ? 0 : 1;
  }

  /** Right after the frame's look.render(): copy it if a better stamp just landed. One branch otherwise. */
  afterRender(): void {
    if (!this.due) return;
    this.due = false;
    const src = this.d.source;
    if (this.d.lost() || src.width === 0 || src.height === 0) {
      // No picture of it: the next stamp, any weight, gets the chance.
      this.best.reset();
      return;
    }
    const t0 = performance.now();
    const k = Math.min(1, MOMENT_WIDTH / src.width);
    const w = Math.max(1, Math.round(src.width * k));
    const h = Math.max(1, Math.round(src.height * k));
    const pic = this.pic;
    if (pic.width !== w || pic.height !== h) {
      pic.width = w;
      pic.height = h;
    }
    const ctx = this.ctx;
    if (!ctx) {
      this.best.reset();
      return;
    }
    // (A resize resets the context's state.)
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    this.shot = true;
    this.copyMs = performance.now() - t0;
    this.d.log('moment', `${this.best.moment.id} ${w}×${h} copy ${this.copyMs.toFixed(1)} ms`);
  }

  /** WASTED / BUSTED: the picture and caption, and the JPEG encoding behind them. */
  private show(): void {
    if (!this.shot || !this.best.has) return;
    const c = momentCaption(this.best.moment);
    this.caption = c;
    this.label.textContent = c.label;
    this.line.textContent = c.line;
    this.where.textContent = c.where;
    this.el.dataset.tone = c.tone;
    this.label.classList.toggle('long', c.label.length > 14);
    this.shareBtn.disabled = true;
    this.shareText.textContent = 'SHARE';
    this.el.hidden = false;
    this.root.classList.add('has-moment');
    this.encode(c);
  }

  /** The JPEG to share: the picture with its caption burnt in, encoded off the main thread where the browser can. */
  private encode(c: MomentCaption): void {
    const gen = this.generation;
    const t0 = performance.now();
    const out = composeMoment(this.pic, c);
    if (!out) return;
    out.toBlob(
      (blob) => {
        // Let the composed copy go; only the JPEG is kept.
        out.width = out.height = 0;
        if (gen !== this.generation || !blob) return;
        this.blob = blob;
        this.encodeMs = performance.now() - t0;
        this.d.log('moment', `jpeg ${Math.round(blob.size / 1024)} KB in ${this.encodeMs.toFixed(0)} ms`);
        this.shareBtn.disabled = false;
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  }

  /** Straight from the tap (the share sheet needs the gesture); the respawn waits until it's settled. */
  private share(): void {
    const c = this.caption;
    if (!this.blob || !c || this.holding) return;
    const file = new File([this.blob], momentFileName(this.best.moment.id, new Date()), { type: 'image/jpeg' });
    const gen = this.generation;
    this.hold(true);
    void shareFiles(navigator, [file], 'Curbside', c.text).then((outcome) => {
      if (gen !== this.generation) return;
      this.hold(false);
      if (outcome === 'shared') this.shareText.textContent = 'SHARED';
      else if (outcome === 'cancelled') this.shareText.textContent = 'SHARE';
      else {
        try {
          saveFiles([file]);
          this.shareText.textContent = 'SAVED';
        } catch {
          this.shareText.textContent = 'NO SHARE';
        }
      }
    });
  }

  private hold(on: boolean): void {
    this.holding = on;
    this.root.classList.toggle('moment-hold', on);
    window.clearTimeout(this.holdTimer);
    if (on) this.holdTimer = window.setTimeout(() => this.hold(false), HOLD_MAX);
  }

  /** A new life: the picture, its JPEG and the card go. */
  private release(): void {
    this.generation++;
    this.best.reset();
    this.due = false;
    this.shot = false;
    this.blob = null;
    this.caption = null;
    this.hold(false);
    // A zero-size canvas gives its pixels back.
    this.pic.width = this.pic.height = 0;
    this.el.hidden = true;
    this.root.classList.remove('has-moment');
  }
}

/** The shared picture: the photo with a dark band at the foot and the stamp's name, line and where on it. */
function composeMoment(pic: HTMLCanvasElement, c: MomentCaption): HTMLCanvasElement | null {
  const w = pic.width;
  const h = pic.height;
  if (w === 0 || h === 0) return null;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d');
  if (!g) return null;
  g.drawImage(pic, 0, 0);
  const band = g.createLinearGradient(0, h * 0.45, 0, h);
  band.addColorStop(0, 'rgba(0,0,0,0)');
  band.addColorStop(1, 'rgba(0,0,0,0.82)');
  g.fillStyle = band;
  g.fillRect(0, h * 0.45, w, h * 0.55);
  const pad = Math.round(h * 0.05);
  const small = Math.max(10, Math.round(h * 0.042));
  // The name as big as fits.
  let size = Math.round(h * 0.12);
  const display = (px: number) => `italic 900 ${px}px 'Arial Black', 'Avenir Next Condensed', 'Helvetica Neue', Impact, sans-serif`;
  g.font = display(size);
  const room = w - pad * 2;
  const wide = g.measureText(c.label).width;
  if (wide > room) {
    size = Math.floor((size * room) / wide);
    g.font = display(size);
  }
  // Stacked from the foot: where and when, the line, the name.
  const whereY = h - pad;
  const lineY = whereY - small * 1.55;
  const labelY = lineY - small * 1.6;
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2, size * 0.08);
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.strokeText(c.label, pad, labelY);
  g.fillStyle = INK[c.tone];
  g.fillText(c.label, pad, labelY);
  const hud = (px: number) => `800 ${px}px 'Avenir Next', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif`;
  g.font = hud(Math.round(small * 1.25));
  g.fillStyle = '#ffffff';
  g.fillText(c.line, pad, lineY);
  g.font = hud(small);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillText(`${c.where} · CURBSIDE`, pad, whereY);
  return out;
}
