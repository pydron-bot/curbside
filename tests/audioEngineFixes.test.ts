import { describe, expect, it } from 'vitest';
import { CHASE, CHASE_STATION } from '../src/audio/music/chase';
import { MusicPlayer } from '../src/audio/music/musicPlayer';
import { Arranger, STEPS_PER_BAR, type NoteEvent } from '../src/audio/music/sequencer';
import { STATIONS, type Station } from '../src/audio/music/stations';
import { THEME } from '../src/audio/music/themes';
import type { Voice } from '../src/audio/synth';

/**
 * A BaseAudioContext whose params keep their automation timeline (cancels
 * included) and can say what value it gives at any time, and whose nodes
 * remember when they were started, stopped, connected and reshaped: enough
 * to check what the MusicPlayer would actually sound like around a switch.
 */
interface Event {
  kind: 'set' | 'linear' | 'exp' | 'target';
  v: number;
  t: number;
  tau: number;
}

class Param {
  events: Event[] = [];
  private base: number;

  constructor(
    private readonly clock: { currentTime: number },
    init: number,
  ) {
    this.base = init;
  }

  get value(): number {
    return this.at(this.clock.currentTime);
  }

  set value(x: number) {
    if (this.events.length === 0) this.base = x;
    else this.insert({ kind: 'set', v: x, t: this.clock.currentTime, tau: 0 });
  }

  setValueAtTime(v: number, t: number) {
    return this.insert({ kind: 'set', v, t, tau: 0 });
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.insert({ kind: 'linear', v, t, tau: 0 });
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    return this.insert({ kind: 'exp', v, t, tau: 0 });
  }
  setTargetAtTime(v: number, t: number, tau: number) {
    return this.insert({ kind: 'target', v, t, tau });
  }
  cancelScheduledValues(t: number) {
    this.events = this.events.filter((e) => e.t < t);
    return this;
  }

  /** The value at `time`, as Web Audio would run the timeline (a ramp starts from the event before it). */
  at(time: number): number {
    let v = this.base;
    let from = 0;
    let target: number | null = null;
    let tau = 1;
    const advance = (to: number) => {
      if (target !== null) v = target + (v - target) * Math.exp(-(to - from) / tau);
      from = to;
    };
    for (const e of this.events) {
      if (e.kind === 'linear' || e.kind === 'exp') {
        if (time < e.t) {
          advance(Math.min(time, from));
          const f = (time - from) / (e.t - from);
          return e.kind === 'linear' || v <= 0 ? v + (e.v - v) * f : v * Math.pow(e.v / v, f);
        }
        v = e.v;
        from = e.t;
        target = null;
        continue;
      }
      if (e.t > time) break;
      advance(e.t);
      if (e.kind === 'set') {
        v = e.v;
        target = null;
      } else {
        target = e.v;
        tau = e.tau;
      }
    }
    advance(time);
    return v;
  }

  private insert(e: Event) {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].t > e.t) i--;
    this.events.splice(i, 0, e);
    return this;
  }
}

interface FakeNode {
  started: number;
  stopped: number;
  /** [context time, wave] each time the shape changed. */
  shapes: Array<[number, string]>;
  /** [context time, destination] for each connect. */
  links: Array<[number, unknown]>;
  gain: Param;
  [k: string]: unknown;
}

function recordingAudio() {
  const clock = { currentTime: 0 };
  const node = (): FakeNode => {
    let type = 'sine';
    const n: FakeNode = {
      started: NaN,
      stopped: NaN,
      shapes: [],
      links: [],
      connect(d: unknown) {
        n.links.push([clock.currentTime, d]);
        return d;
      },
      disconnect() {},
      start(t: number) {
        n.started = t;
      },
      stop(t: number) {
        n.stopped = t;
      },
      setPeriodicWave() {
        n.shapes.push([clock.currentTime, 'custom']);
      },
      gain: new Param(clock, 1),
      frequency: new Param(clock, 440),
      detune: new Param(clock, 0),
      Q: new Param(clock, 1),
      delayTime: new Param(clock, 0),
      playbackRate: new Param(clock, 1),
      buffer: null,
      loop: false,
      curve: null,
    };
    Object.defineProperty(n, 'type', {
      get: () => type,
      set: (x: string) => {
        type = x;
        n.shapes.push([clock.currentTime, x]);
      },
    });
    return n;
  };
  const buffer = (channels: number, length: number, sampleRate: number) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, duration: length / sampleRate, numberOfChannels: channels, getChannelData: (c: number) => data[c], copyToChannel() {} };
  };
  const ctx = Object.assign(clock, {
    sampleRate: 8000,
    createGain: node,
    createBiquadFilter: node,
    createOscillator: node,
    createDelay: node,
    createConvolver: node,
    createBufferSource: node,
    createWaveShaper: node,
    createPeriodicWave: () => ({}),
    createBuffer: buffer,
  });
  const noise = buffer(1, 16000, 8000);
  const bank = { white: noise, pink: noise, brown: noise, crackle: noise, glass: noise, offset: () => 0 };
  return { ctx, bank, out: node(), impulse: noise };
}

