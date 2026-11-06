import { describe, expect, it } from 'vitest';
import { FrameSystems, type FrameContext } from '../src/core/frameSystems';

const frame = (real: number, world: number, sim: number): FrameContext => ({
  real,
  world,
  sim,
  view: { minX: -1, minZ: -2, maxX: 3, maxZ: 4 },
});

describe('FrameSystems', () => {
  it('runs every system in the order added, each on its own clock', () => {
    const systems = new FrameSystems();
    const calls: string[] = [];
    systems.add('a', 'real', (dt) => calls.push(`a ${dt}`));
    systems.add('b', 'world', (dt) => calls.push(`b ${dt}`));
    systems.add('c', 'sim', (dt) => calls.push(`c ${dt}`));
    systems.run(frame(0.016, 0.004, 0));
    expect(calls).toEqual(['a 0.016', 'b 0.004', 'c 0']);
    expect(systems.names).toEqual(['a', 'b', 'c']);
  });

  it('hands every system the same frame, view included', () => {
    const systems = new FrameSystems();
    const seen: unknown[] = [];
    systems.add('a', 'real', (_dt, f) => seen.push(f));
    systems.add('b', 'sim', (_dt, f) => seen.push(f.view));
    const f = frame(1, 1, 1);
    systems.run(f);
    expect(seen).toEqual([f, f.view]);
    expect(seen[0]).toBe(f);
  });

  it('refuses a name added twice (two branches merged the same look)', () => {
    const systems = new FrameSystems();
    systems.add('steam', 'world', () => {});
    expect(() => systems.add('steam', 'world', () => {})).toThrow(/steam/);
  });
});
