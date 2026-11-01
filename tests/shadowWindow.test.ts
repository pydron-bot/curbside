import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  SHADOW_MAX_HEIGHT,
  createLightAxes,
  createLightCamera,
  createShadowWindow,
  createStaticWindow,
  depthRange,
  fitShadowWindow,
  lightAxes,
  lightCamera,
  planStaticWindow,
  staticCovers,
  sunShift,
  type LightAxes,
  type ShadowWindow,
  type StaticWindow,
} from '../src/render/shadowWindow';
import { sunDirection } from '../src/render/timeOfDay';
import type { Rect } from '../src/world/city';

const N = 1024;
const M = N / 4;
const view: Rect = { minX: -30, minZ: -18, maxX: 32, maxZ: 16 };
const toLight = new Vector3(...sunDirection(18.4));

function slide(r: Rect, dx: number, dz: number): Rect {
  return { minX: r.minX + dx, maxX: r.maxX + dx, minZ: r.minZ + dz, maxZ: r.maxZ + dz };
}

function setup(dir = toLight, v = view): { axes: LightAxes; w: ShadowWindow; s: StaticWindow } {
  const axes = lightAxes(dir, createLightAxes());
  const w = fitShadowWindow(v, axes, N, createShadowWindow());
  const s = planStaticWindow(w, N, M, axes, createStaticWindow());
  return { axes, w, s };
}

describe('sun shadow window', () => {
  it('covers every corner of the view volume, within the depth range', () => {
    const { axes, w, s } = setup();
    const cam = lightCamera(s, w.ix, w.iy, axes, createLightCamera());
    for (let i = 0; i < 8; i++) {
      const p = new Vector3(i & 1 ? view.maxX : view.minX, i & 4 ? SHADOW_MAX_HEIGHT : 0, i & 2 ? view.maxZ : view.minZ);
      const d = p.clone().sub(cam.target);
      expect(Math.abs(d.dot(axes.ax))).toBeLessThanOrEqual(w.halfWidth);
      expect(Math.abs(d.dot(axes.ay))).toBeLessThanOrEqual(w.halfHeight);
      const depth = cam.position.clone().sub(p).dot(axes.az);
      expect(depth).toBeGreaterThan(cam.near);
      expect(depth).toBeLessThan(cam.far);
    }
  });

  it('snaps to whole shadow texels so edges do not crawl as the camera moves', () => {
    const axes = lightAxes(toLight, createLightAxes());
    const w = createShadowWindow();
    const s = createStaticWindow();
    for (const shift of [0, 0.013, 0.37, 1.9]) {
      fitShadowWindow(slide(view, shift, -shift), axes, 2048, w);
      planStaticWindow(w, 2048, 512, axes, s);
      const cam = lightCamera(s, w.ix, w.iy, axes, createLightCamera());
      const u = cam.target.dot(axes.ax) / w.texelX;
      const v = cam.target.dot(axes.ay) / w.texelY;
      expect(Math.abs(u - Math.round(u))).toBeLessThan(1e-3);
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-3);
    }
  });

  it('grows at once but shrinks only once a smaller size has served for a while', () => {
    const axes = lightAxes(toLight, createLightAxes());
    const near = { minX: -20, maxX: 20, minZ: -10, maxZ: 10 };
    const far = { minX: -70, maxX: 70, minZ: -32, maxZ: 33 };
    const w = fitShadowWindow(near, axes, N, createShadowWindow(), 30);
    const small = [w.halfWidth, w.halfHeight];
    fitShadowWindow(far, axes, N, w, 30);
    const big = [w.halfWidth, w.halfHeight];
    expect(big[0]).toBeGreaterThan(small[0]);
    // Zooming in and out again inside the settle time keeps the big size.
    for (let i = 0; i < 20; i++) fitShadowWindow(near, axes, N, w, 30);
    fitShadowWindow(far, axes, N, w, 30);
    for (let i = 0; i < 30; i++) fitShadowWindow(near, axes, N, w, 30);
    expect([w.halfWidth, w.halfHeight]).toEqual(big);
    fitShadowWindow(near, axes, N, w, 30);
    expect([w.halfWidth, w.halfHeight]).toEqual(small);
    expect(w.texelX).toBeCloseTo((2 * small[0]) / N, 9);
  });

  it('keeps its size while the view only slides', () => {
    const axes = lightAxes(toLight, createLightAxes());
    const a = fitShadowWindow(view, axes, N, createShadowWindow());
    const b = fitShadowWindow(slide(view, 0.4, 0), axes, N, createShadowWindow());
    expect(b.halfWidth).toBe(a.halfWidth);
    expect(b.halfHeight).toBe(a.halfHeight);
  });
});

