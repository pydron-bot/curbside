import { describe, expect, it } from 'vitest';
import { SAFEHOUSE, placeDocks, placePayphones } from '../src/game/modes/places';
import { GETAWAY_TAG } from '../src/game/opening';
import { SEDAN, VEHICLE_BODIES, VEHICLE_SPECS, createVehicleState, stepVehicle } from '../src/entities/vehicle';
import { routeToward } from '../src/systems/pursuit';
import { towPose } from '../src/systems/emergency';
import { len2 } from '../src/core/len';
import { collideVehicleStatic } from '../src/systems/physics';
import { driveAi, driverFor } from '../src/systems/traffic';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';
import { readFileSync } from 'node:fs';
import {
  CATCH_HOLD,
  CATCH_RANGE,
  COLLECT_RADIUS,
  SCRATCH_LINE,
  hookLetGo,
  routeLeg,
  LOST_RANGE,
  MissionRun,
  MissionScenes,
  NIGHT_PHONE,
  REPLAY_PAY,
  SCENE_REACH,
  SCENE_REROLL,
  arcOf,
  arcRings,
  endsChapter,
  missionTags,
  nextInArc,
  replayJob,
  replayReward,
  type MissionDef,
  type MissionSignal,
  type MissionView,
  type SceneAction,
  type SceneHost,
} from '../src/systems/missions';
import { SUNRISE, SUNSET } from '../src/render/timeOfDay';
import { SAVE_KEY, loadSave, pruneSave } from '../src/game/progressSave';
import { COMPLETION_WEIGHTS, completion, completionParts, passedOf } from '../src/game/progressStats';
import { badgeFor } from '../src/ui/progressScreens';
import { buildMissions } from '../src/systems/missionsData';
import { generateCity } from '../src/world/city';
import { MAX_NODE } from '../src/world/roads';
import { districtAt, type District } from '../src/world/districts';

type Car = { x: number; z: number; wrecked: boolean; health?: number };
type Ped = { x: number; z: number; down: boolean };

/** A world the test moves around by hand. */
function world() {
  const cars = new Map<string, Car>();
  const peds = new Map<string, Ped>();
  const v: MissionView & { cars: Map<string, Car>; peds: Map<string, Ped> } = {
    x: 0,
    z: 0,
    inCar: false,
    carTag: null,
    carArchetype: null,
    carHealth: 1,
    speed: 0,
    stars: 0,
    cars,
    peds,
    vehicle: (tag) => cars.get(tag) ?? null,
    ped: (tag) => peds.get(tag) ?? null,
  };
  return v;
}

function tick(run: MissionRun, v: MissionView, seconds = 1 / 60): MissionSignal[] {
  const out: MissionSignal[] = [];
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    const s = run.update(1 / 60, v);
    if (s) out.push(s);
  }
  return out;
}

const def = (steps: MissionDef['steps']): MissionDef => ({ id: 't', title: 'T', phone: 'p', intro: [], outro: [], reward: 100, steps });

describe('mission engine: steps', () => {
  it('begin starts the first step; goto needs the right place (and a car if asked)', () => {
    const run = new MissionRun(def([{ kind: 'goto', x: 100, z: 0, r: 5, inCar: true, text: 'GO' }]));
    const v = world();
    expect(run.begin()).toMatchObject({ kind: 'step', index: 0 });
    expect(tick(run, v)).toEqual([]);
    v.x = 98;
    expect(tick(run, v)).toEqual([]);
    v.inCar = true;
    expect(tick(run, v)[0]).toMatchObject({ kind: 'passed' });
    expect(run.state).toBe('passed');
  });

  it('enter by tag or archetype, then deliver it and stop', () => {
    const run = new MissionRun(
      def([
        { kind: 'enter', archetype: 'sedan', text: 'STEAL' },
        { kind: 'deliver', archetype: 'sedan', x: 50, z: 50, minHealth: 0.5, text: 'DELIVER' },
      ]),
    );
    const v = world();
    run.begin();
    v.inCar = true;
    v.carArchetype = 'van';
    expect(tick(run, v)).toEqual([]);
    v.carArchetype = 'sedan';
    expect(tick(run, v)[0]).toMatchObject({ kind: 'step', index: 1 });
    v.x = v.z = 50;
    v.speed = 10;
    expect(tick(run, v)).toEqual([]);
    v.speed = 1;
    expect(tick(run, v)[0]).toMatchObject({ kind: 'passed' });
  });

  it('a car delivered too damaged fails the job', () => {
    const run = new MissionRun(def([{ kind: 'deliver', x: 0, z: 0, minHealth: 0.5, text: 'D' }]));
    const v = world();
    run.begin();
    v.inCar = true;
    v.carHealth = 0.3;
    expect(tick(run, v)[0]).toEqual({ kind: 'failed', reason: 'THE CAR IS TOO BADLY DAMAGED' });
  });

  it('a pick-up needs a stop beside the person for a moment', () => {
    const run = new MissionRun(def([{ kind: 'pickup', tag: 'tuna', text: 'P' }]));
    const v = world();
    run.begin();
    v.peds.set('tuna', { x: 3, z: 0, down: false });
    v.inCar = true;
    v.speed = 4;
    expect(tick(run, v, 2)).toEqual([]);
    v.speed = 0;
    expect(tick(run, v, 1)[0]).toMatchObject({ kind: 'passed' });
  });

  it('destroy counts wrecks as progress and passes when all are wrecked', () => {
    const run = new MissionRun(def([{ kind: 'destroy', tags: ['a', 'b'], text: 'X' }]));
    const v = world();
    v.cars.set('a', { x: 0, z: 0, wrecked: false });
    v.cars.set('b', { x: 0, z: 0, wrecked: false });
    run.begin();
    v.cars.get('a')!.wrecked = true;
    expect(tick(run, v)).toEqual([{ kind: 'progress' }]);
    expect(tick(run, v)).toEqual([]);
    v.cars.get('b')!.wrecked = true;
    expect(tick(run, v)[0]).toMatchObject({ kind: 'passed' });
  });

  it('knock out, survive, lose the heat', () => {
    const run = new MissionRun(
      def([
        { kind: 'knockOut', tag: 'c', text: 'K' },
        { kind: 'survive', seconds: 2, text: 'S' },
        { kind: 'loseHeat', text: 'L' },
      ]),
    );
    const v = world();
    run.begin();
    expect(tick(run, v)).toEqual([]); // not spawned yet
    v.peds.set('c', { x: 0, z: 0, down: true });
    expect(tick(run, v)[0]).toMatchObject({ kind: 'step', index: 1 });
    v.stars = 3;
    expect(tick(run, v, 1.5)).toEqual([]);
    expect(tick(run, v, 0.6)[0]).toMatchObject({ kind: 'step', index: 2 });
    expect(tick(run, v, 2)).toEqual([]);
    v.stars = 0;
    expect(tick(run, v, 1).at(-1)).toMatchObject({ kind: 'passed' });
  });

  it('collect takes the points in any order; race takes checkpoints in order', () => {
    const run = new MissionRun(
      def([
        { kind: 'collect', points: [[10, 0], [20, 0]], text: 'C' },
        { kind: 'race', nodes: [[1, 0], [2, 0]], text: 'R' },
      ]),
    );
    const v = world();
    run.begin();
    v.x = 20 + COLLECT_RADIUS - 0.5;
    expect(tick(run, v)).toEqual([{ kind: 'progress' }]);
    v.x = 10;
    expect(tick(run, v)[0]).toMatchObject({ kind: 'step', index: 1 });
    v.x = 128;
    expect(tick(run, v)).toEqual([]); // the second checkpoint first doesn't count
    v.x = 64;
    expect(tick(run, v)).toEqual([{ kind: 'progress' }]);
    v.x = 128;
    expect(tick(run, v)[0]).toMatchObject({ kind: 'passed' });
  });
});

