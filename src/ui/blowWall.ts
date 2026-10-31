/**
 * BLOW A WALL, the destruction test's repeatable measurement: a harmless
 * rocket blast at the camera-facing wall ahead of the player whose crater
 * will show. Only the explosion event: the fireball, boom and breach follow
 * as usual, but nobody is hurt, nothing is shoved or set alight, and heat
 * and score ignore it (not byPlayer). From the Diagnostics sheet it is
 * checked while paused and goes off on the first frame of play (sound,
 * hit-stop and all); fire() sets it off now (window.__ub). Which wall is
 * systems/breaches.ts wallToBlow; what stops it, destructionProbe.ts.
 */
import { Vector3, type Camera } from 'three';
import type { EventBus } from '../core/events';
import type { DestructionStats } from '../render/destruction';
import { getQuality } from '../render/quality';
import { wallToBlow, type Breaches, type WallAhead } from '../systems/breaches';
import type { Rect } from '../world/city';
import { blowWallBlocker, clearOfHud } from './destructionProbe';

export interface BlowWallDeps {
  events: EventBus;
  breaches: Breaches;
  /** The player: their car while driving. */
  player: { readonly position: { x: number; z: number }; readonly driving: { sim: { heading: number } } | null; readonly ped: { heading: number } };
  rig: { readonly camera: Camera; readonly focusX: number; readonly focusZ: number; visibleGround(out: Rect): Rect };
  /** Behind the title: nobody is playing. */
  attract(): boolean;
  stats(): DestructionStats;
  log(kind: string, detail?: string): void;
  setPaused(paused: boolean): void;
}

export class BlowWall {
  /** Pressed on the paused sheet: it goes off at the next update() (the first frame of play). */
  private pending = false;
  private readonly view: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  private readonly wall: WallAhead = { building: -1, side: 0, x: 0, z: 0, dist: 0, offScreen: false };
  private readonly top = new Vector3();

  constructor(private readonly d: BlowWallDeps) {}

  /** The sheet's button: queue it and resume play, or say why not (shown under the pads). */
  request(): string | null {
    const blocked = blowWallBlocker(this.d.stats(), getQuality().name);
    if (blocked) return blocked;
    if (this.d.attract()) return 'Start a run first';
    const w = this.inView();
    if (!w) return 'No wall within 40 m: walk up to a building';
    if (w.offScreen) return 'No crater would show: stand 3–4 m from a wall, facing it';
    this.pending = true;
    this.d.setPaused(false);
    return null;
  }

  /** Per frame, before the sim: a queued blast goes off now that play has resumed. */
  update(): void {
    if (!this.pending) return;
    this.pending = false;
    this.fire();
  }

  /** The blast at the wall ahead, now; the face, or null with no wall within 40 m. */
  fire(): WallAhead | null {
    const w = this.inView();
    if (!w) return null;
    const d = this.d;
    d.log('blow-wall', `building ${w.building} side ${w.side} ${w.dist.toFixed(1)} m${w.offScreen ? ' off-screen' : ''} · ${getQuality().name}`);
    d.events.emit({ type: 'explosion', x: w.x, z: w.z, distance: Math.hypot(d.rig.focusX - w.x, d.rig.focusZ - w.z), byPlayer: false, source: 'rocket' });
    return w;
  }

  /** The camera-facing wall ahead whose crater will show, else the nearest within 40 m (offScreen), else null. */
  private inView(): WallAhead | null {
    const p = this.d.player;
    const at = p.position;
    const heading = p.driving ? p.driving.sim.heading : p.ped.heading;
    const cam = this.d.rig.camera.position;
    return wallToBlow(this.d.breaches, at.x, at.z, heading, cam.x, cam.z, this.d.rig.visibleGround(this.view), this.wall, this.onScreen);
  }

  /** A point (the top of the crater) shows on screen, clear of the pause button and the radar. */
  private readonly onScreen = (x: number, y: number, z: number): boolean => {
    const p = this.top.set(x, y, z).project(this.d.rig.camera);
    if (p.z > 1) return false;
    const w = innerWidth;
    const h = innerHeight;
    const hud = [...document.querySelectorAll('.hud-pause, #radar')].map((el) => el.getBoundingClientRect());
    return clearOfHud((p.x + 1) * 0.5 * w, (1 - p.y) * 0.5 * h, w, h, hud);
  };
}