describe('sun shadow cache', () => {
  it('serves the window it was planned for, and slides within its margin', () => {
    const { axes, w, s } = setup();
    expect(staticCovers(s, w, N)).toBeNull();
    fitShadowWindow(slide(view, 4, 3), axes, N, w);
    expect(staticCovers(s, w, N)).toBeNull();
  });

  it('redraws when the view leaves the margin, changes size or the map does', () => {
    const { axes, w, s } = setup();
    fitShadowWindow(slide(view, 80, 0), axes, N, w);
    expect(staticCovers(s, w, N)).toBe('moved');
    fitShadowWindow({ minX: -70, maxX: 72, minZ: -30, maxZ: 35 }, axes, N, w);
    expect(staticCovers(s, w, N)).toBe('size');
    fitShadowWindow(view, axes, 2048, w);
    expect(staticCovers(s, w, 2048)).toBe('size');
  });

  it('re-centres ahead of the way the view was going', () => {
    const { axes, w, s } = setup();
    const [bx, by] = [s.ix, s.iy];
    let x = 0;
    while (staticCovers(s, w, N) === null) fitShadowWindow(slide(view, (x += 0.5), 0), axes, N, w);
    const [mx, my] = [w.ix - bx, w.iy - by];
    planStaticWindow(w, N, M, axes, s);
    const [lx, ly] = [s.ix - w.ix, s.iy - w.iy];
    expect(lx * mx + ly * my).toBeGreaterThan(0);
    expect(Math.max(Math.abs(lx), Math.abs(ly))).toBeGreaterThan(M / 2);
    expect(staticCovers(s, w, N)).toBeNull();
  });

  it('gives the per-frame and cached cameras the same depths and a whole-texel crop', () => {
    const { axes, w, s } = setup();
    fitShadowWindow(slide(view, 5.3, -7.1), axes, N, w);
    expect(staticCovers(s, w, N)).toBeNull();
    const frame = lightCamera(s, w.ix, w.iy, axes, createLightCamera());
    const cache = lightCamera(s, s.ix, s.iy, axes, createLightCamera());
    expect(frame.near).toBe(cache.near);
    expect(frame.far).toBe(cache.far);
    const ox = w.ix - s.ix + s.margin;
    const oy = w.iy - s.iy + s.margin;
    for (const p of [new Vector3(3, 0, 2), new Vector3(-20, 9, 11), new Vector3(28, 16, -15)]) {
      expect(frame.position.clone().sub(p).dot(axes.az)).toBeCloseTo(cache.position.clone().sub(p).dot(axes.az), 6);
      // Texel coordinates from each map's lower-left corner.
      const u = (p.clone().sub(frame.target).dot(axes.ax) + (N / 2) * s.texelX) / s.texelX;
      const v = (p.clone().sub(frame.target).dot(axes.ay) + (N / 2) * s.texelY) / s.texelY;
      const us = (p.clone().sub(cache.target).dot(axes.ax) + (N / 2 + M) * s.texelX) / s.texelX;
      const vs = (p.clone().sub(cache.target).dot(axes.ay) + (N / 2 + M) * s.texelY) / s.texelY;
      expect(us - u).toBeCloseTo(ox, 6);
      expect(vs - v).toBeCloseTo(oy, 6);
    }
  });

  it('knows the ground under the cached window and the depths over it', () => {
    for (const hour of [7, 12, 18.9]) {
      const { axes, s } = setup(new Vector3(...sunDirection(hour)));
      const cache = lightCamera(s, s.ix, s.iy, axes, createLightCamera());
      const hx = (N / 2 + M) * s.texelX;
      const hy = (N / 2 + M) * s.texelY;
      let inside = 0;
      for (let i = 0; i < 4000; i++) {
        const p = new Vector3(-200 + ((i * 37) % 400), (i % 5) * (SHADOW_MAX_HEIGHT / 4), -200 + ((i * 91) % 400));
        const d = p.clone().sub(cache.target);
        if (Math.abs(d.dot(axes.ax)) > hx || Math.abs(d.dot(axes.ay)) > hy) continue;
        inside++;
        if (p.y === 0) {
          // Ground in the window (where any view it serves lies) is on its ground rect.
          expect(p.x).toBeGreaterThanOrEqual(s.ground.minX - 1e-6);
          expect(p.x).toBeLessThanOrEqual(s.ground.maxX + 1e-6);
          expect(p.z).toBeGreaterThanOrEqual(s.ground.minZ - 1e-6);
          expect(p.z).toBeLessThanOrEqual(s.ground.maxZ + 1e-6);
        }
        const depth = cache.position.clone().sub(p).dot(axes.az);
        expect(depth).toBeGreaterThan(cache.near);
        expect(depth).toBeLessThan(cache.far);
      }
      expect(inside).toBeGreaterThan(100);
    }
  });

  it('keeps the bias in metres: a deeper cached range scales it down', () => {
    const { w, s } = setup();
    expect(depthRange(s.zLo, s.zHi)).toBeGreaterThan(depthRange(w.zLo, w.zHi));
  });

  it('redraws rarely when driving fast in a straight line', () => {
    // About the view at 30 m/s, 60 frames a second for 20 s.
    const big: Rect = { minX: -70, maxX: 70, minZ: -32, maxZ: 33 };
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [0.7, -0.7],
    ]) {
      const axes = lightAxes(toLight, createLightAxes());
      const w = createShadowWindow();
      const s = createStaticWindow();
      let redraws = 0;
      for (let f = 0; f < 1200; f++) {
        const d = (30 * f) / 60;
        fitShadowWindow(slide(big, dx * d, dz * d), axes, N, w);
        if (staticCovers(s, w, N) !== null) {
          redraws++;
          planStaticWindow(w, N, M, axes, s);
        }
      }
      // Once a second at most (the first plan included).
      expect(redraws).toBeLessThanOrEqual(21);
    }
  });
});

describe('sun movement', () => {
  it('is zero for the same direction and grows with time', () => {
    const a = new Vector3(...sunDirection(14));
    expect(sunShift(a, a)).toBe(0);
    const b = new Vector3(...sunDirection(14.01));
    const c = new Vector3(...sunDirection(14.05));
    expect(sunShift(a, b)).toBeGreaterThan(0);
    expect(sunShift(a, c)).toBeGreaterThan(sunShift(a, b));
  });

  it('moves long dusk shadows faster than midday ones', () => {
    const step = 0.02;
    const noon = sunShift(new Vector3(...sunDirection(12.7)), new Vector3(...sunDirection(12.7 + step)));
    const dusk = sunShift(new Vector3(...sunDirection(19.2)), new Vector3(...sunDirection(19.2 + step)));
    expect(dusk).toBeGreaterThan(noon);
  });
});
