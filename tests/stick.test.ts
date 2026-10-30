import { describe, expect, it } from 'vitest';
import { AIM_SNAP, aimHeading, aimToward, approachAngle } from '../src/core/aim';
import { WALK_UNTIL, clampToRect, followThumb, footScale, shapeAxis, shapeStick } from '../src/core/stick';
import { PLAYER_ON_FOOT } from '../src/entities/pedestrian';

describe('stick shaping', () => {
  it('has a rescaled deadzone (no jump) and an expo curve', () => {
    const out = { x: 0, y: 0 };
    expect(shapeStick(3, 0, 60, 0.08, 1.5, out)).toBe(0);
    const justOut = shapeStick(60 * 0.09, 0, 60, 0.08, 1.5, out);
    expect(justOut).toBeGreaterThan(0);
    expect(justOut).toBeLessThan(0.01);
    // Half way out reads less than half (fine control), the rim reads full.
    expect(shapeStick(30, 0, 60, 0.08, 1.5, out)).toBeLessThan(0.5);
    expect(shapeStick(0, -200, 60, 0.08, 1.5, out)).toBeCloseTo(1);
    expect(out.y).toBeCloseTo(-1);
    expect(out.x).toBeCloseTo(0);
  });

  it('shapes a single axis the same way, keeping the sign', () => {
    expect(shapeAxis(0.05, 0.08, 1.5)).toBe(0);
    expect(shapeAxis(-1, 0.08, 1.5)).toBe(-1);
    expect(shapeAxis(0.5, 0.08, 1.5)).toBeGreaterThan(0);
    expect(shapeAxis(0.5, 0.08, 1.5)).toBeLessThan(0.5);
  });

  it('drags the origin behind a thumb past the rim', () => {
    const o = { x: 100, y: 100 };
    followThumb(o, 130, 100, 50); // inside: stays
    expect(o).toEqual({ x: 100, y: 100 });
    followThumb(o, 200, 100, 50);
    expect(o.x).toBeCloseTo(150);
    expect(Math.hypot(200 - o.x, 100 - o.y)).toBeCloseTo(50);
  });

  it('clamps a point into a rectangle (centred when the rectangle is inverted)', () => {
    const p = { x: -5, y: 500 };
    clampToRect(p, 10, 100, 0, 300);
    expect(p).toEqual({ x: 10, y: 300 });
    clampToRect(p, 50, 40, 0, 300);
    expect(p.x).toBe(45);
  });

  it('walks up to WALK_UNTIL, then ramps continuously to a run', () => {
    const { walkSpeed, runSpeed } = PLAYER_ON_FOOT;
    const speedAt = (m: number) => footScale(m, walkSpeed, runSpeed) * runSpeed;
    expect(speedAt(0)).toBe(0);
    expect(speedAt(WALK_UNTIL)).toBeCloseTo(walkSpeed);
    expect(speedAt(1)).toBeCloseTo(runSpeed);
    let last = -1;
    for (let m = 0; m <= 1.0001; m += 0.05) {
      const s = speedAt(m);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });
});

describe('aim helpers', () => {
  it('turns toward the aim by at most the step, the short way round', () => {
    expect(approachAngle(0, 0.1, 0.5)).toBeCloseTo(0.1);
    expect(approachAngle(0, 2, 0.5)).toBeCloseTo(0.5);
    expect(approachAngle(3, -3, 0.1)).toBeCloseTo(3.1); // across ±π
  });

  it('aims from the player toward a ground point in screen terms', () => {
    const out = { x: 0, y: 0 };
    aimToward(10, 10, 10, 0, out); // the point is up the screen (-Z)
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(1);
    expect(aimHeading(out.x, out.y)).toBeCloseTo(Math.PI);
    aimToward(0, 0, 0.1, 0.1, out); // under the player: no aim
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('snaps within about 15 degrees', () => {
    expect(AIM_SNAP).toBeGreaterThan(0.2);
    expect(AIM_SNAP).toBeLessThan(0.3);
  });
});
