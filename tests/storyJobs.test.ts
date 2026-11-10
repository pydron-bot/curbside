import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { len2 } from '../src/core/len';
import { VEHICLE_BODIES, createVehicleState, type VehicleArchetype } from '../src/entities/vehicle';
import type { ModeCtx } from '../src/game/modes/context';
import { MissionMode } from '../src/game/modes/missionMode';
import { Player } from '../src/game/player';
import type { Vehicle } from '../src/game/population';
import { Progress } from '../src/game/progress';
import { defaultSave } from '../src/game/progressSave';
import { createDamage } from '../src/systems/damage';
import { CATCH_HOLD, routeLeg } from '../src/systems/missions';
import { routeToward } from '../src/systems/pursuit';
import type { DialogueCard } from '../src/ui/progressScreens';
import { random } from './helpers';

const DT = 1 / 60;
/** Does nothing, whatever's asked of it. */
const anything = (): never => new Proxy(() => anything(), { get: () => anything() }) as never;

/** MissionMode with a fake street: the cars it spawns are plain sim states nobody else moves. */
function setup() {
  const bus = new EventBus();
  const player = new Player(bus, 0, 0);
  const progress = new Progress(defaultSave(), null);
  progress.data.opening = true;
  const cars: Vehicle[] = [];
  const crowd: unknown[] = [];
  const shown: string[] = [];
  const notices: string[] = [];
  const blips = new Map<string, { x: number; z: number }>();
  const ctx = {
    deps: {
      bus,
      player,
      audio: anything(),
      radar: anything(),
      heat: { wanted: { level: 0, force() {} } },
      population: {
        crowd,
        removePed() {},
        addPed: (agent: unknown) => {
          const p = { agent, model: { hail() {} } };
          crowd.push(p);
          return p;
        },
      },
      look: { time: { hour: 12, speed: 1, set() {} } },
      vehicles: [],
      rand: random(3),
    },
    progress,
    ui: anything(),
    freeRoam: true,
    sideModes: true,
    get live() {
      return player.alive && !player.arrested;
    },
    busy: null as string | null,
    focusRing: false,
    pay: (n: number) => n,
    notice: (text: string) => notices.push(text),
    blip: (id: string, o: { x: number; z: number }) => blips.set(id, { x: o.x, z: o.z }),
    unblip: (id: string) => blips.delete(id),
    unpin() {},
    pin() {},
    openModal() {},
    closeModal() {},
    spawnCar(archetype: VehicleArchetype, _paint: string, x: number, z: number, heading: number): Vehicle {
      const v = { archetype, sim: { ...createVehicleState(x, z, heading), body: VEHICLE_BODIES[archetype] }, damage: createDamage(150), ai: null } as unknown as Vehicle;
      cars.push(v);
      return v;
    },
  };
  const card = { show: (head: string) => shown.push(head) } as unknown as DialogueCard;
  const mode = new MissionMode(ctx as unknown as ModeCtx, { x: 400, z: 400 }, card);
  const step = (seconds: number, each?: () => void) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      each?.();
      mode.step(DT);
    }
  };
  const begin = (id: string) => {
    const job = mode.missions.find((m) => m.id === id)!;
    expect(mode.beginNow(job)).toBe(true);
    return job;
  };
  return { bus, player, progress, ctx, mode, cars, shown, notices, blips, step, begin };
}

/** A sedan on the fake street for the player to drive (pushed onto `cars`). */
function setupCar(cars: Vehicle[]): Vehicle {
  const v = { archetype: 'sedan', sim: { ...createVehicleState(0, 0, 0), body: VEHICLE_BODIES.sedan }, damage: createDamage(150), ai: null } as unknown as Vehicle;
  cars.push(v);
  return v;
}

/** Teleport the player (on foot) to (x, z). */
function stand(player: Player, x: number, z: number): void {
  Object.assign(player.ped, { x, z, vx: 0, vz: 0 });
}

