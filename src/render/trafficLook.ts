/**
 * The traffic scenes' look (game/scenes/: races, accidents, double-parked
 * trucks), as parts for CityLifeLook: a racer's nitro is a flare of
 * exhaust flame through Effects' pools; hazard lights on crashed cars and
 * double-parked trucks blink in the shared glow batch; the courier's
 * parcel is the props' `package` model (the `things` family), the garbage
 * crew's bins the kerbside `trash_bin` (the `street` family, which is in
 * view nearly everywhere). No mesh or program of its own; nothing
 * allocates per frame. Police lights are the cars'
 * own (CarMesh.siren).
 */
import type { Rect } from '../world/city';
import type { StreetRaces } from '../game/scenes/streetRaces';
import type { Accidents } from '../game/scenes/accidents';
import type { DoubleParking } from '../game/scenes/doubleParking';
import type { Vehicle } from '../game/population';
import type { CityLookPart } from './cityLifeLook';
import { near } from './cityLifeLook';
import type { Effects } from './effects';
import { GLOW, type GlowSprites } from './glowSprites';
import type { WorldProps } from './worldProps';

/** Nitro: flame flares per second out of each tailpipe. */
const FLARE_RATE = 60;

/** Street racers' nitro: exhaust flame while it burns. */
export class RaceLook implements CityLookPart {
  private debt = 0;

  constructor(private readonly races: StreetRaces) {}

  update(dt: number, view: Rect, fx: Effects): void {
    this.debt = Math.min(4, this.debt + dt * FLARE_RATE);
    const n = Math.floor(this.debt);
    if (n <= 0) return;
    this.debt -= n;
    for (const r of this.races.races) {
      for (const racer of r.racers) {
        if (racer.nitro <= 0 || racer.done) continue;
        const v = racer.v;
        const s = v.sim;
        if (!near(view, s.x, s.z, 6)) continue;
        const root = v.mesh.root.position;
        const fx0 = Math.sin(s.heading);
        const fz0 = Math.cos(s.heading);
        const back = (s.body?.reach ?? 2.3) + 0.2;
        const bx = root.x - fx0 * back;
        const bz = root.z - fz0 * back;
        for (let k = 0; k < n; k++) {
          const side = k % 2 ? 0.42 : -0.42;
          fx.flare(bx + Math.cos(s.heading) * side, 0.5 + root.y, bz - Math.sin(s.heading) * side, 0.45 + Math.random() * 0.3, 0.06, 0.9, 1.4, 3.2);
        }
      }
    }
  }
}

/** Hazard lights on crashed cars and double-parked trucks; the courier's parcels, the crew's bins. */
export class RoadsideLook implements CityLookPart {
  private time = 0;

  constructor(
    private readonly accidents: Accidents,
    private readonly parking: DoubleParking,
  ) {}

  update(dt: number): void {
    this.time += dt;
  }

  draw(glows: GlowSprites, view: Rect, props: WorldProps): void {
    // A hazard blink: on 0.45 s, off 0.35 s.
    const on = this.time % 0.8 < 0.45;
    for (const c of this.accidents.list) {
      if (c.phase === 'closing' || !on) continue;
      if (c.a.towable && !c.a.ai) hazards(glows, view, c.a);
      if (c.b.towable && !c.b.ai) hazards(glows, view, c.b);
    }
    // The player's mess (V2-10): the other car, once its driver's out.
    if (on) for (const m of this.accidents.mine) if (m.car.towable && !m.car.ai) hazards(glows, view, m.car);
    if (!props.loaded) return;
    for (const s of this.parking.stops) {
      const working = s.phase === 'work' || s.phase === 'back';
      if (on && working) hazards(glows, view, s.truck);
      const garbage = s.job === 'garbage';
      for (const c of s.crew) {
        const p = c.ped.agent.s;
        if (c.carrying) {
          if (!near(view, p.x, p.z, 2)) continue;
          // Held (or wheeled) in front.
          const x = p.x + Math.sin(p.heading) * (garbage ? 0.55 : 0.38);
          const z = p.z + Math.cos(p.heading) * (garbage ? 0.55 : 0.38);
          // A bin goes in the street family (always drawn): no draw call of its own.
          if (garbage) props.street.add('trash_bin', x, 0, z, p.heading);
          else props.things.add('package', x, 1.0, z, p.heading);
        } else if (garbage && working && near(view, c.x, c.z, 2)) props.street.add('trash_bin', c.x, 0, c.z, s.heading);
      }
    }
  }
}

/** Four amber blinkers at the corners of `v`. */
function hazards(glows: GlowSprites, view: Rect, v: Vehicle): void {
  const s = v.sim;
  if (!v.mesh.root.visible || !near(view, s.x, s.z, 4)) return;
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  const reach = (s.body?.reach ?? 2.3) - 0.15;
  const half = (s.body?.halfWidth ?? 0.95) - 0.1;
  for (let k = 0; k < 4; k++) {
    const along = k < 2 ? reach : -reach;
    const across = k % 2 ? half : -half;
    const x = s.x + fx * along + fz * across;
    const z = s.z + fz * along - fx * across;
    glows.addFlat(x, 0.9, z, s.heading, 0.9, 0.9, 1.6, 0.75, 0.1, GLOW.disc);
  }
}
