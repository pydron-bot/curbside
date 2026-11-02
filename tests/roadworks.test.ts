import { describe, expect, it } from 'vitest';
import { VEHICLE_BODIES, VEHICLE_SPECS, createVehicleState, stepVehicle, type VehicleArchetype, type VehicleState } from '../src/entities/vehicle';
import { buildMissions } from '../src/systems/missionsData';
import { Knockables } from '../src/systems/knockables';
import { collideVehicleStatic } from '../src/systems/physics';
import { createDriver, driveAi } from '../src/systems/traffic';
import { SAFEHOUSE, placeDocks } from '../src/game/modes/places';
import { RACES } from '../src/game/modes/races';
import { BLOCK_SIZE, CORE_BLOCKS, ROAD_WIDTH, SIDEWALK, generateCity } from '../src/world/city';
import { StaticGrid, circleVsRect } from '../src/world/collision';
import { dressCity } from '../src/world/dressing';
import { generatePickups } from '../src/world/pickups';
import { placeKickers, placeRamps } from '../src/world/ramps';
import { DIR_VEC, LANE_OFFSET, dirHeading, lanePoint, nodeValid, segmentKey, type Dir } from '../src/world/roads';
import { WORKS_EDGE } from '../src/world/roadworks';
import { TrafficSignals, type SignalView } from '../src/world/signals';
import { random } from './helpers';

const city = generateCity(1337);
const big = placeRamps(1337);
const ramps = [...big, ...placeKickers(1337, big)];
const dressing = dressCity(city, generatePickups(1337), ramps);
const { street } = dressing;
const WORKS = new Set(['traffic_cone', 'traffic_barrel', 'work_barrier', 'roadwork_sign', 'steel_plate', 'work_trench', 'skip', 'mini_digger', 'portable_toilet']);
const DT = 1 / 60;

/** Distance from the nearest road centreline. */
function fromCentreline(x: number, z: number): number {
  const dx = Math.abs(x - Math.round(x / BLOCK_SIZE) * BLOCK_SIZE);
  const dz = Math.abs(z - Math.round(z / BLOCK_SIZE) * BLOCK_SIZE);
  return Math.min(dx, dz);
}

const inArea = (x: number, z: number, m = 0.5) => street.roadworks.some((w) => x > w.area.minX - m && x < w.area.maxX + m && z > w.area.minZ - m && z < w.area.maxZ + m);