describe('NINETY-NINE PROBLEMS: the van on the hook', () => {
  it('waits on the hook behind its parked truck, rides behind it once it pulls out, and stays on while it drives', () => {
    const { mode, cars, player, step, begin } = setup();
    begin('s4-problems');
    const [truck, van] = cars;
    expect([truck.archetype, van.archetype]).toEqual(['tow_truck', 'ice_cream_van']);
    // Far off: parked, nobody at the wheel yet, the van hooked behind.
    step(0.5);
    expect(truck.ai).toBeNull();
    expect(mode.running?.id).toBe('s4-problems');
    // Close: it pulls out (a driver), and the van follows the truck wherever it goes.
    stand(player, truck.sim.x + 30, truck.sim.z);
    step(DT);
    expect(truck.ai).not.toBeNull();
    stand(player, 0, 0);
    for (let i = 0; i < 120; i++) {
      truck.sim.x -= 0.2;
      truck.sim.vx = -12;
      step(DT);
    }
    const gap = len2(truck.sim.x - van.sim.x, truck.sim.z - van.sim.z);
    expect(gap).toBeCloseTo(VEHICLE_BODIES.tow_truck.reach + 0.6 + VEHICLE_BODIES.ice_cream_van.reach, 1);
    // Carried, not driven: no speed of its own.
    expect([van.sim.vx, van.sim.vz]).toEqual([0, 0]);
  });

  it('caught standing at a light, the crew lets it go where it is; get in and drive it to Doreen', () => {
    const { mode, cars, player, notices, progress, shown, step, begin } = setup();
    const job = begin('s4-problems');
    const [truck, van] = cars;
    stand(player, truck.sim.x + 10, truck.sim.z);
    step(DT);
    // Stopped with the player beside it: let go after a moment.
    truck.sim.vx = truck.sim.vz = 0;
    step(CATCH_HOLD * 0.5);
    expect(notices).not.toContain('OFF THE HOOK');
    step(CATCH_HOLD * 0.6);
    expect(notices).toContain('OFF THE HOOK');
    const left = { x: van.sim.x, z: van.sim.z };
    truck.sim.x -= 50;
    step(0.5);
    expect([van.sim.x, van.sim.z]).toEqual([left.x, left.z]);
    // In, and to Doreen's pitch, unscratched.
    player.enter(van);
    step(0.1);
    expect(mode.running?.id).toBe('s4-problems');
    const home = job.steps[1];
    if (home.kind !== 'deliver') throw new Error('not a deliver');
    Object.assign(van.sim, { x: home.x, z: home.z, vx: 0, vz: 0 });
    step(0.2);
    expect(progress.data.missions).toContain('s4-problems');
    expect(shown).toEqual(['MISSION PASSED']);
  });

  it('getting into the van on the hook takes it off at once; a scratch on the way fails the job', () => {
    const { mode, cars, player, notices, step, begin } = setup();
    begin('s4-problems');
    const [truck, van] = cars;
    stand(player, van.sim.x + 2, van.sim.z);
    step(DT);
    truck.sim.vx = -12;
    player.enter(van);
    truck.sim.x -= 20;
    step(0.2);
    // Off the hook (no notice: you're the one who took it), and the next step is on.
    expect(notices).not.toContain('OFF THE HOOK');
    expect(len2(truck.sim.x - van.sim.x, truck.sim.z - van.sim.z)).toBeGreaterThan(9);
    expect(mode.running?.id).toBe('s4-problems');
    van.damage.health = van.damage.maxHealth * 0.8;
    step(DT);
    expect(mode.running).toBeNull();
  });

  it('carjacking the truck (or its driver bailing out) lets the van go too', () => {
    const { cars, player, notices, step, begin } = setup();
    begin('s4-problems');
    const [truck] = cars;
    stand(player, truck.sim.x + 3, truck.sim.z);
    step(DT);
    truck.sim.vx = 8;
    player.enter(truck);
    step(DT);
    expect(notices).toContain('OFF THE HOOK');
  });
});

