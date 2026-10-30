import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/render/cameraRig';

describe('camera rig', () => {
  it('projects the view onto the ground around where it looks', () => {
    const rig = new CameraRig(852 / 393);
    rig.snapTo(100, -50);
    const r = rig.visibleGround({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 });
    const h = rig.currentHeight;
    const halfV = h * Math.tan((22.5 * Math.PI) / 180);
    // Roughly ±h·tan(fov/2) vertically and aspect times that horizontally.
    expect(r.maxZ - r.minZ).toBeGreaterThan(halfV * 1.9);
    expect(r.maxZ - r.minZ).toBeLessThan(halfV * 2.4);
    expect(r.maxX - r.minX).toBeGreaterThan(halfV * 2 * 2);
    expect(r.minX).toBeLessThan(100);
    expect(r.maxX).toBeGreaterThan(100);
    expect(r.minZ).toBeLessThan(-50);
    expect(r.maxZ).toBeGreaterThan(-50);
    expect(rig.focusX).toBe(100);
  });

  it('leans toward the aim when asked (eased), and back when it stops', () => {
    const rig = new CameraRig(16 / 9);
    rig.snapTo(0, 0);
    rig.aimAt(6, -3);
    for (let i = 0; i < 60 * 4; i++) rig.update(1 / 60, 0, 0, 0, 0);
    expect(rig.focusX).toBeCloseTo(6, 1);
    expect(rig.focusZ).toBeCloseTo(-3, 1);
    rig.aimAt(0, 0);
    for (let i = 0; i < 60 * 4; i++) rig.update(1 / 60, 0, 0, 0, 0);
    expect(Math.hypot(rig.focusX, rig.focusZ)).toBeLessThan(0.1);
    rig.aimAt(5, 5);
    rig.snapTo(10, 10); // a respawn drops it
    rig.update(1 / 60, 10, 10, 0, 0);
    expect(rig.focusX).toBeCloseTo(10, 0);
  });
});
