/**
 * TEST → MAP → MAP EDITOR (W3-D, desktop): the whole city drawn top-down on
 * a canvas, the owner's map edits on it, and what relies on whatever is
 * selected. Pan by dragging (or the arrow keys), zoom with the wheel, click
 * to select a block, road, crossing, spot or street prop; the side panel
 * edits it, lists what relies on it and every problem the edits make.
 * Undo / redo, local edits saved as you go (LOCAL_MAP_KEY), the CHANGES
 * against the shipped file with REVERT, EXPORT (the file to commit) and
 * VIEW IN 3D (reloads the game on the local edits, `?map=local`).
 *
 * The logic is game/mapEditorState.ts; this draws and wires it. Nothing
 * runs while it's closed: its listeners come and go with it.
 */
import type { GameAudio } from '../audio/gameAudio';
import { dependentsOf, type Anchor } from '../game/mapAnchors';
import {
  EditHistory,
  GROUP_STYLE,
  LABELS_FROM_SCALE,
  PLACEABLE_PROPS,
  PROPS_FROM_SCALE,
  anchorPlace,
  baseBlocks,
  blockEditAt,
  blockIndex,
  buildPreview,
  compass,
  describeBlock,
  describeChange,
  editBlock,
  fitView,
  flipRoad,
  moveAddedProp,
  moveSpot,
  nodePoint,
  panBy,
  picksAt,
  nextPick,
  placeProp,
  placeSpot,
  PLACEABLE_SPOTS,
  removeProp,
  removeSpot,
  rerollBlock,
  resetSpot,
  restoreProp,
  roadState,
  routeLine,
  sameSelection,
  selectionCentre,
  selectionPick,
  setRoad,
  spotEdited,
  spotRule,
  toScreen,
  toWorld,
  turnSpot,
  zoomAt,
  type BlockBase,
  type EditorProblem,
  type MapView,
  type Point,
  type Preview,
  type PreviewInputs,
  type RoadMode,
  type Selection,
  restoreGameMap,
  anchorShown,
} from '../game/mapEditorState';
import { BLOCK_SIZE, CORE_OFFSET, SIDEWALK, WORLD_LIMIT } from '../world/city';
import { DISTRICTS, DISTRICT_NAMES, type District } from '../world/districts';
import {
  BLOCK_EDIT_KINDS,
  HEIGHT_SCALE_MAX,
  HEIGHT_SCALE_MIN,
  PROP_MATCH,
  diffMapEdits,
  revertChange,
  serializeMapEdits,
  type MapEditChange,
  type MapEdits,
} from '../world/mapEdits';
import { LOCAL_MAP_KEY, loadLocalMap, previewingLocalMap } from '../world/shippedMap';
import type { StreetPropKind } from '../world/streetProps';
import type { AddedSpotKind } from '../world/mapEdits';
import { removeRefusal } from '../game/mapEditorState';
import { roadKey, type RoadEdit } from '../world/mapEdits';
import { DISTRICT_HUE } from './cityMap';
import { ICONS } from './icons';
import { MenuNav, type Panel } from './menu';
import './mapEditor.css';

/** Edits settle this long before the city is rebuilt (a slider drag is many edits), ms. */
const REBUILD_MS = 90;
/** A press that moves less than this is a click, px. */
const CLICK_SLOP = 4;
/** Dark ground beyond the walls, m. */
const MARGIN = 40;
const EXTENT = WORLD_LIMIT + MARGIN;
/** A destructive button's first press arms it for this long, ms. */
const CONFIRM_MS = 3000;
const TOAST_MS = 3200;
const QUARTER = Math.PI / 2;

const KIND_LABEL: Readonly<Record<string, string>> = { buildings: 'BUILDINGS', park: 'PARK', plaza: 'PLAZA', carpark: 'CAR PARK', lot: 'EMPTY LOT' };

export interface MapEditorDeps {
  audio: GameAudio;
  /** The committed file (CHANGES and REVERT are against it). */
  shipped: MapEdits;
  /** The map the running game shows (as built, or as the live rebuild left it): its district repaints and road rules are put back after every preview. */
  readonly gameMap: MapEdits;
  /** Pickups and ramps, as the game placed them (the dressing keeps clear of them). */
  inputs: PreviewInputs;
  /** Load this URL (PLAY ON EDITS, SHIPPED MAP): the save is flushed first. */
  navigate(url: string): void;
  /** VIEW IN 3D: rebuild the running city on these edits and look at `at` (the editor has closed). */
  viewLive(edits: MapEdits, at: Point): void;
}

type Drag =
  | { mode: 'pan'; id: number; x: number; y: number; moved: boolean }
  | { mode: 'move'; id: number; x: number; y: number; moved: boolean; at: Point };

