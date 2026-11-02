/**
 * Street races between NPCs, mostly at night. Now and then (not during a
 * timed race or a mission that asks; less often while the player is
 * wanted, and then sometimes on the road ahead of them) three to
 * five fast cars line up nose to tail on a lane off-screen near the player
 * and race a route of junctions (systems/trafficScenes.ts raceRoute:
 * mostly long straights) flat out: overtaking through the oncoming lane,
 * running the lights, cornering hard, a flare of nitro on the straights.
 * The first through the last junction wins (a long blast on the horn);
 * then they slow back down into traffic and go their ways. Sometimes the
 * police turn up and one of them is chased (scenes/chases.ts pursue()).
 * Crashes are real: a racer that wrecks is out.
 *
 * How often: a due race goes ahead with raceOdds(hour) (every one in the
 * dead of night, a quarter by day), else it's put off.
 */
import { CRUISE_SPEED, TURN_SPEED, createDriver, driveAi, type Obstacle } from '../../systems/traffic';
import { BUSY, WANTED_PACE } from '../../systems/cityScenes';
import {
  NITRO_CHANCE,
  NITRO_FROM,
  NITRO_SECONDS,
  RACE_CHASED,
  raceOdds,
  raceRoute,
  routeIndex,
  routeTurn,
  type RouteNode,
} from '../../systems/trafficScenes';
import { forwardSpeed, type VehicleArchetype, type VehicleControls } from '../../entities/vehicle';
import type { SceneDriver, Vehicle } from '../population';
import { SCENE_DROP, watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { incident, type Chases } from './chases';
import { raceRank, racing, type LabelSink } from '../debugLabels';

/** Racers: how many, how fast (cruise on the straights / through corners), m/s. */
const RACERS = [3, 5] as const;
const RACE_CRUISE = 29;
const RACE_TURN = 11;
/** Junctions on the route. */
const LEGS = [4, 6] as const;
/** Gap between cars on the grid, m. */
const GRID_GAP = 10;
/** A race not finished by now is over, s. */
const RACE_TIMEOUT = 90;
/** The police turn up this far into a race they're coming to, s. */
const POLICE_AFTER = [7, 14] as const;
/** One model (the sports car) in the racers' own paint: at most one draw call (and its shadow) for the pack. */
const RACE_CARS: readonly VehicleArchetype[] = ['sports'];
const RACE_PAINTS = ['#ff2e88', '#2ee6ff', '#c6ff3a', '#ff8a1a', '#a64dff', '#f2f2f2', '#ffd23f'];
/**
 * Race odds × this: the nightlife where the player is (game/cityMood.ts nightlifeAt: 0 by day, up to 1 in
 * the Neon Mile at night), so races cluster round the nightlife: 0.75× by day or in a quiet district, 1.5× at its height.
 */
const nightlife = (life: SceneCtx): number => {
  const mood = life.d.mood;
  if (!mood) return 1;
  const at = life.d.player.position;
  return 0.75 + 0.75 * mood.nightlifeAt(at.x, at.z);
};

export interface Racer {
  v: Vehicle;
  /** Index of the furthest route node it has driven to. */
  leg: number;
  done: boolean;
  /** Seconds of nitro left (the look draws the flare). */
  nitro: number;
}

export interface StreetRace {
  route: RouteNode[];
  racers: Racer[];
  age: number;
  winner: Vehicle | null;
  /** Seconds until the police turn up (Infinity: they won't). */
  police: number;
}

export class StreetRaces implements Scene {
  readonly races: StreetRace[] = [];
  private scan = 0;
  /** The racer subject() is on. */
  private watched: Vehicle | null = null;
  private readonly out: VehicleControls = { throttle: 0, steer: 0, handbrake: false, boost: false };

  constructor(
    private readonly life: SceneCtx,
    private readonly chases: Chases,
  ) {
    life.clock.define('race', { every: [90, 170], cap: 1, first: 50, range: 150, hold: BUSY, pace: WANTED_PACE, ahead: true });
  }

  get running(): number {
    return this.races.length;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 1;
      if (life.due('race', this.races.length) && !incident(life)) {
        // By day most are put off; deep in the night every one goes ahead.
        if (life.d.rand() < raceOdds(life.d.hour?.() ?? 12, nightlife(life))) this.begin();
        else life.clock.defer('race', life.now, 20 + life.d.rand() * 25);
      }
    }
    for (let i = this.races.length - 1; i >= 0; i--) {
      const r = this.races[i];
      r.age += dt;
      let left = 0;
      let lead: Vehicle | null = null;
      for (const racer of r.racers) {
        if (racer.done) continue;
        const v = racer.v;
        if (life.lost(v) || v.scene !== this.driver) {
          racer.done = true;
          if (v.scene === this.driver) life.release(v);
          continue;
        }
        if (racer.nitro > 0) racer.nitro -= dt;
        else if (racer.leg > 0 && forwardSpeed(v.sim) > NITRO_FROM && v.ai?.phase === 'approach' && v.ai.next === v.ai.dir && life.d.rand() < NITRO_CHANCE * dt) racer.nitro = NITRO_SECONDS;
        left++;
        if (!lead || racer.leg > 0) lead = v;
      }
      if (left > 0 && (r.police -= dt) <= 0) this.callPolice(r);
      const far = !lead || (life.distance(lead.sim.x, lead.sim.z) > SCENE_DROP && !life.inView(lead.sim.x, lead.sim.z, 4));
      if (left === 0 || r.age > RACE_TIMEOUT || far) {
        for (const racer of r.racers) this.letGo(racer);
        this.races.splice(i, 1);
      }
    }
  }

  reset(): void {
    for (const r of this.races) for (const racer of r.racers) this.letGo(racer);
    this.races.length = 0;
  }

  describe(out: LabelSink): void {
    for (const r of this.races) {
      const n = racing(r.racers);
      for (let i = 0; i < r.racers.length; i++) {
        const v = r.racers[i].v;
        if (r.racers[i].done) {
          if (v === r.winner) out.car(v, 'RACE WINNER', 'traffic');
        } else if (out.wants(v.sim.x, v.sim.z)) out.car(v, `RACER ${raceRank(r.racers, i)}/${n}`, 'traffic');
      }
    }
  }

  /** The leader (kept while it's in the top two, so an overtake doesn't swing the view), then the winner. */
  subject(out: Subject): boolean {
    const r = this.races[0];
    if (!r) return false;
    let v = r.winner;
    let kept = -1;
    for (let i = 0; i < r.racers.length; i++) if (r.racers[i].v === this.watched) kept = i;
    if (!v && kept >= 0 && !r.racers[kept].done && raceRank(r.racers, kept) <= 2) v = this.watched;
    for (let i = 0; i < r.racers.length && !v; i++) if (raceRank(r.racers, i) === 1) v = r.racers[i].v;
    this.watched = v;
    if (!v) return false;
    const s = v.sim;
    return watch(out, s.x, s.z, s.vx, s.vz);
  }

  /** Line one up now (tests, __ub): false if there was nowhere to. */
  begin(): boolean {
    const life = this.life;
    const rand = life.d.rand;
    if (this.races.length > 0) return false;
    const lead = life.spawnCar(RACE_CARS[Math.floor(rand() * RACE_CARS.length)], RACE_PAINTS[Math.floor(rand() * RACE_PAINTS.length)], 0.8);
    if (!lead || !lead.ai) {
      life.clock.defer('race', life.now, 5);
      return false;
    }
    const ai = lead.ai;
    // From the junction the leader is driving to, then the legs on from it.
    const legs = LEGS[0] + Math.floor(rand() * (LEGS[1] - LEGS[0] + 1));
    const route = [{ ix: ai.ix, iz: ai.iz, dir: ai.dir }, ...raceRoute(ai.ix, ai.iz, ai.dir, legs, rand)];
    if (route.length < 4) {
      life.retire(lead);
      life.clock.defer('race', life.now, 5);
      return false;
    }
    life.clock.start('race', life.now);
    const race: StreetRace = { route, racers: [], age: 0, winner: null, police: Infinity };
    this.enter(race, lead);
    // The rest of the grid, nose to tail behind the leader, out of view.
    const n = RACERS[0] + Math.floor(rand() * (RACERS[1] - RACERS[0] + 1));
    const s = lead.sim;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    for (let i = 1; i < n; i++) {
      const back = GRID_GAP * i;
      const x = s.x - fx * back;
      const z = s.z - fz * back;
      if (life.crowded(x, z, 3.5) || life.inView(x, z, 4)) continue;
      const v = life.placeCar(RACE_CARS[Math.floor(rand() * RACE_CARS.length)], RACE_PAINTS[Math.floor(rand() * RACE_PAINTS.length)], x, z, s.heading);
      v.ai = createDriver(ai.ix, ai.iz, ai.dir, rand);
      this.enter(race, v);
    }
    if (rand() < RACE_CHASED) race.police = POLICE_AFTER[0] + rand() * (POLICE_AFTER[1] - POLICE_AFTER[0]);
    this.races.push(race);
    life.emit('race', s.x, s.z);
    return true;
  }

  private enter(race: StreetRace, v: Vehicle): void {
    const ai = v.ai!;
    ai.cruise = RACE_CRUISE * (0.93 + this.life.d.rand() * 0.1);
    ai.turnSpeed = RACE_TURN;
    ai.urgent = true;
    ai.phase = 'approach';
    ai.next = routeTurn(race.route, 0) ?? ai.next;
    v.scene = this.driver;
    race.racers.push({ v, leg: 0, done: false, nitro: 0 });
    // Rolling start.
    v.sim.vx = Math.sin(v.sim.heading) * 12;
    v.sim.vz = Math.cos(v.sim.heading) * 12;
  }

  /** The racers' driving: urgent traffic (overtaking, through the lights) the route's way at each junction, nitro on. */
  readonly driver: SceneDriver = {
    drive: (v: Vehicle, obstacles: Obstacle[], dt: number): VehicleControls | null => {
      if (v.pursuit || !v.ai) return null;
      const life = this.life;
      for (const r of this.races) {
        for (const racer of r.racers) {
          if (racer.v !== v || racer.done) continue;
          const ai = v.ai;
          const c = driveAi(ai, v.sim, obstacles, life.d.rand, dt, life.d.signals);
          // Which route node it's driving to: further on is progress; off the route past the last one, it's home.
          const k = routeIndex(r.route, ai.ix, ai.iz);
          if (k > racer.leg) racer.leg = k;
          else if (k < 0 && racer.leg === r.route.length - 1) this.finish(r, racer);
          // At each junction, the route's way (driveAi picks at random).
          if (!racer.done && k >= 0 && ai.phase === 'approach') ai.next = routeTurn(r.route, k) ?? ai.next;
          // Copied out: driveAi's controls are shared, and only this car boosts.
          const out = this.out;
          out.throttle = c.throttle;
          out.steer = c.steer;
          out.handbrake = c.handbrake;
          out.boost = racer.nitro > 0 && c.throttle > 0;
          return out;
        }
      }
      return null;
    },
  };

  /** The police turn up: one racer (the back marker) is chased; the rest race on. */
  private callPolice(r: StreetRace): void {
    r.police = Infinity;
    let back: Racer | null = null;
    for (const racer of r.racers) if (!racer.done && (!back || racer.leg <= back.leg)) back = racer;
    if (!back) return;
    const v = back.v;
    if (this.chases.pursue(v)) back.done = true;
    else this.letGo(back);
  }

  /** Through the last junction: the first one wins; everyone across slows down into traffic. */
  private finish(r: StreetRace, racer: Racer): void {
    const life = this.life;
    const v = racer.v;
    if (!r.winner) {
      r.winner = v;
      life.emit('raceWon', v.sim.x, v.sim.z);
      life.d.bus.emit({ type: 'horn', x: v.sim.x, z: v.sim.z, duration: 1.4 });
    }
    this.letGo(racer);
  }

  /** Out of the race: an ordinary driver again. */
  private letGo(racer: Racer): void {
    racer.done = true;
    racer.nitro = 0;
    const v = racer.v;
    if (v.scene !== this.driver) return;
    v.scene = null;
    if (v.ai) {
      v.ai.cruise = CRUISE_SPEED;
      v.ai.turnSpeed = TURN_SPEED;
      v.ai.urgent = false;
      v.ai.overtaking = 0;
    }
  }
}