describe('mission engine: failing', () => {
  it('a step timer runs out', () => {
    const run = new MissionRun(def([{ kind: 'goto', x: 999, z: 0, timer: 1, text: 'G' }]));
    run.begin();
    expect(tick(run, world(), 1.1).at(-1)).toEqual({ kind: 'failed', reason: 'OUT OF TIME' });
  });

  it('a step can say what running out of time means', () => {
    const run = new MissionRun(def([{ kind: 'goto', x: 999, z: 0, timer: 1, timeout: 'THE SPIT WENT COLD', text: 'G' }]));
    run.begin();
    expect(tick(run, world(), 1.1).at(-1)).toEqual({ kind: 'failed', reason: 'THE SPIT WENT COLD' });
  });

  it('a target car wrecked, or left behind', () => {
    const run = new MissionRun(
      def([{ kind: 'loseHeat', text: 'L', fail: [{ wrecked: 'car', reason: 'WRECKED' }, { lost: 'car', reason: 'LOST' }] }]),
    );
    const v = world();
    v.stars = 2;
    v.cars.set('car', { x: 0, z: 0, wrecked: false });
    run.begin();
    expect(tick(run, v)).toEqual([]);
    v.cars.get('car')!.x = LOST_RANGE + 1;
    expect(tick(run, v)[0]).toEqual({ kind: 'failed', reason: 'LOST' });
    const again = new MissionRun(run.def);
    again.begin();
    v.cars.set('car', { x: 0, z: 0, wrecked: true });
    expect(tick(again, v)[0]).toEqual({ kind: 'failed', reason: 'WRECKED' });
  });

  it('called off from outside (wasted / busted)', () => {
    const run = new MissionRun(def([{ kind: 'survive', seconds: 9, text: 'S' }]));
    run.begin();
    expect(run.fail('WASTED')).toEqual({ kind: 'failed', reason: 'WASTED' });
    expect(tick(run, world())).toEqual([]);
  });
});

describe('mission engine: unscratched, the hook, a route', () => {
  it("a 'damaged' fail goes as soon as the car's health is under the line (a scratch), not before", () => {
    const run = new MissionRun(def([{ kind: 'enter', tag: 'van', text: 'E', fail: [{ damaged: 'van', reason: 'SCRATCHED' }] }]));
    const v = world();
    v.cars.set('van', { x: 0, z: 0, wrecked: false, health: 1 });
    run.begin();
    tick(run, v, 0.5);
    v.cars.get('van')!.health = SCRATCH_LINE + 0.01;
    tick(run, v, 0.5);
    expect(run.state).toBe('running');
    v.cars.get('van')!.health = SCRATCH_LINE - 0.01;
    expect(tick(run, v)).toEqual([{ kind: 'failed', reason: 'SCRATCHED' }]);
    // Its own line, and a car the world doesn't report health for counts as full.
    const strict = new MissionRun(def([{ kind: 'survive', seconds: 9, text: 'S', fail: [{ damaged: 'van', below: 0.99, reason: 'X' }] }]));
    v.cars.set('van', { x: 0, z: 0, wrecked: false });
    strict.begin();
    tick(strict, v, 1);
    expect(strict.state).toBe('running');
    v.cars.get('van')!.health = 0.98;
    tick(strict, v);
    expect(strict.state).toBe('failed');
  });

  it('the hook holds while the truck drives; caught standing for a moment, carjacked, wrecked or the car taken, it lets go', () => {
    const hook = { held: 0 };
    const look = { driven: true, taken: false, speed: 10, distance: 5 };
    expect(hookLetGo(hook, 1, look)).toBe(false);
    // Stopped, but the player's not near: nothing.
    look.speed = 0;
    look.distance = CATCH_RANGE + 1;
    expect(hookLetGo(hook, 5, look)).toBe(false);
    // Caught at a light: a moment, then the crew gives it up; moving off starts the count again.
    look.distance = 8;
    expect(hookLetGo(hook, CATCH_HOLD / 2, look)).toBe(false);
    look.speed = 6;
    expect(hookLetGo(hook, CATCH_HOLD / 2, look)).toBe(false);
    look.speed = 0;
    expect(hookLetGo(hook, CATCH_HOLD * 0.6, look)).toBe(false);
    expect(hookLetGo(hook, CATCH_HOLD * 0.6, look)).toBe(true);
    // No driver (wrecked, carjacked, bailed) or the player in the car: at once, wherever.
    const far = { driven: false, taken: false, speed: 12, distance: 300 };
    expect(hookLetGo({ held: 0 }, 1 / 60, far)).toBe(true);
    expect(hookLetGo({ held: 0 }, 1 / 60, { ...far, driven: true, taken: true })).toBe(true);
  });

  it('a route moves on as its car heads into each crossing, round and round', () => {
    const route = [[1, 0], [1, 2], [0, 2]] as const;
    expect(routeLeg(route, 0, 0, 0)).toBe(0);
    expect(routeLeg(route, 0, 1, 0)).toBe(1);
    expect(routeLeg(route, 1, 1, 0)).toBe(1);
    expect(routeLeg(route, 1, 1, 2)).toBe(2);
    expect(routeLeg(route, 2, 0, 2)).toBe(0);
    expect(routeLeg([], 3, 0, 0)).toBe(0);
  });
});

