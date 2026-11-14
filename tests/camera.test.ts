import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CameraRig, LEAD_CAR, cutawayFor } from '../src/render/cameraRig';

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

  it('keeps a car flat out north or south in the clear band of a landscape phone', () => {
    // 852×393: the activity card and stars reach ~35% down the top centre,
    // the scanner's subtitle starts ~75% down.
    const screenY = (vz: number) => {
      const rig = new CameraRig(852 / 393);
      rig.resize(852 / 393);
      rig.setHeights(26, 64);
      rig.setLead(LEAD_CAR);
      rig.snapTo(0, 0);
      let z = 0;
      for (let i = 0; i < 600; i++) rig.update(1 / 60, 0, (z += vz / 60), 0, vz);
      const p = new Vector3(0, 0.8, z).project(rig.camera);
      return (1 - p.y) / 2;
    };
    for (const speed of [18, 33]) {
      expect(screenY(speed)).toBeGreaterThan(0.38); // heading south: under the stars
      expect(screenY(-speed)).toBeLessThan(0.7); // heading north: over the subtitle
    }
  });
});

describe('camera trial (LOOK panel → CAMERA)', () => {
  const settle = (rig: CameraRig, follow: boolean, onFoot = true) => {
    for (let i = 0; i < 60 * 8; i++) {
      if (follow) rig.follow(1 / 60, 0, 0, 0, 0, onFoot);
      else rig.update(1 / 60, 0, 0, 0, 0);
    }
  };

  it("is today's camera by default", () => {
    const a = new CameraRig(852 / 393);
    const b = new CameraRig(852 / 393);
    a.snapTo(0, 0, 20);
    b.snapTo(0, 0, 20);
    settle(a, true);
    settle(b, false);
    expect(a.camera.position.distanceTo(b.camera.position)).toBeLessThan(1e-6);
    expect(a.camera.fov).toBeCloseTo(b.camera.fov, 6);
  });

  it('applies tilt, on-foot height and lens only while following the player', () => {
    const rig = new CameraRig(852 / 393);
    rig.setHeights(20, 24);
    rig.trial = { cameraTilt: 0.3, footHeight: 1.2, fieldOfView: 1.1 };
    rig.snapTo(0, 0, 20);
    settle(rig, true);
    const h = rig.currentHeight;
    expect(h).toBeCloseTo(24, 1);
    // Behind the look point by tilt × height, toward screen-bottom (+Z).
    expect(rig.camera.position.z).toBeCloseTo(0.3 * h, 2);
    expect(rig.camera.fov).toBeCloseTo(45 * 1.1, 3);
    // In a car the on-foot height doesn't apply.
    settle(rig, true, false);
    expect(rig.currentHeight).toBeCloseTo(20, 1);
    // Title / observe cameras (update) keep the rig's own tilt and lens.
    settle(rig, false);
    expect(rig.camera.position.z).toBeCloseTo(rig.opts.tilt * rig.currentHeight, 2);
    expect(rig.camera.fov).toBeCloseTo(45, 3);
  });
});

describe('building cutaway', () => {
  it("is off at today's tilt and full on the steeper presets", () => {
    expect(cutawayFor(0.12)).toBe(0);
    expect(cutawayFor(0.14)).toBe(0);
    expect(cutawayFor(0.2)).toBe(1);
    expect(cutawayFor(0.3)).toBe(1);
    expect(cutawayFor(0.16)).toBeCloseTo(0.5, 5);
  });

  it('follows the tilt in use: the trial while following, the rig’s own otherwise', () => {
    const rig = new CameraRig(2);
    rig.trial = { cameraTilt: 0.3, footHeight: 1, fieldOfView: 1 };
    rig.follow(1 / 60, 0, 0, 0, 0, true);
    expect(rig.tiltNow).toBe(0.3);
    rig.update(1 / 60, 0, 0, 0, 0);
    expect(rig.tiltNow).toBe(rig.opts.tilt);
  });
});
