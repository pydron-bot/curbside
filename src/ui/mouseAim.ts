/**
 * Mouse aim: cast a ray from the cursor through the camera onto the ground
 * (y = 0) and aim from the player toward that point. Runs once per frame
 * before the game reads Input.readAim(); writes `input.mouse.aimX/aimY`.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import { aimToward } from '../core/aim';
import type { Input } from '../core/input';

const ray = new Vector3();
const hit = { x: 0, z: 0 };
const dir = { x: 0, y: 0 };

/**
 * Ground point under client pixel (cx, cy) of a `w`×`h` view, written into
 * `out`. Returns false when the ray never reaches the ground.
 */
export function groundUnderCursor(
  camera: PerspectiveCamera,
  cx: number,
  cy: number,
  w: number,
  h: number,
  out: { x: number; z: number },
): boolean {
  if (w <= 0 || h <= 0) return false;
  ray.set((cx / w) * 2 - 1, -(cy / h) * 2 + 1, 0.5).unproject(camera).sub(camera.position);
  if (ray.y > -1e-6) return false;
  const t = -camera.position.y / ray.y;
  out.x = camera.position.x + ray.x * t;
  out.z = camera.position.z + ray.z * t;
  return true;
}

/**
 * Update the mouse's aim vector from the player at (px, pz); `w`×`h` is the
 * canvas's client size (it fills the window, so client px map straight on).
 */
export function updateMouseAim(
  input: Input,
  camera: PerspectiveCamera,
  px: number,
  pz: number,
  w: number,
  h: number,
): void {
  const m = input.mouse;
  if (!input.mouseAimLive()) {
    m.aimX = m.aimY = 0;
    return;
  }
  const at = input.mousePosition;
  if (!groundUnderCursor(camera, at.x, at.y, w, h, hit)) {
    m.aimX = m.aimY = 0;
    return;
  }
  aimToward(px, pz, hit.x, hit.z, dir);
  m.aimX = dir.x;
  m.aimY = dir.y;
}
