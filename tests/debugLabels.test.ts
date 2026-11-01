import { describe, expect, it } from 'vitest';
import {
  LABEL_CAR,
  LABEL_PED,
  LABEL_SPOT,
  LabelBoard,
  carLabel,
  crewLabel,
  describeWorld,
  dogText,
  dropText,
  labelMembers,
  modeSuffix,
  officerText,
  pedLabel,
  raceRank,
  racing,
  secs,
  tenths,
  unitCarText,
  witnessText,
  type CarContext,
  type Label,
  type LabelWorld,
} from '../src/game/debugLabels';
import type { CrowdPed, Vehicle } from '../src/game/population';
import type { PoliceUnit } from '../src/systems/police';
import { DROP_LIFE } from '../src/world/drops';

/** Just the fields the labels read. */
function ped(x: number, z: number, agent: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, body = 'ped_slim'): CrowdPed {
  return {
    agent: { s: { x, z }, mode: 'walk', role: 'civilian', temper: 'calm', ko: false, burning: 0, cower: 0, ...agent },
    model: { bodyKind: body, root: { visible: true } },
    ...extra,
  } as unknown as CrowdPed;
}

function car(x: number, z: number, flags: Record<string, unknown> = {}, damage: Record<string, unknown> = {}): Vehicle {
  return {
    sim: { x, z, heading: 0 },
    ai: { mood: 'calm' },
    damage: { wrecked: false, burning: false, ...damage },
    mesh: { root: { visible: true } },
    ...flags,
  } as unknown as Vehicle;
}

const NO_CARS: CarContext = { driving: null, lastDriven: null, pinned: [] };
const out = (): Label => ({ text: '', cat: 'people', colour: null });

describe('LabelBoard', () => {
  it('keeps only what is in range and in view, nearest first, capped', () => {
    const b = new LabelBoard();
    b.begin(0, 0, 60, { minX: -30, minZ: -20, maxX: 30, maxZ: 20 }, 2);
    const far = ped(25, 0);
    const near = ped(3, 4);
    const mid = ped(0, 10);
    b.ped(far, 'FAR', 'people');
    b.ped(near, 'NEAR', 'people');
    b.ped(mid, 'MID', 'people');
    b.ped(ped(0, 30), 'OUT OF VIEW', 'people');
    b.ped(ped(70, 0), 'OUT OF RANGE', 'people');
    expect(b.count).toBe(3);
    expect(b.finish(10)).toBe(3);
    expect(b.list.slice(0, 3).map((r) => r.text)).toEqual(['NEAR', 'MID', 'FAR']);
    expect(Math.sqrt(b.list[0].d2)).toBe(5);
    b.begin(0, 0, 60, null);
    for (let i = 0; i < 30; i++) b.ped(ped(i, 0), `P${i}`, 'people');
    expect(b.finish(24)).toBe(24);
    expect(b.list[0].text).toBe('P0');
  });

  it('the first label for a target wins (a scene before the fallbacks)', () => {
    const b = new LabelBoard();
    b.begin(0, 0);
    const c = ped(1, 1);
    const v = car(2, 2);
    b.ped(c, 'MEDIC', 'emergency');
    b.ped(c, 'SCENE', 'people');
    b.car(v, 'TOW → car', 'emergency');
    b.car(v, 'PARKED', 'traffic');
    expect(b.count).toBe(2);
    expect(b.list[0]).toMatchObject({ kind: LABEL_PED, text: 'MEDIC', cat: 'emergency' });
    expect(b.list[1]).toMatchObject({ kind: LABEL_CAR, text: 'TOW → car' });
    expect(b.has(c)).toBe(true);
  });

  it('reuses its records between rounds and skips spots that went out', () => {
    const b = new LabelBoard();
    b.begin(0, 0);
    b.spot({ x: 1, z: 0 }, 'DOG', 'people');
    const first = b.list[0];
    b.begin(0, 0);
    b.spot({ x: 1, z: 0, alive: false }, 'FIRE 3s', 'emergency');
    expect(b.count).toBe(0);
    b.spot({ x: 2, z: 0, alive: true }, 'FIRE 9s', 'emergency', '#fff');
    expect(b.list[0]).toBe(first);
    expect(b.list[0]).toMatchObject({ kind: LABEL_SPOT, text: 'FIRE 9s', colour: '#fff' });
  });
});

