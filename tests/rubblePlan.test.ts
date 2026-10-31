import { afterEach, describe, expect, it, vi } from 'vitest';
import { STYLE, chunkCount } from '../src/render/destructionStyle';
import {
  ChunkPlan,
  EVICT_SINK,
  FREE,
  LIVE,
  RubbleClock,
  RubbleSlots,
  SINKING,
  TONE_SCORCHED,
  planChunks,
  type BreachSite,
} from '../src/render/rubblePlan';
import type { Rect } from '../src/world/city';

afterEach(() => vi.restoreAllMocks());

/** A breach on each side of a building with its face at the origin. */
const SIDES: Array<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function site(nx: number, nz: number, strength = 1, seed = 0.42): BreachSite {
  return { x: 10, y: 1.2, z: 20, nx, nz, radius: 1.5, strength, seed };
}

describe('planChunks', () => {
  it('throws as many chunks as the style says for the strength', () => {
    for (const style of ['phone', 'desktop'] as const) {
      for (const s of [0, 0.3, 0.7, 1]) {
        expect(planChunks(site(0, 1, s), STYLE[style], new ChunkPlan()).count).toBe(chunkCount(STYLE[style], s));
      }
    }
    expect(planChunks(site(0, 1), STYLE.low, new ChunkPlan()).count).toBe(0);
  });

  it('every chunk starts outside the facade, above the ground, the right size, flying outward', () => {
    for (const style of ['phone', 'desktop'] as const) {
      const b = STYLE[style];
      for (const [nx, nz] of SIDES) {
        const s = site(nx, nz);
        const p = planChunks(s, b, new ChunkPlan());
        for (let i = 0; i < p.count; i++) {
          const diag = Math.sqrt(p.hx[i] ** 2 + p.hy[i] ** 2 + p.hz[i] ** 2);
          const out = (p.px[i] - s.x) * nx + (p.pz[i] - s.z) * nz;
          expect(out).toBeGreaterThanOrEqual(diag + 0.05 - 1e-5);
          expect(p.py[i]).toBeGreaterThanOrEqual(p.hy[i] + 0.02 - 1e-5);
          for (const h of [p.hx[i], p.hz[i]]) {
            expect(h).toBeGreaterThanOrEqual(b.halfMin * 0.5 - 1e-6);
            expect(h).toBeLessThanOrEqual(b.halfMax * 1.3 + 1e-6);
          }
          expect(p.hy[i]).toBeGreaterThanOrEqual(b.halfMin * 0.4 - 1e-6);
          expect(p.hy[i]).toBeLessThanOrEqual(b.halfMax + 1e-6);
          expect(p.vx[i] * nx + p.vz[i] * nz).toBeGreaterThan(0);
          expect(p.vy[i]).toBeGreaterThan(0);
          const q = Math.hypot(p.qx[i], p.qy[i], p.qz[i], p.qw[i]);
          expect(q).toBeCloseTo(1, 5);
          expect(p.shade[i]).toBeGreaterThanOrEqual(0.35);
          expect(p.shade[i]).toBeLessThanOrEqual(0.85);
        }
      }
    }
  });

  it('most chunks slump to the foot of the wall, a few fly well out, and the heavy ones hop low', () => {
    for (const style of ['phone', 'desktop'] as const) {
      const b = STYLE[style];
      let all = 0;
      let slow = 0;
      let fliers = 0;
      let lowStart = 0;
      let maxUp = 0;
      let shards = 0;
      let plates = 0;
      for (let k = 0; k < 60; k++) {
        const s = { ...site(0, 1, 1, (k + 0.5) / 60), y: 1.8 };
        const p = planChunks(s, b, new ChunkPlan());
        for (let i = 0; i < p.count; i++) {
          all++;
          const out = p.vz[i];
          if (out < 1) slow++;
          if (out > 4) fliers++;
          if (p.py[i] < s.y) lowStart++;
          maxUp = Math.max(maxUp, p.vy[i]);
          const long = Math.max(p.hx[i], p.hz[i]);
          if (long > 2.2 * Math.min(p.hx[i], p.hz[i])) shards++;
          if (p.hy[i] < 0.5 * Math.min(p.hx[i], p.hz[i])) plates++;
        }
      }
      // ~60% slump (start low, leave the wall at under 1 m/s), plus the slowest fliers.
      expect(slow / all, style).toBeGreaterThan(0.55);
      expect(slow / all, style).toBeLessThan(0.85);
      expect(lowStart / all, style).toBeGreaterThan(0.6);
      expect(fliers / all, style).toBeGreaterThan(0.05);
      expect(fliers / all, style).toBeLessThan(0.3);
      expect(shards / all, style).toBeGreaterThan(0.1);
      expect(plates / all, style).toBeGreaterThan(0.1);
      // The phone's big chunks never hop more than 2 m/s; desktop's small ones up to 4.
      if (style === 'phone') expect(maxUp).toBeLessThanOrEqual(2);
      else expect(maxUp).toBeGreaterThan(2);
    }
  });

  it('a crater over an awning starts every chunk past it', () => {
    for (const style of ['phone', 'desktop'] as const) {
      const s = { ...site(0, 1), y: 3.6, clear: 1.2 };
      const p = planChunks(s, STYLE[style], new ChunkPlan());
      for (let i = 0; i < p.count; i++) {
        const diag = Math.sqrt(p.hx[i] ** 2 + p.hy[i] ** 2 + p.hz[i] ** 2);
        expect(p.pz[i] - s.z).toBeGreaterThanOrEqual(1.2 + diag + 0.05 - 1e-5);
      }
    }
  });

  it('chunks born near the blast are scorched', () => {
    const p = planChunks(site(0, 1), STYLE.desktop, new ChunkPlan());
    let scorched = 0;
    for (let i = 0; i < p.count; i++) if (p.tone[i] === TONE_SCORCHED) scorched++;
    expect(scorched).toBeGreaterThan(0);
    expect(scorched).toBeLessThan(p.count);
  });

  it('is deterministic for a seed, different across seeds, and never calls Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    const a = planChunks(site(0, 1, 0.8, 0.1), STYLE.desktop, new ChunkPlan());
    const b = planChunks(site(0, 1, 0.8, 0.1), STYLE.desktop, new ChunkPlan());
    const c = planChunks(site(0, 1, 0.8, 0.7), STYLE.desktop, new ChunkPlan());
    expect(Array.from(a.px)).toEqual(Array.from(b.px));
    expect(Array.from(a.vy)).toEqual(Array.from(b.vy));
    expect(Array.from(a.px)).not.toEqual(Array.from(c.px));
    expect(random).not.toHaveBeenCalled();
  });

  it('drops chunks that would start inside a building across a narrow alley', () => {
    // South face at z = 20; the neighbour's north face is 0.4 m across.
    const neighbour: Rect = { minX: 0, minZ: 20.4, maxX: 30, maxZ: 30 };
    const s = site(0, 1);
    const free = planChunks(s, STYLE.desktop, new ChunkPlan());
    const p = planChunks(s, STYLE.desktop, new ChunkPlan(), [neighbour]);
    expect(p.count).toBeLessThan(free.count);
    for (let i = 0; i < p.count; i++) {
      const diag = Math.sqrt(p.hx[i] ** 2 + p.hy[i] ** 2 + p.hz[i] ** 2);
      expect(neighbour.minZ - p.pz[i]).toBeGreaterThanOrEqual(diag + 0.05 - 1e-5);
    }
  });
});