/** A MusicPlayer's private parts, by name. */
const inner = <T>(music: MusicPlayer, name: string) => (music as unknown as Record<string, T>)[name];
const param = (n: AudioNode | AudioParam, name = 'gain') => (n as unknown as Record<string, Param>)[name];

function player(station: Station) {
  const { ctx, bank, out, impulse } = recordingAudio();
  const music = new MusicPlayer(ctx as never, bank as never, out as never, impulse as never, station);
  const run = (seconds: number, dt = 0.025) => {
    const end = ctx.currentTime + seconds - 1e-9;
    while (ctx.currentTime < end) {
      ctx.currentTime += dt;
      music.pump(ctx.currentTime);
    }
  };
  const notes = () => inner<Voice[]>(music, 'notes');
  return { ctx, music, run, notes };
}

const byId = (id: string) => STATIONS.find((s) => s.id === id)!;
const SIDEWAYS = byId('sideways');

function steps(a: Arranger, n: number): NoteEvent[][] {
  const out: NoteEvent[][] = [];
  const ev: NoteEvent[] = [];
  for (let i = 0; i < n; i++) {
    a.next(ev);
    out.push(ev.map((e) => ({ ...e })));
  }
  return out;
}

describe('switching what plays', () => {
  it("a retune (or the theme giving way) kills the old phrase under its fade, so its pads don't come back up with it; the static stays", () => {
    for (const how of ['station', 'theme'] as const) {
      const { ctx, music, run, notes } = player(STATIONS[0]);
      music.setTheme(THEME);
      music.setMode(how === 'theme' ? 'menu' : 'game');
      music.setIntensity(2);
      run(4);
      const now = ctx.currentTime;
      const old = [...notes()];
      expect(old.some((v) => v.end > now + 1), how).toBe(true); // a pad holds on for seconds
      if (how === 'theme') music.setMode('game');
      else music.setStation(2);
      // Gone before the fade comes back up at now + 0.3.
      for (const v of old) {
        expect(v.end, how).toBeLessThanOrEqual(now + 0.36 + 1e-9);
        for (const s of v.sources) expect((s as unknown as FakeNode).stopped, how).toBeLessThanOrEqual(now + 0.36 + 1e-9);
      }
      if (how === 'station') expect(notes().some((v) => v.t === now && v.end >= now + 0.34)).toBe(true);
      music.dispose();
    }
  });

  it('GO cuts the old phrase dead: a note it booked to start just after GO never sounds', () => {
    const { ctx, music, run, notes } = player(STATIONS[0]);
    music.setMode('game');
    music.setIntensity(4);
    run(5);
    // Step to a moment when a note is booked to start after GO's `when`.
    let guard = 0;
    while (!notes().some((v) => v.t > ctx.currentTime + 0.04) && guard++ < 100) run(0.005, 0.005);
    const when = ctx.currentTime + 0.035;
    const late = notes().filter((v) => v.t >= when);
    expect(late.length).toBeGreaterThan(0);
    music.dropIn(when, 4);
    for (const v of late) {
      for (const dt of [0, 0.002, 0.01, 0.03]) expect(param(v.out).at(v.t + dt), `voice at +${((v.t - when) * 1000).toFixed(0)} ms`).toBe(0);
    }
    music.dispose();
  });

  it("drops the radio in at GO: its first step exactly at `when`, on a chorus, out of the duck, the old phrase cut there", () => {
    const { ctx, music, run, notes } = player(STATIONS[0]);
    music.setTheme(THEME);
    music.setMode('game');
    music.setIntensity(1);
    run(6);
    for (let n = 0; n < 3; n++) {
      music.duck(0.3, 0.3, 1.25);
      run(0.25);
    }
    const now = ctx.currentTime;
    // Not now + 0.03, where the clock's own stall recovery would land a step anyway.
    const when = now + 0.04;
    const before = new Set(notes());
    const ringing = notes().filter((v) => v.end > when + 0.1);
    expect(ringing.length).toBeGreaterThan(0);
    music.dropIn(when, 4);
    music.pump(now);
    expect(music.arranger.intensity).toBe(4);
    expect(music.arranger.section).toBe('chorus');
    // The new phrase starts on `when` (its downbeat's kick, pad...), nothing of it before.
    const fresh = notes().filter((v) => !before.has(v));
    expect(fresh.length).toBeGreaterThan(0);
    expect(Math.min(...fresh.map((v) => v.t))).toBeCloseTo(when, 9);
    // The old phrase stops there (a fast fade, then its sources stop).
    for (const v of ringing) expect(v.end).toBeLessThanOrEqual(when + 0.08 + 1e-9);
    // The count's duck (held 1.25 s) lets go at once.
    const duck = param(inner<GainNode>(music, 'duckGain'));
    expect(duck.at(now)).toBeLessThan(0.35);
    expect(duck.at(when + 0.1)).toBeGreaterThan(0.95);
    // Not on the title: the theme plays on.
    music.setMode('menu');
    run(1);
    music.dropIn(ctx.currentTime + 0.03, 5);
    run(1);
    expect(music.playingTheme).toBe(true);
    music.dispose();
  });

  it('GO over the chase still lets go of the count-in duck (a frenzy counted in mid-chase)', () => {
    const { ctx, music, run } = player(STATIONS[0]);
    music.setMode('game');
    music.setScore(CHASE);
    run(3);
    expect(music.playingScore).toBe(true);
    for (let n = 0; n < 3; n++) {
      music.duck(0.3, 0.3, 1.25);
      run(1);
    }
    const when = ctx.currentTime + 0.03;
    music.dropIn(when, 4);
    expect(music.playingScore).toBe(true); // the chase plays on
    const duck = param(inner<GainNode>(music, 'duckGain'));
    expect(duck.at(when + 0.1)).toBeGreaterThan(0.95);
    music.dispose();
  });

  it("'off' stays off: a fade back up booked by a restart just before (dying mid-chase drops the chase first) can't undo it", () => {
    const { ctx, music, run } = player(STATIONS[0]);
    music.setMode('game');
    music.setScore(CHASE);
    run(3);
    const now = ctx.currentTime;
    // As WASTED in a chase: the wanted level clears first (dropScore), then the music goes off.
    music.dropScore();
    music.setMode('off');
    const fade = param(inner<GainNode>(music, 'fadeGain'));
    expect(fade.at(now + 0.6)).toBeLessThan(0.05);
    expect(fade.at(now + 2)).toBeLessThan(1e-3);
    music.dispose();
  });
});

