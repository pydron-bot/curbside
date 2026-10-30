import { CanvasTexture, DataTexture, LinearMipmapLinearFilter, RGBAFormat, type Texture } from 'three';
import { FRAME } from './fxParticles';

/** Cells per side of the atlas (FRAME indexes them row by row from the top-left). */
export const ATLAS_CELLS = 4;
const CELL = 128;

/**
 * The particle sprite atlas, drawn once on a canvas at start-up (no image
 * files): fbm smoke puffs lit from the top-left, a flame blob with a hot core,
 * glow dots, a spark streak, a four-point star, a ring, the tracer streak
 * (hot head at the top of the cell), a muzzle flare, a soft disc and a grainy
 * dust puff. Alpha is the shape; RGB is brightness detail the particle colour
 * multiplies. Falls back to a plain white texture where canvas 2D is missing.
 */
export function createFxAtlas(): Texture {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = CELL * ATLAS_CELLS;
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!canvas || !ctx) {
    const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
    t.needsUpdate = true;
    return t;
  }
  const img = ctx.createImageData(CELL * ATLAS_CELLS, CELL * ATLAS_CELLS);
  const cells: Array<[number, Shade]> = [
    [FRAME.puffA, puff(11, 0.9)],
    [FRAME.puffB, puff(37, 0.95)],
    [FRAME.puffC, puff(71, 0.75)],
    [FRAME.puffD, puff(113, 1)],
    [FRAME.flame, flame],
    [FRAME.dot, dot],
    [FRAME.spark, spark],
    [FRAME.star, star],
    [FRAME.ring, ring],
    [FRAME.streak, streak],
    [FRAME.muzzle, muzzle],
    [FRAME.soft, soft],
    [FRAME.dust, dust],
  ];
  const out = { l: 0, a: 0 };
  for (const [frame, shade] of cells) {
    const cx = (frame % ATLAS_CELLS) * CELL;
    const cy = Math.floor(frame / ATLAS_CELLS) * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        // Cell-local coordinates -1..1, +v up (canvas y runs down).
        const u = ((x + 0.5) / CELL) * 2 - 1;
        const v = 1 - ((y + 0.5) / CELL) * 2;
        out.l = 1;
        out.a = 0;
        shade(u, v, out);
        // Keep a transparent rim so mipmaps don't bleed between cells.
        const rim = Math.min(x, y, CELL - 1 - x, CELL - 1 - y);
        const a = rim < 2 ? 0 : out.a;
        const i = ((cy + y) * CELL * ATLAS_CELLS + cx + x) * 4;
        const l = Math.round(clamp01(out.l) * 255);
        img.data[i] = l;
        img.data[i + 1] = l;
        img.data[i + 2] = l;
        img.data[i + 3] = Math.round(clamp01(a) * 255);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.premultiplyAlpha = false;
  return tex;
}

/** Fill out.l (brightness 0..1) and out.a (coverage 0..1) at cell point (u, v) in -1..1. */
type Shade = (u: number, v: number, out: { l: number; a: number }) => void;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, seed: number): number {
  return noise(x, y, seed) * 0.55 + noise(x * 2.1, y * 2.1, seed + 1) * 0.28 + noise(x * 4.3, y * 4.3, seed + 2) * 0.17;
}

/** A billowy smoke puff: fbm-eroded disc, lit from the top-left. */
function puff(seed: number, fill: number): Shade {
  return (u, v, out) => {
    const r = Math.hypot(u, v);
    const n = fbm(u * 2.6 + 5, v * 2.6 + 5, seed);
    const body = 1 - smooth(0.35, 1, r + (n - 0.5) * 0.75);
    out.a = body * (0.55 + 0.45 * fill * smooth(0.15, 0.7, n + 0.2));
    // Lit side up-left, shadowed lower-right; lumps catch light.
    out.l = 0.62 + 0.25 * (-u * 0.5 + v * 0.5) * (1 - r) + (n - 0.5) * 0.5;
  };
}

