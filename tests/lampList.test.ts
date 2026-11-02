import { describe, expect, it } from 'vitest';
import { LAMPS_ALL, LAMPS_NONE, lampList } from '../src/render/shaderLib';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, generateCity } from '../src/world/city';
import { dressCity } from '../src/world/dressing';
import { generatePickups } from '../src/world/pickups';
import { placeKickers, placeRamps } from '../src/world/ramps';
import { mulberry32 } from '../src/world/random';
import { LAMP_ARM, LAMP_HEIGHT, LAMP_OFFSET, LAMP_REACH2, LAMP_SPACING, generateStreetLamps, lampsNear } from '../src/world/streetLamps';

// The shader's lamp light (shaderLib.ts UB_STREET_LIGHT), in JS, to check the short list against.
const OFF = LAMP_OFFSET - LAMP_ARM;
const H = LAMP_HEIGHT - 0.25;
function term(wx: number, wy: number, wz: number, nx: number, ny: number, nz: number, lx: number, lz: number): number {
  const Lx = lx - wx;
  const Ly = H - wy;
  const Lz = lz - wz;
  const d2 = Lx * Lx + Ly * Ly + Lz * Lz;
  const ndl = Math.max((nx * Lx + ny * Ly + nz * Lz) / Math.sqrt(d2), 0);
  const reach = Math.max(1 - d2 / LAMP_REACH2, 0);
  return ndl * reach * reach * (34 / (d2 + 7));
}
function lattice(wx: number, wy: number, wz: number, nx: number, ny: number, nz: number): number {
  const gx = wx + HALF_EXTENT;
  const gz = wz + HALF_EXTENT;
  const cellX = Math.floor(gx / BLOCK_SIZE);
  const cellZ = Math.floor(gz / BLOCK_SIZE);
  const localX = gx - cellX * BLOCK_SIZE;
  const localZ = gz - cellZ * BLOCK_SIZE;
  const lineX = Math.floor(gx / BLOCK_SIZE + 0.5);
  const lineZ = Math.floor(gz / BLOCK_SIZE + 0.5);
  const clamp = (v: number) => Math.min(Math.max(v, 1), 2);
  let sum = 0;
  if (cellZ >= 0 && cellZ < BLOCKS_PER_SIDE) {
    const za = cellZ * BLOCK_SIZE - HALF_EXTENT + LAMP_SPACING * clamp(Math.floor(localZ / LAMP_SPACING));
    for (let s = 0; s < 2; s++) {
      const col = lineX - (s === 0 ? 1 : 0);
      if (col < 0 || col >= BLOCKS_PER_SIDE) continue;
      const lx = lineX * BLOCK_SIZE - HALF_EXTENT + (s === 0 ? -1 : 1) * OFF;
      sum += term(wx, wy, wz, nx, ny, nz, lx, za) + term(wx, wy, wz, nx, ny, nz, lx, za + LAMP_SPACING);
    }
  }
  if (cellX >= 0 && cellX < BLOCKS_PER_SIDE) {
    const xa = cellX * BLOCK_SIZE - HALF_EXTENT + LAMP_SPACING * clamp(Math.floor(localX / LAMP_SPACING));
    for (let s = 0; s < 2; s++) {
      const row = lineZ - (s === 0 ? 1 : 0);
      if (row < 0 || row >= BLOCKS_PER_SIDE) continue;
      const lz = lineZ * BLOCK_SIZE - HALF_EXTENT + (s === 0 ? -1 : 1) * OFF;
      sum += term(wx, wy, wz, nx, ny, nz, xa, lz) + term(wx, wy, wz, nx, ny, nz, xa + LAMP_SPACING, lz);
    }
  }
  return sum;
}

describe('street-lamp short lists', () => {
  const heads = generateStreetLamps().map((l) => [l.x + l.dx * LAMP_ARM, l.z + l.dz * LAMP_ARM] as const);
  const rand = mulberry32(5);
  const out = new Float32Array(8);

  it('find exactly the heads within reach of anything in the radius', () => {
    const reach = Math.sqrt(LAMP_REACH2);
    for (let t = 0; t < 3000; t++) {
      const x = (rand() * 2 - 1) * (HALF_EXTENT + 10);
      const z = (rand() * 2 - 1) * (HALF_EXTENT + 10);
      const r = rand() * 4;
      const want = heads.filter(([hx, hz]) => Math.hypot(hx - x, hz - z) < reach + r);
      const n = lampsNear(x, z, r, out, 0, 4);
      expect(n).toBe(want.length);
      for (let i = 0; i < Math.min(n, 4); i++) {
        expect(want.some(([hx, hz]) => Math.abs(hx - out[i * 2]) < 1e-3 && Math.abs(hz - out[i * 2 + 1]) < 1e-3)).toBe(true);
      }
    }
  });

  it('light a thing as the shader lattice does, anywhere in its radius', () => {
    let listed = 0;
    for (let t = 0; t < 2000; t++) {
      const x = (rand() * 2 - 1) * HALF_EXTENT;
      const z = (rand() * 2 - 1) * HALF_EXTENT;
      const r = rand() * 2.5;
      lampList(x, z, r, out, 0);
      if (out[0] === LAMPS_ALL) continue;
      listed++;
      for (let s = 0; s < 6; s++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * r;
        const wx = x + Math.cos(a) * d;
        const wz = z + Math.sin(a) * d;
        const wy = rand() * 4;
        let nx = rand() * 2 - 1;
        let ny = rand() * 2 - 1;
        let nz = rand() * 2 - 1;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const full = lattice(wx, wy, wz, nx, ny, nz);
        const short = out[0] === LAMPS_NONE ? 0 : term(wx, wy, wz, nx, ny, nz, out[0], out[1]) + term(wx, wy, wz, nx, ny, nz, out[2], out[3]);
        // The list holds the heads as float32, as the GPU does.
        expect(short).toBeCloseTo(full, 4);
      }
    }
    expect(listed).toBeGreaterThan(1000);
  });

  it('cover most of the street furniture (the rest walk the lattice)', () => {
    const big = placeRamps(1337);
    const street = dressCity(generateCity(1337), generatePickups(1337), [...big, ...placeKickers(1337, big)]).street;
    const props = street.props.filter((p) => p.kind !== 'streetlamp');
    let short = 0;
    for (const p of props) {
      // A bin's or a bench's reach from its origin, roughly.
      lampList(p.x, p.z, 1, out, 0);
      if (out[0] !== LAMPS_ALL) short++;
    }
    // Lamps stand 16 m apart and never at a corner: at most two reach any one spot.
    expect(short / props.length).toBeGreaterThan(0.95);
  });
});
