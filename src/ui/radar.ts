import './tokens.css';
import './radar.css';
import type { CrowdPed, Vehicle } from '../game/population';
import type { Pickup } from '../world/pickups';
import type { City } from '../world/city';
import { MAP_EXTENT, MAP_PX_PER_M, renderCityMap } from './cityMap';
import { roadRoute } from './radarRoute';

/** What a blip stands for; each kind has a default colour. */
export type BlipKind = 'objective' | 'enemy' | 'police' | 'pickup' | 'friend' | 'shop' | 'race' | 'marker';

export interface BlipOptions {
  x: number;
  z: number;
  kind?: BlipKind;
  /** CSS colour; overrides the kind's. */
  colour?: string;
  /** One character drawn in the dot ('$', '★', '?'). */
  icon?: string;
  /** A ring ripples out from it. */
  pulse?: boolean;
  /** When off the radar, pin it to the rim with an arrow pointing its way. */
  edgeArrow?: boolean;
  /** Dot radius in CSS px (default 4, 6 with an icon). */
  size?: number;
}

type Blip = Required<Omit<BlipOptions, 'colour' | 'icon'>> & { colour: string; icon: string };

export const BLIP_COLOURS: Record<BlipKind, string> = {
  objective: '#ffd23f',
  enemy: '#ff3b4f',
  police: '#4f8bff',
  pickup: '#ffb02e',
  friend: '#3ddc84',
  shop: '#2ee6ff',
  race: '#ff2e88',
  marker: '#ffffff',
};

export interface RadarSources {
  vehicles: readonly Vehicle[];
  pickups: readonly Pickup[];
  crowd: readonly CrowdPed[];
}

/** Redraws per second at most (it's a radar; 30 Hz is plenty and cheap). */
const RATE = 30;
/** Metres from the centre to the rim: on foot, and in a car from standing to flat out. */
const RANGE_FOOT = 58;
const RANGE_CAR = 95;
const RANGE_PER_MPS = 2.6;
const RANGE_MAX = 190;
const MAX_DPR = 2;
const WAYPOINT = '#ffd23f';

/**
 * A circular north-up radar (the camera never rotates, so north-up matches
 * the screen). The city is pre-rendered once (cityMap.ts); each redraw copies
 * the window around the player, then draws nearby cars (faint), pickups,
 * hostile people, blips from other systems and a waypoint route, and the
 * player's arrow. It zooms out with speed. Redraws at most 30 times a second.
 *
 * API for other systems: setBlip(id, {x, z, kind, colour, icon, pulse,
 * edgeArrow}) / removeBlip(id), and setWaypoint(x, z) / clearWaypoint(),
 * which draws a route along the roads and an edge arrow when off-radar.
 */
export class Radar {
  readonly el: HTMLElement;
  /** Off on the title screen: no drawing at all. */
  visible = true;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private map: HTMLCanvasElement | null = null;
  private readonly blips = new Map<string, Blip>();
  /** The same blips as an array: drawing iterates it without allocating. */
  private readonly blipList: Blip[] = [];
  private waypoint: { x: number; z: number } | null = null;
  private readonly route: number[] = [];
  private range = RANGE_FOOT;
  private acc = 1;
  private time = 0;
  private cssSize = 0;
  private dpr = 1;

  constructor(
    parent: HTMLElement,
    private readonly city: City,
    private readonly sources: RadarSources,
  ) {
    const el = document.createElement('div');
    el.id = 'radar';
    el.innerHTML = '<canvas></canvas><span class="radar-n">N</span>';
    parent.append(el);
    this.el = el;
    this.canvas = el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d');
    window.addEventListener('resize', () => (this.cssSize = 0));
  }

  /** Add or move a blip. Options not given keep their previous values. */
  setBlip(id: string, opts: BlipOptions): void {
    const b = this.blips.get(id);
    if (b) {
      Object.assign(b, opts);
      if (opts.kind && !opts.colour) b.colour = BLIP_COLOURS[opts.kind];
      return;
    }
    const kind = opts.kind ?? 'marker';
    const blip: Blip = {
      x: opts.x,
      z: opts.z,
      kind,
      colour: opts.colour ?? BLIP_COLOURS[kind],
      icon: opts.icon ?? '',
      pulse: opts.pulse ?? false,
      edgeArrow: opts.edgeArrow ?? false,
      size: opts.size ?? (opts.icon ? 6 : 4),
    };
    this.blips.set(id, blip);
    this.blipList.push(blip);
  }

  removeBlip(id: string): void {
    const b = this.blips.get(id);
    if (!b) return;
    this.blips.delete(id);
    this.blipList.splice(this.blipList.indexOf(b), 1);
  }

