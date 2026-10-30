/**
 * Off-screen threat chevrons: red arrows on the screen edge pointing at
 * people who are shooting at or coming for the player but can't be seen
 * (the on-foot view is smaller than a gun's range). A small pool of DOM
 * elements moved by transform; nothing allocates per frame.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { CrowdPed } from '../game/population';
import { safeInsets } from './safeArea';

const MAX_CHEVRONS = 6;
/** Hostiles further than this aren't worth a warning, m. */
const RANGE = 60;
/** Distance of the chevron's centre from the screen edge (inside the safe area), px. */
const EDGE_GAP = 26;

export class ThreatIndicators {
  private readonly els: HTMLElement[] = [];
  private readonly shown: boolean[] = [];
  private readonly p = new Vector3();

  constructor(parent: HTMLElement) {
    const layer = document.createElement('div');
    layer.id = 'threats';
    for (let i = 0; i < MAX_CHEVRONS; i++) {
      const el = document.createElement('div');
      el.className = 'threat';
      el.innerHTML = '<i></i>';
      el.hidden = true;
      layer.append(el);
      this.els.push(el);
      this.shown.push(false);
    }
    parent.append(layer);
  }

  /** Per frame: point at hostile peds out of view of `camera` (a w×h view). `enabled` false hides them all. */
  update(camera: PerspectiveCamera, crowd: readonly CrowdPed[], px: number, pz: number, w: number, h: number, enabled: boolean): void {
    let n = 0;
    if (enabled && w > 0 && h > 0) {
      const s = safeInsets();
      const cx = w / 2;
      const cy = h / 2;
      // The box chevrons live on: the screen inset by the safe area and a gap.
      const hx = cx - Math.max(s.left, s.right) - EDGE_GAP;
      const hy = cy - Math.max(s.top, s.bottom) - EDGE_GAP;
      for (const c of crowd) {
        if (n >= MAX_CHEVRONS) break;
        const mode = c.agent.mode;
        if (mode !== 'fight' && mode !== 'shoot') continue;
        const a = c.agent.s;
        if (Math.abs(a.x - px) > RANGE || Math.abs(a.z - pz) > RANGE) continue;
        this.p.set(a.x, 1, a.z).project(camera);
        // On screen (with a little margin): no arrow needed.
        if (this.p.z < 1 && Math.abs(this.p.x) < 0.96 && Math.abs(this.p.y) < 0.94) continue;
        let dx = this.p.x * cx;
        let dy = -this.p.y * cy;
        if (this.p.z > 1) {
          dx = -dx; // behind the camera (can't happen top-down, but be safe)
          dy = -dy;
        }
        const k = Math.min(hx / Math.max(1e-6, Math.abs(dx)), hy / Math.max(1e-6, Math.abs(dy)));
        const x = cx + dx * k;
        const y = cy + dy * k;
        const angle = Math.atan2(dx, -dy);
        const el = this.els[n];
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${angle.toFixed(3)}rad)`;
        const shooter = mode === 'shoot';
        if (el.classList.contains('shooter') !== shooter) el.classList.toggle('shooter', shooter);
        if (!this.shown[n]) {
          this.shown[n] = true;
          el.hidden = false;
        }
        n++;
      }
    }
    for (let i = n; i < MAX_CHEVRONS; i++) {
      if (!this.shown[i]) continue;
      this.shown[i] = false;
      this.els[i].hidden = true;
    }
  }
}
