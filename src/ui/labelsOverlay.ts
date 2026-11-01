/**
 * Playtest labels (settings.debugLabels; Shift+L toggles it): short text
 * over the people and cars round the player doing something notable
 * ("MEDIC", "CHASE: SUSPECT (car)", "QUEUE 3"), from game/debugLabels.ts.
 *
 * One layer of DOM over the canvas with a fixed pool of MAX_LABELS
 * elements: the labels are collected and their text written at ~5 Hz (and
 * only when it changed); every frame each is projected through the camera
 * and moved by transform alone. The transforms come from per-pixel string
 * caches, so steady play allocates nothing; nothing is read back from the
 * DOM. Off, the layer is hidden and update() returns at once.
 */
import './labels.css';
import { Vector3, type Camera } from 'three';
import { onSettingsChange, settings, updateSettings } from '../core/settings';
import { LABEL_CAR, LABEL_PED, LABEL_RANGE, LabelBoard, MAX_LABELS, type LabelCat, type LabelKind, type LabelSpot } from '../game/debugLabels';
import type { CrowdPed, Vehicle } from '../game/population';
import type { Rect } from '../world/city';

/** Labels are collected and their text refreshed this often, s. */
const REFRESH = 0.2;
/** Heights the labels hang at over a person's feet, a car's base, a spot on the ground, m. */
const PED_UP = 2.05;
const CAR_UP = 2.3;
const SPOT_UP = 1.1;
/** Kept on screen this far past its edges before hiding, px (a label's anchor is its bottom middle). */
const EDGE = 40;
/** A label's height and its width per character (10.5 px type) plus padding, px: estimates, so nothing is measured. */
const ROW = 15;
const CHAR_W = 6.3;
const PAD_W = 12;
/** Cached transforms cover -OFF..LIMIT px. */
const OFF = 128;
const LIMIT = 4096;

const TX: string[] = [];
const TY: string[] = [];
function tx(px: number): string {
  return (TX[px + OFF] ??= `translate3d(${px}px,0,0)`);
}
function ty(px: number): string {
  return (TY[px + OFF] ??= `translateY(${px}px)`);
}

export interface LabelsDeps {
  camera(): Camera;
  /** The player (labels within LABEL_RANGE of here). */
  focus(): { x: number; z: number };
  /** The ground in view, written into `out`. */
  view(out: Rect): Rect;
  /** Fill the board: the scenes' describe(), then describeWorld(). */
  collect(board: LabelBoard): void;
}

interface Slot {
  readonly el: HTMLElement;
  readonly row: HTMLElement;
  readonly pill: HTMLElement;
  kind: LabelKind;
  target: CrowdPed | Vehicle | LabelSpot | null;
  text: string;
  cat: LabelCat | null;
  colour: string | null;
  /** Half its estimated width, px. */
  half: number;
  /** Where it's anchored this frame, and where it's drawn (stepped up clear of nearer ones), px. */
  ax: number;
  ay: number;
  x: number;
  y: number;
  shown: boolean;
}

/** What one label shows (__ub.labels.list()). */
export interface LabelInfo {
  text: string;
  cat: LabelCat;
  /** Distance from the player when collected, m. */
  d: number;
  shown: boolean;
}

/** JS time the labels took, ms (__ub.labels.stats()). */
export interface LabelStats {
  frames: number;
  /** Per-frame update (projection, and the refresh on its frames): total and worst. */
  total: number;
  max: number;
  /** The ~5 Hz refreshes alone (collect, sort, text). */
  refreshes: number;
  refreshTotal: number;
  refreshMax: number;
}

/** Switch the labels on or off (or flip them); returns the new state. Saved like any setting. */
export function toggleLabels(on = !settings.debugLabels): boolean {
  if (on !== settings.debugLabels) updateSettings({ debugLabels: on });
  return on;
}

export class LabelsOverlay {
  readonly board = new LabelBoard();
  readonly stats: LabelStats = { frames: 0, total: 0, max: 0, refreshes: 0, refreshTotal: 0, refreshMax: 0 };
  private readonly layer: HTMLElement;
  private readonly slots: Slot[] = [];
  private n = 0;
  private timer = 0;
  private on = false;
  private readonly p = new Vector3();
  private readonly viewRect: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

