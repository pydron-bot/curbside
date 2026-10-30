import { describe, expect, it } from 'vitest';
import { SAFEHOUSE, placeDocks, placePayphones } from '../src/game/modes/places';
import { generatePickups } from '../src/world/pickups';
import { BLOCK_SIZE, ROAD_WIDTH, SIDEWALK, generateCity } from '../src/world/city';
import { StaticGrid, circleVsRect } from '../src/world/collision';
import { dressCity } from '../src/world/dressing';
import { inShop, placeSprayShops, placeStation } from '../src/world/landmarks';
import { placeKickers, placeRamps } from '../src/world/ramps';
import { LANE_OFFSET } from '../src/world/roads';
import { signalPoles } from '../src/world/signals';
import { generateStreetLamps } from '../src/world/streetLamps';

const city = generateCity(1337);
const pickups = generatePickups(1337);
const big = placeRamps(1337);
const ramps = [...big, ...placeKickers(1337, big)];
const dressing = dressCity(city, pickups, ramps);
const { street, landmarks } = dressing;

/** Distance from the nearest road centreline (the road a pavement prop stands beside). */
function fromCentreline(x: number, z: number): number {
  const dx = Math.abs(x - Math.round(x / BLOCK_SIZE) * BLOCK_SIZE);
  const dz = Math.abs(z - Math.round(z / BLOCK_SIZE) * BLOCK_SIZE);
  return Math.min(dx, dz);
}

describe('street furniture', () => {
  it('is the same every game', () => {
    expect(dressCity(city, pickups, ramps).street.props).toEqual(street.props);
  });

  it('has a lamp at nearly every lit spot and a pole for every signalled approach', () => {
    const lamps = street.props.filter((p) => p.kind === 'streetlamp');
    const all = generateStreetLamps().length;
    expect(lamps.length).toBeGreaterThan(all * 0.98);
    expect(lamps.length).toBeLessThanOrEqual(all);
    expect(street.props.filter((p) => p.kind === 'traffic_light').length).toBeGreaterThan(signalPoles().length * 0.95);
  });

  it('keeps kerbside things off the line people walk, and out of the road', () => {
    const walk = ROAD_WIDTH / 2 + SIDEWALK / 2;
    for (const p of street.props) {
      if (p.kind === 'tree_round' || p.kind === 'tree_tall' || p.kind === 'palm' || p.kind === 'dumpster') continue;
      const d = fromCentreline(p.x, p.z);
      expect(d, p.kind).toBeGreaterThan(ROAD_WIDTH / 2);
      expect(d, p.kind).toBeLessThan(ROAD_WIDTH / 2 + SIDEWALK);
      if (p.kind === 'bench') expect(d - walk).toBeGreaterThan(0.6);
      else expect(walk - d, p.kind).toBeGreaterThan(0.6);
    }
  });

  it('puts every district\'s mix on the streets, dumpsters in alleys and trees in the parks', () => {
    const kinds = new Set(street.props.map((p) => p.kind));
    for (const k of ['hydrant', 'bench', 'trash_bin', 'bollard', 'newspaper_box', 'mailbox', 'dumpster', 'tree_round', 'tree_tall', 'palm']) {
      expect(kinds, k).toContain(k);
    }
    expect(street.props.filter((p) => p.kind === 'dumpster').length).toBeGreaterThan(10);
  });

  it('never stands inside a building, and solid things are in the collision set', () => {
    const buildings = new StaticGrid(city.buildings);
    for (const p of street.props) {
      if (p.kind === 'dumpster') continue; // against a wall
      for (const b of buildings.near(p.x, p.z, 0.1)) expect(circleVsRect(p.x, p.z, 0.05, b), p.kind).toBeNull();
    }
    const solidKinds = new Set(['streetlamp', 'traffic_light', 'bollard', 'dumpster']);
    expect(street.solids.length).toBe(street.props.filter((p) => solidKinds.has(p.kind)).length);
    // The knockables are the small things, each a real prop.
    for (const k of street.knockables) expect(['hydrant', 'trash_bin', 'newspaper_box', 'mailbox', 'bench']).toContain(street.props[k.prop].kind);
  });

  it('keeps clear of pickups, payphones, the safehouse and the spray bays (and their mouths)', () => {
    const shops = [...placeSprayShops(city), placeDocks(city)];
    for (const p of street.props) {
      if (p.kind === 'streetlamp' || p.kind === 'traffic_light' || p.kind.startsWith('tree') || p.kind === 'palm') continue;
      for (const k of pickups) expect(Math.hypot(k.x - p.x, k.z - p.z), p.kind).toBeGreaterThan(1.5);
      for (const ph of placePayphones()) expect(Math.hypot(ph.x - p.x, ph.z - p.z)).toBeGreaterThan(1.9);
      expect(Math.hypot(SAFEHOUSE.x - p.x, SAFEHOUSE.z - p.z)).toBeGreaterThan(3);
    }
    // Nothing solid in the way in to any bay.
    const solids = new StaticGrid(dressing.solids);
    for (const s of shops) {
      const fx = Math.sin(s.heading);
      const fz = Math.cos(s.heading);
      for (let along = -s.halfLength - 8; along < -s.halfLength; along += 1) {
        for (let across = -2; across <= 2; across += 1) {
          const x = s.x + fx * along + fz * across;
          const z = s.z + fz * along - fx * across;
          for (const r of solids.near(x, z, 0.9)) expect(circleVsRect(x, z, 0.9, r), `in front of ${s.id}`).toBeNull();
        }
      }
    }
  });
});

