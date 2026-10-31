/**
 * Loads the destruction test's rubble physics (Rapier, ~0.8 MB gzip of wasm
 * and glue) on demand: only when the test is on, and never at a breach
 * (destruction.ts preloads at boot behind the title, or when the setting is
 * switched on on the paused Diagnostics sheet). No static import of Rapier
 * here, so the main chunk stays free of it. Memoised; a failure is final for
 * the session (browsers may cache a failed module record), and the test then
 * falls back to scars and particles.
 */
import { publicUrl } from '../core/paths';

export type RapierState = 'idle' | 'loading' | 'ready' | 'failed';

type PhysicsModule = typeof import('./rubblePhysics');

/** What the loader knows, for the overlay and the diagnostics report. */
export const rapier = {
  state: 'idle' as RapierState,
  /**
   * Download (the files into the HTTP or service-worker cache), import (parse,
   * compile and instantiate from that cache: the main-thread part, always
   * behind a pause or the title) and warm-up times, ms. In dev there is no
   * separate download: the import is all of it.
   */
  loadMs: 0,
  evalMs: 0,
  warmMs: 0,
  error: null as string | null,
  version: null as string | null,
  /** The smallest step performance.now() shows, ms (WebKit may quantise to ~1 ms). */
  timerMs: 0,
};

/** Rapier's built files (the Workbox route and the first-session cache match these). */
const RAPIER_FILE = /\/assets\/rapier[\w-]*\.(?:js|wasm)$/;

let pending: Promise<PhysicsModule | null> | null = null;

/** Safari has no requestIdleCallback: yield with a macrotask between warm-up batches. */
const slice = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Rapier's built files, named in index.html by the build (vite.config.ts); none in dev. */
function rapierFiles(): string[] {
  const meta = typeof document !== 'undefined' ? document.querySelector<HTMLMetaElement>('meta[name="curbside-rapier"]') : null;
  return meta?.content ? meta.content.split(' ').map((f) => publicUrl(f)) : [];
}

/**
 * The files into the browser's cache (or the service worker's) now, off the
 * main thread. A failure here isn't final: the import fetches again and
 * reports the real error.
 */
function download(): Promise<unknown> {
  return Promise.all(rapierFiles().map((u) => fetch(u).then((r) => (r.ok ? r.blob() : null)).catch(() => null)));
}

/**
 * `quiet` resolves when nobody is playing. The download starts at once; the
 * import that evaluates it (the wasm instantiated on the main thread), the
 * memory reserve and every warm-up batch wait for `quiet`, so a player who
 * resumes before a slow download lands gets none of it mid-play (it finishes
 * at the next pause). Only a resume in the moment between a pause and the
 * import finishing (~0.1–0.5 s) can still see it.
 */
export function loadRubblePhysics(quiet: () => Promise<void> = () => Promise.resolve()): Promise<PhysicsModule | null> {
  if (pending) return pending;
  rapier.state = 'loading';
  const t0 = performance.now();
  pending = download()
    .then(async () => {
      rapier.loadMs = performance.now() - t0;
      await quiet();
      const t1 = performance.now();
      const m = await import('./rubblePhysics');
      rapier.evalMs = performance.now() - t1;
      await quiet();
      m.reserve();
      rapier.warmMs = await m.warmUp(() => slice().then(quiet));
      rapier.version = m.rapierVersion();
      rapier.timerMs = timerGranularity();
      rapier.state = 'ready';
      cacheForOffline();
      return m;
    })
    .catch((e: unknown) => {
      rapier.state = 'failed';
      rapier.error = e instanceof Error ? e.message : String(e);
      console.warn('Rubble physics unavailable; the destruction test falls back to scars and particles', e);
      return null;
    });
  return pending;
}

/** The smallest non-zero performance.now() step seen over a ~3 ms spin, ms. */
function timerGranularity(): number {
  let last = performance.now();
  const end = last + 3;
  let min = Infinity;
  for (;;) {
    const t = performance.now();
    if (t !== last) {
      if (t - last < min) min = t - last;
      last = t;
    }
    if (t >= end) break;
  }
  return min === Infinity ? 0 : min;
}

/**
 * The first session after install isn't controlled by the service worker
 * ('prompt' registration, no clientsClaim), so its runtime route never sees
 * Rapier: put the files in the route's cache now, best-effort.
 */
function cacheForOffline(): void {
  if (!import.meta.env.PROD || !('caches' in self) || !navigator.serviceWorker || navigator.serviceWorker.controller) return;
  // Each file shows up twice (the download, then the import from cache); addAll refuses duplicates.
  const urls = [
    ...new Set(
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => RAPIER_FILE.test(new URL(u).pathname)),
    ),
  ];
  if (urls.length === 0) return;
  void caches
    .open('curbside-rapier')
    .then((c) => c.addAll(urls))
    .catch(() => {});
}
