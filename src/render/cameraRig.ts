import { PerspectiveCamera, Vector3 } from 'three';
import type { Rect } from '../world/city';
import { Spring, Trauma, smoothNoise, softClamp } from './fxMotion';

/** NDC corners of the screen, for projecting the view onto the ground. */
const SCREEN_CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

/** Look-ahead: how far ahead the camera leads, per screen axis. */
export interface LeadSettings {
  /** Seconds of velocity to lead by (before the soft limit). */
  seconds: number;
  /** Most lead across the screen, as a fraction of the visible half-width. */
  maxX: number;
  /** Most lead up/down the screen, as a fraction of the visible half-height. */
  maxZ: number;
}

/** Driving: ~1.5 s of road ahead up the screen without the car dropping under the thumbs. */
export const LEAD_CAR: LeadSettings = { seconds: 1.25, maxX: 0.38, maxZ: 0.55 };
/** On foot: a gentle nudge toward where you're going. */
export const LEAD_FOOT: LeadSettings = { seconds: 0.45, maxX: 0.22, maxZ: 0.28 };

const DEG = Math.PI / 180;

/**
 * Near-overhead chase camera: looks almost straight down with a slight tilt
 * (so building sides show a little parallax), leads in the direction of
 * travel, and climbs as speed rises so you can see what's coming.
 *
 * Feel:
 *  - Look-ahead per screen axis, soft-limited to a fraction of what's visible
 *    on that axis (a landscape phone has far more room across than up), with
 *    velocity feed-forward so the camera doesn't trail the car at speed.
 *  - Shake from trauma (addTrauma): smooth noise scaled by trauma², with a
 *    slight roll; a directional kick (kick) that springs back; a short FOV
 *    punch (punchFov) on big hits. Reduced motion keeps a third of the shake
 *    and drops roll and FOV punches.
 *  - `lift` raises the camera (eased) for an on-foot fight.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  private x = 0;
  private z = 0;
  private height: number;
  private readonly corner = new Vector3();
  private lead: LeadSettings = LEAD_CAR;
  private leadX = 0;
  private leadZ = 0;
  private baseFov = 45;
  private readonly trauma = new Trauma(1.5);
  private readonly kickX = new Spring(150, 13);
  private readonly kickZ = new Spring(150, 13);
  private readonly fov = new Spring(170, 16);
  private noiseTime = 0;
  private liftNow = 0;
  /** Extra height wanted (m), e.g. while armed on foot; eased in and out. */
  lift = 0;
  /** Look-ahead toward the aim (world m from the target), wanted and eased (aimAt). */
  private aimWantX = 0;
  private aimWantZ = 0;
  private aimLeadX = 0;
  private aimLeadZ = 0;
  /** Gentler camera: less shake, no roll, no FOV punches. */
  reducedMotion = false;
  /**
   * How fast the world moves this frame relative to real time (hit-stop
   * slows it). The velocity feed-forward is scaled by it, or the view would
   * run on ahead of a frozen car and spring back; shake keeps real time.
   */
  timeScale = 1;

  constructor(
    aspect: number,
    readonly opts = {
      minHeight: 26,
      maxHeight: 58,
      /** Height gained per m/s of speed. */
      heightPerSpeed: 1.05,
      /** Camera sits this fraction of its height behind (toward screen-bottom, +Z). */
      tilt: 0.12,
      /** How fast the camera closes on its target, 1/s (on top of velocity feed-forward). */
      followRate: 6,
      zoomRate: 1.6,
      /** How fast the look-ahead swings to a new direction, 1/s. */
      leadRate: 2.2,
      /** How fast the aim look-ahead (aimAt) follows the aim, 1/s. */
      aimLeadRate: 3,
      /** Biggest shake offset, as a fraction of the height. */
      shakeOffset: 0.045,
      /** Biggest shake roll, radians. */
      shakeRoll: 1.8 * DEG,
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

  /**
   * Lead the view (dx, dz) metres off the target toward where the player
   * aims (mouse aim: see what you shoot at); (0, 0) to stop. Eased.
   */
  aimAt(dx: number, dz: number): void {
    this.aimWantX = dx;
    this.aimWantZ = dz;
  }

  /** How far ahead to lead (LEAD_CAR, LEAD_FOOT, or custom). */
  setLead(lead: LeadSettings): void {
    this.lead = lead;
  }

  /** Legacy shake (metres of jitter, e.g. 2.5 for a close blast): adds trauma. */
  shake(amount: number): void {
    this.addTrauma(amount / 3);
  }

  /** Add trauma 0..1 (0.1 a bump, 0.5 a heavy crash, 1 your own car exploding). */
  addTrauma(amount: number): void {
    this.trauma.add(this.reducedMotion ? amount * 0.5 : amount);
  }

  /** Current trauma 0..1 (debug, tests). */
  get traumaLevel(): number {
    return this.trauma.level;
  }

  /** Jolt the view `metres` along (dirX, dirZ) (normalised here); it springs back. */
  kick(dirX: number, dirZ: number, metres: number): void {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6 || metres <= 0) return;
    const m = this.reducedMotion ? metres * 0.4 : metres;
    // A spring kicked with velocity v peaks near v / sqrt(stiffness).
    const v = m * Math.sqrt(this.kickX.stiffness) * 1.6;
    this.kickX.kick((dirX / len) * v);
    this.kickZ.kick((dirZ / len) * v);
  }

  /** Narrow the FOV by `degrees` for a moment (negative widens: a whoosh). */
  punchFov(degrees: number): void {
    if (this.reducedMotion) return;
    this.fov.kick(-degrees * Math.sqrt(this.fov.stiffness) * 2.4);
  }

  snapTo(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.leadX = this.leadZ = 0;
    this.aimLeadX = this.aimLeadZ = this.aimWantX = this.aimWantZ = 0;
    this.timeScale = 1;
    this.kickX.reset();
    this.kickZ.reset();
    this.apply();
  }

  update(dt: number, targetX: number, targetZ: number, vx: number, vz: number): void {
    const o = this.opts;
    const speed = Math.hypot(vx, vz);
    const wantHeight = Math.min(o.maxHeight, o.minHeight + speed * o.heightPerSpeed);
    this.height += (wantHeight - this.height) * (1 - Math.exp(-o.zoomRate * dt));
    this.liftNow += (this.lift - this.liftNow) * (1 - Math.exp(-2 * dt));

    // Lead per axis, limited to a share of what's visible on that axis.
    const halfH = (this.height + this.liftNow) * Math.tan((this.baseFov * DEG) / 2);
    const halfW = halfH * this.camera.aspect;
    const l = this.lead;
    const wantX = softClamp(vx * l.seconds, halfW * l.maxX);
    const wantZ = softClamp(vz * l.seconds, halfH * l.maxZ);
    const lk = 1 - Math.exp(-o.leadRate * dt);
    this.leadX += (wantX - this.leadX) * lk;
    this.leadZ += (wantZ - this.leadZ) * lk;
    const ak = 1 - Math.exp(-o.aimLeadRate * dt);
    this.aimLeadX += (this.aimWantX - this.aimLeadX) * ak;
    this.aimLeadZ += (this.aimWantZ - this.aimLeadZ) * ak;

    // Velocity feed-forward, then close the remaining gap: no trailing at speed.
    this.x += vx * dt * this.timeScale;
    this.z += vz * dt * this.timeScale;
    const follow = 1 - Math.exp(-o.followRate * dt);
    this.x += (targetX + this.leadX + this.aimLeadX - this.x) * follow;
    this.z += (targetZ + this.leadZ + this.aimLeadZ - this.z) * follow;

    this.trauma.step(dt);
    this.noiseTime += dt;
    this.kickX.step(dt);
    this.kickZ.step(dt);
    this.fov.step(dt);
    this.apply();
  }

  /** Ground point the camera is centred on (the player plus look-ahead), without shake. */
  get focusX(): number {
    return this.x;
  }

  get focusZ(): number {
    return this.z;
  }

  /** Current camera height, m (including any lift). */
  get currentHeight(): number {
    return this.height + this.liftNow;
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
    // Indexed, not destructured: this runs several times a frame and must not allocate.
    for (let i = 0; i < SCREEN_CORNERS.length; i++) {
      const c = SCREEN_CORNERS[i];
      // Unit ray from the camera through this corner of the screen.
      const dir = this.corner.set(c[0], c[1], 0.5).unproject(cam).sub(cam.position).normalize();
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
    this.baseFov = aspect < 1 ? 62 : 45;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  private apply(): void {
    const h = this.height + this.liftNow;
    const back = h * this.opts.tilt;
    const s = this.trauma.shake * (this.reducedMotion ? 0.35 : 1);
    const t = this.noiseTime;
    const amp = s * h * this.opts.shakeOffset;
    const jx = amp * smoothNoise(t, 1) + this.kickX.value;
    const jz = amp * smoothNoise(t, 2) + this.kickZ.value;
    this.camera.position.set(this.x + jx, h, this.z + back + jz);
    const roll = this.reducedMotion ? 0 : s * this.opts.shakeRoll * smoothNoise(t * 0.8, 3);
    this.camera.up.set(Math.sin(roll), 0, -Math.cos(roll));
    this.camera.lookAt(this.x + jx, 0, this.z + jz);
    const fov = this.baseFov + this.fov.value;
    if (Math.abs(fov - this.camera.fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
