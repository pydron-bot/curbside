import { describe, expect, it } from 'vitest';
import { STATIONS } from '../src/audio/music/stations';
import {
  AWNING_PLAYING,
  BOOMBOX_STATION,
  Boomboxes,
  DISTRICT_STATIONS,
  DORMANT_AFTER,
  EMITTERS,
  NEON_PLAYING,
  PARKED_PLAYING,
  ParkedRadios,
  REPARKED,
  SWITCH_FADE,
  SWITCH_MARGIN,
  ShopEmitters,
  StreetMusic,
  emitterCutoff,
  emitterGain,
  hash01,
  isParked,
  parkedStation,
  stationIndex,
  type EmitterKind,
  type StreetCar,
} from '../src/audio/streetMusic';
import { EventBus, type EventOf } from '../src/core/events';
import { BOOMBOX_SETTLE, createBoombox, placeHangouts, stepBoombox } from '../src/game/gangs';
import { GangMode } from '../src/game/modes/gangMode';
import type { ModeCtx } from '../src/game/modes/context';
import { Progress } from '../src/game/progress';
import { defaultSave } from '../src/game/progressSave';
import { planBuildings } from '../src/world/buildingPlans';
import { generateCity } from '../src/world/city';
import { DISTRICTS, districtAt } from '../src/world/districts';

const KINDS: EmitterKind[] = ['own', 'car', 'shop', 'boombox'];