describe('mission engine: mayhem and crowds', () => {
  it('a mayhem step counts score awards in its area and passes on the next update', () => {
    const run = new MissionRun(def([{ kind: 'mayhem', points: 1000, near: { x: 0, z: 0, r: 50 }, text: 'M' }]));
    const v = world();
    run.begin();
    run.award(600, v);
    expect(run.mayhem).toBe(600);
    expect(tick(run, v)).toEqual([]);
    // Out of the area: doesn't count.
    v.x = 80;
    run.award(900, v);
    expect(run.mayhem).toBe(600);
    v.x = 10;
    run.award(500, v);
    // Not mid-award: an award comes while other systems are halfway through their step.
    expect(run.state).toBe('running');
    expect(tick(run, v)[0]).toMatchObject({ kind: 'passed' });
  });

  it('mayhem anywhere with no area; in a district; round a tagged car as it moves', () => {
    const v = world();
    const any = new MissionRun(def([{ kind: 'mayhem', points: 100, text: 'M' }]));
    any.begin();
    v.x = 5000;
    any.award(100, v);
    expect(tick(any, v)[0]).toMatchObject({ kind: 'passed' });

    const row = new MissionRun(def([{ kind: 'mayhem', points: 100, near: { x: -256, z: -256, district: 'oldtown' }, text: 'M' }]));
    row.begin();
    v.x = 300;
    v.z = 300; // Rustwater
    row.award(100, v);
    expect(row.mayhem).toBe(0);
    v.x = -400;
    v.z = -400; // Cobble Row, far from the point
    row.award(100, v);
    expect(row.mayhem).toBe(100);

    const coach = new MissionRun(def([{ kind: 'mayhem', points: 100, near: { x: 0, z: 0, r: 30, tag: 'coach' }, text: 'M' }]));
    coach.begin();
    v.cars.set('coach', { x: 500, z: 0, wrecked: false });
    v.x = 10;
    v.z = 0;
    coach.award(100, v);
    expect(coach.mayhem).toBe(0);
    v.x = 490;
    coach.award(100, v);
    expect(coach.mayhem).toBe(100);
  });

  it('awards only count on a mayhem step (not before it, not after the job)', () => {
    const run = new MissionRun(def([{ kind: 'goto', x: 100, z: 0, text: 'G' }, { kind: 'mayhem', points: 100, text: 'M' }]));
    const v = world();
    run.begin();
    run.award(500, v);
    v.x = 100;
    expect(tick(run, v)[0]).toMatchObject({ kind: 'step', index: 1 });
    expect(run.mayhem).toBe(0);
    run.award(100, v);
    tick(run, v);
    expect(run.state).toBe('passed');
    run.award(100, v);
    expect(run.mayhem).toBe(100);
  });

  it('knockOutAll counts each one down as progress, in any order', () => {
    const run = new MissionRun(def([{ kind: 'knockOutAll', tags: ['a', 'b'], text: 'K' }]));
    const v = world();
    run.begin();
    v.peds.set('a', { x: 0, z: 0, down: false });
    v.peds.set('b', { x: 0, z: 0, down: true });
    expect(tick(run, v)).toEqual([{ kind: 'progress' }]);
    expect(run.destroyed).toBe(1);
    v.peds.get('a')!.down = true;
    expect(tick(run, v)[0]).toMatchObject({ kind: 'passed' });
  });

  it('fails when someone you came for is knocked down', () => {
    const run = new MissionRun(def([{ kind: 'pickup', tag: 'l', text: 'P', fail: [{ down: 'l', reason: 'NOT HIM' }] }]));
    const v = world();
    run.begin();
    expect(tick(run, v)).toEqual([]); // not on the street yet
    v.peds.set('l', { x: 50, z: 0, down: false });
    expect(tick(run, v)).toEqual([]);
    v.peds.get('l')!.down = true;
    expect(tick(run, v)[0]).toEqual({ kind: 'failed', reason: 'NOT HIM' });
  });
});

describe("mission engine: a job's scenes", () => {
  function host(results: boolean[]) {
    const calls: string[] = [];
    let unfeatured = 0;
    const h: SceneHost = {
      start: (id) => {
        calls.push(id);
        return results.shift() ?? false;
      },
      unfeature: () => unfeatured++,
    };
    return { h, calls, unfeatured: () => unfeatured };
  }
  const race: SceneAction = { do: 'scene', scene: 'race', x: 0, z: 0 };

  it('waits for the player to come within reach, then starts it', () => {
    const scenes = new MissionScenes();
    const { h, calls } = host([true]);
    scenes.request(race);
    expect(scenes.step(1, SCENE_REACH + 10, 0, h)).toBeNull();
    expect(calls).toEqual([]);
    expect(scenes.step(1, SCENE_REACH - 10, 0, h)).toBe(race);
    expect(calls).toEqual(['race']);
    expect(scenes.pending).toEqual([]);
  });

  it("re-rolls once if it couldn't start, then gives up quietly", () => {
    const scenes = new MissionScenes();
    const { h, calls } = host([false, false, true]);
    scenes.request(race);
    scenes.step(1 / 60, 0, 0, h);
    expect(calls).toHaveLength(1);
    for (let t = 0; t < SCENE_REROLL - 0.1; t += 1 / 60) scenes.step(1 / 60, 0, 0, h);
    expect(calls).toHaveLength(1);
    for (let t = 0; t < 0.2; t += 1 / 60) scenes.step(1 / 60, 0, 0, h);
    expect(calls).toHaveLength(2);
    expect(scenes.pending).toEqual([]);
    for (let t = 0; t < 10; t += 1 / 60) scenes.step(1 / 60, 0, 0, h);
    expect(calls).toHaveLength(2);
  });

  it('the end of the job drops what never started and stops featuring what did', () => {
    const scenes = new MissionScenes();
    const { h, unfeatured } = host([true]);
    scenes.request(race);
    scenes.request({ ...race, scene: 'fight', x: 1000 });
    scenes.step(1, 0, 0, h);
    expect(scenes.pending).toHaveLength(1);
    scenes.end(h);
    expect(scenes.pending).toEqual([]);
    expect(unfeatured()).toBe(1);
    // Nothing featured: nothing to stop.
    scenes.end(h);
    expect(unfeatured()).toBe(1);
  });
});

