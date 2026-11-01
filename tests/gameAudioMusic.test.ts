/**
 * GameAudio's music wiring, driven through GameAudio itself on a fake
 * AudioContext: the car radio, the chase, music on foot, death and respawn,
 * the title. The fake evaluates every AudioParam's automation, so a test can
 * read the level actually heard at a time (the street chain times the
 * music's fade), not just which calls were made.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameAudio, createAudioFrame, createCarSound, type AudioFrame, type FireSource } from '../src/audio/gameAudio';
import type { MusicPlayer } from '../src/audio/music/musicPlayer';
import { STATIONS } from '../src/audio/music/stations';
import * as sfx from '../src/audio/sfx';
import { BOOMBOX_STATION, emitterGain, parkedStation } from '../src/audio/streetMusic';
import { EventBus, type GameEvent } from '../src/core/events';

// Pass-through spies: the respawn sting's key is what's checked.
vi.mock('../src/audio/sfx', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/audio/sfx')>();
  return { ...m, respawn: vi.fn(m.respawn) };
});

type Ev = { kind: 'set' | 'lin' | 'exp' | 'target'; t: number; v: number; tau: number };

/** An AudioParam whose automation is kept and evaluated (setTarget, set, ramps, cancel), as Web Audio orders it. */
class Param {
  events: Ev[] = [];
  constructor(
    private readonly clock: { currentTime: number },
    private base: number,
  ) {}
  get value(): number {
    return this.at(this.clock.currentTime);
  }
  set value(v: number) {
    if (this.events.length) this.add({ kind: 'set', t: this.clock.currentTime, v, tau: 0 });
    else this.base = v;
  }
  private add(e: Ev): this {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].t > e.t) i--;
    this.events.splice(i, 0, e);
    return this;
  }
  setValueAtTime(v: number, t: number) {
    return this.add({ kind: 'set', t, v, tau: 0 });
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.add({ kind: 'lin', t, v, tau: 0 });
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    return this.add({ kind: 'exp', t, v, tau: 0 });
  }
  setTargetAtTime(v: number, t: number, tau: number) {
    return this.add({ kind: 'target', t, v, tau });
  }
  cancelScheduledValues(t: number) {
    this.events = this.events.filter((e) => e.t < t);
    return this;
  }
  /** The value at `time`. */
  at(time: number): number {
    let v = this.base;
    let t0 = 0;
    let target: Ev | null = null;
    const cur = (t: number) => (target ? target.v + (v - target.v) * Math.exp(-(t - target.t) / target.tau) : v);
    for (const e of this.events) {
      if (e.kind === 'lin' || e.kind === 'exp') {
        // A ramp runs from the previous event to its own time.
        const from = cur(t0);
        if (time < e.t) {
          const f = Math.max(0, (time - t0) / (e.t - t0));
          return e.kind === 'lin' || from <= 0 ? from + (e.v - from) * f : from * Math.pow(e.v / from, f);
        }
        v = e.v;
        t0 = e.t;
        target = null;
        continue;
      }
      if (e.t > time) break;
      if (e.kind === 'set') {
        v = e.v;
        target = null;
      } else {
        v = cur(e.t);
        target = e;
      }
      t0 = e.t;
    }
    return cur(time);
  }
}

const PARAMS = ['gain', 'frequency', 'detune', 'Q', 'playbackRate', 'delayTime', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release', 'offset'];

function fakeContext() {
  const clock = { currentTime: 0 };
  const node = () => {
    const n: Record<string, unknown> = {
      connect: (d: unknown) => d,
      disconnect() {},
      start() {},
      stop() {},
      setPeriodicWave() {},
      type: '',
      buffer: null,
      loop: false,
      curve: null,
      onended: null,
      fftSize: 2048,
    };
    for (const p of PARAMS) n[p] = new Param(clock, p === 'gain' ? 1 : 0);
    return n;
  };
  const buffer = (channels: number, length: number, sampleRate: number) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      length,
      sampleRate,
      duration: length / sampleRate,
      numberOfChannels: channels,
      getChannelData: (c: number) => data[c],
      copyToChannel: (src: Float32Array, c: number) => data[c].set(src),
    };
  };
  const ctx = {
    get currentTime() {
      return clock.currentTime;
    },
    sampleRate: 8000,
    state: 'running',
    destination: node(),
    createGain: node,
    createBiquadFilter: node,
    createOscillator: node,
    createDelay: node,
    createConvolver: node,
    createBufferSource: node,
    createWaveShaper: node,
    createStereoPanner: node,
    createDynamicsCompressor: node,
    createAnalyser: node,
    createPeriodicWave: () => ({}),
    createBuffer: buffer,
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    close: () => Promise.resolve(),
    addEventListener() {},
  };
  return { ctx, clock };
}

