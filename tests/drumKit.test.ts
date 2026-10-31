import { describe, expect, it } from 'vitest';
import { KIT_LEVEL, TAKES, kitJobs, renderKit, type KitPart } from '../src/audio/music/drumKit';
import { STATIONS } from '../src/audio/music/stations';

const RATE = 48000;
const peak = (b: Float32Array) => b.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe('the radio drum kit', () => {
  it('renders every hit for every station: finite, at its level, ending in silence', () => {
    for (const s of STATIONS) {
      const kit = renderKit(s.sound, RATE);
      for (const part of Object.keys(KIT_LEVEL) as KitPart[]) {
        expect(kit[part], `${s.id} ${part}`).toHaveLength(TAKES[part]);
        for (const take of kit[part]) {
          expect(take.length).toBeGreaterThan(RATE * 0.05);
          expect(take.every(Number.isFinite), `${s.id} ${part}`).toBe(true);
          expect(peak(take)).toBeLessThanOrEqual(KIT_LEVEL[part] + 1e-6);
          expect(peak(take)).toBeGreaterThan(KIT_LEVEL[part] * 0.9);
          expect(Math.abs(take[take.length - 1])).toBeLessThan(1e-3);
        }
      }
    }
  });

  it('is the same every time, and its takes differ from each other', () => {
    const s = STATIONS[0].sound;
    const a = renderKit(s, RATE);
    const b = renderKit(s, RATE);
    expect(Array.from(a.kick[1].slice(0, 400))).toEqual(Array.from(b.kick[1].slice(0, 400)));
    const diff = (x: Float32Array, y: Float32Array) => {
      let d = 0;
      for (let i = 0; i < Math.min(x.length, y.length); i++) d += Math.abs(x[i] - y[i]);
      return d;
    };
    expect(diff(a.snare[0], a.snare[1])).toBeGreaterThan(1);
    expect(diff(a.hat[0], a.hat[2])).toBeGreaterThan(0.1);
  });

  it('the kick sits low and the hats high (energy below / above 1 kHz)', () => {
    const kit = renderKit(STATIONS[0].sound, RATE);
    // Zero crossings per second: a cheap brightness measure.
    const zc = (b: Float32Array) => {
      let n = 0;
      for (let i = 1; i < b.length; i++) if (b[i - 1] < 0 !== b[i] < 0) n++;
      return (n / b.length) * RATE;
    };
    expect(zc(kit.kick[0].slice(Math.round(RATE * 0.03), Math.round(RATE * 0.2)))).toBeLessThan(400);
    expect(zc(kit.hat[0])).toBeGreaterThan(5000);
  });

  it('comes as small jobs (a take each), so it renders between frames', () => {
    const s = STATIONS[0].sound;
    renderKit(s, RATE); // warm up
    let worst = 0;
    for (const job of kitJobs(s, RATE)) {
      const t0 = performance.now();
      job.run();
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(25);
  });
});
