/**
 * Shared by the tuning harnesses (tools/tune/*.mjs): a headless Chromium on
 * the running dev server, the game's `window.__ub` hooks, and a seeded
 * Math.random so a run is repeatable for A/B comparisons of a knob. The bots
 * replace `input.readVehicle`, so no game code changes; `fastForward` runs the
 * sim without rendering (about 1 s of wall time per 2 minutes of game).
 *
 * Playwright isn't a dependency of the game. Run with it on hand, e.g.
 *   npx -y -p playwright@1.63.0 node tools/tune/chaos.mjs 20
 * or set PLAYWRIGHT to a directory that has node_modules/playwright.
 * The dev server must be up (npm run dev); URL overrides the address.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

export const URL = process.env.URL ?? 'http://localhost:5173/curbside/';

export async function playwright() {
  if (process.env.PLAYWRIGHT) return createRequire(path.join(process.env.PLAYWRIGHT, 'noop.js'))('playwright');
  try {
    return await import('playwright');
  } catch {
    // npx -p puts the package's bin on PATH but not on the import path: find it from there.
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      if (!dir.endsWith(path.join('node_modules', '.bin'))) continue;
      try {
        return createRequire(path.join(dir, '..', 'noop.js'))('playwright');
      } catch {
        // not this one
      }
    }
    throw new Error('playwright not found: run with `npx -y -p playwright node …` or set PLAYWRIGHT');
  }
}

/** Headless Chromium with WebGL on SwiftShader (no GPU needed). */
export async function launch() {
  const { chromium } = await playwright();
  return chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}

/** A page on the game with a seedable Math.random (`window.__seed(n)`) and the hooks ready. */
export async function openGame() {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.addInitScript(() => {
    // mulberry32, reseedable between runs.
    let s = 1;
    Math.random = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    window.__seed = (n) => (s = n | 0 || 1);
    // The game seeds its own generators from the clock: a fixed one.
    const t0 = Date.UTC(2026, 0, 1);
    Date.now = () => t0;
    // No real frames: only fastForward moves the game, so nothing runs between a harness's steps.
    window.requestAnimationFrame = () => 0;
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__ub, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return { browser, page };
}

/** p-th percentile of numbers (nearest rank). */
export function pct(xs, p) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Positional args and --flags. */
export function args(defaults) {
  const out = { ...defaults, _: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const v = a[i + 1];
      out[k] = v === undefined || v.startsWith('--') ? true : (i++, isNaN(+v) ? v : +v);
    } else out._.push(isNaN(+a[i]) ? a[i] : +a[i]);
  }
  return out;
}