/** A parked car (nobody in it) at (x, z). */
const parked = (x: number, z: number): FireSource => ({ sim: { x, z }, damage: { burning: false, wrecked: false }, wreckAge: 0, ai: null, archetype: 'sedan' });

/** A spot with no parked car's radio, shop or boombox near (the test offers no shops). */
const QUIET = { x: -600, z: -600 };

/**
 * GameAudio on the fake context, unlocked and built, with a frame to drive:
 * run(s) steps it at 60 fps (the 25 ms music timer in between).
 */
function game(opts: { station?: number; vehicles?: FireSource[] } = {}) {
  const { ctx, clock } = fakeContext();
  const timeouts: Array<() => void> = [];
  let tick: (() => void) | null = null;
  const store = new Map<string, string>([['curbside.station', String(opts.station ?? 0)]]);
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('window', {
    AudioContext: function AudioContext() {
      return ctx;
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (fn: () => void) => timeouts.push(fn),
    clearTimeout() {},
    setInterval: (fn: () => void) => {
      tick = fn;
      return 1;
    },
    clearInterval() {},
  });
  // The music's drum kits render between frames: not here (the live drums stand in).
  vi.stubGlobal('setTimeout', () => 0);
  const bus = new EventBus();
  const audio = new GameAudio({ bus });
  audio.unlock();
  while (timeouts.length) timeouts.shift()!();
  const inner = audio as unknown as {
    music: MusicPlayer;
    streetChain: { level: { gain: Param } };
    stationIndex: number;
  };
  const music = inner.music;
  const fade = (music as unknown as { fadeGain: { gain: Param } }).fadeGain.gain;
  const chain = inner.streetChain.level.gain;
  const vehicles = opts.vehicles ?? [];
  const f: AudioFrame = createAudioFrame(vehicles);
  f.x = QUIET.x;
  f.z = QUIET.z;
  const car = createCarSound();
  let sinceTick = 0;
  const run = (seconds: number, each?: () => void) => {
    const dt = 1 / 60;
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      clock.currentTime += dt;
      sinceTick += dt;
      while (sinceTick >= 0.025) {
        sinceTick -= 0.025;
        tick?.();
      }
      audio.update(dt, f);
      each?.();
    }
  };
  /** What's heard of the music, against the in-car radio (1): the street chain times the music's own fade. */
  const heard = (t = clock.currentTime) => chain.at(t) * fade.at(t);
  const emit = (e: GameEvent) => bus.emit(e);
  const drive = (v: FireSource | null = null) => {
    f.car = car;
    f.playerCar = v;
    f.lastCar = v;
  };
  const walk = (x = QUIET.x, z = QUIET.z) => {
    f.car = null;
    f.playerCar = null;
    f.x = x;
    f.z = z;
  };
  return { audio, music, ctx, clock, f, run, heard, chain, fade, emit, drive, walk, inner };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(sfx.respawn).mockClear();
});

/** The spawn point's parked van (its radio on station 0), and where you respawn beside it. */
const VAN = { x: 20, z: 5.5 };
const SPAWN = { x: 20, z: 6.5 };

/** Max of `f()` over `seconds` of play. */
function peak(g: ReturnType<typeof game>, seconds: number, f = () => g.heard()): number {
  let m = 0;
  g.run(seconds, () => (m = Math.max(m, f())));
  return m;
}

