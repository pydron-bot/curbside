import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SURF } from '../src/render/propModels';
import { STAND_INS, standInGeometry } from '../src/render/propStandIns';
import { generateCity } from '../src/world/city';
import { dressCity } from '../src/world/dressing';
import { generatePickups } from '../src/world/pickups';
import { placeKickers, placeRamps } from '../src/world/ramps';

/** Root names in props.glb (its JSON chunk). */
function glbRoots(file: string): string[] {
  const buf = readFileSync(file);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  return json.scenes[0].nodes.map((i: number) => json.nodes[i].name);
}

describe('box stand-ins for the props props.glb has no model for yet', () => {
  const roots = new Set(glbRoots('public/assets/props.glb'));
  const big = placeRamps(1337);
  const street = dressCity(generateCity(1337), generatePickups(1337), [...big, ...placeKickers(1337, big)]).street;

  it('cover every street prop kind placed', () => {
    for (const kind of new Set(street.props.map((p) => p.kind))) expect(roots.has(kind) || kind in STAND_INS, kind).toBe(true);
  });

  it('stand on the ground, tagged like a GLB part, with the lamps and signs lit', () => {
    for (const [name, parts] of Object.entries(STAND_INS)) {
      const g = standInGeometry(name, parts);
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y, name).toBeGreaterThan(-0.05);
      expect(g.boundingBox!.min.y, name).toBeLessThan(0.15);
      const n = g.getAttribute('position').count;
      expect(g.getAttribute('aColor').count).toBe(n);
      expect(g.getAttribute('aSurf').count).toBe(n);
      // Footprints a few metres at most (the shelter is the longest).
      expect(g.boundingBox!.max.x - g.boundingBox!.min.x, name).toBeLessThan(4.5);
    }
    const surfs = (name: string) => new Set(standInGeometry(name, STAND_INS[name]).getAttribute('aSurf').array);
    expect(surfs('traffic_barrel').has(SURF.blink)).toBe(true);
    expect(surfs('traffic_barrel').has(SURF.hazard)).toBe(true);
    expect(surfs('bus_shelter').has(SURF.sign)).toBe(true);
    expect(surfs('vending_machine').has(SURF.paint)).toBe(true);
  });

  it('keep the street family light: every model there runs for every instance', () => {
    let verts = 0;
    for (const [name, parts] of Object.entries(STAND_INS)) verts += standInGeometry(name, parts).getAttribute('position').count;
    expect(verts).toBeLessThan(3000);
  });
});
