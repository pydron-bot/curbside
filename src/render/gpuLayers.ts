/**
 * Leaves one part of the scene out for the GPU breakdown (core/gpuBreakdown.ts):
 * its objects get an empty layer mask (no camera, the shadow camera included,
 * draws them; the batches rewrite `visible` every frame, so that can't be
 * used), the sun's shadow pass is skipped, or the canvas drawn at half the
 * pixels. Lights are never touched: a light count change would recompile
 * every lit program.
 */
import type { Object3D, Scene, WebGLRenderer } from 'three';
import { layerOf, type GpuLayerKey } from '../core/gpuBreakdown';

const isLight = (o: Object3D) => (o as Object3D & { isLight?: boolean }).isLight === true;

export class GpuLayers {
  private readonly masked: Object3D[] = [];
  private readonly masks: number[] = [];
  private shadowsWere: boolean | null = null;
  private scaled = false;

  constructor(
    private readonly scene: Scene,
    private readonly renderer: WebGLRenderer,
    /** Draw at k × the chosen pixel ratio (DynamicResolution owns it); 1 puts it back. */
    private readonly pixelScale: (k: number) => void,
    /** Objects outside the scene that belong to a part (the offscreen particles). */
    private readonly extra: Partial<Record<GpuLayerKey, Object3D[]>> = {},
  ) {}

  /** Leave `key` out (after putting back whatever was left out); null: everything back. */
  set(key: GpuLayerKey | null): void {
    this.restore();
    if (key === null) return;
    if (key === 'pixels') {
      // Half the pixels: 1/√2 on each side.
      this.pixelScale(Math.SQRT1_2);
      this.scaled = true;
      return;
    }
    if (key === 'shadows' || key === 'empty') {
      this.shadowsWere = this.renderer.shadowMap.autoUpdate;
      this.renderer.shadowMap.autoUpdate = false;
      if (key === 'shadows') return;
    }
    for (const top of this.scene.children) {
      if (isLight(top)) continue;
      if (key !== 'empty' && layerOf(top.name) !== key) continue;
      this.hide(top);
    }
    for (const o of this.extra[key] ?? []) this.hide(o);
    if (key === 'empty') for (const list of Object.values(this.extra)) for (const o of list ?? []) this.hide(o);
  }

  private hide(root: Object3D): void {
    root.traverse((o) => {
      if (isLight(o) || o.layers.mask === 0) return;
      this.masked.push(o);
      this.masks.push(o.layers.mask);
      o.layers.mask = 0;
    });
  }

  private restore(): void {
    for (let i = 0; i < this.masked.length; i++) this.masked[i].layers.mask = this.masks[i];
    this.masked.length = 0;
    this.masks.length = 0;
    if (this.shadowsWere !== null) this.renderer.shadowMap.autoUpdate = this.shadowsWere;
    this.shadowsWere = null;
    if (this.scaled) this.pixelScale(1);
    this.scaled = false;
  }
}