export class MapEditor implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  readonly sheet = true;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly side: HTMLElement;
  private readonly selEl: HTMLElement;
  private readonly depsEl: HTMLElement;
  private readonly problemsEl: HTMLElement;
  private readonly changesEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly exportEl: HTMLTextAreaElement;
  private readonly placeEl: HTMLSelectElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private history: EditHistory | null = null;
  private preview: Preview | null = null;
  private base: BlockBase[] = [];
  private selection: Selection | null = null;
  /** Edits being made (a slider mid-drag): previewed, not yet an undo step. */
  private pending: MapEdits | null = null;
  /** What PLACE puts down: a street prop kind, or a spot (`spot:<kind>[:<gang>]`). */
  private placing: string | null = null;
  private drag: Drag | null = null;
  private hover: Point | null = null;
  /** Where the last click landed, world m (a click again there steps through the stack). */
  private lastClick: Point | null = null;
  private readonly view: MapView = { cx: 0, cz: 0, scale: 1, width: 1, height: 1 };
  private fitted = false;
  private dpr = 1;
  private redrawQueued = false;
  private rebuildTimer = 0;
  private toastTimer = 0;
  private armed: HTMLElement | null = null;
  private armTimer = 0;
  private onClose: () => void = () => {};
  private readonly listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions | boolean]> = [];

  constructor(
    parent: HTMLElement,
    private readonly d: MapEditorDeps,
  ) {
    const root = document.createElement('div');
    root.id = 'mapeditor';
    root.hidden = true;
    this.root = root;
    this.nav = new MenuNav(root);
    const local = previewingLocalMap();
    root.innerHTML = `
      <header class="me-head">
        <h2>MAP EDITOR</h2>
        ${local ? '<span class="me-badge">PLAYING YOUR LOCAL EDITS</span>' : ''}
        <div class="me-bar">
          <button type="button" class="me-btn" data-act="undo" title="Undo (Ctrl+Z)">UNDO</button>
          <button type="button" class="me-btn" data-act="redo" title="Redo (Ctrl+Shift+Z)">REDO</button>
          <label class="me-place" title="Pick a spot or a street prop, then click the map to place it (Esc stops)">PLACE
            <select><option value="">—</option><optgroup label="SPOTS">${PLACEABLE_SPOTS.map((k) => `<option value="${placeValue(k)}">${k.label}</option>`).join('')}</optgroup><optgroup label="STREET PROPS">${PLACEABLE_PROPS.map((k) => `<option value="${k}">${k.replace(/_/g, ' ').toUpperCase()}</option>`).join('')}</optgroup></select>
          </label>
          <button type="button" class="me-btn" data-act="export" title="Download city.json and copy it">EXPORT</button>
          <button type="button" class="me-btn hot" data-act="view3d" title="Rebuild the city on your edits and look at the selection in observe mode (no reload)">VIEW IN 3D</button>
          <button type="button" class="me-btn" data-act="play" title="Reload the game on your local edits, to play on them">PLAY ON EDITS</button>
          ${local ? '<button type="button" class="me-btn" data-act="shipped" title="Reload the game on the shipped map">SHIPPED MAP</button>' : ''}
        </div>
        <button type="button" class="sheet-close" aria-label="Close">${ICONS.close}</button>
      </header>
      <div class="me-main">
        <div class="me-mapwrap">
          <canvas></canvas>
          <div class="me-status"></div>
          <div class="me-legend">${Object.values(GROUP_STYLE)
            .map((g) => `<span><i style="background:${g.color}">${g.letter}</i>${g.name}</span>`)
            .join('')}<span><i class="me-red"></i>Problem</span><span><i class="me-dep"></i>Relies on selection</span></div>
        </div>
        <aside class="me-side">
          <section class="me-sec me-sel"></section>
          <section class="me-sec me-deps"></section>
          <section class="me-sec me-problems"></section>
          <section class="me-sec me-changes"></section>
          <section class="me-sec me-export-sec" hidden>
            <h3>EXPORTED</h3>
            <p class="me-note">Commit as <code>src/world/maps/city.json</code>.</p>
            <textarea class="me-export" readonly spellcheck="false"></textarea>
          </section>
        </aside>
      </div>
      <div class="me-toast" hidden></div>`;
    this.canvas = root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.side = root.querySelector('.me-side')!;
    this.selEl = root.querySelector('.me-sel')!;
    this.depsEl = root.querySelector('.me-deps')!;
    this.problemsEl = root.querySelector('.me-problems')!;
    this.changesEl = root.querySelector('.me-changes')!;
    this.statusEl = root.querySelector('.me-status')!;
    this.toastEl = root.querySelector('.me-toast')!;
    this.exportEl = root.querySelector('.me-export')!;
    this.placeEl = root.querySelector('.me-place select')!;
    this.undoBtn = root.querySelector('[data-act="undo"]')!;
    this.redoBtn = root.querySelector('[data-act="redo"]')!;
    const close = root.querySelector<HTMLButtonElement>('.sheet-close')!;
    close.addEventListener('click', () => this.back());
    // Every button in the editor acts through data-act (the side panel is rebuilt as the selection changes).
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b && root.contains(b)) this.act(b);
    });
    this.side.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.input === 'height') this.setHeight(Number(t.value), false);
    });
    this.side.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.input === 'height') this.setHeight(Number(t.value), true);
    });
    this.placeEl.addEventListener('change', () => {
      this.placing = this.placeEl.value || null;
      if (this.placing && !this.placing.startsWith('spot:') && this.view.scale < PROPS_FROM_SCALE) this.say('ZOOM IN TO SEE THE STREET PROPS');
      this.placeEl.blur();
      this.syncCursor();
      this.redraw();
    });
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** The local edits now (null while closed). */
  get edits(): MapEdits | null {
    return this.history?.current ?? null;
  }

  /** What the CHANGES list shows. */
  get changes(): MapEditChange[] {
    return this.history ? diffMapEdits(this.d.shipped, this.history.current) : [];
  }

  /** The current problems (after the latest rebuild). */
  get problems(): readonly EditorProblem[] {
    this.flushRebuild();
    return this.preview?.problems ?? [];
  }

  open(onClose: () => void): void {
    this.onClose = onClose;
    this.root.hidden = false;
    this.history = new EditHistory(loadLocalMap() ?? this.d.shipped);
    this.base = baseBlocks(this.history.current.seed, this.d.gameMap);
    this.preview = buildPreview(this.history.current, this.d.inputs, this.d.gameMap);
    this.resolveSelection();
    this.listen(window, 'keydown', (e) => this.key(e as KeyboardEvent), true);
    this.listen(window, 'keyup', (e) => e.stopImmediatePropagation(), true);
    this.listen(window, 'resize', () => this.resize());
    this.listen(this.canvas, 'pointerdown', (e) => this.down(e as PointerEvent));
    this.listen(this.canvas, 'pointermove', (e) => this.move(e as PointerEvent));
    this.listen(this.canvas, 'pointerup', (e) => this.up(e as PointerEvent));
    this.listen(this.canvas, 'pointercancel', () => (this.drag = null));
    this.listen(this.canvas, 'pointerleave', () => {
      this.hover = null;
      this.status();
      if (this.placing) this.redraw();
    });
    this.listen(this.canvas, 'wheel', (e) => this.wheel(e as WheelEvent), { passive: false });
    this.listen(this.canvas, 'contextmenu', (e) => e.preventDefault());
    this.resize();
    this.refreshSide();
  }

  /** Esc / B / the close button: back to where it was opened from. */
  back(): void {
    if (this.root.hidden) return;
    this.hide();
    this.d.audio.ui('back');
    this.onClose();
  }

  hide(): void {
    if (this.root.hidden) return;
    this.flushRebuild();
    this.root.hidden = true;
    for (const [t, type, fn, opt] of this.listeners) t.removeEventListener(type, fn, opt);
    this.listeners.length = 0;
    window.clearTimeout(this.rebuildTimer);
    window.clearTimeout(this.toastTimer);
    this.rebuildTimer = 0;
    this.drag = null;
    this.pending = null;
    this.placing = null;
    this.placeEl.value = '';
    // Belt and braces: the game plays its own districts and road rules (buildPreview puts them back after each build too).
    restoreGameMap(this.d.gameMap);
    // Nothing kept while closed but the view.
    this.preview = null;
    this.history = null;
    this.base = [];
  }

  // --- Edits ---

  /** Make `next` the local edits (one undo step), save them, and rebuild the preview soon. */
  private commit(next: MapEdits, rebuildNow = false): void {
    const h = this.history;
    if (!h || !h.apply(next)) return;
    this.changed(rebuildNow);
  }

  private changed(rebuildNow: boolean): void {
    this.save();
    if (rebuildNow) this.rebuild();
    else this.scheduleRebuild();
    this.refreshSide();
    this.redraw();
  }

  undo(): void {
    if (this.history?.undo()) {
      this.d.audio.ui('back');
      this.changed(false);
    }
  }

  redo(): void {
    if (this.history?.redo()) {
      this.d.audio.ui('click');
      this.changed(false);
    }
  }

  private save(): void {
    const e = this.history?.current;
    if (!e) return;
    try {
      // No changes: no local file (VIEW IN 3D then plays the shipped map, the same city).
      if (diffMapEdits(this.d.shipped, e).length === 0 && e.seed === this.d.shipped.seed) localStorage.removeItem(LOCAL_MAP_KEY);
      else localStorage.setItem(LOCAL_MAP_KEY, serializeMapEdits(e));
    } catch {
      // Storage refused (private mode): the edits live until the editor closes; EXPORT still works.
    }
  }

  private scheduleRebuild(): void {
    window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), REBUILD_MS);
  }

  private flushRebuild(): void {
    if (this.rebuildTimer) this.rebuild();
  }

  private rebuild(): void {
    window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = 0;
    const h = this.history;
    if (!h) return;
    this.preview = buildPreview(this.pending ?? h.current, this.d.inputs, this.d.gameMap);
    this.resolveSelection();
    // Mid-drag the panel stays (rebuilding it would drop the slider from under the pointer).
    if (!this.pending) this.refreshSide();
    this.redraw();
  }

  /** A prop selection follows its prop into the new preview (its origin may have changed). */
  private resolveSelection(): void {
    const s = this.selection;
    if (s?.kind !== 'prop' || !this.preview) return;
    const p = this.preview.props.find((q) => q.kind === s.prop.kind && Math.abs(q.x - s.prop.x) <= PROP_MATCH && Math.abs(q.z - s.prop.z) <= PROP_MATCH);
    this.selection = p ? { kind: 'prop', prop: p } : null;
  }

  // --- Buttons ---

  private act(b: HTMLElement): void {
    const act = b.dataset.act!;
    const arg = b.dataset.arg ?? '';
    const h = this.history;
    const p = this.preview;
    if (!h || !p) return;
    const sel = this.selection;
    const e = h.current;
    if (b.dataset.confirm !== undefined && this.armed !== b) {
      this.arm(b);
      return;
    }
    this.disarm();
    switch (act) {
      case 'undo':
        return this.undo();
      case 'redo':
        return this.redo();
      case 'export':
        return this.exportFile();
      case 'view3d':
        return this.view3d();
      case 'play': {
        this.save();
        const url = new URL(location.href);
        url.searchParams.set('map', 'local');
        url.searchParams.delete('look');
        return this.d.navigate(url.toString());
      }
      case 'shipped': {
        const url = new URL(location.href);
        url.searchParams.delete('map');
        url.searchParams.delete('look');
        return this.d.navigate(url.toString());
      }
      case 'kind':
      case 'district':
      case 'style':
      case 'reroll':
      case 'layout':
      case 'clearBlock': {
        if (sel?.kind !== 'block') return;
        const base = this.base[blockIndex(p.city, sel.bx, sel.bz)];
        if (!base) return;
        if (act === 'kind') this.commit(editBlock(e, sel.bx, sel.bz, { kind: arg as BlockBase['kind'] }, base));
        else if (act === 'district') this.commit(editBlock(e, sel.bx, sel.bz, { district: arg as District }, base));
        else if (act === 'style') this.commit(editBlock(e, sel.bx, sel.bz, { style: arg as District }, base));
        else if (act === 'reroll') this.commit(rerollBlock(e, sel.bx, sel.bz, base));
        else if (act === 'layout') this.commit(editBlock(e, sel.bx, sel.bz, { variant: undefined }, base));
        else this.commit(editBlock(e, sel.bx, sel.bz, { kind: undefined, district: undefined, style: undefined, variant: undefined, height: undefined }, base));
        return this.d.audio.ui('confirm');
      }
      case 'road':
        if (sel?.kind === 'segment') this.commit(setRoad(e, sel.a, sel.b, arg as RoadMode));
        return this.d.audio.ui('confirm');
      case 'flip':
        if (sel?.kind === 'segment') this.commit(flipRoad(e, sel.a, sel.b));
        return this.d.audio.ui('confirm');
      case 'pickRoad': {
        const [a, b2] = arg.split('|').map((n) => n.split(',').map(Number) as [number, number]);
        return this.select({ kind: 'segment', a, b: b2 }, false);
      }
      case 'removeSpot':
        if (sel?.kind === 'anchor') this.commit(removeSpot(e, sel.id));
        return this.d.audio.ui('confirm');
      case 'resetSpot':
        if (sel?.kind === 'anchor') this.commit(resetSpot(e, sel.id));
        return this.d.audio.ui('confirm');
      case 'turnSpot':
        return this.turnSelected(Number(arg));
      case 'removeProp':
        if (sel?.kind === 'prop') this.commit(removeProp(e, sel.prop), true);
        return this.d.audio.ui('confirm');
      case 'restoreProp':
        if (sel?.kind === 'prop') this.commit(restoreProp(e, sel.prop), true);
        return this.d.audio.ui('confirm');
      case 'turnProp':
        return this.turnSelected(Number(arg));
      case 'select': {
        const [kind, ...rest] = arg.split(':');
        const id = rest.join(':');
        if (kind === 'anchor') this.select({ kind: 'anchor', id }, true);
        return;
      }
      case 'problem': {
        const pr = p.problems[Number(arg)];
        if (pr) this.showProblem(pr);
        return;
      }
      case 'revert': {
        const c = this.changes[Number(arg)];
        if (c) this.commit(revertChange(e, c));
        return this.d.audio.ui('back');
      }
      case 'showChange': {
        const c = this.changes[Number(arg)];
        if (c) this.showChange(c);
        return;
      }
      case 'resetAll':
        this.commit(this.d.shipped);
        this.say('BACK TO THE SHIPPED MAP');
        return this.d.audio.ui('back');
    }
  }

  private arm(b: HTMLElement): void {
    this.disarm();
    this.armed = b;
    b.classList.add('armed');
    b.dataset.label = b.textContent ?? '';
    b.textContent = 'PRESS AGAIN';
    this.d.audio.ui('click');
    this.armTimer = window.setTimeout(() => this.disarm(), CONFIRM_MS);
  }

  private disarm(): void {
    window.clearTimeout(this.armTimer);
    const b = this.armed;
    if (!b) return;
    this.armed = null;
    b.classList.remove('armed');
    b.textContent = b.dataset.label ?? '';
  }

  private setHeight(v: number, final: boolean): void {
    const sel = this.selection;
    const h = this.history;
    const p = this.preview;
    if (sel?.kind !== 'block' || !h || !p) return;
    const next = editBlock(h.current, sel.bx, sel.bz, { height: v }, this.base[blockIndex(p.city, sel.bx, sel.bz)]);
    // While the slider moves the preview follows; the release is the one undo step.
    if (final) {
      this.pending = null;
      this.commit(next);
      return;
    }
    this.pending = next;
    this.scheduleRebuild();
    const label = this.selEl.querySelector('.me-height-v');
    if (label) label.textContent = `×${v.toFixed(2)}`;
  }

  private turnSelected(delta: number): void {
    const sel = this.selection;
    const h = this.history;
    const p = this.preview;
    if (!h || !p) return;
    if (sel?.kind === 'anchor' && sel.id.startsWith('ramp-')) {
      const ramp = p.rawRamps.find((r) => r.id === sel.id) ?? p.ramps.find((r) => r.id === sel.id);
      if (ramp) this.commit(turnSpot(h.current, sel.id, delta, ramp.heading));
    } else if (sel?.kind === 'prop' && sel.prop.origin === 'added') {
      const pr = sel.prop;
      this.commit(moveAddedProp(h.current, pr, pr.x, pr.z, pr.heading + delta), true);
    } else return;
    this.d.audio.ui('click');
  }

  private exportFile(): void {
    const h = this.history;
    if (!h) return;
    const text = serializeMapEdits(h.current);
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'city.json';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // No download (an old browser): the box below has it.
    }
    navigator.clipboard?.writeText(text).catch(() => {});
    this.exportEl.value = text;
    this.exportEl.closest<HTMLElement>('section')!.hidden = false;
    this.exportEl.scrollIntoView?.({ block: 'nearest' });
    this.say('CITY.JSON SAVED & COPIED · COMMIT AS src/world/maps/city.json');
    this.d.audio.ui('success');
  }

  private view3d(): void {
    const h = this.history;
    if (!h || !this.preview) return;
    this.save();
    const edits = h.current;
    const at = (this.selection && selectionCentre(this.selection, this.allAnchors())) ?? { x: this.view.cx, z: this.view.cz };
    this.d.audio.ui('confirm');
    this.hide();
    this.onClose();
    this.d.viewLive(edits, at);
  }

  /** Select what a change is about and bring it into view. */
  private showChange(c: MapEditChange): void {
    const e = (c.after ?? c.before)!;
    if (c.section === 'blocks') {
      const at = (e as { at: readonly [number, number] }).at;
      this.select({ kind: 'block', bx: at[0] + CORE_OFFSET, bz: at[1] + CORE_OFFSET }, true);
    } else if (c.section === 'roads') {
      const r = e as { a: readonly [number, number]; b: readonly [number, number] };
      this.select({ kind: 'segment', a: r.a, b: r.b }, true);
    } else if (c.section === 'spots') this.select({ kind: 'anchor', id: (e as { id: string }).id }, true);
    else {
      const pr = e as { kind: string; x: number; z: number };
      const found = this.preview?.props.find((q) => q.kind === pr.kind && Math.abs(q.x - pr.x) <= PROP_MATCH && Math.abs(q.z - pr.z) <= PROP_MATCH);
      if (found) this.select({ kind: 'prop', prop: found }, true);
      if (this.view.scale < PROPS_FROM_SCALE) this.view.scale = PROPS_FROM_SCALE * 1.5;
      this.redraw();
    }
  }

  /** Select what a problem is about (its spot, or an added prop) and bring it into view. */
  private showProblem(pr: EditorProblem): void {
    const id = pr.id.startsWith('spot:') ? pr.id.slice(5) : pr.id;
    if (this.allAnchors().some((a) => a.id === id)) return this.select({ kind: 'anchor', id }, true);
    const at = pr.points[0];
    if (!at) return;
    const prop = this.preview?.props.find((q) => q.origin === 'added' && Math.abs(q.x - at.x) <= PROP_MATCH && Math.abs(q.z - at.z) <= PROP_MATCH);
    if (prop) {
      if (this.view.scale < PROPS_FROM_SCALE) this.view.scale = PROPS_FROM_SCALE * 1.5;
      this.select({ kind: 'prop', prop }, true);
    }
  }

  /** Select (null: nothing); `centre` brings it into view. */
  select(sel: Selection | null, centre = false): void {
    this.selection = sel;
    if (sel && centre) {
      const at = selectionCentre(sel, this.allAnchors());
      if (at) {
        this.view.cx = at.x;
        this.view.cz = at.z;
      }
    }
    this.refreshSide();
    this.redraw();
  }

  /** Anchors on the map and the ones the edits removed (a removed spot can still be selected, to put it back). */
  private allAnchors(): Anchor[] {
    const p = this.preview;
    return p ? [...p.anchors, ...p.removed] : [];
  }

  // --- Input ---

  private listen(t: EventTarget, type: string, fn: EventListener, opt: AddEventListenerOptions | boolean = false): void {
    t.addEventListener(type, fn, opt);
    this.listeners.push([t, type, fn, opt]);
  }

  /** Keys while open: the editor's own; the game's Input never sees them (Backspace would back out, arrows walk menus). */
  private key(e: KeyboardEvent): void {
    e.stopImmediatePropagation();
    const t = e.target as HTMLElement;
    const typing = t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== 'range');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && e.code === 'KeyY') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      if (this.placing) {
        this.placing = null;
        this.placeEl.value = '';
        this.syncCursor();
        this.redraw();
      } else if (this.selection) this.select(null);
      else this.back();
      return;
    }
    if (typing || mod || e.altKey) return;
    const step = 90;
    let handled = true;
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        panBy(this.view, step, 0, EXTENT);
        break;
      case 'ArrowRight':
      case 'KeyD':
        panBy(this.view, -step, 0, EXTENT);
        break;
      case 'ArrowUp':
      case 'KeyW':
        panBy(this.view, 0, step, EXTENT);
        break;
      case 'ArrowDown':
      case 'KeyS':
        panBy(this.view, 0, -step, EXTENT);
        break;
      case 'Equal':
      case 'NumpadAdd':
        zoomAt(this.view, this.view.width / 2, this.view.height / 2, 1.4);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        zoomAt(this.view, this.view.width / 2, this.view.height / 2, 1 / 1.4);
        break;
      case 'Digit0':
      case 'Home':
        fitView(this.view, EXTENT);
        break;
      case 'Delete':
      case 'Backspace':
        this.removeSelected();
        break;
      case 'KeyR':
        this.turnSelected(e.shiftKey ? -QUARTER / 2 : QUARTER / 2);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      this.redraw();
    }
  }

  private removeSelected(): void {
    const s = this.selection;
    const h = this.history;
    if (!h) return;
    if (s?.kind === 'anchor' && spotRule(s.id).removable) this.commit(removeSpot(h.current, s.id));
    else if (s?.kind === 'prop') this.commit(removeProp(h.current, s.prop), true);
  }

  private local(e: PointerEvent | WheelEvent): { sx: number; sy: number } {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    if (this.drag) return;
    const { sx, sy } = this.local(e);
    this.canvas.setPointerCapture?.(e.pointerId);
    // A press on the selected spot or added prop drags it; anywhere else pans.
    if (e.button === 0 && !this.placing && this.preview && this.selection) {
      const w = toWorld(this.view, sx, sy);
      const sel = this.selection;
      const stack = picksAt(w, this.preview.anchors.filter((a) => anchorShown(a, this.view.scale)), this.preview.props, this.view.scale, this.preview.rules);
      if (stack.some((x) => sameSelection(x, sel)) && this.draggable(sel)) {
        this.drag = { mode: 'move', id: e.pointerId, x: sx, y: sy, moved: false, at: w };
        return;
      }
    }
    this.drag = { mode: 'pan', id: e.pointerId, x: sx, y: sy, moved: false };
  }

  private draggable(s: Selection): boolean {
    return (s.kind === 'anchor' && spotRule(s.id).movable) || (s.kind === 'prop' && s.prop.origin === 'added');
  }

  private move(e: PointerEvent): void {
    const { sx, sy } = this.local(e);
    this.hover = toWorld(this.view, sx, sy);
    const g = this.drag;
    if (g && g.id === e.pointerId) {
      if (!g.moved && Math.hypot(sx - g.x, sy - g.y) > CLICK_SLOP) g.moved = true;
      if (g.moved) {
        if (g.mode === 'pan') {
          panBy(this.view, sx - g.x, sy - g.y, EXTENT);
          g.x = sx;
          g.y = sy;
        } else g.at = this.hover;
        this.redraw();
      }
    } else if (this.placing) this.redraw();
    this.status();
  }

  private up(e: PointerEvent): void {
    const g = this.drag;
    if (!g || g.id !== e.pointerId) return;
    this.drag = null;
    const h = this.history;
    const p = this.preview;
    if (!h || !p) return;
    if (g.mode === 'move' && g.moved) {
      const s = this.selection;
      const at = { x: Math.round(g.at.x * 10) / 10, z: Math.round(g.at.z * 10) / 10 };
      if (s?.kind === 'anchor') {
        const from = p.moved.get(s.id)?.from ?? p.anchors.find((a) => a.id === s.id)?.points[0];
        if (from) this.commit(moveSpot(h.current, s.id, at.x, at.z, from));
      } else if (s?.kind === 'prop') {
        this.commit(moveAddedProp(h.current, s.prop, at.x, at.z), true);
        this.selection = { kind: 'prop', prop: { ...s.prop, ...at } };
        this.resolveSelection();
        this.refreshSide();
      }
      this.d.audio.ui('confirm');
      this.redraw();
      return;
    }
    if (g.moved || e.button !== 0) return;
    const w = toWorld(this.view, g.x, g.y);
    if (this.placing?.startsWith('spot:')) {
      const [, kind, gang] = this.placing.split(':');
      const placed = placeSpot(h.current, kind as AddedSpotKind, w.x, w.z, gang);
      this.commit(placed.edits, true);
      this.selection = { kind: 'anchor', id: placed.id };
      this.d.audio.ui('confirm');
      this.refreshSide();
      this.redraw();
      return;
    }
    if (this.placing) {
      this.commit(placeProp(h.current, this.placing as StreetPropKind, w.x, w.z), true);
      this.resolveSelection();
      const placed = this.preview?.props.find((q) => q.origin === 'added' && q.kind === this.placing && Math.abs(q.x - w.x) <= 0.1 && Math.abs(q.z - w.z) <= 0.1);
      if (placed) this.selection = { kind: 'prop', prop: placed };
      this.d.audio.ui('confirm');
      this.refreshSide();
      this.redraw();
      return;
    }
    // Removed spots can be picked too (to put them back). A click again where the last one landed steps through what's stacked there.
    const stack = picksAt(w, [...p.anchors.filter((a) => anchorShown(a, this.view.scale)), ...p.removed], p.props, this.view.scale, p.rules);
    const last = this.lastClick;
    const again = last !== null && Math.hypot(w.x - last.x, w.z - last.z) * this.view.scale <= CLICK_SLOP * 2;
    this.lastClick = w;
    const hit = again ? nextPick(stack, this.selection) : (stack[0] ?? null);
    this.d.audio.ui('click');
    this.select(hit);
    const n = stack.findIndex((x) => sameSelection(x, hit));
    if (stack.length > 1 && n >= 0) this.say(`${n + 1} OF ${stack.length} HERE · CLICK AGAIN FOR THE NEXT`);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const { sx, sy } = this.local(e);
    // Lines (Firefox) and pixels; a trackpad pinch arrives as ctrl+wheel.
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(this.view, sx, sy, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
    this.redraw();
  }

  private syncCursor(): void {
    this.canvas.classList.toggle('placing', this.placing !== null);
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.view.width = Math.max(1, r.width);
    this.view.height = Math.max(1, r.height);
    if (!this.fitted) {
      // Room round the city for the legend.
      fitView(this.view, WORLD_LIMIT + 50);
      this.fitted = true;
    }
    this.draw();
  }

  // --- The side panel ---

  private status(): void {
    const w = this.hover;
    const hint = this.placing
      ? `PLACING ${this.placeEl.selectedOptions[0]?.textContent ?? ''} · CLICK THE MAP · ESC STOPS`
      : 'DRAG OR ARROWS TO PAN · WHEEL TO ZOOM · CLICK TO SELECT · DRAG A SELECTED SPOT TO MOVE IT · DEL REMOVES · CTRL+Z UNDO';
    this.statusEl.textContent = w ? `${w.x.toFixed(1)}, ${w.z.toFixed(1)} m · ${hint}` : hint;
  }

  private refreshSide(): void {
    const h = this.history;
    const p = this.preview;
    if (!h || !p) return;
    this.undoBtn.disabled = !h.canUndo;
    this.redoBtn.disabled = !h.canRedo;
    this.selEl.innerHTML = this.selectionHtml(h.current, p);
    const sel = this.selection;
    const pick = selectionPick(sel);
    const problemIds = new Set(p.problems.map((x) => x.id));
    // What relies on the selection: a place's dependents, or a spot's own course and what it stands on.
    let deps: Anchor[] = [];
    let depsTitle = 'WHAT RELIES ON IT';
    if (pick) deps = dependentsOf(p.anchors, pick, p.rules);
    else if (sel?.kind === 'anchor') {
      const a = this.allAnchors().find((x) => x.id === sel.id);
      const place = a && anchorPlace(a, p.rules);
      deps = place ? dependentsOf(p.anchors, place, p.rules).filter((x) => x.id !== sel.id) : [];
      depsTitle = 'SHARES ITS PLACE WITH';
    }
    this.depsEl.hidden = !sel || sel.kind === 'prop';
    this.depsEl.innerHTML = `<h3>${depsTitle} <b>${deps.length}</b></h3>${
      deps.length
        ? `<ul class="me-list">${deps
            .map(
              (a) =>
                `<li><button type="button" class="me-item${problemIds.has(a.id) ? ' bad' : ''}" data-act="select" data-arg="anchor:${esc(a.id)}"><i style="background:${GROUP_STYLE[a.group].color}"></i>${esc(a.label)}${a.route ? ' <em>course</em>' : a.via ? ' <em>route</em>' : ''}</button></li>`,
            )
            .join('')}</ul>`
        : '<p class="me-note">Nothing tied to this place.</p>'
    }`;
    const probs = p.problems;
    this.problemsEl.innerHTML = `<h3 class="${probs.length ? 'bad' : ''}">PROBLEMS <b>${probs.length}</b></h3>${
      probs.length
        ? `<ul class="me-list">${probs
            .map(
              (x, i) =>
                `<li><button type="button" class="me-item bad" data-act="problem" data-arg="${i}"><i></i><span><b>${esc(x.label)}</b> ${esc(x.problem)}</span></button></li>`,
            )
            .join('')}</ul>`
        : '<p class="me-note">None: nothing on the map is broken.</p>'
    }`;
    const changes = diffMapEdits(this.d.shipped, h.current);
    this.changesEl.innerHTML = `<h3>CHANGES <b>${changes.length}</b>${
      changes.length ? '<button type="button" class="me-mini risky" data-act="resetAll" data-confirm>RESET ALL</button>' : ''
    }</h3>${
      changes.length
        ? `<ul class="me-list me-changes-list">${changes
            .map(
              (c, i) =>
                `<li><button type="button" class="me-item" data-act="showChange" data-arg="${i}">${esc(describeChange(c))}</button><button type="button" class="me-mini" data-act="revert" data-arg="${i}">REVERT</button></li>`,
            )
            .join('')}</ul>`
        : '<p class="me-note">No changes from the shipped map.</p>'
    }`;
    this.status();
  }

  private selectionHtml(e: MapEdits, p: Preview): string {
    const s = this.selection;
    if (!s) {
      return `<h3>SELECT</h3><p class="me-note">Click a block, a road, a crossing, a spot or (zoomed in) a street prop; click again in the same place for what's under it. Pick a spot or a prop under PLACE to add one.</p>
        <p class="me-note">${p.anchors.length} spots and routes · ${p.props.filter((x) => x.origin !== 'removed').length} street props · built in ${p.ms.toFixed(0)} ms</p>`;
    }
    const btn = (act: string, label: string, opts: { arg?: string; on?: boolean; sub?: string; disabled?: boolean } = {}) =>
      `<button type="button" class="me-btn${opts.on ? ' on' : ''}" data-act="${act}"${opts.arg !== undefined ? ` data-arg="${esc(opts.arg)}"` : ''}${opts.disabled ? ' disabled' : ''}>${label}${opts.sub ? `<small>${opts.sub}</small>` : ''}</button>`;
    if (s.kind === 'block') {
      const i = blockIndex(p.city, s.bx, s.bz);
      const block = p.city.blocks[i];
      if (!block) return '';
      const edit = blockEditAt(e, s.bx, s.bz);
      const kind = p.kinds[i];
      const height = edit?.height ?? 1;
      const [cx, cz] = [s.bx - CORE_OFFSET, s.bz - CORE_OFFSET];
      return `<h3>BLOCK ${cx},${cz} <span class="me-sub">${DISTRICT_NAMES[block.district]}</span></h3>
        ${edit ? `<p class="me-note edited">Edited: ${esc(describeBlock(edit))}</p>` : ''}
        ${block.merge ? `<p class="me-note">Merged block, ${block.merge.w}×${block.merge.h} blocks (roads removed): everything here applies to all of it.</p>` : ''}
        <div class="me-row">${BLOCK_EDIT_KINDS.map((k) => btn('kind', KIND_LABEL[k], { arg: k, on: kind === k })).join('')}</div>
        <h4>DISTRICT</h4>
        <div class="me-row">${DISTRICTS.map((dname) => `<button type="button" class="me-btn me-dist${block.district === dname ? ' on' : ''}" data-act="district" data-arg="${dname}" style="--hue:${DISTRICT_HUE[dname]}">${DISTRICT_NAMES[dname]}</button>`).join('')}</div>
        <h4>BUILDING STYLE <span class="me-sub">${block.style ? `looks ${DISTRICT_NAMES[block.style]}` : 'its district’s'}</span></h4>
        <div class="me-row">${DISTRICTS.map((dname) => `<button type="button" class="me-btn me-dist${(block.style ?? block.district) === dname ? ' on' : ''}" data-act="style" data-arg="${dname}" style="--hue:${DISTRICT_HUE[dname]}"${kind === 'buildings' ? '' : ' disabled'}>${DISTRICT_NAMES[dname]}</button>`).join('')}</div>
        <h4>LAYOUT &amp; HEIGHT</h4>
        <div class="me-row">${btn('reroll', 'REROLL', { sub: edit?.variant !== undefined ? `layout ${edit.variant}` : 'as generated' })}${edit?.variant !== undefined ? btn('layout', 'GENERATED LAYOUT') : ''}</div>
        <label class="me-slider">HEIGHT <input type="range" data-input="height" min="${HEIGHT_SCALE_MIN}" max="${HEIGHT_SCALE_MAX}" step="0.05" value="${height}" ${kind === 'buildings' ? '' : 'disabled'}><span class="me-height-v">×${height.toFixed(2)}</span></label>
        ${edit ? `<div class="me-row">${btn('clearBlock', 'AS GENERATED')}</div>` : ''}`;
    }
    if (s.kind === 'segment') {
      const st = roadState(e, s.a, s.b);
      const ab = compass(s.a, s.b);
      const ba = compass(s.b, s.a);
      const along = ab === 'east' || ab === 'west' ? 'EAST–WEST' : 'NORTH–SOUTH';
      const fwd = st.mode === 'oneWay' && st.from![0] === s.a[0] && st.from![1] === s.a[1];
      return `<h3>ROAD ${s.a.join(',')} – ${s.b.join(',')} <span class="me-sub">${along}</span></h3>
        <div class="me-row">${btn('road', 'OPEN', { arg: 'open', on: st.mode === 'open' })}${btn('road', 'CLOSED', { arg: 'closed', on: st.mode === 'closed', sub: 'barriers both ends' })}</div>
        <div class="me-row">${btn('road', `ONE-WAY ${ab.toUpperCase()}`, { arg: 'oneWay', on: st.mode === 'oneWay' && fwd })}${btn('road', `ONE-WAY ${ba.toUpperCase()}`, { arg: 'oneWayBack', on: st.mode === 'oneWay' && !fwd })}${st.mode === 'oneWay' ? btn('flip', 'FLIP') : ''}</div>${this.streetRowHtml(e, s.a, s.b, btn)}`;
    }
    if (s.kind === 'junction') {
      const rows = [
        [[s.ix, s.iz - 1], 'NORTH'],
        [[s.ix + 1, s.iz], 'EAST'],
        [[s.ix, s.iz + 1], 'SOUTH'],
        [[s.ix - 1, s.iz], 'WEST'],
      ] as const;
      return `<h3>CROSSING ${s.ix},${s.iz}</h3><div class="me-row">${rows
        .map(([n, label]) => {
          const st = roadState(e, [s.ix, s.iz], n);
          const what = st.mode === 'open' ? 'open' : st.mode === 'closed' ? 'closed' : st.mode === 'pedestrian' ? 'pedestrian' : st.mode === 'removed' ? 'removed' : `one-way ${compass(st.from!, st.to!)}`;
          return btn('pickRoad', label, { arg: `${s.ix},${s.iz}|${n[0]},${n[1]}`, sub: what, on: st.mode !== 'open' });
        })
        .join('')}</div>`;
    }
    if (s.kind === 'anchor') {
      const removed = p.removed.find((a) => a.id === s.id);
      const a = removed ?? p.anchors.find((x) => x.id === s.id);
      if (!a) return `<h3>SPOT</h3><p class="me-note">${esc(s.id)} isn't on this map.</p>`;
      const rule = spotRule(a.id);
      const edit = spotEdited(e, a.id);
      const at = a.points[0];
      const g = GROUP_STYLE[a.group];
      const line = routeLine(a);
      const state = removed
        ? 'Removed'
        : edit?.add
          ? 'Added by your edits'
          : edit
            ? [edit.x !== undefined ? 'moved' : '', edit.heading !== undefined ? 'turned' : ''].filter(Boolean).join(', ')
            : '';
      return `<h3><i class="me-dot" style="background:${g.color}"></i>${esc(a.label)}</h3>
        <p class="me-note">${g.name} · <code>${esc(a.id)}</code>${at ? ` · ${at.x.toFixed(1)}, ${at.z.toFixed(1)}` : ''}${a.points.length > 1 ? ` · ${a.points.length} points` : ''}${line ? ` · ${line.fixed ? 'a course' : 'a drive route'} through ${line.points.length - (line.fixed ? 0 : 1)} crossings` : ''}</p>
        ${state ? `<p class="me-note edited">${state}</p>` : ''}
        <p class="me-note">${rule.movable ? (removed ? 'Removed from the city.' : 'Drag it on the map to move it.') : 'Placed by the game (not a spot the map file moves): this shows what it relies on.'}</p>
        <div class="me-row">${rule.removable && !removed ? btn('removeSpot', 'REMOVE', { sub: 'Del' }) : ''}${edit && !edit.add ? btn('resetSpot', removed ? 'PUT BACK' : 'AS GENERATED') : ''}${
          a.id.startsWith('ramp-') && !removed ? btn('turnSpot', 'TURN ⟲', { arg: String(-QUARTER) }) + btn('turnSpot', 'TURN ⟳', { arg: String(QUARTER) }) : ''
        }</div>`;
    }
    const pr = s.prop;
    const what = pr.origin === 'added' ? 'Added by your edits' : pr.origin === 'removed' ? 'Removed by your edits' : 'Generated';
    return `<h3>${esc(pr.kind.replace(/_/g, ' ').toUpperCase())}</h3>
      <p class="me-note">${what} · ${pr.x.toFixed(1)}, ${pr.z.toFixed(1)}${pr.origin === 'added' ? ' · drag it to move, R turns it' : ''}</p>
      <div class="me-row">${pr.origin === 'removed' ? btn('restoreProp', 'PUT BACK') : btn('removeProp', 'REMOVE', { sub: 'Del' })}${
        pr.origin === 'added' ? btn('turnProp', 'TURN ⟲', { arg: String(-QUARTER / 2) }) + btn('turnProp', 'TURN ⟳', { arg: String(QUARTER / 2) }) : ''
      }</div>`;
  }

  private say(text: string): void {
    window.clearTimeout(this.toastTimer);
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), TOAST_MS);
  }

  // --- Drawing ---

  private redraw(): void {
    if (this.redrawQueued || this.root.hidden) return;
    this.redrawQueued = true;
    requestAnimationFrame(() => {
      this.redrawQueued = false;
      this.draw();
    });
  }

  private draw(): void {
    const p = this.preview;
    const h = this.history;
    if (!p || !h || this.root.hidden) return;
    const ctx = this.ctx;
    const v = this.view;
    const k = this.dpr;
    const s = v.scale;
    const px = 1 / s;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = '#090b10';
    ctx.fillRect(0, 0, v.width, v.height);
    // World metres from here on.
    ctx.setTransform(k * s, 0, 0, k * s, k * (v.width / 2 - v.cx * s), k * (v.height / 2 - v.cz * s));
    const x0 = v.cx - v.width / 2 / s;
    const x1 = v.cx + v.width / 2 / s;
    const z0 = v.cz - v.height / 2 / s;
    const z1 = v.cz + v.height / 2 / s;
    const inView = (minX: number, minZ: number, maxX: number, maxZ: number) => maxX >= x0 && minX <= x1 && maxZ >= z0 && minZ <= z1;

    const L = WORLD_LIMIT;
    ctx.fillStyle = '#262932';
    ctx.fillRect(-L, -L, 2 * L, 2 * L);
    ctx.strokeStyle = '#11131a';
    ctx.lineWidth = 3;
    ctx.strokeRect(-L - 1.5, -L - 1.5, 2 * L + 3, 2 * L + 3);

    // Blocks: pavement, then the lot by kind, tinted by district.
    const edited = new Set(h.current.blocks.map((b) => `${b.at[0] + CORE_OFFSET},${b.at[1] + CORE_OFFSET}`));
    p.city.blocks.forEach((b, i) => {
      const r = b.interior;
      if (!inView(r.minX - SIDEWALK, r.minZ - SIDEWALK, r.maxX + SIDEWALK, r.maxZ + SIDEWALK)) return;
      const hue = DISTRICT_HUE[b.district];
      ctx.fillStyle = `hsl(${hue} 10% 31%)`;
      ctx.fillRect(r.minX - SIDEWALK, r.minZ - SIDEWALK, r.maxX - r.minX + 2 * SIDEWALK, r.maxZ - r.minZ + 2 * SIDEWALK);
      const kind = p.kinds[i];
      ctx.fillStyle = kind === 'park' ? '#2c5a37' : kind === 'plaza' ? '#6a6153' : kind === 'carpark' ? '#3a3d46' : kind === 'lot' ? '#4a4236' : `hsl(${hue} 22% 19%)`;
      ctx.fillRect(r.minX, r.minZ, r.maxX - r.minX, r.maxZ - r.minZ);
      if (kind === 'carpark' && s > 1.2) {
        ctx.strokeStyle = 'rgb(255 255 255 / 0.25)';
        ctx.lineWidth = px;
        ctx.beginPath();
        for (let x = r.minX + 3; x < r.maxX - 2; x += 2.6) {
          ctx.moveTo(x, r.minZ + 2);
          ctx.lineTo(x, r.minZ + 7);
          ctx.moveTo(x, r.maxZ - 7);
          ctx.lineTo(x, r.maxZ - 2);
        }
        ctx.stroke();
      }
    });
    for (const bd of p.city.buildings) {
      if (!inView(bd.minX, bd.minZ, bd.maxX, bd.maxZ)) continue;
      const hue = DISTRICT_HUE[bd.district];
      const light = 34 + Math.min(1, bd.height / 12) * 18 + bd.tint * 6;
      ctx.fillStyle = `hsl(${hue} 16% ${light.toFixed(0)}%)`;
      ctx.fillRect(bd.minX, bd.minZ, bd.maxX - bd.minX, bd.maxZ - bd.minZ);
    }
    if (s > 0.6) {
      ctx.fillStyle = '#20442a';
      ctx.beginPath();
      for (const t of p.city.trees) {
        if (!inView(t.x - 3, t.z - 3, t.x + 3, t.z + 3)) continue;
        ctx.moveTo(t.x + t.radius * 0.8, t.z);
        ctx.arc(t.x, t.z, t.radius * 0.8, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // Edited blocks: a yellow dashed outline.
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([6 * px, 4 * px]);
    for (const b of p.city.blocks) {
      if (!edited.has(`${b.bx},${b.bz}`)) continue;
      const r = b.interior;
      ctx.strokeRect(r.minX - SIDEWALK, r.minZ - SIDEWALK, r.maxX - r.minX + 2 * SIDEWALK, r.maxZ - r.minZ + 2 * SIDEWALK);
    }
    ctx.setLineDash([]);

    // Road edits: closed in red with barriers; one-way with arrows; pedestrian streets and removed roads (round 3).
    for (const r of h.current.roads) {
      const [a, b] = [nodePoint(r.a), nodePoint(r.b)];
      if (r.pedestrian || r.removed) {
        this.drawStreetEdit(r, p);
        continue;
      }
      if (r.closed) {
        this.segment(a, b, 'rgb(255 59 79 / 0.85)', Math.max(5, 9 * s) * px, 9);
        const dx = Math.sign(b.x - a.x);
        const dz = Math.sign(b.z - a.z);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, 2 * s) * px;
        ctx.beginPath();
        for (const [c, sgn] of [[a, 1], [b, -1]] as const) {
          const cx = c.x + dx * sgn * 10;
          const cz = c.z + dz * sgn * 10;
          ctx.moveTo(cx - dz * 7, cz - dx * 7);
          ctx.lineTo(cx + dz * 7, cz + dx * 7);
        }
        ctx.stroke();
      } else this.arrows(a, b, '#ffd23f');
    }

    // Street props (zoomed in): dots; removed ones as red crosses, added ones green.
    if (s >= PROPS_FROM_SCALE) {
      const r = Math.max(0.45, 2.2 * px);
      ctx.fillStyle = 'rgb(205 210 222 / 0.7)';
      ctx.beginPath();
      for (const q of p.props) {
        if (q.origin !== 'generated' || !inView(q.x - 1, q.z - 1, q.x + 1, q.z + 1)) continue;
        ctx.moveTo(q.x + r, q.z);
        ctx.arc(q.x, q.z, r, 0, Math.PI * 2);
      }
      ctx.fill();
      for (const q of p.props) {
        if (q.origin === 'generated' || !inView(q.x - 2, q.z - 2, q.x + 2, q.z + 2)) continue;
        if (q.origin === 'removed') {
          ctx.strokeStyle = '#ff6a6a';
          ctx.lineWidth = 1.5 * px;
          ctx.beginPath();
          ctx.moveTo(q.x - 2.5 * r, q.z - 2.5 * r);
          ctx.lineTo(q.x + 2.5 * r, q.z + 2.5 * r);
          ctx.moveTo(q.x + 2.5 * r, q.z - 2.5 * r);
          ctx.lineTo(q.x - 2.5 * r, q.z + 2.5 * r);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#5fe36a';
          ctx.beginPath();
          ctx.arc(q.x, q.z, r * 1.6, 0, Math.PI * 2);
          ctx.fill();
          // Its facing.
          ctx.strokeStyle = '#5fe36a';
          ctx.lineWidth = 1.5 * px;
          ctx.beginPath();
          ctx.moveTo(q.x, q.z);
          ctx.lineTo(q.x + Math.sin(q.heading) * r * 4, q.z + Math.cos(q.heading) * r * 4);
          ctx.stroke();
        }
      }
    }

    // The selection (under the overlay, so a closed road and a course over it still show).
    const sel = this.selection;
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = '#fff';
    if (sel?.kind === 'block') {
      const b = p.city.blocks[blockIndex(p.city, sel.bx, sel.bz)];
      if (b) ctx.strokeRect(b.interior.minX - SIDEWALK - 1, b.interior.minZ - SIDEWALK - 1, b.interior.maxX - b.interior.minX + 2 * SIDEWALK + 2, b.interior.maxZ - b.interior.minZ + 2 * SIDEWALK + 2);
    } else if (sel?.kind === 'segment') this.segment(nodePoint(sel.a), nodePoint(sel.b), 'rgb(255 255 255 / 0.35)', Math.max(4, 18 * s) * px, 8);
    else if (sel?.kind === 'junction') ctx.strokeRect(sel.ix * BLOCK_SIZE - 9, sel.iz * BLOCK_SIZE - 9, 18, 18);

    // The overlay: what relies on the selection (routes as lines through their crossings).
    const pick = selectionPick(sel);
    const all = this.allAnchors();
    let deps: Anchor[] = pick ? dependentsOf(p.anchors, pick, p.rules) : [];
    const selAnchor = sel?.kind === 'anchor' ? all.find((a) => a.id === sel.id) : undefined;
    if (selAnchor) deps = [selAnchor];
    for (const a of deps) {
      const line = routeLine(a);
      if (line) this.polyline(line.points, line.fixed ? 'rgb(46 230 255 / 0.85)' : 'rgb(46 230 255 / 0.6)', 4 * px, !line.fixed, line.fixed);
    }
    // Problems in red: their roads, and rings drawn with the icons below.
    for (const pr of p.problems) for (const [a, b] of pr.segments ?? []) this.segment(nodePoint(a), nodePoint(b), '#ff3b4f', Math.max(7, 6 * s) * px, 4);

    // Screen space: spots and their labels.
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const depIds = new Set(deps.map((a) => a.id));
    const bad = new Set(p.problems.map((x) => x.id));
    const labels = s >= LABELS_FROM_SCALE;
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    // Moved spots: a dashed line from where they were generated.
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgb(255 210 63 / 0.8)';
    ctx.lineWidth = 1.5;
    for (const [, m] of p.moved) {
      const a = toScreen(v, m.from.x, m.from.z);
      const b = toScreen(v, m.to.x, m.to.z);
      ctx.beginPath();
      ctx.arc(a.sx, a.sy, 5, 0, Math.PI * 2);
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const dragging = this.drag?.mode === 'move' && this.drag.moved ? this.drag.at : null;
    const icon = (a: Anchor, q: Point, ghost: boolean) => {
      const { sx, sy } = toScreen(v, q.x, q.z);
      if (sx < -20 || sy < -20 || sx > v.width + 20 || sy > v.height + 20) return;
      const g = GROUP_STYLE[a.group];
      const small = a.group === 'busStop' || (a.group === 'story' && !depIds.has(a.id) && s < 1);
      const r = small ? 3.5 : 6.5;
      if (bad.has(a.id)) {
        ctx.strokeStyle = '#ff3b4f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (depIds.has(a.id)) {
        ctx.strokeStyle = '#2ee6ff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = ghost ? 0.35 : 1;
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#090b10';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (!small) {
        ctx.fillStyle = '#090b10';
        ctx.textAlign = 'center';
        ctx.fillText(g.letter, sx, sy + 0.5);
      }
      ctx.globalAlpha = 1;
      if (ghost) {
        ctx.strokeStyle = '#ff6a6a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx - 6, sy - 6);
        ctx.lineTo(sx + 6, sy + 6);
        ctx.moveTo(sx + 6, sy - 6);
        ctx.lineTo(sx - 6, sy + 6);
        ctx.stroke();
      }
      if (selAnchor === a) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      if ((labels && !small) || depIds.has(a.id) || bad.has(a.id) || selAnchor === a) {
        ctx.textAlign = 'left';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgb(9 11 16 / 0.85)';
        ctx.strokeText(a.label, sx + r + 4, sy);
        ctx.fillStyle = bad.has(a.id) ? '#ff8a96' : '#e8ecf5';
        ctx.fillText(a.label, sx + r + 4, sy);
      }
    };
    for (const a of p.removed) icon(a, a.points[0], true);
    const keep = new Set([...depIds, ...bad]);
    if (selAnchor) keep.add(selAnchor.id);
    for (const a of p.anchors) {
      if (!anchorShown(a, s, keep)) continue;
      const drag = dragging && selAnchor === a;
      a.points.forEach((q, i) => icon(a, drag && i === 0 ? dragging : q, false));
    }
    // Problems with no anchor on the map (a removed spot the game needs, an added prop in a building).
    for (const pr of p.problems) {
      if (!pr.id.startsWith('prop:')) continue;
      for (const q of pr.points) {
        const { sx, sy } = toScreen(v, q.x, q.z);
        ctx.strokeStyle = '#ff3b4f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // A selected prop, dragged prop, or the prop about to be placed.
    if (sel?.kind === 'prop') {
      const q = dragging ?? sel.prop;
      const { sx, sy } = toScreen(v, q.x, q.z);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.placing && this.hover) {
      const { sx, sy } = toScreen(v, this.hover.x, this.hover.z);
      ctx.fillStyle = 'rgb(95 227 106 / 0.6)';
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(4, 2.2 * s), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * The road panel's round-3 row: PEDESTRIAN (paved, no traffic) and REMOVE
   * (land: the blocks either side merge), with why REMOVE can't apply here.
   */
  private streetRowHtml(e: MapEdits, a: readonly [number, number], b: readonly [number, number], btn: (act: string, label: string, opts?: { arg?: string; on?: boolean; sub?: string; disabled?: boolean }) => string): string {
    const st = roadState(e, a, b);
    const refusal = st.mode === 'removed' ? null : removeRefusal(e, a, b);
    const notes: string[] = [];
    if (st.mode === 'removed') notes.push('Land now: the blocks either side are one block (select it to edit it). Any other mode puts the road back, cutting the merged block along this line.');
    if (st.mode === 'pedestrian') notes.push('Paved over: no traffic, bollards across both ends, people walk down it.');
    if (refusal) notes.push(refusal);
    return `<h4>STREET</h4><div class="me-row">${btn('road', 'PEDESTRIAN', { arg: 'pedestrian', on: st.mode === 'pedestrian', sub: 'paved, no traffic' })}${btn('road', 'REMOVE', { arg: 'removed', on: st.mode === 'removed', sub: 'merge the blocks', disabled: refusal !== null })}</div>${notes.map((n) => `<p class="me-note${refusal === n ? ' me-warn' : ''}">${esc(n)}</p>`).join('')}`;
  }

  /** A pedestrian street (paving, a dashed line, bollards at the ends) or a removed road (a faint dashed line where it ran: the merged block covers it). */
  private drawStreetEdit(r: RoadEdit, p: Preview): void {
    const ctx = this.ctx;
    const px = 1 / this.view.scale;
    const [a, b] = [nodePoint(r.a), nodePoint(r.b)];
    const ux = Math.sign(b.x - a.x);
    const uz = Math.sign(b.z - a.z);
    if (r.removed) {
      ctx.strokeStyle = p.rules?.refused.some((x) => x.road === r || roadKey(x.road.a, x.road.b) === roadKey(r.a, r.b)) ? 'rgb(255 59 79 / 0.8)' : 'rgb(255 210 63 / 0.55)';
      ctx.lineWidth = Math.max(1, 1.5 * px);
      ctx.setLineDash([5 * px, 5 * px]);
      ctx.beginPath();
      ctx.moveTo(a.x + ux * 12, a.z + uz * 12);
      ctx.lineTo(b.x - ux * 12, b.z - uz * 12);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    // The carriageway, paved like the pavements, between the crossings' boxes.
    const half = 8;
    const x0 = Math.min(a.x, b.x) + (ux !== 0 ? half : -half);
    const z0 = Math.min(a.z, b.z) + (uz !== 0 ? half : -half);
    const w = ux !== 0 ? BLOCK_SIZE - 2 * half : 2 * half;
    const d = uz !== 0 ? BLOCK_SIZE - 2 * half : 2 * half;
    ctx.fillStyle = 'hsl(260 10% 34%)';
    ctx.fillRect(x0, z0, w, d);
    ctx.strokeStyle = 'rgb(255 210 63 / 0.7)';
    ctx.lineWidth = Math.max(1, 1.5 * px);
    ctx.setLineDash([3 * px, 3 * px]);
    ctx.beginPath();
    ctx.moveTo(a.x + ux * 12, a.z + uz * 12);
    ctx.lineTo(b.x - ux * 12, b.z - uz * 12);
    ctx.stroke();
    ctx.setLineDash([]);
    // Bollards across both ends.
    ctx.fillStyle = '#ffd23f';
    for (const [c, sgn] of [
      [a, 1],
      [b, -1],
    ] as const) {
      for (let o = -7.2; o <= 7.3; o += 1.8) {
        const x = c.x + ux * sgn * 9.6 - uz * o;
        const z = c.z + uz * sgn * 9.6 + ux * o;
        ctx.fillRect(x - Math.max(0.35, px), z - Math.max(0.35, px), Math.max(0.7, 2 * px), Math.max(0.7, 2 * px));
      }
    }
  }

  /** A thick line along a road between two crossings, stopping `inset` m short of each. */
  private segment(a: Point, b: Point, color: string, width: number, inset: number): void {
    const ctx = this.ctx;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x + ux * inset, a.z + uz * inset);
    ctx.lineTo(b.x - ux * inset, b.z - uz * inset);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  /** One-way chevrons along a road, a → b. */
  private arrows(a: Point, b: Point, color: string): void {
    const ctx = this.ctx;
    const px = 1 / this.view.scale;
    const ux = Math.sign(b.x - a.x);
    const uz = Math.sign(b.z - a.z);
    const size = Math.max(4, 9 * px);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.2, 2.5 * px);
    ctx.beginPath();
    for (const t of [0.3, 0.5, 0.7]) {
      const cx = a.x + (b.x - a.x) * t;
      const cz = a.z + (b.z - a.z) * t;
      ctx.moveTo(cx - ux * size - uz * size, cz - uz * size + ux * size);
      ctx.lineTo(cx, cz);
      ctx.lineTo(cx - ux * size + uz * size, cz - uz * size - ux * size);
    }
    ctx.stroke();
  }

  /** A route through world points; `dashed` for a drive route (traffic picks the roads between); `heads` marks the way round. */
  private polyline(points: readonly Point[], color: string, width: number, dashed: boolean, heads: boolean): void {
    const ctx = this.ctx;
    const px = 1 / this.view.scale;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    if (dashed) ctx.setLineDash([10 * px, 7 * px]);
    ctx.beginPath();
    points.forEach((q, i) => (i ? ctx.lineTo(q.x, q.z) : ctx.moveTo(q.x, q.z)));
    ctx.stroke();
    ctx.setLineDash([]);
    if (heads) for (let i = 1; i < points.length; i += 2) this.arrows(points[i - 1], points[i], color);
    // The start.
    if (points[0]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].z, 6 * px + 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** PLACE's value for a spot: `spot:<kind>` (and `:<gang>` for a hangout). */
const placeValue = (k: (typeof PLACEABLE_SPOTS)[number]) => `spot:${k.kind}${k.gang ? `:${k.gang}` : ''}`;