  constructor(
    parent: HTMLElement,
    private readonly d: LabelsDeps,
  ) {
    const layer = document.createElement('div');
    layer.id = 'labels';
    layer.hidden = true;
    for (let i = 0; i < MAX_LABELS; i++) {
      const el = document.createElement('div');
      el.className = 'lbl';
      el.hidden = true;
      const row = document.createElement('div');
      const pill = document.createElement('span');
      row.append(pill);
      el.append(row);
      layer.append(el);
      this.slots.push({ el, row, pill, kind: LABEL_PED, target: null, text: '', cat: null, colour: null, half: 0, ax: 0, ay: 0, x: NaN, y: NaN, shown: false });
    }
    parent.append(layer);
    this.layer = layer;
    this.enabled = settings.debugLabels;
    onSettingsChange((s) => (this.enabled = s.debugLabels));
  }

  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.layer.hidden = !on;
    this.timer = 0;
    if (!on) this.clear();
  }

  /** Shift+L flips the labels (L is free in every input mapping; Shift alone sprints, harmlessly). */
  bindKey(target: Window): void {
    target.addEventListener('keydown', (e) => {
      if (e.code === 'KeyL' && e.shiftKey && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) toggleLabels();
    });
  }

  /** Every frame, after the render (the camera's matrices are this frame's): `w`×`h` px; `active` false (the title) hides them. */
  update(dt: number, w: number, h: number, active: boolean): void {
    if (!this.on) return;
    if (!active) {
      if (this.n > 0) this.clear();
      return;
    }
    const t0 = performance.now();
    if ((this.timer -= dt) <= 0) {
      this.timer = REFRESH;
      this.refresh();
      const r = performance.now() - t0;
      const st = this.stats;
      st.refreshes++;
      st.refreshTotal += r;
      if (r > st.refreshMax) st.refreshMax = r;
    }
    const cam = this.d.camera();
    const p = this.p;
    for (let i = 0; i < this.n; i++) {
      const s = this.slots[i];
      let visible = true;
      if (s.kind === LABEL_PED) {
        const root = (s.target as CrowdPed).model.root;
        visible = root.visible;
        p.set(root.position.x, PED_UP, root.position.z);
      } else if (s.kind === LABEL_CAR) {
        const root = (s.target as Vehicle).mesh.root;
        visible = root.visible;
        p.set(root.position.x, root.position.y + CAR_UP, root.position.z);
      } else {
        const at = s.target as LabelSpot;
        visible = at.alive !== false;
        p.set(at.x, SPOT_UP, at.z);
      }
      if (visible) {
        p.project(cam);
        s.ax = Math.round((p.x + 1) * 0.5 * w);
        s.ay = Math.round((1 - p.y) * 0.5 * h);
        visible = p.z < 1 && s.ax > -EDGE && s.ax < w + EDGE && s.ay > -EDGE && s.ay < h + EDGE && s.ax < LIMIT && s.ay < LIMIT;
      }
      if (visible) this.unstack(i);
      if (visible !== s.shown) {
        s.shown = visible;
        s.el.hidden = !visible;
      }
      if (!visible) continue;
      if (s.ax !== s.x) {
        s.x = s.ax;
        s.el.style.transform = tx(s.ax);
      }
      if (s.ay !== s.y) {
        s.y = s.ay;
        s.row.style.transform = ty(s.ay);
      }
    }
    const t = performance.now() - t0;
    const st = this.stats;
    st.frames++;
    st.total += t;
    if (t > st.max) st.max = t;
  }

  /**
   * Label `i` steps up (s.ay) until it clears every nearer one already
   * placed this frame (they're nearest first), so a crowd's labels stack
   * instead of piling up. A few steps at most.
   */
  private unstack(i: number): void {
    const s = this.slots[i];
    for (let tries = 0; tries < 6; tries++) {
      let moved = false;
      for (let j = 0; j < i; j++) {
        const o = this.slots[j];
        if (!o.shown || Math.abs(s.ax - o.x) >= s.half + o.half || Math.abs(s.ay - o.y) >= ROW) continue;
        s.ay = o.y - ROW;
        moved = true;
      }
      if (!moved) return;
    }
  }

  /** The labels up now, nearest first (debug: allocates). */
  list(): LabelInfo[] {
    const out: LabelInfo[] = [];
    for (let i = 0; i < this.n; i++) {
      const s = this.slots[i];
      out.push({ text: s.text, cat: s.cat!, d: Math.round(Math.sqrt(this.board.list[i].d2) * 10) / 10, shown: s.shown });
    }
    return out;
  }

  resetStats(): void {
    const st = this.stats;
    st.frames = st.total = st.max = st.refreshes = st.refreshTotal = st.refreshMax = 0;
  }

  /** Collect and sort the labels; write each slot's text, category and colour where they changed. */
  private refresh(): void {
    const at = this.d.focus();
    const board = this.board;
    board.begin(at.x, at.z, LABEL_RANGE, this.d.view(this.viewRect));
    this.d.collect(board);
    const n = board.finish(MAX_LABELS);
    for (let i = 0; i < n; i++) {
      const r = board.list[i];
      const s = this.slots[i];
      s.kind = r.kind;
      s.target = r.target;
      if (r.text !== s.text) {
        s.text = r.text;
        s.half = (r.text.length * CHAR_W + PAD_W) / 2;
        s.pill.textContent = r.text;
      }
      if (r.cat !== s.cat) {
        s.cat = r.cat;
        s.pill.className = `lbl-${r.cat}`;
      }
      if (r.colour !== s.colour) {
        s.colour = r.colour;
        if (r.colour) s.pill.style.setProperty('--c', r.colour);
        else s.pill.style.removeProperty('--c');
      }
    }
    for (let i = n; i < this.n; i++) this.hide(this.slots[i]);
    this.n = n;
  }

  private hide(s: Slot): void {
    s.target = null;
    if (!s.shown) return;
    s.shown = false;
    s.el.hidden = true;
  }

  private clear(): void {
    for (let i = 0; i < this.n; i++) this.hide(this.slots[i]);
    this.n = 0;
  }
}