describe('the story', () => {
  const city = generateCity(1337);
  const docks = placeDocks(city);
  const missions = buildMissions(docks, SAFEHOUSE);
  const phones = new Set(placePayphones().map((p) => p.id));
  const blocked = (x: number, z: number, m: number) => city.obstacles.some((o) => x > o.minX - m && x < o.maxX + m && z > o.minZ - m && z < o.maxZ + m);
  const main = missions.filter((m) => arcOf(m) === 'main');
  const night = missions.filter((m) => arcOf(m) === 'night');

  it('the main story (s-ids) and the Night Shift (m1-m13, ids unchanged), each job from a payphone, paying, with something to say', () => {
    // Chapter 2 is being built: the jobs it has so far, in story order.
    expect(main.map((m) => m.id)).toEqual(['s1-wrongstop', 's2-noise', 's3-quiet', 's4-problems', 's5-ribbon', 's6-quietest', 's8-doner', 's11-alarmcall', 's12-loudest']);
    expect(main.filter((m) => m.chapter === 2).map((m) => m.id)).toEqual(['s8-doner', 's11-alarmcall', 's12-loudest']);
    expect(night.map((m) => m.id)).toEqual([
      'm1-audition',
      'm2-tuna',
      'm3-saints',
      'm4-parcels',
      'm5-vans',
      'm6-midnight',
      'm7-collector',
      'm8-lastcall',
      'm9-fineprint',
      'm10-fallen',
      'm11-towaway',
      'm12-papertrail',
      'm13-noparking',
    ]);
    expect(new Set(missions.map((m) => m.id)).size).toBe(missions.length);
    const chapter = (n: number) => night.filter((m) => (m.chapter ?? 1) === n).length;
    expect([chapter(1), chapter(2)]).toEqual([8, 5]);
    for (const m of missions) {
      // The cold open's job has no call: no phone, no intro.
      expect(m.direct ? m.phone === '' && m.intro.length === 0 : phones.has(m.phone), m.id).toBe(true);
      expect(m.reward, m.id).toBeGreaterThan(0);
      if (!m.direct) expect(m.intro.length, m.id).toBeGreaterThan(0);
      expect(m.outro.length, m.id).toBeGreaterThan(0);
      expect(m.steps.length, m.id).toBeGreaterThan(0);
      for (const s of m.steps) expect(s.text.length, m.id).toBeGreaterThan(0);
    }
  });

  it('chapters run in order within an arc, and only the last job of a chapter with another after it ends one', () => {
    for (const arc of [main, night]) for (let i = 1; i < arc.length; i++) expect(arc[i].chapter ?? 1).toBeGreaterThanOrEqual(arc[i - 1].chapter ?? 1);
    expect(night.filter((m) => endsChapter(night, m)).map((m) => m.id)).toEqual(['m8-lastcall']);
    expect(main.filter((m) => endsChapter(main, m)).map((m) => m.id)).toEqual(['s6-quietest']);
    expect(endsChapter(night, { ...night[7] })).toBe(false); // not one of the story's
  });

  it('every call fits the card: at most three lines (it staggers three), each about 100 characters at most', () => {
    for (const m of missions) {
      expect(m.intro.length, m.id).toBeLessThanOrEqual(3);
      expect(m.outro.length, m.id).toBeLessThanOrEqual(3);
      for (const l of [...m.intro, ...m.outro]) expect(l.text.length, `${m.id}: ${l.text}`).toBeLessThanOrEqual(105);
      // Objective lines are short capitals.
      for (const s of m.steps) {
        expect(s.text.length, `${m.id}: ${s.text}`).toBeLessThanOrEqual(40);
        expect(s.text, m.id).toBe(s.text.toUpperCase());
      }
    }
  });

  it('every speaker has a badge colour, in the card and in its stylesheet', () => {
    const css = readFileSync(new URL('../src/ui/progress.css', import.meta.url), 'utf8');
    const speakers = new Set(missions.flatMap((m) => [...m.intro, ...m.outro].map((l) => l.who)));
    expect([...speakers].sort()).toEqual(["COMMISSIONER CLAMP", 'DEACON PIKE', 'DOREEN', "LIL' TUNA", 'LIONEL', 'MANNY', 'MAYOR LULL', 'VEX']);
    for (const who of speakers) {
      const badge = badgeFor(who);
      if (who !== 'VEX') expect(badge, who).not.toBe('vex');
      if (badge !== 'vex') expect(css, who).toContain(`.dlg-line[data-who='${badge}']`);
    }
  });

  it('names the real districts: no placeholder "arts quarter", "suburbs" or "old town" in anything said or shown', () => {
    for (const m of missions) {
      const text = [m.title, ...m.intro.map((l) => l.text), ...m.outro.map((l) => l.text), ...m.steps.map((s) => s.text)].join('\n');
      expect(text, m.id).not.toMatch(/arts quarter|suburbs|old town/i);
    }
  });

  it("chapter 2's people and cars are in the districts its dialogue names", () => {
    const want: Record<string, District> = {
      shifttruck: 'downtown', // "the city impound in Glass Heights"
      pike: 'residential', // "a Maple Flats bus shelter"
      tow1: 'arts', // "working the Mile"
      tow2: 'arts',
      tow3: 'arts',
      limo: 'downtown', // "his office in Glass Heights"
      clamp: 'downtown',
    };
    const found = new Set<string>();
    for (const m of night.filter((d) => d.chapter === 2))
      for (const s of m.steps)
        for (const a of s.start ?? [])
          if ((a.do === 'spawnCar' || a.do === 'spawnPed') && want[a.tag]) {
            expect(districtAt(a.x, a.z), `${m.id} ${a.tag}`).toBe(want[a.tag]);
            found.add(a.tag);
          }
    expect([...found].sort()).toEqual(Object.keys(want).sort());
  });

  it("chapter 1's people and cars are where its lines now say (Neon Mile, Cobble Row, Maple Flats)", () => {
    const want: Record<string, District> = { tuna: 'arts', tuna2: 'arts', van1: 'oldtown', van2: 'oldtown', van3: 'oldtown', collector: 'residential' };
    for (const m of night.filter((d) => (d.chapter ?? 1) === 1))
      for (const s of m.steps)
        for (const a of s.start ?? []) if ((a.do === 'spawnCar' || a.do === 'spawnPed') && want[a.tag]) expect(districtAt(a.x, a.z), `${m.id} ${a.tag}`).toBe(want[a.tag]);
  });

  it('KEEP IT LOUD happens where Doreen and Lionel say: Cobble Row, Glass Heights, Neon Mile', () => {
    const noise = main.find((m) => m.id === 's2-noise')!;
    const loud = noise.steps[0];
    expect(loud).toMatchObject({ kind: 'mayhem', points: 2500, near: { district: 'oldtown' } });
    if (loud.kind !== 'mayhem' || !loud.near) throw new Error('not a mayhem step');
    expect(districtAt(loud.near.x, loud.near.z)).toBe('oldtown');
    const scene = loud.start?.find((a) => a.do === 'scene');
    expect(scene && districtAt(scene.x, scene.z)).toBe('oldtown');
    const quiet = main.find((m) => m.id === 's3-quiet')!;
    const spawns = quiet.steps.flatMap((s) => s.start ?? []).filter((a) => a.do === 'spawnPed');
    expect(spawns.map((a) => a.tag)).toEqual(['lullwarden1', 'lullwarden2', 'lionel']);
    for (const a of spawns) expect(districtAt(a.x, a.z), a.tag).toBe('downtown');
    // The wardens are m13's: hostile, hi-vis, ped_stocky.
    for (const a of spawns.slice(0, 2)) expect(a).toMatchObject({ hostile: true, body: 'ped_stocky', shirt: '#d4e23c' });
    const drop = quiet.steps.at(-1)!;
    expect(drop.kind).toBe('deliver');
    if (drop.kind === 'deliver') expect(districtAt(drop.x, drop.z)).toBe('arts');
  });

  it("NINETY-NINE PROBLEMS: Doreen's van on the Shift's hook on Neon Mile, Doreen in Cobble Row, no scratch allowed", () => {
    const job = main.find((m) => m.id === 's4-problems')!;
    const [take, home] = job.steps;
    const spawns = take.start ?? [];
    const truck = spawns.find((a) => a.do === 'spawnCar' && a.tag === 'shifttow');
    const van = spawns.find((a) => a.do === 'spawnCar' && a.tag === 'doreenvan');
    if (truck?.do !== 'spawnCar' || van?.do !== 'spawnCar') throw new Error('no truck or van');
    // The Graveyard Shift's blue tow truck (Vex's), driven; Doreen's ice cream van.
    expect(truck).toMatchObject({ archetype: 'tow_truck', paint: '#3c5a8c', drive: true });
    expect(van).toMatchObject({ archetype: 'ice_cream_van' });
    for (const a of [truck, van]) expect(districtAt(a.x, a.z), a.tag).toBe('arts');
    // On the hook: where the city's tows carry a car (towPose), facing the same way.
    const pose = towPose(truck, VEHICLE_BODIES.tow_truck.reach, VEHICLE_BODIES.ice_cream_van.reach, van, { x: 0, z: 0, heading: 0 });
    expect(len2(pose.x - van.x, pose.z - van.z)).toBeLessThan(0.2);
    expect(van.heading).toBeCloseTo(truck.heading, 6);
    // The tow action comes after both spawns (it needs them).
    expect(spawns.findIndex((a) => a.do === 'tow')).toBe(spawns.length - 1);
    expect(spawns.at(-1)).toEqual({ do: 'tow', tag: 'doreenvan', truck: 'shifttow' });
    expect(take).toMatchObject({ kind: 'enter', tag: 'doreenvan' });
    expect(home).toMatchObject({ kind: 'deliver', tag: 'doreenvan' });
    if (home.kind !== 'deliver') throw new Error('not a deliver');
    expect(districtAt(home.x, home.z)).toBe('oldtown');
    const doreen = home.start?.find((a) => a.do === 'spawnPed');
    expect(doreen?.do === 'spawnPed' && districtAt(doreen.x, doreen.z)).toBe('oldtown');
    // Unscratched from the first step to the last.
    for (const s of job.steps) expect(s.fail?.some((f) => f.damaged === 'doreenvan'), s.text).toBe(true);
    // No towing for the player: the van is taken back, not hooked.
    expect(job.steps.some((s) => s.kind === 'enter' && s.archetype === 'tow_truck')).toBe(false);
  });

  it("RIBBON CUTTING: the Mayor's limo waits at her ribbon in Glass Heights, then drives off to be wrecked", () => {
    const job = main.find((m) => m.id === 's5-ribbon')!;
    expect(job.steps).toHaveLength(1);
    const [wreck] = job.steps;
    expect(wreck).toMatchObject({ kind: 'destroy', tags: ['lulllimo'] });
    const limo = wreck.start?.find((a) => a.do === 'spawnCar');
    expect(limo).toMatchObject({ archetype: 'limo', drive: true });
    if (limo?.do !== 'spawnCar') throw new Error('no limo');
    expect(limo.wait).toBeGreaterThan(0);
    expect(districtAt(limo.x, limo.z)).toBe('downtown');
    expect(wreck.start?.some((a) => a.do === 'give')).toBe(true);
    expect(wreck.fail ?? []).toEqual([]);
  });

  it("QUIETEST CITY: 5,000 round the judges' coach on its Glass Heights tour, a race, a fire and a turf flare-up on its route", () => {
    const job = main.find((m) => m.id === 's6-quietest')!;
    expect(job.steps).toHaveLength(1);
    const [show] = job.steps;
    if (show.kind !== 'mayhem' || !show.near) throw new Error('not a mayhem step round something');
    expect(show).toMatchObject({ points: 5000, near: { tag: 'coach' } });
    expect(show.near.district).toBeUndefined();
    const coach = show.start?.find((a) => a.do === 'spawnCar');
    if (coach?.do !== 'spawnCar' || !coach.route) throw new Error('no touring coach');
    expect(coach).toMatchObject({ tag: 'coach', archetype: 'bus', drive: true });
    // It leaves Glass Heights; the area starts round it.
    expect(districtAt(coach.x, coach.z)).toBe('downtown');
    expect([show.near.x, show.near.z]).toEqual([coach.x, coach.z]);
    const route = coach.route;
    for (const [ix, iz] of route) expect(Math.max(Math.abs(ix), Math.abs(iz))).toBeLessThan(MAX_NODE);
    // A race, a fire and a turf flare-up, in that order, each at a crossing on the tour.
    const scenes = (show.start ?? []).filter((a) => a.do === 'scene');
    expect(scenes.map((a) => a.do === 'scene' && a.scene)).toEqual(['race', 'fire', 'turf']);
    const at = scenes.map((a) => route.findIndex(([ix, iz]) => ix * 64 === a.x && iz * 64 === a.z));
    for (const i of at) expect(i).toBeGreaterThanOrEqual(0);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const [race, fire, turf] = scenes;
    expect(districtAt(race.x, race.z)).toBe('oldtown');
    expect(districtAt(fire.x, fire.z)).toBe('arts');
    // The VIPERS' Neon Mile, a block from Glass Heights (the GLASS BOYS): a border to square up across.
    expect(districtAt(turf.x, turf.z)).toBe('arts');
    expect([-64, 64].some((d) => districtAt(turf.x + d, turf.z) === 'downtown' || districtAt(turf.x, turf.z + d) === 'downtown')).toBe(true);
    // The judges tour at night (nine o'clock), and it's chapter 1's last job.
    expect(job.hour).toBe(21);
    expect(endsChapter(main, job)).toBe(true);
  });

  it("DONER: Manny's spit in a council van at the impound in Glass Heights, home to his shop in Cobble Row before it cools", () => {
    const job = main.find((m) => m.id === 's8-doner')!;
    const [take, home] = job.steps;
    expect(take).toMatchObject({ kind: 'enter', tag: 'spitvan' });
    const van = take.start?.find((a) => a.do === 'spawnCar');
    if (van?.do !== 'spawnCar') throw new Error('no van');
    expect(van).toMatchObject({ archetype: 'van' });
    expect(van.drive).toBeUndefined();
    expect(districtAt(van.x, van.z)).toBe('downtown');
    if (home.kind !== 'deliver') throw new Error('not a deliver');
    expect(home).toMatchObject({ tag: 'spitvan', timeout: 'THE SPIT WENT COLD' });
    // The clock runs from getting in, not from the call.
    expect(take.timer).toBeUndefined();
    expect(home.timer).toBeGreaterThan(0);
    expect(districtAt(home.x, home.z)).toBe('oldtown');
    const manny = home.start?.find((a) => a.do === 'spawnPed');
    if (manny?.do !== 'spawnPed') throw new Error('no Manny');
    expect(manny.tag).toBe('manny');
    expect(districtAt(manny.x, manny.z)).toBe('oldtown');
    expect(len2(manny.x - home.x, manny.z - home.z)).toBeLessThan(home.r ?? 6);
    for (const s of job.steps) expect(s.fail?.some((f) => f.wrecked === 'spitvan'), s.text).toBe(true);
    expect(home.fail?.some((f) => f.lost === 'spitvan')).toBe(true);
  });

  it("ALARM CALL: five parked cars to wire on the Mayor's Glass Heights street at night, then mayhem round her house", () => {
    const job = main.find((m) => m.id === 's11-alarmcall')!;
    expect(job.hour).toBe(22);
    const [fit, wake] = job.steps;
    if (fit.kind !== 'collect') throw new Error('not a collect');
    const cars = (fit.start ?? []).flatMap((a) => (a.do === 'spawnCar' ? [a] : []));
    expect(cars.map((a) => a.tag)).toEqual(['alarm1', 'alarm2', 'alarm3', 'alarm4', 'alarm5']);
    expect(fit.points).toHaveLength(cars.length);
    for (const [i, a] of cars.entries()) {
      // The city's kind of parked car (its alarm goes off when hit), not driven.
      expect(a.parked, a.tag).toBe(true);
      expect(a.drive, a.tag).toBeUndefined();
      expect(districtAt(a.x, a.z), a.tag).toBe('downtown');
      // Its alarm is fitted from the pavement beside it.
      const [px, pz] = fit.points[i];
      expect(len2(px - a.x, pz - a.z), a.tag).toBeLessThan(8);
    }
    if (wake.kind !== 'mayhem' || !wake.near) throw new Error('not mayhem round a place');
    expect(wake.near.tag).toBeUndefined();
    expect(wake.near.district).toBeUndefined();
    expect(districtAt(wake.near.x, wake.near.z)).toBe('downtown');
    for (const a of cars) expect(len2(a.x - wake.near.x, a.z - wake.near.z), a.tag).toBeLessThan(wake.near.r!);
  });

  it("LOUDEST CITY: mayhem round Lull's convoy on its tour (Glass Heights, Cobble Row, the ring road, Neon Mile), then her limo; the story's last job", () => {
    const job = main.find((m) => m.id === 's12-loudest')!;
    expect(main.at(-1)).toBe(job);
    const [show, wreck] = job.steps;
    if (show.kind !== 'mayhem' || !show.near) throw new Error('not mayhem round something');
    expect(show.near).toMatchObject({ tag: 'lulllimo', r: 100 });
    const convoy = (show.start ?? []).flatMap((a) => (a.do === 'spawnCar' ? [a] : []));
    expect(convoy.map((a) => [a.tag, a.archetype])).toEqual([
      ['lulllimo', 'limo'],
      ['convoyvan1', 'van'],
      ['convoyvan2', 'van'],
    ]);
    const [limo, ...vans] = convoy;
    const route = limo.route;
    if (!route) throw new Error('no route');
    expect([show.near.x, show.near.z]).toEqual([limo.x, limo.z]);
    for (const a of convoy) {
      // One convoy: the same route at the same pace, from outside the Town Hall in Glass Heights, all facing the same way.
      expect(a, a.tag).toMatchObject({ drive: true, cruise: limo.cruise, route, heading: limo.heading });
      expect(districtAt(a.x, a.z), a.tag).toBe('downtown');
    }
    // The limo wakes from further off than a van plus the gap to it, so however you come at them it leads.
    for (const v of vans) expect(limo.wait!, v.tag).toBeGreaterThan(v.wait! + len2(limo.x - v.x, limo.z - v.z));
    // Out to the ring road and back, on the map.
    for (const [ix, iz] of route) expect(Math.max(Math.abs(ix), Math.abs(iz))).toBeLessThanOrEqual(MAX_NODE);
    expect(route.some(([ix, iz]) => Math.max(Math.abs(ix), Math.abs(iz)) === MAX_NODE)).toBe(true);
    // An alarm, a race, a fire and a turf flare-up, each at a crossing of the route, in its order (one scene at a time).
    const scenes = (show.start ?? []).flatMap((a) => (a.do === 'scene' ? [a] : []));
    expect(scenes.map((a) => a.scene)).toEqual(['alarm', 'race', 'fire', 'turf']);
    const at = scenes.map((a) => route.findIndex(([ix, iz]) => ix * 64 === a.x && iz * 64 === a.z));
    for (const i of at) expect(i).toBeGreaterThanOrEqual(0);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(scenes.map((a) => districtAt(a.x, a.z))).toEqual(['downtown', 'oldtown', 'arts', 'arts']);
    // Then the limo, with the convoy's foot down.
    expect(wreck).toMatchObject({ kind: 'destroy', tags: ['lulllimo'] });
    const faster = (wreck.start ?? []).flatMap((a) => (a.do === 'drive' ? [a] : []));
    expect(faster.map((a) => a.tag)).toEqual(convoy.map((a) => a.tag));
    for (const a of faster) expect(a.cruise!, a.tag).toBeGreaterThan(limo.cruise!);
  });

  it('no main-story job fails on stars: none sets a wanted level, and only the cold open asks to lose the heat it brought', () => {
    for (const m of main)
      for (const s of m.steps) {
        if (m.id !== 's1-wrongstop') expect(s.kind, m.id).not.toBe('loseHeat');
        expect((s.start ?? []).some((a) => a.do === 'wanted'), m.id).toBe(false);
      }
  });

  it('the Night Shift rings from the docks-yard phone only, the main story never from it; two main jobs in a row never share a phone', () => {
    for (const m of night) expect(m.phone, m.id).toBe(NIGHT_PHONE);
    for (const m of main) expect(m.phone, m.id).not.toBe(NIGHT_PHONE);
    const rung = main.filter((m) => !m.direct);
    for (let i = 1; i < rung.length; i++) expect(rung[i].phone).not.toBe(rung[i - 1].phone);
  });

  it('everything spawns clear of buildings; every tag used is spawned; races stay on the map', () => {
    for (const m of missions) {
      const { cars, peds } = missionTags(m);
      for (const s of m.steps) {
        for (const a of s.start ?? []) {
          if (a.do === 'spawnCar') expect(blocked(a.x, a.z, 2.5), `${m.id} ${a.tag}`).toBe(false);
          if (a.do === 'spawnPed') expect(blocked(a.x, a.z, 0.5), `${m.id} ${a.tag}`).toBe(false);
        }
        // The cold open's job is lent its getaway (modes/openingMode.ts) rather than spawning one.
        const lent = m.direct ? [GETAWAY_TAG] : [];
        if ('tag' in s && s.tag) expect([...cars, ...peds, ...lent], `${m.id} ${s.kind}`).toContain(s.tag);
        if (s.kind === 'destroy') for (const t of s.tags) expect(cars).toContain(t);
        if (s.kind === 'knockOutAll') for (const t of s.tags) expect(peds).toContain(t);
        for (const f of s.fail ?? []) if (f.down) expect(peds, m.id).toContain(f.down);
        if (s.kind === 'collect') for (const [x, z] of s.points) expect(blocked(x, z, 0.5)).toBe(false);
        if (s.kind === 'race') for (const [ix, iz] of s.nodes) expect(Math.max(Math.abs(ix), Math.abs(iz))).toBeLessThanOrEqual(MAX_NODE);
        for (const a of s.start ?? []) if (a.do === 'tow') expect(cars, m.id).toEqual(expect.arrayContaining([a.tag, a.truck]));
        for (const a of s.start ?? []) if (a.do === 'drive') expect(cars, m.id).toContain(a.tag);
        for (const f of s.fail ?? []) for (const t of [f.wrecked, f.lost, f.damaged]) if (t) expect([...cars, ...(m.direct ? [GETAWAY_TAG] : [])], m.id).toContain(t);
        if (s.kind === 'mayhem' && s.near?.tag) expect([...cars, ...peds], m.id).toContain(s.near.tag);
      }
    }
  });
});

