import type { Camera } from 'three';
import type { Look } from './look';

/**
 * A copy of the game view for a bug report, at most `maxWidth` px wide (2D
 * canvas). The WebGL canvas keeps no drawing buffer between frames
 * (preserveDrawingBuffer stays off: it costs every frame), so this draws one
 * frame through Look and copies it in the same task, before the browser
 * presents and clears it. Null if the context is lost or 2D is unavailable.
 */
export function snapshotView(look: Look, camera: Camera, canvas: HTMLCanvasElement, gl: WebGLRenderingContext | WebGL2RenderingContext, maxWidth: number): HTMLCanvasElement | null {
  if (gl.isContextLost() || canvas.width === 0 || canvas.height === 0) return null;
  look.render(camera);
  const k = Math.min(1, maxWidth / canvas.width);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * k));
  out.height = Math.max(1, Math.round(canvas.height * k));
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}