describe("RIBBON CUTTING and QUIETEST CITY: the Mayor's limo and the judges' coach", () => {
  it('the limo waits at the ribbon until the player is close, or until it is hit', () => {
    for (const how of ['close', 'hit'] as const) {
      const { cars, player, step, begin } = setup();
      begin('s5-ribbon');
      const limo = cars.find((c) => c.archetype === 'limo')!;
      step(0.5);
      expect(limo.ai).toBeNull();
      if (how === 'close') stand(player, limo.sim.x + 40, limo.sim.z);
      else limo.damage.health -= 5;
      step(DT);
      expect(limo.ai, how).not.toBeNull();
    }
  });

  it('a waiting car the player has got into gets no driver of its own', () => {
    const { cars, player, step, begin } = setup();
    begin('s5-ribbon');
    const limo = cars.find((c) => c.archetype === 'limo')!;
    stand(player, limo.sim.x + 2, limo.sim.z);
    player.enter(limo);
    step(0.5);
    expect(limo.ai).toBeNull();
  });

  it("the coach waits for the player, then tours at its own pace, steered for the route's next crossing; the radar follows it", () => {
    const { cars, player, blips, step, begin, bus, progress, shown } = setup();
    // The rest of the story done, so this is its last job.
    progress.data.missions.push('s1-wrongstop', 's2-noise', 's3-quiet', 's4-problems', 's5-ribbon');
    const job = begin('s6-quietest');
    const coach = cars.find((c) => c.archetype === 'bus')!;
    step(0.5);
    expect(coach.ai).toBeNull();
    // Outside the area: the radar has the coach.
    expect(blips.get('m-coach')).toEqual({ x: coach.sim.x, z: coach.sim.z });
    stand(player, coach.sim.x + 30, coach.sim.z);
    step(DT);
    const ai = coach.ai!;
    expect(ai.cruise).toBe(8);
    const spawn = job.steps[0].start?.find((a) => a.do === 'spawnCar');
    if (spawn?.do !== 'spawnCar' || !spawn.route) throw new Error('no route');
    // Steered for its leg's crossing (heading into the tour's first, already for the one after it).
    expect(ai.phase).toBe('approach');
    const leg = routeLeg(spawn.route, 0, ai.ix, ai.iz);
    const [wx, wz] = spawn.route[leg];
    expect(ai.next).toBe(routeToward(ai.ix, ai.iz, ai.dir, wx * 64, wz * 64));
    // It moves on; the blip goes with it.
    coach.sim.x += 50;
    step(DT);
    expect(blips.get('m-coach')).toEqual({ x: coach.sim.x, z: coach.sim.z });
    // Points round it count; it's chapter 1's last, with chapter 2 to come: CHAPTER 1 COMPLETE.
    stand(player, coach.sim.x + 20, coach.sim.z);
    bus.emit({ type: 'award', award: { kind: 'boom', label: 'KABOOM', points: 5000, multiplier: 1 } });
    step(DT * 2);
    expect(progress.data.missions).toContain('s6-quietest');
    expect(shown).toEqual(['CHAPTER 1 COMPLETE']);
  });
});