describe('the chase coming in and going out on the bar line (no fade)', () => {
  /** Run until the bass oscillator changes shape; returns the context time it did. */
  function untilReshaped(p: ReturnType<typeof player>): number {
    const bassA = inner<FakeNode>(p.music, 'bassA');
    const seen = bassA.shapes.length;
    let guard = 0;
    while (bassA.shapes.length === seen && guard++ < 1000) p.run(0.025);
    expect(bassA.shapes.length).toBeGreaterThan(seen);
    return bassA.shapes[seen][0];
  }

  it("lets the old station's bass and lead go before reshaping them (the shapes and drive change up to 0.12 s early)", () => {
    // In over SIDEWAYS (its 808 ends the bar on a tie), and out of the calm-down into it.
    const p = player(SIDEWAYS);
    p.music.setMode('game');
    p.music.setIntensity(3);
    p.run(6);
    p.music.setScore(CHASE);
    const bass = param(inner<GainNode>(p.music, 'bassAmp'));
    const lead = param(inner<GainNode>(p.music, 'leadAmp'));
    let at = untilReshaped(p);
    expect(p.music.arranger.upcomingStation).toBe(CHASE_STATION);
    expect(bass.at(at)).toBeGreaterThan(0.01); // the 808 is sounding as it's reshaped...
    expect(bass.at(at + 0.04)).toBeLessThan(bass.at(at) * 0.02); // ...and let go there, not carried on as a saw
    p.run(6);
    expect(p.music.playingScore).toBe(true);
    p.music.endScore();
    let guard = 0;
    while (p.music.playingScore && guard++ < 1000) {
      at = untilReshaped(p);
      if (p.music.arranger.upcomingStation === SIDEWAYS || !p.music.playingScore) break;
    }
    expect(p.music.arranger.radio).toBe(SIDEWAYS);
    expect(Math.max(bass.at(at), lead.at(at))).toBeGreaterThan(0.005); // the calm-down's last notes are still going
    for (const g of [bass, lead]) expect(g.at(at + 0.04)).toBeLessThanOrEqual(g.at(at) * 0.02 + 1e-6);
    p.music.dispose();
  });

  it('scales the drive as it patches it in, not later at the bar line (nothing hits the shaper at full gain)', () => {
    const p = player(STATIONS[0]);
    p.music.setMode('game');
    p.run(2);
    expect(STATIONS[0].sound.drive ?? 0).toBe(0);
    p.music.setScore(CHASE);
    p.run(4);
    p.music.tune(STATIONS.indexOf(SIDEWAYS)); // quietly, for after the chase
    p.music.endScore();
    p.run(8);
    expect(p.music.station).toBe(SIDEWAYS);
    const bassAmp = inner<FakeNode>(p.music, 'bassAmp');
    const pre = inner<GainNode>(p.music, 'drivePre');
    const post = inner<GainNode>(p.music, 'drivePost');
    const patched = bassAmp.links.find(([, d]) => d === pre);
    expect(patched).toBeDefined();
    const [when] = patched!;
    // Unscaled, both are 1; scaled for the 808 the pre-gain is ~5.7.
    expect(Math.abs(param(pre).at(when) - 1)).toBeGreaterThan(0.5);
    expect(param(pre).at(when)).toBeCloseTo(param(pre).at(when + 1), 9);
    expect(param(post).at(when)).toBeCloseTo(param(post).at(when + 1), 9);
    p.music.dispose();
  });
});