  /** Mark a destination: a route along the roads, and an arrow on the rim when it's off the radar. */
  setWaypoint(x: number, z: number): void {
    this.waypoint = { x, z };
  }

  clearWaypoint(): void {
    this.waypoint = null;
  }

  /**
   * Per frame: the player's position, heading (vehicle convention) and
   * speed (m/s), and the car they're driving (not drawn as traffic).
   */
  update(dt: number, x: number, z: number, heading: number, speed: number, driving: Vehicle | null): void {
    if (!this.visible || !this.ctx) return;
    const want = driving ? Math.min(RANGE_MAX, RANGE_CAR + speed * RANGE_PER_MPS) : RANGE_FOOT;
    this.range += (want - this.range) * (1 - Math.exp(-2.2 * dt));
    this.time += dt;
    this.acc += dt;
    if (this.acc < 1 / RATE) return;
    this.acc = 0;
    if (!this.map) this.map = renderCityMap(this.city);
    if (this.cssSize === 0 && !this.resize()) return;
    this.draw(this.ctx, x, z, heading, driving);
  }

  private resize(): boolean {
    const size = this.el.clientWidth;
    if (size <= 0) return false;
    this.cssSize = size;
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    this.canvas.width = this.canvas.height = Math.round(size * this.dpr);
    return true;
  }

  private draw(ctx: CanvasRenderingContext2D, px: number, pz: number, heading: number, driving: Vehicle | null): void {
    const S = this.canvas.width;
    const R = S / 2;
    const k = R / this.range; // canvas px per metre
    const d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - d, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#090b10';
    ctx.fillRect(0, 0, S, S);
    this.drawMap(ctx, px, pz, k);

    // World → radar: north-up, +Z is down the screen like the camera:
    // (x, z) → (R + (x - px)·k, R + (z - pz)·k). Written out inline, so a
    // redraw allocates nothing.
    const reach = this.range * 1.45;

    if (this.waypoint) this.drawRoute(ctx, px, pz, k, R);

    // Traffic: faint oriented boxes.
    for (const v of this.sources.vehicles) {
      if (v === driving) continue;
      const dx = v.sim.x - px;
      const dz = v.sim.z - pz;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach || !v.mesh.root.visible) continue;
      const c = Math.cos(v.sim.heading);
      const s = Math.sin(v.sim.heading);
      // Rotate so local +Z (the nose) points along (sin h, cos h).
      ctx.setTransform(c, -s, s, c, R + dx * k, R + dz * k);
      ctx.fillStyle = v.damage.wrecked ? 'rgba(20, 20, 24, 0.9)' : v.ai ? 'rgba(225, 230, 240, 0.5)' : 'rgba(225, 230, 240, 0.75)';
      const w = Math.max(2.2 * d, 2 * k);
      const h = Math.max(4 * d, 4.4 * k);
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Pickups.
    for (const p of this.sources.pickups) {
      if (p.respawnAt !== 0 || Math.abs(p.x - px) > reach || Math.abs(p.z - pz) > reach) continue;
      dot(ctx, R + (p.x - px) * k, R + (p.z - pz) * k, 2.8 * d, p.kind === 'health' ? '#5fe08a' : '#ffb02e', d);
    }

    // People who are after the player.
    for (const c of this.sources.crowd) {
      const m = c.agent.mode;
      if (m !== 'fight' && m !== 'shoot') continue;
      const s = c.agent.s;
      if (Math.abs(s.x - px) > reach || Math.abs(s.z - pz) > reach) continue;
      dot(ctx, R + (s.x - px) * k, R + (s.z - pz) * k, 2.6 * d, m === 'shoot' ? '#ff3b4f' : '#ff8a3c', d);
    }

    // Blips (inside the radar; the rest go on the rim below).
    const blips = this.blipList;
    for (let i = 0; i < blips.length; i++) {
      const b = blips[i];
      const bx = R + (b.x - px) * k;
      const by = R + (b.z - pz) * k;
      if (Math.hypot(bx - R, by - R) > R - 6 * d) continue;
      this.drawBlip(ctx, b, bx, by, d);
    }
    if (this.waypoint) {
      const wx = R + (this.waypoint.x - px) * k;
      const wy = R + (this.waypoint.z - pz) * k;
      if (Math.hypot(wx - R, wy - R) <= R - 6 * d) flag(ctx, wx, wy, d);
    }

    // The player: an arrow pointing along their heading.
    ctx.setTransform(Math.cos(heading), -Math.sin(heading), Math.sin(heading), Math.cos(heading), R, R);
    ctx.beginPath();
    ctx.moveTo(0, 7 * d);
    ctx.lineTo(5 * d, -5 * d);
    ctx.lineTo(0, -2.5 * d);
    ctx.lineTo(-5 * d, -5 * d);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = 1.6 * d;
    ctx.stroke();
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.restore();

    // Off-radar blips and the waypoint ride the rim, pointing their way.
    for (let i = 0; i < blips.length; i++) {
      const b = blips[i];
      if (!b.edgeArrow) continue;
      const bx = (b.x - px) * k;
      const by = (b.z - pz) * k;
      if (Math.hypot(bx, by) > R - 6 * d) edgeArrow(ctx, R, bx, by, b.colour, d);
    }
    if (this.waypoint) {
      const wx = (this.waypoint.x - px) * k;
      const wy = (this.waypoint.z - pz) * k;
      if (Math.hypot(wx, wy) > R - 6 * d) edgeArrow(ctx, R, wx, wy, WAYPOINT, d);
    }
  }

