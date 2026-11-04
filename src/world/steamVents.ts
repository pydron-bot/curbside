/**
 * Steam vents in the roads (pure; tests/steamVents.test.ts): a grate in a
 * lane on about a quarter of the road segments, clear of the junctions,
 * that breathes steam at night (render/steamLook.ts) lit by the light of its
 * part of town. cityMesh draws the grates.
 */
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH } from './city';
import { STREET_REMOVED, roadRules } from './roadRules';
import { districtOf, type District } from './districts';
import { keyedStream } from './random';

export interface SteamVent {
  x: number;
  z: number;
  /** The district it's in, for the steam's tint. */
  district: District;
}

const ODDS = 0.25;

const roadGone = (ax: number, az: number, bx: number, bz: number) => roadRules().merges.length > 0 && roadRules().streetOf(ax, az, bx, bz) === STREET_REMOVED;

export function planSteamVents(citySeed: number): SteamVent[] {
  const out: SteamVent[] = [];
  const clear = ROAD_WIDTH / 2 + 4;
  for (let line = 1; line < BLOCKS_PER_SIDE; line++) {
    const c = line * BLOCK_SIZE - HALF_EXTENT;
    for (let b = 0; b < BLOCKS_PER_SIDE; b++) {
      const o = b * BLOCK_SIZE - HALF_EXTENT;
      for (const ns of [true, false]) {
        const rand = keyedStream(citySeed, ns ? 0x57ea : 0x57eb, line, b);
        if (rand() >= ODDS) continue;
        const along = o + clear + rand() * (BLOCK_SIZE - 2 * clear);
        const across = c + (rand() < 0.5 ? -1 : 1) * (2 + rand() * 3);
        const x = ns ? across : along;
        const z = ns ? along : across;
        // None on a removed road (round 3: it's land now).
        const n = BLOCKS_PER_SIDE / 2;
        if (ns ? roadGone(line - n, b - n, line - n, b - n + 1) : roadGone(b - n, line - n, b - n + 1, line - n)) continue;
        const bx = Math.floor((x + HALF_EXTENT) / BLOCK_SIZE);
        const bz = Math.floor((z + HALF_EXTENT) / BLOCK_SIZE);
        out.push({ x, z, district: districtOf(Math.min(BLOCKS_PER_SIDE - 1, bx), Math.min(BLOCKS_PER_SIDE - 1, bz)) });
      }
    }
  }
  return out;
}
