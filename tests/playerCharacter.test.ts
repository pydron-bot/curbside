import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/core/settings';
import { BODY_KINDS, CROWD_BODIES, playerBody } from '../src/game/bodies';
import { CharacterBodies } from '../src/render/characterBodies';

describe('the player character (title → CHARACTER)', () => {
  it('is stored as male or female, defaulting to male', () => {
    expect(DEFAULT_SETTINGS.character).toBe('male');
    expect(sanitizeSettings({ character: 'female' }).character).toBe('female');
    for (const bad of ['other', 1, null, {}, 'toString']) expect(sanitizeSettings({ character: bad }).character).toBe('male');
  });

  it('maps to the two player bodies, which the crowd wears too (in other clothes)', () => {
    expect(playerBody('male')).toBe('player');
    expect(playerBody('female')).toBe('player_f');
    expect(BODY_KINDS).toContain('player_f');
    const crowd = CROWD_BODIES.map(([k]) => k);
    expect(crowd).toContain('player');
    expect(crowd).toContain('player_f');
    expect(CROWD_BODIES.reduce((s, [, w]) => s + w, 0)).toBeCloseTo(1, 6);
  });

  it('moves the player to the other body’s batch and back, keeping the model', () => {
    const bodies = new CharacterBodies(false);
    const m = bodies.create({ shirt: '#ff0000' });
    const batch = (kind: string) => bodies.batches.find((b) => b.kind === kind)!;
    expect(m.bodyKind).toBe('player');
    bodies.setBody(m, 'player_f');
    expect(m.bodyKind).toBe('player_f');
    expect(batch('player_f').models).toContain(m);
    expect(batch('player').models).not.toContain(m);
    bodies.setBody(m, 'player_f'); // no-op
    expect(batch('player_f').models.filter((x) => x === m)).toHaveLength(1);
    bodies.setBody(m, 'player');
    expect(batch('player').models).toContain(m);
    expect(batch('player_f').models).not.toContain(m);
  });
});
