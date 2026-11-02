import { describe, expect, it } from 'vitest';
import { PERK_IDS, PERK_RANKS, levelFor, pendingLevels, sanitiseCred } from '../src/game/cred';
import { defaultSave, migrateSave } from '../src/game/progressSave';
import {
  addCredLevel,
  credForLevel,
  exportSave,
  importSave,
  jumpToMission,
  maxPerks,
  replaceSave,
  resetCred,
  resetSave,
  setOpening,
  unlockAllMissions,
} from '../src/game/saveTools';
import { CAR_R, districtCentre, nearestLine, onRoad, snapOnFoot, snapToLane, spawnBeside, walkable, type Free } from '../src/game/testSpots';
import { BLOCK_SIZE, HALF_EXTENT, ROAD_WIDTH, generateCity } from '../src/world/city';
import { districtAt } from '../src/world/districts';
import { LANE_OFFSET } from '../src/world/roads';

const open: Free = () => true;
/** Clear except within `r` of each of `blocks`. */
const blockedAt =
  (blocks: Array<[number, number, number]>): Free =>
  (x, z, r) =>
    blocks.every(([bx, bz, br]) => Math.hypot(x - bx, z - bz) >= br + r);

describe('test spots: teleport snapping', () => {
  it('a road or pavement point stays where it is on foot', () => {
    // Middle of the road, then on the pavement 9.5 m off the centreline.
    for (const [x, z] of [
      [0, 30],
      [9.5, 30],
      [30, -64 + 9.5],
    ]) {
      const s = snapOnFoot(x, z, open)!;
      expect([s.x, s.z]).toEqual([x, z]);
    }
  });

  it('a spot inside a block steps out to the middle of its nearest pavement', () => {
    const s = snapOnFoot(20, 30, open)!;
    expect(walkable(s.x, s.z)).toBe(true);
    expect(onRoad(s.x, s.z)).toBe(false);
    expect(s.x).toBeCloseTo(ROAD_WIDTH / 2 + 1.5);
    expect(s.z).toBe(30);
  });

  it('a blocked pavement point moves to the nearest clear street point', () => {
    const s = snapOnFoot(9.5, 30, blockedAt([[9.5, 30, 1]]))!;
    expect(walkable(s.x, s.z)).toBe(true);
    expect(Math.hypot(s.x - 9.5, s.z - 30)).toBeLessThan(4);
    expect(Math.hypot(s.x - 9.5, s.z - 30)).toBeGreaterThanOrEqual(1.6 - 1e-9);
  });

  it('beyond the walls is pulled back into the city', () => {
    const s = snapOnFoot(5000, -5000, open)!;
    expect(walkable(s.x, s.z)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(HALF_EXTENT + ROAD_WIDTH / 2);
  });

  it('nothing clear near: null', () => {
    expect(snapOnFoot(0, 30, () => false)).toBeNull();
    expect(snapToLane(0, 30, () => false)).toBeNull();
  });

  it('with a car it lands on the nearer lane, facing the way its traffic goes, out of the junction', () => {
    // East of a north–south road: the northbound lane (heading π, nose to −z).
    const n = snapToLane(3, 30, open)!;
    expect(n.x).toBe(LANE_OFFSET);
    expect(n.z).toBe(30);
    expect(n.heading).toBeCloseTo(Math.PI);
    // West of it: southbound.
    expect(snapToLane(-3, 30, open)!.heading).toBeCloseTo(0);
    // South of an east–west road: eastbound (heading π/2).
    const e = snapToLane(30, 4, open)!;
    expect(e.z).toBe(LANE_OFFSET);
    expect(e.heading).toBeCloseTo(Math.PI / 2);
    // In the middle of a crossing: moved out of the box along the road.
    const j = snapToLane(1, 2, open)!;
    expect(Math.min(Math.abs(j.x - nearestLine(j.x)), Math.abs(j.z - nearestLine(j.z)))).toBeCloseTo(LANE_OFFSET);
    expect(Math.max(Math.abs(j.x - nearestLine(j.x)), Math.abs(j.z - nearestLine(j.z)))).toBeGreaterThanOrEqual(ROAD_WIDTH / 2);
  });

  it('a car on the lane already: it goes along the lane, then the other lane', () => {
    const s = snapToLane(3, 30, blockedAt([[LANE_OFFSET, 30, 1]]))!;
    expect(s.x).toBe(LANE_OFFSET);
    expect(Math.abs(s.z - 30)).toBe(6);
    const all = snapToLane(3, 30, (x) => x < 0)!;
    expect(all.x).toBe(-LANE_OFFSET);
  });
});

describe('test spots: a car beside the player', () => {
  it('on a lane of the nearest road, not on top of them, clear of other cars', () => {
    const s = spawnBeside(9.5, 30, 0, open)!;
    expect(onRoad(s.x, s.z)).toBe(true);
    const d = Math.hypot(s.x - 9.5, s.z - 30);
    expect(d).toBeGreaterThanOrEqual(4.5);
    expect(d).toBeLessThanOrEqual(16);
    const busy = blockedAt([[s.x, s.z, 1]]);
    const t = spawnBeside(9.5, 30, 0, busy)!;
    expect(Math.hypot(t.x - s.x, t.z - s.z)).toBeGreaterThanOrEqual(1 + CAR_R);
  });

  it('keeps to the distance asked (a car to blow up a safe way off)', () => {
    const s = spawnBeside(0, 30, 0, open, 14, 24)!;
    const d = Math.hypot(s.x, s.z - 30);
    expect(d).toBeGreaterThanOrEqual(14);
    expect(d).toBeLessThanOrEqual(24);
  });

  it('nowhere clear: null', () => {
    expect(spawnBeside(0, 30, 0, () => false)).toBeNull();
  });
});

describe('test spots: landmarks', () => {
  it("a district's centre is in that district", () => {
    const city = generateCity(1337);
    const c = districtCentre(city, 'arts');
    expect(districtAt(c.x, c.z)).toBe('arts');
    expect(Math.abs(c.x)).toBeLessThan(BLOCK_SIZE * 8);
  });
});

describe('save tools', () => {
  it('a level of CRED reaches the next level, with a perk waiting', () => {
    const s = defaultSave();
    s.cred.total = 30;
    expect(addCredLevel(s.cred)).toBe(70);
    expect(levelFor(s.cred.total).level).toBe(1);
    expect(pendingLevels(s.cred)).toBe(1);
    addCredLevel(s.cred);
    expect(levelFor(s.cred.total)).toMatchObject({ level: 2, into: 0 });
  });

  it('max perks: every rank at the top, with the levels to match, and it survives sanitising', () => {
    const s = defaultSave();
    maxPerks(s.cred);
    for (const id of PERK_IDS) expect(s.cred.perks[id]).toBe(PERK_RANKS);
    expect(s.cred.picked).toBe(PERK_IDS.length * PERK_RANKS);
    expect(pendingLevels(s.cred)).toBe(0);
    expect(s.cred.total).toBe(credForLevel(s.cred.picked));
    expect(sanitiseCred(JSON.parse(JSON.stringify(s.cred)))).toEqual(s.cred);
    resetCred(s.cred);
    expect(s.cred).toEqual({ total: 0, picked: 0, perks: {} });
  });

  it('missions: unlock all, or jump to any job (the ones before it passed, it and later not)', () => {
    const ids = ['m1', 'm2', 'm3', 'm4'];
    const s = defaultSave();
    s.missions = ['m1', 'other'];
    expect(unlockAllMissions(s, ids)).toBe(3);
    expect(s.missions).toEqual(['m1', 'other', 'm2', 'm3', 'm4']);
    expect(jumpToMission(s, ids, 'm3')).toBe(true);
    expect(s.missions).toEqual(['m1', 'm2', 'other']);
    expect(jumpToMission(s, ids, 'm1')).toBe(true);
    expect(s.missions).toEqual(['other']);
    expect(jumpToMission(s, ids, 'nope')).toBe(false);
  });

  it('the cold open: had, or due on the next PLAY', () => {
    const s = defaultSave();
    expect(s.opening).toBe(false);
    setOpening(s, true);
    expect(s.opening).toBe(true);
    setOpening(s, false);
    expect(s.opening).toBe(false);
  });

  it('reset and replace keep the live record (Progress holds it) but swap everything in it', () => {
    const s = defaultSave();
    const live = s;
    s.cash = 900;
    s.missions.push('m1');
    (s as unknown as Record<string, unknown>).future = 1;
    resetSave(s);
    expect(s).toBe(live);
    expect(s).toEqual(defaultSave());
    const other = defaultSave();
    other.cash = 5;
    replaceSave(s, other);
    other.missions.push('x');
    expect(s.cash).toBe(5);
    expect(s.missions).toEqual([]);
  });

  it('export then import gives the same save back', () => {
    const s = defaultSave();
    s.cash = 1234;
    s.missions = ['m1'];
    s.cred.total = 260;
    const r = importSave(exportSave(s), { missions: ['m1', 'm2'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.save).toEqual(migrateSave(JSON.parse(exportSave(s))));
  });

  it('a pasted save is sanitised: bad values fall back, unknown ids go', () => {
    const r = importSave(' {"v":1,"cash":-50,"missions":["m1","hacked"],"stats":{"wasted":"lots"}} ', { missions: ['m1'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.cash).toBe(0);
    expect(r.save.missions).toEqual(['m1']);
    expect(r.save.stats.wasted).toBe(0);
  });

  it('text that is not a save is refused', () => {
    for (const text of ['', '   ', 'hello', '[1,2]', '42', '{"name":"x"}', '{"cash":']) {
      expect(importSave(text, {}).ok).toBe(false);
    }
  });
});