describe('RubbleSlots', () => {
  const phone = { maxLive: STYLE.phone.maxLive, life: STYLE.phone.life, sink: STYLE.phone.sink };
  const desktop = { maxLive: STYLE.desktop.maxLive, life: STYLE.desktop.life, sink: STYLE.desktop.sink };

  function slots(capacity = 256) {
    const removed: number[] = [];
    return { s: new RubbleSlots(capacity, (i) => removed.push(i)), removed };
  }

  it('never holds more live chunks than the style allows', () => {
    const { s, removed } = slots();
    const out = new Int32Array(64);
    let now = 0;
    for (let k = 0; k < 20; k++) {
      s.claim(7, phone, (now += 0.5), out);
      expect(s.live).toBeLessThanOrEqual(phone.maxLive);
    }
    expect(s.live).toBe(phone.maxLive);
    expect(removed.length).toBeGreaterThan(0);
    expect(s.claim(500, phone, now, out)).toBe(phone.maxLive);
  });

  it('evicts the oldest off-screen chunk first, then the oldest; evicted chunks sink', () => {
    const { s, removed } = slots(8);
    const out = new Int32Array(8);
    const b = { maxLive: 4, life: 100, sink: 0 };
    s.claim(1, b, 1, out); // slot 0, oldest
    s.claim(1, b, 2, out); // slot 1
    s.claim(1, b, 3, out); // slot 2
    s.claim(1, b, 4, out); // slot 3
    s.seen[0] = 1;
    s.seen[1] = 0; // off-screen
    s.seen[2] = 0;
    s.seen[3] = 1;
    s.claim(1, b, 5, out);
    expect(removed).toEqual([1]);
    expect(s.state[1]).toBe(SINKING);
    s.seen[2] = 1;
    s.claim(1, b, 6, out);
    expect(removed).toEqual([1, 0]); // everything on screen: the oldest
    expect(s.live).toBe(4);
    expect(s.sinking).toBe(2);
  });

  it('with no free slot left, the most-sunk slot is reclaimed', () => {
    const { s } = slots(4);
    const out = new Int32Array(4);
    const b = { maxLive: 3, life: 100, sink: 0 };
    s.claim(3, b, 0, out); // slots 0-2
    s.claim(2, b, 1, out); // evicts 0 and 1; takes free slot 3, then reclaims sinking slot 0
    expect(Array.from(out.slice(0, 2))).toEqual([3, 0]);
    expect(s.live).toBe(3);
    expect(s.sinking).toBe(1);
    s.claim(1, b, 1.3, out); // evicts slot 2; no free slot: slot 1 (sinking since 1) is further gone than slot 2
    expect(out[0]).toBe(1);
    expect(s.state[2]).toBe(SINKING);
    expect(s.state.filter((v) => v === FREE).length + s.live + s.sinking).toBe(4);
  });

  it('a style drop (a desktop pile meets a phone breach) evicts only as many as the breach brings', () => {
    const { s, removed } = slots();
    const out = new Int32Array(64);
    for (let k = 0; k < 5; k++) s.claim(34, desktop, k, out);
    s.claim(30, desktop, 5, out);
    expect(s.live).toBe(desktop.maxLive);
    expect(removed.length).toBe(0);
    const firstBreach = new Set(Array.from({ length: 34 }, (_, i) => i));
    expect(s.claim(7, phone, 10, out)).toBe(7);
    expect(removed.length).toBe(7);
    for (const i of removed) expect(firstBreach.has(i)).toBe(true); // the oldest
    expect(s.live).toBe(desktop.maxLive);
    expect(s.sinking).toBe(7);
    s.claim(7, phone, 11, out);
    expect(removed.length).toBe(14);
    expect(s.live).toBe(desktop.maxLive);
    // Within the budget again, a claim evicts down to it as usual.
    const { s: t } = slots();
    t.claim(30, phone, 0, out);
    t.claim(7, phone, 1, out);
    expect(t.live).toBe(phone.maxLive);
    expect(t.sinking).toBe(1);
  });

  it('phone life: sinks at 7 s, gone at 7.6 s', () => {
    const { s, removed } = slots();
    const out = new Int32Array(8);
    const n = s.claim(5, phone, 10, out);
    expect(n).toBe(5);
    s.tick(16.9);
    expect(s.live).toBe(5);
    s.tick(17);
    expect(s.live).toBe(0);
    expect(s.sinking).toBe(5);
    expect(removed.length).toBe(5);
    expect(s.sunk(out[0], 17.3)).toBeCloseTo(0.5, 5);
    s.tick(17.59);
    expect(s.sinking).toBe(5);
    s.tick(17.6);
    expect(s.sinking).toBe(0);
    expect(s.state[out[0]]).toBe(FREE);
  });

  it('desktop: past 120 s a chunk is only cleaned up once out of view', () => {
    const { s, removed } = slots();
    const out = new Int32Array(8);
    s.claim(3, desktop, 0, out);
    s.tick(130);
    expect(s.live).toBe(3);
    s.seen[out[1]] = 0;
    s.tick(130.25);
    expect(s.live).toBe(2);
    expect(s.state[out[1]]).toBe(FREE);
    expect(removed).toEqual([out[1]]);
  });

  it('release gives an unused slot back; sinkAll sinks everything; clear removes every body', () => {
    const { s, removed } = slots();
    const out = new Int32Array(8);
    s.claim(4, desktop, 0, out);
    s.release(out[3]);
    expect(s.live).toBe(3);
    s.sinkAll(1);
    expect(s.live).toBe(0);
    expect(s.sinking).toBe(3);
    expect(s.sunk(out[0], 1 + EVICT_SINK)).toBe(1);
    s.claim(2, desktop, 2, out);
    removed.length = 0;
    s.clear();
    expect(removed.length).toBe(2);
    expect(s.live + s.sinking).toBe(0);
    expect(s.state.every((v) => v === FREE)).toBe(true);
    expect(LIVE).not.toBe(FREE);
  });
});

describe('RubbleClock', () => {
  it('turns sim seconds into whole 1/60 steps', () => {
    const c = new RubbleClock();
    expect(c.advance(1 / 60)).toBe(1);
    expect(c.advance(1 / 120)).toBe(0);
    expect(c.advance(1 / 120)).toBe(1);
    expect(c.time).toBeCloseTo(2 / 60, 9);
  });

  it('caps at two steps a frame and drops the backlog', () => {
    const c = new RubbleClock();
    expect(c.advance(0.25)).toBe(2);
    expect(c.advance(1 / 60)).toBe(1);
  });

  it('no steps while paused or under a card (sim scale 0)', () => {
    const c = new RubbleClock();
    for (let i = 0; i < 10; i++) expect(c.advance(0)).toBe(0);
    expect(c.advance(NaN)).toBe(0);
  });

  it('hit-stop: a slowed sim accumulates across frames into an occasional step', () => {
    const c = new RubbleClock();
    let steps = 0;
    for (let i = 0; i < 32; i++) steps += c.advance(1 / 60 / 16);
    expect(steps).toBe(2);
  });
});