describe('emitters on the street', () => {
  it('fade with distance: full up close, never louder further off, silent past their range', () => {
    for (const k of KINDS) {
      const e = EMITTERS[k];
      expect(emitterGain(k, 0)).toBe(e.level);
      let prev = Infinity;
      for (let d = 0; d <= e.max + 5; d += 0.25) {
        const g = emitterGain(k, d);
        expect(g, `${k} at ${d}`).toBeLessThanOrEqual(prev);
        expect(g).toBeGreaterThanOrEqual(0);
        prev = g;
      }
      expect(emitterGain(k, e.max)).toBe(0);
      expect(emitterGain(k, e.max * 0.99)).toBeLessThan(0.01);
      expect(emitterGain(k, NaN)).toBe(0);
      // Muffled further off, opening up close, between its two cutoffs.
      let cut = Infinity;
      for (let d = 0; d <= e.max; d += 0.5) {
        const c = emitterCutoff(k, d);
        expect(c).toBeLessThanOrEqual(cut);
        expect(c).toBeGreaterThanOrEqual(e.far - 1e-6);
        expect(c).toBeLessThanOrEqual(e.near + 1e-6);
        cut = c;
      }
    }
  });

  it('are faint against the car radio (1), the boombox louder and heard from across the street', () => {
    for (const k of ['own', 'car', 'shop'] as const) expect(EMITTERS[k].level).toBeLessThanOrEqual(0.5);
    expect(emitterGain('car', 3)).toBeLessThan(0.25);
    expect(emitterGain('shop', 3)).toBeLessThan(0.25);
    for (const d of [3, 8, 14]) {
      expect(emitterGain('boombox', d)).toBeGreaterThan(emitterGain('car', d));
      expect(emitterGain('boombox', d)).toBeGreaterThan(emitterGain('shop', d));
    }
    expect(emitterGain('boombox', 25)).toBeGreaterThan(0.03);
    expect(emitterGain('car', 20)).toBe(0);
  });

  it('play only real stations: every district has shop music, the boombox plays phonk', () => {
    for (const d of DISTRICTS) {
      expect(DISTRICT_STATIONS[d].length).toBeGreaterThan(1);
      for (const id of DISTRICT_STATIONS[d]) expect(stationIndex(id), `${d}: ${id}`).toBeGreaterThanOrEqual(0);
    }
    expect(Object.keys(DISTRICT_STATIONS).sort()).toEqual([...DISTRICTS].sort());
    expect(STATIONS[BOOMBOX_STATION].id).toBe('sideways');
    expect(stationIndex('nope')).toBe(-1);
  });

  it('hash parked cars to a station: about one in three plays, always the same for the same spot, every station turns up', () => {
    let playing = 0;
    let total = 0;
    const seen = new Set<number>();
    for (let x = -500; x < 500; x += 8) {
      for (let z = -500; z < 500; z += 8) {
        const s = parkedStation(x, z);
        expect(parkedStation(x, z)).toBe(s);
        total++;
        if (s < 0) continue;
        expect(s).toBeLessThan(STATIONS.length);
        playing++;
        seen.add(s);
      }
    }
    expect(playing / total).toBeGreaterThan(PARKED_PLAYING - 0.04);
    expect(playing / total).toBeLessThan(PARKED_PLAYING + 0.04);
    expect(seen.size).toBe(STATIONS.length);
    for (let i = 0; i < 100; i++) {
      const h = hash01(i, i * 7);
      expect(h >= 0 && h < 1).toBe(true);
    }
  });

  it('keep a parked car on its station while it is nudged about (anywhere, not just on the hash grid), and pick again once it is re-parked', () => {
    const radios = new ParkedRadios();
    const car = (x: number, z: number): StreetCar => ({ sim: { x, z }, damage: { burning: false, wrecked: false } });
    let flips = 0;
    for (let i = 0; i < 4000; i++) {
      const c = car((hash01(i, 1) - 0.5) * 1000, (hash01(i, 2) - 0.5) * 1000);
      const s = radios.stationOf(c);
      expect(s).toBe(parkedStation(c.sim.x, c.sim.z));
      // Shoved up to 3 m (traffic, a blast): the hash of where it ends up would often differ; the radio doesn't.
      const a = hash01(i, 3) * Math.PI * 2;
      const d = [0.6, 1, 2, 3][i % 4];
      c.sim.x += Math.cos(a) * d;
      c.sim.z += Math.sin(a) * d;
      if (parkedStation(c.sim.x, c.sim.z) !== s) flips++;
      expect(radios.stationOf(c)).toBe(s);
      // Driven off and parked somewhere else: a fresh pick, for there.
      c.sim.x += REPARKED + 4;
      expect(radios.stationOf(c)).toBe(parkedStation(c.sim.x, c.sim.z));
    }
    // The spots were off the grid: the hash alone would have changed station for many of them.
    expect(flips).toBeGreaterThan(500);
  });

  it('count a car as parked only if nobody is in it, it is not the police, not wrecked, burning or sold, and it has a radio', () => {
    const car = (o: Partial<StreetCar> = {}): StreetCar => ({ sim: { x: 0, z: 0 }, damage: { burning: false, wrecked: false }, ai: null, archetype: 'sedan', ...o });
    expect(isParked(car())).toBe(true);
    expect(isParked(car({ archetype: 'van', pursuit: null, police: false, exported: false }))).toBe(true);
    expect(isParked(car({ ai: {} }))).toBe(false);
    expect(isParked(car({ pursuit: {} }))).toBe(false);
    expect(isParked(car({ police: true }))).toBe(false);
    expect(isParked(car({ exported: true }))).toBe(false);
    expect(isParked(car({ damage: { burning: true, wrecked: false } }))).toBe(false);
    expect(isParked(car({ damage: { burning: false, wrecked: true } }))).toBe(false);
    for (const a of ['scooter', 'cop_bike', 'police', 'police_suv', 'swat', 'ambulance', 'firetruck']) expect(isParked(car({ archetype: a }))).toBe(false);
  });
});

