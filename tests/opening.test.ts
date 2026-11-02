/**
 * The live cold open (V2-07): where it plays (game/opening.ts), and the
 * runtime's flow over a stand-in city (modes/openingMode.ts): armed by
 * PLAY's respawn, staged chase or fallback, GET IN, TAKE THE HEAT, once.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { VEHICLE_HEALTH, createVehicleState } from '../src/entities/vehicle';
import { SAFEHOUSE } from '../src/game/modes/places';
import { MissionMode } from '../src/game/modes/missionMode';
import { OpeningMode, type OpeningStage } from '../src/game/modes/openingMode';
import type { ModeCtx } from '../src/game/modes/context';
import {
  BUS_BACK,
  CHASE_GIVE_UP,
  CRASH_AHEAD,
  GETAWAY_TAG,
  OPENING_JOB,
  onOpeningRoad,
  openingPlan,
  pickOpeningStop,
  roomAhead,
} from '../src/game/opening';
import { Player } from '../src/game/player';
import type { Vehicle } from '../src/game/population';
import { Progress } from '../src/game/progress';
import { defaultSave } from '../src/game/progressSave';
import { createDamage } from '../src/systems/damage';
import type { DialogueCard } from '../src/ui/progressScreens';
import { BLOCK_SIZE, ROAD_WIDTH, generateCity } from '../src/world/city';
import { dressCity } from '../src/world/dressing';
import { generatePickups } from '../src/world/pickups';
import { placeKickers, placeRamps } from '../src/world/ramps';
import { random } from './helpers';

const city = generateCity(1337);
const big = placeRamps(1337);
const stops = dressCity(city, generatePickups(1337), [...big, ...placeKickers(1337, big)]).street.busStops;
const blocked = (x: number, z: number, m: number) => city.obstacles.some((o) => x > o.minX - m && x < o.maxX + m && z > o.minZ - m && z < o.maxZ + m);
/** Distance from (x, z) to the nearest road's centreline (the grid's lines every BLOCK_SIZE). */
const offRoad = (x: number, z: number) => {
  const near = (v: number) => Math.abs(v - Math.round(v / BLOCK_SIZE) * BLOCK_SIZE);
  return Math.min(near(x), near(z));
};

describe('the cold open: where it plays', () => {
  const stop = pickOpeningStop(stops, SAFEHOUSE.x, SAFEHOUSE.z)!;

  it('picks the shelter nearest the safehouse (and the spawn corner) with room for the crash before the junction', () => {
    expect(stop).not.toBeNull();
    const d = (s: (typeof stops)[number]) => Math.hypot(s.waitX - SAFEHOUSE.x, s.waitZ - SAFEHOUSE.z);
    for (const s of stops) if (roomAhead(s) >= CRASH_AHEAD + 12) expect(d(s)).toBeGreaterThanOrEqual(d(stop));
    expect(d(stop)).toBeLessThan(120);
    expect(pickOpeningStop([], 0, 0)).toBeNull();
  });

  it('for every shelter that qualifies: the player on the pavement, the crash on the road at the kerb a few steps off, the getaway off screen on the far lane', () => {
    let n = 0;
    for (const s of stops) {
      if (roomAhead(s) < CRASH_AHEAD + 12) continue;
      n++;
      const p = openingPlan(s);
      const where = `${s.x.toFixed(0)},${s.z.toFixed(0)}`;
      // Standing at the shelter, on the pavement, clear of the buildings.
      expect(blocked(p.stand.x, p.stand.z, 0.4), where).toBe(false);
      expect(offRoad(p.stand.x, p.stand.z), where).toBeGreaterThan(ROAD_WIDTH / 2);
      expect(Math.hypot(p.stand.x - s.waitX, p.stand.z - s.waitZ)).toBeLessThan(6);
      // The crash: on the road on the shelter's side, tight to the kerb, ahead of the bus, a short walk away.
      expect(offRoad(p.crash.x, p.crash.z), where).toBeCloseTo(5, 3);
      expect(blocked(p.crash.x, p.crash.z, 2.5), where).toBe(false);
      const walk = Math.hypot(p.crash.x - p.stand.x, p.crash.z - p.stand.z);
      expect(walk, where).toBeGreaterThan(5);
      expect(walk, where).toBeLessThan(12);
      const fx = Math.sin(s.stopHeading);
      const fz = Math.cos(s.stopHeading);
      expect((p.crash.x - s.stopX) * fx + (p.crash.z - s.stopZ) * fz).toBeCloseTo(CRASH_AHEAD, 3);
      // The getaway: on the far lane (4 m the other side of the centreline), coming back toward the stop.
      expect(offRoad(p.getaway.x, p.getaway.z), where).toBeCloseTo(4, 3);
      const toStop = Math.atan2(s.stopX - p.getaway.x, s.stopZ - p.getaway.z);
      expect(Math.cos(toStop - p.getaway.heading)).toBeGreaterThan(0.95);
      expect(Math.hypot(p.getaway.x - p.stand.x, p.getaway.z - p.stand.z)).toBeGreaterThan(45);
      // Its whole road is the stretch cleared of traffic; the shelter's pavement isn't.
      expect(onOpeningRoad(p, p.crash.x, p.crash.z)).toBe(true);
      expect(onOpeningRoad(p, p.getaway.x, p.getaway.z)).toBe(true);
      expect(onOpeningRoad(p, s.stopX - fx * BUS_BACK, s.stopZ - fz * BUS_BACK)).toBe(true);
      expect(onOpeningRoad(p, p.stand.x, p.stand.z)).toBe(false);
    }
    expect(n).toBeGreaterThan(20);
  });
});

