import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { CityLife, type CityLifeDeps } from '../src/game/cityLife';
import type { ModeCtx } from '../src/game/modes/context';
import { MissionMode } from '../src/game/modes/missionMode';
import { Player } from '../src/game/player';
import { Progress } from '../src/game/progress';
import { defaultSave } from '../src/game/progressSave';
import { storyScenes, type SceneStarter } from '../src/game/sceneStarter';
import type { DialogueCard } from '../src/ui/progressScreens';
import { generateCity } from '../src/world/city';
import { random } from './helpers';

const DT = 1 / 60;
/** Does nothing, whatever's asked of it. */
const anything = (): never => new Proxy(() => anything(), { get: () => anything() }) as never;

describe('a featured scene', () => {
  const world = { stars: 3, activity: true };
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
    playing: () => true,
    activity: () => world.activity,
    stars: () => world.stars,
    tutorial: () => false,
    keep: () => false,
    avoid: [],
    busStops: [],
    vendors: [],
    trafficScale: () => 1,
    npcShoot() {},
    collect: () => false,
    focus: () => ({ x: 0, z: 0, vx: 0, vz: 0 }),
  } as unknown as CityLifeDeps);
  // A kind held by everything (as the loud scenes were).
  life.clock.define('loud', { every: [1, 1], cap: 1, first: 0, hold: ['title', 'activity', 'wanted', 'tutorial'] });

  it('survives the activity hold at 3 stars (a story job featuring it), and only it does', () => {
    life.featured = null;
    expect(life.due('loud', 0)).toBe(false);
    life.featured = 'loud';
    expect(life.due('loud', 0)).toBe(true);
    world.activity = false;
    expect(life.due('loud', 0)).toBe(true);
    life.featured = 'other';
    expect(life.due('loud', 0)).toBe(false);
  });

  it("storyScenes features the scene's kind while it runs, puts things back if it can't start, and unfeatures only its own", () => {
    let ok = true;
    const starter = {
      ok: false,
      start(this: { ok: boolean }) {
        this.ok = ok;
        return '';
      },
    } as unknown as SceneStarter;
    life.featured = null;
    const host = storyScenes(life, starter);
    expect(host.start('race', 0, 0)).toBe(true);
    expect(life.featured).toBe('race');
    ok = false;
    expect(host.start('fight', 0, 0)).toBe(false);
    expect(life.featured).toBe('race');
    host.unfeature();
    expect(life.featured).toBeNull();
    // The title's show featuring something else is left alone.
    life.featured = 'bus';
    host.unfeature();
    expect(life.featured).toBe('bus');
  });
});

describe('mission mode: featured scenes and mayhem', () => {
  function setup() {
    const bus = new EventBus();
    // In Cobble Row, where MAKE SOME NOISE's race is asked for.
    const player = new Player(bus, -256, -256);
    const life = { featured: null as string | null, d: { focus: () => ({ x: -256, z: -256, vx: 0, vz: 1 }), player } } as unknown as CityLife;
    const starter = {
      ok: false,
      start(this: { ok: boolean }) {
        this.ok = true;
        return '';
      },
    } as unknown as SceneStarter;
    const progress = new Progress(defaultSave(), null);
    const shown: string[] = [];
    const ctx = {
      deps: {
        bus,
        player,
        audio: anything(),
        radar: anything(),
        heat: { wanted: { level: 0, force() {} } },
        population: { crowd: [], removePed() {}, addPed() {} },
        look: { time: { hour: 12, speed: 1, set() {} } },
        vehicles: [],
        rand: random(2),
      },
      progress,
      ui: anything(),
      freeRoam: true,
      get live() {
        return player.alive && !player.arrested;
      },
      busy: null as string | null,
      focusRing: false,
      pay: (n: number) => n,
      notice() {},
      blip() {},
      unblip() {},
      unpin() {},
      openModal() {},
      closeModal() {},
    };
    const card = { show: (head: string) => shown.push(head) } as unknown as DialogueCard;
    const mode = new MissionMode(ctx as unknown as ModeCtx, { x: 400, z: 400 }, card);
    mode.useScenes(storyScenes(life, starter));
    const noise = mode.missions.find((m) => m.id === 's2-noise')!;
    expect(mode.beginNow(noise)).toBe(true);
    for (let t = 0; t < 0.5; t += DT) mode.step(DT);
    expect(life.featured).toBe('race');
    return { bus, player, life, ctx, mode, progress, shown };
  }

  it('featured is cleared after WASTED', () => {
    const { life, player, ctx } = setup();
    player.hurt(1e6);
    expect(life.featured).toBeNull();
    expect(ctx.busy).toBeNull();
  });

  it('and after BUSTED, and a quit', () => {
    const a = setup();
    a.player.arrest();
    expect(a.life.featured).toBeNull();
    const b = setup();
    b.mode.reset();
    expect(b.life.featured).toBeNull();
  });

  it('score awards in Cobble Row fill MAKE SOME NOISE; the pass unfeatures the race too', () => {
    const { bus, life, mode, progress, shown } = setup();
    bus.emit({ type: 'award', award: { kind: 'boom', label: 'KABOOM', points: 1500, multiplier: 1 } });
    mode.step(DT);
    expect(life.featured).toBe('race');
    bus.emit({ type: 'award', award: { kind: 'boom', label: 'KABOOM', points: 1000, multiplier: 2 } });
    mode.step(DT);
    expect(progress.data.missions).toContain('s2-noise');
    expect(life.featured).toBeNull();
    expect(shown).toEqual(['MISSION PASSED']);
    // The main story moves on; the Night Shift hasn't started.
    expect(mode.nextOf('main')?.id).toBe('s3-quiet');
    expect(mode.nextOf('night')?.id).toBe('m1-audition');
  });

  it('the Night Shift phone rings only after dark, with a moon; the main story by day', () => {
    const { mode, ctx, player } = setup();
    // The job off (WASTED), back on the street: free roam, phones ringing.
    player.hurt(1e6);
    player.respawn(0, 0);
    const blips = new Map<string, string>();
    ctx.blip = ((id: string, o: { icon?: string }) => blips.set(id, o.icon ?? '')) as never;
    ctx.unblip = ((id: string) => blips.delete(id)) as never;
    const time = ctx.deps.look.time;
    time.hour = 12;
    mode.step(DT);
    expect([...blips.entries()]).toEqual([['phone-oldtown', 'M']]);
    time.hour = 21;
    mode.step(DT);
    expect(new Map(blips)).toEqual(new Map([['phone-oldtown', 'M'], ['phone-docks', '☾']]));
    time.hour = 2;
    mode.step(DT);
    expect([...blips.entries()]).toEqual([['phone-docks', '☾']]);
  });
});
