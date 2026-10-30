import { describe, expect, it } from 'vitest';
import { EXPORT_BASE, EXPORT_MIN_HEALTH, ORDERS_PER_LIST, colourName, exportList, exportPayout, matchesOrder, openOrderFor } from '../src/game/modes/exports';

describe('exports: colours', () => {
  it('names the traffic and respray paints', () => {
    expect(colourName('#e8b923')).toBe('YELLOW');
    expect(colourName('#c8342b')).toBe('RED');
    expect(colourName('#2f6fc0')).toBe('BLUE');
    expect(colourName('#1f2328')).toBe('BLACK');
    expect(colourName('#d9d6cc')).toBe('WHITE');
    expect(colourName('#f2c12e')).toBe('YELLOW'); // taxi livery
    expect(colourName(0x3d7a4a)).toBe('GREEN');
  });
});

describe('exports: the order list', () => {
  it('eight distinct orders, the first list with a yellow sports, a taxi and a police car', () => {
    const list = exportList(0);
    expect(list).toHaveLength(ORDERS_PER_LIST);
    expect(new Set(list.map((o) => o.id)).size).toBe(ORDERS_PER_LIST);
    expect(list.map((o) => o.label)).toEqual(expect.arrayContaining(['YELLOW SPORTS', 'A TAXI', 'A POLICE CAR']));
  });

  it('later lists differ but are always full and distinct', () => {
    for (let n = 1; n < 20; n++) {
      const list = exportList(n);
      expect(list).toHaveLength(ORDERS_PER_LIST);
      expect(new Set(list.map((o) => o.id)).size).toBe(ORDERS_PER_LIST);
      expect(exportList(n)).toEqual(list);
    }
    expect(exportList(1)).not.toEqual(exportList(2));
  });

  it('matches by model and colour; a police unit counts as a police car', () => {
    const [yellowSports] = exportList(0);
    expect(matchesOrder(yellowSports, 'sports', '#e8b923')).toBe(true);
    expect(matchesOrder(yellowSports, 'sports', '#c8342b')).toBe(false);
    expect(matchesOrder(yellowSports, 'sedan', '#e8b923')).toBe(false);
    const cop = exportList(0).find((o) => o.archetype === 'police')!;
    expect(matchesOrder(cop, 'van', '#1f2328', true)).toBe(true);
  });

  it('a car fills the colour-specific order before an "any" one, and never a done one', () => {
    const list = [
      { id: 'sports-any', archetype: 'sports' as const, colour: null, label: '' },
      { id: 'sports-yellow', archetype: 'sports' as const, colour: 'YELLOW', label: '' },
    ];
    expect(openOrderFor(list, [], 'sports', '#e8b923')?.id).toBe('sports-yellow');
    expect(openOrderFor(list, ['sports-yellow'], 'sports', '#e8b923')?.id).toBe('sports-any');
    expect(openOrderFor(list, ['sports-yellow', 'sports-any'], 'sports', '#e8b923')).toBeNull();
    expect(openOrderFor(list, [], 'sedan', '#e8b923')).toBeNull();
  });

  it('pays the base price scaled by health, nothing under half health', () => {
    const any = { id: 'van-any', archetype: 'van' as const, colour: null, label: '' };
    expect(exportPayout(any, 1)).toBe(EXPORT_BASE.van);
    expect(exportPayout(any, 0.8)).toBe(400);
    expect(exportPayout(any, EXPORT_MIN_HEALTH - 0.01)).toBe(0);
    const yellow = { id: 'sports-yellow', archetype: 'sports' as const, colour: 'YELLOW', label: '' };
    expect(exportPayout(yellow, 1)).toBeGreaterThan(EXPORT_BASE.sports);
  });
});
