/**
 * The V2 incidents on screen (game/scenes/: cashRun, kebab, hydrants,
 * filmShoot), one CityLifeLook part: a burst hydrant's column of water
 * (drops in Effects' soft pool, mist at the top and where it lands) over a
 * wet sheen; the cash van's hazards, the guard's box and the spilled cash
 * (the `cash` model in a pulsing green ring); the kebab shop's warm light
 * spilling onto the pavement at night; the film set's cones (street
 * family), its lights and the staged blast (Effects' explosion: looks
 * only, nothing hurt). Quads in the shared glow batch, particles in the
 * shared pools, models in families already drawn: no mesh, no draw call
 * of its own, nothing allocated per frame (bar a record per new shoot).
 */
import type { CityLife } from '../game/cityLife';
import { CashRuns } from '../game/scenes/cashRun';
import { FilmShoots, type Shoot } from '../game/scenes/filmShoot';
import { Hydrants } from '../game/scenes/hydrants';
import { Kebabs } from '../game/scenes/kebab';
import { carrying, ropePost } from '../systems/incidents';
import type { Rect } from '../world/city';
import type { Vehicle } from '../game/population';
import { near, type CityLookPart } from './cityLifeLook';
import type { Effects } from './effects';
import { FLAG, FRAME, RAMP } from './fxParticles';
import { GLOW, type GlowSprites } from './glowSprites';
import { worldUniforms } from './shaderLib';
import type { WorldProps } from './worldProps';

/** Water drops a second from a hydrant at full strength (times the tier's scale); how high they go, m/s. */
const DROPS = 90;
const LIFT = [8, 12] as const;
const GRAVITY = 9;
/** Cones round a set. */
const POSTS = 14;
const PICTURE_GREY = { r: 0.54, g: 0.56, b: 0.59 };

export function incidentsLook(life: CityLife): CityLookPart {
  const find = <T>(k: abstract new (...a: never[]) => T): T | null => (life.scenes.find((s) => s instanceof k) as T | undefined) ?? null;
  const hydrants = find(Hydrants);
  const cash = find(CashRuns);
  const kebabs = find(Kebabs);
  const films = find(FilmShoots);
  const debt = new Float32Array(4);
  const booms = new WeakMap<Shoot, number>();
  const post = { x: 0, z: 0 };
  let time = 0;
  return {
    update(dt: number, view: Rect, fx: Effects): void {
      time += dt;
      if (hydrants) {
        for (let i = 0; i < hydrants.bursts.length && i < debt.length; i++) {
          const b = hydrants.bursts[i];
          if (!near(view, b.x, b.z, 10) || b.strength <= 0) {
            debt[i] = 0;
            continue;
          }
          debt[i] = geyser(fx, b.x, b.z, b.strength, b.reach, debt[i] + dt * DROPS * b.strength * fx.scale, dt);
        }
      }
      // The staged blast, once for each (a shoot seen first counts what it's had).
      if (films) {
        for (const s of films.shoots) {
          const seen = booms.get(s);
          if (seen === undefined) booms.set(s, s.booms);
          else if (s.booms > seen) {
            booms.set(s, s.booms);
            const v = s.picture.sim;
            if (near(view, v.x, v.z, 12)) fx.explode(v.x, v.z, PICTURE_GREY);
          }
        }
      }
    },
    draw(glows: GlowSprites, view: Rect, props: WorldProps): void {
      const night = worldUniforms.uNight.value;
      const things = props.loaded ? props.things : null;
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      if (hydrants) {
        // A wet sheen on the road round it.
        for (const b of hydrants.bursts) {
          if (!near(view, b.x, b.z, 8)) continue;
          const r = b.reach * 2 + 2;
          const k = (0.1 + 0.12 * night) * Math.min(1, b.age / 2);
          glows.addFlat(b.x, 0.04, b.z, 0, r, r, 0.6 * k, 0.75 * k, 1 * k, GLOW.disc);
        }
      }
      if (cash) {
        const on = time % 0.8 < 0.45;
        for (const r of cash.rounds) {
          if (on && (r.phase === 'stop' || r.phase === 'pull' || r.phase === 'robbed')) hazards(glows, view, r.v);
          const g = r.guard;
          if (!g || !things || !carrying(r.trip.leg) || r.phase !== 'stop') continue;
          const p = g.agent.s;
          if (!near(view, p.x, p.z, 2)) continue;
          things.add('package', p.x + Math.sin(p.heading) * 0.38, 0.95, p.z + Math.cos(p.heading) * 0.38, p.heading, 0.8, 0.6, 0.8);
        }
        for (const b of cash.bundles.list) {
          if (!b.alive || !near(view, b.x, b.z, 2)) continue;
          things?.add('cash', b.x, 0.12, b.z, time * 1.5 + b.x, 1.3, 1.3, 1.3, 0, 0.3);
          const ring = 1.2 + 0.3 * pulse;
          glows.addFlat(b.x, 0.05, b.z, time, ring, ring, 0.35 + 0.3 * pulse, 1.2 + 0.4 * pulse, 0.4, GLOW.ring);
        }
      }
      if (kebabs) {
        // The shop's strip light spilling out of the door, warm (most of it at night).
        for (const k of kebabs.list) {
          const s = k.spot;
          if (!near(view, s.x, s.z, 6)) continue;
          const lit = 0.25 + 0.9 * night;
          const flick = 0.95 + 0.05 * Math.sin(time * 23);
          glows.addFlat(s.x + s.outX * 1.6, 0.05, s.z + s.outZ * 1.6, 0, 6, 6, 1.1 * lit * flick, 0.85 * lit * flick, 0.5 * lit * flick, GLOW.disc);
        }
      }
      if (films) {
        for (const s of films.shoots) {
          if (!near(view, s.x, s.z, 12)) continue;
          if (s.phase === 'shoot') {
            for (let i = 0; i < POSTS; i++) {
              const p = ropePost(i, POSTS, s.x, s.z, s.heading, post);
              props.street.add('traffic_cone', p.x, 0, p.z, s.heading + i);
            }
          }
          // The film lights: a hard white wash on the set (it shows by day too).
          const lit = 0.35 + 0.8 * night;
          glows.addFlat(s.x, 0.05, s.z, s.heading, 9, 18, 0.9 * lit, 0.9 * lit, 0.85 * lit, GLOW.disc);
        }
      }
    },
  };
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
    glows.addFlat(s.x + fx * along + fz * across, 0.9, s.z + fz * along - fx * across, s.heading, 0.9, 0.9, 1.6, 0.75, 0.1, GLOW.disc);
  }
}

