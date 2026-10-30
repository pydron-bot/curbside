import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  LineBasicMaterial,
  LineSegments,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  grow: number;
  /** Fire fades yellow → red; smoke stays its colour and shrinks out. */
  hot: boolean;
  shade: number;
}

/**
 * Smoke, fire and explosions as flat, upward-facing quads (the camera is
 * almost overhead, so billboarding isn't needed). Two instanced meshes, one
 * draw call each, fixed-size pools.
 */
export class Effects {
  private smoke: Particle[] = [];
  private fire: Particle[] = [];
  private readonly smokeMesh: InstancedMesh;
  private readonly fireMesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  private readonly c = new Color();
  private readonly s = new Vector3();
  private readonly p = new Vector3();
  private tracers: Array<{ x1: number; z1: number; x2: number; z2: number; age: number }> = [];
  private readonly tracerLines: LineSegments;
  private readonly tracerPos: Float32Array;
  private readonly tracerCol: Float32Array;
  private static readonly MAX_TRACERS = 48;
  private static readonly TRACER_LIFE = 0.09;

  constructor(
    scene: Scene,
    private readonly maxSmoke = 260,
    private readonly maxFire = 200,
  ) {
    const geo = new PlaneGeometry(1, 1);
    const puff = softDisc();
    this.smokeMesh = new InstancedMesh(
      geo,
      new MeshBasicMaterial({ map: puff, transparent: true, opacity: 0.5, depthWrite: false }),
      maxSmoke,
    );
    this.fireMesh = new InstancedMesh(
      geo,
      new MeshBasicMaterial({ map: puff, transparent: true, depthWrite: false, blending: AdditiveBlending }),
      maxFire,
    );
    for (const mesh of [this.smokeMesh, this.fireMesh]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false; // particles move; the pool is tiny anyway
      mesh.renderOrder = 2;
      scene.add(mesh);
    }
    const n = Effects.MAX_TRACERS * 2;
    this.tracerPos = new Float32Array(n * 3);
    this.tracerCol = new Float32Array(n * 3);
    const tg = new BufferGeometry();
    tg.setAttribute('position', new BufferAttribute(this.tracerPos, 3).setUsage(DynamicDrawUsage));
    tg.setAttribute('color', new BufferAttribute(this.tracerCol, 3).setUsage(DynamicDrawUsage));
    this.tracerLines = new LineSegments(
      tg,
      new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    this.tracerLines.frustumCulled = false;
    scene.add(this.tracerLines);

    // Ensure instanceColor exists before first use.
    this.smokeMesh.setColorAt(0, this.c.set('#000'));
    this.fireMesh.setColorAt(0, this.c.set('#000'));
  }

  emitSmoke(x: number, z: number, y: number, dark = 0.5): void {
    if (this.smoke.length >= this.maxSmoke) return;
    this.smoke.push({
      x: x + (Math.random() - 0.5) * 0.6,
      y,
      z: z + (Math.random() - 0.5) * 0.6,
      vx: 0.8 + Math.random() * 0.6, // a steady breeze toward +X
      vy: 0.8 + Math.random() * 0.6,
      vz: (Math.random() - 0.5) * 0.6,
      age: 0,
      life: 1.4 + Math.random(),
      size: 0.7,
      grow: 0.9,
      hot: false,
      shade: 0.55 - dark * 0.45 + Math.random() * 0.1,
    });
  }

  emitFire(x: number, z: number, y: number): void {
    if (this.fire.length >= this.maxFire) return;
    this.fire.push({
      x: x + (Math.random() - 0.5) * 1.2,
      y,
      z: z + (Math.random() - 0.5) * 1.6,
      vx: 0.3,
      vy: 2 + Math.random() * 1.5,
      vz: 0,
      age: 0,
      life: 0.35 + Math.random() * 0.3,
      size: 0.9 + Math.random() * 0.5,
      grow: -0.8,
      hot: true,
      shade: 0,
    });
  }

  explode(x: number, z: number): void {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 10;
      if (this.fire.length < this.maxFire) {
        this.fire.push({
          x, y: 1, z,
          vx: Math.cos(a) * sp, vy: 2 + Math.random() * 4, vz: Math.sin(a) * sp,
          age: 0, life: 0.4 + Math.random() * 0.5, size: 1.6 + Math.random() * 1.6, grow: -1.5, hot: true, shade: 0,
        });
      }
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      if (this.smoke.length < this.maxSmoke) {
        this.smoke.push({
          x, y: 1.5, z,
          vx: Math.cos(a) * sp, vy: 1 + Math.random() * 1.5, vz: Math.sin(a) * sp,
          age: 0, life: 1.2 + Math.random() * 1.2, size: 1.8, grow: 1.6, hot: false, shade: 0.12 + Math.random() * 0.1,
        });
      }
    }
  }

  /** A bright streak from the muzzle to where the bullet stopped. */
  tracer(x1: number, z1: number, x2: number, z2: number): void {
    if (this.tracers.length >= Effects.MAX_TRACERS) this.tracers.shift();
    this.tracers.push({ x1, z1, x2, z2, age: 0 });
  }

  update(dt: number): void {
    this.updatePool(this.smoke, this.smokeMesh, dt, 0.6);
    this.updatePool(this.fire, this.fireMesh, dt, 0.2);
    let n = 0;
    for (const t of this.tracers) {
      t.age += dt;
      if (t.age >= Effects.TRACER_LIFE) continue;
      const k = 1 - t.age / Effects.TRACER_LIFE;
      this.tracerPos.set([t.x1, 1.25, t.z1, t.x2, 1.25, t.z2], n * 6);
      this.tracerCol.set([k, k * 0.9, k * 0.5, k * 0.6, k * 0.5, k * 0.2], n * 6);
      this.tracers[n++] = t;
    }
    this.tracers.length = n;
    const g = this.tracerLines.geometry;
    g.setDrawRange(0, n * 2);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  private updatePool(list: Particle[], mesh: InstancedMesh, dt: number, drag: number) {
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = Math.exp(-drag * dt * 3);
      p.vx *= k;
      p.vz *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size = Math.max(0.05, p.size + p.grow * dt);
      const t = p.age / p.life;
      // Fade by shrinking at end of life (instances share one opacity).
      const scale = p.size * (t > 0.7 ? (1 - t) / 0.3 : 1);
      this.m.compose(this.p.set(p.x, p.y, p.z), this.q, this.s.set(scale, scale, scale));
      mesh.setMatrixAt(n, this.m);
      if (p.hot) this.c.setRGB(1, 0.85 - t * 0.6, 0.3 - t * 0.3);
      else this.c.setScalar(p.shade);
      mesh.setColorAt(n, this.c);
      list[n++] = p;
    }
    list.length = n;
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/** White disc fading to transparent, so particles read as soft puffs. */
function softDisc(): CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}