describe('GameAudio: the chase', () => {
  it('starts from three stars, calms down at zero, and hands back to the radio', () => {
    const g = game({ station: 2 });
    g.drive();
    g.run(2);
    expect(g.music.station).toBe(STATIONS[2]);
    g.emit({ type: 'wanted', level: 3, prev: 0, reason: 'crime' });
    g.run(4);
    expect(g.music.playingScore).toBe(true);
    expect(g.audio.debug.music!.chase).toBe('on');
    g.emit({ type: 'wanted', level: 0, prev: 3, reason: 'evaded' });
    g.run(8);
    expect(g.music.playingScore).toBe(false);
    expect(g.music.station).toBe(STATIONS[2]);
    expect(g.audio.debug.music!.chase).toBe('idle');
  });

  for (const how of ['died', 'busted'] as const) {
    it(`stops the music for good when you're ${how === 'died' ? 'WASTED' : 'BUSTED'} mid-chase (no fade back up)`, () => {
      const g = game();
      g.drive();
      g.run(1);
      g.emit({ type: 'wanted', level: 4, prev: 0, reason: 'crime' });
      g.run(4);
      expect(g.music.playingScore).toBe(true);
      // The game's order: heat clears the stars on a death before GameAudio hears of it; a bust is raised first.
      if (how === 'died') {
        g.emit({ type: 'wanted', level: 0, prev: 4, reason: 'died' });
        g.emit({ type: 'playerDied' });
      } else {
        g.emit({ type: 'busted', fine: 0 });
        g.emit({ type: 'wanted', level: 0, prev: 4, reason: 'busted' });
      }
      const at = g.clock.currentTime;
      let last = Infinity;
      for (let dt = 0; dt <= 3; dt += 0.05) {
        const v = g.fade.at(at + dt);
        expect(v, `${dt.toFixed(2)} s after`).toBeLessThanOrEqual(last + 1e-9);
        last = v;
      }
      expect(g.fade.at(at + 0.6)).toBeLessThan(0.05);
      g.run(2.5);
      expect(g.music.mode).toBe('off');
      expect(g.audio.debug.music!.chase).toBe('idle');
      expect(g.audio.playingScore).toBe(false);
    });
  }

  it('R mid-chase drops it for the next station, which plays at once (and the chase stays away)', () => {
    const g = game();
    g.drive();
    g.run(1);
    g.emit({ type: 'wanted', level: 3, prev: 0, reason: 'crime' });
    g.run(4);
    expect(g.music.playingScore).toBe(true);
    g.audio.nextStation();
    g.run(1);
    expect(g.music.playingScore).toBe(false);
    expect(g.music.station).toBe(STATIONS[1]);
    expect(g.audio.debug.music!.chase).toBe('skipped');
    g.emit({ type: 'wanted', level: 4, prev: 3, reason: 'crime' });
    g.run(3);
    expect(g.music.playingScore).toBe(false);
  });

  it('tells its listeners when it comes in and when the radio is back (never for the title theme)', () => {
    const g = game();
    const heard: boolean[] = [];
    g.audio.onScoreChange((playing) => heard.push(playing));
    g.audio.setMusicMode('menu');
    g.run(3);
    expect(g.music.playingTheme).toBe(true);
    g.audio.setMusicMode('game');
    g.drive();
    g.run(2);
    expect(heard).toEqual([]);
    g.emit({ type: 'wanted', level: 3, prev: 0, reason: 'crime' });
    expect(g.audio.playingScore).toBe(false); // cued: it comes in on the bar line
    g.run(4);
    expect(g.audio.playingScore).toBe(true);
    expect(heard).toEqual([true]);
    g.emit({ type: 'wanted', level: 0, prev: 3, reason: 'evaded' });
    g.run(8);
    expect(g.audio.playingScore).toBe(false);
    expect(heard).toEqual([true, false]);
  });

  it('wakes the music on foot when it starts, and hands back to silence when nothing is near (the radio never in your ears)', () => {
    const g = game();
    g.walk();
    g.run(6);
    expect(g.music.isDormant).toBe(true);
    g.emit({ type: 'wanted', level: 3, prev: 0, reason: 'crime' });
    g.run(4);
    expect(g.music.playingScore).toBe(true);
    expect(g.chain.at(g.clock.currentTime)).toBeGreaterThan(0.95);
    g.emit({ type: 'wanted', level: 0, prev: 3, reason: 'evaded' });
    let radioPeak = 0;
    let handedBack = false;
    g.run(10, () => {
      if (!g.music.playingScore) handedBack = true;
      if (handedBack) radioPeak = Math.max(radioPeak, g.heard());
    });
    expect(handedBack).toBe(true);
    expect(radioPeak).toBeLessThan(0.02);
    expect(g.music.isDormant).toBe(true);
  });

  it('R on foot mid-chase: the chase stops and the street takes over from silence', () => {
    const g = game();
    g.walk();
    g.run(1);
    g.emit({ type: 'wanted', level: 3, prev: 0, reason: 'crime' });
    g.run(4);
    expect(g.music.playingScore).toBe(true);
    g.audio.nextStation();
    expect(peak(g, 0.25)).toBeLessThanOrEqual(1);
    // The radio's next phrase restarts ~0.3 s on: not in your ears.
    expect(peak(g, 2)).toBeLessThan(0.03);
    expect(g.music.playingScore).toBe(false);
  });
});

