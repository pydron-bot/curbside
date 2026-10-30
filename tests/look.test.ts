import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createShadowBox, fitShadowBox, SHADOW_MAX_HEIGHT } from '../src/render/sunShadow';
import {
  CYCLE_SECONDS,
  START_HOUR,
  SUNRISE,
  SUNSET,
  TimeOfDay,
  createSkyState,
  isDaylight,
  sampleSky,
  sunDirection,
  wrapHour,
} from '../src/render/timeOfDay';
import { planBuildings } from '../src/world/buildingPlans';
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, SIDEWALK, generateCity, type Rect } from '../src/world/city';
import { DISTRICTS, MAX_HEIGHT, districtOf, pickWeighted } from '../src/world/districts';
import { LAMP_OFFSET, generateStreetLamps } from '../src/world/streetLamps';

describe('time of day', () => {
  it('wraps hours into [0, 24)', () => {
    expect(wrapHour(25)).toBe(1);
    expect(wrapHour(-1)).toBe(23);
    expect(wrapHour(24)).toBe(0);
  });

  it('starts in the late afternoon and runs a day in CYCLE_SECONDS', () => {
    const t = new TimeOfDay();
    expect(t.hour).toBe(START_HOUR);
    expect(isDaylight(t.hour)).toBe(true);
    for (let i = 0; i < CYCLE_SECONDS; i++) t.update(1);
    expect(t.hour).toBeCloseTo(START_HOUR, 6);
    t.speed = 0;
    t.set(22);
    t.update(10);
    expect(t.hour).toBe(22);
  });

  it('is bright by day and night-lit at night', () => {
    const noon = sampleSky(12.5, createSkyState());
    const midnight = sampleSky(0, createSkyState());
    expect(noon.night).toBe(0);
    expect(midnight.night).toBe(1);
    expect(noon.lightIntensity).toBeGreaterThan(2);
    expect(midnight.lightIntensity).toBeLessThan(noon.lightIntensity / 3);
    expect(noon.shadowStrength).toBeGreaterThan(midnight.shadowStrength);
  });

  it('fades the light out where it swaps between sun and moon', () => {
    for (const h of [SUNRISE, SUNSET]) {
      expect(sampleSky(h, createSkyState()).lightIntensity).toBeCloseTo(0, 6);
      expect(sampleSky(h - 1e-4, createSkyState()).shadowStrength).toBeLessThan(0.01);
    }
  });

  it('changes smoothly: no jumps between one game minute and the next', () => {
    const a = createSkyState();
    const b = createSkyState();
    for (let m = 0; m < 24 * 60; m++) {
      sampleSky(m / 60, a);
      sampleSky((m + 1) / 60, b);
      expect(Math.abs(a.lightIntensity - b.lightIntensity)).toBeLessThan(0.12);
      expect(Math.abs(a.night - b.night)).toBeLessThan(0.05);
      expect(Math.abs(a.exposure - b.exposure)).toBeLessThan(0.02);
      for (let k = 0; k < 3; k++) expect(Math.abs(a.fogColor[k] - b.fogColor[k])).toBeLessThan(0.03);
    }
  });

  it('moves the sun from east to west through the south, never below the shadow floor', () => {
    const morning = sunDirection(8);
    const noon = sunDirection(12.65);
    const evening = sunDirection(18.5);
    expect(morning[0]).toBeGreaterThan(0);
    expect(evening[0]).toBeLessThan(0);
    expect(noon[2]).toBeGreaterThan(0.3);
    expect(noon[1]).toBeGreaterThan(morning[1]);
    for (const d of [morning, noon, evening]) {
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
      expect(d[1]).toBeGreaterThan(0.35);
    }
  });
});

describe('sun shadow fit', () => {
  const view: Rect = { minX: -30, minZ: -18, maxX: 32, maxZ: 16 };
  const toLight = new Vector3(...sunDirection(18.4));

  /** The light's axes as fitShadowBox builds them. */
  function axes(dir: Vector3) {
    const az = dir.clone().normalize();
    const ax = new Vector3(0, 1, 0).cross(az).normalize();
    const ay = az.clone().cross(ax);
    return { ax, ay, az };
  }

  it('covers every corner of the view volume', () => {
    const box = fitShadowBox(view, toLight, 2048, createShadowBox());
    const { ax, ay, az } = axes(toLight);
    for (let i = 0; i < 8; i++) {
      const p = new Vector3(i & 1 ? view.maxX : view.minX, i & 4 ? SHADOW_MAX_HEIGHT : 0, i & 2 ? view.maxZ : view.minZ);
      const d = p.clone().sub(box.target);
      expect(Math.abs(d.dot(ax))).toBeLessThanOrEqual(box.halfWidth);
      expect(Math.abs(d.dot(ay))).toBeLessThanOrEqual(box.halfHeight);
      const depth = box.position.clone().sub(p).dot(az);
      expect(depth).toBeGreaterThan(box.near);
      expect(depth).toBeLessThan(box.far);
    }
  });

  it('snaps to whole shadow texels so edges do not crawl as the camera moves', () => {
    const { ax, ay } = axes(toLight);
    const box = createShadowBox();
    for (const shift of [0, 0.013, 0.37, 1.9]) {
      const moved = { minX: view.minX + shift, maxX: view.maxX + shift, minZ: view.minZ - shift, maxZ: view.maxZ - shift };
      fitShadowBox(moved, toLight, 2048, box);
      const u = box.target.dot(ax) / box.texelX;
      const v = box.target.dot(ay) / box.texelY;
      expect(Math.abs(u - Math.round(u))).toBeLessThan(1e-3);
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-3);
    }
  });

  it('keeps its size while the view only slides', () => {
    const a = fitShadowBox(view, toLight, 1024, createShadowBox());
    const moved = { minX: view.minX + 0.4, maxX: view.maxX + 0.4, minZ: view.minZ, maxZ: view.maxZ };
    const b = fitShadowBox(moved, toLight, 1024, createShadowBox());
    expect(b.halfWidth).toBe(a.halfWidth);
    expect(b.halfHeight).toBe(a.halfHeight);
  });
});

