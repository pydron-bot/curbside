/**
 * Prune for newcomers (V2-17): what the title offers each kind of save
 * (game/opening.ts titleOffer), OBSERVE's gate with Test tools, and
 * PROGRESS's STILL TO COME list.
 */
import { describe, expect, it } from 'vitest';
import { SAFEHOUSE } from '../src/game/modes/places';
import {
  OPENING_JOB,
  SIDE_MODES,
  SIDE_MODES_AFTER,
  SIDE_MODES_AFTER_TITLE,
  pastOpening,
  stillToCome,
  titleOffer,
} from '../src/game/opening';
import { defaultSave, migrateSave } from '../src/game/progressSave';
import { buildMissions } from '../src/systems/missionsData';

const afterOpening = () => ({ ...defaultSave(), opening: true });
const afterS2 = () => ({ ...defaultSave(), opening: true, missions: [OPENING_JOB, SIDE_MODES_AFTER] });
const veteran = () => migrateSave({ v: 1, cash: 4200, missions: ['m1-audition'], stats: { playTime: 3600 } });

describe('the title per save', () => {
  it('a fresh save: PLAY and SETTINGS only; Test tools add OBSERVE and nothing else', () => {
    expect(titleOffer(defaultSave(), false)).toEqual({ extras: false, observe: false, sideModes: false });
    expect(titleOffer(defaultSave(), true)).toEqual({ extras: false, observe: true, sideModes: false });
    // Barely played (under 2 minutes) before the cold open existed: still new.
    expect(titleOffer(migrateSave({ v: 1, cash: 10, stats: { playTime: 30 } }), false)).toEqual({ extras: false, observe: false, sideModes: false });
  });

  it('after the cold open: OBSERVE, CHARACTER and HOW TO PLAY; the Chaos Run waits for story job 2', () => {
    expect(titleOffer(afterOpening(), false)).toEqual({ extras: true, observe: true, sideModes: false });
    expect(titleOffer(afterS2(), false)).toEqual({ extras: true, observe: true, sideModes: true });
  });

  it("a veteran's save from before the cold open sees everything, as before", () => {
    const vet = veteran();
    expect(titleOffer(vet, false)).toEqual({ extras: true, observe: true, sideModes: true });
    expect(titleOffer(migrateSave(JSON.parse(JSON.stringify(vet))), false)).toEqual({ extras: true, observe: true, sideModes: true });
  });

  it("REPLAY OPENING (the flag cleared) doesn't take a played save's title back to a newcomer's", () => {
    expect(pastOpening({ opening: false, missions: [OPENING_JOB], unlocks: [] })).toBe(true);
    expect(titleOffer({ ...veteran(), opening: false }, false)).toEqual({ extras: true, observe: true, sideModes: true });
    expect(pastOpening({ opening: false, missions: [], unlocks: [] })).toBe(false);
  });
});

describe('STILL TO COME', () => {
  it('a fresh save: OBSERVE after the getaway, the side modes after story job 2', () => {
    const c = stillToCome(defaultSave())!;
    expect(c.rows.map((r) => r.label)).toEqual(['Observe: watch the city, no player']);
    expect(c.chips!.label).toContain(SIDE_MODES_AFTER_TITLE);
    expect(c.chips!.items.map((i) => i.text)).toEqual([...SIDE_MODES]);
    expect(c.chips!.items.every((i) => !i.done)).toBe(true);
  });

  it('after the cold open only the side modes are to come; after story job 2 (or for a veteran) nothing is', () => {
    const c = stillToCome(afterOpening())!;
    expect(c.rows).toEqual([]);
    expect(c.chips!.items).toHaveLength(SIDE_MODES.length);
    expect(stillToCome(afterS2())).toBeNull();
    expect(stillToCome(veteran())).toBeNull();
  });

  it('names the job that opens them by its title in the story data', () => {
    const job = buildMissions({ x: 0, z: 0 }, SAFEHOUSE).find((m) => m.id === SIDE_MODES_AFTER)!;
    expect(job.title).toBe(SIDE_MODES_AFTER_TITLE);
  });
});