function flame(u: number, v: number, out: { l: number; a: number }): void {
  const r = Math.hypot(u * 1.1, v * 0.95 + 0.08);
  const n = fbm(u * 3 + 2, v * 3 + 9, 5);
  out.a = 1 - smooth(0.25, 0.95, r + (n - 0.5) * 0.6);
  out.l = 0.55 + 0.45 * (1 - smooth(0, 0.6, r)) + (n - 0.5) * 0.3;
}

function dot(u: number, v: number, out: { l: number; a: number }): void {
  const r = Math.hypot(u, v);
  out.a = Math.max(0, 1 - r) ** 2 + (1 - smooth(0.1, 0.3, r)) * 0.6;
  out.l = 1;
}

/** Long thin glow along v: bright core line, soft halo, tapered ends. */
function spark(u: number, v: number, out: { l: number; a: number }): void {
  const across = Math.abs(u);
  const taper = 1 - smooth(0.55, 1, Math.abs(v));
  out.a = (Math.exp(-across * across * 30) + Math.exp(-across * across * 4) * 0.35) * taper;
  out.l = 0.8 + 0.2 * Math.exp(-across * across * 60);
}

function star(u: number, v: number, out: { l: number; a: number }): void {
  const r = Math.hypot(u, v);
  const ax = Math.abs(u);
  const ay = Math.abs(v);
  const rays = Math.exp(-ax * 18) * (1 - smooth(0.2, 1, ay)) + Math.exp(-ay * 18) * (1 - smooth(0.2, 1, ax));
  const core = Math.max(0, 1 - r * 1.6) ** 2;
  out.a = Math.min(1, rays * 0.9 + core + Math.max(0, 1 - r) ** 3 * 0.35);
  out.l = 1;
}

function ring(u: number, v: number, out: { l: number; a: number }): void {
  const r = Math.hypot(u, v);
  out.a = Math.exp(-((r - 0.78) ** 2) * 220) + Math.exp(-((r - 0.78) ** 2) * 30) * 0.25;
  out.l = 1;
}

/** Tracer: white-hot head at the top (v = 1), a tail that fades toward v = -1. */
function streak(u: number, v: number, out: { l: number; a: number }): void {
  const along = (v + 1) / 2; // 0 tail .. 1 head
  const across = Math.abs(u);
  const width = 0.25 + 0.75 * along;
  const core = Math.exp(-((across / width) ** 2) * 6);
  const head = 1 - smooth(0.9, 1, along);
  out.a = core * along ** 1.6 * head * 1.1;
  out.l = 0.55 + 0.45 * along ** 4;
}

/** Muzzle flare: bright at the base (v = -1), flaring forward in three tongues. */
function muzzle(u: number, v: number, out: { l: number; a: number }): void {
  const along = (v + 1) / 2;
  const spread = 0.12 + along * 0.55;
  const tongues = Math.exp(-((u / spread) ** 2) * 2.5) + 0.6 * Math.exp(-(((Math.abs(u) - spread * 0.85) / (spread * 0.35)) ** 2));
  const fade = (1 - along) ** 1.3 * smooth(0, 0.08, along);
  out.a = Math.min(1, tongues * fade * 1.3);
  out.l = 0.7 + 0.3 * (1 - along);
}

function soft(u: number, v: number, out: { l: number; a: number }): void {
  const r = Math.hypot(u, v);
  out.a = Math.exp(-r * r * 4) * (1 - smooth(0.8, 1, r));
  out.l = 1;
}

/** Dust: a flatter, grainier puff. */
function dust(u: number, v: number, out: { l: number; a: number }): void {
  const r = Math.hypot(u, v);
  const n = fbm(u * 3.5 + 1, v * 3.5 + 3, 211);
  const grain = hash(Math.floor((u + 1) * 40), Math.floor((v + 1) * 40), 3);
  out.a = (1 - smooth(0.3, 1, r + (n - 0.5) * 0.6)) * (0.75 + 0.25 * grain);
  out.l = 0.75 + (n - 0.5) * 0.4;
}
