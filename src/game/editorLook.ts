/**
 * The map editor's VIEW IN 3D link (`?map=local&look=x,z`): kept apart from
 * game/mapEditorState.ts so the game can read it at boot without loading
 * the editor.
 */

/** The `look=x,z` URL parameter VIEW IN 3D adds: the game boots into observe mode over it. */
export function lookParam(p: { x: number; z: number }): string {
  return `${Math.round(p.x)},${Math.round(p.z)}`;
}

/** Where `?map=local&look=x,z` asks the camera to start, or null. */
export function editorLookAt(search: string): { x: number; z: number } | null {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch {
    return null;
  }
  if (q.get('map') !== 'local') return null;
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(q.get('look') ?? '');
  if (!m) return null;
  const x = Number(m[1]);
  const z = Number(m[2]);
  return Math.abs(x) < 4096 && Math.abs(z) < 4096 ? { x, z } : null;
}
