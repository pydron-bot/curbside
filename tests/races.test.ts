import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_RADIUS,
  GIVE_UP_FACTOR,
  MEDAL_FACTORS,
  RACES,
  RACE_COUNTDOWN,
  RaceRun,
  courseCorners,
  courseLength,
  devTime,
  formatRaceTime,
  nodeX,
  nodeZ,
  raceMedal,
  startGrid,
  validCourse,
} from '../src/game/modes/races';
import { generateCity } from '../src/world/city';

const city = generateCity(1337);

describe('races: courses', () => {
  it('six courses of 8–12 crossings, every leg along one road', () => {
    expect(RACES).toHaveLength(6);
    expect(new Set(RACES.map((r) => r.id)).size).toBe(6);
    for (const r of RACES) expect(validCourse(r), r.id).toBe(true);
  });

  it('rejects diagonal legs, standing still and courses off the map', () => {
    expect(validCourse({ id: 'x', name: '', nodes: [[0, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7]] })).toBe(false);
    expect(validCourse({ id: 'x', name: '', nodes: [[0, 0], [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]] })).toBe(false);
    expect(validCourse({ id: 'x', name: '', nodes: [[0, 0], [0, 9], [1, 9], [2, 9], [3, 9], [4, 9], [5, 9], [6, 9]] })).toBe(false);
  });

  it('length, corners and a developer time to race against', () => {
    const r = RACES.find((c) => c.id === 'race-ring')!;
    expect(courseLength(r)).toBe(32 * 64);
    expect(courseCorners(r)).toBe(2);
    for (const c of RACES) {
      expect(devTime(c)).toBeGreaterThan(20);
      expect(devTime(c)).toBeLessThan(120);
    }
  });

  it('the start grid is on the road, facing the first checkpoint', () => {
    for (const r of RACES) {
      const g = startGrid(r);
      const blocked = city.obstacles.some((o) => g.x > o.minX - 2 && g.x < o.maxX + 2 && g.z > o.minZ - 2 && g.z < o.maxZ + 2);
      expect(blocked, r.id).toBe(false);
      const [a, b] = r.nodes;
      const toward = Math.atan2(nodeX(b) - nodeX(a), nodeZ(b) - nodeZ(a));
      expect(Math.cos(g.heading - toward), r.id).toBeCloseTo(1, 5);
    }
  });
});

describe('races: a run', () => {
  const def = RACES[0];

  it('a faster car taken mid-race tightens the dev time; a slower one never loosens it', () => {
    const run = new RaceRun(def, 1.81);
    expect(run.dev).toBe(devTime(def, 1.81));
    run.takeCar(1);
    expect(run.dev).toBe(devTime(def));
    run.takeCar(1.5);
    expect(run.dev).toBe(devTime(def));
  });

  it('waits for the 3-2-1, then takes the checkpoints in order and finishes', () => {
    const run = new RaceRun(def);
    expect(run.step(0.5, nodeX(def.nodes[1]), nodeZ(def.nodes[1]))).toBeNull();
    run.step(RACE_COUNTDOWN, 0, 0);
    expect(run.phase).toBe('live');
    // The wrong checkpoint doesn't count.
    expect(run.step(0.1, nodeX(def.nodes[2]), nodeZ(def.nodes[2]))).toBeNull();
    for (let i = 1; i < def.nodes.length - 1; i++) {
      expect(run.step(1, nodeX(def.nodes[i]) + CHECKPOINT_RADIUS - 1, nodeZ(def.nodes[i]))).toBe('checkpoint');
      expect(run.passed).toBe(i);
    }
    const last = def.nodes[def.nodes.length - 1];
    expect(run.step(1, nodeX(last), nodeZ(last))).toBe('finish');
    expect(run.phase).toBe('finished');
    expect(run.time).toBeCloseTo(0.1 + (def.nodes.length - 1), 5);
  });

  it('gives up when hopelessly slow', () => {
    const run = new RaceRun(def);
    run.step(RACE_COUNTDOWN + 0.01, 0, 0);
    expect(run.step(run.dev * GIVE_UP_FACTOR + 1, 9999, 9999)).toBe('timeout');
    expect(run.phase).toBe('failed');
  });

  it('medals against the developer time', () => {
    const dev = 60;
    expect(raceMedal(dev * MEDAL_FACTORS.gold, dev)).toBe('gold');
    expect(raceMedal(dev * MEDAL_FACTORS.silver, dev)).toBe('silver');
    expect(raceMedal(dev * MEDAL_FACTORS.bronze, dev)).toBe('bronze');
    expect(raceMedal(dev * MEDAL_FACTORS.bronze + 0.1, dev)).toBeNull();
  });

  it('formats times as m:ss.t', () => {
    expect(formatRaceTime(0)).toBe('0:00.0');
    expect(formatRaceTime(62.37)).toBe('1:02.3');
    expect(formatRaceTime(9.99)).toBe('0:09.9');
  });
});
