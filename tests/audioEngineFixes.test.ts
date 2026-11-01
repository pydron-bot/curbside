import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHASE, CHASE_STATION } from '../src/audio/music/chase';
import { MusicPlayer } from '../src/audio/music/musicPlayer';
import { Arranger, STEPS_PER_BAR, type NoteEvent } from '../src/audio/music/sequencer';
import { STATIONS, type Station } from '../src/audio/music/stations';
import { THEME } from '../src/audio/music/themes';
import { kitKey, type KitPart } from '../src/audio/music/drumKit';
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

/** What a note gives at `t`: its out stage times its envelope (the loudest of its automated inner gains). */
function heard(v: Voice, t: number): number {
  let env = -1;
  for (const n of v.nodes) {
    const g = (n as unknown as FakeNode).gain;
    if (n !== v.out && g.events.length > 0) env = Math.max(env, g.at(t));
  }
  return param(v.out).at(t) * (env < 0 ? 1 : env);
}

/** Voice.kill's fade. */
const KILL_TAU = 0.012;

/**
 * Samples what each voice gives over the 80 ms a cut at `at` leaves it,
 * before the cut. After it, `worst()` is the most any of them gives over
 * that same envelope faded along kill's curve (1: never more; a ramp still
 * to come on its out stage swells it back up), and `rising` how many were
 * still swelling at the cut (pads in their attack, risers).
 */
function watchCut(voices: Voice[], at: number) {
  const ts = Array.from({ length: 41 }, (_, i) => at + i * 0.002);
  const uncut = voices.map((v) => ts.map((t) => heard(v, t)));
  const rising = voices.filter((_, i) => Math.max(...uncut[i]) > uncut[i][0] * 1.05 + 1e-4);
  const worst = () => {
    let w = { ratio: 1, info: '' };
    voices.forEach((v, i) =>
      ts.forEach((t, k) => {
        if (t >= v.end) return; // its sources have stopped
        const allowed = uncut[i][k] * Math.exp(-(t - at) / KILL_TAU) + 1e-6;
        const ratio = heard(v, t) / allowed;
        if (ratio > w.ratio) w = { ratio, info: `${v.nodes.length}-node voice from ${((v.t - at) * 1000).toFixed(0)} ms, at +${((t - at) * 1000).toFixed(0)} ms` };
      }),
    );
    return w;
  };
  return { ts, uncut, rising, worst };
}

const LOWTIDE = STATIONS.find((s) => s.sound.pad === 'soft')!;
const INSERTCOIN = STATIONS.find((s) => s.sound.pad === 'chip')!;

/** Run until the arranger is about to book `step` of bar `bar`. */
function runTo(p: ReturnType<typeof player>, bar: number, step: number): void {
  let guard = 0;
  while (!(p.music.arranger.bar === bar && p.music.arranger.step === step) && guard++ < 4000) p.run(0.005, 0.005);
  expect(guard).toBeLessThan(4000);
}

