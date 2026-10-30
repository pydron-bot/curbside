import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { VEHICLE_HEALTH, createVehicleState } from '../src/entities/vehicle';
import type { ModeCtx } from '../src/game/modes/context';
import { ExportMode } from '../src/game/modes/exportMode';
import { Player } from '../src/game/player';
import type { Vehicle } from '../src/game/population';
import { Progress } from '../src/game/progress';
import { defaultSave } from '../src/game/progressSave';
import type { CarMesh } from '../src/render/carMesh';
import { createDamage } from '../src/systems/damage';
import { generateCity } from '../src/world/city';

const DT = 1 / 60;

function setup(busy: string | null = null) {
  const bus = new EventBus();
  const player = new Player(bus, 0, 0);
  const progress = new Progress(defaultSave(), null);
  const retired: Vehicle[] = [];
  const ctx = {
    deps: {
      bus,
      player,
      population: { retireVehicle: (v: Vehicle) => retired.push(v) },
      heat: { wanted: { level: 0 } },
      audio: { ui() {} },
    },
    progress,
    ui: { banner() {} },
    freeRoam: true,
    live: true,
    busy,
    pay: (amount: number) => progress.earn(amount, 'export'),
    notice() {},
    blip() {},
    unblip() {},
  } as unknown as ModeCtx;
  const mode = new ExportMode(ctx, generateCity(1337));
  return { mode, player, progress, retired };
}

function blackSedanIn(mode: ExportMode): Vehicle {
  const sim = createVehicleState(mode.docks.x, mode.docks.z, mode.docks.heading);
  return {
    archetype: 'sedan',
    paint: '#1f2328',
    sim,
    prev: { ...sim },
    mesh: { root: {}, frontWheels: [] } as unknown as CarMesh,
    ai: null,
    damage: createDamage(VEHICLE_HEALTH.sedan),
    wreckAge: 0,
    charred: false,
  };
}

describe('export mode', () => {
  it('a sold car is sold once: getting back in neither keeps it nor sells it again', () => {
    const { mode, player, progress, retired } = setup();
    const car = blackSedanIn(mode);
    player.enter(car);
    for (let t = 0; t < 1 && !car.exported; t += DT) mode.step(DT);
    expect(car.exported).toBe(true);
    expect(player.driving).toBeNull();
    expect(progress.data.exports.done).toEqual(['sedan-black']);
    // Straight back in (as a script could; the game's GET IN refuses it).
    player.enter(car);
    for (let t = 0; t < 3; t += DT) mode.step(DT);
    expect(progress.data.exports.done).toEqual(['sedan-black']);
    expect(retired).toEqual([car]);
    expect(player.driving).toBeNull();
  });

  it('the bay takes nothing mid-activity: a fare (or a race) keeps its car', () => {
    const { mode, player, progress } = setup('taxi');
    const car = blackSedanIn(mode);
    player.enter(car);
    for (let t = 0; t < 3; t += DT) mode.step(DT);
    expect(car.exported).toBeFalsy();
    expect(player.driving).toBe(car);
    expect(progress.data.exports.done).toEqual([]);
    expect(mode.prompt()).toContain('DROP YOUR FARE FIRST');
  });

  it("a car a mission delivered to the docks sells only after it drives out and back in", () => {
    const w = setup('mission');
    const ctx = (w.mode as unknown as { ctx: ModeCtx }).ctx;
    const car = blackSedanIn(w.mode);
    w.player.enter(car);
    for (let t = 0; t < 2; t += DT) w.mode.step(DT);
    expect(car.exported).toBeFalsy();
    // MISSION PASSED, CONTINUE: still parked in the bay, not sold.
    ctx.busy = null;
    for (let t = 0; t < 3; t += DT) w.mode.step(DT);
    expect(car.exported).toBeFalsy();
    expect(w.player.driving).toBe(car);
    expect(w.mode.prompt()).toContain('DRIVE OUT AND BACK IN');
    // Out of the bay and back: sold.
    car.sim.x += 40;
    w.mode.step(DT);
    car.sim.x -= 40;
    for (let t = 0; t < 1 && !car.exported; t += DT) w.mode.step(DT);
    expect(car.exported).toBe(true);
    expect(w.progress.data.exports.done).toEqual(['sedan-black']);
  });
});