  /** Copy the part of the pre-rendered city under the radar (clamped to the map's edges). */
  private drawMap(ctx: CanvasRenderingContext2D, px: number, pz: number, k: number): void {
    const map = this.map!;
    const m = MAP_PX_PER_M;
    const range = this.range;
    // Window in world metres, then intersected with the map.
    let x0 = px - range;
    let z0 = pz - range;
    let x1 = px + range;
    let z1 = pz + range;
    const lo = -MAP_EXTENT;
    const hi = MAP_EXTENT;
    const cx0 = Math.max(lo, x0);
    const cz0 = Math.max(lo, z0);
    const cx1 = Math.min(hi, x1);
    const cz1 = Math.min(hi, z1);
    if (cx1 <= cx0 || cz1 <= cz0) return;
    const dx = (cx0 - x0) * k;
    const dy = (cz0 - z0) * k;
    x0 = cx0;
    z0 = cz0;
    x1 = cx1;
    z1 = cz1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(map, (x0 - lo) * m, (z0 - lo) * m, (x1 - x0) * m, (z1 - z0) * m, dx, dy, (x1 - x0) * k, (z1 - z0) * k);
  }

  private drawRoute(ctx: CanvasRenderingContext2D, px: number, pz: number, k: number, R: number): void {
    const w = this.waypoint!;
    const n = roadRoute(px, pz, w.x, w.z, this.route);
    const r = this.route;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = R + (r[2 * i] - px) * k;
      const y = R + (r[2 * i + 1] - pz) * k;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 5 * this.dpr;
    ctx.stroke();
    ctx.strokeStyle = WAYPOINT;
    ctx.lineWidth = 2.6 * this.dpr;
    ctx.setLineDash([5 * this.dpr, 4 * this.dpr]);
    ctx.lineDashOffset = -this.time * 18 * this.dpr;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawBlip(ctx: CanvasRenderingContext2D, b: Blip, x: number, y: number, d: number): void {
    const r = b.size * d;
    if (b.pulse) {
      const t = (this.time * 1.2) % 1;
      ctx.beginPath();
      ctx.arc(x, y, r + t * 9 * d, 0, Math.PI * 2);
      ctx.strokeStyle = b.colour;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 1.6 * d;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    dot(ctx, x, y, r, b.colour, d);
    if (b.icon) {
      ctx.fillStyle = '#111';
      ctx.font = `900 ${Math.round(r * 1.35)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.icon, x, y + 0.5 * d);
    }
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, d: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.lineWidth = 1.2 * d;
  ctx.stroke();
}

/** The waypoint's flag. */
function flag(ctx: CanvasRenderingContext2D, x: number, y: number, d: number): void {
  dot(ctx, x, y, 5 * d, WAYPOINT, d);
  ctx.beginPath();
  ctx.arc(x, y, 1.8 * d, 0, Math.PI * 2);
  ctx.fillStyle = '#111';
  ctx.fill();
}

/** A triangle on the rim pointing outward along (dx, dy) from the centre. */
function edgeArrow(ctx: CanvasRenderingContext2D, R: number, dx: number, dy: number, colour: string, d: number): void {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const at = R - 7 * d;
  ctx.setTransform(uy, -ux, ux, uy, R + ux * at, R + uy * at);
  ctx.beginPath();
  ctx.moveTo(0, 6 * d);
  ctx.lineTo(5 * d, -4 * d);
  ctx.lineTo(-5 * d, -4 * d);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.lineWidth = 1.4 * d;
  ctx.stroke();
  ctx.fill();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
