import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { Pickup, PickupKind } from '../world/pickups';

const COLORS: Record<PickupKind, string> = {
  pistol: '#4fa3ff',
  smg: '#ffa040',
  shotgun: '#ff5a5a',
  health: '#5be36a',
};

/** Spinning, bobbing crates; one draw call for all of them. */
export class PickupMesh {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();

  constructor(private readonly pickups: Pickup[]) {
    this.mesh = new InstancedMesh(new BoxGeometry(0.7, 0.7, 0.7), new MeshBasicMaterial(), pickups.length);
    const c = new Color();
    pickups.forEach((p, i) => this.mesh.setColorAt(i, c.set(COLORS[p.kind])));
    this.mesh.frustumCulled = false; // spread over the whole city; one cheap draw call
  }

  update(time: number): void {
    this.pickups.forEach((p, i) => {
      const s = p.respawnAt === 0 ? 1 : 0;
      this.q.setFromAxisAngle(this.up, time * 2 + i);
      this.pos.set(p.x, 0.7 + Math.sin(time * 3 + i) * 0.15, p.z);
      this.m.compose(this.pos, this.q, this.scale.set(s, s, s));
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