describe('the two arcs on the phones', () => {
  const city = generateCity(1337);
  const missions = buildMissions(placeDocks(city), SAFEHOUSE);
  const ids = (arc: 'main' | 'night') => missions.filter((m) => arcOf(m) === arc).map((m) => m.id);

  it('the Night Shift rings only after dark; the main story from sunrise to midnight', () => {
    for (let h = 0; h < 24; h += 0.25) {
      expect(arcRings('night', h), `${h}`).toBe(h >= SUNSET || h < SUNRISE);
      expect(arcRings('main', h), `${h}`).toBe(h >= SUNRISE);
    }
    expect(arcRings('night', 12)).toBe(false);
    expect(arcRings('night', 23)).toBe(true);
    expect(arcRings('main', 21)).toBe(true);
    expect(arcRings('main', 2)).toBe(false);
  });

  it('a main job and a night job never ring the same phone, at any hour, however far either arc has got', () => {
    const saves = [[], ids('main'), ids('night'), [...ids('main'), ...ids('night')], ['s2-noise', 'm1-audition', 'm2-tuna']];
    let both = 0;
    for (const passed of saves)
      for (let h = 0; h < 24; h += 0.5)
        for (let replays = 0; replays < 3; replays++) {
          const ringing = (['main', 'night'] as const).filter((a) => arcRings(a, h)).map((a) => nextInArc(missions, a, passed, replays)?.job.phone);
          const phonesNow = ringing.filter((p) => p !== undefined);
          expect(new Set(phonesNow).size, `${h} ${passed.join()}`).toBe(phonesNow.length);
          if (phonesNow.length === 2) both++;
        }
    // In the evening both arcs can ring at once (at different phones).
    expect(both).toBeGreaterThan(0);
  });

  it("each arc's next job is its first not passed; ids this build hasn't got are simply skipped", () => {
    // The main story's first is the cold open's (direct): nothing rings for it until it has run.
    expect(nextInArc(missions, 'main', [], 0)).toBeNull();
    expect(nextInArc(missions, 'main', [], 0, true)).toEqual({ job: missions.find((m) => m.id === 's2-noise'), replay: false });
    expect(nextInArc(missions, 'main', ['s1-wrongstop'], 0)?.job.id).toBe('s2-noise');
    expect(nextInArc(missions, 'night', [], 0)?.job.id).toBe('m1-audition');
    expect(nextInArc(missions, 'main', ['s1-wrongstop', 's2-noise'], 0)?.job.id).toBe('s3-quiet');
    expect(nextInArc(missions, 'main', ['s2-noise', 'gone-job'], 0, true)?.job.id).toBe('s3-quiet');
    expect(nextInArc(missions, 'night', ['m1-audition', 's2-noise'], 0)?.job.id).toBe('m2-tuna');
  });

  it('once an arc is done its phone rings with its own jobs again, as repeats', () => {
    const r = nextInArc(missions, 'main', ids('main'), 1);
    expect(r).toMatchObject({ replay: true });
    expect(r?.job.id).toBe('s3-quiet');
    expect(nextInArc(missions, 'night', ids('night'), 13)).toMatchObject({ replay: true, job: { id: 'm1-audition' } });
    // The other arc still has story jobs to ring.
    expect(nextInArc(missions, 'night', ids('main'), 0)).toMatchObject({ replay: false, job: { id: 'm1-audition' } });
  });

  it('a direct job (the cold open) never rings: nothing does in its arc until it is passed, and it is no repeat', () => {
    const open: MissionDef = { ...def([{ kind: 'survive', seconds: 1, text: 'S' }]), id: 's1', direct: true };
    const jobs = [open, ...missions];
    expect(nextInArc(jobs, 'main', [], 0)).toBeNull();
    expect(nextInArc(jobs, 'main', ['s1', 's1-wrongstop'], 0)?.job.id).toBe('s2-noise');
    const all = ['s1', ...ids('main')];
    for (let r = 0; r < 4; r++) expect(nextInArc(jobs, 'main', all, r)?.job.id).not.toBe('s1');
    // Once the glue has had its go (the opening ran), one not passed no longer holds the arc up, and isn't a repeat either.
    expect(nextInArc(jobs, 'main', [], 0, true)?.job.id).toBe('s2-noise');
    const rest = ids('main').filter((id) => id !== 's1-wrongstop');
    for (let r = 0; r < 4; r++) {
      const n = nextInArc(jobs, 'main', rest, r, true);
      expect(n?.replay).toBe(true);
      expect(n?.job.direct).toBeUndefined();
    }
  });

  it("an old save's Graveyard Shift progress carries over as the Night Shift's; the main story starts fresh", () => {
    const store = { data: { [SAVE_KEY]: JSON.stringify({ v: 1, cash: 9000, missions: ids('night').slice(0, 9), stats: { jobsReplayed: 0 } }) } as Record<string, string> };
    const save = loadSave({ getItem: (k) => store.data[k] ?? null, setItem: (k, v) => (store.data[k] = v) });
    pruneSave(save, { missions: missions.map((m) => m.id) });
    expect(save.missions).toEqual(ids('night').slice(0, 9));
    expect(passedOf(save, ids('night'))).toBe(9);
    expect(passedOf(save, ids('main'))).toBe(0);
    expect(nextInArc(missions, 'night', save.missions, 0)?.job.id).toBe('m10-fallen');
    // A save with no play to speak of gets the cold open first; then the main story rings from s2.
    expect(save.opening).toBe(false);
    expect(nextInArc(missions, 'main', save.missions, 0, save.opening)).toBeNull();
    expect(nextInArc(missions, 'main', save.missions, 0, true)?.job.id).toBe('s2-noise');
    // The 30% story share is the main story's.
    const totals = { missions: ids('main'), frenzies: 1, packages: 1, races: [], exportOrders: 1 };
    expect(completionParts(save, totals).missions).toBe(0);
    save.missions.push('s2-noise');
    expect(completion(save, totals)).toBeCloseTo(COMPLETION_WEIGHTS.missions / ids('main').length, 6);
  });

  it('a save from before jobs 4-6 (s1-s3 and all of m1-m13 passed) keeps every job and rings NINETY-NINE PROBLEMS next', () => {
    const before = ['s1-wrongstop', 's2-noise', 's3-quiet', ...ids('night')];
    const store = { data: { [SAVE_KEY]: JSON.stringify({ v: 1, cash: 30000, opening: true, missions: before, stats: { jobsReplayed: 4 } }) } as Record<string, string> };
    const save = loadSave({ getItem: (k) => store.data[k] ?? null, setItem: (k, v) => (store.data[k] = v) });
    pruneSave(save, { missions: missions.map((m) => m.id) });
    expect(save.missions).toEqual(before);
    expect(passedOf(save, ids('night'))).toBe(13);
    expect(passedOf(save, ids('main'))).toBe(3);
    // The Night Shift was done: it rings repeats; the main story carries on from job 4.
    expect(nextInArc(missions, 'main', save.missions, save.stats.jobsReplayed, save.opening)).toMatchObject({ replay: false, job: { id: 's4-problems' } });
    expect(nextInArc(missions, 'night', save.missions, save.stats.jobsReplayed, save.opening)?.replay).toBe(true);
    // Completion: each main job is an even share of the story's 30%; the thirteen Night Shift jobs add nothing to it.
    const totals = { missions: ids('main'), frenzies: 1, packages: 1, races: [], exportOrders: 1 };
    expect(completion(save, totals)).toBeCloseTo((COMPLETION_WEIGHTS.missions * 3) / ids('main').length, 6);
    // Chapter 1 done: chapter 2 rings next (no repeats while it's to do).
    save.missions.push('s4-problems', 's5-ribbon', 's6-quietest');
    expect(completionParts(save, totals).missions).toBeCloseTo(6 / ids('main').length, 6);
    expect(nextInArc(missions, 'main', save.missions, 0, true)).toMatchObject({ replay: false, job: { id: 's8-doner' } });
    save.missions.push(...ids('main').filter((id) => !save.missions.includes(id)));
    expect(completionParts(save, totals).missions).toBe(1);
    expect(nextInArc(missions, 'main', save.missions, 0, true)).toMatchObject({ replay: true, job: { id: 's2-noise' } });
  });
});