describe("a chase that ends while the music can't be heard", () => {
  it('is gone when the music comes back: no stale calm-down at full level', () => {
    // Ended while asleep (the volume at zero).
    const a = player(STATIONS[0]);
    a.music.setMode('game');
    a.music.setScore(CHASE);
    a.run(4);
    a.music.setDormant(true);
    a.music.endScore();
    a.run(120);
    expect(a.music.playingScore).toBe(false);
    a.music.setDormant(false);
    a.run(0.3);
    expect(a.music.station).toBe(STATIONS[0]);
    expect(a.music.arranger.section).not.toBe('outro');
    a.music.dispose();
    // Ended just before it went to sleep (its outro not started yet).
    const b = player(STATIONS[0]);
    b.music.setMode('game');
    b.music.setScore(CHASE);
    b.run(4);
    b.music.endScore();
    b.music.setDormant(true);
    b.run(60);
    b.music.setDormant(false);
    b.run(0.3);
    expect(b.music.station).toBe(STATIONS[0]);
    expect(b.music.arranger.score).toBeNull();
    b.music.dispose();
  });
});

describe('the arranger at GO and into the score', () => {
  it("GO drops in on a fresh bass attack: no slide in from the old phrase's tie, no arp resting under its lead", () => {
    // SIDEWAYS ties its 808 into the bar line ('x-----x---x--~o~'): GO anywhere in the tie.
    for (let k = 0; k < STEPS_PER_BAR; k++) {
      const a = new Arranger(SIDEWAYS);
      a.setIntensity(3);
      steps(a, 6 * STEPS_PER_BAR + k);
      a.dropIn(4);
      expect((a as unknown as Record<string, number>).leadLeft).toBe(0);
      const bass = steps(a, STEPS_PER_BAR)
        .flat()
        .find((e) => e.part === 'bass');
      expect(bass?.slide, `GO at step ${k}`).toBe(false);
    }
  });

  it('rises into the score once, even in a bar that already rises into its next section', () => {
    // The bars whose downbeat books a riser of their own.
    const probe = new Arranger(STATIONS[0]);
    probe.setIntensity(1);
    const rising: number[] = [];
    for (let bar = 0; bar < 24; bar++) if (steps(probe, STEPS_PER_BAR)[0].some((e) => e.part === 'riser')) rising.push(bar);
    expect(rising.length).toBeGreaterThan(0);
    for (const bar of rising.slice(0, 3)) {
      for (let k = 1; k <= 12; k++) {
        const a = new Arranger(STATIONS[0]);
        a.setIntensity(1);
        steps(a, bar * STEPS_PER_BAR);
        const head = steps(a, k);
        a.setScore(CHASE);
        const rest = steps(a, STEPS_PER_BAR - k);
        const risers = [...head, ...rest].flat().filter((e) => e.part === 'riser');
        expect(
          risers.map((e) => e.len),
          `bar ${bar}, asked at step ${k}`,
        ).toEqual([STEPS_PER_BAR]);
        expect(steps(a, 1)[0].some((e) => e.part === 'crash')).toBe(true);
        expect(a.station).toBe(CHASE_STATION);
      }
    }
  });
});