describe('label text', () => {
  it('times round up and never go negative', () => {
    expect(secs(53.2)).toBe('54s');
    expect(secs(-3)).toBe('0s');
    expect(tenths(2.14)).toBe('2.1s');
    expect(tenths(-1)).toBe('0.0s');
  });

  it('says what someone is doing', () => {
    expect(modeSuffix('fight')).toBe(' (fighting)');
    expect(modeSuffix('down', true)).toBe(' (KO)');
    expect(modeSuffix('down')).toBe(' (down)');
    expect(modeSuffix('walk')).toBe('');
    expect(modeSuffix('arrest')).toBe('');
  });

  it('names the crews in their colours', () => {
    expect(crewLabel('vipers')).toEqual({ name: 'VIPERS', colour: '#8dff2e' });
    expect(crewLabel('cobble-kings')).toEqual({ name: 'COBBLE KINGS', colour: '#c8262c' });
    expect(crewLabel('nobody')).toBeNull();
  });

  it('witnesses, dogs, drops and the police', () => {
    expect(witnessText('call', 'calling', 2.14)).toBe('WITNESS (calling 2.1s)');
    expect(witnessText('call', 'through', 0)).toBe('WITNESS (call through)');
    expect(witnessText('film', 'idle', 0)).toBe('WITNESS (filming)');
    expect(dogText('chase')).toBe('DOG (chasing)');
    expect(dogText('trot')).toBe('DOG');
    expect(dropText({ kind: 'pistol', at: 100 }, 100 + DROP_LIFE - 30.5)).toBe('DROP: pistol 31s');
    expect(officerText({ kind: 'patrol', role: 'pursuit', dismissed: false })).toBe('COP (pursuit)');
    expect(officerText({ kind: 'swat', role: 'roadblock', dismissed: false })).toBe('SWAT (roadblock)');
    expect(officerText({ kind: 'bike', role: 'pursuit', dismissed: true })).toBe('COP (returning)');
    expect(unitCarText({ kind: 'bike', role: 'pursuit', dismissed: false })).toBe('POLICE BIKE (pursuit)');
    expect(unitCarText({ kind: 'swat', role: 'roadblock', dismissed: false })).toBe('SWAT VAN (roadblock)');
  });

  it('places racers by legs reached, then by who is ahead on the same leg', () => {
    const r = (leg: number, z: number, done = false) => ({ leg, done, v: { sim: { x: 0, z, heading: 0 } } });
    // Heading 0 faces +z.
    const racers = [r(2, 10), r(3, 0), r(2, 30), r(4, 0, true)];
    expect(racing(racers)).toBe(3);
    expect(raceRank(racers, 1)).toBe(1);
    expect(raceRank(racers, 2)).toBe(2);
    expect(raceRank(racers, 0)).toBe(3);
    expect(raceRank(racers, 3)).toBe(0);
  });

  it('numbers a queue from the front', () => {
    const b = new LabelBoard();
    b.begin(0, 0);
    labelMembers(b, [ped(1, 0), ped(2, 0), ped(3, 0)], 'QUEUE', true);
    labelMembers(b, [ped(4, 0)], 'ONLOOKER', false);
    b.finish();
    expect(b.list.slice(0, 4).map((x) => x.text)).toEqual(['QUEUE 1', 'QUEUE 2', 'QUEUE 3', 'ONLOOKER']);
  });
});

