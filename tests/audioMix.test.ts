import { describe, expect, it } from 'vitest';
import {
  PAN_LIMIT,
  airCutoff,
  distanceGain,
  dopplerCents,
  panFor,
  smoothstep,
  volumeToGain,
  wetFor,
} from '../src/audio/mix';
import { RateGate, VoiceLimiter } from '../src/audio/voices';

describe('audio mixing math', () => {
  it('maps sliders to gain on a squared curve, safely', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBe(0);
  });

  it('attenuates with distance: full up close, quiet but not silent far away, cut past max', () => {
    const f = { ref: 10, max: 150, floor: 0.08 };
    expect(distanceGain(0, f)).toBe(1);
    expect(distanceGain(10, f)).toBe(1);
    expect(distanceGain(20, f)).toBeCloseTo(0.5);
    expect(distanceGain(40, f)).toBeCloseTo(0.25);
    // Inverse distance would be 0.067 at 150 m; the floor keeps it audible.
    expect(distanceGain(149, f)).toBe(0.08);
    expect(distanceGain(151, f)).toBe(0);
    let last = 2;
    for (let d = 0; d <= 150; d += 5) {
      const g = distanceGain(d, f);
      expect(g).toBeLessThanOrEqual(last);
      last = g;
    }
  });

  it('pans by horizontal offset (screen-right is +X), never hard into one ear', () => {
    expect(panFor(0)).toBe(0);
    expect(panFor(13)).toBeGreaterThan(0);
    expect(panFor(-13)).toBeCloseTo(-panFor(13));
    expect(panFor(500)).toBe(PAN_LIMIT);
    expect(panFor(-500)).toBe(-PAN_LIMIT);
    expect(PAN_LIMIT).toBeLessThan(1);
  });

  it('muffles distant sounds (air absorption) and makes them wetter', () => {
    expect(airCutoff(0)).toBe(20000);
    expect(airCutoff(50)).toBeLessThan(airCutoff(20));
    expect(airCutoff(1000)).toBe(450);
    expect(wetFor(0.4, 100)).toBeGreaterThan(wetFor(0.4, 5));
    expect(wetFor(0.9, 1000)).toBe(1);
  });

  it('shifts pitch up for approaching sources and down for receding ones', () => {
    expect(dopplerCents(0)).toBe(0);
    const approaching = dopplerCents(-30);
    const receding = dopplerCents(30);
    expect(approaching).toBeGreaterThan(100); // ~ +1.5 semitones at 30 m/s
    expect(receding).toBeLessThan(-100);
    expect(dopplerCents(-5000)).toBeLessThanOrEqual(300);
  });

  it('smoothsteps', () => {
    expect(smoothstep(2, 4, 1)).toBe(0);
    expect(smoothstep(2, 4, 3)).toBeCloseTo(0.5);
    expect(smoothstep(2, 4, 9)).toBe(1);
  });
});

describe('voice limiting', () => {
  const kill = (stolen: string[], now: number) => (v: string) => {
    stolen.push(v);
    return now + 0.05;
  };

  it('caps a category by stealing its oldest voice', () => {
    const lim = new VoiceLimiter<string>({ boom: 3 }, 40);
    const stolen: string[] = [];
    for (let i = 0; i < 5; i++) lim.add('boom', `b${i}`, i * 0.01, 3, kill(stolen, i * 0.01));
    expect(stolen).toEqual(['b0', 'b1']);
    expect(lim.count('boom')).toBe(3);
    // Stolen voices stay tracked (fading out) until reaped.
    expect(lim.size).toBe(5);
  });

  it('a 30-explosion chain reaction never holds more than the cap', () => {
    const lim = new VoiceLimiter<number>({ explosion: 4 }, 40);
    let stolen = 0;
    for (let i = 0; i < 30; i++) {
      lim.add('explosion', i, 0, 2.5, () => (stolen++, 0.08));
      expect(lim.count('explosion')).toBeLessThanOrEqual(4);
    }
    expect(stolen).toBe(26);
    const released: number[] = [];
    lim.reap(0.1, (v) => released.push(v));
    expect(released.length).toBe(26);
    expect(lim.size).toBe(4);
  });

  it('enforces a global cap across categories', () => {
    const lim = new VoiceLimiter<string>({}, 5, 10);
    const stolen: string[] = [];
    for (let i = 0; i < 8; i++) lim.add(i % 2 ? 'a' : 'b', `v${i}`, i, 100, kill(stolen, i));
    expect(lim.count()).toBe(5);
    expect(stolen).toEqual(['v0', 'v1', 'v2']);
  });

  it('reaps finished voices and only those', () => {
    const lim = new VoiceLimiter<string>({}, 40);
    lim.add('x', 'short', 0, 0.2, () => 0);
    lim.add('x', 'long', 0, 2, () => 0);
    const released: string[] = [];
    lim.reap(0.5, (v) => released.push(v));
    expect(released).toEqual(['short']);
    expect(lim.size).toBe(1);
    lim.clear((v) => released.push(v));
    expect(released).toEqual(['short', 'long']);
    expect(lim.size).toBe(0);
  });

  it('rate-gates bursts of identical events', () => {
    const gate = new RateGate();
    let allowed = 0;
    for (let i = 0; i < 30; i++) if (gate.allow('boom', 1.0, 0.06, 2)) allowed++;
    expect(allowed).toBe(2);
    expect(gate.allow('boom', 1.03, 0.06, 2)).toBe(false);
    expect(gate.allow('boom', 1.07, 0.06, 2)).toBe(true);
    expect(gate.allow('other', 1.0, 0.06, 2)).toBe(true);
  });
});