describe('road works', () => {
  it('puts a dozen or more sites round the city, each with its sign, cones, barrels and kit', () => {
    expect(street.roadworks.length).toBeGreaterThanOrEqual(12);
    for (const w of street.roadworks) {
      const inside = street.props.filter((p) => WORKS.has(p.kind) && p.x >= w.area.minX - 0.5 && p.x <= w.area.maxX + 0.5 && p.z >= w.area.minZ - 0.5 && p.z <= w.area.maxZ + 0.5);
      const count = (k: string) => inside.filter((p) => p.kind === k).length;
      expect(count('roadwork_sign')).toBe(1);
      expect(count('traffic_cone')).toBe(6);
      expect(count('traffic_barrel')).toBeGreaterThanOrEqual(4);
      expect(count('work_barrier')).toBe(count('traffic_barrel') - 1);
      expect(inside.length).toBeGreaterThan(count('traffic_cone') + 2 * count('traffic_barrel'));
      // The sign faces the traffic coming up to it.
      const sign = inside.find((p) => p.kind === 'roadwork_sign')!;
      expect(Math.cos(sign.heading - dirHeading(w.dir))).toBeCloseTo(-1);
    }
    // Every piece of kit is in a site.
    for (const p of street.props) if (WORKS.has(p.kind) && p.kind !== 'traffic_cone' && p.kind !== 'traffic_barrel') expect(inArea(p.x, p.z), p.kind).toBe(true);
  });

  it('closes only the strip between the kerb and the lane: nothing reaches into the traffic', () => {
    // A bus keeps to LANE_OFFSET ± 1.33 m: the closest anything comes is the barrel line.
    const busEdge = LANE_OFFSET + VEHICLE_BODIES.bus.halfWidth;
    for (const k of street.knockables) {
      const p = street.props[k.prop];
      if (!WORKS.has(p.kind) || !inArea(p.x, p.z)) continue; // barrels stand on industrial kerbs too
      const reach = k.hx !== undefined ? Math.min(k.hx, k.hz!) : k.radius;
      expect(fromCentreline(k.x, k.z) - reach, p.kind).toBeGreaterThan(busEdge + 0.2);
      expect(fromCentreline(k.x, k.z), p.kind).toBeLessThan(ROAD_WIDTH / 2);
    }
    for (const r of dressing.solids) {
      const x = (r.minX + r.maxX) / 2;
      const z = (r.minZ + r.maxZ) / 2;
      if (!inArea(x, z)) continue;
      const half = Math.min(r.maxX - r.minX, r.maxZ - r.minZ) / 2;
      expect(fromCentreline(x, z) - half).toBeGreaterThan(WORKS_EDGE);
    }
    for (const w of street.roadworks) {
      expect(fromCentreline((w.area.minX + w.area.maxX) / 2, (w.area.minZ + w.area.maxZ) / 2)).toBeCloseTo((5.7 + ROAD_WIDTH / 2) / 2);
    }
  });

  it("keeps off the race legs, the spawn corner, the ramps and every mission's parked cars", () => {
    const legs = new Set<number>();
    for (const r of RACES) {
      for (let i = 1; i < r.nodes.length; i++) {
        let [x, z] = r.nodes[i - 1];
        const [tx, tz] = r.nodes[i];
        while (x !== tx || z !== tz) {
          const sx = Math.sign(tx - x);
          const sz = Math.sign(tz - z);
          legs.add(segmentKey(x, z, x + sx, z + sz));
          x += sx;
          z += sz;
        }
      }
    }
    const cars: Array<{ x: number; z: number }> = [];
    for (const m of buildMissions(placeDocks(city), SAFEHOUSE)) {
      for (const s of m.steps) for (const a of [...(s.start ?? []), ...(s.done ?? [])]) if (a.do === 'spawnCar') cars.push(a);
    }
    for (const w of street.roadworks) {
      const v = DIR_VEC[w.dir];
      expect(legs.has(segmentKey(w.ix - v.x, w.iz - v.z, w.ix, w.iz))).toBe(false);
      const cx = (w.area.minX + w.area.maxX) / 2;
      const cz = (w.area.minZ + w.area.maxZ) / 2;
      expect(Math.hypot(cx, cz)).toBeGreaterThan(70);
      for (const r of ramps) expect(Math.hypot(cx - r.x, cz - r.z)).toBeGreaterThan(30);
      for (const c of cars) expect(inArea(c.x, c.z, 3)).toBe(false);
    }
  });

  it('tells drivers which lanes have works at the kerb', () => {
    const signals = new TrafficSignals();
    signals.setRoadworks(street.roadworks);
    for (const w of street.roadworks) expect(signals.kerbWorks(w.ix, w.iz, w.dir)).toBe(true);
    const w = street.roadworks[0];
    expect(signals.kerbWorks(w.ix, w.iz, ((w.dir + 2) % 4) as 0)).toBe(false);
  });

  /** Drive `archetype` along every site's lane from the junction before; count what it knocks and hits. */
  function drivePast(archetype: VehicleArchetype, yielding: boolean, signals: SignalView, turnIn = 0): { knocks: number; hits: number; through: number } {
    const knockables = new Knockables(dressing.knockables);
    const grid = new StaticGrid(dressing.solids);
    const rand = random(11);
    let knocks = 0;
    let hits = 0;
    let through = 0;
    for (const w of street.roadworks) {
      const v = DIR_VEC[w.dir];
      const fromX = w.ix - v.x;
      const fromZ = w.iz - v.z;
      // Straight on into the road, or turning in from a cross street (1 right, -1 left).
      const inDir = ((w.dir + 4 - turnIn) % 4) as Dir;
      if (!nodeValid(fromX - DIR_VEC[inDir].x, fromZ - DIR_VEC[inDir].z)) {
        through++;
        continue;
      }
      const ai = createDriver(fromX, fromZ, inDir, rand);
      ai.next = w.dir;
      const p = lanePoint(fromX, fromZ, inDir, -24);
      const car: VehicleState = { ...createVehicleState(p.x, p.z, dirHeading(inDir)), body: VEHICLE_BODIES[archetype] };
      const cars = [car];
      for (let i = 0; i < 60 * 25; i++) {
        // A siren behind once it's on the works' road (before that a bus pulling over climbs the kerb, works or not).
        const on = (car.x - fromX * BLOCK_SIZE) * v.x + (car.z - fromZ * BLOCK_SIZE) * v.z;
        if (yielding && on > 6) ai.yielding = 1;
        stepVehicle(car, driveAi(ai, car, [], rand, DT, signals), VEHICLE_SPECS[archetype], DT);
        knockables.step(cars, DT, () => knocks++);
        if (collideVehicleStatic(car, grid) > 0.5) hits++;
        // Past the site's far end.
        const along = (car.x - fromX * BLOCK_SIZE) * v.x + (car.z - fromZ * BLOCK_SIZE) * v.z;
        if (along > w.to + 6) {
          through++;
          break;
        }
      }
    }
    return { knocks, hits, through };
  }

  it('lets traffic past in its lane, a bus too, and a driver pulling over for a siren stays in the lane', () => {
    const real = new TrafficSignals();
    real.setRoadworks(street.roadworks);
    // No lights (a queue at a red short of the site's end isn't what's tested), the works known.
    const signals: SignalView = { at: () => null, kerbWorks: (ix, iz, d) => real.kerbWorks(ix, iz, d) };
    const n = street.roadworks.length;
    for (const archetype of ['sedan', 'bus'] as const) {
      for (const yielding of [false, true]) {
        const r = drivePast(archetype, yielding, signals);
        expect(r, `${archetype} ${yielding ? 'yielding' : 'cruising'}`).toEqual({ knocks: 0, hits: 0, through: n });
      }
    }
    // Turning in from either cross street.
    for (const archetype of ['sedan', 'bus'] as const) {
      for (const turn of [1, -1]) expect(drivePast(archetype, false, signals, turn), `${archetype} turning ${turn}`).toEqual({ knocks: 0, hits: 0, through: n });
    }
    // Without the works known, pulling over runs into them.
    expect(drivePast('sedan', true, { at: () => null }).knocks).toBeGreaterThan(n);
  });
});

