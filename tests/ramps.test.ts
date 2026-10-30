import { describe, expect, it } from 'vitest';
import { SEDAN, VEHICLE_SPECS, createVehicleState, speed, stepVehicle, type VehicleState } from '../src/entities/vehicle';
import { landingDamage } from '../src/systems/damage';
import { collideVehicleStatic } from '../src/systems/physics';
import { MIN_AIRTIME, StuntTracker, stuntLabel, stuntPoints, type StuntResult } from '../src/systems/stunts';
import { BLOCK_SIZE, generateCity } from '../src/world/city';
import { StaticGrid } from '../src/world/collision';
import { KICK, RAMP_COUNT, RAMP_HEIGHT, RAMP_LENGTH, RAMP_WIDTH, enteringRamp, placeRamps, rampAt, rampSolids, rideRamps } from '../src/world/ramps';
import { DIR_VEC, LANE_OFFSET, MAX_NODE } from '../src/world/roads';

const DT = 1 / 60;
const full = { throttle: 1, steer: 0, handbrake: false };

/** Drive a car flat out along `ramp`'s line from `runUp` m before it; record the jump. */
function jump(v0: number, spec = SEDAN, runUp = 30, throttle = 1) {
  const ramp = rampAt(0, 0, 1); // east along z = 0
  const s = createVehicleState(ramp.x - runUp, 0, ramp.heading);
  s.vx = v0;
  const tracker = new StuntTracker();
  const solid = new StaticGrid(rampSolids([ramp]));
  let launched = false;
  let maxY = 0;
  let landing = 0;
  let stunt: StuntResult | null = null;
  let launchX = 0;
  for (let i = 0; i < 60 * 6 && !stunt; i++) {
    const hit = stepVehicle(s, { ...full, throttle }, spec, DT);
    if (hit > 0) landing = hit;
    // As main.ts: the solid parts stop anyone not lined up on the front.
    if (!s.airborne && s.y <= 0 && !enteringRamp(s, [ramp])) expect(collideVehicleStatic(s, solid)).toBe(0);
    const ev = rideRamps(s, [ramp]);
    if (ev === 'launch') {
      launched = true;
      launchX = s.x;
    }
    maxY = Math.max(maxY, s.y);
    const r = tracker.step(s, DT);
    if (r) stunt = { ...r };
    if (launched && !s.airborne && s.y === 0 && i > 0 && landing > 0 && !stunt) break;
  }
  return { s, launched, maxY, landing, stunt, launchX, ramp };
}

describe('ramp placement', () => {
  const ramps = placeRamps(1337);
  it('places the full set, the same every game, well apart', () => {
    expect(ramps).toHaveLength(RAMP_COUNT);
    expect(placeRamps(1337)).toEqual(ramps);
    for (let i = 0; i < ramps.length; i++) {
      for (let j = i + 1; j < ramps.length; j++) {
        expect(Math.hypot(ramps[i].x - ramps[j].x, ramps[i].z - ramps[j].z)).toBeGreaterThan(150);
      }
    }
    // One a block east of the spawn corner.
    expect(ramps[0].x).toBeGreaterThan(8);
    expect(ramps[0].x).toBeLessThan(BLOCK_SIZE / 2);
    expect(ramps[0].z).toBe(0);
  });

  it('sits on a road centreline, clear of both traffic lanes and of buildings', () => {
    const city = generateCity(1337);
    const grid = new StaticGrid(city.obstacles);
    for (const r of ramps) {
      const v = DIR_VEC[r.dir];
      // Across the road: the centreline is a multiple of BLOCK_SIZE.
      const across = v.x !== 0 ? r.z : r.x;
      expect(Math.abs(across / BLOCK_SIZE - Math.round(across / BLOCK_SIZE))).toBeLessThan(1e-9);
      expect(RAMP_WIDTH / 2).toBeLessThan(LANE_OFFSET - 1.2); // a lane car's flank never touches it
      expect(Math.abs(r.x)).toBeLessThan(MAX_NODE * BLOCK_SIZE);
      const hw = (v.x !== 0 ? RAMP_LENGTH : RAMP_WIDTH) / 2 + 1;
      const hd = (v.z !== 0 ? RAMP_LENGTH : RAMP_WIDTH) / 2 + 1;
      for (const o of grid.near(r.x, r.z, RAMP_LENGTH)) {
        const overlaps = o.minX < r.x + hw && o.maxX > r.x - hw && o.minZ < r.z + hd && o.maxZ > r.z - hd;
        expect(overlaps).toBe(false);
      }
    }
  });
});

