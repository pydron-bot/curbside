import { describe, expect, it } from 'vitest';
import { GANGS } from '../src/game/gangs';
import {
  FLEE_HP,
  RIVALS,
  SKIRMISH_TIME,
  createSkirmish,
  crewOn,
  friendly,
  isGang,
  outcome,
  over,
  playerStrikes,
  runsFor,
  turfBorders,
} from '../src/systems/turfWar';
import { districtAt } from '../src/world/districts';
import { BLOCK_SIZE, ROAD_WIDTH, SIDEWALK, generateCity } from '../src/world/city';

describe('turf war: crews and borders', () => {
  it('every district round the gangs\' turf has a crew; the gangs own theirs', () => {
    expect(crewOn('arts')?.id).toBe('vipers');
    expect(isGang(crewOn('arts')!)).toBe(true);
    for (const r of RIVALS) {
      expect(crewOn(r.turf)).toBe(r);
      expect(isGang(r)).toBe(false);
      expect(GANGS.some((g) => g.turf === r.turf)).toBe(false);
    }
    expect(crewOn('residential')).toBe(null);
  });

  it('borders lie on the pavement where a gang\'s turf faces a rival\'s across the road', () => {
    const borders = turfBorders();
    expect(borders.length).toBeGreaterThan(6);
    const city = generateCity(1337);
    for (const b of borders) {
      expect(isGang(b.home) || isGang(b.away)).toBe(true);
      expect(b.home.id).not.toBe(b.away.id);
      expect(districtAt(b.x, b.z)).toBe(b.home.turf);
      // Over the road (a pavement and a road's width) toward `out` is the other crew's.
      const across = SIDEWALK + ROAD_WIDTH;
      expect(districtAt(b.x + b.outX * across, b.z + b.outZ * across)).toBe(b.away.turf);
      expect(Math.hypot(b.alongX, b.alongZ)).toBeCloseTo(1);
      expect(b.alongX * b.outX + b.alongZ * b.outZ).toBeCloseTo(0);
      // Toward the kerb: a step that way is still off the buildings.
      expect(city.buildings.some((r) => b.x + b.outX > r.minX && b.x + b.outX < r.maxX && b.z + b.outZ > r.minZ && b.z + b.outZ < r.maxZ)).toBe(false);
      // On the pavement: inside no building, and mid-block.
      expect(city.buildings.some((r) => b.x > r.minX && b.x < r.maxX && b.z > r.minZ && b.z < r.maxZ)).toBe(false);
      const off = (v: number) => (((v % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE);
      expect(Math.min(off(b.x), off(b.z))).toBeGreaterThan(ROAD_WIDTH / 2);
    }
    // Both ways round: the VIPERS defend theirs, and go over to the rivals'.
    expect(borders.some((b) => b.home.id === 'vipers')).toBe(true);
    expect(borders.some((b) => b.away.id === 'vipers')).toBe(true);
  });
});

describe('turf war: a skirmish', () => {
  it('the side the player hits turns on them; the other stands with them', () => {
    const s = createSkirmish();
    expect(friendly(s, 0)).toBe(false);
    expect(friendly(s, 1)).toBe(false);
    expect(playerStrikes(s, 0)).toBe(true);
    expect(s.foe).toEqual([true, false]);
    expect(friendly(s, 1)).toBe(true);
    expect(friendly(s, 0)).toBe(false);
    expect(playerStrikes(s, 0)).toBe(false);
    // Hit both and nobody's your friend.
    expect(playerStrikes(s, 1)).toBe(true);
    expect(friendly(s, 1)).toBe(false);
  });

  it('is won by the side left standing', () => {
    expect(outcome(2, 3)).toBe(null);
    expect(outcome(0, 1)).toBe(1);
    expect(outcome(2, 0)).toBe(0);
    expect(outcome(0, 0)).toBe('none');
  });

  it('is over when one side is out, unless the winners have the player to settle with', () => {
    const s = createSkirmish();
    expect(over(s, 2, 2, true, 10)).toBe(false);
    expect(over(s, 2, 0, true, 10)).toBe(true);
    playerStrikes(s, 0);
    // Side 0 won but turned on the player, who's still close: not over yet.
    expect(over(s, 2, 0, true, 10)).toBe(false);
    expect(over(s, 2, 0, false, 10)).toBe(true);
    // The player's side won: over.
    expect(over(s, 0, 2, true, 10)).toBe(true);
    expect(over(s, 0, 0, true, 10)).toBe(true);
    // Called off after its time, whatever.
    expect(over(s, 3, 3, true, SKIRMISH_TIME + 1)).toBe(true);
  });

  it('only the badly hurt run for it', () => {
    expect(runsFor(100, 0)).toBe(false);
    expect(runsFor(FLEE_HP + 1, 0)).toBe(false);
    expect(runsFor(FLEE_HP - 1, 0.1)).toBe(true);
    expect(runsFor(FLEE_HP - 1, 0.9)).toBe(false);
  });
});