// --- The runtime, over a stand-in city ---

function car(x = 0, z = 0, heading = 0): Vehicle {
  const sim = createVehicleState(x, z, heading);
  return { archetype: 'sedan', paint: '#333', sim, prev: { ...sim }, mesh: { root: { visible: true } }, ai: null, damage: createDamage(VEHICLE_HEALTH.sedan), wreckAge: 0, charred: false } as unknown as Vehicle;
}

function setup(opts: { chase: boolean; save?: Partial<ReturnType<typeof defaultSave>> }) {
  const bus = new EventBus();
  const events: string[] = [];
  bus.onAny((e) => events.push(e.type === 'street' ? `street:${e.what}` : e.type === 'award' ? `award:${e.award.kind}` : e.type));
  const player = new Player(bus, 9.5, 9.5);
  const progress = new Progress({ ...defaultSave(), ...opts.save }, null);
  const wanted = { level: 0 };
  const called: string[] = [];
  const pinned: Vehicle[] = [];
  let playing = true;
  const ctx = {
    deps: {
      bus,
      player,
      audio: new Proxy({}, { get: () => () => {} }),
      radar: new Proxy({}, { get: () => () => {} }),
      heat: { wanted, called: (c: string) => (called.push(c), (wanted.level = 2)) },
      score: { award: (kind: string) => ({ kind, label: kind, points: 500, multiplier: 1 }) },
      population: { crowd: [], removePed() {}, addPed() {} },
      look: { time: { hour: 12, speed: 1, set() {} } },
      vehicles: [],
      rand: random(3),
      playing: () => playing,
    },
    progress,
    ui: new Proxy({}, { get: () => () => {} }),
    freeRoam: true,
    sideModes: false,
    get live() {
      return player.alive && !player.arrested;
    },
    busy: null as string | null,
    focusRing: false,
    pay: (n: number) => n,
    notice() {},
    blip() {},
    unblip() {},
    pin: (v: Vehicle) => pinned.includes(v) || pinned.push(v),
    unpin: (v: Vehicle) => pinned.includes(v) && pinned.splice(pinned.indexOf(v), 1),
    spawnCar: (_a: string, _p: string, x: number, z: number, h: number) => {
      const v = car(x, z, h);
      pinned.push(v);
      return v;
    },
    openModal() {},
    closeModal() {},
  };
  const card = { show() {} } as unknown as DialogueCard;
  const missions = new MissionMode(ctx as unknown as ModeCtx, { x: 400, z: 400 }, card);
  const opening = new OpeningMode(ctx as unknown as ModeCtx, missions);
  // The staged chase: its getaway, which the test crashes (or not) by hand.
  let getaway: Vehicle | null = null;
  let state: 'coming' | 'dumped' | null = null;
  const log: string[] = [];
  const stage: OpeningStage = {
    stops,
    moved: () => log.push('moved'),
    clear: () => log.push('clear'),
    bus: () => log.push('bus'),
    chase: (s) => {
      log.push('chase');
      if (!opts.chase) return null;
      getaway = car(s.x, s.z, s.heading);
      state = 'coming';
      return getaway;
    },
    staged: () => state,
  };
  opening.useStage(stage);
  const step = (seconds = 1 / 60) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      opening.step(1 / 60);
      missions.step(1 / 60);
    }
  };
  return {
    bus,
    events,
    player,
    progress,
    ctx,
    wanted,
    called,
    pinned,
    missions,
    opening,
    log,
    step,
    play: () => player.respawn(9.5, 9.5),
    crash: () => (state = 'dumped'),
    get getaway() {
      return getaway;
    },
    setPlaying: (p: boolean) => (playing = p),
  };
}

