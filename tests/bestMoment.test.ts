import { describe, expect, it } from 'vitest';
import { BestMoment, beats, momentCaption, momentFileName } from '../src/systems/bestMoment';
import { STAMPS, STAMP_IDS } from '../src/systems/stamps';
import { DISTRICT_NAMES, districtAt } from '../src/world/districts';

describe('best moment', () => {
  it('ranks by stamp weight; a tie keeps the first', () => {
    expect(beats('lastOrders', null)).toBe(true);
    expect(beats('barbecueSeason', 'lastOrders')).toBe(true);
    expect(beats('lastOrders', 'barbecueSeason')).toBe(false);
    expect(STAMPS.barbecueSeason.weight).toBe(STAMPS.faresPlease.weight);
    expect(beats('faresPlease', 'barbecueSeason')).toBe(false);
    expect(beats('bonfireNight', 'takeTheHeat')).toBe(true);
  });

  it('every stamp beats nothing and never beats itself', () => {
    for (const id of STAMP_IDS) {
      expect(beats(id, null)).toBe(true);
      expect(beats(id, id)).toBe(false);
    }
  });

  it('keeps the life best: a later heavier one replaces it, a lighter one does not', () => {
    const b = new BestMoment();
    expect(b.has).toBe(false);
    expect(b.offer('bowledOver', 1, 2, 20)).toBe(true);
    expect(b.offer('lastOrders', 3, 4, 21)).toBe(false);
    expect(b.moment).toEqual({ id: 'bowledOver', x: 1, z: 2, hour: 20 });
    expect(b.offer('endangeredPandas', 5, 6, 22)).toBe(true);
    expect(b.offer('healthAndSafety', 7, 8, 23)).toBe(false); // same weight: the first stays
    expect(b.moment).toEqual({ id: 'endangeredPandas', x: 5, z: 6, hour: 22 });
  });

  it('starts over on a new life', () => {
    const b = new BestMoment();
    b.offer('bonfireNight', 0, 0, 12);
    b.reset();
    expect(b.has).toBe(false);
    expect(b.offer('lastOrders', 0, 0, 12)).toBe(true);
    expect(b.moment.id).toBe('lastOrders');
  });

  it('captions the stamp with its line, where and when', () => {
    const c = momentCaption({ id: 'barbecueSeason', x: 40, z: -60, hour: 21.12 });
    expect(c.label).toBe('BARBECUE SEASON');
    expect(c.line).toBe('three cars, one match');
    expect(c.tone).toBe('mayhem');
    expect(c.where).toBe(`${DISTRICT_NAMES[districtAt(40, -60)]} · 21:07`);
    expect(c.text).toBe(`BARBECUE SEASON — three cars, one match (${c.where}) #Curbside`);
    expect(momentCaption({ id: 'absoluteScenes', x: 0, z: 0, hour: 0 }).line).toBe('×10 combo');
    expect(momentCaption({ id: 'takeTheHeat', x: 0, z: 0, hour: 23.99 }).where).toMatch(/· 23:59$/);
  });

  it('names the file after the stamp and the local time', () => {
    const at = new Date(2026, 10, 2, 9, 5, 7);
    expect(momentFileName('barbecueSeason', at)).toBe('curbside-barbecue-season-20261102-090507.jpg');
    expect(momentFileName('citizensArrest', at)).toBe('curbside-citizens-arrest-20261102-090507.jpg');
    expect(momentFileName('haveAGo', at)).toBe('curbside-have-a-go-hero-20261102-090507.jpg');
  });
});