describe('repeat jobs', () => {
  const city = generateCity(1337);
  const missions = buildMissions(placeDocks(city), SAFEHOUSE);
  const ids = missions.map((m) => m.id);

  it('none while any story job is still to do', () => {
    expect(replayJob(missions, [], 0)).toBeNull();
    expect(replayJob(missions, ids.slice(0, -1), 5)).toBeNull();
  });

  it('then the story jobs again in order, carrying on from the saved count', () => {
    expect(replayJob(missions, ids, 0)).toBe(missions[0]);
    expect(replayJob(missions, ids, 3)).toBe(missions[3]);
    expect(replayJob(missions, ids, missions.length + 1)).toBe(missions[1]);
    // A save from a newer build with extra ids still counts as done.
    expect(replayJob(missions, [...ids, 'future-job'], 2)).toBe(missions[2]);
  });

  it('pays part of the story reward, in $50s, never nothing', () => {
    for (const m of missions) {
      const pay = replayReward(m);
      expect(pay % 50, m.id).toBe(0);
      expect(pay, m.id).toBeGreaterThan(0);
      expect(Math.abs(pay - m.reward * REPLAY_PAY), m.id).toBeLessThanOrEqual(25);
    }
  });
});

describe('driven mission cars', () => {
  const city = generateCity(1337);
  const grid = new StaticGrid(city.obstacles);
  const missions = buildMissions(placeDocks(city), SAFEHOUSE);
  const spawns = missions.flatMap((m) => m.steps.flatMap((s) => [...(s.start ?? []), ...(s.done ?? [])])).filter((a) => a.do === 'spawnCar');

  it('every story car spot, given a driver, pulls out and follows the roads', () => {
    expect(spawns.length).toBeGreaterThan(0);
    const DT = 1 / 60;
    for (const [i, a] of spawns.entries()) {
      const rand = random(100 + i);
      const car = { ...createVehicleState(a.x, a.z, a.heading) };
      const ai = driverFor(car, rand);
      let legs = 0;
      let last = `${ai.ix},${ai.iz}`;
      for (let t = 0; t < 60 * 40; t++) {
        stepVehicle(car, driveAi(ai, car, [], rand, DT), SEDAN, DT);
        collideVehicleStatic(car, grid);
        const key = `${ai.ix},${ai.iz}`;
        if (key !== last) legs++;
        last = key;
      }
      // Through at least two crossings in 40 s, and still on the map.
      expect(legs, `${a.tag} at ${a.x.toFixed(0)},${a.z.toFixed(0)}`).toBeGreaterThanOrEqual(2);
      expect(Math.max(Math.abs(ai.ix), Math.abs(ai.iz))).toBeLessThanOrEqual(MAX_NODE);
    }
  });
});