describe('the cold open: the runtime', () => {
  it('PLAY on a fresh save: at the shelter, the bus, the chase; the crash starts WRONG STOP with the getaway lent; in is TAKE THE HEAT, once', () => {
    const w = setup({ chase: true });
    expect(w.opening.phase).toBe('idle');
    w.play();
    expect(w.opening.phase).toBe('armed');
    expect(w.opening.holding).toBe(true);
    w.step();
    expect(w.log).toEqual(['moved', 'clear', 'bus', 'chase']);
    expect(w.opening.phase).toBe('chase');
    // At the shelter.
    const plan = openingPlan(pickOpeningStop(stops, SAFEHOUSE.x, SAFEHOUSE.z)!);
    expect(w.player.ped.x).toBeCloseTo(plan.stand.x, 6);
    expect(w.player.ped.z).toBeCloseTo(plan.stand.z, 6);
    w.step(3);
    expect(w.missions.running).toBeNull();
    // At the kerb: GET IN · LOSE THE HEAT, the getaway the job's car (pinned).
    w.crash();
    w.step();
    expect(w.opening.phase).toBe('crashed');
    expect(w.missions.running?.id).toBe(OPENING_JOB);
    expect(w.ctx.busy).toBe('mission');
    expect(w.pinned).toContain(w.getaway);
    // The chase hands its cops over as the player gets in (the city steps first): no second call.
    w.wanted.level = 2;
    w.player.enter(w.getaway!);
    w.step();
    expect(w.called).toEqual([]);
    expect(w.opening.phase).toBe('done');
    expect(w.opening.holding).toBe(false);
    expect(w.progress.data.opening).toBe(true);
    // LOSE THE HEAT, then the job passes.
    expect(w.missions.running?.steps[1].kind).toBe('loseHeat');
    w.wanted.level = 0;
    w.step(1);
    expect(w.missions.running).toBeNull();
    expect(w.progress.data.missions).toContain(OPENING_JOB);
    // The next PLAY (the director resets the modes first) is the old one.
    w.opening.reset();
    w.play();
    w.step();
    expect(w.opening.phase).toBe('idle');
    expect(w.log.filter((l) => l === 'chase').length).toBe(1);
  });

  it("the fallback: no chase, the crashed getaway already at the kerb; getting in brings the 2 stars and TAKE THE HEAT's award", () => {
    const w = setup({ chase: false });
    w.play();
    w.step();
    expect(w.opening.phase).toBe('crashed');
    expect(w.opening.fallback).toBe(true);
    const v = w.opening.car!;
    expect(v.damage.health).toBeLessThan(v.damage.maxHealth * 0.6);
    expect(v.damage.burning).toBe(false);
    expect(w.missions.running?.id).toBe(OPENING_JOB);
    w.player.enter(v);
    w.step();
    expect(w.called).toEqual(['tookGetaway']);
    expect(w.wanted.level).toBe(2);
    expect(w.events).toContain('award:takeTheHeat');
    expect(w.events).toContain('street:takeTheHeat');
    expect(w.progress.data.opening).toBe(true);
  });

  it('the getaway wrecked before anyone gets in: WRONG STOP fails, the opening has had its go', () => {
    const w = setup({ chase: false });
    w.play();
    w.step();
    w.opening.car!.damage.wrecked = true;
    w.step(0.1);
    expect(w.missions.running).toBeNull();
    expect(w.opening.phase).toBe('done');
    expect(w.opening.holding).toBe(false);
    expect(w.progress.data.opening).toBe(true);
    expect(w.progress.data.missions).not.toContain(OPENING_JOB);
  });

  it('a chase that never crashes gives way to the fallback', () => {
    const w = setup({ chase: true });
    w.play();
    w.step(CHASE_GIVE_UP + 0.5);
    expect(w.opening.phase).toBe('crashed');
    expect(w.opening.fallback).toBe(true);
  });

  it('down before getting in: the respawn starts it over; it has not run', () => {
    const w = setup({ chase: false });
    w.play();
    w.step();
    expect(w.missions.running?.id).toBe(OPENING_JOB);
    w.player.hurt(1e6);
    expect(w.missions.running).toBeNull();
    expect(w.progress.data.opening).toBe(false);
    w.play();
    w.step();
    expect(w.opening.phase).toBe('crashed');
    expect(w.missions.running?.id).toBe(OPENING_JOB);
  });

  it('a Chaos Run picked from the title takes the run: no opening', () => {
    const w = setup({ chase: true });
    w.play();
    w.ctx.freeRoam = false;
    w.step();
    expect(w.opening.phase).toBe('idle');
    expect(w.log).toEqual([]);
  });

  it('a save that has had it never arms; REPLAY OPENING (forget) gives it back to the next PLAY', () => {
    const w = setup({ chase: true, save: { opening: true } });
    w.play();
    expect(w.opening.phase).toBe('idle');
    w.opening.forget();
    expect(w.progress.data.opening).toBe(false);
    w.play();
    w.step();
    expect(w.opening.phase).toBe('chase');
  });

  it('a replay of a passed WRONG STOP runs as a repeat; behind the title nothing holds', () => {
    const w = setup({ chase: false, save: { missions: [OPENING_JOB] } });
    w.setPlaying(false);
    w.play();
    expect(w.opening.holding).toBe(false);
    w.setPlaying(true);
    w.step();
    expect(w.missions.running?.id).toBe(OPENING_JOB);
    w.player.enter(w.opening.car!);
    w.step();
    w.wanted.level = 0;
    w.step(1);
    expect(w.progress.data.stats.jobsReplayed).toBe(1);
  });

  it('the getaway is the job tag the data asks for', () => {
    const w = setup({ chase: false });
    const job = w.missions.missions.find((m) => m.id === OPENING_JOB)!;
    expect(job.direct).toBe(true);
    expect(job.steps[0]).toMatchObject({ kind: 'enter', tag: GETAWAY_TAG });
  });
});