describe('riding a ramp', () => {
  it('climbs the slope, launches over the lip and flies a proper jump at speed', () => {
    const j = jump(28);
    expect(j.launched).toBe(true);
    expect(j.maxY).toBeGreaterThan(RAMP_HEIGHT + 1.5);
    expect(j.stunt).not.toBeNull();
    const st = j.stunt!;
    expect(st.airtime).toBeGreaterThan(0.9);
    expect(st.distance).toBeGreaterThan(20);
    expect(st.distance).toBeLessThan(40); // lands before the next junction
    expect(st.points).toBe(stuntPoints(st.airtime, st.distance, st.spin));
    // A real landing, but nothing a car can't take.
    expect(j.landing).toBeGreaterThan(9);
    expect(landingDamage(j.landing)).toBeLessThan(25);
  });

  it('the kick grows with speed; at a crawl the car just drops off the end', () => {
    const fast = jump(VEHICLE_SPECS.sports.maxSpeed, VEHICLE_SPECS.sports, 60);
    const med = jump(20);
    expect(fast.maxY).toBeGreaterThan(med.maxY);
    const slow = jump(8, SEDAN, 20, 0); // coasting up at ~7 m/s
    expect(slow.launched).toBe(false);
    expect(slow.stunt).toBeNull(); // a drop isn't a stunt
    expect(slow.maxY).toBeLessThanOrEqual(RAMP_HEIGHT + 1e-9);
    expect(KICK * 28).toBeGreaterThan(9);
  });

  it('is solid from the side and the back', () => {
    const ramp = rampAt(0, 0, 1);
    const grid = new StaticGrid(rampSolids([ramp]));
    // Into the back (the lip end) going west.
    const back = createVehicleState(ramp.x + RAMP_LENGTH / 2 + 4, 0, -Math.PI / 2);
    back.vx = -15;
    let hit = 0;
    for (let i = 0; i < 60; i++) {
      stepVehicle(back, full, SEDAN, DT);
      expect(enteringRamp(back, [ramp])).toBe(false);
      expect(rideRamps(back, [ramp])).toBe('none');
      hit = Math.max(hit, collideVehicleStatic(back, grid));
    }
    expect(hit).toBeGreaterThan(10);
    expect(back.x).toBeGreaterThan(ramp.x);
    expect(back.y).toBe(0);
  });

  it('traffic in its lane drives past without touching it', () => {
    const ramp = rampAt(0, 0, 1);
    const grid = new StaticGrid(rampSolids([ramp]));
    const s: VehicleState = createVehicleState(ramp.x - 20, LANE_OFFSET, Math.PI / 2);
    s.vx = 12;
    for (let i = 0; i < 180; i++) {
      stepVehicle(s, { throttle: 0.3, steer: 0, handbrake: false }, SEDAN, DT);
      rideRamps(s, [ramp]);
      expect(collideVehicleStatic(s, grid)).toBe(0);
      expect(s.y).toBe(0);
    }
    expect(speed(s)).toBeGreaterThan(10);
  });
});

describe('stunt scoring', () => {
  it('counts airtime, distance and spin; short hops do not count', () => {
    expect(stuntPoints(1, 25, 0)).toBe(1000 + 500);
    expect(stuntPoints(1, 25, 360)).toBe(1500 + 1000);
    expect(stuntLabel(1200, 0)).toBe('STUNT');
    expect(stuntLabel(2600, 190)).toBe('180 GREAT STUNT');
    expect(stuntLabel(4000, 360)).toBe('360 INSANE STUNT');
    const t = new StuntTracker();
    const s = createVehicleState(0, 0, 0);
    s.airborne = true;
    for (let i = 0; i < Math.floor((MIN_AIRTIME * 0.8) / DT); i++) expect(t.step(s, DT)).toBeNull();
    s.airborne = false;
    expect(t.step(s, DT)).toBeNull();
  });

  it('adds up spin in the air', () => {
    const t = new StuntTracker();
    const s = createVehicleState(0, 0, 0);
    s.airborne = true;
    s.vz = 20;
    s.yawRate = 2 * Math.PI; // a full turn a second
    let r: StuntResult | null = null;
    for (let i = 0; i < 70; i++) {
      s.heading += s.yawRate * DT;
      s.z += s.vz * DT;
      if (i === 65) s.airborne = false;
      r = t.step(s, DT) ?? r;
    }
    expect(r).not.toBeNull();
    expect(r!.spin).toBeGreaterThan(330);
    expect(r!.label.startsWith('360')).toBe(true);
  });
});