describe('KEEP IT LOUD, jobs 4 on, played through the engine', () => {
  const city = generateCity(1337);
  const grid = new StaticGrid(city.obstacles);
  const missions = buildMissions(placeDocks(city), SAFEHOUSE);
  const job = (id: string) => missions.find((m) => m.id === id)!;

  /** Run a job's steps against a world the test drives, at 5 stars throughout: nothing fails on stars. */
  function play(m: MissionDef, at: (i: number, v: ReturnType<typeof world>, run: MissionRun) => void): MissionRun {
    const run = new MissionRun(m);
    const v = world();
    v.stars = 5;
    run.begin();
    for (let guard = 0; guard < 20 && run.state === 'running'; guard++) {
      at(run.index, v, run);
      tick(run, v, 2);
      expect(run.state, `${m.id} step ${run.index}`).not.toBe('failed');
    }
    expect(run.state, m.id).toBe('passed');
    return run;
  }

  it('NINETY-NINE PROBLEMS: get in the van, bring it to Doreen without a scratch (a dent fails it)', () => {
    const m = job('s4-problems');
    const home = m.steps[1];
    if (home.kind !== 'deliver') throw new Error('not a deliver');
    play(m, (i, v) => {
      if (i === 1) Object.assign(v, { x: home.x, z: home.z, speed: 0 });
      v.cars.set('doreenvan', { x: v.x, z: v.z, wrecked: false, health: 0.95 });
      v.inCar = true;
      v.carTag = 'doreenvan';
      v.carArchetype = 'ice_cream_van';
    });
    const dented = new MissionRun(m);
    const v = world();
    v.cars.set('doreenvan', { x: 0, z: 0, wrecked: false, health: 0.6 });
    dented.begin();
    expect(tick(dented, v)).toEqual([{ kind: 'failed', reason: "YOU SCRATCHED DOREEN'S VAN" }]);
  });

  it("RIBBON CUTTING: the Mayor's limo wrecked", () => {
    play(job('s5-ribbon'), (_, v) => v.cars.set('lulllimo', { x: 0, z: 0, wrecked: true }));
  });

  it("QUIETEST CITY: points count round the coach wherever it's got to, not away from it", () => {
    const m = job('s6-quietest');
    play(m, (_, v, run) => {
      // The coach a long way from where it started; the player beside it.
      v.cars.set('coach', { x: 300, z: -300, wrecked: false });
      Object.assign(v, { x: 360, z: -300 });
      run.award(4000, v);
      // Away from it, nothing counts.
      Object.assign(v, { x: 0, z: 0 });
      run.award(9000, v);
      expect(run.mayhem).toBe(4000);
      Object.assign(v, { x: 300, z: -250 });
      run.award(1000, v);
    });
  });

  it('DONER: get in the spit van and get it to Manny in time; too slow and the spit goes cold', () => {
    const m = job('s8-doner');
    const home = m.steps[1];
    if (home.kind !== 'deliver') throw new Error('not a deliver');
    const drive = (v: ReturnType<typeof world>) => {
      v.cars.set('spitvan', { x: v.x, z: v.z, wrecked: false });
      Object.assign(v, { inCar: true, carTag: 'spitvan', carArchetype: 'van' });
    };
    play(m, (i, v) => {
      if (i === 1) Object.assign(v, { x: home.x, z: home.z, speed: 0 });
      drive(v);
    });
    const cold = new MissionRun(m);
    const v = world();
    drive(v);
    cold.begin();
    tick(cold, v);
    expect(cold.index).toBe(1);
    expect(tick(cold, v, home.timer! + 1).at(-1)).toEqual({ kind: 'failed', reason: 'THE SPIT WENT COLD' });
  });

  it("ALARM CALL: fit the five alarms, then the points round the Mayor's house wake her", () => {
    const m = job('s11-alarmcall');
    const [fit, wake] = m.steps;
    if (fit.kind !== 'collect' || wake.kind !== 'mayhem' || !wake.near) throw new Error('wrong steps');
    const near = wake.near;
    play(m, (i, v, run) => {
      if (i === 0) {
        // Along the street, alarm by alarm.
        for (const [x, z] of fit.points) {
          Object.assign(v, { x, z });
          tick(run, v);
        }
      } else {
        Object.assign(v, { x: near.x + 20, z: near.z });
        run.award(wake.points, v);
      }
    });
  });

  it("LOUDEST CITY: points round the limo wherever it's got to, then the limo wrecked", () => {
    const m = job('s12-loudest');
    play(m, (i, v, run) => {
      v.cars.set('lulllimo', { x: -300, z: -500, wrecked: i === 1 });
      Object.assign(v, { x: -300, z: -440 });
      if (i === 0) run.award(6000, v);
    });
  });

  for (const [id, tag] of [
    ['s6-quietest', 'coach'],
    ['s12-loudest', 'lulllimo'],
  ] as const)
    it(`${id}'s ${tag}, steered for its next crossing, tours the route in order and passes each scene's crossing`, () => {
    const show = job(id).steps[0];
    const spawn = show.start?.find((a) => a.do === 'spawnCar' && a.tag === tag);
    if (spawn?.do !== 'spawnCar' || !spawn.route) throw new Error('no touring car');
    const route = spawn.route;
    const rand = random(7);
    const car = { ...createVehicleState(spawn.x, spawn.z, spawn.heading), body: VEHICLE_BODIES[spawn.archetype] };
    const ai = driverFor(car, rand);
    ai.cruise = spawn.cruise ?? ai.cruise;
    const DT = 1 / 60;
    let leg = 0;
    const seen: string[] = [];
    let last = '';
    for (let t = 0; t < 60 * 420 && seen.length < route.length + 2; t++) {
      if (ai.phase === 'approach') {
        leg = routeLeg(route, leg, ai.ix, ai.iz);
        ai.next = routeToward(ai.ix, ai.iz, ai.dir, route[leg][0] * 64, route[leg][1] * 64);
      }
      stepVehicle(car, driveAi(ai, car, [], rand, DT), VEHICLE_SPECS[spawn.archetype], DT);
      collideVehicleStatic(car, grid);
      const key = `${ai.ix},${ai.iz}`;
      if (key !== last && route.some(([ix, iz]) => `${ix},${iz}` === key)) seen.push(key);
      last = key;
    }
    // Every crossing of the tour, in order, and round again.
    const want = [...route, ...route].map(([ix, iz]) => `${ix},${iz}`);
    expect(seen.slice(0, route.length + 2)).toEqual(want.slice(0, route.length + 2));
  });
});
