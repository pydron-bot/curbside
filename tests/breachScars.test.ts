import { describe, expect, it } from 'vitest';
import { BREACH_FRAGMENT_GLSL, BREACH_VERTEX_GLSL, BreachScars, createBreachUniforms } from '../src/render/breachScars';
import { MAX_BREACHES } from '../src/systems/breaches';

function scars() {
  const u = createBreachUniforms();
  return { u, s: new BreachScars(u) };
}

describe('breach scars (building shader slots)', () => {
  it('writes a slot: centre and radius in A, side, depth, seed and birth in B', () => {
    const { u, s } = scars();
    s.write(3, 10, 1.2, -11, 1.7, 2, 0.7, 0.25, false, 42);
    expect(Array.from(u.uBreachA.value.slice(12, 16))).toEqual([10, Math.fround(1.2), -11, Math.fround(1.7)]);
    expect(Array.from(u.uBreachB.value.slice(12, 16))).toEqual([2, Math.fround(0.7), 0.25, 42]);
    expect(u.uBreachN.value).toBe(4);
    expect(s.visible).toBe(1);
    expect(s.isVisible(3)).toBe(true);
  });

  it('a merge rewrites its slot in place (bigger, hot again)', () => {
    const { u, s } = scars();
    s.write(0, 10, 1.2, -11, 1.5, 2, 0.6, 0.1, true, 5);
    s.write(0, 10.2, 1.3, -11, 2.1, 2, 0.8, 0.3, true, 9);
    expect(s.visible).toBe(1);
    expect(u.uBreachA.value[3]).toBeCloseTo(2.1);
    expect(u.uBreachB.value[3]).toBe(9);
    expect(u.uBreachN.value).toBe(1);
  });

  it('the cap hides the oldest scars, never the newest, and they come back if it grows', () => {
    const { u, s } = scars();
    s.setCap(2);
    s.write(5, 0, 1, 0, 1, 0, 0.5, 0, false, 0);
    s.write(1, 0, 1, 0, 1.1, 0, 0.5, 0, false, 0);
    s.write(9, 0, 1, 0, 1.2, 0, 0.5, 0, false, 0);
    expect(s.visible).toBe(2);
    expect(s.isVisible(5)).toBe(false);
    expect(s.isVisible(1)).toBe(true);
    expect(s.isVisible(9)).toBe(true);
    s.setCap(1);
    expect(s.isVisible(9)).toBe(true);
    expect(s.visible).toBe(1);
    s.setCap(0); // clamped to 1: the newest always shows
    expect(s.isVisible(9)).toBe(true);
    s.setCap(32);
    expect(s.visible).toBe(3);
    expect(u.uBreachA.value[5 * 4 + 3]).toBeCloseTo(1);
  });

  it('uBreachN tracks the highest drawn slot', () => {
    const { u, s } = scars();
    s.write(2, 0, 1, 0, 1, 0, 0.5, 0, false, 0);
    s.write(17, 0, 1, 0, 1, 0, 0.5, 0, false, 0);
    expect(u.uBreachN.value).toBe(18);
    s.setCap(1);
    s.write(4, 0, 1, 0, 1, 0, 0.5, 0, false, 0);
    expect(u.uBreachN.value).toBe(5); // 17 and 2 hidden
  });

  it('the rich bit rides on B.x (side + 4) and restyle rewrites it', () => {
    const { u, s } = scars();
    s.write(0, 0, 1, 0, 1, 3, 0.5, 0, true, 0);
    s.write(1, 0, 1, 0, 1, 1, 0.5, 0, false, 0);
    expect(u.uBreachB.value[0]).toBe(7);
    expect(u.uBreachB.value[4]).toBe(1);
    s.restyle(true);
    expect(u.uBreachB.value[0]).toBe(7);
    expect(u.uBreachB.value[4]).toBe(5);
    s.restyle(false);
    expect(u.uBreachB.value[0]).toBe(3);
    expect(u.uBreachB.value[4]).toBe(1);
    expect(u.uBreachB.value[8]).toBe(0); // empty slots untouched
  });

  it('clear zeroes everything', () => {
    const { u, s } = scars();
    for (let i = 0; i < MAX_BREACHES; i++) s.write(i, i, 1, 0, 1, 0, 0.5, 0.5, true, 1);
    expect(s.visible).toBe(MAX_BREACHES);
    s.clear();
    expect(s.visible).toBe(0);
    expect(u.uBreachN.value).toBe(0);
    expect(u.uBreachA.value.every((v) => v === 0)).toBe(true);
    expect(u.uBreachB.value.every((v) => v === 0)).toBe(true);
  });

  it('every line of the GLSL is behind CURBSIDE_BREACH (off is the city program as it was)', () => {
    for (const src of [BREACH_VERTEX_GLSL, BREACH_FRAGMENT_GLSL]) {
      const t = src.trim();
      expect(t.startsWith('#ifdef CURBSIDE_BREACH')).toBe(true);
      expect(t.endsWith('#endif')).toBe(true);
      expect(t.match(/#ifdef|#if /g)!.length).toBe(1);
    }
    expect(BREACH_VERTEX_GLSL).toContain(`uBreachA[${MAX_BREACHES}]`);
    expect(BREACH_VERTEX_GLSL).not.toContain('uBreachB'); // fragment-only (fewer vertex uniforms)
  });
});
