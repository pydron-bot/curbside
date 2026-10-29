import { mulberry32 } from '../src/world/random';

export const random = (seed: number) => mulberry32(seed);
