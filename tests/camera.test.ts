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
});
