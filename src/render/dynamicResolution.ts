import type { WebGLRenderer } from 'three';

/**
 * Trades resolution for frame rate: drops the pixel ratio when frames run
 * slow, raises it again when there's headroom. Capped at 2x (and at the
 * device's ratio) — beyond that phones burn battery for no visible gain.
 */
export class DynamicResolution {
  private ratio: number;
  private readonly maxRatio: number;
  private readonly minRatio = 0.75;
  private elapsed = 0;
  private frames = 0;
  private fps = 0;

  constructor(private readonly renderer: WebGLRenderer) {
    this.maxRatio = Math.min(2, window.devicePixelRatio || 1);
    this.ratio = this.maxRatio;
    renderer.setPixelRatio(this.ratio);
  }

  sample(frameSeconds: number): void {
    this.elapsed += frameSeconds;
    this.frames++;
    if (this.elapsed < 1) return;
    this.fps = this.frames / this.elapsed;
    this.elapsed = 0;
    this.frames = 0;

    let next = this.ratio;
    if (this.fps < 50) next = Math.max(this.minRatio, this.ratio - 0.25);
    else if (this.fps > 58 && this.ratio < this.maxRatio) next = Math.min(this.maxRatio, this.ratio + 0.25);
    if (next !== this.ratio) {
      this.ratio = next;
      this.renderer.setPixelRatio(next);
    }
  }

  summary(): string {
    return `${Math.round(this.fps)} fps · ${this.ratio.toFixed(2)}x`;
  }
}