describe('switching what plays', () => {
  it("a retune (or the theme giving way, or the chase dropped) kills the old phrase under its fade, so nothing of it swells back up with it; the static stays", () => {
    // Every step of a bar, for pads still in their attack at the cut; bar 3 is a song's intro's last, which rises.
    const cases = [
      ...[STATIONS[0], LOWTIDE, INSERTCOIN].map((s) => ({ how: 'station' as const, station: s, bar: 3 })),
      { how: 'theme' as const, station: STATIONS[0], bar: 1 },
      { how: 'score' as const, station: STATIONS[0], bar: 1 },
    ];
    const swelling = { pad: 0, riser: 0 };
    for (const { how, station, bar } of cases) {
      for (let k = 0; k < STEPS_PER_BAR; k++) {
        const label = `${how} ${station.id} at step ${k}`;
        const p = player(station);
        const { ctx, music, notes } = p;
        music.setTheme(THEME);
        music.setMode(how === 'theme' ? 'menu' : 'game');
        if (how === 'score') music.setScore(CHASE);
        music.setIntensity(2);
        runTo(p, bar, k);
        const now = ctx.currentTime;
        const old = [...notes()];
        if (station.sound.pad !== 'chip') expect(old.some((v) => v.end > now + 1), label).toBe(true); // a pad holds on for seconds
        const cut = watchCut(old, now + 0.28);
        for (const v of cut.rising) {
          const dest = (v.out as unknown as FakeNode).links[0][1];
          if (dest === inner(music, 'padLp')) swelling.pad++;
          if (dest === inner(music, 'mix')) swelling.riser++;
        }
        if (how === 'theme') music.setMode('game');
        else if (how === 'score') music.dropScore();
        else music.setStation(2);
        // Gone before the fade comes back up at now + 0.3...
        for (const v of old) {
          expect(v.end, label).toBeLessThanOrEqual(now + 0.36 + 1e-9);
          for (const s of v.sources) expect((s as unknown as FakeNode).stopped, label).toBeLessThanOrEqual(now + 0.36 + 1e-9);
        }
        // ...and silent as it does: every old voice only fades from the cut, so under the fade it's next to nothing.
        const w = cut.worst();
        expect(w.ratio, `${label}: ${w.info}`).toBeLessThan(1.000001);
        const fade = param(inner<GainNode>(music, 'fadeGain'));
        old.forEach((v, i) => {
          const loudest = Math.max(1e-6, ...cut.uncut[i]);
          cut.ts.forEach((t) => {
            if (t < v.end) expect(fade.at(t) * heard(v, t), label).toBeLessThan(0.03 * loudest);
          });
        });
        if (how === 'station') expect(notes().some((v) => v.t === now && v.end >= now + 0.34)).toBe(true);
        music.dispose();
      }
    }
    // Not vacuous: pads in their attack and risers were swelling at some of these cuts.
    expect(swelling.pad).toBeGreaterThan(0);
    expect(swelling.riser).toBeGreaterThan(0);
  });

  it('GO cuts the old phrase dead: a note it booked to start just after GO never sounds, and nothing still swelling comes back up', () => {
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
    // GO at every step of a riser bar, on each kind of pad: what was ringing only fades from `when`, along kill's curve.
    let swelling = 0;
    for (const station of [STATIONS[0], LOWTIDE, INSERTCOIN]) {
      for (let k = 0; k < STEPS_PER_BAR; k++) {
        const p = player(station);
        p.music.setMode('game');
        p.music.setIntensity(4);
        runTo(p, 3, k);
        const at = p.ctx.currentTime + 0.03;
        const old = [...p.notes()];
        const cut = watchCut(old, at);
        swelling += cut.rising.length;
        p.music.dropIn(at, 4);
        const w = cut.worst();
        expect(w.ratio, `GO over ${station.id} at step ${k}: ${w.info}`).toBeLessThan(1.000001);
        p.music.dispose();
      }
    }
    expect(swelling).toBeGreaterThan(0);
  });

  it("keeps every note's envelope off its out stage, which only a cut (kill) automates", () => {
    // Pumped like the game: every recipe each station plays, the live drums too (no kit renders here), and the static.
    for (const station of [...STATIONS, CHASE_STATION]) {
      const { music, run, notes } = player(station);
      music.setMode('game');
      const seen = new Set<Voice>();
      for (const level of [1, 3, 5]) {
        music.setIntensity(level);
        for (let i = 0; i < 480; i++) {
          run(0.025);
          for (const v of notes()) seen.add(v);
        }
      }
      const before = new Set(notes());
      const check = (voices: Iterable<Voice>) => {
        for (const v of voices) expect(param(v.out).events, `${station.id}: the note at ${v.t.toFixed(3)} s`).toEqual([]);
      };
      check(seen);
      expect(seen.size).toBeGreaterThan(100);
      music.nextStation(); // the static
      const fresh = notes().filter((v) => !before.has(v));
      expect(fresh.length).toBeGreaterThan(0);
      check(fresh);
      music.dispose();
    }
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

describe('drum kits', () => {
  type Kit = Record<KitPart, AudioBuffer[]>;
  const kits = (music: MusicPlayer) => inner<Map<string, Kit>>(music, 'kits');
  /** Every take rendered so far (a shared crash counted once). */
  const takes = (music: MusicPlayer) => new Set([...kits(music).values()].flatMap((k) => Object.values(k).flat())).size;
  const complete = (k: Kit) => k.kick.length === 3 && k.snare.length === 3 && k.hat.length === 3 && k.openHat.length === 2 && k.crash.length === 1;
  const idle: Array<() => void> = [];
  const fireIdle = () => idle.splice(0).forEach((fn) => fn());

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    idle.length = 0;
  });

  it('render the crash take once per context and share it (the 14-24 ms job, never mid-play again)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { music } = player(STATIONS[0]);
    for (const s of STATIONS) music.warmKit(s.sound);
    vi.runAllTimers();
    const all = [...kits(music).values()];
    expect(all.length).toBeGreaterThan(4);
    for (const k of all) expect(complete(k)).toBe(true);
    const chip = kits(music).get([...kits(music).keys()].find((key) => key.includes('chip'))!)!;
    const plain = all.filter((k) => k !== chip);
    for (const k of plain) expect(k.crash).toBe(plain[0].crash);
    expect(chip.crash).not.toBe(plain[0].crash);
    music.dispose();
  });

  it('warm behind the title a take per idle slot: never while a kit that plays is rendering, not once the game is on, not after dispose', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('requestIdleCallback', (fn: () => void) => idle.push(fn));
    const { music } = player(STATIONS[0]); // its kit renders at once (between frames)
    music.setMode('menu');
    music.warmKits([...STATIONS, CHASE_STATION].map((s) => s.sound));
    expect(takes(music)).toBe(0);
    fireIdle(); // the radio's kit is still rendering: nothing warms
    expect(idle).toHaveLength(0);
    vi.runAllTimers();
    const booted = takes(music);
    expect(complete(kits(music).values().next().value!)).toBe(true);
    // Now a take per idle slot.
    for (let n = 1; n <= 3; n++) {
      expect(idle).toHaveLength(1);
      fireIdle();
      expect(takes(music)).toBe(booted + n);
    }
    // A kit wanted now goes first; warming waits for it.
    music.warmKit(SIDEWAYS.sound);
    const sideways = kits(music).get(kitKey(SIDEWAYS.sound))!;
    expect(sideways.kick).toHaveLength(0);
    fireIdle();
    expect(takes(music)).toBe(booted + 3);
    vi.runAllTimers();
    expect(complete(sideways)).toBe(true);
    // The game on: warming pauses; back on the title it carries on.
    music.setMode('game');
    const playing = takes(music);
    fireIdle();
    expect(takes(music)).toBe(playing);
    expect(idle).toHaveLength(0);
    music.setMode('menu');
    fireIdle();
    expect(takes(music)).toBe(playing + 1);
    // Disposed: nothing more.
    music.dispose();
    fireIdle();
    vi.runAllTimers();
    expect(takes(music)).toBe(playing + 1);
    expect(idle).toHaveLength(0);
  });

  it('warm every kit on the title without requestIdleCallback (Safari) too, a take per timer slot', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { music } = player(STATIONS[0]);
    music.setMode('menu');
    music.warmKits([...STATIONS, CHASE_STATION].map((s) => s.sound));
    vi.runAllTimers();
    expect(kits(music).size).toBeGreaterThanOrEqual(7);
    for (const k of kits(music).values()) expect(complete(k)).toBe(true);
    // The chase's kit is among them: nothing left to render as it starts.
    music.warmKit(CHASE_STATION.sound);
    expect(vi.getTimerCount()).toBe(0);
    music.dispose();
  });
});
