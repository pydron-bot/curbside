import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';

const GRAVITY = 24;
const FLOOR = 0.03;

/**
 * Solid bits flying about: car panels and chunks from explosions, glass
 * chips from crashes, brass shell casings from guns. One instanced box mesh,
 * lit like the world (one draw call, no shadow pass), with struct-of-arrays
 * physics: gravity, a couple of bounces with friction, spin that dies down on
 * the ground, and a shrink-out at the end of life.
 */
export class Debris {
  readonly mesh: InstancedMesh;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly rx: Float32Array;
  private readonly ry: Float32Array;
  private readonly rz: Float32Array;
  private readonly wx: Float32Array;
  private readonly wy: Float32Array;
  private readonly wz: Float32Array;
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly sz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly bounce: Float32Array;
  private readonly cr: Float32Array;
  private readonly cg: Float32Array;
  private readonly cb: Float32Array;
  private readonly alive: Uint8Array;
  private next = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly c = new Color();

  constructor(readonly capacity = 128) {
    const f = () => new Float32Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.rx = f();
    this.ry = f();
    this.rz = f();
    this.wx = f();
    this.wy = f();
    this.wz = f();
    this.sx = f();
    this.sy = f();
    this.sz = f();
    this.age = f();
    this.life = f();
    this.bounce = f();
    this.cr = f();
    this.cg = f();
    this.cb = f();
    this.alive = new Uint8Array(capacity);
    const mat = new MeshLambertMaterial({ color: '#ffffff' });
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // Create the colour attribute now so the program is compiled with it at warm-up.
    this.mesh.setColorAt(0, this.c.setRGB(1, 1, 1));
    this.mesh.instanceColor!.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'debris';
  }

  /**
   * Throw one piece: box of size (w, h, d) m, colour (linear rgb), launched
   * from (x, y, z) at (vx, vy, vz) with random spin up to `spin` rad/s.
   * When the pool is full the oldest-slot piece is replaced.
   */
  throw(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    w: number,
    h: number,
    d: number,
    r: number,
    g: number,
    b: number,
    life: number,
    spin: number,
    bounce = 0.38,
  ): void {
    let i = -1;
    for (let k = 0; k < this.capacity; k++) {
      const j = (this.next + k) % this.capacity;
      if (!this.alive[j]) {
        i = j;
        break;
      }
    }
    if (i < 0) i = this.next;
    this.next = (i + 1) % this.capacity;
    this.alive[i] = 1;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.rx[i] = Math.random() * 6.3;
    this.ry[i] = Math.random() * 6.3;
    this.rz[i] = Math.random() * 6.3;
    this.wx[i] = (Math.random() * 2 - 1) * spin;
    this.wy[i] = (Math.random() * 2 - 1) * spin;
    this.wz[i] = (Math.random() * 2 - 1) * spin;
    this.sx[i] = w;
    this.sy[i] = h;
    this.sz[i] = d;
    this.age[i] = 0;
    this.life[i] = life;
    this.bounce[i] = bounce;
    this.cr[i] = r;
    this.cg[i] = g;
    this.cb[i] = b;
  }

  get count(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) n += this.alive[i];
    return n;
  }

  update(dt: number): void {
    let n = 0;
    const mesh = this.mesh;
    const col = mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      if (dt > 0) this.stepOne(i, dt);
      if (!this.alive[i]) continue;
      const t = this.age[i] / this.life[i];
      const shrink = t > 0.85 ? (1 - t) / 0.15 : 1;
      this.e.set(this.rx[i], this.ry[i], this.rz[i]);
      this.q.setFromEuler(this.e);
      this.p.set(this.px[i], this.py[i], this.pz[i]);
      this.s.set(this.sx[i] * shrink, this.sy[i] * shrink, this.sz[i] * shrink);
      this.m.compose(this.p, this.q, this.s);
      // Live pieces are packed at the front of the instance buffers.
      mesh.setMatrixAt(n, this.m);
      col[n * 3] = this.cr[i];
      col[n * 3 + 1] = this.cg[i];
      col[n * 3 + 2] = this.cb[i];
      n++;
    }
    mesh.count = n;
    mesh.visible = n > 0;
    if (n > 0) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      const colour = mesh.instanceColor!;
      colour.clearUpdateRanges();
      colour.addUpdateRange(0, n * 3);
      colour.needsUpdate = true;
    }
  }

  clear(): void {
    this.alive.fill(0);
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  private stepOne(i: number, dt: number): void {
    const age = this.age[i] + dt;
    if (age >= this.life[i]) {
      this.alive[i] = 0;
      return;
    }
    this.age[i] = age;
    this.vy[i] -= GRAVITY * dt;
    this.px[i] += this.vx[i] * dt;
    this.py[i] += this.vy[i] * dt;
    this.pz[i] += this.vz[i] * dt;
    const rest = FLOOR + this.sy[i] * 0.5;
    if (this.py[i] < rest) {
      this.py[i] = rest;
      if (this.vy[i] < -1.5) {
        this.vy[i] = -this.vy[i] * this.bounce[i];
        this.vx[i] *= 0.6;
        this.vz[i] *= 0.6;
        this.wx[i] *= 0.6;
        this.wy[i] *= 0.6;
        this.wz[i] *= 0.6;
      } else {
        // Sliding to a stop, lying flat-ish.
        this.vy[i] = 0;
        const f = Math.exp(-6 * dt);
        this.vx[i] *= f;
        this.vz[i] *= f;
        this.wx[i] *= f;
        this.wy[i] *= f;
        this.wz[i] *= f;
        this.rx[i] *= f;
        this.rz[i] *= f;
      }
    }
    this.rx[i] += this.wx[i] * dt;
    this.ry[i] += this.wy[i] * dt;
    this.rz[i] += this.wz[i] * dt;
  }
}
