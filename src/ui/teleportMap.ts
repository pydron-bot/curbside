import type { GameAudio } from '../audio/gameAudio';
import type { Landmark } from '../game/testTools';
import type { City } from '../world/city';
import { MAP_EXTENT, renderCityMap } from './cityMap';
import { ICONS } from './icons';
import { MenuNav, overlay, type Panel } from './menu';

/** The map's resolution: enough for a phone's card at 2×, m per px. */
const PX_PER_M = 0.75;
/** A press that moves further than this is a scroll or a slip, not a pick, px. */
const TAP_SLOP = 14;

export interface TeleportMapHooks {
  /** Where the player is now (the dot). */
  at(): { x: number; z: number };
  /** Teleport to the street nearest (x, z); what happened. */
  teleport(x: number, z: number): string;
  /** A quick teleport. */
  landmark(id: string): string;
  /** Show what happened (the TEST sheet's strip). */
  say(text: string): void;
}

/**
 * TEST → MAP → CITY MAP: the whole city (the radar's own drawing, made
 * the first time it opens), the player and the landmarks on it. Tap or
 * click a spot to teleport to the nearest road or pavement there (with the
 * car, onto a lane); the landmarks down the side are buttons too, so a
 * keyboard or pad can still go somewhere.
 */
export class TeleportMap implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  readonly sheet = true;
  private readonly canvas: HTMLCanvasElement;
  private map: HTMLCanvasElement | null = null;
  private onClose: () => void = () => {};
  private press: { id: number; x: number; y: number } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
    private readonly city: City,
    private readonly landmarks: readonly Landmark[],
    private readonly hooks: TeleportMapHooks,
  ) {
    const { root, card } = overlay('teleport', 'ui-sheet test-sheet');
    this.root = root;
    this.nav = new MenuNav(root);
    card.innerHTML = `
      <header class="sheet-head"><h2>TELEPORT</h2><span class="test-hint">TAP A SPOT ON THE MAP</span></header>
      <div class="sheet-body test-map"><canvas></canvas><div class="test-map-side"></div></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.tabIndex = -1;
    close.className = 'sheet-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = ICONS.close;
    card.querySelector('.sheet-head')!.append(close);
    this.canvas = card.querySelector('canvas')!;
    const side = card.querySelector('.test-map-side')!;
    for (const m of landmarks) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'test-btn small';
      b.innerHTML = '<b></b>';
      b.querySelector('b')!.textContent = m.label;
      side.append(b);
      this.nav.add({ el: b, activate: () => this.go(hooks.landmark(m.id)) });
    }
    this.nav.add({ el: close, activate: () => this.back() });
    // A pick is a press and lift in (about) one place: a drag does nothing.
    this.canvas.addEventListener('pointerdown', (e) => {
      this.press = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointercancel', () => (this.press = null));
    // No click after the touch: the map closes on the lift, and the click would land on the TEST sheet under it.
    this.canvas.addEventListener('touchend', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerup', (e) => {
      const p = this.press;
      this.press = null;
      if (!p || p.id !== e.pointerId || Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 * MAP_EXTENT - MAP_EXTENT;
      const z = ((e.clientY - r.top) / r.height) * 2 * MAP_EXTENT - MAP_EXTENT;
      this.go(hooks.teleport(x, z));
    });
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(onClose: () => void, showFocus: boolean): void {
    this.onClose = onClose;
    this.draw();
    this.root.hidden = false;
    this.nav.focus();
    this.nav.showFocus(showFocus);
  }

  hide(): void {
    this.root.hidden = true;
  }

  back(): void {
    if (this.root.hidden) return;
    this.hide();
    this.audio.ui('back');
    this.onClose();
  }

  /** Teleported (or not): say so; on success the map closes back to TEST. */
  private go(said: string): void {
    this.hooks.say(said);
    if (said.startsWith('TELEPORTED')) {
      this.audio.ui('confirm');
      this.back();
    } else this.audio.ui('fail');
  }

  /** The city, the landmarks and the player, drawn once per opening (the game is paused). */
  private draw(): void {
    this.map ??= renderCityMap(this.city, PX_PER_M);
    const c = this.canvas;
    c.width = c.height = this.map.width;
    const g = c.getContext('2d');
    if (!g) return;
    g.drawImage(this.map, 0, 0);
    const k = c.width / (2 * MAP_EXTENT);
    const px = (v: number) => (v + MAP_EXTENT) * k;
    g.font = `900 ${Math.round(c.width / 46)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const m of this.landmarks) {
      g.fillStyle = 'rgba(255, 210, 63, 0.95)';
      g.beginPath();
      g.arc(px(m.x), px(m.z), c.width / 110, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.fillText(m.label, px(m.x), px(m.z) - c.width / 40);
    }
    const at = this.hooks.at();
    g.fillStyle = '#2ee6ff';
    g.strokeStyle = '#071016';
    g.lineWidth = c.width / 300;
    g.beginPath();
    g.arc(px(at.x), px(at.z), c.width / 70, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}