describe('landmark models', () => {
  it('puts a booth over every spray bay and the export garage over the docks, mouths to the road', () => {
    const shops = placeSprayShops(city);
    const booths = landmarks.props.filter((p) => p.kind === 'spray_booth');
    expect(booths).toHaveLength(shops.length);
    for (const s of shops) {
      const b = booths.find((p) => p.x === s.x && p.z === s.z)!;
      expect(b.heading).toBe(s.heading);
    }
    const docks = placeDocks(city);
    expect(landmarks.props.find((p) => p.kind === 'export_bay')).toMatchObject({ x: docks.x, z: docks.z, heading: docks.heading });
  });

  it("leaves a car room to drive into a booth and stop in the bay, but its walls are solid", () => {
    const grid = new StaticGrid(landmarks.solids);
    for (const s of [...placeSprayShops(city), placeDocks(city)]) {
      const fx = Math.sin(s.heading);
      const fz = Math.cos(s.heading);
      // A car's three circles down the middle of the bay, from the mouth to the back.
      for (let along = -s.halfLength - 2; along < 1.8; along += 0.5) {
        for (const o of [-1.38, 0, 1.38]) {
          const x = s.x + fx * (along + o);
          const z = s.z + fz * (along + o);
          for (const r of grid.near(x, z, 1)) expect(circleVsRect(x, z, 0.98, r), s.id).toBeNull();
        }
      }
      expect(inShop(s, s.x, s.z)).toBe(true);
      // Beside the bay (through the side wall) is blocked.
      const side = { x: s.x + fz * 3, z: s.z - fx * 3 };
      expect(grid.near(side.x, side.z, 0.5).some((r) => circleVsRect(side.x, side.z, 0.5, r) !== null)).toBe(true);
    }
  });

  it('hangs the police sign on the station wall and the door on the safehouse wall', () => {
    const st = placeStation(city);
    const sign = landmarks.props.find((p) => p.kind === 'police_sign')!;
    expect(sign.x).toBe(st.x);
    expect(st.z - sign.z).toBeGreaterThan(0.5);
    expect(st.z - sign.z).toBeLessThan(SIDEWALK + 2.1);
    const door = landmarks.props.find((p) => p.kind === 'safehouse_door')!;
    expect(door.x).toBe(SAFEHOUSE.x);
    expect(door.z - SAFEHOUSE.z).toBeGreaterThan(0.5);
    expect(door.heading).toBeCloseTo(Math.PI);
  });

  it("spans every race's first straight with a gantry whose pillars stand clear of the lanes", () => {
    const gantries = landmarks.props.filter((p) => p.kind === 'start_gantry');
    expect(gantries).toHaveLength(6);
    for (const g of gantries) {
      const across = 6.25 * g.sx;
      expect(across).toBeGreaterThan(LANE_OFFSET + 1 + 3); // a car pulled over to the kerb still passes
    }
    // Ramps and kickers carry their models.
    expect(landmarks.props.filter((p) => p.kind === 'ramp')).toHaveLength(big.length);
    expect(landmarks.props.filter((p) => p.kind === 'kicker')).toHaveLength(ramps.length - big.length);
  });
});
