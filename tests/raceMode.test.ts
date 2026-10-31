import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { VEHICLE_HEALTH, createVehicleState } from '../src/entities/vehicle';
import type { ModeCtx } from '../src/game/modes/context';
import { RaceMode } from '../src/game/modes/raceMode';
import { RACES, nodeX, nodeZ } from '../src/game/modes/races';
import { Player } from '../src/game/player';
import type { Vehicle } from '../src/game/population';
import { NITRO_START, Nitro } from '../src/game/nitro';
import { Progress } from '../src/game/progress';
import { defaultSave } from '../src/game/progressSave';
import type { CarMesh } from '../src/render/carMesh';
import { createDamage } from '../src/systems/damage';

const DT = 1 / 60;

function setup(stars: number) {
  const bus = new EventBus();
  const player = new Player(bus, 0, 0);
  const wanted = { level: stars };
  const ctx = {
    deps: {
      bus,
      player,
      heat: { wanted },
      audio: { ui() {} },
      rig: { snapTo() {} },
      nitro: new Nitro(bus),
      radar: { setWaypoint() {}, clearWaypoint() {} },
    },
    progress: new Progress(defaultSave(), null),
    ui: { banner() {} },
    freeRoam: true,
    live: true,
    busy: null as string | null,
    holdControls: false,
    blip() {},
    unblip() {},
  };
  const mode = new RaceMode(ctx as unknown as ModeCtx);
  const def = RACES[0];
  const sim = createVehicleState(nodeX(def.nodes[0]), nodeZ(def.nodes[0]), 0);
  const car = {
    archetype: 'sports',
    paint: '#fff',
    sim,
    prev: { ...sim },
    mesh: { root: {}, frontWheels: [] } as unknown as CarMesh,
    ai: null,
    damage: createDamage(VEHICLE_HEALTH.sports),
    wreckAge: 0,
    charred: false,
  } as Vehicle;
  player.enter(car);
  return { mode, ctx, wanted };
}

describe('race mode', () => {
  it("won't line up a wanted car for the 3-2-1 (it would be a sitting duck), and says why", () => {
    const { mode, ctx, wanted } = setup(2);
    for (let t = 0; t < 1; t += DT) mode.step(DT);
    expect(ctx.busy).toBeNull();
    expect(ctx.holdControls).toBe(false);
    expect(mode.prompt()).toContain('LOSE THE HEAT FIRST');
    // Heat gone, still on the line: it starts, on the same tank as a respawn.
    ctx.deps.nitro.charge = 1;
    wanted.level = 0;
    mode.step(DT);
    expect(ctx.busy).toBe('race');
    expect(ctx.holdControls).toBe(true);
    expect(ctx.deps.nitro.charge).toBe(NITRO_START);
  });
});