describe('districts and building plans', () => {
  const city = generateCity(1337);
  const plans = planBuildings(city);

  it('uses every district, each in one or more connected-looking regions', () => {
    const seen = new Set(city.blocks.map((b) => b.district));
    expect([...seen].sort()).toEqual([...DISTRICTS].sort());
    expect(districtOf(7, 7)).toBe('downtown');
    expect(districtOf(0, 0)).toBe(districtOf(0, 0));
  });

  it('keeps every building under the height cap', () => {
    for (const b of city.buildings) expect(b.height).toBeLessThanOrEqual(MAX_HEIGHT);
    const downtown = city.buildings.filter((b) => b.district === 'downtown');
    const homes = city.buildings.filter((b) => b.district === 'residential');
    const mean = (bs: typeof downtown) => bs.reduce((s, b) => s + b.height, 0) / bs.length;
    expect(mean(downtown)).toBeGreaterThan(mean(homes) + 2);
  });

  it('is deterministic', () => {
    expect(planBuildings(city)).toEqual(plans);
  });

  it('keeps rooftop props on their roof and off each other', () => {
    plans.forEach((plan, i) => {
      const b = city.buildings[i];
      for (const p of plan.props) {
        expect(p.minX).toBeGreaterThanOrEqual(b.minX - 1e-6);
        expect(p.maxX).toBeLessThanOrEqual(b.maxX + 1e-6);
        expect(p.minZ).toBeGreaterThanOrEqual(b.minZ - 1e-6);
        expect(p.maxZ).toBeLessThanOrEqual(b.maxZ + 1e-6);
        expect(p.y0).toBe(b.height);
      }
    });
    expect(plans.reduce((n, p) => n + p.props.length, 0)).toBeGreaterThan(city.buildings.length);
  });

  it('keeps pitched tile roofs clear of bulkheads and plant boxes', () => {
    const pitched = plans.filter((p) => p.roof === 'terracotta');
    expect(pitched.length).toBeGreaterThan(0);
    for (const plan of pitched) for (const p of plan.props) expect(['chimney', 'solar']).toContain(p.kind);
  });

  it('puts helipads only on tall downtown towers, and has at least one', () => {
    const pads = plans.map((p, i) => [p, city.buildings[i]] as const).filter(([p]) => p.roof === 'helipad');
    expect(pads.length).toBeGreaterThan(0);
    for (const [plan, b] of pads) {
      expect(b.district).toBe('downtown');
      expect(b.height).toBeGreaterThan(10);
      expect(plan.props).toHaveLength(0);
    }
  });

  it('only fronts shops onto the street', () => {
    const lot = BLOCK_SIZE / 2 - ROAD_WIDTH / 2 - SIDEWALK;
    plans.forEach((plan, i) => {
      const b = city.buildings[i];
      for (const s of plan.shopfronts) {
        expect(plan.shopSides & (1 << s.side)).not.toBe(0);
        // The shop face is within 2 m of the sidewalk.
        const face = [b.minZ, b.maxX, b.maxZ, b.minX][s.side];
        const local = (((face + HALF_EXTENT) % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE - BLOCK_SIZE / 2;
        expect(Math.abs(local)).toBeGreaterThan(lot - 2.01);
        expect(s.to).toBeGreaterThan(s.from);
      }
    });
  });

  it('picks weighted options in proportion', () => {
    const options = [
      ['a', 1],
      ['b', 3],
    ] as const;
    let b = 0;
    for (let i = 0; i < 1000; i++) if (pickWeighted(options, (i + 0.5) / 1000) === 'b') b++;
    expect(b).toBe(750);
  });
});

describe('street lamps', () => {
  const city = generateCity(1337);
  const lamps = generateStreetLamps();

  it('stand on the sidewalk, just in from the kerb', () => {
    expect(lamps.length).toBe(16 * 16 * 4 * 3);
    for (const l of lamps) {
      const gx = l.x + HALF_EXTENT;
      const gz = l.z + HALF_EXTENT;
      const fromRoad = (g: number) => Math.abs(g - BLOCK_SIZE * Math.round(g / BLOCK_SIZE));
      const d = l.dx !== 0 ? fromRoad(gx) : fromRoad(gz);
      expect(d).toBeCloseTo(LAMP_OFFSET, 6);
      expect(d).toBeGreaterThan(ROAD_WIDTH / 2);
      expect(d).toBeLessThan(ROAD_WIDTH / 2 + SIDEWALK);
    }
  });

  it('never stand inside a building', () => {
    const inside = lamps.filter((l) => city.buildings.some((b) => l.x > b.minX && l.x < b.maxX && l.z > b.minZ && l.z < b.maxZ));
    expect(inside).toEqual([]);
  });
});
