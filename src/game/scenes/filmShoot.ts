/**
 * A film shoot in Glass Heights. By day and evening (FILM_HOURS) a set is
 * roped off at the kerb near the player, out of view (systems/incidents.ts
 * SET_HALF: the parking strip and the pavement, cones along its ends and
 * road side, film lights on it): the star car (a red sports car) and the
 * picture car (the one that goes up) parked in it, a director (red beret)
 * and a clapper, and two extras as police: the force's colours with a tell
 * (a passer-by's build, no kit, the shirt a costume-shop blue and the cap
 * the wrong blue). Passers-by stop to
 * watch from either end. Each take (TAKE): they get to their marks, ACTION
 * (`action`: the clapperboard and a sting), the extras run at the picture
 * car, the staged blast (`pyro`: Effects' explosion, nothing hurt, the car
 * left smoking), the crowd cheers, CUT, the car's re-dressed and again.
 *
 * Making it real: drive onto the set or into its cars, steal either car,
 * or start a real fight (knock someone down on it, fire a gun nearby, a
 * real blast): THAT'S A WRAP on the score (deps.award), the fake police
 * and the crew scatter, the crowd runs, and the real police get the call
 * (about a star: deps.callIn). Holds: HOLD below.
 */
import { IN_PLAY, type SceneHold } from '../../systems/cityScenes';
import { scare } from '../../systems/crowd';
import { COP_OUTFIT } from '../../systems/police';
import {
  FILM_CLOCK,
  FILM_DISTRICT,
  FILM_HOURS,
  FILM_SECONDS,
  REAL_CALL,
  SET_CRASH_SPEED,
  SET_HALF,
  SET_OFFSET,
  TAKE,
  inHours,
  madeReal,
  onSet,
  takePhase,
  type TakePhase,
} from '../../systems/incidents';
import { clearOf } from '../../systems/trafficScenes';
import { BLOCK_SIZE, ROAD_WIDTH } from '../../world/city';
import { districtAt } from '../../world/districts';
import { dirHeading, type Dir } from '../../world/roads';
import { PARK_OFFSET, roadPoint, segmentValid } from '../../world/streetSpots';
import type { CrowdPed, Vehicle } from '../population';
import { watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { labelMembers, secs, type LabelSink } from '../debugLabels';
import { Gathering } from './gathering';
import { handBack, roomFor, streetBody } from './people';
import { len2 } from '../../core/len';

/** Parked at the kerb, nobody in the road, no fight of its own: it waits only on someone playing. */
const HOLD: readonly SceneHold[] = IN_PLAY;
/** The set goes up this far from the player (out of view), m. */
const PICK = [30, 110] as const;
/** Where on its block the set sits (metres before the junction ahead). */
const SET_ALONG = 32;
const DIRECTOR = { shirt: '#1f1f22', pants: '#c9b48a', hair: '#c43b3b' };
const CLAPPER = { shirt: '#f2f2ee', pants: '#2b2b2b' };
/** The extras: police blue, but a shade too bright, and the cap the wrong blue entirely. */
export const FAKE_COP = { ...COP_OUTFIT, shirt: '#3d63c9', hair: '#4f8fff' };
const HERO_PAINT = '#d0262b';
const PICTURE_PAINT = '#8a8f96';
/** Gunfire this close to the set, or a real blast, makes it real, m. */
const SHOT_RANGE = 30;
const BLAST_RANGE = 22;
/** Once it's real, everyone's gone in this long, s. */
const SCATTER = 8;
/** The director, the clapper and the two extras: all it needs room for (the crowd only gathers while there's room). */
const CREW = 4;

type Phase = 'shoot' | 'real';

export interface Shoot {
  x: number;
  z: number;
  /** The lane's heading (the kerb on its right). */
  heading: number;
  hero: Vehicle;
  picture: Vehicle;
  director: CrowdPed;
  clapper: CrowdPed;
  cops: CrowdPed[];
  crowd: Gathering;
  phase: Phase;
  age: number;
  length: number;
  /** Seconds into the take. */
  take: number;
  takes: number;
  /** Staged blasts so far (the look sets one off for each). */
  booms: number;
  made: 'stolen' | 'fight' | 'wrecked' | null;
  realT: number;
  recruitIn: number;
}

export class FilmShoots implements Scene {
  readonly kind = 'filmShoot';
  readonly shoots: Shoot[] = [];
  private scan = 0;
  private readonly p = { x: 0, z: 0 };
  /** The player's doing this step (from the bus), read by the next step. */
  private fight = false;
  private crash = false;

  constructor(private readonly life: SceneCtx) {
    life.clock.define('filmShoot', { ...FILM_CLOCK, hold: HOLD });
    const bus = life.d.bus;
    bus.on('pedDown', (e) => {
      if (e.byPlayer && !e.isPlayer && this.near(e.x, e.z, 6)) this.fight = true;
    });
    bus.on('shot', (e) => {
      if (e.byPlayer && this.near(e.x, e.z, SHOT_RANGE)) this.fight = true;
    });
    bus.on('explosion', (e) => {
      if (e.byPlayer && this.near(e.x, e.z, BLAST_RANGE)) this.fight = true;
    });
    bus.on('crash', (e) => {
      if (e.involvesPlayer && this.near(e.x, e.z, 2)) this.crash = true;
    });
  }

  get running(): number {
    return this.shoots.length;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 1.5;
      if (life.due('filmShoot', this.shoots.length)) this.look();
    }
    for (let i = this.shoots.length - 1; i >= 0; i--) {
      if (this.stepOne(this.shoots[i], dt)) continue;
      this.end(this.shoots[i]);
      this.shoots.splice(i, 1);
    }
    this.fight = false;
    this.crash = false;
  }

  reset(): void {
    for (const s of this.shoots) this.end(s);
    this.shoots.length = 0;
  }

  describe(out: LabelSink): void {
    for (const s of this.shoots) {
      if (out.wants(s.x, s.z)) out.spot(s, s.phase === 'real' ? 'FILM SET (it got real)' : `FILM SET ${takePhase(s.take).toUpperCase()} · take ${s.takes} · ${secs(s.length - s.age)}`, 'people');
      out.ped(s.director, 'DIRECTOR', 'people');
      out.ped(s.clapper, 'CLAPPER', 'people');
      for (const c of s.cops) out.ped(c, 'EXTRA (fake cop)', 'people');
      out.car(s.hero, 'STAR CAR', 'traffic');
      out.car(s.picture, 'PICTURE CAR (pyro)', 'traffic');
      labelMembers(out, s.crowd.members, 'WATCHING', false);
    }
  }

  /** The set (the picture car when it goes up). */
  subject(out: Subject): boolean {
    const s = this.shoots[0];
    if (!s) return false;
    const ph = takePhase(s.take);
    if (ph === 'boom' || ph === 'action') return watch(out, (s.picture.sim.x + s.x) / 2, (s.picture.sim.z + s.z) / 2);
    return watch(out, s.x, s.z);
  }

  /** Is (x, z) within `pad` of a set? */
  near(x: number, z: number, pad: number): boolean {
    for (const s of this.shoots) if (s.phase === 'shoot' && onSet(x, z, s.x, s.z, s.heading, pad)) return true;
    return false;
  }

  /** Debug (TEST menu) and the title's show: a set up at the kerb nearest the player now (any district, any hour). */
  force(): boolean {
    if (this.shoots.length > 0) return false;
    const spot = this.findSpot(true);
    if (!spot) return false;
    const s = this.start(spot[0], spot[1], spot[2], spot[3]);
    // Straight to a take.
    s.take = TAKE.action - 3;
    return true;
  }

  // --- Internals ---

  private look(): void {
    const life = this.life;
    const hour = life.d.hour?.() ?? life.d.mood?.hour ?? 13;
    const at = life.d.focus();
    if (!inHours(hour, FILM_HOURS) || districtAt(at.x, at.z) !== FILM_DISTRICT || !roomFor(life, CREW)) {
      life.clock.defer('filmShoot', life.now, 12);
      return;
    }
    const spot = this.findSpot(false);
    if (!spot) {
      life.clock.defer('filmShoot', life.now, 6);
      return;
    }
    this.start(spot[0], spot[1], spot[2], spot[3]);
  }

  /** A kerb mid-block round the player with nothing parked there and nothing to keep clear of. `forced`: nearest, anywhere, in view or not. */
  private findSpot(forced: boolean): [number, number, Dir, number] | null {
    const life = this.life;
    const at = life.d.focus();
    const cx = Math.round(at.x / BLOCK_SIZE);
    const cz = Math.round(at.z / BLOCK_SIZE);
    let best: [number, number, Dir, number] | null = null;
    let bestD = Infinity;
    const r = forced ? 1 : 2;
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iz = cz - r; iz <= cz + r; iz++)
        for (let dir = 0 as Dir; dir < 4; dir++) {
          if (!segmentValid(ix, iz, dir)) continue;
          const p = roadPoint(ix, iz, dir, SET_ALONG, SET_OFFSET, this.p);
          const d = life.distance(p.x, p.z);
          if (forced ? d < 12 || d > 80 : d < PICK[0] || d > PICK[1] || life.inView(p.x, p.z, 12) || districtAt(p.x, p.z) !== FILM_DISTRICT) continue;
          if (life.crowded(p.x, p.z, SET_HALF[0] + 1) || !clearOf(p.x, p.z, life.d.avoid)) continue;
          let stop = false;
          for (const b of life.stops) if (len2(b.x - p.x, b.z - p.z) < 22) stop = true;
          if (stop) continue;
          // Forced: the nearest; else a random one of those that'll do.
          const score = forced ? d : life.d.rand();
          if (score < bestD) {
            bestD = score;
            best = [ix, iz, dir, SET_ALONG];
          }
        }
    return best;
  }

  private start(ix: number, iz: number, dir: Dir, along: number): Shoot {
    const life = this.life;
    life.clock.start('filmShoot', life.now);
    const rand = life.d.rand;
    const heading = dirHeading(dir);
    const c = roadPoint(ix, iz, dir, along, SET_OFFSET, { x: 0, z: 0 });
    const car = (k: number, archetype: 'sports' | 'sedan', paint: string): Vehicle => {
      const p = roadPoint(ix, iz, dir, along + k, PARK_OFFSET, this.p);
      const v = life.placeCar(archetype, paint, p.x, p.z, heading);
      // Parked for the shoot: nobody at the wheel.
      v.ai = null;
      return v;
    };
    const hero = car(5, 'sports', HERO_PAINT);
    const picture = car(-5, 'sedan', PICTURE_PAINT);
    // The crew on the pavement side of the set.
    const crewAt = (k: number): { x: number; z: number } => roadPoint(ix, iz, dir, along + k, ROAD_WIDTH / 2 + 1.4, { x: 0, z: 0 });
    const d = crewAt(0);
    const director = life.addPed(d.x, d.z, heading, DIRECTOR, streetBody(life, true));
    const k = crewAt(-2.5);
    const clapper = life.addPed(k.x, k.z, heading, CLAPPER, streetBody(life, true));
    const cops: CrowdPed[] = [];
    for (const off of [3, 6.5]) {
      const q = crewAt(off);
      // A passer-by's build in the force's colours: the costume shows.
      const cop = life.addPed(q.x, q.z, heading + Math.PI, FAKE_COP, streetBody(life, true));
      cops.push(cop);
    }
    for (const p of [director, clapper, ...cops]) p.agent.street = true;
    // Watching from either end of the set, on the pavement.
    const crowd = new Gathering(life, {
      kind: 'crowd',
      capacity: 8,
      draw: 28,
      joinChance: 0.55,
      stay: [18, 40],
      place: (i, out) => {
        const end = i % 2 ? 1 : -1;
        const row = i >> 1;
        const p = roadPoint(ix, iz, dir, along + end * (SET_HALF[0] + 1.2 + (row >> 1) * 0.9), ROAD_WIDTH / 2 + 1 + (row & 1) * 1.2, this.p);
        out.x = p.x;
        out.z = p.z;
        out.heading = Math.atan2(c.x - p.x, c.z - p.z);
        return out;
      },
    });
    const s: Shoot = {
      x: c.x,
      z: c.z,
      heading,
      hero,
      picture,
      director,
      clapper,
      cops,
      crowd,
      phase: 'shoot',
      age: 0,
      length: FILM_SECONDS[0] + rand() * (FILM_SECONDS[1] - FILM_SECONDS[0]),
      take: 0,
      takes: 1,
      booms: 0,
      made: null,
      realT: 0,
      recruitIn: 0,
    };
    this.shoots.push(s);
    return s;
  }

  /** One shoot's step; false when it's wrapped (or it got real and everyone's gone). */
  private stepOne(s: Shoot, dt: number): boolean {
    const life = this.life;
    s.age += dt;
    if (s.phase === 'real') return (s.realT += dt) < SCATTER;
    // Has the player made it real?
    const p = life.d.player;
    const car = p.driving;
    const fast = car !== null && car.sim.vx * car.sim.vx + car.sim.vz * car.sim.vz > SET_CRASH_SPEED * SET_CRASH_SPEED;
    const made = life.d.playing()
      ? madeReal({
          heroTaken: car !== null && (car === s.hero || car === s.picture),
          realFight: this.fight,
          setHit: this.crash || (fast && onSet(car.sim.x, car.sim.z, s.x, s.z, s.heading)),
        })
      : null;
    if (made) {
      this.real(s, made);
      return true;
    }
    if (!life.present(s.director) || s.director.agent.mode === 'down' || s.age > s.length + 6) return false;
    // Its cars recycled (the player long gone) or blown up for real: that's the day done.
    if (!s.hero.mesh.root.visible || !s.picture.mesh.root.visible || s.picture.damage.wrecked || s.hero.damage.wrecked) return false;
    const was = takePhase(s.take);
    s.take += dt;
    if (s.take >= TAKE.end) {
      // Re-dressed: the picture car good as new, round again (or that's a wrap for today).
      s.take = 0;
      s.takes++;
      s.picture.damage.health = s.picture.damage.maxHealth;
      if (s.age > s.length) return false;
    }
    const now = takePhase(s.take);
    if (now !== was) this.cue(s, now);
    this.direct(s, now);
    if ((s.recruitIn -= dt) <= 0) {
      s.recruitIn = 1;
      if (life.lively('filmShoot') && roomFor(life, 2)) s.crowd.recruit();
    }
    s.crowd.step(dt);
    return true;
  }

  /** The moments of a take. */
  private cue(s: Shoot, phase: TakePhase): void {
    const life = this.life;
    switch (phase) {
      case 'action':
        life.emit('action', s.clapper.agent.s.x, s.clapper.agent.s.z);
        s.clapper.model.punch(0);
        s.director.model.hail(1);
        break;
      case 'boom': {
        const v = s.picture.sim;
        s.booms++;
        // Left smoking (not burning): the usual damage look.
        s.picture.damage.health = s.picture.damage.maxHealth * 0.35;
        life.emit('pyro', v.x, v.z);
        for (const c of s.crowd.members) c.model.cheer(2);
        s.director.model.cheer(2);
        break;
      }
      case 'cut':
        s.director.model.hail(1.2);
        break;
    }
  }

  /** Everyone to their marks: the extras by the star car, then running at the picture car on ACTION. */
  private direct(s: Shoot, phase: TakePhase): void {
    const life = this.life;
    const px = s.picture.sim.x;
    const pz = s.picture.sim.z;
    this.mark(s, 0, 1.2);
    this.hold(s.director, this.p.x, this.p.z, px, pz);
    this.mark(s, phase === 'setup' ? -3 : -7, 0.6);
    this.hold(s.clapper, this.p.x, this.p.z, px, pz);
    for (let i = 0; i < s.cops.length; i++) {
      const run = phase === 'action';
      this.mark(s, run ? -1.5 - i * 1.4 : 4 + i * 2.5, run ? -0.2 : 0.4);
      this.hold(s.cops[i], this.p.x, this.p.z, px, pz);
      if (run && life.d.rand() < 0.02) s.cops[i].model.hail(0.6);
    }
  }

  /** A mark on the set `k` m along the kerb from its middle, `out` m toward the shops (into this.p). */
  private mark(s: Shoot, k: number, out: number): void {
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    // Right of the lane: toward the shops.
    this.p.x = s.x + fx * k - fz * out;
    this.p.z = s.z + fz * k + fx * out;
  }

  private hold(c: CrowdPed, x: number, z: number, lx: number, lz: number): void {
    const a = c.agent;
    if (!this.life.present(c) || a.mode === 'down' || a.mode === 'flee' || a.mode === 'fight' || a.mode === 'shoot') return;
    this.life.walkTo(c, x, z);
    this.life.lookAt(c, lx, lz);
  }

  /** It got real: the extras and the crew scatter, the crowd runs, the real police get the call. */
  private real(s: Shoot, how: 'stolen' | 'fight' | 'wrecked'): void {
    const life = this.life;
    s.phase = 'real';
    s.made = how;
    s.realT = 0;
    const me = life.d.player.position;
    for (const c of [s.director, s.clapper, ...s.cops, ...s.crowd.members]) {
      if (!life.present(c) || c.agent.mode === 'down') continue;
      life.unfight(c);
      c.agent.mode = 'walk';
      scare(c.agent, me.x, me.z, 6);
    }
    s.crowd.close();
    life.d.award?.('wrapped');
    for (const crime of REAL_CALL) life.d.callIn?.(crime);
  }

  /** Wrapped: the crew walk off, the cars are left (recycled once far off and unseen). */
  private end(s: Shoot): void {
    const life = this.life;
    s.crowd.close();
    for (const c of [s.director, s.clapper, ...s.cops]) handBack(life, c);
    s.cops.length = 0;
  }
}