/**
 * `debt` drops' worth of a geyser at (x, z): shot up from the stump,
 * spreading to land within about `reach`, mist at the top and splashes
 * where it comes down. Returns the debt left over.
 */
function geyser(fx: Effects, x: number, z: number, strength: number, reach: number, debt: number, dt: number): number {
  const pool = fx.soft;
  while (debt >= 1) {
    debt -= 1;
    const vy = (LIFT[0] + Math.random() * (LIFT[1] - LIFT[0])) * (0.5 + 0.5 * strength);
    const t = (2 * vy) / GRAVITY;
    const a = Math.random() * Math.PI * 2;
    const out = (Math.random() * reach) / t;
    const age = Math.random() * Math.min(dt, t * 0.5);
    const vx = Math.cos(a) * out;
    const vz = Math.sin(a) * out;
    const i = pool.spawn(x + vx * age, 0.5 + (vy - (GRAVITY * age) / 2) * age, z + vz * age, vx, vy - GRAVITY * age, vz, t - age, 0.7, 1.2, RAMP.flat, FRAME.dot);
    if (i < 0) return 0;
    pool.r[i] = 0.86;
    pool.g[i] = 0.94;
    pool.b[i] = 1;
    pool.alpha[i] = 0.85;
    pool.gravity[i] = GRAVITY;
    pool.drag[i] = 0;
    pool.flags[i] = FLAG.stretch;
    pool.stretch[i] = 0.06;
  }
  const top = (LIFT[1] * LIFT[1] * strength) / (2 * GRAVITY);
  if (Math.random() < dt * 6 * strength * fx.scale) fx.puff(x + (Math.random() - 0.5), 0.5 + top * 0.8, z + (Math.random() - 0.5), 0.95, 1, 3.2, 0.4, 0, -0.4, 0, 1.4);
  if (Math.random() < dt * 5 * strength * fx.scale) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * reach;
    fx.puff(x + Math.cos(a) * r, 0.2, z + Math.sin(a) * r, 0.95, 0.6, 1.8, 0.35, 0, 0.6, 0, 0.8);
  }
  return debt;
}
