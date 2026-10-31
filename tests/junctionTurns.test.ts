/**
 * A busy signalled junction, many times over: four cars on each approach
 * (some runs with a long vehicle in each queue), every driver picking left,
 * straight or right, the real 24 s light cycle. Left turns give way to
 * oncoming traffic, so nobody should touch anybody in the junction, and
 * everybody should still get through.
 */
import { describe, expect, it } from 'vitest';
import { VEHICLE_BODIES, VEHICLE_SPECS, createVehicleState, stepVehicle, type VehicleArchetype, type VehicleState } from '../src/entities/vehicle';
import { collideVehicles } from '../src/systems/physics';
import { driveAi, spawnAi, vehicleObstacles, type AiDriver, type Obstacle } from '../src/systems/traffic';
import { turnLeft, turnRight, type Dir } from '../src/world/roads';
import { SIGNAL_CYCLE, eastWest, signalAt, type Signal, type SignalView } from '../src/world/signals';
import { random } from './helpers';

const DT = 1 / 60;

/** The real cycle at every junction, from `t0` into it. */
class Lights implements SignalView {
  time: number;
  constructor(t0: number) {
    this.time = t0;
  }
  at(_ix: number, _iz: number, dir: Dir): Signal {
    return signalAt(eastWest(dir), this.time);
  }
}

interface Car {
  archetype: VehicleArchetype;
  car: VehicleState;
  ai: AiDriver;
  rand: () => number;
  /** Seconds when it left junction (0, 0); NaN until then. */
  through: number;
  /** Its approach and turn at the junction, for the report: 'N left'. */
  label: string;
}

const LONG: VehicleArchetype[] = ['bus', 'firetruck', 'garbage_truck', 'limo', 'tow_truck', 'swat'];

function junctionRun(seed: number, withLong: boolean, secs = 60): { contacts: string[]; stranded: number } {
  const rand = random(seed);
  const lights = new Lights(rand() * SIGNAL_CYCLE);
  const cars: Car[] = [];
  for (const dir of [0, 1, 2, 3] as Dir[]) {
    for (let k = 0; k < 4; k++) {
      const archetype: VehicleArchetype = withLong && k === 1 ? LONG[Math.floor(rand() * LONG.length)] : 'sedan';
      const r = random(seed * 100 + dir * 10 + k);
      // Queued from the junction back: the long vehicle needs the room.
      const s = spawnAi(0, 0, dir, 0.85 - k * 0.2, r)!;
      const pick = rand();
      s.driver.next = pick < 0.35 ? turnLeft(dir) : pick < 0.7 ? dir : turnRight(dir);
      const car: VehicleState = { ...createVehicleState(s.x, s.z, s.heading), body: VEHICLE_BODIES[archetype] };
      const turn = s.driver.next === dir ? 'straight' : s.driver.next === turnLeft(dir) ? 'left' : 'right';
      cars.push({ archetype, car, ai: s.driver, rand: r, through: NaN, label: `${'NESW'[dir]}${k} ${turn}` });
    }
  }
  const obstacles: Obstacle[] = [];
  const contacts: string[] = [];
  const touching = new Set<string>();
  for (let t = 0; t < secs; t += DT) {
    lights.time += DT;
    obstacles.length = 0;
    for (const c of cars) vehicleObstacles(c.car, false, (x, z, halfWidth, player, owner) => obstacles.push({ x, z, halfWidth, player, owner }));
    for (const c of cars) {
      const before = c.ai.ix !== 0 || c.ai.iz !== 0;
      stepVehicle(c.car, driveAi(c.ai, c.car, obstacles, c.rand, DT, lights), VEHICLE_SPECS[c.archetype], DT);
      if (!before && (c.ai.ix !== 0 || c.ai.iz !== 0) && Number.isNaN(c.through)) c.through = t;
    }
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        const impact = collideVehicles(a.car, b.car);
        const key = `${i}-${j}`;
        // Contacts in or at the junction, once per touch.
        if (impact > 1 && Math.hypot(a.car.x, a.car.z) < 22 && !touching.has(key)) {
          contacts.push(`seed ${seed} t ${t.toFixed(1)}: ${a.archetype} ${a.label} × ${b.archetype} ${b.label} at ${impact.toFixed(1)}`);
          touching.add(key);
        } else if (impact <= 0) touching.delete(key);
      }
    }
  }
  const left = cars.filter((c) => Number.isNaN(c.through));
  if (process.env.JUNCTION_REPORT && left.length) process.stderr.write(`seed ${seed} stranded: ${left.map((c) => `${c.label} ${c.ai.phase} (${c.car.x.toFixed(0)}, ${c.car.z.toFixed(0)}) v ${Math.hypot(c.car.vx, c.car.vz).toFixed(1)}`).join('; ')}\n`);
  return { contacts, stranded: left.length };
}

describe('a busy signalled junction', () => {
  it('sedans: no contacts, and every car gets through within 75 s (three light cycles)', () => {
    let contacts: string[] = [];
    let stranded = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = junctionRun(seed, false, 75);
      contacts = contacts.concat(r.contacts);
      stranded += r.stranded;
    }
    if (process.env.JUNCTION_REPORT) process.stderr.write(`sedans: ${contacts.length} contacts, ${stranded} stranded\n${contacts.slice(0, 20).join('\n')}\n`);
    expect(contacts).toEqual([]);
    expect(stranded).toBe(0);
  }, 30000);

  it('with a long vehicle in every queue: no contacts, and everyone gets through', () => {
    let contacts: string[] = [];
    let stranded = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = junctionRun(seed, true, 75);
      contacts = contacts.concat(r.contacts);
      stranded += r.stranded;
    }
    if (process.env.JUNCTION_REPORT) process.stderr.write(`long: ${contacts.length} contacts, ${stranded} stranded\n${contacts.slice(0, 20).join('\n')}\n`);
    expect(contacts).toEqual([]);
    expect(stranded).toBe(0);
  }, 30000);
});

