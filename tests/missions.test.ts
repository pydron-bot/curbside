import { describe, expect, it } from 'vitest';
import { SAFEHOUSE, placeDocks, placePayphones } from '../src/game/modes/places';
import { SEDAN, createVehicleState, stepVehicle } from '../src/entities/vehicle';
import { collideVehicleStatic } from '../src/systems/physics';
import { driveAi, driverFor } from '../src/systems/traffic';
import { StaticGrid } from '../src/world/collision';
import { random } from './helpers';
import { readFileSync } from 'node:fs';
import {
  COLLECT_RADIUS,
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

type Car = { x: number; z: number; wrecked: boolean };
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
    expect(main.map((m) => m.id)).toEqual(['s2-noise', 's3-quiet']);
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
      expect(phones.has(m.phone), m.id).toBe(true);
      expect(m.reward, m.id).toBeGreaterThan(0);
      expect(m.intro.length, m.id).toBeGreaterThan(0);
      expect(m.outro.length, m.id).toBeGreaterThan(0);
      expect(m.steps.length, m.id).toBeGreaterThan(0);
      for (const s of m.steps) expect(s.text.length, m.id).toBeGreaterThan(0);
    }
  });

  it('chapters run in order within an arc, and only the last job of a chapter with another after it ends one', () => {
    for (const arc of [main, night]) for (let i = 1; i < arc.length; i++) expect(arc[i].chapter ?? 1).toBeGreaterThanOrEqual(arc[i - 1].chapter ?? 1);
    expect(night.filter((m) => endsChapter(night, m)).map((m) => m.id)).toEqual(['m8-lastcall']);
    expect(main.filter((m) => endsChapter(main, m))).toEqual([]);
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
    expect([...speakers].sort()).toEqual(["COMMISSIONER CLAMP", 'DEACON PIKE', 'DOREEN', "LIL' TUNA", 'LIONEL', 'MAYOR LULL', 'VEX']);
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

  it('no main-story job fails on stars: none of its steps sets a wanted level or asks to lose one', () => {
    for (const m of main)
      for (const s of m.steps) {
        expect(s.kind, m.id).not.toBe('loseHeat');
        expect((s.start ?? []).some((a) => a.do === 'wanted'), m.id).toBe(false);
      }
  });

  it('the Night Shift rings from the docks-yard phone only, the main story never from it; two main jobs in a row never share a phone', () => {
    for (const m of night) expect(m.phone, m.id).toBe(NIGHT_PHONE);
    for (const m of main) expect(m.phone, m.id).not.toBe(NIGHT_PHONE);
    for (let i = 1; i < main.length; i++) expect(main[i].phone).not.toBe(main[i - 1].phone);
  });

  it('everything spawns clear of buildings; every tag used is spawned; races stay on the map', () => {
    for (const m of missions) {
      const { cars, peds } = missionTags(m);
      for (const s of m.steps) {
        for (const a of s.start ?? []) {
          if (a.do === 'spawnCar') expect(blocked(a.x, a.z, 2.5), `${m.id} ${a.tag}`).toBe(false);
          if (a.do === 'spawnPed') expect(blocked(a.x, a.z, 0.5), `${m.id} ${a.tag}`).toBe(false);
        }
        if ('tag' in s && s.tag) expect([...cars, ...peds], `${m.id} ${s.kind}`).toContain(s.tag);
        if (s.kind === 'destroy') for (const t of s.tags) expect(cars).toContain(t);
        if (s.kind === 'knockOutAll') for (const t of s.tags) expect(peds).toContain(t);
        for (const f of s.fail ?? []) if (f.down) expect(peds, m.id).toContain(f.down);
        if (s.kind === 'collect') for (const [x, z] of s.points) expect(blocked(x, z, 0.5)).toBe(false);
        if (s.kind === 'race') for (const [ix, iz] of s.nodes) expect(Math.max(Math.abs(ix), Math.abs(iz))).toBeLessThanOrEqual(MAX_NODE);
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

  it("each arc's next job is its first not passed; ids this build hasn't got (s1) are simply skipped", () => {
    expect(nextInArc(missions, 'main', [], 0)).toEqual({ job: missions.find((m) => m.id === 's2-noise'), replay: false });
    expect(nextInArc(missions, 'night', [], 0)?.job.id).toBe('m1-audition');
    // A save from a build with s1 (or anything else) still goes on to s3.
    expect(nextInArc(missions, 'main', ['s1-wrongstop', 's2-noise'], 0)?.job.id).toBe('s3-quiet');
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
    expect(nextInArc(jobs, 'main', ['s1'], 0)?.job.id).toBe('s2-noise');
    const all = ['s1', ...ids('main')];
    for (let r = 0; r < 4; r++) expect(nextInArc(jobs, 'main', all, r)?.job.id).not.toBe('s1');
  });

  it("an old save's Graveyard Shift progress carries over as the Night Shift's; the main story starts fresh", () => {
    const store = { data: { [SAVE_KEY]: JSON.stringify({ v: 1, cash: 9000, missions: ids('night').slice(0, 9), stats: { jobsReplayed: 0 } }) } as Record<string, string> };
    const save = loadSave({ getItem: (k) => store.data[k] ?? null, setItem: (k, v) => (store.data[k] = v) });
    pruneSave(save, { missions: missions.map((m) => m.id) });
    expect(save.missions).toEqual(ids('night').slice(0, 9));
    expect(passedOf(save, ids('night'))).toBe(9);
    expect(passedOf(save, ids('main'))).toBe(0);
    expect(nextInArc(missions, 'night', save.missions, 0)?.job.id).toBe('m10-fallen');
    expect(nextInArc(missions, 'main', save.missions, 0)?.job.id).toBe('s2-noise');
    // The 30% story share is the main story's.
    const totals = { missions: ids('main'), frenzies: 1, packages: 1, races: [], exportOrders: 1 };
    expect(completionParts(save, totals).missions).toBe(0);
    save.missions.push('s2-noise');
    expect(completion(save, totals)).toBeCloseTo(COMPLETION_WEIGHTS.missions / 2, 6);
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
