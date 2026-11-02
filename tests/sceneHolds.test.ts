import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import type { SceneCtx } from '../src/game/cityLife';
import { Accidents } from '../src/game/scenes/accidents';
import { Chases } from '../src/game/scenes/chases';
import { FireCrews } from '../src/game/scenes/fireCrews';
import { Fights } from '../src/game/scenes/fights';
import { Muggings } from '../src/game/scenes/muggings';
import { StreetRaces } from '../src/game/scenes/streetRaces';
import { Tows } from '../src/game/scenes/tows';
import { TurfWar } from '../src/game/scenes/turfWar';
import { SceneClock, WANTED_PACE, activityHolds, held, paceFor, type SceneWorld } from '../src/systems/cityScenes';

/** The scenes' own clock specs: each constructed against a bare director that only takes their define() and listeners. */
function specs(): SceneClock {
  const clock = new SceneClock(() => 0.5);
  const life = { clock, d: { bus: new EventBus() } } as unknown as SceneCtx;
  const chases = new Chases(life);
  new StreetRaces(life, chases);
  new Accidents(life);
  new Fights(life);
  new Muggings(life);
  new TurfWar(life);
  new Tows(life);
  new FireCrews(life);
  return clock;
}

const BUSY_KINDS = ['chase', 'race', 'accident', 'fight', 'mugging', 'turf', 'tow'];
const PLAYING: SceneWorld = { playing: true, activity: false, stars: 0, tutorial: false };

describe('scene holds per kind (V2-02)', () => {
  const clock = specs();

  it('every busy kind keeps starting at every star level, at the wanted pace', () => {
    for (const kind of BUSY_KINDS) {
      const spec = clock.spec(kind);
      expect(clock.busy(kind), kind).toBe(true);
      for (let stars = 0; stars <= 5; stars++) {
        // Chases wait for no stars until the handoff (V2-03): one started now would break off at once.
        expect(held(spec, { ...PLAYING, stars }), `${kind} at ${stars}`).toBe(kind === 'chase' && stars > 0);
        expect(paceFor(spec, stars), `${kind} at ${stars}`).toBe(WANTED_PACE[stars]);
        expect(paceFor(spec, stars)).toBeGreaterThan(0);
      }
    }
  });

  it('busy kinds still wait out the title, the tutorial and a timed race or quiet mission; not Chaos Run, a fare or a frenzy', () => {
    for (const kind of [...BUSY_KINDS, 'fire']) {
      const spec = clock.spec(kind);
      expect(held(spec, { ...PLAYING, playing: false }), kind).toBe(true);
      expect(held(spec, { ...PLAYING, tutorial: true }), kind).toBe(true);
      for (const [busy, quiet, holds] of [
        ['race', false, true],
        ['mission', true, true],
        ['mission', false, false],
        ['taxi', false, false],
        ['frenzy', false, false],
        [null, false, false], // free roam, or Chaos Run (not a `busy` activity)
      ] as const) {
        expect(held(spec, { ...PLAYING, activity: activityHolds(busy, quiet), stars: kind === 'chase' ? 0 : 3 }), `${kind} in ${busy}`).toBe(holds);
      }
    }
  });

  it('only the car-borne ones go on the road ahead; fires keep full pace through stars', () => {
    expect(BUSY_KINDS.filter((k) => clock.spec(k).ahead)).toEqual(['chase', 'race']);
    expect(clock.busy('fire')).toBe(false);
    expect(paceFor(clock.spec('fire'), 5)).toBe(1);
    expect(held(clock.spec('fire'), { ...PLAYING, stars: 5 })).toBe(false);
  });
});
