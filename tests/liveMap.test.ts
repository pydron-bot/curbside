/**
 * W3-D: the map editor's live rebuild. The city's meshes swap only the
 * 256 m chunks whose contents changed; collision grids and knockables take
 * a new set in place.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { InstancedMesh } from 'three';
import { planBuildings } from '../src/world/buildingPlans';
import { CORE_OFFSET, generateCity } from '../src/world/city';
import { createCityMesh } from '../src/world/cityMesh';
import { StaticGrid } from '../src/world/collision';
import { NO_EDITS } from '../src/world/mapEdits';
import { Knockables } from '../src/systems/knockables';

afterEach(() => void generateCity(1337));

const chunkNames = (root: { children: Array<{ name: string }> }) => root.children.map((c) => c.name).filter((n) => n.startsWith('chunk_'));

describe('live rebuild', () => {
  it('rebuilds only the chunks an edit touches, and nothing for the same city', () => {
    const plain = generateCity(1337);
    const mesh = createCityMesh(plain, planBuildings(plain));
    const before = chunkNames(mesh.root);
    expect(mesh.rebuild(plain, planBuildings(plain))).toBe(0);
    // Core block (5, 5) in a 16-block city: chunk (1, 1).
    const b = plain.blocks.find((x) => x.bx === 5 + CORE_OFFSET && x.bz === 5 + CORE_OFFSET)!;
    const edited = generateCity(1337, { ...NO_EDITS, blocks: [{ at: [5, 5], kind: b.kind === 'park' ? 'buildings' : 'park' }] });
    expect(mesh.rebuild(edited, planBuildings(edited))).toBe(1);
    expect(chunkNames(mesh.root).sort()).toEqual(before.sort());
    // Every chunk's meshes are in the scene graph once.
    const meshes = mesh.root.children.flatMap((g) => g.children as InstancedMesh[]);
    expect(new Set(meshes).size).toBe(meshes.length);
    // And back.
    expect(mesh.rebuild(plain, planBuildings(plain))).toBe(1);
  });

  it('drops the stand-ins of a rebuilt chunk once the models are in', () => {
    const plain = generateCity(1337);
    const mesh = createCityMesh(plain, planBuildings(plain));
    mesh.hideStandIns();
    const edited = generateCity(1337, { ...NO_EDITS, blocks: [{ at: [5, 5], variant: 3 }] });
    mesh.rebuild(edited, planBuildings(edited));
    const parts = mesh.root.children.flatMap((g) => g.children.map((m) => m.userData.part as string));
    expect(parts.filter((p) => p === 'standins' || p === 'cylinders' || p === 'canopies')).toEqual([]);
  });

  it('a grid and the knockables take a new set in place', () => {
    const grid = new StaticGrid([{ minX: 0, minZ: 0, maxX: 2, maxZ: 2 }]);
    expect(grid.near(1, 1, 0.5).length).toBe(1);
    grid.reset([{ minX: 50, minZ: 50, maxX: 52, maxZ: 52 }]);
    expect(grid.near(1, 1, 0.5).length).toBe(0);
    expect(grid.near(51, 51, 0.5).length).toBe(1);
    const k = new Knockables([{ id: 1, kind: 'hydrant', x: 0, z: 0, radius: 0.3 } as never]);
    expect(k.count).toBe(1);
    k.replace([]);
    expect(k.count).toBe(0);
  });
});