describe('vendors and bus stops', () => {
  const walk = ROAD_WIDTH / 2 + SIDEWALK / 2;
  const solids = new StaticGrid([...city.obstacles, ...dressing.solids]);
  const blocked = (x: number, z: number, r: number) => solids.near(x, z, r).some((b) => circleVsRect(x, z, r, b) !== null);

  it('puts food carts on the busy kerbs downtown, in the parks and on the open plazas', () => {
    // (The core city's: a bigger city's ring has no downtown.)
    const coreHalf = (CORE_BLOCKS * BLOCK_SIZE) / 2;
    const kerb = street.vendors.filter((v) => v.setting === 'kerb' && Math.abs(v.x) < coreHalf && Math.abs(v.z) < coreHalf);
    expect(kerb.length).toBeGreaterThan(30);
    expect(street.vendors.filter((v) => v.setting === 'park').length).toBeGreaterThan(10);
    expect(street.vendors.filter((v) => v.setting === 'plaza').length).toBeGreaterThan(5);
    for (const k of ['food_cart_hotdog', 'food_cart_coffee', 'fruit_stand']) expect(street.vendors.some((v) => v.kind === k), k).toBe(true);
    // Downtown has the most per kerb.
    const downtown = kerb.filter((v) => Math.abs(v.x) < 192 && Math.abs(v.z) < 192).length;
    expect(downtown).toBeGreaterThan(kerb.length * 0.3);
  });

  it('gives each cart a model, a free spot to be served at facing it, a queue along the pavement and a vendor', () => {
    for (const v of street.vendors) {
      const prop = street.props.find((p) => p.x === v.x && p.z === v.z)!;
      expect(prop.kind).toBe(v.kind);
      expect(prop.heading).toBe(v.heading);
      // The serving side faces the customer.
      const dx = v.serveX - v.x;
      const dz = v.serveZ - v.z;
      expect((dx * Math.sin(v.heading) + dz * Math.cos(v.heading)) / Math.hypot(dx, dz)).toBeCloseTo(1);
      expect(Math.hypot(v.queueX, v.queueZ)).toBeCloseTo(1);
      // The queue runs along the kerb, square to the serving direction.
      expect(Math.abs(v.queueX * Math.sin(v.heading) + v.queueZ * Math.cos(v.heading))).toBeLessThan(1e-9);
      for (let k = 0; k < 3; k++) expect(blocked(v.serveX + v.queueX * k, v.serveZ + v.queueZ * k, 0.3), `queue ${k} at ${v.kind}`).toBe(false);
      expect(blocked(v.vendorX, v.vendorZ, 0.3)).toBe(false);
      if (v.setting === 'kerb') expect(Math.abs(fromCentreline(v.serveX, v.serveZ) - walk)).toBeLessThan(0.3);
    }
  });

  it('puts bus shelters by lanes with no works, open to the road, with somewhere to wait and a bus stop', () => {
    expect(street.busStops.length).toBeGreaterThan(50);
    // Deacon Pike's stop in Maple Flats (missionsData.ts pikeStop).
    expect(street.busStops.some((s) => Math.abs(s.x + 266.5) < 0.01 && Math.abs(s.z - 224) < 0.01)).toBe(true);
    const signals = new TrafficSignals();
    signals.setRoadworks(street.roadworks);
    for (const s of street.busStops) {
      expect(street.props.some((p) => p.kind === 'bus_shelter' && p.x === s.x && p.z === s.z && p.heading === s.heading)).toBe(true);
      expect(signals.kerbWorks(s.ix, s.iz, s.dir)).toBe(false);
      // Waiting off the walking line, under the roof's front edge; the bus by the kerb on the lane's side.
      expect(fromCentreline(s.waitX, s.waitZ) - 0.35).toBeGreaterThan(walk + 0.1);
      expect(blocked(s.waitX, s.waitZ, 0.3)).toBe(false);
      expect(fromCentreline(s.stopX, s.stopZ)).toBeGreaterThan(LANE_OFFSET);
      expect(fromCentreline(s.stopX, s.stopZ)).toBeLessThan(ROAD_WIDTH / 2 - 1.3);
      expect(s.stopHeading).toBe(dirHeading(s.dir));
      // The lane's lane point beside the shelter is on the same side of the road as the stop.
      const v = DIR_VEC[s.dir];
      const rx = -v.z;
      const rz = v.x;
      const lane = lanePoint(s.ix, s.iz, s.dir, -20);
      expect((s.stopX - lane.x) * rx + (s.stopZ - lane.z) * rz).toBeGreaterThan(1.5);
    }
  });
});
