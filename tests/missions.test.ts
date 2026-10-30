import { describe, expect, it } from 'vitest';
import { SAFEHOUSE, placeDocks, placePayphones } from '../src/game/modes/places';
import { COLLECT_RADIUS, LOST_RANGE, MissionRun, missionTags, type MissionDef, type MissionSignal, type MissionView } from '../src/systems/missions';
import { buildMissions } from '../src/systems/missionsData';
import { generateCity } from '../src/world/city';
import { MAX_NODE } from '../src/world/roads';

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

describe('the story', () => {
  const city = generateCity(1337);
  const docks = placeDocks(city);
  const missions = buildMissions(docks, SAFEHOUSE);
  const phones = new Set(placePayphones().map((p) => p.id));
  const blocked = (x: number, z: number, m: number) => city.obstacles.some((o) => x > o.minX - m && x < o.maxX + m && z > o.minZ - m && z < o.maxZ + m);

  it('eight jobs, each from a payphone, each paying, with something to say', () => {
    expect(missions).toHaveLength(8);
    expect(new Set(missions.map((m) => m.id)).size).toBe(8);
    for (const m of missions) {
      expect(phones.has(m.phone), m.id).toBe(true);
      expect(m.reward, m.id).toBeGreaterThan(0);
      expect(m.intro.length, m.id).toBeGreaterThan(0);
      expect(m.outro.length, m.id).toBeGreaterThan(0);
      expect(m.steps.length, m.id).toBeGreaterThan(0);
      for (const s of m.steps) expect(s.text.length, m.id).toBeGreaterThan(0);
    }
  });

  it('two jobs in a row never ring the same phone', () => {
    for (let i = 1; i < missions.length; i++) expect(missions[i].phone).not.toBe(missions[i - 1].phone);
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
        if (s.kind === 'collect') for (const [x, z] of s.points) expect(blocked(x, z, 0.5)).toBe(false);
        if (s.kind === 'race') for (const [ix, iz] of s.nodes) expect(Math.max(Math.abs(ix), Math.abs(iz))).toBeLessThanOrEqual(MAX_NODE);
      }
    }
  });
});