describe('GameAudio: death and respawn', () => {
  for (const where of ['in a car', 'on foot', 'mid-chase']) {
    it(`plays the respawn sting in the key of the music that comes back (${where})`, () => {
      const g = game({ station: 5, vehicles: [parked(VAN.x, VAN.z)] });
      expect(parkedStation(VAN.x, VAN.z)).toBe(0);
      g.drive();
      g.run(2);
      if (where === 'mid-chase') {
        g.emit({ type: 'wanted', level: 4, prev: 0, reason: 'crime' });
        g.run(4);
        expect(g.music.playingScore).toBe(true);
      }
      if (where === 'on foot') {
        g.walk();
        g.run(2);
      }
      g.emit({ type: 'wanted', level: 0, prev: 4, reason: 'died' });
      g.emit({ type: 'playerDied' });
      g.run(3);
      expect(sfx.respawn).not.toHaveBeenCalled();
      g.walk(SPAWN.x, SPAWN.z);
      g.emit({ type: 'respawn' });
      g.run(2);
      expect(sfx.respawn).toHaveBeenCalledTimes(1);
      const key = vi.mocked(sfx.respawn).mock.calls[0][1];
      // What plays is the van's station, from its next song, and the sting was in its key.
      expect(g.music.station).toBe(STATIONS[0]);
      expect(key).toBe(g.music.arranger.key);
    });
  }

  for (const [how, where] of [
    ['died', 'on foot'],
    ['died', 'in a car'],
    ['busted', 'on foot'],
    ['busted', 'in a car'],
  ] as const) {
    it(`brings the music back on foot from silence after ${how === 'died' ? 'WASTED' : 'BUSTED'} ${where} (not in your ears)`, () => {
      const g = game({ vehicles: [parked(VAN.x, VAN.z)] });
      if (where === 'in a car') g.drive();
      else g.walk(SPAWN.x, SPAWN.z);
      g.run(3);
      // No swell under the sting either.
      const before = g.heard();
      if (how === 'died') {
        g.emit({ type: 'wanted', level: 0, prev: 0, reason: 'died' });
        g.emit({ type: 'playerDied' });
      } else {
        g.emit({ type: 'busted', fine: 0 });
      }
      expect(peak(g, 3)).toBeLessThanOrEqual(before + 1e-6);
      // Released or respawned where nothing plays: silence.
      g.walk();
      g.emit({ type: 'respawn' });
      expect(peak(g, 2)).toBeLessThan(0.01);
      // And by the van, its level and no more.
      g.walk(SPAWN.x, SPAWN.z);
      const van = emitterGain('car', 1);
      expect(peak(g, 3)).toBeLessThanOrEqual(van * 1.01);
      expect(g.heard()).toBeCloseTo(van, 2);
    });
  }

  it('respawned by the van after dying in a car, the van fades in from silence', () => {
    const g = game({ vehicles: [parked(VAN.x, VAN.z)] });
    g.drive();
    g.run(3);
    g.emit({ type: 'playerDied' });
    g.run(3);
    g.walk(SPAWN.x, SPAWN.z);
    g.emit({ type: 'respawn' });
    const levels: number[] = [];
    g.run(2, () => levels.push(g.heard()));
    expect(levels[0]).toBeLessThan(0.01);
    expect(Math.max(...levels)).toBeLessThanOrEqual(emitterGain('car', 1) * 1.01);
    expect(levels[levels.length - 1]).toBeGreaterThan(emitterGain('car', 1) * 0.9);
  });
});