describe('fallback labels from flags', () => {
  it('people: story characters, gangs, officers, the hurt, the scared; nothing for a passer-by', () => {
    expect(pedLabel(ped(0, 0), out())).toBeNull();
    expect(pedLabel(ped(0, 0, {}, {}, 'vex'), out())).toMatchObject({ text: 'VEX', cat: 'mission' });
    expect(pedLabel(ped(0, 0, { gang: 'vipers', mode: 'fight' }), out())).toEqual({ text: 'VIPERS (fighting)', cat: 'gang', colour: '#8dff2e' });
    expect(pedLabel(ped(0, 0, { gang: 'dock-rats' }), out())).toEqual({ text: 'DOCK RATS', cat: 'gang', colour: '#f08a1c' });
    expect(pedLabel(ped(0, 0, { role: 'cop', mode: 'shoot' }), out())).toMatchObject({ text: 'COP (shooting)', cat: 'police' });
    expect(pedLabel(ped(0, 0, { injured: true, mode: 'down', ko: true }), out())).toMatchObject({ text: 'INJURED', cat: 'emergency' });
    expect(pedLabel(ped(0, 0, {}, { phone: true }), out())).toMatchObject({ text: 'ON PHONE' });
    expect(pedLabel(ped(0, 0, { mode: 'down', ko: true }), out())).toMatchObject({ text: 'KO', cat: 'people' });
    expect(pedLabel(ped(0, 0, { mode: 'flee' }), out())).toMatchObject({ text: 'FLEEING' });
    expect(pedLabel(ped(0, 0, { mode: 'flee', cower: 1 }), out())).toMatchObject({ text: 'COWERING' });
    expect(pedLabel(ped(0, 0, { scene: true, mode: 'arrest' }), out())).toMatchObject({ text: 'SCENE' });
  });

  it("cars: parked, crashed, wrecks, the police, activities; nothing for traffic or the player's car", () => {
    const traffic = car(0, 0);
    expect(carLabel(traffic, NO_CARS, out())).toBeNull();
    expect(carLabel(traffic, { ...NO_CARS, driving: traffic }, out())).toBeNull();
    expect(carLabel(traffic, { ...NO_CARS, pinned: [traffic] }, out())).toMatchObject({ text: 'ACTIVITY CAR', cat: 'mission' });
    expect(carLabel(car(0, 0, { parked: true, ai: null }), NO_CARS, out())).toMatchObject({ text: 'PARKED', cat: 'traffic' });
    expect(carLabel(car(0, 0, { towable: true, ai: null }), NO_CARS, out())).toMatchObject({ text: 'CRASHED (towable)' });
    expect(carLabel(car(0, 0, {}, { wrecked: true, burning: true }), NO_CARS, out())).toMatchObject({ text: 'WRECK (burning)' });
    expect(carLabel(car(0, 0, { police: true, emergency: true }), NO_CARS, out())).toMatchObject({ text: 'POLICE (lights)', cat: 'police' });
    expect(carLabel(car(0, 0, { ai: null }), NO_CARS, out())).toMatchObject({ text: 'EMPTY' });
    const last = car(0, 0, { ai: null });
    expect(carLabel(last, { ...NO_CARS, lastDriven: last }, out())).toMatchObject({ text: 'YOUR LAST CAR' });
  });

  it("describeWorld: the player's police and dropped guns, then flags, never over a scene's label", () => {
    const officer = ped(2, 0, { role: 'cop', mode: 'arrest' });
    const stray = ped(3, 0, { role: 'cop' });
    const patrol = car(4, 0, { police: true, emergency: true });
    const unit = { kind: 'patrol', role: 'pursuit', dismissed: false, vehicle: patrol, officers: [officer] } as unknown as PoliceUnit;
    const medic = ped(1, 0, { scene: true, mode: 'arrest' });
    const walker = ped(5, 0);
    const parked = car(6, 0, { parked: true, ai: null });
    const hidden = car(7, 0, { parked: true, ai: null, mesh: { root: { visible: false } } });
    const w: LabelWorld = {
      ...NO_CARS,
      crowd: [medic, officer, stray, walker],
      vehicles: [patrol, parked, hidden],
      police: { units: [unit], strays: [stray] },
      drops: [{ kind: 'smg', x: 8, z: 0, at: 0, alive: true }, { kind: 'pistol', x: 9, z: 0, at: 0, alive: false }],
      now: 10,
    };
    const b = new LabelBoard();
    b.begin(0, 0);
    b.ped(medic, 'MEDIC', 'emergency');
    describeWorld(b, w);
    b.finish();
    expect(b.list.slice(0, b.count).map((r) => r.text)).toEqual(['MEDIC', 'COP (pursuit)', 'COP (stray)', 'POLICE (pursuit)', 'PARKED', `DROP: smg ${DROP_LIFE - 10}s`]);
  });
});
