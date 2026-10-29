import { describe, expect, it } from 'vitest';
import { PLAYER_ON_FOOT, createPedState, stepPedestrian, type MoveInput, type PedState } from '../src/entities/pedestrian';

const DT = 1 / 60;
function run(s: PedState, m: MoveInput, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepPedestrian(s, m, PLAYER_ON_FOOT, DT);
}

describe('pedestrian movement', () => {
  it('stands still with no input', () => {
    const s = createPedState();
    run(s, { x: 0, y: 0, sprint: false }, 1);
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('walks up the screen (-Z) at walk speed and faces that way', () => {
    const s = createPedState(0, 0, 0); // start facing down-screen
    run(s, { x: 0, y: 1, sprint: false }, 2);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(PLAYER_ON_FOOT.walkSpeed);
    expect(s.z).toBeLessThan(-3);
    expect(Math.abs(s.x)).toBeLessThan(1e-9);
    expect(Math.cos(s.heading)).toBeCloseTo(-1); // turned around to face -Z
  });

  it('walks right (+X)', () => {
    const s = createPedState();
    run(s, { x: 1, y: 0, sprint: false }, 1);
    expect(s.x).toBeGreaterThan(1.5);
    expect(Math.sin(s.heading)).toBeCloseTo(1);
  });

  it('sprints faster than walking', () => {
    const s = createPedState();
    run(s, { x: 1, y: 0, sprint: true }, 1);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(PLAYER_ON_FOOT.runSpeed);
  });

  it('normalises diagonals so they are not faster', () => {
    const s = createPedState();
    run(s, { x: 1, y: 1, sprint: false }, 1);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(PLAYER_ON_FOOT.walkSpeed);
  });

  it('scales speed with partial stick and stops when released', () => {
    const s = createPedState();
    run(s, { x: 0.5, y: 0, sprint: false }, 1);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(PLAYER_ON_FOOT.walkSpeed * 0.5);
    run(s, { x: 0, y: 0, sprint: false }, 0.5);
    expect(Math.hypot(s.vx, s.vz)).toBe(0);
  });

  it('keeps heading when input is released', () => {
    const s = createPedState();
    run(s, { x: 1, y: 0, sprint: false }, 0.5);
    const h = s.heading;
    run(s, { x: 0, y: 0, sprint: false }, 0.5);
    expect(s.heading).toBe(h);
  });
});