describe('KEEP IT LOUD, chapter 2', () => {
  /** OPEN MIC, the player at Lionel's gig (the goto passed). */
  function atGig() {
    const t = setup();
    const job = t.begin('s9-openmic');
    const go = job.steps[0];
    if (go.kind !== 'goto') throw new Error('no gig');
    stand(t.player, go.x, go.z);
    t.step(0.2);
    const lionel = (t.ctx.deps.population.crowd as Array<{ agent: { s: { x: number; z: number } } }>)[0];
    return { ...t, job, lionel };
  }

  it('OPEN MIC: the wardens come on in pairs on their timer and march (no running) at Lionel', () => {
    const { step, ctx, lionel } = atGig();
    const crowd = ctx.deps.population.crowd as Array<{ agent: { mode: string; march?: boolean; goalX: number; goalZ: number; temper: string } }>;
    // Only Lionel until the first pair's due.
    step(2);
    expect(crowd).toHaveLength(1);
    step(2);
    expect(crowd).toHaveLength(3);
    for (const w of crowd.slice(1)) {
      expect(w.agent).toMatchObject({ mode: 'arrest', march: true, temper: 'fighter' });
      expect([w.agent.goalX, w.agent.goalZ]).toEqual([lionel.agent.s.x, lionel.agent.s.z]);
    }
    // The next pair a wave later.
    step(25);
    expect(crowd).toHaveLength(5);
  });

  it("OPEN MIC: a warden who gives up a scuffle goes back to marching; one knocked down doesn't", () => {
    const { step, ctx } = atGig();
    step(4);
    const crowd = ctx.deps.population.crowd as Array<{ agent: { mode: string } }>;
    const [, a, b] = crowd;
    a.agent.mode = 'walk';
    b.agent.mode = 'down';
    step(0.1);
    expect(a.agent.mode).toBe('arrest');
    expect(b.agent.mode).toBe('down');
  });

  it("OPEN MIC: wardens keep walking with nobody watching; walk off and they get to Lionel, and the gig's over", () => {
    const { step, player, mode } = atGig();
    stand(player, 900, 900);
    step(15);
    expect(mode.running?.id).toBe('s9-openmic');
    step(15);
    expect(mode.running).toBeNull();
  });

  it("PLANNING PERMISSION: Todd talks on the subtitle while you drive him, in order, and stops when he's dropped", () => {
    const { cars, player, step, begin, bus, mode } = setup();
    const job = begin('s10-permission');
    const said: string[] = [];
    bus.on('voice', (e) => {
      expect(e.who).toBe('TODD');
      expect(e.hold).toBeGreaterThan(2);
      said.push(e.text);
    });
    const [, , drop] = job.steps;
    if (drop.kind !== 'deliver') throw new Error('not a deliver');
    const talk = drop.start?.find((a) => a.do === 'say');
    if (talk?.do !== 'say') throw new Error('no talk');
    // A car, and nothing said while you're on your way to Todd.
    const car = setupCar(cars);
    player.enter(car);
    step(30);
    expect(said).toEqual([]);
    // Beside him: he gets in; a line a moment later, the next ones in order.
    const todd = job.steps[0].start?.find((a) => a.do === 'spawnPed');
    if (todd?.do !== 'spawnPed') throw new Error('no Todd');
    Object.assign(car.sim, { x: todd.x + 2, z: todd.z, vx: 0, vz: 0 });
    step(1.5);
    expect(said).toEqual([]);
    expect(mode.running?.id).toBe('s10-permission');
    step(30);
    expect(said.length).toBeGreaterThanOrEqual(2);
    expect(said).toEqual(talk.lines.slice(0, said.length).map((l) => l.text));
    // Dropped at the ring road: the rest go unsaid.
    const before = said.length;
    Object.assign(car.sim, { x: drop.x, z: drop.z, vx: 0, vz: 0 });
    step(60);
    expect(mode.running).toBeNull();
    expect(said.length).toBe(before);
  });


  it("ALARM CALL: the five cars on the Mayor's street are parked like the city's own, so a bump sets their alarms off", () => {
    const { cars, step, begin } = setup();
    begin('s11-alarmcall');
    step(0.5);
    expect(cars).toHaveLength(5);
    for (const c of cars) {
      expect(c.parked).toBe(true);
      expect(c.ai).toBeNull();
    }
  });

  it("DONER's spit van is the job's own car, not one of the city's parked ones", () => {
    const { cars, step, begin } = setup();
    begin('s8-doner');
    step(0.5);
    expect(cars.map((c) => [c.archetype, c.parked ?? false])).toEqual([['van', false]]);
  });

  it('LOUDEST CITY: the limo leads the convoy out, the convoy speeds up for the second step, and the limo wrecked is STORY COMPLETE', () => {
    const { cars, player, step, begin, bus, progress, shown, mode } = setup();
    const job = begin('s12-loudest');
    progress.data.missions.push(...mode.missions.filter((m) => m.arc === 'main' && m !== job).map((m) => m.id));
    const [limo, van1, van2] = cars;
    expect([limo, van1, van2].map((c) => c.archetype)).toEqual(['limo', 'van', 'van']);
    step(0.5);
    for (const c of cars) expect(c.ai).toBeNull();
    // Come at them from behind: the rear van wakes, and the limo ahead of it is already on its way.
    stand(player, van2.sim.x - 58, van2.sim.z);
    step(DT);
    expect(van2.ai).not.toBeNull();
    expect(limo.ai?.cruise).toBe(9);
    // The middle van, further off, is still waiting.
    expect(van1.ai).toBeNull();
    // A send-off round the limo; then it and its vans put their foot down (the one still parked pulls out).
    // Beside it for a step first: an award counts where the player was at the last step.
    stand(player, limo.sim.x + 30, limo.sim.z);
    step(DT);
    bus.emit({ type: 'award', award: { kind: 'boom', label: 'KABOOM', points: 6000, multiplier: 1 } });
    step(DT * 2);
    expect(mode.running?.id).toBe('s12-loudest');
    for (const c of cars) expect(c.ai?.cruise, c.archetype).toBe(14);
    limo.damage.wrecked = true;
    step(DT * 2);
    expect(progress.data.missions).toContain('s12-loudest');
    expect(shown).toEqual(['STORY COMPLETE']);
  });
});
