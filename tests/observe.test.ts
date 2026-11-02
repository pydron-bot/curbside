import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CameraRig } from '../src/render/cameraRig';
import {
  IDLE_FADE,
  OBSERVE_MAX_HEIGHT,
  OBSERVE_MIN_HEIGHT,
  ObserveCamera,
  IdleFade,
  PAN_MAX,
  ROOF_CLEARANCE,
  SHIELD_HEIGHT,
  clampHeight,
  clampToCity,
  nextHour,
  nextLive,
  pickFollow,
  roofFloor,
  screenToWorld,
  spawnShield,
  type PickCar,
  type PickPed,
} from '../src/game/observe';
import { HALF_EXTENT, generateCity, type Rect } from '../src/world/city';
import { EventBus } from '../src/core/events';
import { CityLife, type CityLifeDeps } from '../src/game/cityLife';
import { random } from './helpers';
import { MAX_HEIGHT } from '../src/world/districts';

const rect = (): Rect => ({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 });

describe('observe camera clamps', () => {
  it('keeps the height between street level, the roofs and the tier cap', () => {
    expect(clampHeight(2, 'high')).toBe(OBSERVE_MIN_HEIGHT);
    expect(clampHeight(500, 'medium')).toBe(OBSERVE_MAX_HEIGHT.medium);
    expect(clampHeight(500, 'low')).toBe(OBSERVE_MAX_HEIGHT.low);
    expect(clampHeight(15, 'high', 20)).toBe(20);
    expect(clampHeight(60, 'high', 20)).toBe(60);
    // Lower tiers never see wider.
    expect(OBSERVE_MAX_HEIGHT.low).toBeLessThanOrEqual(OBSERVE_MAX_HEIGHT.medium);
    expect(OBSERVE_MAX_HEIGHT.medium).toBeLessThanOrEqual(OBSERVE_MAX_HEIGHT.high);
  });

  it('holds the camera clear of the tallest roof near it', () => {
    const buildings = [
      { minX: 0, minZ: 0, maxX: 10, maxZ: 10, height: 9 },
      { minX: 30, minZ: 0, maxX: 40, maxZ: 10, height: 12 },
    ];
    expect(roofFloor(buildings, 5, 5)).toBe(9 + ROOF_CLEARANCE);
    // Between them, both within reach: the taller wins.
    expect(roofFloor(buildings, 20, 5, 12)).toBe(12 + ROOF_CLEARANCE);
    expect(roofFloor(buildings, 100, 100)).toBe(0);
    // Over the real city: never under the tallest roof plus the clearance, and the cap is above any floor.
    const city = generateCity(1337);
    let worst = 0;
    for (let x = -480; x <= 480; x += 32) for (let z = -480; z <= 480; z += 32) worst = Math.max(worst, roofFloor(city.buildings, x, z));
    expect(worst).toBeLessThanOrEqual(MAX_HEIGHT + ROOF_CLEARANCE);
    expect(worst).toBeGreaterThan(OBSERVE_MIN_HEIGHT);
    expect(OBSERVE_MAX_HEIGHT.low).toBeGreaterThan(worst);
  });

  it('keeps the focus over the city', () => {
    expect(clampToCity(HALF_EXTENT + 50)).toBe(HALF_EXTENT);
    expect(clampToCity(-HALF_EXTENT - 1)).toBe(-HALF_EXTENT);
    expect(clampToCity(12)).toBe(12);
    const cam = new ObserveCamera();
    cam.reset(HALF_EXTENT - 1, 0, 300);
    cam.drag(-400, 0, 1);
    cam.clamp(1 / 60, 'medium', 0);
    expect(cam.x).toBe(HALF_EXTENT);
    expect(cam.height).toBe(OBSERVE_MAX_HEIGHT.medium);
  });

  it('pans in screen axes whichever way the view is turned', () => {
    const out = { x: 0, z: 0 };
    // Unturned: screen-up is world -Z, screen-right +X.
    screenToWorld(0, 1, 0, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(-1);
    screenToWorld(1, 0, 0, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(0);
    // Turned a quarter: up the screen is now along the rig's turned up vector.
    const rig = new CameraRig(16 / 9);
    rig.yaw = Math.PI / 2;
    rig.snapTo(0, 0);
    screenToWorld(0, 1, rig.yaw, out);
    const up = rig.camera.up;
    expect(out.x).toBeCloseTo(up.x);
    expect(out.z).toBeCloseTo(up.z);
  });

  it('eases a held pan up to a speed that grows with height, capped', () => {
    const cam = new ObserveCamera();
    cam.reset(0, 0, 40);
    for (let i = 0; i < 120; i++) {
      cam.steer(1 / 60, 1, 0, 0, 0);
      cam.clamp(1 / 60, 'high');
    }
    expect(cam.vx).toBeGreaterThan(0.9 * cam.panSpeed);
    expect(cam.vz).toBeCloseTo(0);
    cam.height = 1000;
    expect(cam.panSpeed).toBe(PAN_MAX);
    // Let go: it stops.
    for (let i = 0; i < 120; i++) {
      cam.steer(1 / 60, 0, 0, 0, 0);
      cam.clamp(1 / 60, 'high');
    }
    expect(Math.abs(cam.vx)).toBeLessThan(0.5);
  });

  it('zooms and turns while held, and a drag keeps the ground under the finger', () => {
    const cam = new ObserveCamera();
    cam.reset(0, 0, 40);
    cam.steer(1, 0, 0, 1, 0);
    expect(cam.height).toBeLessThan(40);
    cam.steer(0.5, 0, 0, 0, 1);
    expect(cam.yaw).toBeGreaterThan(0);
    cam.reset(0, 0, 40);
    // Dragging the picture right moves the camera left (-X); dragging it down moves the camera up the screen (-Z).
    cam.drag(10, 0, 0.5);
    expect(cam.x).toBeCloseTo(-5);
    cam.drag(0, 10, 0.5);
    expect(cam.z).toBeCloseTo(-5);
  });

  it('rides along with a target', () => {
    const cam = new ObserveCamera();
    cam.reset(0, 0, 40);
    let tx = 30;
    for (let i = 0; i < 300; i++) {
      tx += 10 / 60;
      cam.follow(1 / 60, tx, 0, 10, 0);
      cam.clamp(1 / 60, 'high');
    }
    expect(Math.abs(cam.x - tx)).toBeLessThan(0.5);
    expect(cam.vx).toBeCloseTo(10, 0);
  });
});

describe('observe rig yaw', () => {
  it('turns the view without moving its look point', () => {
    const rig = new CameraRig(852 / 393);
    rig.snapTo(10, 20, 60);
    const look = new Vector3();
    const v0 = rig.visibleGround(rect());
    rig.yaw = Math.PI / 2;
    rig.snapTo(10, 20, 60);
    const v1 = rig.visibleGround(rect());
    // A wide landscape view turned a quarter: long across Z now.
    expect(v0.maxX - v0.minX).toBeGreaterThan(v0.maxZ - v0.minZ);
    expect(v1.maxZ - v1.minZ).toBeGreaterThan(v1.maxX - v1.minX);
    rig.camera.getWorldDirection(look);
    const t = -rig.camera.position.y / look.y;
    expect(rig.camera.position.x + look.x * t).toBeCloseTo(10);
    expect(rig.camera.position.z + look.z * t).toBeCloseTo(20);
    // Yaw 0 is the play camera exactly.
    rig.yaw = 0;
    rig.snapTo(10, 20, 60);
    expect(rig.camera.up.z).toBeCloseTo(-1);
    expect(rig.camera.position.z).toBeGreaterThan(20);
  });
});

describe('observe idle fade', () => {
  it('fades after a few seconds idle and comes back on any input', () => {
    const f = new IdleFade();
    expect(f.step(1)).toBe(true);
    expect(f.step(IDLE_FADE)).toBe(false);
    f.poke();
    expect(f.shown).toBe(true);
    expect(f.step(0.1)).toBe(true);
    // Held (the palette open): never fades.
    for (let i = 0; i < 20; i++) expect(f.step(1, true)).toBe(true);
    expect(f.step(IDLE_FADE - 0.5)).toBe(true);
    expect(f.step(1)).toBe(false);
  });
});

describe('observe follow pick', () => {
  const car = (x: number, z: number, reach = 2.4, visible = true): PickCar => ({ sim: { x, z, body: { reach } }, mesh: { root: { visible } } });
  const ped = (x: number, z: number, visible = true): PickPed => ({ agent: { s: { x, z } }, model: { root: { visible } } });

  it('picks the car under the tap, the nearest edge first', () => {
    const cars = [car(0, 0), car(6, 0), car(50, 0, 2.4, false)];
    expect(pickFollow(1, 0, cars, [], 0.5)?.car).toBe(cars[0]);
    expect(pickFollow(5, 0, cars, [], 0.5)?.car).toBe(cars[1]);
    // A bus's long body counts from further off.
    const bus = car(20, 0, 6);
    expect(pickFollow(25, 0, [bus], [], 0.5)?.car).toBe(bus);
    // Hidden ones (retired) and empty ground pick nothing.
    expect(pickFollow(50, 0, cars, [], 0.5)).toBeNull();
    expect(pickFollow(0, 30, cars, [], 0.5)).toBeNull();
  });

  it('picks a person beside a car, and grows the slop with the zoom', () => {
    const cars = [car(0, 0)];
    const crowd = [ped(3.2, 0), ped(40, 0, false)];
    expect(pickFollow(3.3, 0, cars, crowd, 0.5)?.ped).toBe(crowd[0]);
    expect(pickFollow(1, 0, cars, crowd, 0.5)?.car).toBe(cars[0]);
    expect(pickFollow(6, 0, [], crowd, 0.5)).toBeNull();
    expect(pickFollow(6, 0, [], crowd, 3)?.ped).toBe(crowd[0]);
    expect(pickFollow(40, 0, [], crowd, 3)).toBeNull();
  });
});

describe('observe next incident', () => {
  it('visits each running scene in turn, wrapping', () => {
    const live = [false, true, false, true, true];
    const on = (i: number) => live[i];
    expect(nextLive(5, -1, on)).toBe(1);
    expect(nextLive(5, 1, on)).toBe(3);
    expect(nextLive(5, 3, on)).toBe(4);
    expect(nextLive(5, 4, on)).toBe(1);
    // Only the current one running: it again.
    expect(nextLive(5, 1, (i) => i === 1)).toBe(1);
    expect(nextLive(5, 2, () => false)).toBe(-1);
  });
});

describe('observe spawn shield', () => {
  it('is the whole view at play heights and shrinks about the focus above', () => {
    const view: Rect = { minX: -100, minZ: -50, maxX: 100, maxZ: 50 };
    const out = rect();
    expect(spawnShield(view, 0, 0, SHIELD_HEIGHT, out)).toEqual(view);
    spawnShield(view, 10, 0, SHIELD_HEIGHT * 2, out);
    expect(out.maxX - out.minX).toBeCloseTo(100);
    expect(out.maxZ - out.minZ).toBeCloseTo(50);
    expect(out.minX).toBeLessThan(10);
    expect(out.maxX).toBeGreaterThan(10);
  });
});

describe('observe: the city lives with nobody playing', () => {
  const world = { observing: false, activity: true };
  const life = new CityLife({
    bus: new EventBus(),
    vehicles: [],
    population: { crowd: [] },
    player: { driving: null, lastDriven: null },
    city: generateCity(1337),
    signals: {},
    rand: random(1),
    now: () => 100,
    view: (out: object) => Object.assign(out, { minX: -50, minZ: -50, maxX: 50, maxZ: 50 }),
    // Behind the title or observing: nobody's playing.
    playing: () => false,
    observing: () => world.observing,
    activity: () => world.activity,
    stars: () => 4,
    // A first run's hold (named `opening` from the cold open on): on, and lifted by observing all the same.
    tutorial: () => true,
    opening: () => true,
    keep: () => false,
    avoid: [],
    busStops: [],
    vendors: [],
    trafficScale: () => 1,
    npcShoot() {},
    collect: () => false,
    focus: () => ({ x: 0, z: 0, vx: 0, vz: 0 }),
  } as unknown as CityLifeDeps);
  // Held by the title and a timed race, as the busy scenes are (and the first run's hold, whose name changes with the cold open).
  life.clock.define('busy', { every: [1, 1], cap: 1, first: 0, hold: ['title', 'activity'] });

  it('lifts the title and activity holds while observing, and people gather', () => {
    world.observing = false;
    expect(life.live).toBe(false);
    expect(life.lively('busker')).toBe(false);
    expect(life.due('busy', 0)).toBe(false);
    world.observing = true;
    expect(life.live).toBe(true);
    expect(life.lively('busker')).toBe(true);
    // A held run's race doesn't hold the watched city.
    expect(life.due('busy', 0)).toBe(true);
    // Nothing waits on the player: still not playing.
    expect(life.d.playing()).toBe(false);
    world.observing = false;
  });
});

describe('observe time nudge', () => {
  it('moves the day on to the next stop, wrapping past midnight', () => {
    expect(nextHour(13)[0]).toBe('GOLDEN HOUR');
    expect(nextHour(12.5)[0]).toBe('GOLDEN HOUR');
    expect(nextHour(12.1)[0]).toBe('GOLDEN HOUR');
    expect(nextHour(11.9)[0]).toBe('NOON');
    expect(nextHour(23)[0]).toBe('SMALL HOURS');
    expect(nextHour(2)[0]).toBe('DAWN');
    // A full round visits every stop.
    let h = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const [name, at] = nextHour(h);
      seen.add(name);
      h = at;
    }
    expect(seen.size).toBe(6);
  });
});
