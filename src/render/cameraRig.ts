import { PerspectiveCamera, Vector3 } from 'three';
import type { Rect } from '../world/city';

/** NDC corners of the screen, for projecting the view onto the ground. */
const SCREEN_CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

/**
 * Near-overhead chase camera: looks almost straight down with a slight tilt
 * (so building sides show a little parallax), leads in the direction of travel,
 * and climbs as speed rises so you can see what's coming.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  private x = 0;
  private z = 0;
  private height: number;
  private shakeAmount = 0;
  private readonly corner = new Vector3();

  constructor(
    aspect: number,
    readonly opts = {
      minHeight: 26,
      maxHeight: 58,
      /** Height gained per m/s of speed. */
      heightPerSpeed: 0.9,
      /** Seconds of velocity to look ahead. */
      leadSeconds: 0.55,
      /** Camera sits this fraction of its height behind (toward screen-bottom, +Z). */
      tilt: 0.12,
      followRate: 6,
      zoomRate: 1.6,
    },
  ) {
    this.camera = new PerspectiveCamera(45, aspect, 0.5, 400);
    this.camera.up.set(0, 0, -1); // screen-up is world -Z
    this.height = opts.minHeight;
  }

  /** Switch zoom range, e.g. lower and tighter on foot. Height eases over. */
  setHeights(min: number, max: number): void {
    this.opts.minHeight = min;
    this.opts.maxHeight = max;
  }

  /** Add screen shake (metres of jitter), e.g. for explosions. */
  shake(amount: number): void {
    this.shakeAmount = Math.min(3, this.shakeAmount + amount);
  }

  snapTo(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.apply();
  }

  update(dt: number, targetX: number, targetZ: number, vx: number, vz: number): void {
    const o = this.opts;
    const speed = Math.hypot(vx, vz);
    const lx = targetX + vx * o.leadSeconds;
    const lz = targetZ + vz * o.leadSeconds;
    const follow = 1 - Math.exp(-o.followRate * dt);
    this.x += (lx - this.x) * follow;
    this.z += (lz - this.z) * follow;

    const wantHeight = Math.min(o.maxHeight, o.minHeight + speed * o.heightPerSpeed);
    this.height += (wantHeight - this.height) * (1 - Math.exp(-o.zoomRate * dt));
    this.shakeAmount *= Math.exp(-5 * dt);
    this.apply();
  }

  /** Ground point the camera is centred on (the player plus look-ahead). */
  get focusX(): number {
    return this.x;
  }

  get focusZ(): number {
    return this.z;
  }

  /** Current camera height, m. */
  get currentHeight(): number {
    return this.height;
  }

  /**
   * The patch of ground (y = 0) the camera can see right now, as the bounding
   * box of the four screen corners projected onto it. Spawning outside this
   * keeps people and cars from popping into view. Writes into `out`.
   */
  visibleGround(out: Rect): Rect {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const { x: px, y: py, z: pz } = cam.position;
    out.minX = out.minZ = Infinity;
    out.maxX = out.maxZ = -Infinity;
    for (const [nx, ny] of SCREEN_CORNERS) {
      // Unit ray from the camera through this corner of the screen.
      const dir = this.corner.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
      // Distance along it to the ground; a ray that never gets there stops at the far plane.
      const t = dir.y < -1e-6 ? Math.min(-py / dir.y, cam.far) : cam.far;
      const gx = px + dir.x * t;
      const gz = pz + dir.z * t;
      out.minX = Math.min(out.minX, gx);
      out.maxX = Math.max(out.maxX, gx);
      out.minZ = Math.min(out.minZ, gz);
      out.maxZ = Math.max(out.maxZ, gz);
    }
    return out;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    // In portrait, widen the vertical FOV so the horizontal view isn't cramped.
    this.camera.fov = aspect < 1 ? 62 : 45;
    this.camera.updateProjectionMatrix();
  }

  private apply(): void {
    const back = this.height * this.opts.tilt;
    const jx = (Math.random() - 0.5) * this.shakeAmount;
    const jz = (Math.random() - 0.5) * this.shakeAmount;
    this.camera.position.set(this.x + jx, this.height, this.z + back + jz);
    this.camera.lookAt(this.x + jx, 0, this.z + jz);
  }
}