describe('shopfronts that play', () => {
  const city = generateCity(1337);
  const plans = planBuildings(city);
  const shops = new ShopEmitters(city.buildings, plans);

  it('are some of the neon-lit and awninged ones, on the pavement in front, playing their district', () => {
    let neon = 0;
    let awning = 0;
    for (const p of plans) {
      for (const s of p.shopfronts) {
        if (s.neon) neon++;
        else if (s.awning) awning++;
      }
    }
    const expected = neon * NEON_PLAYING + awning * AWNING_PLAYING;
    expect(shops.count).toBeGreaterThan(expected * 0.85);
    expect(shops.count).toBeLessThan(expected * 1.15);
    for (let i = 0; i < shops.count; i++) {
      const d = districtAt(shops.x[i], shops.z[i]);
      const station = STATIONS[shops.station[i]];
      // Out on the pavement (a road counts with the block to its south-east, so check the near side's district too).
      const near = [districtAt(shops.x[i] - 2, shops.z[i] - 2), d, districtAt(shops.x[i] + 2, shops.z[i] + 2)];
      expect(near.some((n) => DISTRICT_STATIONS[n].includes(station.id)), `shop ${i} in ${d} plays ${station.id}`).toBe(true);
    }
  });

  it('finds every shop in range through the grid, whatever the cell', () => {
    const r = EMITTERS.shop.max;
    let checked = 0;
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(hash01(k, 3) * shops.count);
      const x = shops.x[i] + (hash01(k, 5) - 0.5) * 30;
      const z = shops.z[i] + (hash01(k, 9) - 0.5) * 30;
      const found = new Set<number>();
      const mix = { offer: (_k: EmitterKind, _s: number, sx: number, sz: number) => found.add(Math.round(sx * 10) * 100000 + Math.round(sz * 10)) };
      shops.offerNear(mix as unknown as StreetMusic, x, z);
      for (let j = 0; j < shops.count; j++) {
        if (Math.hypot(shops.x[j] - x, shops.z[j] - z) < r) {
          expect(found.has(Math.round(shops.x[j] * 10) * 100000 + Math.round(shops.z[j] * 10))).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
});

/** A listener walking along x, scanning like GameAudio (every 0.2 s), with the music switching on the bar line it's asked for. */
function walk(emitters: Array<{ kind: EmitterKind; station: number; x: number; z: number }>, start: number, end: number, opts: { heard?: number; speed?: number } = {}) {
  const m = new StreetMusic();
  let heard = opts.heard ?? 0;
  const log: Array<{ x: number; station: number; heard: number; gain: number; tune: number; dormant: boolean; kind: EmitterKind | null }> = [];
  const speed = opts.speed ?? 1.5;
  const dir = Math.sign(end - start);
  for (let x = start; dir * (end - x) >= 0; x += dir * speed * 0.2) {
    m.begin(x, 0);
    for (const e of emitters) m.offer(e.kind, e.station, e.x, e.z);
    m.end(0.2, heard);
    // The retune lands by the next scan.
    if (m.tune >= 0) heard = m.tune;
    log.push({ x, station: m.station, heard, gain: m.gain, tune: m.tune, dormant: m.dormant, kind: m.kind });
  }
  return { m, log };
}

describe('the music on foot', () => {
  it('follows the loudest emitter, fading out before a retune and back in once it has landed', () => {
    const { log } = walk(
      [
        { kind: 'own', station: 0, x: 0, z: 1.5 },
        { kind: 'shop', station: 4, x: 14, z: 3 },
      ],
      0,
      16,
      { heard: 0 },
    );
    expect(log[0].gain).toBeGreaterThan(0.3);
    const first = log.findIndex((l) => l.station === 4);
    expect(first).toBeGreaterThanOrEqual(0);
    // Silent while switching, and only tuned after the fade.
    const tuned = log.findIndex((l) => l.tune === 4);
    expect(tuned).toBeGreaterThan(first);
    expect((tuned - first) * 0.2).toBeGreaterThanOrEqual(SWITCH_FADE - 0.2);
    for (let i = first; i <= tuned; i++) expect(log[i].gain).toBe(0);
    const near = log[log.length - 1];
    expect(near.heard).toBe(4);
    expect(near.gain).toBeCloseTo(emitterGain('shop', Math.hypot(14 - near.x, 3)), 6);
  });

  it('carries on from the car radio when you step out by your own car: no retune, its level falling as you walk away', () => {
    const { log } = walk([{ kind: 'own', station: 2, x: 0, z: 1.5 }], 0, 25, { heard: 2 });
    expect(log.every((l) => l.tune < 0)).toBe(true);
    expect(log[0].gain).toBeGreaterThan(0.3);
    for (let i = 1; i < log.length; i++) expect(log[i].gain).toBeLessThanOrEqual(log[i - 1].gain + 1e-9);
    expect(log[log.length - 1].gain).toBe(0);
  });

  it('does not flap between two stations: another takes over only when clearly louder, both ways', () => {
    const a = { kind: 'shop' as const, station: 1, x: 0, z: 3 };
    const b = { kind: 'shop' as const, station: 2, x: 12, z: 3 };
    const there = walk([a, b], -2, 14, { heard: 1, speed: 0.5 });
    const switched = there.log.find((l) => l.station === 2)!;
    // At the switch B is more than SWITCH_MARGIN louder than A, not just louder.
    const ga = emitterGain('shop', Math.hypot(a.x - switched.x, a.z));
    const gb = emitterGain('shop', Math.hypot(b.x - switched.x, b.z));
    expect(gb).toBeGreaterThan(ga * SWITCH_MARGIN);
    expect(switched.x).toBeGreaterThan(6.5);
    // Standing still in the middle never changes station.
    const still = walk([a, b], 6, 6.01, { heard: 1, speed: 0.001 });
    expect(still.log.every((l) => l.station === 1)).toBe(true);
    // Walking back, B holds until A is clearly louder: the switch back is further toward A.
    const back = walk([a, b], 14, -2, { heard: 2, speed: 0.5 });
    const returned = back.log.find((l) => l.station === 1)!;
    expect(returned.x).toBeLessThan(5.5);
    // One change each way, no flapping.
    const changes = (log: typeof there.log) => log.filter((l, i) => i > 0 && l.station !== log[i - 1].station).length;
    expect(changes(there.log)).toBe(1);
    expect(changes(back.log)).toBe(1);
  });

  it('moves seamlessly between two emitters on the same station', () => {
    const { log } = walk(
      [
        { kind: 'car', station: 3, x: 0, z: 2 },
        { kind: 'shop', station: 3, x: 15, z: 3 },
      ],
      -1,
      16,
      { heard: 3 },
    );
    expect(log.every((l) => l.tune < 0 && l.station === 3)).toBe(true);
    expect(log.some((l) => l.kind === 'car') && log.some((l) => l.kind === 'shop')).toBe(true);
    expect(log.filter((l) => l.gain === 0).length).toBeLessThan(4);
  });

  it(`goes dormant after ${DORMANT_AFTER} s of nothing in range and wakes when something is`, () => {
    const m = new StreetMusic();
    let t = 0;
    for (; t < DORMANT_AFTER + 1; t += 0.2) {
      m.begin(0, 0);
      m.offer('car', 1, 100, 0);
      m.end(0.2, 1);
      expect(m.gain).toBe(0);
      expect(m.dormant).toBe(t + 0.2 >= DORMANT_AFTER - 1e-9);
    }
    expect(m.dormant).toBe(true);
    m.begin(0, 0);
    m.offer('car', 5, 3, 0);
    m.end(0.2, 1);
    expect(m.dormant).toBe(false);
    // Silent already: retuned at once, heard once it lands.
    expect(m.tune).toBe(5);
    m.begin(0, 0);
    m.offer('car', 5, 3, 0);
    m.end(0.2, 5);
    expect(m.gain).toBeGreaterThan(0);
  });

  it('goes quiet at once when the boombox heard is cut, and starts afresh after leave()', () => {
    const m = new StreetMusic();
    for (let i = 0; i < 5; i++) {
      m.begin(0, 0);
      m.offer('boombox', BOOMBOX_STATION, 5, 0);
      m.end(0.2, BOOMBOX_STATION);
    }
    expect(m.kind).toBe('boombox');
    expect(m.gain).toBeGreaterThan(0.3);
    m.cut();
    expect(m.gain).toBe(0);
    expect(m.tau).toBeLessThan(0.05);
    expect(m.onFoot).toBe(true);
    m.leave();
    expect(m.onFoot).toBe(false);
    // Out of the chase or the title (heard −1): silent at once, retuned to what's here.
    m.begin(0, 0);
    m.offer('shop', 2, 2, 0);
    m.end(0.2, -1);
    expect(m.gain).toBe(0);
    expect(m.tune).toBe(2);
  });

  it('steps out from silence when nothing was in your ears: no fade before a retune, and quickly down when nothing is near', () => {
    // After WASTED (the music was off): another station nearby is tuned at once, nothing to fade out first.
    const m = new StreetMusic();
    m.begin(0, 0);
    m.offer('car', 4, 2, 0);
    m.end(0.2, 1, false);
    expect(m.tune).toBe(4);
    expect(m.gain).toBe(0);
    // Stepping out of the car (the radio in your ears) fades it before retuning.
    const out = new StreetMusic();
    out.begin(0, 0);
    out.offer('car', 4, 2, 0);
    out.end(0.2, 1);
    expect(out.tune).toBe(-1);
    // Nothing near: the radio in your ears steps down slowly; anything else is down before the radio's next song comes in.
    const carry = new StreetMusic();
    carry.begin(0, 0);
    carry.end(0.2, 1);
    const fresh = new StreetMusic();
    fresh.begin(0, 0);
    fresh.end(0.2, -1);
    expect(fresh.tau).toBeLessThan(0.1);
    expect(carry.tau).toBeGreaterThan(fresh.tau * 3);
  });

  it('reuses its pick objects from scan to scan', () => {
    const m = new StreetMusic();
    const inner = m as unknown as { best: object; same: object };
    const best = inner.best;
    const same = inner.same;
    for (let i = 0; i < 500; i++) {
      m.begin(i * 0.1, 0);
      m.offer('car', i % 7, 3, 1);
      m.offer('shop', 2, 10, 2);
      m.end(0.2, i % 7);
    }
    expect(inner.best).toBe(best);
    expect(inner.same).toBe(same);
  });
});

describe('the VIPERS boombox', () => {
  it('plays while the crew stands about calm, is cut by trouble and comes back once they settle', () => {
    const b = createBoombox();
    expect(stepBoombox(b, false, false, 1)).toBeNull();
    expect(stepBoombox(b, true, false, 0.016)).toBe('on');
    expect(stepBoombox(b, true, false, 1)).toBeNull();
    expect(stepBoombox(b, true, true, 0.016)).toBe('cut');
    expect(b.on).toBe(false);
    let t = 0;
    let back: string | null = null;
    while (!back && t < 60) {
      back = stepBoombox(b, true, false, 0.5);
      t += 0.5;
    }
    expect(back).toBe('on');
    expect(t).toBeCloseTo(BOOMBOX_SETTLE, 0);
    expect(stepBoombox(b, false, false, 0.016)).toBe('off');
    // A fresh crew starts it at once.
    expect(stepBoombox(b, true, false, 0.016)).toBe('on');
  });

  it('is tracked from its events and offered only while it plays', () => {
    const boxes = new Boomboxes();
    boxes.track({ id: 'vipers-0', x: 1, z: 2, on: true });
    boxes.track({ id: 'vipers-1', x: 9, z: 2, on: true });
    boxes.track({ id: 'vipers-0', x: 1, z: 2, on: false });
    expect(boxes.list).toHaveLength(2);
    expect(boxes.playing).toBe(1);
    const offered: number[] = [];
    boxes.offerTo({ offer: (k: EmitterKind, s: number, x: number) => offered.push(x, s, k === 'boombox' ? 1 : 0) } as unknown as StreetMusic);
    expect(offered).toEqual([9, BOOMBOX_STATION, 1]);
  });

  it('gangMode emits boombox events as the crew appears, turns on the player and settles', () => {
    const bus = new EventBus();
    const events: Array<EventOf<'boombox'>> = [];
    bus.on('boombox', (e) => events.push(e));
    const hangout = placeHangouts()[0];
    const crowd: Array<{ agent: { mode: string; s: { x: number; z: number } } }> = [];
    const position = { x: hangout.x + 10, z: hangout.z, vx: 0, vz: 0 };
    let freeRoam = true;
    const ctx = {
      deps: {
        bus,
        rand: () => 0.5,
        player: { position },
        population: {
          crowd,
          addPed: (agent: { mode: string; s: { x: number; z: number } }) => {
            const p = { agent };
            crowd.push(p);
            return p;
          },
          removePed: (p: unknown) => crowd.splice(crowd.indexOf(p as (typeof crowd)[number]), 1),
        },
      },
      progress: new Progress(defaultSave(), null),
      get freeRoam() {
        return freeRoam;
      },
      live: true,
      notice() {},
    };
    const mode = new GangMode(ctx as unknown as ModeCtx);
    mode.step(1 / 60);
    const mine = () => events.filter((e) => e.id === hangout.id);
    expect(mine()).toHaveLength(1);
    expect(mine()[0]).toMatchObject({ type: 'boombox', id: hangout.id, x: hangout.x, z: hangout.z, on: true, cut: false });
    // One of them turns on the player: a cut.
    crowd[0].agent.mode = 'fight';
    mode.step(1 / 60);
    expect(mine()[1]).toMatchObject({ on: false, cut: true });
    // Back on the corner and settled: on again.
    crowd[0].agent.mode = 'arrest';
    for (let t = 0; t < BOOMBOX_SETTLE + 1; t += 0.5) mode.step(0.5);
    expect(mine()[2]).toMatchObject({ on: true });
    // A Chaos Run clears the street: off, quietly.
    freeRoam = false;
    mode.step(1 / 60);
    expect(mine()[3]).toMatchObject({ on: false, cut: false });
    expect(mine()).toHaveLength(4);
  });
});

describe('the spawn point', () => {
  it("has a parked van with its radio on the first station (the one a new player's car radio is on)", () => {
    expect(parkedStation(20, 5.5)).toBe(0);
  });
});
