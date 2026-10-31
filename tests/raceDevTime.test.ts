/**
 * Race developer times against a bot: every course driven in an empty city
 * (no traffic, no signals) with the real handling, collisions and ramps. The
 * bot keeps to the right-hand lane, aims a point ahead, brakes in time to take
 * each corner at a set speed and turns in late; no nitro, no handbrake. If a
 * handling change moves its times against devTime, this fails: re-tune
 * DEV_SPEED / DEV_CORNER (races.ts) or the bounds here, on purpose.
 */
import { describe, expect, it } from 'vitest';
import { VEHICLE_SPECS, copyVehicleState, createVehicleState, forwardSpeed, stepVehicle, wrapAngle, type VehicleArchetype, type VehicleControls } from '../src/entities/vehicle';
import { RACES, RaceRun, legDir, startGrid, type RaceDef } from '../src/game/modes/races';
import { collideVehicleStatic } from '../src/systems/physics';
import { BLOCK_SIZE, generateCity } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { dressCity } from '../src/world/dressing';
import { generatePickups } from '../src/world/pickups';
import { enteringRamp, placeKickers, placeRamps, rampSolids, rideRamps } from '../src/world/ramps';
import { lanePoint } from '../src/world/roads';

// The world as main.ts builds it.
const city = generateCity(1337);
const bigRamps = placeRamps(1337);
const ramps = [...bigRamps, ...placeKickers(1337, bigRamps)];
const dressing = dressCity(city, generatePickups(1337), ramps);
const collision = new StaticGrid([...city.obstacles, ...dressing.solids]);
const rampGrid = new StaticGrid(rampSolids(ramps));

const DT = 1 / 60;

interface BotStyle {
  /** Aim this far ahead along the lane, m. */
  lookahead: number;
  /** Aim down the next leg once this close to the corner, m. */
  turnIn: number;
  /** Speed to take a right-angle corner at, m/s. */
  cornerSpeed: number;
  /** Share of the car's braking the plan counts on. */
  brakeShare: number;
  /** Steer per radian of heading error. */
  gain: number;
}

// Swept 2026-10-31 over corner speed 10-14, turn-in 10-20, lookahead 10-16: the
// fastest setting with no wall or ramp hit. Late turn-ins and faster corners clip
// the kerbside furniture on the exit.
const BOT: BotStyle = { lookahead: 16, turnIn: 20, cornerSpeed: 12, brakeShare: 0.7, gain: 2.4 };

interface BotResult {
  time: number;
  finished: boolean;
  /** Hardest wall or ramp hit, impact units. */
  worstHit: number;
}

function drive(def: RaceDef, archetype: VehicleArchetype, bot: BotStyle = BOT): BotResult {
  const spec = VEHICLE_SPECS[archetype];
  const g = startGrid(def);
  const car = createVehicleState(g.x, g.z, g.heading);
  const prev = createVehicleState();
  const out: VehicleControls = { throttle: 0, steer: 0, handbrake: false };
  const target = { x: 0, z: 0 };
  const run = new RaceRun(def);
  let worstHit = 0;
  for (let t = 0; t < 400; t += DT) {
    const live = run.phase === 'live';
    const i = run.next;
    const a = def.nodes[i - 1];
    const b = def.nodes[i];
    const d = legDir(a, b);
    // The next leg, if it turns (a checkpoint straight on is no corner).
    const c = def.nodes[i + 1] && legDir(b, def.nodes[i + 1]) !== d ? def.nodes[i + 1] : undefined;
    // Metres along this leg from node a, and left to the corner at b.
    const ax = a[0] * BLOCK_SIZE;
    const az = a[1] * BLOCK_SIZE;
    const along = d === 1 ? car.x - ax : d === 3 ? ax - car.x : d === 2 ? car.z - az : az - car.z;
    const left = (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])) * BLOCK_SIZE - along;
    if (c && left < bot.turnIn) lanePoint(b[0], b[1], legDir(b, c), bot.lookahead * 0.6, target);
    else lanePoint(a[0], a[1], d, Math.max(0, along) + bot.lookahead, target);
    const err = wrapAngle(Math.atan2(target.x - car.x, target.z - car.z) - car.heading);
    out.steer = live ? Math.max(-1, Math.min(1, -err * bot.gain)) : 0;
    // Brake when the corner ahead is within stopping distance (down to corner speed), else full gas.
    const v = forwardSpeed(car);
    const vc = bot.cornerSpeed;
    const stop = v > vc ? (v * v - vc * vc) / (2 * spec.brakeDecel * bot.brakeShare) : 0;
    const braking = c !== undefined && left > 0 && left < stop + v * 0.15;
    out.throttle = !live ? 0 : braking ? -1 : Math.abs(err) > 0.9 && v > vc ? 0 : 1;
    copyVehicleState(prev, car);
    stepVehicle(car, out, spec, DT);
    rideRamps(car, ramps);
    let hit = collideVehicleStatic(car, collision, undefined, prev);
    if (!car.airborne && car.y <= 0 && !enteringRamp(car, ramps)) hit = Math.max(hit, collideVehicleStatic(car, rampGrid, undefined, prev));
    if (live) worstHit = Math.max(worstHit, hit);
    const r = run.step(DT, car.x, car.z);
    if (r === 'finish') return { time: run.time, finished: true, worstHit };
    if (r === 'timeout') break;
  }
  return { time: run.time, finished: false, worstHit };
}

describe('race developer times against the bot', () => {
  const sports = RACES.map((def) => ({ def, r: drive(def, 'sports') }));
  // RACE_REPORT=1 npx vitest run tests/raceDevTime.test.ts: every course in three cars, for re-tuning.
  if (process.env.RACE_REPORT) {
    for (const a of ['sports', 'muscle', 'sedan'] as VehicleArchetype[]) {
      for (const def of RACES) {
        const r = drive(def, a);
        process.stderr.write(`${a} ${def.id} ${r.finished ? r.time.toFixed(1) : 'DNF'} s, x${(r.time / new RaceRun(def).dev).toFixed(3)} of dev, worst hit ${r.worstHit.toFixed(1)}\n`);
      }
    }
  }

  it('the bot finishes every course in the sports car without a hard crash', () => {
    for (const { def, r } of sports) {
      expect(r.finished, def.id).toBe(true);
      expect(r.worstHit, def.id).toBeLessThan(2);
    }
  });

  it('a clean sports-car run lands gold with room to spare for traffic and mistakes', () => {
    const ratios = sports.map(({ def, r }) => r.time / new RaceRun(def).dev);
    for (let k = 0; k < ratios.length; k++) {
      // Measured 2026-10-31: x0.88-0.91 (gold is x1.05, so ~15% for traffic and mistakes).
      expect(ratios[k], RACES[k].id).toBeGreaterThan(0.8);
      expect(ratios[k], RACES[k].id).toBeLessThan(0.95);
    }
    // The dev-time model scales evenly across courses: no course much easier or harder than the rest.
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.06);
  });

  it('slower cars are slower: a sedan never beats the sports car', () => {
    for (const { def, r } of sports) {
      const sedan = drive(def, 'sedan');
      expect(sedan.finished, def.id).toBe(true);
      expect(sedan.time, def.id).toBeGreaterThan(r.time);
    }
  });
});