describe('GameAudio: the car radio', () => {
  it('stepping out carries the radio on from your car as you walk away; back in, it opens up again', () => {
    const g = game({ station: 2 });
    const mine = parked(QUIET.x + 1, QUIET.z);
    g.drive(mine);
    g.run(2);
    expect(g.heard()).toBeCloseTo(1, 2);
    g.walk();
    g.f.lastCar = mine;
    const levels: number[] = [];
    g.run(3, () => levels.push(g.heard()));
    // From the car's level down to the street's: a step out, not a cut.
    expect(levels[0]).toBeGreaterThan(0.9);
    expect(g.heard()).toBeCloseTo(emitterGain('own', 1), 2);
    expect(g.music.station).toBe(STATIONS[2]);
    g.drive(mine);
    g.run(2);
    expect(g.heard()).toBeCloseTo(1, 2);
  });

  it('R on foot retunes the car radio for later; the street plays on', () => {
    const g = game({ station: 2 });
    g.drive();
    g.run(2);
    g.walk();
    g.run(1);
    const was = g.music.station;
    expect(g.audio.nextStation()).toBe(STATIONS[3]);
    g.run(2);
    expect(g.music.station).toBe(was);
    g.drive();
    g.run(2);
    expect(g.music.station).toBe(STATIONS[3]);
  });

  it('a boombox cut while it is heard goes quiet at once', () => {
    const g = game();
    g.walk();
    g.emit({ type: 'boombox', id: 'vipers-0', x: QUIET.x + 3, z: QUIET.z, on: true });
    g.run(3);
    expect(g.music.station).toBe(STATIONS[BOOMBOX_STATION]);
    expect(g.heard()).toBeGreaterThan(0.3);
    g.emit({ type: 'boombox', id: 'vipers-0', x: QUIET.x + 3, z: QUIET.z, on: false, cut: true });
    g.run(0.1);
    expect(g.heard()).toBeLessThan(0.02);
  });

  it("is back on your station for the title and a run's count-in, after the street retuned it (no static after the '3')", () => {
    for (const via of ['the title', 'a restart']) {
      const g = game();
      g.walk();
      g.emit({ type: 'boombox', id: 'vipers-0', x: QUIET.x + 3, z: QUIET.z, on: true });
      g.run(3);
      expect(g.music.arranger.radio).toBe(STATIONS[BOOMBOX_STATION]);
      if (via === 'the title') {
        g.emit({ type: 'respawn' });
        g.audio.setMusicMode('menu');
        g.run(2);
        expect(g.music.playingTheme).toBe(true);
        expect(g.music.arranger.radio, via).toBe(STATIONS[0]);
        g.audio.setMusicMode('game');
      }
      // PLAY or RESTART: a fresh life, then into the car and the count-in at once.
      g.emit({ type: 'respawn' });
      g.walk(SPAWN.x, SPAWN.z);
      g.run(0.5);
      g.emit({ type: 'enterVehicle', archetype: 'sedan' });
      expect(g.music.arranger.radio, via).toBe(STATIONS[0]);
      // The '3' is keyed to what plays next: your station's next song.
      const key = g.music.arranger.key;
      g.audio.countIn(3);
      const retune = vi.spyOn(g.music, 'setStation');
      g.drive();
      g.run(2);
      expect(retune, via).not.toHaveBeenCalled();
      expect(g.music.station).toBe(STATIONS[0]);
      expect(g.music.arranger.key, via).toBe(key);
    }
  });

  it("on foot a count-in's GO leaves the street in charge (the drop-in is the car radio's)", () => {
    const g = game();
    g.walk();
    g.run(6);
    expect(g.music.isDormant).toBe(true);
    for (const n of [3, 2, 1, 0]) {
      g.audio.countIn(n);
      g.run(1);
    }
    expect(g.music.isDormant).toBe(true);
    expect(g.heard()).toBeLessThan(0.01);
    // By a boombox: it plays on, not jumped to a chorus; in a car the radio drops in.
    const dropIn = vi.spyOn(g.music, 'dropIn');
    g.emit({ type: 'boombox', id: 'vipers-0', x: QUIET.x + 3, z: QUIET.z, on: true });
    g.run(3);
    g.audio.countIn(0);
    expect(dropIn).not.toHaveBeenCalled();
    g.drive();
    g.run(2);
    g.audio.countIn(0);
    expect(dropIn).toHaveBeenCalledTimes(1);
  });
});

describe('GameAudio: parked cars on foot', () => {
  it('keep their station when nudged across the hash grid (at spots off it)', () => {
    // A playing car whose station changes if the hash were taken where it's nudged to.
    let spot: { x: number; z: number } | null = null;
    for (let i = 0; i < 2000 && !spot; i++) {
      const x = 2 + i * 0.37;
      const z = 1.9;
      const s = parkedStation(x, z);
      if (s >= 0 && parkedStation(x + 0.6, z) !== s) spot = { x, z };
    }
    expect(spot).not.toBeNull();
    const car = parked(spot!.x, spot!.z);
    const g = game({ vehicles: [car] });
    g.walk(spot!.x, spot!.z + 1);
    g.run(2);
    const station = parkedStation(spot!.x, spot!.z);
    expect(g.music.station).toBe(STATIONS[station]);
    const level = g.heard();
    expect(level).toBeGreaterThan(0.2);
    car.sim.x += 0.6;
    g.run(2, () => expect(g.heard()).toBeGreaterThan(level * 0.6));
    expect(g.music.station).toBe(STATIONS[station]);
  });
});
